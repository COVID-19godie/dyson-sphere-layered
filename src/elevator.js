import * as THREE from 'three';
import { CFG } from './config.js';
import { CABLE_VERT, CABLE_FRAG, CABLE_GLOW_FRAG, TRAIL_VERT, TRAIL_FRAG } from './shaders.js';
import { litMat } from './litmat.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const GOLDEN = 2.399963229728653;   // 让攀爬舱沿缆线径向错开，不排成一条直线

/**
 * 编织缆的几何：strands 股管沿 +X 螺旋缠绕，越往上越细。
 *
 * 顶点着色器（CABLE_VERT）不用 position，而是用自己的一套属性烘焙出管面：
 *   aX        沿轴的站位
 *   aHelixR   该站位上的螺旋半径（底部粗、顶部细，就是"锥形缆"）
 *   aPhase    这一股在螺旋上的相位（几股之间错开 2π/strands）
 *   aOff      截面圆上的偏移，着色器里既当位置偏移又当法线（normalize(aOff)）
 *   aT        0~1 的归一化轴向进度，用来做脉冲与大气的轴向分布
 * 所以这里只把属性填好，管面的实际形状交给 GPU 按 uRadiusScale 缩放。
 */
function buildCableGeometry({ a, b, radius, turns, strands, segs, radial }) {
  const len = b - a;
  const tubeR = radius * 0.30;        // 单股管径（螺旋半径之外再撑出这么多）
  const pos = [];
  const off = [];
  const ax = [];
  const helix = [];
  const phase = [];
  const tt = [];
  const index = [];

  for (let s = 0; s < strands; s++) {
    const ph = (s / strands) * Math.PI * 2;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = a + len * t;
      const hr = radius * (0.70 - 0.30 * t);   // 到顶收细 30%
      for (let k = 0; k < radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        pos.push(x, 0, 0);
        off.push(0, Math.cos(ang) * tubeR, Math.sin(ang) * tubeR);
        ax.push(x);
        helix.push(hr);
        phase.push(ph);
        tt.push(t);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < radial; k++) {
        const k2 = (k + 1) % radial;
        const r0 = base + i * radial;
        const r1 = base + (i + 1) * radial;
        index.push(r0 + k, r1 + k, r1 + k2);
        index.push(r0 + k, r1 + k2, r0 + k2);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
  geo.setAttribute('aX', new THREE.Float32BufferAttribute(ax, 1));
  geo.setAttribute('aHelixR', new THREE.Float32BufferAttribute(helix, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.userData.turns = turns;
  return geo;
}

function makeStation(ringR, isSync) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringR, isSync ? 0.006 : 0.0035, 6, 48),
    // 原来的 0x66c8e0 是纯青自发光，没有明暗，S2 里读作霓虹灯圈。
    // 压暗 + 去饱和成钢青色，剩下的亮度交给 N·L 和 bloom。
    litMat(isSync ? 0x4d94ab : 0x326376, 0.24),
  );
  ring.rotation.y = Math.PI / 2;
  g.add(ring);

  const spokeMat = litMat(0x35485a, 0.10);
  const spokeGeo = new THREE.BoxGeometry(0.002, ringR, 0.002);
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Mesh(spokeGeo, spokeMat);
    s.rotation.x = (k / 6) * Math.PI * 2;
    g.add(s);
  }

  const winGeo = new THREE.BoxGeometry(0.004, 0.006, 0.010);
  // 窗是灯，保留高自发光
  const winMat = litMat(0xc79a63, 0.78);
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const w = new THREE.Mesh(winGeo, winMat);
    w.position.set(0, Math.cos(ang) * ringR, Math.sin(ang) * ringR);
    g.add(w);
  }

  const panels = new THREE.Group();
  // 板底色调亮一档，N·L 才有可见的渐变（原来 0x1d3a52 太暗，明暗差看不出来）
  const panelMat = litMat(0x2a4f6a, 0.12);
  const panelGeo = new THREE.BoxGeometry(0.002, 0.030, 0.070);
  for (let k = 0; k < 2; k++) {
    const pnl = new THREE.Mesh(panelGeo, panelMat);
    pnl.position.set(0, (k ? 1 : -1) * ringR * 1.35, 0);
    panels.add(pnl);
  }
  g.add(panels);
  return { g, panels };
}

function makeCounterweight() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.012, 8, 64),
    litMat(0x43566a, 0.20),
  );
  ring.rotation.y = Math.PI / 2;
  g.add(ring);

  const panels = new THREE.Group();
  const panelMat = litMat(0x28455f, 0.12);
  const panelGeo = new THREE.BoxGeometry(0.003, 0.030, 0.075);
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const pnl = new THREE.Mesh(panelGeo, panelMat);
    pnl.position.set(0, Math.cos(ang) * 0.10, Math.sin(ang) * 0.10);
    pnl.rotation.x = ang;
    panels.add(pnl);
  }
  g.add(panels);
  return { g, panels };
}

/**
 * parent 是「相对行星中心」的行星组，缆线沿局部 +X 从地表向外。
 */
export function makeElevator(parent, materials) {
  const { from: a, to: b } = CFG.elevator;
  const len = b - a;
  const group = new THREE.Group();
  parent.add(group);

  const geo = buildCableGeometry({
    a, b, radius: 0.013, turns: 18, strands: 3, segs: 420, radial: 8,
  });

  const shared = {
    uTime: { value: 0 },
    uPulseSpeed: { value: 0.25 },
    uPulseStrength: { value: 1.0 },
    uAtmoT: { value: 0.12 },
    uEnergy: { value: new THREE.Color('#4fd6ff') },
    uAtmo: { value: new THREE.Color('#ff8a3d') },
    uTurns: { value: 18 },
  };
  const cableMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uRadiusScale: { value: 1.0 },
      uGrow: { value: 0 },
      uBase: { value: new THREE.Color('#22313f') },
    },
    vertexShader: CABLE_VERT,
    fragmentShader: CABLE_FRAG,
    side: THREE.DoubleSide,
  });
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uRadiusScale: { value: 1.15 },
      uGrow: { value: 0.003 },
    },
    vertexShader: CABLE_VERT,
    fragmentShader: CABLE_GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,   // 只画外扩管的背面，避免正反面各叠一次
  });
  const cable = new THREE.Mesh(geo, cableMat);
  cable.frustumCulled = false;
  group.add(cable);
  const glow = new THREE.Mesh(geo, glowMat);
  glow.frustumCulled = false;
  group.add(glow);
  materials.push(cableMat, glowMat);

  // ---- 攀爬舱 + 拖尾 ----
  const MAX = 64;
  const TRAIL_N = 6;
  const climberGeo = new THREE.CapsuleGeometry(0.0075, 0.018, 3, 8);
  const climbers = new THREE.InstancedMesh(
    climberGeo,
    // 纯白 + instanceColor 在 bloom 下会变成一串光球，压到中灰让它读成实体
    new THREE.MeshBasicMaterial({ color: 0xb8c8d0 }),
    MAX,
  );
  climbers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  climbers.frustumCulled = false;
  const cs = [];
  for (let i = 0; i < MAX; i++) {
    const ang = i * GOLDEN;
    cs.push({
      off: Math.random(),
      speed: 0.35 + Math.random() * 0.9,
      dir: Math.random() < 0.55 ? 1 : -1,
      parked: i % 7 === 0,
      ca: Math.cos(ang),
      sa: Math.sin(ang),
    });
    climbers.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0xffd9a0 : 0xa8d8e8));
  }
  climbers.instanceColor.needsUpdate = true;
  group.add(climbers);

  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * TRAIL_N * 3), 3));
  trailGeo.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(MAX * TRAIL_N), 1));
  const trailMat = new THREE.ShaderMaterial({
    // uTime 在 shader 里没用到，但 materials 是全局统一更新列表，必须带上
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trails = new THREE.Points(trailGeo, trailMat);
  trails.frustumCulled = false;
  group.add(trails);
  materials.push(trailMat);

  // ---- 站点 / 配重 ----
  const stationGroup = new THREE.Group();
  const stations = [];
  for (let i = 0; i < 4; i++) {
    const t = 0.2 + i * 0.2;
    const isSync = i === 1;
    const st = makeStation(isSync ? 0.11 : 0.052 + i * 0.010, isSync);
    st.g.position.x = a + len * t;
    stationGroup.add(st.g);
    stations.push(st);
  }
  group.add(stationGroup);

  const cw = makeCounterweight();
  cw.g.position.x = b;
  group.add(cw.g);

  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  return {
    group,
    // closeUp = 相机贴着行星的近景（ground / planet），站点与配重会放大成色块
    setDetail(p, closeUp) {
      shared.uPulseSpeed.value = p.pulseSpeed;
      shared.uPulseStrength.value = p.pulseStrength;
      shared.uTurns.value = p.helixTurns;
      cableMat.uniforms.uRadiusScale.value = p.cableRadius;
      glowMat.uniforms.uRadiusScale.value = p.cableRadius * 1.15;
      stationGroup.visible = p.showStations && !closeUp;
      cw.g.visible = p.showCounterweight && !closeUp;
      climbers.visible = !closeUp;
      trails.visible = !closeUp;
    },
    update(t, dt, p) {
      const count = Math.min(MAX, Math.round(p.climberCount));
      climbers.count = count;
      const tPos = trailGeo.attributes.position.array;
      const tFade = trailGeo.attributes.aFade.array;
      for (let i = 0; i < MAX; i++) {
        const c = cs[i];
        const raw = c.parked ? c.off : c.off + t * c.speed * p.climberSpeed * c.dir;
        const v = raw - Math.floor(raw);
        // 舱体挂在缆线外侧：底部缆粗、顶部缆细，外挂半径跟着 taper 收
        const offR = 0.013 + 0.011 * (1 - v);
        const oy = c.ca * offR, oz = c.sa * offR;
        if (i < count) {
          pos.set(a + len * v, oy, oz);
          mtx.compose(pos, q, scl);
          climbers.setMatrixAt(i, mtx);
        }
        for (let k = 0; k < TRAIL_N; k++) {
          const idx = i * TRAIL_N + k;
          const tv = clamp01(v - (k + 1) * 0.010 * c.dir * (c.parked ? 0 : 1));
          tPos[idx * 3] = a + len * tv;
          tPos[idx * 3 + 1] = oy;
          tPos[idx * 3 + 2] = oz;
          tFade[idx] = c.parked ? 0 : (1 - k / TRAIL_N) * 0.85;
        }
      }
      climbers.instanceMatrix.needsUpdate = true;
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.aFade.needsUpdate = true;
      trailGeo.setDrawRange(0, count * TRAIL_N);

      stations.forEach((st, i) => { st.panels.rotation.x += dt * (0.18 + i * 0.06); });
      cw.panels.rotation.x += dt * 0.10;
      cw.g.rotation.x += dt * 0.02;
    },
  };
}
