/**
 * 不依赖 ffmpeg / ffprobe 的 MP4 体检。
 *
 * MediaRecorder 产出的是分片 MP4（moov 里 mvhd 时长为 0、时长写在 moof），
 * 系统播放器经常读不出时长，所以链路末尾一律 avconvert 重封装。
 * 这里直接读 box：确认轨道类型（vide / soun）、编码、sample 数、
 * mvhd 时长与分辨率，用来判断「有没有音轨」「帧率够不够」「要不要重封装」。
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/probe-mp4.mjs <file>'); process.exit(1); }
const buf = fs.readFileSync(file);

const u32 = (o) => buf.readUInt32BE(o);
const tag = (o) => buf.toString('ascii', o, o + 4);
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'moof', 'traf']);

const tracks = [];
let mvhd = null;
let tkhdW = 0, tkhdH = 0;
let moofCount = 0;
let mdatBytes = 0;

function walk(start, end, ctx = {}) {
  let o = start;
  while (o + 8 <= end) {
    const size = u32(o);
    const type = tag(o + 4);
    const head = size === 1 ? 16 : 8;
    const body = o + head;
    const stop = size === 0 ? end : Math.min(end, o + size);
    if (size < head && size !== 0) break;

    if (type === 'mvhd') {
      const ver = buf[body];
      const ts = ver === 1 ? body + 20 : body + 12;
      const dur = ver === 1 ? Number(buf.readBigUInt64BE(ts + 4)) : u32(ts + 4);
      const scale = u32(ts);
      mvhd = { duration: scale ? dur / scale : 0, timescale: scale, version: ver };
    } else if (type === 'tkhd') {
      const ver = buf[body];
      const off = ver === 1 ? body + 4 + 16 + 4 + 4 + 4 + 4 + 8 : body + 4 + 12 + 4 + 4 + 4 + 4;
      tkhdW = u32(off + 32) / 65536;
      tkhdH = u32(off + 36) / 65536;
    } else if (type === 'hdlr') {
      ctx.handler = buf.toString('ascii', body + 8, body + 12);
    } else if (type === 'stsd') {
      ctx.codec = buf.toString('ascii', body + 12, body + 16);
    } else if (type === 'stsz') {
      ctx.samples = u32(body + 8);
      ctx.sampleSize = u32(body + 4);
    } else if (type === 'stts') {
      const n = u32(body + 4);
      let total = 0, delta = 0;
      for (let i = 0; i < n && body + 8 + i * 8 + 8 <= stop; i++) {
        const cnt = u32(body + 8 + i * 8);
        const d = u32(body + 12 + i * 8);
        total += cnt * d;
        delta += cnt;
      }
      ctx.stts = { total, delta };
    } else if (type === 'mdhd') {
      const ver = buf[body];
      ctx.mediaTimescale = u32(body + (ver === 1 ? 20 : 12));
      ctx.mediaDuration = ver === 1
        ? Number(buf.readBigUInt64BE(body + 24)) : u32(body + 16);
    } else if (type === 'moof') {
      moofCount++;
    } else if (type === 'mdat') {
      mdatBytes += Math.max(0, stop - body);
    }

    // 每个 trak 必须给独立 ctx：共用一个对象会让第二条轨道继承第一条的
    // handler / samples，读出来变成"两条 vide、没有 soun"的假象。
    if (CONTAINERS.has(type)) {
      if (type === 'trak') {
        const child = {};
        walk(body, stop, child);
        tracks.push(child);
      } else {
        walk(body, stop, ctx);
      }
    }
    o = stop;
  }
}

walk(0, buf.length, {});

console.log(`file        ${file}`);
console.log(`size        ${(buf.length / 1048576).toFixed(2)} MB`);
console.log(`mvhd        ${mvhd ? `${mvhd.duration.toFixed(3)}s (v${mvhd.version}, ts=${mvhd.timescale})` : 'missing'}`);
console.log(`moof/mdat   ${moofCount} fragments / ${(mdatBytes / 1048576).toFixed(2)} MB payload`);
console.log(`frame       ${tkhdW} x ${tkhdH}`);
for (const t of tracks) {
  const secs = t.mediaTimescale ? t.mediaDuration / t.mediaTimescale : 0;
  const fps = secs > 0 && t.samples ? t.samples / secs : 0;
  console.log(`track       ${(t.handler || '?').padEnd(4)} codec=${(t.codec || '?').padEnd(4)} samples=${t.samples ?? '?'} dur=${secs.toFixed(3)}s fps=${fps.toFixed(2)}`);
}
const hasAudio = tracks.some((t) => t.handler === 'soun');
const hasVideo = tracks.some((t) => t.handler === 'vide');
console.log(`verdict     video=${hasVideo} audio=${hasAudio} fragmented=${moofCount > 0 && (!mvhd || mvhd.duration < 0.01)}`);
