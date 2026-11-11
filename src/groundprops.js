import * as THREE from 'three';
import { CFG } from './config.js';
import { litMat } from './litmat.js';
import { SEQUENCE } from './cinema/sequence.js';
import { driveShot } from './cinema/shot.js';

/**
 * S1（地表日出）的前景道具：岩脊 / 碎石 / 陨坑 / 设备。
 *
 * 为什么之前地面是一整片光滑斜坡、加多少着色器频率都没用：
 * S1 的机位站在**晨昏线的暗侧**，暗部里 albedo 是唯一的信息源，
 * 而画面里没有任何**几何体**可以产生轮廓。着色器只能给"面"加减法，给不出"边"。
 *
 * 1. 视觉逻辑是**逆光剪影**。相机朝恒星看，物体在相机与太阳之间，
 *    我们看到的是它们的背光面 —— 材质把自发光和环境压到很低，
 *    靠 Fresnel 给一道掠射轮廓光。不要试图"照亮"它们，那样立刻假。
 *
 * 2. **摆位必须按屏幕算，不能按"离相机多远"想当然。** 这一条是踩出来的：
 *    第一版把碎石铺在 0.003~0.06，结果 771 个实例一个都不在画里 ——
 *    相机离地只有 0.045、俯角 3°，24mm 下地平线在 12.6° 下方，
 *    遮幅再把上下各裁掉 14%，于是**可见地面只有 arc 0.065~0.177 这么一条窄带**，
 *    再近的东西全部落在画幅下面（探针：arc 0.05 投到 py 1055，画幅底 942）。
 *    所以这里直接用 S1 的定帧相机做一次 project 筛选，
 *    落在画外的候选点直接丢弃重来，保证每个实例都真的看得见。
 *
 * 3. 陨坑不做凹陷（球面是不透明实体，挖不出洞），而是做**环形的隆起岩缘**：
 *    远处的坑，其远缘会剪影在明亮的地平线上 —— 这正是真实月球/火星照片的读法。
 *
 * 4. 随机数必须是**确定性**的（mulberry32 固定种子），否则同一镜头两次渲染不一致。
 */

const TAU = Math.PI * 2;
const R = CFG.planet.r;
const UP = new THREE.Vector3(0, 1, 0);
const ORBIT = new THREE.Vector3(0, 0, CFG.planet.orbit);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * S1 的定帧机位：既用来定切向基，也用来做画外剔除。
 * 直接跑一次 driveShot，而不是自己抄一份 from/to 的中点 ——
 * 手抄的那份和真实机位差着一个缓动曲线，离地高度能差 0.01（就是画面里的几度）。
 */
function s1Camera() {
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.001, 1000);
  driveShot(cam, SEQUENCE[0], 0.5, 0, { shake: 0, breath: 0 });
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

export function makeGroundProps(parent) {
  const cam = s1Camera();
  const P = cam.position.clone().sub(ORBIT);        // 相机在行星局部坐标
  const N = P.clone().normalize();                  // 天顶
  const D = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const F = D.clone().addScaledVector(N, -D.dot(N)).normalize();   // 切向前方
  const S = new THREE.Vector3().crossVectors(N, F).normalize();    // 切向侧方

  const h = P.length() - R;
  const horizon = Math.sqrt(2 * R * h);             // 地平线弧长（约 0.177）
  // 落在地平线以外的东西会被球体自身挡住，所以最远只到 97%
  const arcMax = horizon * 0.97;

  const rnd = mulberry32(0x5eed1a7);
  const group = new THREE.Group();
  group.visible = false;

  // 塔基（空间电梯锚点）在局部 (a, 0, 0)，道具要绕开它
  const tower = new THREE.Vector3(CFG.elevator.from, 0, 0);

  const _d = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  /** 沿切向走 arc 弧长、偏角 ang 的单位方向（行星局部） */
  function dirAt(arc, ang, out) {
    const th = arc / R;
    out.copy(N).multiplyScalar(Math.cos(th));
    out.addScaledVector(F, Math.sin(th) * Math.cos(ang));
    out.addScaledVector(S, Math.sin(th) * Math.sin(ang));
    return out.normalize();
  }

  /**
   * 画内判定：投影到 S1 的机位。遮幅（2.39）上下各裁掉一截，
   * 可见区 ndc.y ∈ ±0.744，留一点边距。
   */
  function onScreen(dir, margin = 0.05) {
    _w.copy(dir).multiplyScalar(R).add(ORBIT);
    _n.copy(_w).project(cam);
    return Math.abs(_n.x) < 1 - margin && Math.abs(_n.y) < 0.744 - margin;
  }

  /**
   * 一个实例的变换：+Y 朝向天顶，绕天顶随机自转，再给随机非均匀缩放。
   * 非均匀缩放是让石头读作"石头"而不是"球"的关键 —— 均匀缩放的二十面体
   * 永远是那个二十面体。
   * bury 固定为 0.34 * size，而 squash 都 > 0.45，所以永远有一截露在外面。
   */
  function compose(dir, size, squash, out) {
    _q.setFromUnitVectors(UP, dir);
    _q2.setFromAxisAngle(UP, rnd() * TAU);
    _q.multiply(_q2);
    _q2.setFromAxisAngle(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      (rnd() - 0.5) * 0.55);
    _q.multiply(_q2);
    _s.set(size * (0.7 + rnd() * 0.7), size * squash, size * (0.7 + rnd() * 0.7));
    _p.copy(dir).multiplyScalar(R - size * 0.34);
    out.compose(_p, _q, _s);
    return out;
  }

  /* ---------------------------------------------------------------- 岩石 */

  // 二十面体的 20 个面，棱角分明 —— 剪影里才像石头。细分一次就变成圆石头了。
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  // 边缘光给一个暖色而不是"本体色提亮"：石头本身接近黑，
  // 乘性边缘光只会得到黑纸片。真实的逆光石是轮廓上那一线被照亮的尘土。
  const rockMat = litMat(0x2b2620, 0.03, 0.05, 0.70, 0x6a4a2c);

  /**
   * 簇心：自然地面上的碎石是"一堆一堆"的，不是均匀撒胡椒面。
   * 先抽若干画内的簇心，实例再绕着簇心撒。
   */
  function centers(n, arcMin, arcMaxLocal, angMax, spread) {
    const out = [];
    for (let i = 0; i < n * 8 && out.length < n; i++) {
      const arc = arcMin + (arcMaxLocal - arcMin) * rnd();
      const ang = (rnd() * 2 - 1) * angMax;
      dirAt(arc, ang, _d);
      if (!onScreen(_d, 0.12)) continue;
      out.push({ arc, ang, spread });
    }
    return out;
  }

  /**
   * 一个批量散布的实例化网格。给了 centers 就绕簇心撒，否则整片随机。
   * 尺寸用「占屏比例」表达：k = size / 距离，落点远近不影响观感。
   */
  function batch(count, opts) {
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    const cs = opts.centers || null;
    let used = 0;
    for (let i = 0; i < count; i++) {
      let spot = null;
      for (let tryN = 0; tryN < 40 && !spot; tryN++) {
        let arc, ang;
        if (cs && cs.length) {
          const c = cs[(rnd() * cs.length) | 0];
          arc = c.arc + (rnd() - 0.5) * 2 * c.spread;
          ang = c.ang + (rnd() - 0.5) * 2 * (c.spread / Math.max(c.arc, 0.03));
        } else {
          arc = opts.arcMin + (opts.arcMax - opts.arcMin) * Math.pow(rnd(), opts.bias ?? 1);
          ang = (rnd() * 2 - 1) * opts.ang;
        }
        arc = Math.min(Math.max(arc, 0.04), arcMax);
        dirAt(arc, ang, _d);
        if (!onScreen(_d)) continue;
        _w.copy(_d).multiplyScalar(R);
        if (_w.distanceTo(tower) < (opts.clear ?? 0.030)) continue;
        spot = { dir: _d.clone(), arc };
      }
      if (!spot) continue;   // 抽不到就少一个，绝不硬塞到画外
      const k = opts.kMin + (opts.kMax - opts.kMin) * rnd();
      const size = spot.arc * k;
      compose(spot.dir, size, opts.sqMin + (opts.sqMax - opts.sqMin) * rnd(), _m);
      mesh.setMatrixAt(used++, _m);
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  }

  // 岩脊：顺着地平线切断天空。整个镜头里最"有地形"的一笔。
  // 注意 0.16 处只有 4 个像素行的高度 —— 远处的东西再大也读不出来，
  // 所以这里给到 0.06~0.15（0.16 处约 0.010~0.024 半径，2°~4° 高）。
  const ridges = batch(12, {
    arcMin: 0.125, arcMax: arcMax, ang: 0.58, bias: 0.8,
    kMin: 0.055, kMax: 0.150, sqMin: 0.30, sqMax: 0.52, clear: 0.045,
  });

  // 中景石块：成堆散落，中间留出大片空地
  const boulders = batch(110, {
    centers: centers(10, 0.072, 0.150, 0.62, 0.020),
    kMin: 0.012, kMax: 0.042, sqMin: 0.50, sqMax: 0.92,
  });

  // 近景碎石：画幅底部那条带是唯一有足够像素的地方，细节都压在这里
  const pebbles = batch(300, {
    centers: centers(10, 0.064, 0.115, 0.80, 0.014),
    kMin: 0.004, kMax: 0.011, sqMin: 0.60, sqMax: 0.95,
  });

  /* -------------------------------------------------------------- 陨石坑 */

  // 不做凹陷（球面不透明，挖不出洞），做环形隆起的岩缘。
  // 远处的坑，其远缘剪影在明亮的地平线上，不靠阴影也读得出是个坑。
  const CRATERS = [
    { arc: 0.120, ang: -0.36, rad: 0.011, n: 26 },
    { arc: 0.146, ang: 0.22, rad: 0.014, n: 30 },
    { arc: 0.158, ang: -0.06, rad: 0.008, n: 18 },
  ];
  const craterN = CRATERS.reduce((s, c) => s + c.n, 0);
  const craterMesh = new THREE.InstancedMesh(rockGeo, rockMat, craterN);
  let ci = 0;
  for (const c of CRATERS) {
    dirAt(c.arc, c.ang, _d);
    const cen = _d.clone();
    // 坑心处的切向基，用来把岩缘铺成一圈
    const f2 = new THREE.Vector3().copy(F).addScaledVector(cen, -F.dot(cen)).normalize();
    const s2 = new THREE.Vector3().crossVectors(cen, f2).normalize();
    for (let k = 0; k < c.n; k++) {
      const a = (k / c.n) * TAU;
      // 半径抖动让边缘不规则，但保持闭合
      const rr = c.rad * (0.88 + rnd() * 0.24);
      const dir = cen.clone()
        .multiplyScalar(Math.cos(rr / R))
        .addScaledVector(f2, Math.sin(rr / R) * Math.cos(a))
        .addScaledVector(s2, Math.sin(rr / R) * Math.sin(a))
        .normalize();
      const sz = c.rad * (0.14 + rnd() * 0.12);
      compose(dir, sz, 0.55 + rnd() * 0.45, _m);
      craterMesh.setMatrixAt(ci++, _m);
    }
  }
  craterMesh.count = ci;
  craterMesh.instanceMatrix.needsUpdate = true;
  craterMesh.frustumCulled = false;
  craterMesh.visible = false;
  group.add(craterMesh);

  /* ---------------------------------------------------------------- 设备 */

  // 桅杆 / 模块 / 缆索锚块。这些是**比例参照物** —— 有了它们，
  // 才知道那片地面有多大。顶部的小灯在剪影里是最有效的尺度线索。
  const metal = litMat(0x3a4048, 0.10, 0.07, 0.75);
  const metalDark = litMat(0x23272c, 0.05, 0.05, 0.60);
  const lampMat = litMat(0xffb264, 0.96, 0.9, 0.0);

  const place = (obj, arc, ang, bury, yaw) => {
    dirAt(arc, ang, _d);
    obj.position.copy(_d).multiplyScalar(R - bury);
    _q.setFromUnitVectors(UP, _d);
    _q2.setFromAxisAngle(UP, yaw);
    obj.quaternion.copy(_q).multiply(_q2);
    group.add(obj);
    return obj;
  };

  // 三根桅杆：越远越高，保持张角大致相同
  const MASTS = [
    { arc: 0.098, ang: 0.46, h: 0.0075 },
    { arc: 0.126, ang: -0.30, h: 0.0100 },
    { arc: 0.156, ang: 0.10, h: 0.0130 },
  ];
  for (const m of MASTS) {
    const mast = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(m.h * 0.045, m.h * 0.11, m.h, 5), metal);
    pole.position.y = m.h * 0.5;
    mast.add(pole);
    // 横臂 + 顶端小灯
    const arm = new THREE.Mesh(new THREE.BoxGeometry(m.h * 0.62, m.h * 0.035, m.h * 0.035), metal);
    arm.position.y = m.h * 0.86;
    mast.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(m.h * 0.055, 6, 4), lampMat);
    lamp.position.y = m.h * 1.02;
    mast.add(lamp);
    place(mast, m.arc, m.ang, m.h * 0.06, rnd() * TAU);
  }

  // 两个模块箱：矮胖的方块，稍微歪一点以免像摆件
  const MODULES = [
    { arc: 0.082, ang: -0.52, w: 0.0045 },
    { arc: 0.112, ang: 0.34, w: 0.0062 },
  ];
  for (const m of MODULES) {
    const box = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(m.w, m.w * 0.42, m.w * 0.78), metalDark);
    body.position.y = m.w * 0.21;
    box.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(m.w * 0.55, m.w * 0.16, m.w * 0.5), metal);
    cap.position.y = m.w * 0.48;
    box.add(cap);
    // 侧面的小窗，逆光时是暗面上少数的亮点
    const win = new THREE.Mesh(new THREE.BoxGeometry(m.w * 0.10, m.w * 0.05, m.w * 0.02), lampMat);
    win.position.set(0, m.w * 0.24, m.w * 0.40);
    box.add(win);
    place(box, m.arc, m.ang, m.w * 0.10, rnd() * TAU);
  }

  // 缆索锚块：六棱柱 + 三根斜撑，和远处的电梯塔呼应。靠右，往塔基那边伸
  {
    const anchor = new THREE.Group();
    const hh = 0.0052;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(hh * 0.55, hh * 0.8, hh, 6), metal);
    core.position.y = hh * 0.5;
    anchor.add(core);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(hh * 0.10, hh * 1.15, hh * 0.10), metalDark);
      strut.position.set(Math.cos(a) * hh * 0.75, hh * 0.5, Math.sin(a) * hh * 0.75);
      strut.rotation.z = Math.cos(a) * 0.35;
      strut.rotation.x = -Math.sin(a) * 0.35;
      anchor.add(strut);
    }
    place(anchor, 0.070, -0.62, hh * 0.08, rnd() * TAU);
  }

  const meshes = [ridges, boulders, pebbles, craterMesh];
  group.userData.meshes = meshes;

  parent.add(group);

  return {
    group,
    // 实际落进画面的实例数，方便定帧时从控制台确认
    instCount: meshes.reduce((s, m) => s + m.count, 0),
    setVisible(v) {
      group.visible = v;
      // InstancedMesh 的 visible 跟组走；单独置一次是为了 group 隐藏时省掉绘制
      for (const m of meshes) m.visible = v;
    },
  };
}
