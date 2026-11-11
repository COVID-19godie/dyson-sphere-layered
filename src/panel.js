import { Pane } from 'tweakpane';
import { PRESETS } from './config.js';
import { SEQUENCE } from './cinema/sequence.js';
import { totalDuration } from './cinema/shot.js';

const KEY = 'dyson-shell-params-v1';

export function createParams() {
  const defaults = {
    assemble: 0,
    explode: 0,
    cut: 0,
    seamWidth: 0.024,
    fresnel: 0.16,
    starIntensity: 3.0,
    convScale: 3.6,
    convFlow: 0.5,
    granule: 0.75,
    spots: 0.55,
    corona: 0.60,
    prominence: 0.60,
    plateDetail: 0.85,
    relief: 0.012,
    cloudAmount: 0.55,
    city: 1.0,
    atmo: 1.0,
    beam: 0.65,
    planetSpin: 1.0,
    groundDetail: 0,
    helixTurns: 18,
    cableRadius: 1.0,
    pulseSpeed: 0.25,
    pulseStrength: 1.0,
    climberCount: 24,
    climberSpeed: 1.0,
    showStations: true,
    showCounterweight: true,
    bloom: 0.62,
    threshold: 0.80,
    exposure: 1.00,
    grain: 0.022,
    vignette: 0.40,
    aberration: 0.0035,
    halation: 0.70,
    haloRadius: 0.080,
    sharp: 0.15,
    dither: 0.60,
    toneMapping: 'ACES',
    // 电影 / 镜头语言
    lens: '28mm',
    letterbox: false,
    dof: 0.35,
    motionBlur: 0.55,
    godrays: 0.85,
    flare: 0.55,
    haze: 0.10,
    hazeStart: 4.0,
    hazeFall: 30.0,
    hazeWarm: 0.35,
    autoExposure: 0.45,
    shake: 0.5,
    breath: 1.0,
    // 运转 / 参照物
    starSpin: 0.035,
    shellSpin: 1.0,
    workLights: 1.0,
    traffic: 1.0,
    // 显示空间分级
    grade: 0.85,
    sat: 0.94,
    rotate: 0.35,
    autoRotate: true,
    collector: true,
    truss: true,
    armor: true,
    showPlanet: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(defaults)) {
        if (k in saved && typeof saved[k] === typeof defaults[k]) defaults[k] = saved[k];
      }
    }
  } catch (_) { /* 忽略损坏的本地预设 */ }
  return defaults;
}

export function createPanel(params, actions) {
  const pane = new Pane({ title: '戴森球 · 参数', expanded: true });
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(params)); } catch (_) {}
    }, 250);
  };

  const fShell = pane.addFolder({ title: '壳层结构', expanded: true });
  fShell.addBinding(params, 'assemble', { label: '铺设进度', min: 0, max: 1, step: 0.001 });
  fShell.addBinding(params, 'explode', { label: '分层展开', min: 0, max: 1, step: 0.001 });
  fShell.addBinding(params, 'cut', { label: '剖切深度', min: 0, max: 1, step: 0.001 });
  fShell.addBinding(params, 'seamWidth', { label: '缝隙宽度', min: 0.008, max: 0.12, step: 0.001 });
  fShell.addBinding(params, 'fresnel', { label: '边缘冷光', min: 0, max: 1, step: 0.01 });
  const fLayers = fShell.addFolder({ title: '层显隐', expanded: false });
  fLayers.addBinding(params, 'collector', { label: '收能层 R7.4' });
  fLayers.addBinding(params, 'truss', { label: '结构层 R8.0' });
  fLayers.addBinding(params, 'armor', { label: '装甲层 R8.7' });

  const fStar = pane.addFolder({ title: '恒星', expanded: false });
  fStar.addBinding(params, 'starIntensity', { label: 'HDR 强度', min: 1, max: 8, step: 0.05 });

  const fDetail = pane.addFolder({ title: '表面细节', expanded: true });
  fDetail.addBinding(params, 'convScale', { label: '对流胞尺度', min: 1.5, max: 9, step: 0.1 });
  fDetail.addBinding(params, 'convFlow', { label: '流动速度', min: 0, max: 2, step: 0.01 });
  fDetail.addBinding(params, 'granule', { label: '米粒组织', min: 0, max: 1.5, step: 0.01 });
  fDetail.addBinding(params, 'spots', { label: '黑子', min: 0, max: 1, step: 0.01 });
  fDetail.addBinding(params, 'corona', { label: '日冕射线', min: 0, max: 1.5, step: 0.01 });
  fDetail.addBinding(params, 'prominence', { label: '磁力线耀斑', min: 0, max: 1.5, step: 0.01 });
  fDetail.addBinding(params, 'plateDetail', { label: '装甲板细节', min: 0, max: 1.5, step: 0.01 });

  const fPlanet = pane.addFolder({ title: '行星 / 地表', expanded: false });
  fPlanet.addBinding(params, 'relief', { label: '地形起伏', min: 0, max: 0.04, step: 0.001 });
  fPlanet.addBinding(params, 'cloudAmount', { label: '云量', min: 0, max: 1.5, step: 0.01 });
  fPlanet.addBinding(params, 'city', { label: '城市灯', min: 0, max: 3, step: 0.01 });
  fPlanet.addBinding(params, 'atmo', { label: '大气强度', min: 0, max: 2, step: 0.01 });
  fPlanet.addBinding(params, 'beam', { label: '塔基能量束', min: 0, max: 2, step: 0.01 });
  fPlanet.addBinding(params, 'planetSpin', { label: '云层自转', min: 0, max: 4, step: 0.01 });
  fPlanet.addBinding(params, 'groundDetail', { label: '贴地细节', min: 0, max: 1, step: 0.01 });

  const fElev = pane.addFolder({ title: '太空电梯 M4', expanded: false });
  fElev.addBinding(params, 'helixTurns', { label: '编织圈数', min: 0, max: 48, step: 1 });
  fElev.addBinding(params, 'cableRadius', { label: '缆径', min: 0.4, max: 2.4, step: 0.01 });
  fElev.addBinding(params, 'pulseSpeed', { label: '脉冲速度', min: 0, max: 1.5, step: 0.01 });
  fElev.addBinding(params, 'pulseStrength', { label: '脉冲强度', min: 0, max: 2.5, step: 0.01 });
  fElev.addBinding(params, 'climberCount', { label: '攀爬舱数', min: 0, max: 64, step: 1 });
  fElev.addBinding(params, 'climberSpeed', { label: '攀爬速度', min: 0, max: 3, step: 0.01 });
  fElev.addBinding(params, 'showStations', { label: '节点站' });
  fElev.addBinding(params, 'showCounterweight', { label: '配重环' });

  const fPost = pane.addFolder({ title: '后期', expanded: false });
  fPost.addBinding(params, 'bloom', { label: 'bloom', min: 0, max: 2, step: 0.01 });
  fPost.addBinding(params, 'threshold', { label: '阈值', min: 0, max: 1, step: 0.01 });
  fPost.addBinding(params, 'exposure', { label: '曝光', min: 0.4, max: 2, step: 0.01 });
  fPost.addBinding(params, 'grain', { label: '颗粒', min: 0, max: 0.08, step: 0.001 });
  fPost.addBinding(params, 'vignette', { label: '暗角', min: 0, max: 0.8, step: 0.01 });
  fPost.addBinding(params, 'aberration', { label: '色差', min: 0, max: 0.02, step: 0.0005 });

  const fFilm = pane.addFolder({ title: '画质 / 胶片', expanded: false });
  fFilm.addBinding(params, 'toneMapping', {
    label: '色调映射',
    options: { 'ACES Filmic': 'ACES', 'AgX': 'AgX', 'PBR Neutral': 'Neutral' },
  });
  fFilm.addBinding(params, 'halation', { label: '胶片红晕', min: 0, max: 1.2, step: 0.01 });
  fFilm.addBinding(params, 'haloRadius', { label: '红晕半径', min: 0.01, max: 0.14, step: 0.002 });
  fFilm.addBinding(params, 'sharp', { label: '锐化', min: 0, max: 0.6, step: 0.01 });
  fFilm.addBinding(params, 'dither', { label: '暗部抖动', min: 0, max: 1.5, step: 0.01 });

  const fCine = pane.addFolder({ title: '电影 · 镜头', expanded: false });
  fCine.addBinding(params, 'lens', {
    label: '焦段',
    options: {
      '24mm 巨构': '24mm',
      '28mm 默认': '28mm',
      '35mm 叙事': '35mm',
      '50mm 中景': '50mm',
      '85mm 特写': '85mm',
    },
  });
  fCine.addBinding(params, 'letterbox', { label: '2.39 遮幅' });
  fCine.addBinding(params, 'dof', { label: '景深', min: 0, max: 1, step: 0.01 });
  fCine.addBinding(params, 'motionBlur', { label: '运动模糊', min: 0, max: 2, step: 0.01 });
  fCine.addBinding(params, 'autoExposure', { label: '曝光适应', min: 0, max: 1, step: 0.01 });
  fCine.addBinding(params, 'godrays', { label: '体积光', min: 0, max: 2, step: 0.01 });
  fCine.addBinding(params, 'flare', { label: '变形光晕', min: 0, max: 2, step: 0.01 });
  fCine.addBinding(params, 'haze', { label: '大气透视', min: 0, max: 1, step: 0.01 });
  fCine.addBinding(params, 'hazeWarm', { label: '透视冷暖', min: 0, max: 1, step: 0.01 });
  fCine.addBinding(params, 'hazeStart', { label: '透视起点', min: 0.5, max: 40, step: 0.5 });
  fCine.addBinding(params, 'hazeFall', { label: '透视衰减', min: 2, max: 120, step: 1 });
  fCine.addBinding(params, 'shake', { label: '手持抖动', min: 0, max: 2, step: 0.01 });
  fCine.addBinding(params, 'breath', { label: '呼吸', min: 0, max: 2, step: 0.01 });
  fCine.addBinding(params, 'grade', { label: '青橙分级', min: 0, max: 1, step: 0.01 });
  fCine.addBinding(params, 'sat', { label: '饱和度', min: 0.4, max: 1.4, step: 0.01 });

  const fRun = pane.addFolder({ title: '运转 · 参照物', expanded: false });
  fRun.addBinding(params, 'starSpin', { label: '恒星自转', min: 0, max: 0.25, step: 0.001 });
  fRun.addBinding(params, 'shellSpin', { label: '分层自转', min: 0, max: 2, step: 0.01 });
  fRun.addBinding(params, 'workLights', { label: '工程灯', min: 0, max: 2, step: 0.01 });
  fRun.addBinding(params, 'traffic', { label: '穿梭机', min: 0, max: 1, step: 0.01 });

  const fView = pane.addFolder({ title: '视图', expanded: false });
  fView.addBinding(params, 'autoRotate', { label: '自动环绕' });
  fView.addBinding(params, 'rotate', { label: '环绕速度', min: 0, max: 2, step: 0.01 });
  fView.addBinding(params, 'showPlanet', { label: '行星 / 电梯' });

  const fPreset = pane.addFolder({ title: '预设', expanded: false });
  Object.keys(PRESETS).forEach((name) => {
    fPreset.addButton({ title: name }).on('click', () => {
      Object.assign(params, PRESETS[name]);
      pane.refresh();
      persist();
      actions.onPreset?.(name);
    });
  });

  const fTools = pane.addFolder({ title: '动作', expanded: true });
  fTools.addButton({ title: `▶ 播放分镜（${Math.round(totalDuration(SEQUENCE))}s）` }).on('click', () => actions.film?.());
  fTools.addButton({ title: '▶ 分层演示' }).on('click', () => actions.demo?.());
  fTools.addButton({ title: '↻ 重播开场' }).on('click', () => actions.replay?.());
  fTools.addButton({ title: '⇩ 导出参数 JSON' }).on('click', () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dyson-preset.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  fTools.addButton({ title: '⇧ 导入参数 JSON' }).on('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        for (const k of Object.keys(params)) {
          if (k in data && typeof data[k] === typeof params[k]) params[k] = data[k];
        }
        pane.refresh();
        persist();
      } catch (_) { /* 忽略非法文件 */ }
    };
    input.click();
  });
  fTools.addButton({ title: '⟲ 重置' }).on('click', () => {
    const fresh = { ...createParams(), ...{} };
    localStorage.removeItem(KEY);
    location.reload();
  });

  pane.on('change', persist);

  // 移动端默认收起
  if (window.innerWidth < 720) pane.expanded = false;

  return { pane, refresh: () => pane.refresh() };
}
