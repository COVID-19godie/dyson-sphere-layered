import * as THREE from 'three';

/**
 * 介绍片《一颗恒星，三层壳》的脚本与分镜。
 *
 * 设计原则（和电影分镜 SEQUENCE 分开，互不干扰）：
 *
 * 1. **先立尺度，再讲功能**。开场不给任何解释，只让观众看到一个把恒星
 *    整个包进去的东西从远处推到眼前；等"这有多大"这件事成立了，
 *    剖开看见恒星，才轮到"它是干什么的"。
 * 2. 每个镜头只讲一件事，句子短。配音是逐句生成的 wav/m4a，
 *    **每句的真实时长就是字幕 cue 的时长**，镜头时长 = 该镜头下所有句子
 *    时长之和 + 句间留白 —— 不做"估计字数 × 语速"这种一定会漂移的拍脑袋。
 * 3. 镜头状态整组覆盖，不做 morph。上一镜的壳层不会赖到下一镜的机位里
 *    （C4 踩过：morph 会让相机进了壳内部还留着上一镜的壳板）。
 * 4. 三层特写各自只显示一层。相机进到球壳以内时外层一定会把画面糊住，
 *    所以"收能层朝内的一面"必须把 truss / armor 关掉才拍得到。
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 每个镜头共用的一组"基准"参数，镜头里只写要覆盖的项。
// 写全量是为了避免残留 —— 镜头之间硬切，谁也不继承谁。
const BASE = {
  collector: true, truss: true, armor: true, showPlanet: false,
  assemble: 1, explode: 0, cut: 0,
  seamWidth: 0.024, plateDetail: 0.85, fresnel: 0.16,
  starIntensity: 3.0, corona: 0.55, prominence: 0.50,
  granule: 0.75, spots: 0.55,
  groundDetail: 0, relief: 0.012,
  workLights: 1.0, traffic: 1.0, shellSpin: 1.0,
  climberCount: 24, climberSpeed: 1.0, showStations: true, showCounterweight: true,
  bloom: 0.60, threshold: 0.82, exposure: 1.04,
  grade: 0.85, sat: 0.94, grain: 0.022, vignette: 0.40,
  letterbox: true, dof: 0.16, motionBlur: 0.55,
  godrays: 0.80, flare: 0.50, haze: 0.10,
  shake: 0.28, breath: 1.0, autoRotate: false,
};
const st = (over) => ({ ...BASE, ...over });

export const INTRO_SHOTS = [
  {
    id: 'I1',
    chapter: '一 · 尺度',
    title: '把一颗恒星整个包起来',
    cam: {
      // 24mm + 2.39 遮幅下可见垂直视场约 41°，球不裁切的极限距离约 25。
      // 35mm 在 29 距离会被遮幅平切，这里不能再用。
      //
      // 关键不是"把球放多大"，而是**让它一直在变大**：第一版用 ease:'out'，
      // u=0.44 时插值已到 0.96，15 秒里有 13 秒画面是静止的，宏伟感全没了。
      // 改成 inOut + 58→31，球从占可见高度约四成持续推到八成，末段逼近装不下。
      lens: '24mm', ease: 'inOut', shake: 0.16, breath: 1.0, up: [0, 1, 0],
      from: { pos: V(41.4, 15.1, 37.7), target: V(0, 0, 0), focus: 58, exposure: 0.98 },
      to:   { pos: V(22.0, 7.85, 20.4), target: V(0, 0, 0), focus: 31, exposure: 1.06 },
    },
    // 灯串是这颗暗球上唯一的尺度参照，比调高整体曝光更有说服力
    state: st({ workLights: 1.6, starIntensity: 3.4, bloom: 0.66, dof: 0.20, godrays: 0.9 }),
    lines: [
      '如果要把一颗恒星的全部输出都接住，工程的尺度就不再以公里计算。',
      '它必须以恒星半径为单位。',
      '眼前这个球，半径是中心那颗恒星的八点七倍。',
    ],
  },
  {
    id: 'I2',
    chapter: '二 · 构想',
    title: '能量，而不是阳光',
    cam: {
      lens: '24mm', ease: 'out', shake: 0.20, up: [0, 1, 0],
      from: { pos: V(24, 8.6, 22), target: V(0, 0, 0), focus: 30, exposure: 1.02 },
      to:   { pos: V(18.5, 6.6, 17), target: V(0, 0, 0), focus: 24, exposure: 1.06 },
    },
    state: st({ cut: 0.58, seamWidth: 0.030, starIntensity: 3.6, corona: 0.62, bloom: 0.70, godrays: 1.0 }),
    lines: [
      '一九六零年，弗里曼·戴森提出一个判据：足够先进的文明，',
      '不会只在行星表面等阳光，而会环绕恒星建造收集结构。',
      '剖开外壳，恒星仍在正中——它没有被遮蔽，而是被整个包住。',
    ],
  },
  {
    id: 'I3',
    chapter: '三 · 构型',
    title: '接近闭合的实心壳',
    cam: {
      // 三层只有在**顺着孔轴看进去**时才成立（外层不透明，侧视会把内层全藏住）。
      // 直接复用电影分镜 S4 验证过的机位与 cut/explode 组合。
      lens: '24mm', ease: 'out', shake: 0.18, up: [0, 1, 0],
      from: { pos: V(16.2, 5.8, 14.8), target: V(-0.6, 0.5, 0), focus: 22.0, exposure: 1.06 },
      to:   { pos: V(22.1, 7.9, 20.2), target: V(0, 0.4, 0), focus: 24.5, exposure: 1.04 },
    },
    state: st({
      explode: 0.75, cut: 0.45, seamWidth: 0.018,
      workLights: 1.2, starIntensity: 3.4, bloom: 0.70, threshold: 0.78,
    }),
    lines: [
      '这里采用的是接近闭合的实心壳，不是散开的卫星群。',
      '它由三层同心壳体组成：收能层、结构层、装甲层。',
      '让它们分开，才看得清每一层各自在做什么。',
    ],
  },
  {
    id: 'I4',
    chapter: '四 · 收能层',
    title: '朝内的那一整面',
    cam: {
      // 相机在壳体内部，target 指向内壁而不是原点：朝恒星看只会得到一颗光球，
      // 那一整面光伏阵列全在视野之外。背对恒星，内壁才会铺满画幅。
      lens: '24mm', ease: 'inOut', shake: 0.14, up: [0, 1, 0],
      from: { pos: V(3.4, 0.9, 2.6), target: V(7.0, 1.4, 5.4), focus: 5.0, exposure: 1.02 },
      to:   { pos: V(3.8, 1.2, 2.2), target: V(7.0, 1.6, 4.6), focus: 5.0, exposure: 1.06 },
    },
    state: st({
      collector: true, truss: false, armor: false,
      starIntensity: 2.4, corona: 0.45, prominence: 0.40,
      bloom: 0.52, dof: 0, godrays: 0.7, workLights: 0.8,
    }),
    lines: [
      '最内层是收能层，半径七点四。',
      '朝向恒星的那一整面铺满光伏阵列，把辐射直接变成电力。',
      '接缝里流动的光，是正在被输运走的能量。',
    ],
  },
  {
    id: 'I5',
    chapter: '五 · 结构层',
    title: '把三层锁成一个整体',
    cam: {
      lens: '28mm', ease: 'inOut', shake: 0.18, up: [0, 1, 0],
      from: { pos: V(11.2, 3.2, 9.6), target: V(0, 0, 0), focus: 15, exposure: 1.04 },
      to:   { pos: V(9.4, 2.4, 7.0), target: V(0, 0, 0), focus: 12, exposure: 1.06 },
    },
    state: st({
      // 桁架是镂空的暗色网格，只显示它 = 透过去只看得见恒星，等于没画面。
      // 留着收能层当暖色底，青色杆件才会从背景里浮出来。
      collector: true, truss: true, armor: false,
      workLights: 1.3, bloom: 0.58, dof: 0.12, godrays: 0.55,
    }),
    lines: [
      '中间是结构层，半径八。它是一整套桁架，不是一层皮。',
      '壳体的应力、散热回路、层间输运，都从这一层走。',
      '没有它，另外两层只是两片各自飘着的薄壳。',
    ],
  },
  {
    id: 'I6',
    chapter: '六 · 装甲层',
    title: '朝向真空的一面',
    cam: {
      lens: '35mm', ease: 'linear', shake: 0.22, up: [0, 1, 0],
      from: { pos: V(9.65, 1.70, 2.60), target: V(8.70, 0.60, 0.10), focus: 1.6, exposure: 1.06 },
      to:   { pos: V(9.65, 1.70, 0.40), target: V(8.70, 0.60, -2.10), focus: 1.6, exposure: 1.06 },
    },
    state: st({
      collector: false, truss: false, armor: true,
      plateDetail: 0.92, workLights: 0.6, bloom: 0.48, dof: 0.10, godrays: 0.35,
    }),
    lines: [
      '最外层是装甲层，半径八点七。它面对真空、微陨石和恒星风。',
      '外表面的瓦片阵列负责防护与辐射屏蔽，',
      '而点缀其上的工程灯，是这层壳体仍在被维护的证据。',
    ],
  },
  {
    id: 'I7',
    chapter: '七 · 运输',
    title: '地表到轨道的那条线',
    cam: {
      lens: '24mm', ease: 'inOut', shake: 0.30, up: [0, 1, 0],
      from: { pos: V(1.05, 0.28, 3.42), target: V(0.62, 0.02, 2.60), focus: 1.2, exposure: 1.06 },
      to:   { pos: V(1.62, 0.66, 3.56), target: V(1.10, 0.24, 2.60), focus: 1.7, exposure: 1.02 },
    },
    state: st({
      collector: false, truss: false, armor: false, showPlanet: true,
      starIntensity: 2.6, corona: 0.35, prominence: 0.30,
      climberCount: 28, pulseStrength: 1.0,
      bloom: 0.54, dof: 0.24, godrays: 0.5,
    }),
    lines: [
      '行星与轨道之间，靠太空电梯连接。',
      '编织缆索、同步站点和往复的攀爬舱，构成一条连续的供应链。',
      '巨构不是孤立停在太空里的，它得有东西不断上去。',
    ],
  },
  {
    id: 'I8',
    chapter: '八 · 人的尺度',
    title: '从地表看上去',
    cam: {
      // 与 S1 同一套地表机位，但这是重拍：镜头更靠近岩脊，停得更久
      lens: '24mm', ease: 'out', shake: 0.55, up: [1, 0, 0], ground: true,
      from: { pos: V(0.362, 0.055, 2.680), target: V(0.392, -0.050, 0), focus: 2.40, exposure: 0.98 },
      to:   { pos: V(0.372, 0.075, 2.698), target: V(0.402, -0.030, 0), focus: 2.50, exposure: 1.08 },
    },
    state: st({
      collector: false, truss: false, armor: false, showPlanet: true,
      groundDetail: 1, relief: 0,
      starIntensity: 3.0, corona: 0.22, prominence: 0.30,
      bloom: 0.62, threshold: 0.82, dof: 0, godrays: 0.6,
    }),
    lines: [
      '而从地表看，这一切只是地平线上的一道光。',
      '岩石、陨坑和桅杆，是整个巨构里唯一属于人的尺度。',
    ],
  },
  {
    id: 'I9',
    chapter: '九 · 运转',
    title: '它为什么不一起转',
    cam: {
      lens: '24mm', ease: 'linear', shake: 0.20, up: [0, 1, 0],
      from: { pos: V(18.6, 6.8, 17.2), target: V(-0.3, 0.6, 0), focus: 24, exposure: 1.06 },
      to:   { pos: V(28.0, 10.0, 26.0), target: V(0, 0.8, 0), focus: 32, exposure: 1.02 },
      orbit: -0.42,
    },
    state: st({
      explode: 0.75, cut: 0.45, seamWidth: 0.018,
      workLights: 1.2, shellSpin: 1.4, starIntensity: 3.2,
      bloom: 0.64, dof: 0.14,
    }),
    lines: [
      '还有一件容易被忽略的事：刚体壳不会像行星那样整体自转。',
      '球壳对内部不产生净引力，偏了也没有回复力，转起来只会失稳。',
      '所以三层以不同速率反向旋转，用角动量彼此抵消。',
      '这不是一个一次建成的物件，而是一组必须持续运转的系统。',
    ],
  },
];

/** 片头片尾的留白，以及句与句之间的呼吸 */
export const INTRO_PACING = {
  head: 1.4,          // 片头黑场 + 标题停留
  tail: 2.4,          // 片尾淡出
  gap: 0.34,          // 句间
  shotPad: 0.55,      // 每个镜头首尾各留一点，让画面先立住再开口
  fadeIn: 1.2,
  fadeOut: 2.0,
};

export const INTRO_TITLE = '一颗恒星，三层壳';
export const INTRO_SUBTITLE = '分层实心壳戴森球 · 结构与功能';
