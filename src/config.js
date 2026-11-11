/**
 * 全项目唯一的数值来源。禁止在其它文件里硬编码半径。
 * 单位：视觉压缩单位（详见 DYSON_SPHERE_PLAN.md 第 2 节）
 */
export const CFG = {
  star: {
    radius: 1.0,
    corona: 1.06,
    intensity: 3.0,
  },
  shell: {
    // 合拢时三层严丝合缝叠成一颗球；explode 沿法线外扩，层间不穿插
    layers: [
      {
        id: 'collector',
        name: '收能层',
        r: 7.4,
        thickness: 0.10,
        offset: 0.0,
        tilesU: 100,
        tilesV: 50,
        honeycomb: 1.0,
        lattice: 0.0,
        colorOut: '#241a17',
        colorIn: '#8a5a34',
        seam: '#ff8a2b',
        energy: '#ffc07a',
        fresnel: 0.22,
      },
      {
        id: 'truss',
        name: '结构层',
        r: 8.0,
        thickness: 0.14,
        offset: 1.0,
        tilesU: 40,
        tilesV: 20,
        honeycomb: 0.0,
        lattice: 1.0,
        colorOut: '#101d29',
        colorIn: '#2b4155',
        seam: '#4fd6ff',
        energy: '#7af0ff',
        fresnel: 0.35,
      },
      {
        id: 'armor',
        name: '装甲层',
        r: 8.7,
        thickness: 0.10,
        offset: 2.0,
        tilesU: 120,
        tilesV: 60,
        honeycomb: 0.0,
        lattice: 0.0,
        colorOut: '#152634',
        colorIn: '#3b2c22',
        seam: '#ff7a2a',
        energy: '#4fd6ff',
        fresnel: 0.25,
      },
    ],
  },
  planet: { r: 0.35, orbit: 2.6, atmo: 1.06, cloud: 1.02 },
  // 局部坐标：相对行星中心，沿径向 +X 由地表向外
  elevator: { from: 0.35, to: 1.4 },
  camera: {
    start: [24, 9.5, 21],
    minDist: 0.7,
    maxDist: 70,
    fov: 46,
  },
};

/**
 * 原型阶段不开 logarithmicDepthBuffer：自写 ShaderMaterial 需要手动注入
 * logdepthbuf 的 pars/vertex/fragment chunk，容易和 composer 打架。
 * 这里改用动态 near/far（near ∝ 相机距离，far = max(d*12, 400)）。
 * 在 0.01–400 的范围内，24bit 深度在 z≈25 处精度约 5e-4，
 * 远小于 0.10 的壳层厚度，足够用。正式版要贴地看细节时再切回对数深度。
 */
export const USE_LOG_DEPTH = false;

export const PRESETS = {
  '冷峻工程': {
    explode: 0.0, cut: 0.0, assemble: 1.0, seamWidth: 0.018,
    bloom: 0.48, threshold: 0.84, exposure: 0.95, starIntensity: 3.0,
    grain: 0.022, fresnel: 0.12, rotate: 0.35,
    convScale: 4.2, convFlow: 0.35, granule: 0.90, spots: 0.70,
    corona: 0.45, prominence: 0.35, plateDetail: 1.10,
    relief: 0.014, cloudAmount: 0.40, city: 1.10, atmo: 0.90, beam: 0.55,
    planetSpin: 1.0, groundDetail: 0,
    helixTurns: 22, cableRadius: 0.90, pulseSpeed: 0.30, pulseStrength: 0.85,
    climberCount: 18, climberSpeed: 0.80, showStations: true, showCounterweight: true,
    halation: 0.40, haloRadius: 0.045, sharp: 0.20, dither: 0.60, toneMapping: 'ACES',
    lens: '28mm', letterbox: false, dof: 0.22,
    godrays: 0.70, flare: 0.35, haze: 0.14, hazeWarm: 0.15,
    hazeStart: 5.0, hazeFall: 42, autoExposure: 0.35, shake: 0.5, breath: 1.0,
    starSpin: 0.030, shellSpin: 0.9, workLights: 1.00, traffic: 1.0, grade: 0.75, sat: 0.88,
  },
  '黄昏暖调': {
    explode: 0.35, cut: 0.42, assemble: 1.0, seamWidth: 0.030,
    bloom: 0.78, threshold: 0.74, exposure: 1.14, starIntensity: 4.4,
    grain: 0.018, fresnel: 0.28, rotate: 0.35,
    convScale: 2.8, convFlow: 0.60, granule: 0.60, spots: 0.30,
    corona: 1.00, prominence: 0.90, plateDetail: 0.70,
    relief: 0.010, cloudAmount: 0.75, city: 0.85, atmo: 1.25, beam: 0.90,
    planetSpin: 1.0, groundDetail: 0,
    helixTurns: 16, cableRadius: 1.10, pulseSpeed: 0.18, pulseStrength: 1.35,
    climberCount: 30, climberSpeed: 1.10, showStations: true, showCounterweight: true,
    halation: 0.85, haloRadius: 0.065, sharp: 0.12, dither: 0.55, toneMapping: 'ACES',
    lens: '35mm', letterbox: true, dof: 0.55,
    godrays: 1.15, flare: 0.95, haze: 0.48, hazeWarm: 0.85,
    hazeStart: 3.0, hazeFall: 22, autoExposure: 0.55, shake: 0.65, breath: 1.0,
    starSpin: 0.040, shellSpin: 1.10, workLights: 1.30, traffic: 1.0, grade: 0.95, sat: 1.04,
  },
  '电影冷青': {
    explode: 0.72, cut: 0.58, assemble: 1.0, seamWidth: 0.026,
    bloom: 0.70, threshold: 0.78, exposure: 1.04, starIntensity: 3.8,
    grain: 0.030, fresnel: 0.40, rotate: 0.35,
    convScale: 3.6, convFlow: 0.50, granule: 0.80, spots: 0.55,
    corona: 0.70, prominence: 0.60, plateDetail: 0.95,
    relief: 0.012, cloudAmount: 0.55, city: 1.00, atmo: 1.00, beam: 0.65,
    planetSpin: 1.0, groundDetail: 0,
    helixTurns: 18, cableRadius: 1.00, pulseSpeed: 0.25, pulseStrength: 1.00,
    climberCount: 24, climberSpeed: 1.00, showStations: true, showCounterweight: true,
    halation: 0.60, haloRadius: 0.055, sharp: 0.16, dither: 0.65, toneMapping: 'ACES',
    lens: '35mm', letterbox: true, dof: 0.50,
    godrays: 0.95, flare: 0.70, haze: 0.26, hazeWarm: 0.25,
    hazeStart: 4.0, hazeFall: 30, autoExposure: 0.60, shake: 0.55, breath: 1.0,
    starSpin: 0.035, shellSpin: 1.00, workLights: 1.10, traffic: 1.0, grade: 1.00, sat: 0.92,
  },
};
