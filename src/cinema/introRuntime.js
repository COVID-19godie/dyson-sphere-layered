/**
 * 介绍片运行时：时间轴 / 配音调度 / 字幕合成 / 录制。
 *
 * 为什么单独一层：电影分镜（SEQUENCE）是"时间驱动画面"，
 * 介绍片是"配音时长驱动画面"。这里用 AudioContext.currentTime 当**唯一时钟**，
 * 画面、字幕、音频、录制起点全部读它 —— 只要一个时钟，就不会漂移。
 *
 * 画面链路：
 *   WebGL canvas → 2D display canvas（drawImage）→ 在下遮幅黑边里画字幕
 *   display.captureStream(fps) 取视频轨 + MediaStreamDestination 取音频轨
 *   → MediaRecorder 一次编码成带音轨的 MP4。不引入 ffmpeg。
 *
 * 导出参数（踩过坑，别改）：本机 Chrome 默认 GPU + --headless=new，
 * 不加 --use-angle=swiftshader。软件渲染会让每帧 drawImage 的 ReadPixels
 * 停顿，帧率掉到 1fps；默认 GPU 下 8 秒实测 440 帧、音视频轨齐全。
 * --virtual-time-budget 也不能用：它快进时钟但不产生 rAF 帧。
 * ?silent=1 的定时器 / 离线合成是验证过的备用方案，正式导出不走它。
 */
import { INTRO_SHOTS } from './introScript.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const W = 1920;
const H = 1080;
const BAR = Math.max(0, (1 - (W / H) / 2.39) * 0.5);   // FINAL_SHADER 同款遮幅比例
const BAR_PX = BAR * H;                                 // 上下黑边各约 138px

export async function createIntroRuntime(webglCanvas) {
  const tl = await fetch('/intro/timeline.json').then((r) => {
    if (!r.ok) throw new Error(`timeline ${r.status}`);
    return r.json();
  });

  const shotById = new Map(INTRO_SHOTS.map((s) => [s.id, s]));
  const cues = tl.shots.flatMap((s) => s.lines.map((l) => ({ ...l, shot: s })));
  // ?at=12.5 把影片锁在 12.5 秒定帧，用来逐镜截图复核（不播放音频、不录制）
  const q = new URLSearchParams(location.search);
  const atParam = q.get('at');
  const freezeAt = atParam != null && Number.isFinite(parseFloat(atParam)) ? parseFloat(atParam) : null;
  // 定帧复核不需要音频：headless 的 --virtual-time-budget 会把异步解码卡住，
  // 而截图只需要画面和字幕。录制时才真正建 AudioContext。
  const frozen = freezeAt != null;

  // ?silent=1 是正式导出通道。本机 headless 没有显示器，实时 rAF 被节流到 1fps，
  // 而 AudioContext.currentTime 走真实硬件时钟、没法用虚拟时间加速 —— 两者凑不到一起。
  // 所以：录画面时用 Chrome 的 --virtual-time-budget（rAF 恢复 30fps），
  // 影片时钟换成 performance.now()（virtual time 会一起推进它），完全不播音频；
  // 之后由 tools/assemble-voice.mjs + tools/mux-intro.swift 把配音合进 MP4。
  const silent = q.has('silent');

  /* ------------------------------------------------------------ 合成画布 */

  const display = document.createElement('canvas');
  display.width = W;
  display.height = H;
  display.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:5;background:#000';
  document.body.appendChild(display);
  webglCanvas.style.visibility = 'hidden';
  const ctx2d = display.getContext('2d', { alpha: false });

  /* -------------------------------------------------------------- 音频 */

  const actx = (frozen || silent) ? null : new (window.AudioContext || window.webkitAudioContext)();
  const dest = actx ? actx.createMediaStreamDestination() : null;
  const buffers = (frozen || silent) ? [] : await Promise.all(cues.map(async (c) => {
    const buf = await fetch(c.audio).then((r) => r.arrayBuffer());
    return actx.decodeAudioData(buf);
  }));
  console.log(`[intro] timeline ${tl.total}s, ${cues.length} cues, audio ${buffers.length}`);

  let t0 = null;                 // AudioContext 时间轴上的"影片零点"
  const perf0 = performance.now() / 1000;
  const time = () => {
    if (freezeAt != null) return freezeAt;
    if (silent) return performance.now() / 1000 - perf0;
    return t0 == null ? -1 : actx.currentTime - t0;
  };

  /** 一次性把所有句子排进音频时钟；画面随后读同一个时钟 */
  function startAudio() {
    t0 = actx.currentTime + 0.15;
    cues.forEach((c, i) => {
      const src = actx.createBufferSource();
      src.buffer = buffers[i];
      src.connect(dest);
      src.start(t0 + c.start);
    });
  }

  /* -------------------------------------------------------- 采样时间轴 */

  function sample(t) {
    const fade = smoothstep(0, tl.pacing.fadeIn, t)
      * (1 - smoothstep(tl.total - tl.pacing.fadeOut, tl.total, t));

    let shot = null;
    let u = 0;
    for (const s of tl.shots) {
      if (t >= s.start && t < s.start + s.dur) { shot = s; u = (t - s.start) / s.dur; break; }
    }
    // 句间留白时保持上一镜的机位，不要跳回默认视角
    if (!shot) {
      const last = tl.shots.filter((s) => s.start <= t).pop();
      shot = last || tl.shots[0];
      u = t < tl.shots[0].start ? 0 : 1;
    }
    let line = null;
    for (const c of cues) {
      if (t >= c.start && t < c.start + c.dur + 0.18) { line = c; break; }
    }
    return {
      t, fade, u: clamp01(u),
      cam: shotById.get(shot.id).cam,
      state: shotById.get(shot.id).state,
      ground: !!shotById.get(shot.id).cam.ground,
      chapter: shot.chapter,
      title: shot.title,
      line,
      introTitle: t < tl.pacing.head + 0.6,
      shotAge: t - shot.start,
    };
  }

  /* ------------------------------------------------------------ 字幕层 */

  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif';

  function drawSubtitle(s) {
    ctx2d.save();
    ctx2d.globalAlpha = s.fade;

    // 章节标题：只在该镜头开头 3.2 秒出现，放在上黑边，不打扰画面
    if (s.shotAge < 3.2 && s.t > tl.pacing.head) {
      const a = smoothstep(0, 0.35, s.shotAge) * (1 - smoothstep(2.6, 3.2, s.shotAge));
      ctx2d.globalAlpha = s.fade * a;
      ctx2d.fillStyle = '#7fd6e8';
      ctx2d.font = `500 25px ${FONT}`;
      ctx2d.textAlign = 'left';
      ctx2d.fillText(s.chapter, 96, BAR_PX * 0.55 + 8);
      ctx2d.fillStyle = 'rgba(180, 205, 220, 0.55)';
      ctx2d.font = `400 21px ${FONT}`;
      ctx2d.fillText(s.title, 96, BAR_PX * 0.55 + 42);
    }

    // 片头标题：黑场里先给片名，再进画面
    if (s.introTitle) {
      const a = smoothstep(0, 0.5, s.t) * (1 - smoothstep(tl.pacing.head, tl.pacing.head + 0.6, s.t));
      ctx2d.globalAlpha = a;
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = '#f2f5f7';
      ctx2d.font = `600 76px ${FONT}`;
      ctx2d.fillText(tl.title, W / 2, H / 2 - 6);
      ctx2d.fillStyle = '#88a9bb';
      ctx2d.font = `400 28px ${FONT}`;
      ctx2d.fillText(tl.subtitle, W / 2, H / 2 + 58);
    }

    // 字幕：烧在下黑边里。按 cue 的真实时长淡入淡出
    if (s.line) {
      const l = s.line;
      const age = s.t - l.start;
      const a = smoothstep(0, 0.16, age) * (1 - smoothstep(l.dur - 0.05, l.dur + 0.18, age));
      ctx2d.globalAlpha = s.fade * a;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.shadowColor = 'rgba(0,0,0,0.85)';
      ctx2d.shadowBlur = 12;
      ctx2d.fillStyle = '#f0f4f7';
      ctx2d.font = `500 40px ${FONT}`;
      ctx2d.fillText(l.text, W / 2, H - BAR_PX * 0.48);
      ctx2d.shadowBlur = 0;
    }

    // 进度线：贴着画幅底边，让 2 分半的片子有可读的推进感
    ctx2d.globalAlpha = s.fade * 0.65;
    ctx2d.fillStyle = 'rgba(255,255,255,0.12)';
    ctx2d.fillRect(0, H - 3, W, 3);
    ctx2d.fillStyle = '#7fd6e8';
    ctx2d.fillRect(0, H - 3, W * clamp01(s.t / tl.total), 3);
    ctx2d.restore();
  }

  /** 每帧在 composer.render() 之后调用：取 WebGL 画面 + 叠字幕 */
  function afterRender() {
    const s = sample(time());
    ctx2d.drawImage(webglCanvas, 0, 0, W, H);
    // 片头黑场：uFade 已经把 WebGL 压黑，这里再确保字幕之外的区域是纯黑
    drawSubtitle(s);
  }

  /* -------------------------------------------------------------- 录制 */

  let recorder = null;
  async function record() {
    if (frozen) return;      // 定帧模式不录制
    const mimes = silent ? [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm',
    ] : [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) { document.title = 'REC-UNSUPPORTED'; return; }

    const video = display.captureStream(tl.fps);
    const mixed = new MediaStream([
      ...video.getVideoTracks(),
      ...(dest ? dest.stream.getAudioTracks() : []),
    ]);
    const chunks = [];
    recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 24e6, audioBitsPerSecond: 192000 });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    let rendered = 0;
    const count = () => {
      rendered++;
      if (rendered % 300 === 0) {
        console.log('[intro] tick', rendered, silent ? 'silent' : (actx ? actx.state : '?'),
          `film=${time().toFixed(2)}`);
      }
      if (recorder && recorder.state === 'recording') requestAnimationFrame(count);
    };

    // ?dur=8 只录前 8 秒另存文件名；silent 是正式导出通道，单独落盘后合成配音。
    const shortTest = q.has('dur');
    const outName = shortTest ? 'dyson-intro-test'
      : (silent ? 'dyson-intro-silent' : 'dyson-intro');

    recorder.onstop = async () => {
      console.log('[intro] rec done', JSON.stringify({
        rendered, chunks: chunks.length, film: time(),
      }));
      const blob = new Blob(chunks, { type: mime });
      const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      try {
        const r = await fetch(`/save?name=${outName}.${ext}&frames=${rendered}`, {
          method: 'POST', body: blob,
        });
        document.title = `SAVED ${r.status} · ${rendered}f · ${(blob.size / 1048576).toFixed(1)}MB`;
      } catch (err) {
        document.title = `SAVE-FAILED ${err.message}`;
      }
    };

    if (actx) {
      await actx.resume();
      startAudio();
    }
    console.log('[intro] rec init', JSON.stringify({
      mime, silent, clock: silent ? 'performance' : 'audio',
      vTracks: mixed.getVideoTracks().length,
      aTracks: mixed.getAudioTracks().length,
    }));
    recorder.start(1000);
    requestAnimationFrame(count);
    const runFor = q.has('dur') ? Math.max(2, parseFloat(q.get('dur')) || 8) : tl.total + 0.8;
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, runFor * 1000);
    document.title = `REC ${mime} ${tl.total}s`;
  }

  return {
    display,
    total: tl.total,
    time,
    sample,
    afterRender,
    record,
    ready: true,
  };
}
