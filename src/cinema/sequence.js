import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 六镜头 · 约 55 秒。
 * 每个镜头只有一个运动意图（推 / 移 / 环绕不叠加），
 * 且 shot.state 会把面板参数一起带到该镜头的设定。
 *
 * 切点策略（C4）：
 * - S3→S4 是**唯一**读作"同一镜头内持续"的切点：S4 的 from 精确接住 S3 的 to，
 *   机位在切点处不动，只有 explode / cut 开始上升（morph 0.075 ≈ 0.8s）。
 * - 其余切点都是换主体（地表→轨道、巨构→恒星、恒星→全景），硬切是正的，
 *   而且 morph 必须留 0 —— 否则上一镜的壳层会在新机位里多赖两秒。
 */
export const SEQUENCE = [
  {
    id: 'S1',
    name: '地表日出',
    dur: 8,
    // 24mm 而不是 35mm：从地表看恒星角直径约 40°，而 2.39 遮幅把垂直视场
    // 压到 eff ≈ 39°（24mm）／28°（35mm）。35mm 下「地平线到日面顶端」这 22°
    // 刚好顶满画幅，一点天空都不剩；只有 24mm 才留得住上下各约 8° 的呼吸。
    lens: '24mm',
    ease: 'inOut',
    shake: 0.9,
    breath: 1.0,
    up: [1, 0, 0],
    ground: true,
    from: { pos: V(0.3620, 0.0550, 2.680), target: V(0.3920, -0.050, 0.00), focus: 2.40, exposure: 0.96 },
    to:   { pos: V(0.3760, 0.0840, 2.705), target: V(0.4050, -0.015, 0.00), focus: 2.55, exposure: 1.12 },
    state: {
      collector: false, truss: false, armor: false, showPlanet: true,
      groundDetail: 1, explode: 0, cut: 0, assemble: 1,
      corona: 0.22, prominence: 0.30, starIntensity: 3.0,
      // relief 必须归零：地面道具是按「球面 R」摆的，而行星顶点位移能把表面
      // 抬高到 R + relief（默认 0.012），比最小的石头还高 —— 石头会整片埋进地里。
      // 位移在 S1 这个掠射机位下也根本不出剪影（地平线是球的切线决定的），
      // 所以归零不损失画面，反而把"地形轮廓"这件事交给真几何体。
      relief: 0,
      // S1 必须关景深。焦点在 2.4（恒星），而地面距离只有 0.07~0.18 ——
      // coc 的公式是 |z-focus|/z * aperture，这里的比值是 20 倍，任何
      // dof>0.02 都会被 clamp 到满模糊：地面整片糊成一团，摆多少石头都白搭。
      // 想让地面有"空气感"靠 haze 和 bloom，不靠景深。
      beam: 0.26, dof: 0,
      bloom: 0.62, threshold: 0.82,
    },
  },
  {
    id: 'S2',
    name: '攀升',
    dur: 12,
    lens: ['24mm', '50mm'],
    ease: 'inOut',
    shake: 0.55,
    breath: 1.0,
    up: [0, 1, 0],
    from: { pos: V(1.340, 0.200, 3.100), target: V(0.820, 0.020, 2.600), focus: 1.00, exposure: 1.06 },
    to:   { pos: V(1.660, 0.660, 3.440), target: V(1.120, 0.240, 2.600), focus: 1.70, exposure: 0.98 },
    state: {
      collector: false, truss: false, armor: false, showPlanet: true,
      groundDetail: 0, explode: 0, cut: 0, assemble: 1,
      corona: 0.20, prominence: 0.18, starIntensity: 2.4,
      dof: 0.32,
      bloom: 0.44, threshold: 0.88,
    },
  },
  {
    id: 'S3',
    name: '巨构全貌',
    dur: 10,
    lens: '24mm',
    ease: 'inOut',
    shake: 0.30,
    breath: 1.0,
    up: [0, 1, 0],
    from: { pos: V(20.0, 7.0, 18.0), target: V(0.9, 0.0, 0.0), focus: 27.0, exposure: 1.06 },
    to:   { pos: V(16.2, 5.8, 14.8), target: V(-0.6, 0.5, 0.0), focus: 22.0, exposure: 1.06 },
    state: {
      collector: true, truss: true, armor: true, showPlanet: false,
      explode: 0, cut: 0, assemble: 1,
      corona: 0.55, prominence: 0.50, starIntensity: 3.2,
      seamWidth: 0.014, plateDetail: 0.72, dof: 0.18,
      bloom: 0.62, threshold: 0.80,
    },
  },
  {
    id: 'S4',
    name: '分层揭示',
    // 14s → 11s：ease 'out' 在 3 秒内就把后退走完 97%，剩下 11 秒机位只挪
    // 0.8%，读起来是"卡住"不是"稳定"。11 秒刚好留下约 7 秒静止，
    // 让三层反向自转在没有镜头运动的干扰下被看清。
    dur: 11,
    lens: '24mm',
    // out：开头快、结尾慢。爆开那一瞬间镜头被"推"得猛，然后缓下来 ——
    // inOut 会让开头有个加速过程，读不出"被冲击推开"。
    ease: 'out',
    shake: 0.22,
    breath: 1.0,
    up: [0, 1, 0],
    // C4 转场：from 必须与 S3 的 to **完全一致**（pos / target / focus / exposure），
    // 切点处相机不动，只有 explode 开始上升，读作一个连续镜头而不是硬切。
    // 上一版 from 在 34 距离，S3 结束在 22.7，切点机位跳了 1.5 倍。
    // 之后一路后退到 31：球在眼前炸开变大，镜头被推开，最后停在能看清三层的位置。
    from: { pos: V(16.2, 5.8, 14.8), target: V(-0.6, 0.5, 0.0), focus: 22.0, exposure: 1.06 },
    to:   { pos: V(22.1, 7.9, 20.2), target: V(0.0, 0.4, 0.0), focus: 24.5, exposure: 1.04 },
    // 唯一带 morph 的镜头：11 秒 * 0.075 ≈ 0.82s 完成爆开。
    // 默认的 0.3 在 11 秒上要 3.3 秒才炸开 —— 那不是爆炸，是慢放。
    morph: 0.075,
    impact: 0.75,
    // 边后退边绕开孔轴约 35°：正对孔轴时三层壳叠成一根管子，
    // 反向自转看不出来；绕开之后才是三个能互相滑动的同心环。
    // orbit: 0.62,
    state: {
      collector: true, truss: true, armor: true, showPlanet: false,
      explode: 0.75, cut: 0.45, assemble: 1,
      corona: 0.60, prominence: 0.55, starIntensity: 3.4,
      seamWidth: 0.018, dof: 0.20,
      bloom: 0.70, threshold: 0.78,
    },
  },
  {
    id: 'S5',
    name: '恒星特写',
    dur: 8,
    lens: '85mm',
    ease: 'inOut',
    shake: 0.14,
    breath: 1.0,
    up: [0, 1, 0],
    from: { pos: V(7.30, 3.05, 7.10), target: V(0, 0, 0), focus: 10.4, exposure: 0.94 },
    to:   { pos: V(6.45, 2.72, 6.25), target: V(0, 0, 0), focus: 9.2, exposure: 0.98 },
    state: {
      collector: false, truss: false, armor: false, showPlanet: false,
      explode: 0, cut: 0, assemble: 1,
      corona: 0.50, prominence: 0.30, starIntensity: 3.4,
      convScale: 5.6, granule: 1.0, spots: 0.70, dof: 0.30,
      bloom: 0.50, threshold: 0.86,
    },
  },
  {
    id: 'S6',
    name: '收尾',
    dur: 6,
    lens: '35mm',
    // linear 而不是 out / inOut：两者在结尾速度归零，收尾镜头的最后两秒会"停住"。
    // linear 让它一直匀速退到淡出那一刻 —— 观众感到的是"我们还在离开"。
    ease: 'linear',
    shake: 0.24,
    breath: 1.0,
    up: [0, 1, 0],
    // 起手拉近到 29.6（S4 收在 31，但 S4 是管子所以尺度感完全不同），
    // 一路退到 42.7（+44%）—— 退幅要大于"看起来在动"的阈值。
    from: { pos: V(23.2, 8.3, 21.2), target: V(0, 0.9, 0), focus: 26.0, exposure: 1.06 },
    to:   { pos: V(30.3, 10.8, 27.6), target: V(0, 0.9, 0), focus: 36.0, exposure: 1.02 },
    // 环绕 36°：球体的轮廓在任何角度都一样，S3 和 S6 若都只是正面看一颗闭合球，
    // 六个镜头里就有两个同构图。区别只能来自"运动"和"表面扫过的光" ——
    // S3 是正面推进，S6 是绕着它转，网格和灯火在球面上扫过去。
    orbit: -0.62,
    state: {
      collector: true, truss: true, armor: true, showPlanet: false,
      explode: 0, cut: 0, assemble: 1,
      corona: 0.50, prominence: 0.40, starIntensity: 3.0,
      seamWidth: 0.018, dof: 0.22,
      bloom: 0.58, threshold: 0.83,
    },
  },
];

// prevState 让每个镜头开头能把上一镜头的参数平滑带过来
SEQUENCE.forEach((s, i) => {
  s.prevState = i > 0 ? SEQUENCE[i - 1].state : s.state;
});
