import * as THREE from 'three';
import { lensFov } from './lens.js';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------ 缓动 */

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(t);
  };
}

export const EASE = {
  linear: (t) => t,
  inOut: cubicBezier(0.4, 0, 0.2, 1),
  out: cubicBezier(0.16, 1, 0.3, 1),
  in: cubicBezier(0.7, 0, 0.84, 0),
};

/* ------------------------------------------------------ 手持噪声 */

// 三个不同频率的正弦叠加：比随机数连续（不会逐帧跳），比 Perlin 便宜
function wobble(t, seed) {
  return (
    Math.sin(t * 0.31 * TAU + seed * 1.73) * 0.55 +
    Math.sin(t * 1.13 * TAU + seed * 3.11) * 0.30 +
    Math.sin(t * 4.37 * TAU + seed * 5.97) * 0.15
  );
}

/* ---------------------------------------------------------- 序列 */

export function totalDuration(seq) {
  return seq.reduce((s, x) => s + (x.dur || 0), 0);
}

export function shotIndexById(seq, id) {
  return seq.findIndex((s) => s.id === id);
}

/**
 * frozen >= 0 时锁定该镜头在 at 处（默认 55%），供 ?film=S3 定帧。
 * at 可指定是为了验证切点：S3 取 1.0、S4 取 0.0 应该得到同一机位。
 */
export function sampleSequence(seq, time, frozen = -1, at = 0.55) {
  const total = totalDuration(seq);
  if (frozen >= 0 && seq[frozen]) {
    const shot = seq[frozen];
    return {
      shot, prev: seq[Math.max(0, frozen - 1)],
      u: at, local: shot.dur * at, index: frozen, total,
    };
  }
  let t = total > 0 ? ((time % total) + total) % total : 0;
  let i = 0;
  while (i < seq.length - 1 && t >= seq[i].dur) { t -= seq[i].dur; i++; }
  const shot = seq[i];
  return {
    shot, prev: seq[Math.max(0, i - 1)],
    u: shot.dur > 0 ? t / shot.dur : 0, local: t, index: i, total,
  };
}

/* ------------------------------------------------------ 驱动相机 */

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mixState(a, b, k) {
  const out = {};
  for (const key of Object.keys(b)) {
    const va = a ? a[key] : undefined;
    const vb = b[key];
    if (typeof vb === 'number' && typeof va === 'number') out[key] = va + (vb - va) * k;
    else out[key] = k < 0.5 ? (va ?? vb) : vb;
  }
  return out;
}

/**
 * 把镜头在进度 u 处的状态写进 camera。
 * opts: { shake, breath, elapsed }
 * 返回 { focus, state, target } 供主循环消费。
 */
export function driveShot(cam, shot, u, elapsed, opts = {}) {
  const ease = (EASE[shot.ease || 'inOut'] || EASE.inOut)(u);
  const [fovA, fovB] = lensFov(shot.lens);
  const from = shot.from;
  const to = shot.to;

  _p.lerpVectors(from.pos, to.pos, ease);
  _t.lerpVectors(from.target, to.target, ease);

  // 环绕：把机位绕目标的竖直轴额外旋转 orbit 弧度。
  // 用独立的缓动（后段才起来），所以 u=0 时 orbit 恒为 0 —— 不会破坏
  // "from 接住上一镜落点" 的切点连续性。
  // 用途：S4 若一路正对孔轴后退，三层壳会被叠成一根管子，
  // 反向自转完全看不出来；绕开约 35° 才读得出三个同心环。
  const orbit = shot.orbit ?? 0;
  if (Math.abs(orbit) > 1e-6) {
    const a = orbit * smoothstep(0.10, 1.0, u);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = _p.x - _t.x, dz = _p.z - _t.z;
    _p.x = _t.x + dx * ca - dz * sa;
    _p.z = _t.z + dx * sa + dz * ca;
  }

  // 手持只抖位置、目标同步微移：产生轻微视差，而不是「镜头在转」
  const dist = _p.distanceTo(_t);
  const amp = dist * 0.0017 * (opts.shake ?? 0.5) * (shot.shake ?? 1) * (1 - 0.35 * u);
  if (amp > 1e-6) {
    _f.subVectors(_t, _p).normalize();
    _r.crossVectors(_f, cam.up).normalize();
    _u.crossVectors(_r, _f).normalize();
    const n1 = wobble(elapsed, 1.7);
    const n2 = wobble(elapsed, 4.3);
    _p.addScaledVector(_r, n1 * amp);
    _p.addScaledVector(_u, n2 * amp);
    _t.addScaledVector(_r, wobble(elapsed, 8.1) * amp * 0.25);
    _t.addScaledVector(_u, wobble(elapsed, 2.9) * amp * 0.25);
  }

  cam.position.copy(_p);
  if (shot.up) cam.up.set(shot.up[0], shot.up[1], shot.up[2]);
  cam.lookAt(_t);

  // 呼吸：焦段极轻微伸缩，让静止镜头不死板
  const breath = 1 + Math.sin((elapsed * TAU) / 4.2) * 0.0012 * (opts.breath ?? 1);
  const baseFov = fovA + (fovB - fovA) * ease;
  cam.fov = baseFov * breath;
  cam.updateProjectionMatrix();

  // 冲击：爆开 / 撞击的瞬间把镜头沿视线方向推开一下，指数衰减。
  // 只在这个镜头的前一秒有意义 —— 它是"切点之后那一下"，不是持续的推拉。
  // 起势用 1-e^(-26t)：约 2 帧到 35%、5 帧到 70%。
  // 不用瞬时满值 —— 那样切点处会有一帧的硬位移，读起来仍然像跳切（试过）。
  const impact = shot.impact ?? 0;
  if (impact > 1e-6) {
    const at = u * (shot.dur || 1);
    const k = impact * (1 - Math.exp(-at * 26)) * Math.exp(-at * 2.6);
    if (k > 1e-4) {
      _f.subVectors(_t, _p).normalize();
      _p.addScaledVector(_f, -k * dist * 0.055);
      _t.addScaledVector(_f, -k * dist * 0.020);
      cam.position.copy(_p);
      if (shot.up) cam.up.set(shot.up[0], shot.up[1], shot.up[2]);
      cam.lookAt(_t);
    }
  }

  const focus = (from.focus ?? 10) + ((to.focus ?? 10) - (from.focus ?? 10)) * ease;
  const exposure = (from.exposure ?? 1) + ((to.exposure ?? 1) - (from.exposure ?? 1)) * ease;

  // 镜头开头把参数从上一镜头过渡过来。
  // morph 是这个过渡占镜头总长的比例，**默认 0**：绝大多数切点是换主体
  // （巨构 → 恒星、恒星 → 全景），观众本来就预期画面不连续，硬切是正的；
  // 在这里做 2 秒 lerp 反而会出事 —— 相机已经到了 S5 的壳层内部，
  // 壳板还会在画面里赖着；布尔量（collector/armor）在 k=0.5 处整块弹出。
  // 只有明确要读作「同一镜头内持续」的镜头（S4）才给小值。
  const morph = shot.morph ?? 0;
  let state = shot.state || {};
  if (morph > 1e-6 && u < morph) {
    const prev = shot.prevState || (shot.prev && shot.prev.state) || state;
    state = mixState(prev, state, smoothstep(0, morph, u));
  }

  return { focus, exposure, state };
}
