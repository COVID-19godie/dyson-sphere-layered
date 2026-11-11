import * as THREE from 'three';
import { CFG } from './config.js';
import {
  STAR_VERT, STAR_FRAG, CORONA_FRAG, PROM_VERT, PROM_FRAG,
  SHELL_VERT, SHELL_FRAG, CAP_VERT, CAP_FRAG,
  PLANET_VERT, PLANET_FRAG, ATMO_FRAG, CLOUD_VERT, CLOUD_FRAG, BEAM_FRAG,
  SKY_VERT, SKY_FRAG,
  POINTS_VERT, POINTS_FRAG, FLOW_VERT, FLOW_FRAG,
  WORKLIGHT_VERT, WORKLIGHT_FRAG,
} from './shaders.js';

const C = (hex) => new THREE.Color(hex);
const reg = (list, m) => { if (m.uniforms?.uTime) list.push(m); return m; };

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(255,246,224,1)');
  g.addColorStop(0.18, 'rgba(255,186,96,0.55)');
  g.addColorStop(0.45, 'rgba(255,110,32,0.14)');
  g.addColorStop(1.0, 'rgba(255,80,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ 恒星 */

export function makeStar(scene, materials) {
  const g = new THREE.Group();
  const { radius, corona, intensity } = CFG.star;

  const coreMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uConvScale: { value: 3.6 },
      uSpin: { value: 0.035 },
      uFlow: { value: 0.5 },
      uGranule: { value: 0.75 },
      uSpots: { value: 0.55 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
  }));
  // 二十面体细分，避免 UV 球在极点把对流胞拉成条状
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 5), coreMat));

  const coronaMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0.60 },
      uFlow: { value: 0.5 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(corona, 4), coronaMat));

  // 磁力线耀斑：10 条从表面起拱的细弧，沿弧长流动
  const promMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0.6 },
      uFlow: { value: 0.5 },
    },
    vertexShader: PROM_VERT,
    fragmentShader: PROM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const promGroup = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const lat = (Math.random() - 0.5) * 1.1;
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const p1 = dir.clone().multiplyScalar(radius * 0.998).addScaledVector(side, -0.10);
    const p2 = dir.clone().multiplyScalar(radius * 0.998).addScaledVector(side, 0.10);
    // 二次贝塞尔不会像 CatmullRom 那样过冲，弧线贴着表面、不会甩出长直线
    const ctrl = dir.clone().multiplyScalar(radius + 0.38 + Math.random() * 0.22);
    const curve = new THREE.QuadraticBezierCurve3(p1, ctrl, p2);
    promGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.004, 5, false), promMat));
  }
  g.add(promGroup);

  const tex = radialTexture();
  const sprites = [];
  const spriteBase = [];
  for (const [size, opacity] of [[2.3, 0.50], [5.2, 0.13]]) {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffd8a0, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size);
    g.add(s);
    sprites.push(s);
    spriteBase.push(opacity);
  }

  scene.add(g);
  return {
    group: g,
    setIntensity(v) {
      coreMat.uniforms.uIntensity.value = v;
      sprites.forEach((s, i) => { s.material.opacity = spriteBase[i] * (v / 3.0); });
    },
    setDetail(p) {
      coreMat.uniforms.uConvScale.value = p.convScale;
      coreMat.uniforms.uFlow.value = p.convFlow;
      coreMat.uniforms.uGranule.value = p.granule;
      coreMat.uniforms.uSpots.value = p.spots;
      coreMat.uniforms.uSpin.value = p.starSpin;
      coronaMat.uniforms.uStrength.value = p.corona;
      coronaMat.uniforms.uFlow.value = p.convFlow;
      promMat.uniforms.uStrength.value = p.prominence;
      promMat.uniforms.uFlow.value = p.convFlow;
    },
    // 贴地时恒星角直径已达 45°，光晕精灵会放大到糊满全屏，直接关掉
    setGroundMode(on) {
      sprites.forEach((s) => { s.visible = !on; });
      promGroup.visible = !on;
    },
    coronaMat,
    promMat,
  };
}

/* ----------------------------------------------- 三层同心壳层 + 剖切圆环 */

export function makeShell(scene, materials) {
  const geo = new THREE.SphereGeometry(1, 160, 96);
  const capGeo = new THREE.CircleGeometry(1, 160);
  const layers = [];
  const group = new THREE.Group();

  CFG.shell.layers.forEach((cfg) => {
    const mat = reg(materials, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: cfg.r },
        uExplode: { value: 0 },
        uLayerOffset: { value: cfg.offset },
        uAssemble: { value: 1 },
        uCutD: { value: 999 },
        uSeamWidth: { value: 0.04 },
        uFade: { value: 1 },
        uFresnel: { value: cfg.fresnel },
        uTilesU: { value: cfg.tilesU },
        uTilesV: { value: cfg.tilesV },
        uHoneycomb: { value: cfg.honeycomb },
        uLattice: { value: cfg.lattice },
        uReveal: { value: 0 },
        uPlateDetail: { value: 0.85 },
        uColorOut: { value: C(cfg.colorOut) },
        uColorIn: { value: C(cfg.colorIn) },
        uSeamColor: { value: C(cfg.seam) },
        uEnergyColor: { value: C(cfg.energy) },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);

    const capMat = new THREE.ShaderMaterial({
      uniforms: {
        uInner: { value: 0.98 },
        uColor: { value: C(cfg.colorIn).multiplyScalar(0.55) },
        uRim: { value: C(cfg.seam) },
      },
      vertexShader: CAP_VERT,
      fragmentShader: CAP_FRAG,
      side: THREE.DoubleSide,
    });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.rotation.y = Math.PI / 2;   // 圆面朝 +x，正对被切掉的那一侧
    cap.frustumCulled = false;
    cap.visible = false;
    group.add(cap);

    layers.push({ cfg, mat, mesh, cap, capMat });
  });

  // 结构层外的能量流光点
  const N = 720;
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) phase[i] = i / N;
  flowGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const flowMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: FLOW_VERT,
    fragmentShader: FLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const flow = new THREE.Points(flowGeo, flowMat);
  flow.frustumCulled = false;
  group.add(flow);

  // 工程灯阵列：沿 14 条经线成串分布，贴着装甲层表面。
  // 必须成串：随机撒点在远景只会读成噪点，等距成串才读成"施工带 / 居住带"，
  // 也才真的提供尺度参照 —— 一串灯就是一条几十万公里的工区。
  const LN = 840;
  const MER = 14;
  const PER = Math.ceil(LN / MER);
  const lightGeo = new THREE.BufferGeometry();
  const lpos = new Float32Array(LN * 3);
  const lphase = new Float32Array(LN);
  const lkind = new Float32Array(LN);
  const ldir = [];
  for (let i = 0; i < LN; i++) {
    const m = i % MER;
    const k = Math.floor(i / MER);
    const lon = (m / MER) * Math.PI * 2 + (Math.random() - 0.5) * 0.045;
    const lat = ((k + 0.5) / PER * 2 - 1) * 1.34 + (Math.random() - 0.5) * 0.028;
    const cl = Math.cos(lat);
    ldir.push(new THREE.Vector3(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)));
    lphase[i] = Math.random();
    lkind[i] = Math.random() < 0.22 ? 1 : 0;
  }
  lightGeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  lightGeo.setAttribute('aPhase', new THREE.BufferAttribute(lphase, 1));
  lightGeo.setAttribute('aKind', new THREE.BufferAttribute(lkind, 1));
  const lightMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSize: { value: 3.4 } },
    vertexShader: WORKLIGHT_VERT,
    fragmentShader: WORKLIGHT_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const workLight = new THREE.Points(lightGeo, lightMat);
  workLight.frustumCulled = false;
  group.add(workLight);

  scene.add(group);

  // 分层态三层反向自转：不同层不同转向、不同速度，读起来才像一台机器而不是
  // 整块东西在转。转速单位为 rad/s（spin=1 时），内层最快、外层最慢。
  // 速度必须够：球壳绕轴转时轮廓不变，唯一能读出"在转"的是板缝 / 灯带的位移，
  // 2.6°/s 在 8~14 秒的镜头里只挪十几度，观众根本看不出来。
  const SPIN_RATE = { collector: -0.115, truss: 0.078, armor: -0.036 };
  const angles = [0, 0, 0];

  function update(s) {
    const assemble = s.assemble;
    const bulge = (1 - assemble) * 0.10;
    // 合拢态只留最外层：三层同心球同时渲染时，内层结构层的青色桁架线会
    // 叠在外层瓦片上连成一张网，破坏"外部看是一颗完整安静的球"。
    // 分层 / 剖切开始后再把内层放出来。
    const closed = s.explode < 0.02 && s.cut < 0.02;
    let maxR = 0;
    layers.forEach((L) => {
      const R = L.cfg.r + s.explode * L.cfg.offset + bulge * L.cfg.r;
      maxR = Math.max(maxR, R + (1 - assemble) * 0.55);
    });

    // cut=0 → 平面在球外，完全不裁；cut=1 → 切到接近球心
    const d = maxR * (1.02 - s.cut * 1.0);

    layers.forEach((L) => {
      const { cfg, mat, cap, capMat } = L;
      const R = cfg.r + s.explode * cfg.offset + bulge * cfg.r;
      const Rin = R - cfg.thickness;
      const vis = s.layerVisible[cfg.id] !== false && (!closed || cfg.id === 'armor');

      mat.uniforms.uExplode.value = s.explode;
      mat.uniforms.uAssemble.value = assemble;
      mat.uniforms.uCutD.value = d;
      mat.uniforms.uSeamWidth.value = s.seamWidth;
      mat.uniforms.uFade.value = vis ? 1 : 0;
      mat.uniforms.uFresnel.value = s.fresnel * (cfg.fresnel / 0.25);
      mat.uniforms.uPlateDetail.value = s.plateDetail;
      mat.uniforms.uReveal.value = s.explode * (cfg.id === 'armor' ? 0.30 : cfg.id === 'truss' ? 0.10 : 0.0);

      const outer = Math.sqrt(Math.max(0, R * R - d * d));
      const inner = Math.sqrt(Math.max(0, Rin * Rin - d * d));
      const showCap = vis && s.cut > 0.002 && outer > 0.002;
      cap.visible = showCap;
      if (showCap) {
        cap.position.x = d - 0.0025;
        cap.scale.setScalar(outer);
        capMat.uniforms.uInner.value = Math.min(0.999, inner / outer);
      }
    });

    // 自转权重：合拢态完全不转（刚性壳靠壳面压缩力支撑，转起来反而会被
    // 离心力拉成盘 —— 见 CINEMATIC_UPGRADE_PLAN 的方案 B），
    // 一旦展开 / 剖切开才逐层转起来。
    const open = Math.max(s.explode, s.cut);
    let w = Math.min(1, Math.max(0, (open - 0.02) / 0.16));
    w = w * w * (3 - 2 * w);
    const dt = s.dt || 0;
    layers.forEach((L, i) => {
      angles[i] += dt * (SPIN_RATE[L.cfg.id] || 0) * (s.spin ?? 1) * w;
      L.mesh.rotation.y = angles[i];
    });

    // 能量流光点跟随结构层半径
    const trussR = CFG.shell.layers[1].r + s.explode * CFG.shell.layers[1].offset + bulge * CFG.shell.layers[1].r;
    const pos = flowGeo.attributes.position.array;
    const meridians = 12;
    for (let i = 0; i < N; i++) {
      const m = i % meridians;
      const lon = (m / meridians) * Math.PI * 2;
      const phi = ((i / N) * Math.PI * 2);
      pos[i * 3] = Math.cos(phi) * Math.cos(lon) * trussR;
      pos[i * 3 + 1] = Math.sin(phi) * trussR;
      pos[i * 3 + 2] = Math.cos(phi) * Math.sin(lon) * trussR;
    }
    flowGeo.attributes.position.needsUpdate = true;
    flow.rotation.y = angles[1];            // 流光挂在结构层上，跟着它转
    flow.visible = s.layerVisible.truss !== false && !closed;

    // 工程灯贴在装甲层表面，跟着装甲层一起转。
    // 抬升量必须给足：+0.004 在 9.66 的球面上正好落在深度缓冲精度边界，
    // 会和球壳打 z-fighting，绝大多数灯点被球面吃掉（表现为"几百个灯只剩几十个"）。
    // 0.06 相对半径仍是 0.6%，肉眼看还是贴着板面，但已经远离精度边界。
    const armorR = CFG.shell.layers[2].r + s.explode * CFG.shell.layers[2].offset
                 + bulge * CFG.shell.layers[2].r + 0.06;
    for (let i = 0; i < LN; i++) {
      const d = ldir[i];
      lpos[i * 3] = d.x * armorR;
      lpos[i * 3 + 1] = d.y * armorR;
      lpos[i * 3 + 2] = d.z * armorR;
    }
    lightGeo.attributes.position.needsUpdate = true;
    workLight.rotation.y = angles[2];
    lightMat.uniforms.uSize.value = 3.4 * (s.workLights ?? 1);
    workLight.visible = s.layerVisible.armor !== false && (s.workLights ?? 1) > 0.01;
  }

  return { group, layers, update, flowMat };
}

/* ------------------------------------------------------------------ 星空 */

function kelvin(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.1 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  return new THREE.Color(
    Math.min(1, Math.max(0, r / 255)),
    Math.min(1, Math.max(0, g / 255)),
    Math.min(1, Math.max(0, b / 255)),
  );
}

export function makeStarfield(scene, materials) {
  const group = new THREE.Group();
  const sets = [];

  for (const spec of [{ n: 18000, size: 0.55, bright: 0.35 }, { n: 2200, size: 1.9, bright: 1.0 }]) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(spec.n * 3);
    const size = new Float32Array(spec.n);
    const phase = new Float32Array(spec.n);
    const color = new Float32Array(spec.n * 3);
    for (let i = 0; i < spec.n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 40;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(a) * s * r;
      size[i] = (0.4 + Math.pow(Math.random(), 3) * 2.2) * spec.bright;
      phase[i] = Math.random() * Math.PI * 2;
      const c = kelvin(3000 + Math.random() * 9000);
      color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    const mat = reg(materials, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSize: { value: spec.size } },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    sets.push(mat);
  }

  scene.add(group);
  return {
    group,
    sets,
    follow(camera) { group.position.copy(camera.position); },
  };
}

/* ------------------------------------------------- 行星 / 云 / 大气 / 塔基 */

export function makePlanet(scene, materials) {
  const group = new THREE.Group();
  group.position.set(0, 0, CFG.planet.orbit);   // 之后全部用相对行星中心的局部坐标
  const { r, atmo, cloud } = CFG.planet;
  const a = CFG.elevator.from;

  const surfMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRelief: { value: 0.012 },
      uCity: { value: 1.0 },
      uGroundDetail: { value: 0 },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
  }));
  group.add(new THREE.Mesh(new THREE.SphereGeometry(r, 384, 192), surfMat));

  const cloudMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCloud: { value: 0.55 } },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,   // DoubleSide 会把背面云也叠一遍，整颗星糊成灰球
  }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(r * cloud, 128, 64), cloudMat);
  group.add(clouds);

  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uAtmo: { value: 1.0 } },
    vertexShader: CLOUD_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(r * atmo, 96, 64), atmoMat);
  group.add(atmoMesh);

  // 贴地视角相机在大气壳内部，必须换成相机居中的加法天空穹顶
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uUp: { value: new THREE.Vector3(1, 0, 0) },
      uStrength: { value: 0.75 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 24), skyMat);
  sky.frustumCulled = false;
  sky.visible = false;
  scene.add(sky);

  // 贴地碎屑：只在 ground view 打开，给近景一点体积细节
  const N = 2600;
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(N * 3);
  const dSize = new Float32Array(N);
  const dPhase = new Float32Array(N);
  const dColor = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const dir = new THREE.Vector3(1, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4).normalize();
    const rad = r + 0.002 + Math.random() * 0.0035;
    dPos[i * 3] = dir.x * rad; dPos[i * 3 + 1] = dir.y * rad; dPos[i * 3 + 2] = dir.z * rad;
    dSize[i] = 0.4 + Math.pow(Math.random(), 3) * 1.8;
    dPhase[i] = Math.random() * 6.283;
    const k = Math.random();
    const c = k < 0.55 ? [0.20, 0.20, 0.19] : k < 0.82 ? [0.11, 0.16, 0.10] : [0.28, 0.24, 0.18];
    dColor[i * 3] = c[0]; dColor[i * 3 + 1] = c[1]; dColor[i * 3 + 2] = c[2];
  }
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1));
  dGeo.setAttribute('aPhase', new THREE.BufferAttribute(dPhase, 1));
  dGeo.setAttribute('aColor', new THREE.BufferAttribute(dColor, 3));
  const debrisMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSize: { value: 0.028 } },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
  }));
  const debris = new THREE.Points(dGeo, debrisMat);
  debris.visible = false;
  group.add(debris);

  // 塔基：平台 + 塔身 + 3 层旋转光环 + 向上能量束（缆线沿径向 +X）
  const tower = new THREE.Group();
  // 场景里其余材质都是自写 shader（不受光照），只给塔基补一盏恒星方向的点光
  const key = new THREE.PointLight(0xffb87a, 5, 0, 0);
  key.position.set(0, 0, -CFG.planet.orbit);
  group.add(key);
  const metal = new THREE.MeshStandardMaterial({
    color: 0x35485a, metalness: 0.85, roughness: 0.45, emissive: 0x16222e,
  });
  // 电梯视角离塔基约 1.5，纯亮青环会直接烧成一团白，压暗到只留轮廓
  const glowRing = new THREE.MeshBasicMaterial({ color: 0x2e7f9c });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.010, 32), metal);
  platform.rotation.z = -Math.PI / 2;
  platform.position.x = a + 0.005;
  tower.add(platform);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 0.075, 12), metal);
  spire.rotation.z = -Math.PI / 2;
  spire.position.x = a + 0.043;
  tower.add(spire);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.020 + i * 0.012, 0.0016, 6, 48), glowRing);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = a + 0.020 + i * 0.020;
    tower.add(ring);
    rings.push(ring);
  }
  const beamMat = reg(materials, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.65 } },
    vertexShader: CAP_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  // 塔基光柱只覆盖最下面 0.34：M4 缆线自带脉冲 glow，全长叠一层会过曝
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.013, 0.34, 10, 1, true), beamMat);
  beam.rotation.z = -Math.PI / 2;
  beam.position.x = a + 0.17;
  tower.add(beam);
  group.add(tower);

  // 编织缆线 / 攀爬舱 / 节点站 / 配重已独立到 elevator.js（M4），
  // 由 main.js 挂到 planet.group 上；这里只负责行星本体与塔基。
  scene.add(group);

  return {
    group,
    setDetail(p, isGround) {
      surfMat.uniforms.uRelief.value = p.relief;
      surfMat.uniforms.uCity.value = p.city;
      surfMat.uniforms.uGroundDetail.value = p.groundDetail;
      cloudMat.uniforms.uCloud.value = p.cloudAmount;
      atmoMat.uniforms.uAtmo.value = p.atmo;
      beamMat.uniforms.uStrength.value = p.beam;
      atmoMesh.visible = !isGround;
      sky.visible = !!isGround;
      // 贴地时相机离塔基不到 0.1，光环会被放大成横跨画面的青色带
      rings.forEach((ring) => { ring.visible = !isGround; });
      // 平台圆盘同理，而且更严重：直径 0.096 在 0.085 的距离上比整个视场还大，
      // 会在画面右侧糊成一整片没有结构的灰墙（S1 开场镜头踩过）。
      // 贴地只留 spire 剪影 + 塔基光柱，反而更像"远处一座塔"。
      platform.visible = !isGround;
      debris.visible = p.groundDetail > 0.01;
    },
    update(t, dt, p, camera) {
      clouds.rotation.y += dt * 0.008 * p.planetSpin;
      rings.forEach((ring, i) => { ring.rotation.x += dt * (0.25 + i * 0.12); });
      if (sky.visible) sky.position.copy(camera.position);
    },
  };
}
