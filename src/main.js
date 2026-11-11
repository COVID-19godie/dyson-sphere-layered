import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

import { CFG } from './config.js';
import {
  GRADE_SHADER, FINAL_SHADER, DOF_SHADER, GODRAYS_SHADER, GODRAYS_COMP_SHADER,
  LUM_SHADER, ADAPT_SHADER,
} from './shaders.js';
import { makeStar, makeShell, makeStarfield, makePlanet } from './objects.js';
import { makeElevator } from './elevator.js';
import { makeTraffic } from './traffic.js';
import { PhysicalBloomPass } from './cinema/bloom.js';
import { MotionBlurPass } from './cinema/motionblur.js';
import { createParams, createPanel } from './panel.js';
import { makeGroundProps } from './groundprops.js';
import { SourcePass } from './cinema/passes.js';
import { lensFov } from './cinema/lens.js';
import { SEQUENCE } from './cinema/sequence.js';
import { sampleSequence, driveShot, totalDuration } from './cinema/shot.js';
import './style.css';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// OutputPass 每帧会比对 renderer.toneMapping 并重建 defines，所以可以实时切。
// 默认保持 ACES：本场景所有预设都是按 ACES 调的，直接换 AgX 会让暗部去饱和。
const TONE_MAPS = {
  ACES: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

const TARGET_ASPECT = 2.39;   // 变形宽银幕

// 大气透视的散射色：冷（星际尘埃）↔ 暖（恒星侧向散射），由 hazeWarm 插值。
// 数值必须按线性 HDR 给 —— 这两个值在 ACES 后大约是 #2a3440 / #3a2a1c 的雾。
const HAZE_COLD = new THREE.Color(0.020, 0.030, 0.046);
const HAZE_WARM = new THREE.Color(0.078, 0.049, 0.026);
const hazeColor = new THREE.Color();

/* ------------------------------------------------------------ 渲染器 / 相机 */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  // 原型阶段关闭对数深度，理由见 config.js 的 USE_LOG_DEPTH 注释
  logarithmicDepthBuffer: false,
});
renderer.setClearColor(0x05070c, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.camera.fov, 1, 0.05, 400);
camera.position.set(...CFG.camera.start);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.enableZoom = false;       // 用下面的对数 dolly
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.target.set(0, 0, 0);

// 对数缩放：远近通吃，近处不会一下滑走
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (film) return;                // 电影模式下镜头归分镜脚本管
  const f = Math.exp(e.deltaY * 0.0011);
  const off = camera.position.clone().sub(controls.target);
  const len = clamp(off.length() * f, CFG.camera.minDist, CFG.camera.maxDist);
  camera.position.copy(controls.target).add(off.setLength(len));
}, { passive: false });

/* --------------------------------------------------------------- 后期链 */

/**
 * 场景单独渲到这条 RT，并且**挂着深度纹理**。
 *
 * 关键：不要把 depthTexture 挂到 composer 自己的 RT 上。composer 每帧在
 * renderTarget1 / 2 之间来回写，写之前 clear() 会连 DEPTH_BUFFER_BIT 一起清，
 * 后面 DOF / 体积光 / 大气透视读到的深度就是一片空白（表现为景深完全失效
 * 或整屏糊成一块）。独立 RT 的深度永远有效，也不受 pass 数量奇偶的影响。
 *
 * 代价是多一次全屏 blit（SourcePass），换来整条链的确定性。
 */
const rtScene = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,                                          // 深度的 MSAA resolve 由 three 的 blit 完成
  depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
});

const hdrTarget = (extra) => new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  depthBuffer: false,
  ...extra,
});

const rtRays = hdrTarget();                                   // 体积光，半分辨率
const rtLum = hdrTarget();                                    // 亮度测量的中间缓冲
const NEAREST = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
const rtExpA = hdrTarget(NEAREST);                            // 曝光适应 ping-pong
const rtExpB = hdrTarget(NEAREST);

const composer = new EffectComposer(renderer, hdrTarget());
composer.addPass(new SourcePass(rtScene.texture));

const raysComp = new ShaderPass(GODRAYS_COMP_SHADER);
composer.addPass(raysComp);

// 物理 bloom：5 级 mip + Karis average，替换 UnrealBloomPass（理由见 cinema/bloom.js）
const bloom = new PhysicalBloomPass();
composer.addPass(bloom);

// 相机运动模糊：深度反投影 + 上一帧重投影算屏幕速度。放在 bloom 之后、DOF 之前
// （理由见 cinema/motionblur.js）。定帧时相机不动 → 速度 0 → 自动跳过。
const motionBlur = new MotionBlurPass(rtScene.depthTexture);
composer.addPass(motionBlur);
let prevViewProj = new THREE.Matrix4();
let prevViewReady = false;

const dof = new ShaderPass(DOF_SHADER);
composer.addPass(dof);

const grade = new ShaderPass(GRADE_SHADER);
composer.addPass(grade);
composer.addPass(new OutputPass());
// 分级 / 暗角 / 颗粒 / dither / 遮幅 跑在 tonemap 之后（显示空间），必须是最后一个 pass
const finalPass = new ShaderPass(FINAL_SHADER);
composer.addPass(finalPass);
// ?nofinal=1 直接跳过收尾 pass，用于定帧排查「收尾是否改变了画面」
if (new URLSearchParams(location.search).get('nofinal') === '1') finalPass.enabled = false;
// ?nobloom=1 同理。不能靠 ?p.bloom=0：film 模式下 driveShot 每帧拿 state 覆盖
// params.bloom，覆盖值会被立刻冲掉，A/B 出来的两张图一模一样（踩过）。
if (new URLSearchParams(location.search).get('nobloom') === '1') bloom.enabled = false;

// 三块离屏材质：体积光 / 亮度测量 / 曝光平滑
const quadMat = (shader) => new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(shader.uniforms),
  vertexShader: shader.vertexShader,
  fragmentShader: shader.fragmentShader,
  depthTest: false,
  depthWrite: false,
});

const raysMat = quadMat(GODRAYS_SHADER);
const lumMat = quadMat(LUM_SHADER);
const adaptMat = quadMat(ADAPT_SHADER);

const raysQuad = new FullScreenQuad(raysMat);
const lumQuad = new FullScreenQuad(lumMat);
const adaptQuad = new FullScreenQuad(adaptMat);

raysMat.uniforms.tDiffuse.value = rtScene.texture;
raysMat.uniforms.tDepth.value = rtScene.depthTexture;
lumMat.uniforms.tDiffuse.value = rtScene.texture;
adaptMat.uniforms.tLum.value = rtLum.texture;
raysComp.uniforms.tRays.value = rtRays.texture;
dof.uniforms.tDepth.value = rtScene.depthTexture;
grade.uniforms.tDepth.value = rtScene.depthTexture;

function renderQuad(quad, target) {
  renderer.setRenderTarget(target);
  quad.render(renderer);
}

// 曝光适应从「已经适应到 1.0」开始，否则前几帧会从全黑慢慢往上爬
let expSrc = rtExpA;
let expDst = rtExpB;
{
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  for (const rt of [rtExpA, rtExpB]) {
    renderer.setRenderTarget(rt);
    renderer.clear(true, false, false);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);
}

/* --------------------------------------------------------------- 场景对象 */

const materials = [];
const star = makeStar(scene, materials);
const shell = makeShell(scene, materials);
const starfield = makeStarfield(scene, materials);
const planet = makePlanet(scene, materials);
// 电梯用行星局部坐标，挂在 planet.group 下，跟着 showPlanet 一起显隐
const elevator = makeElevator(planet.group, materials);
// S1 的地面道具（岩脊/碎石/陨坑/设备）挂在行星组下，随行星一起移动
const groundProps = makeGroundProps(planet.group);
const traffic = makeTraffic(scene, materials);

/* --------------------------------------------------------------- 参数面板 */

const params = createParams();
let activeView = null;
let tween = null;
let refreshTick = 0;
let panel = null;

let film = false;          // 是否在播分镜序列
let filmFrozen = -1;       // >= 0 时锁死该镜头（?film=S3 定帧）
let filmAt = 0.55;         // 定帧位置（?film=S4@0.02 取切点刚过的第一帧）
let fadeValue = 1;         // 片头淡入 / 片尾淡出系数，写进收尾 pass 的 uFade
let filmStart = 0;
let filmFocus = 10;
let lastShotId = null;
let shotLabel = '';

function startFilm(lockId, at = 0.55) {
  film = true;
  const idx = lockId ? SEQUENCE.findIndex((s) => s.id === lockId) : -1;
  filmFrozen = idx;
  filmAt = at;
  filmStart = performance.now();
  lastShotId = null;
  tween = null;
  controls.enabled = false;
  params.autoRotate = false;
  params.letterbox = true;
  if (params.dof < 0.35) params.dof = 0.42;
  document.body.classList.add('cinema');
  panel?.refresh();
}

panel = createPanel(params, {
  replay() {
    params.assemble = 0; params.explode = 0; params.cut = 0;
    tween = { type: 'replay', t0: performance.now(), dur: 4200 };
    panel.refresh();
  },
  demo() {
    params.assemble = 1;
    tween = { type: 'demo', t0: performance.now(), dur: 3400 };
    panel.refresh();
  },
  film() { startFilm(); },
  onPreset() { tween = null; },
});

/* --------------------------------------------------------------- 尺寸 / DPR */

let pixelRatio = 1;

// ?capw=1920&caph=1080 强制渲染缓冲区的像素尺寸，忽略窗口。
// 无头 Chrome 的 innerHeight 比 --window-size 少 87px（新 profile 再少 56px 的
// 提示条），靠窗口尺寸去凑 1080 很脆。录制必须和定帧同一尺寸：
// 1920×1080 下 2.39:1 的遮幅正好是上下各 138px，和 preview/ 里所有定帧一致。
const capW = parseInt(new URLSearchParams(location.search).get('capw') || '0', 10);
const capH = parseInt(new URLSearchParams(location.search).get('caph') || '0', 10);

function resize() {
  const w = capW || window.innerWidth;
  const h = capH || window.innerHeight;
  pixelRatio = capW ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const rw = Math.max(1, Math.floor(w * pixelRatio));
  const rh = Math.max(1, Math.floor(h * pixelRatio));
  rtScene.setSize(rw, rh);
  rtRays.setSize(Math.max(1, rw >> 1), Math.max(1, rh >> 1));
  rtLum.setSize(8, 8);

  // 弥散圆单位是渲染像素：换分辨率时要跟着缩放，否则 4K 上景深看起来变浅
  dof.uniforms.uMaxBlur.value = 9.0 * (rh / 1080);
}
window.addEventListener('resize', resize);
resize();

/* --------------------------------------------------------------- 恒星投影 */

// 屏幕空间里恒星的位置，供体积光和解算 anamorphic 用
const SUN_CENTER = new THREE.Vector3(0, 0, 0);
const _ndc = new THREE.Vector3();
const _toSun = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const sunUV = new THREE.Vector2(0.5, 0.5);
let sunVisible = 0;
let sunDepth = 10;

function projectSun() {
  _ndc.copy(SUN_CENTER).project(camera);
  sunUV.set(_ndc.x * 0.5 + 0.5, _ndc.y * 0.5 + 0.5);

  camera.getWorldDirection(_fwd);
  _toSun.copy(SUN_CENTER).sub(camera.position);
  const d = _toSun.length();
  _toSun.multiplyScalar(1 / Math.max(d, 1e-4));
  const facing = _fwd.dot(_toSun);
  // 沿视线方向的深度（不是欧氏距离）：遮幅 / 景深都是按视深度算的
  sunDepth = Math.max(0.05, d * facing);

  const off = Math.max(Math.abs(_ndc.x), Math.abs(_ndc.y));
  // 画外淡出 + 背后剔除，避免光柱在出画瞬间「啪」地消失
  sunVisible = (1 - smoothstep(0.92, 1.45, off)) * smoothstep(-0.30, 0.10, facing);
}

/* --------------------------------------------------------------- 分镜驱动 */

function updateFilm(now) {
  const time = filmFrozen >= 0 ? 0 : (now - filmStart) / 1000;
  const s = sampleSequence(SEQUENCE, time, filmFrozen, filmAt);
  const shot = s.shot;

  if (shot.id !== lastShotId) {
    lastShotId = shot.id;
    shotLabel = `${shot.id} · ${shot.name}`;
    star.setGroundMode(!!shot.ground);
    activeView = shot.ground ? 'ground' : 'film';
    panel.refresh();
  }

  const out = driveShot(camera, shot, s.u, filmFrozen >= 0 ? 0 : time, {
    shake: params.shake,
    breath: params.breath,
  });
  filmFocus = out.focus;
  params.exposure = out.exposure;
  for (const k in out.state) if (k in params) params[k] = out.state[k];

  // 片头淡入 / 片尾淡出。序列是 modulo 循环的，S6 结尾若硬切回 S1，
  // 一个环绕镜会直接跳成地面日出 —— 中间必须留一段黑。
  // 定帧（?film=S3）不参与，否则所有定帧都会被压暗。
  if (filmFrozen >= 0) {
    fadeValue = 1;
  } else {
    const t = ((time % s.total) + s.total) % s.total;
    fadeValue = Math.min(
      smoothstep(0.0, 1.6, t),                        // S1 开头 1.6s 淡入
      1 - smoothstep(s.total - 2.2, s.total, t),      // S6 结尾 2.2s 淡出
    );
  }
}

/* --------------------------------------------------------------- 时间线 */

function updateTimeline(now) {
  if (!tween) return;
  const p = clamp((now - tween.t0) / tween.dur, 0, 1);
  if (tween.type === 'replay') {
    params.assemble = ease(clamp(p / 0.76, 0, 1));
    params.explode = p > 0.76 ? Math.sin(((p - 0.76) / 0.24) * Math.PI) * 0.26 : 0;
    params.cut = 0;
  } else {
    params.assemble = 1;
    params.explode = ease(clamp(p / 0.62, 0, 1)) * 0.86;
    params.cut = ease(clamp((p - 0.20) / 0.62, 0, 1)) * 0.62;
  }
  if (++refreshTick % 5 === 0) panel.refresh();
  if (p >= 1) { tween = null; panel.refresh(); }
}

const badge = document.getElementById('badge-text');
function updateBadge() {
  let s;
  if (film && shotLabel) {
    s = shotLabel;
  } else {
    s = '合拢态 · 完整球';
    if (activeView === 'ground') s = '地表 · 第一幕';
    else if (activeView === 'star') s = '恒星表面 · 特写';
    else if (activeView === 'plate') s = '装甲板 · 近景';
    else if (activeView === 'planet') s = '行星 · 轨道视角';
    else if (activeView === 'elevator') s = '太空电梯 · 第二幕';
    else if (!params.armor && !params.truss && !params.collector) s = '恒星表面 · 特写';
    else if (params.explode > 0.12) s = '分层态 · 三层展开';
    else if (params.cut > 0.03) s = '剖切态 · 内部可见';
  }
  if (badge.textContent !== s) badge.textContent = s;
}

/* --------------------------------------------------------------- 主循环 */

const clock = new THREE.Clock();
let frames = 0;
let lastT = 0;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const t = clock.getElapsedTime();
  const dt = Math.min(t - lastT, 0.05);
  lastT = t;

  updateTimeline(now);
  if (film) updateFilm(now);
  updateBadge();

  // 动态 near/far；贴地视角离地面只有 0.012，near 要单独压到 0.001
  const dist = camera.position.length();
  camera.near = activeView === 'ground' ? 0.001 : clamp(dist * 0.002, 0.01, 0.5);
  camera.far = Math.max(dist * 12, 400);
  if (!film) camera.fov = lensFov(params.lens)[0];
  camera.updateProjectionMatrix();

  if (film) {
    // 相机已由 driveShot 写好，这里不能再动，否则会和手持抖动打架
  } else if (controls.enabled) {
    controls.autoRotate = params.autoRotate && !tween;
    controls.autoRotateSpeed = params.rotate;
    controls.update();
  } else {
    camera.lookAt(controls.target);
  }

  starfield.follow(camera);
  for (const m of materials) {
    if (m.uniforms.uTime) m.uniforms.uTime.value = t;
    if (m.uniforms.uPixelRatio) m.uniforms.uPixelRatio.value = pixelRatio;
  }

  star.setIntensity(params.starIntensity);
  star.setDetail(params);
  planet.setDetail(params, activeView === 'ground');
  // 地面道具只在贴地视角出现：轨道视角下它们连一个像素都占不到，
  // 反而可能被 bloom 采样成脏点
  groundProps.setVisible(params.groundDetail > 0.5);
  planet.update(t, dt, params, camera);
  planet.group.visible = params.showPlanet;
  // ground / planet 都是贴着行星的近景，站点与配重会放大成色块，只留缆线
  elevator.setDetail(params, activeView === 'ground' || activeView === 'planet');
  elevator.update(t, dt, params);

  shell.update({
    assemble: params.assemble,
    explode: params.explode,
    cut: params.cut,
    seamWidth: params.seamWidth,
    fresnel: params.fresnel,
    plateDetail: params.plateDetail,
    layerVisible: { collector: params.collector, truss: params.truss, armor: params.armor },
    dt,
    spin: params.shellSpin,
    workLights: params.workLights,
  });
  traffic.update(t, dt, params);

  projectSun();

  /* ---- 统一后期参数 ---- */

  bloom.downMat.uniforms.uThreshold.value = params.threshold;
  bloom.downMat.uniforms.uKnee.value = 0.35;
  // bloom / scatter 拆成两个旋钮：mip 级数决定「范围」，这个只决定「强度」。
  // 系数压到 0.18 是因为金字塔本身已经把 5 级能量累加过了 ——
  // 和 UnrealBloomPass 的 strength 不是一个量纲，不能照搬 0.62。
  // 金字塔已经把 5 级能量累加过一遍，系数是「叠加量」不是「强度」。
  // 实测标定：系数 0.4 时恒星边缘只有 1~2 个灰阶的贡献，肉眼完全看不出；
  // 硬编码 5.0 才会核心过曝。3.0 落在「高光真的溢出去、但不洗掉明暗层次」。
  bloom.compMat.uniforms.uScatter.value = params.bloom * 3.0;
  renderer.toneMapping = TONE_MAPS[params.toneMapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = params.exposure;

  // 景深：自由视角对焦在环绕中心上，电影模式跟分镜的 focus 走
  const focus = film ? filmFocus : camera.position.distanceTo(controls.target);
  dof.uniforms.uEnabled.value = params.dof > 0.02 ? 1 : 0;
  dof.uniforms.uFocus.value = focus;
  dof.uniforms.uAperture.value = 0.30 + params.dof * 1.05;
  dof.uniforms.uNear.value = camera.near;
  dof.uniforms.uFar.value = camera.far;

  // 体积光
  const godrays = params.godrays * sunVisible;
  raysMat.uniforms.uSunUV.value.copy(sunUV);
  raysMat.uniforms.uVisible.value = godrays;
  raysMat.uniforms.uNear.value = camera.near;
  raysMat.uniforms.uFar.value = camera.far;

  // 曝光适应速率按 dt 归一，否则掉帧时会闪
  adaptMat.uniforms.uRate.value = 1 - Math.exp(-dt / 0.85);

  grade.uniforms.uAberration.value = params.aberration;
  grade.uniforms.uHalation.value = params.halation;
  grade.uniforms.uHaloRadius.value = params.haloRadius;
  grade.uniforms.uSharp.value = params.sharp;
  grade.uniforms.uNear.value = camera.near;
  grade.uniforms.uFar.value = camera.far;
  grade.uniforms.uHaze.value = params.haze;
  grade.uniforms.uHazeStart.value = params.hazeStart;
  grade.uniforms.uHazeFall.value = params.hazeFall;
  grade.uniforms.uHazeColor.value.copy(hazeColor.copy(HAZE_COLD).lerp(HAZE_WARM, params.hazeWarm));
  grade.uniforms.uSunUV.value.copy(sunUV);
  grade.uniforms.uSunVisible.value = sunVisible;
  grade.uniforms.uSunDepth.value = sunDepth;
  grade.uniforms.uFlare.value = params.flare;
  grade.uniforms.uAutoExposure.value = params.autoExposure;

  // 显示空间收尾：分级 / 暗角 / 颗粒 / dither / 遮幅
  finalPass.uniforms.uTime.value = t;
  finalPass.uniforms.uGrain.value = params.grain;
  finalPass.uniforms.uDither.value = params.dither;
  finalPass.uniforms.uVignette.value = params.vignette;
  finalPass.uniforms.uGrade.value = params.grade;
  finalPass.uniforms.uSat.value = params.sat;
  finalPass.uniforms.uLetterboxBar.value = params.letterbox
    ? Math.max(0, (1 - camera.aspect / TARGET_ASPECT) * 0.5)
    : 0;
  finalPass.uniforms.uFade.value = fadeOverride ?? (film ? fadeValue : 1);

  /* ---- 出图 ---- */

  // 运动模糊：拿**上一帧**的 viewProj 做重投影，所以必须先把当前帧矩阵更新出来，
  // 本轮算完再把它存成"上一帧"。第一帧没有参照，直接禁用。
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const viewProj = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  motionBlur.enabled = prevViewReady && params.motionBlur > 0.001;
  if (motionBlur.enabled) {
    motionBlur.uniforms.uInvViewProj.value.copy(viewProj).invert();
    motionBlur.uniforms.uPrevViewProj.value.copy(prevViewProj);
    motionBlur.uniforms.uScale.value = params.motionBlur;
    motionBlur.uniforms.uFake.value = fakeMotionBlur;
  }

  // 1) 场景（带深度、带 MSAA）
  renderer.setRenderTarget(rtScene);
  renderer.render(scene, camera);
  prevViewProj.copy(viewProj);
  prevViewReady = true;

  // 2) 亮度测量 + 时间平滑（1×1 ping-pong）
  renderQuad(lumQuad, rtLum);
  adaptMat.uniforms.tPrev.value = expSrc.texture;
  renderQuad(adaptQuad, expDst);
  grade.uniforms.tExposure.value = expDst.texture;
  const swap = expSrc; expSrc = expDst; expDst = swap;

  // 3) 体积光（半分辨率；关闭时直接叠 0，省掉一次全屏 march）
  const raysOn = godrays > 0.001;
  if (raysOn) renderQuad(raysQuad, rtRays);
  raysComp.uniforms.uStrength.value = raysOn ? 1.0 : 0.0;

  // 4) 拷贝 → 体积光叠加 → bloom → 景深 → 调色 → 输出
  composer.render();

  if (++frames === 2) {
    document.getElementById('loading').classList.add('hidden');
  }
}

/* --------------------------------------------------------------- 启动 */

window.addEventListener('error', (e) => {
  const el = document.getElementById('loading');
  if (el && frames < 2) {
    el.classList.remove('hidden');
    el.innerHTML = `<div class="l-inner">初始化失败：${e.message}</div>`;
  }
});

try {
  renderer.compile(scene, camera);   // 在加载幕布后预编译，避免首帧卡顿
} catch (err) {
  console.warn('[dyson] compile skipped:', err);
}

// URL 可直接指定状态，方便对比定帧：?explode=0.8&cut=0.6&assemble=1&noopen=1
const q = new URLSearchParams(location.search);
// ?mbfake=0.02 给运动模糊塞一个固定假速度。定帧截图时相机静止、速度恒为 0，
// 否则根本没法确认采样方向、拖影长度是否对。
const fakeMotionBlur = parseFloat(q.get('mbfake') || '0') || 0;
// 定帧截图专用：加载幕布有 0.8s 淡出，headless 抓帧容易截到半透明状态，
// 整张图（含 HUD）会被压暗。shot=1 直接撤掉幕布，保证对比图亮度一致。
if (q.get('shot') === '1') document.getElementById('loading').style.display = 'none';
// ?fade=0.4 覆盖 uFade，用来定帧检查淡入淡出（定帧模式下 uFade 恒为 1）
const fadeOverride = q.has('fade') ? clamp(parseFloat(q.get('fade')) || 0, 0, 1) : null;
const hasOverride = ['explode', 'cut', 'assemble'].some((k) => q.has(k));
const specialView = q.get('view');
activeView = specialView;
// ?view=star 单独看恒星表面：拉近距离、隐藏三层壳与行星、压 bloom
if (specialView === 'star') {
  camera.position.set(2.05, 0.78, 2.35);
  params.collector = params.truss = params.armor = false;
  params.showPlanet = false;
  params.autoRotate = false;
  params.bloom = 0.42;
  params.threshold = 0.90;
  params.dof = 0;                    // 检视视角不要景深，细节要被看穿
  tween = null;
  panel.refresh();
}
// ?view=plate 贴近装甲层，检查瓦片的倒角 / 磨损 / 铆点
if (specialView === 'plate') {
  camera.position.set(9.6, 1.6, 2.4);
  params.autoRotate = false;
  params.explode = 0;
  params.cut = 0;
  params.assemble = 1;
  params.dof = 0;
  tween = null;
  panel.refresh();
}
// ?view=planet 从轨道看行星全貌，检查云层 / 大气 / 夜面城市灯
if (specialView === 'planet') {
  camera.position.set(0.62, 0.28, 3.25);
  controls.target.set(0, 0, CFG.planet.orbit);
  controls.enabled = false;
  camera.lookAt(controls.target);
  params.collector = params.truss = params.armor = false;
  params.showPlanet = true;
  params.autoRotate = false;
  params.explode = 0;
  params.cut = 0;
  params.assemble = 1;
  params.dof = 0;
  tween = null;
  panel.refresh();
}
// ?view=elevator 第二幕：从斜后方看整条编织缆线，恒星当背景光轮，电梯成剪影
if (specialView === 'elevator') {
  camera.position.set(2.15, 0.62, 3.55);
  controls.target.set(0.82, 0.0, CFG.planet.orbit);
  controls.enabled = false;
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  params.collector = params.truss = params.armor = false;
  params.showPlanet = true;
  params.autoRotate = false;
  params.explode = 0;
  params.cut = 0;
  params.assemble = 1;
  // 恒星角直径约 27°，去掉光晕精灵与磁力线弧，只留盘面当背景光源
  star.setGroundMode(true);
  params.starIntensity = 2.0;
  params.corona = 0.20;
  params.prominence = 0.18;
  params.bloom = 0.42;
  params.threshold = 0.88;
  params.exposure = 1.02;
  // 发光收敛，优先让编织结构与舱体可读
  params.pulseStrength = 0.90;
  params.climberCount = 20;
  tween = null;
  panel.refresh();
}
// ?view=ground 第一幕：相机在晨昏线附近的地表，up 取行星径向，恒星正从地平线升起
if (specialView === 'ground') {
  // 稍微朝 -Y 偏一点视线：恒星落到左三分点，塔基留在右侧
  camera.position.set(0.362, 0.055, 2.68);
  camera.up.set(1, 0, 0);
  controls.target.set(0.392, -0.05, 0.0);
  controls.enabled = false;
  camera.lookAt(controls.target);
  params.collector = params.truss = params.armor = false;
  params.showPlanet = true;
  params.autoRotate = false;
  params.groundDetail = 1;
  // 同上：地面道具贴在严格的球面 R 上，顶点位移会把它们埋掉
  params.relief = 0;
  params.explode = 0;
  params.cut = 0;
  params.assemble = 1;
  params.bloom = 0.62;
  params.threshold = 0.82;
  params.exposure = 1.05;
  params.corona = 0.22;
  params.prominence = 0.30;
  params.dof = 0;
  star.setGroundMode(true);
  tween = null;
  panel.refresh();
}
// 通用参数覆盖：?p.bloom=0&p.grade=0 —— 定帧对比单项效果时比改代码快得多
for (const [k, v] of q) {
  if (!k.startsWith('p.')) continue;
  const key = k.slice(2);
  if (!(key in params)) continue;
  const n = parseFloat(v);
  params[key] = Number.isFinite(n) ? n : v;
}
// ?tm=AgX / Neutral 方便定帧做色调映射 A/B 对比
if (q.get('tm') in TONE_MAPS) {
  params.toneMapping = q.get('tm');
  panel.refresh();
}
// ?film=1 连续播放全片；?film=S3 把第 3 个镜头锁在 55% 处定帧；
// ?film=S4@0.02 锁在 2% 处 —— 用来验证切点前后机位是否连续
const filmParam = q.get('film');
if (filmParam) {
  if (filmParam === '1') startFilm('');
  else {
    const [id, at] = filmParam.toUpperCase().split('@');
    startFilm(id, at != null ? parseFloat(at) : 0.55);
  }
}
if (specialView && film) {
  console.warn('[dyson] view 与 film 同时指定时以后者为准');
}

if (hasOverride && !film) {
  for (const k of ['explode', 'cut', 'assemble']) {
    if (q.has(k)) {
      const v = parseFloat(q.get(k));
      if (Number.isFinite(v)) params[k] = clamp(v, 0, 1);
    }
  }
  tween = null;
} else if (!specialView && !film) {
  // 首次进入播开场：先立住「一个球」，再用 explode 回弹暗示它可以打开
  params.assemble = 0;
  tween = { type: 'replay', t0: performance.now(), dur: 4200 };
}
/* ------------------------------------------------------- 视频导出（录制） */

// ?rec=1 用浏览器自带的 MediaRecorder 把整条分镜录一遍。
// 不引入 ffmpeg，也不引入任何浏览器自动化依赖：编码在页面内完成，
// 成品经一次 POST 落到 tools/recv.mjs（同源，不碰 headless 的下载目录）。
// 录制是实时的 —— MediaRecorder 的时间戳来自墙钟，所以成片帧率 = 这台机器
// 实际跑出来的渲染帧率。页面把渲染帧数一并报给接收器，方便判断是否掉帧严重。
function startRecording(streamFps) {
  document.getElementById('loading').style.display = 'none';

  const mimes = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mime = mimes.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) {
    console.error('[rec] 该浏览器不支持 MediaRecorder');
    document.title = 'REC-UNSUPPORTED';
    return;
  }

  const chunks = [];
  const rec = new MediaRecorder(canvas.captureStream(streamFps), {
    mimeType: mime,
    videoBitsPerSecond: 24e6,
  });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  let rendered = 0;
  const count = () => { rendered++; requestAnimationFrame(count); };

  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    try {
      const r = await fetch(`/save?name=dyson-film.${ext}&frames=${rendered}`, {
        method: 'POST', body: blob,
      });
      document.title = `SAVED ${r.status} · ${rendered}f · ${(blob.size / 1048576).toFixed(1)}MB`;
    } catch (err) {
      console.error('[rec] 落盘失败', err);
      document.title = `SAVE-FAILED ${err.message}`;
    }
  };

  // 先空跑几帧：composer 的 FBO、各 pass 的 program 都是在第一次真正渲染时
  // 才分配的，头一两帧可能几百毫秒。不预热的话片头会被压成一张静止帧。
  const total = totalDuration(SEQUENCE);
  let warm = 0;
  const begin = () => {
    if (++warm < 6) { requestAnimationFrame(begin); return; }
    startFilm('');
    // 再等一帧，确保录制起点落在分镜的第一帧上，而不是预热时的默认视角
    requestAnimationFrame(() => {
      console.log(`[rec] mime=${mime} streamFps=${streamFps} dur=${total}s`);
      rec.start(1000);
      requestAnimationFrame(count);
      // 多留 1.2s：片尾淡出到全黑之后才停，别切掉最后一帧
      setTimeout(() => rec.stop(), (total + 1.2) * 1000);
    });
  };
  requestAnimationFrame(begin);
}

const recParam = q.get('rec');
if (recParam) startRecording(parseInt(recParam, 10) || 30);

frame();
