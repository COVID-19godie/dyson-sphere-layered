/**
 * 介绍片配音 + 时间轴生成。
 *
 * 关键：**每句旁白单独合成，用 afinfo 读回真实时长**，
 * 再用这个时长去排字幕、镜头和音频调度。音画同步是数据保证的，
 * 不靠"估计字数 × 语速"，也不需要事后拿 ASR 去对齐。
 *
 * 音源：微软 Edge 免费神经语音（Read Aloud），通过 GitHub 开源客户端
 * rany2/edge-tts 调用。无需 API key、无需 Azure 订阅，语音是神经网络合成，
 * 比 macOS 自带的拼接式 say 自然得多。代价是文本会发往微软、且依赖联网。
 *
 * 依赖（装到项目缓存，.cache/ 已被 .gitignore 排除）：
 *   python3 -m pip install --target .cache/tts-env edge-tts \
 *     -i https://pypi.tuna.tsinghua.edu.cn/simple
 *
 *   node tools/narrate.mjs
 *   INTRO_VOICE=zh-CN-YunjianNeural node tools/narrate.mjs   # 换声
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTRO_SHOTS, INTRO_PACING as P, INTRO_TITLE, INTRO_SUBTITLE } from '../src/cinema/introScript.js';

// zh-CN-YunyangNeural：微软标注 Professional / Reliable，标准播音腔，
// 沉稳、不抢画面，适合科普纪录片旁白。
// 备选 zh-CN-YunjianNeural：低沉、纪录片解说感更强（Passion）。
const VOICE = process.env.INTRO_VOICE || 'zh-CN-YunyangNeural';
const PY = process.env.PYTHON || 'python3';
const TTS_ENV = '.cache/tts-env';
const CACHE = '.cache/tts';
const AUDIO_DIR = 'public/intro/audio';
const OUT_TIMELINE = 'public/intro/timeline.json';
const OUT_SRT = 'out/dyson-intro.srt';

mkdirSync(CACHE, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });
mkdirSync('out', { recursive: true });

const env = {
  ...process.env,
  PYTHONPATH: existsSync(TTS_ENV) ? resolve(TTS_ENV) : (process.env.PYTHONPATH || ''),
};
try {
  execFileSync(PY, ['-c', 'import edge_tts'], { env, stdio: 'pipe' });
} catch {
  throw new Error(`找不到 edge-tts，请先装到 ${TTS_ENV}（见本文件头注释）`);
}

function durationOf(wav) {
  const info = execFileSync('afinfo', [wav], { encoding: 'utf8' });
  const m = info.match(/estimated duration:\s*([\d.]+)/);
  if (!m) throw new Error(`读不到时长: ${wav}`);
  return Math.round(parseFloat(m[1]) * 1000) / 1000;
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(f).padStart(3, '0')}`;
}

let t = P.head;
const shots = [];
const srt = [];
let cue = 1;

for (const shot of INTRO_SHOTS) {
  const start = t;
  t += P.shotPad;                 // 画面先立住，再开口
  const lines = [];

  for (let i = 0; i < shot.lines.length; i++) {
    const text = shot.lines[i];
    const name = `${shot.id}_${String(i).padStart(2, '0')}.wav`;
    const mp3 = `${CACHE}/${name}.mp3`;
    const wav = `${AUDIO_DIR}/${name}`;

    // 每句单独请求：微软返回 24kHz mono MP3，再统一成运行时约定的
    // 22050Hz / mono / Int16 WAV。分句是为了让每句的真实时长可测量。
    execFileSync(PY, [
      '-m', 'edge_tts',
      '--voice', VOICE,
      '--text', text,
      '--write-media', mp3,
    ], { env, stdio: 'pipe' });
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', mp3, wav]);
    const dur = durationOf(wav);

    lines.push({ text, audio: `/intro/audio/${name}`, start: Math.round(t * 1000) / 1000, dur });
    srt.push(`${cue++}\n${srtTime(t)} --> ${srtTime(t + dur + 0.18)}\n${text}\n`);
    t += dur + (i < shot.lines.length - 1 ? P.gap : 0);
  }

  t += P.shotPad;
  shots.push({
    id: shot.id, chapter: shot.chapter, title: shot.title,
    start: Math.round(start * 1000) / 1000,
    dur: Math.round((t - start) * 1000) / 1000,
    lines,
  });
}

const total = Math.round((t + P.tail) * 1000) / 1000;
const timeline = {
  title: INTRO_TITLE, subtitle: INTRO_SUBTITLE,
  fps: 30, total,
  pacing: P,
  shots,
};

writeFileSync(OUT_TIMELINE, JSON.stringify(timeline, null, 2));
writeFileSync(OUT_SRT, '\uFEFF' + srt.join('\n'));   // BOM 让 Windows 播放器正确识别 UTF-8

console.log(`音源 ${VOICE}（微软 Edge 免费神经语音 / GitHub 开源客户端 edge-tts）`);
console.log(`配音 ${shots.reduce((s, x) => s + x.lines.length, 0)} 句`);
for (const s of shots) console.log(`  ${s.id} ${s.chapter.padEnd(12)} ${String(s.start).padStart(6)}s +${s.dur}s`);
console.log(`总时长 ${total}s`);
console.log(`→ ${OUT_TIMELINE}`);
console.log(`→ ${OUT_SRT}`);
