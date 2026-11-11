/**
 * 把 27 句分句配音按 timeline.json 的绝对 start 拼成一条完整音轨。
 *
 * 用途有两个：
 *  1. 交付一条可直接试听 / 校对节奏的完整配音 WAV；
 *  2. 如果浏览器录制只能稳定产出无声视频，用 AVFoundation 把这条轨
 *     合成进 MP4（tools/mux-intro.swift），不必依赖实时 AudioContext。
 *
 * 注意 afconvert 生成的 wav 在 fmt 与 data 之间插了一个 FLLR chunk，
 * 所以不能写死 44 字节头，必须逐 chunk 找 data。
 */
import fs from 'node:fs';
import path from 'node:path';

const SR = 22050;
const CH = 1;
const BYTES_PER_SAMPLE = 2;
const FRAME = CH * BYTES_PER_SAMPLE;

const tl = JSON.parse(fs.readFileSync('public/intro/timeline.json', 'utf8'));
const totalFrames = Math.ceil((tl.total + 0.2) * SR);
const pcm = Buffer.alloc(totalFrames * FRAME, 0);

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE: ${file}`);
  }
  let o = 12, rate = 0, channels = 0, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      channels = b.readUInt16LE(body + 2);
      rate = b.readUInt32LE(body + 4);
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(b.length, body + size));
    }
    o = body + size + (size % 2);
  }
  if (!data) throw new Error(`no data chunk: ${file}`);
  if (rate !== SR || channels !== CH) {
    throw new Error(`unexpected format in ${file}: ${rate}Hz ${channels}ch`);
  }
  return data;
}

function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);                 // PCM
  h.writeUInt16LE(CH, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * FRAME, 28);       // byte rate
  h.writeUInt16LE(FRAME, 32);            // block align
  h.writeUInt16LE(16, 34);               // bits
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

let n = 0;
for (const shot of tl.shots) {
  for (const line of shot.lines) {
    const rel = line.audio.replace(/^\//, '');
    const data = readWav(path.join('public', rel));
    const off = Math.round(line.start * SR) * FRAME;
    if (off + data.length > pcm.length) throw new Error(`cue overflows timeline: ${rel}`);
    data.copy(pcm, off);
    n++;
  }
}

const out = 'out/dyson-intro-voice.wav';
fs.writeFileSync(out, Buffer.concat([wavHeader(pcm.length), pcm]));
console.log(`[voice] ${n} cues -> ${out}`);
console.log(`[voice] ${(pcm.length / FRAME / SR).toFixed(3)}s, ${SR}Hz mono Int16, ${(pcm.length / 1048576).toFixed(2)} MB`);
