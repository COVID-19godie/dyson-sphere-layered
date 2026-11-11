/* 全部程序化，零外部贴图。shader 用模板字符串内联，省掉 vite-plugin-glsl。 */

import { Color, Vector2 } from 'three';

export const NOISE = /* glsl */ `
float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

/* ---------------------------------------------------------------- 恒星 */

export const STAR_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vWorld;
void main() {
  vPos = position;
  vNormalV = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const STAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uConvScale;
uniform float uFlow;
uniform float uGranule;
uniform float uSpots;
uniform float uSpin;
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vWorld;
${NOISE}

float ridged(vec3 p) { return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }

void main() {
  vec3 p = normalize(vPos);
  float t = uTime * uFlow;

  // 自转：把噪声采样坐标绕 Y 轴整体旋转，而不是让噪声原地形变。
  // 差别很大 —— 形变是「沸腾」，旋转才是「在转」：黑子、对流胞、米粒之间的
  // 相对位置保持不变，整幅图案刚体滑过可见面。mod 2π 是为了长时间运行后
  // 不丢浮点精度（3D 噪声本身不是周期的，但转满一圈图案会回到原位）。
  float spin = mod(uTime * uSpin, 6.28318530718);
  float cs = cos(spin), sn = sin(spin);
  vec3 ps = vec3(cs * p.x + sn * p.z, p.y, -sn * p.x + cs * p.z);

  // 域扭曲：让对流胞的边界流动、不呈规则格子
  vec3 warp = vec3(
    fbm(ps * 2.1 + vec3(0.0, t * 0.05, 0.0)),
    fbm(ps * 2.1 + vec3(5.2, 1.3, t * 0.04)),
    fbm(ps * 2.1 + vec3(9.1, 7.7, t * 0.06))
  ) - 0.5;
  vec3 q = ps * uConvScale + warp * 1.35 + vec3(0.0, t * 0.06, 0.0);

  float cell = fbm(q);
  float ridge = ridged(q * 1.8);

  // pxd：ps（单位球采样坐标）每像素变化多少。远处的恒星只占一两百像素时，
  // 高频米粒的周期会小于一个像素，采样出来是整片闪烁的噪点 —— 必须按它淡出。
  float pxd = length(fwidth(ps));
  float fineFade = 1.0 - smoothstep(0.0040, 0.0160, pxd);

  // 米粒组织。真实恒星的沸腾颗粒比"对流团"高两个数量级：原来只有
  // fbm(ps * 34) 且权重 0.22，在 convScale 5.6 的大斑旁边完全读不出颗粒，
  // 只读出同一档大色块 —— 这就是 85mm 特写下"熔岩团"的来源。
  // 这里刻意**不用 5 octave 的 fbm**：基频 100 的 fbm 最高 octave 到 1700，
  // 远超像素密度，加进去只会变成中频糊块，颗粒感反而消失。2 octave 正好。
  float gran = vnoise(ps * 118.0 + vec3(t * 0.34)) * 0.62
             + vnoise(ps * 232.0 + vec3(7.3, t * 0.30, 11.1)) * 0.38;
  float granRidge = ridged(ps * 88.0 + vec3(0.0, t * 0.26, 0.0));
  // 米粒之间的暗隙：真实米粒是"亮颗粒 + 暗网"，纯噪声只会像沙子
  float lanes = ridged(ps * 116.0 + vec3(t * 0.20, 3.7, 5.9));

  // 黑子：本影 + 半影。真实黑子的本影约占光球 20~30% 亮度，外面一圈半影
  // 更亮而且是**放射状细丝**，不是均匀过渡 —— 少了这层丝，暗斑就变成纯色块，
  // 大尺度下读作"大陆板块"而不是黑子（S5 特写踩过）。
  float spotField = vnoise(ps * 4.2 + vec3(11.0, 3.0, t * 0.02)) * 0.70
                  + vnoise(ps * 8.8 + vec3(3.3, 7.1, t * 0.02)) * 0.30;
  float spotCore = smoothstep(0.622, 0.664, spotField);
  float spotPen = smoothstep(0.582, 0.626, spotField);
  float spotFil = 0.55 + 0.45 * ridged(ps * 46.0 + vec3(t * 0.05, 1.7, 0.0));
  float shade = 1.0 - uSpots * (spotPen * 0.30 * spotFil + spotCore * 0.52);

  // 大尺度（对流团）只负责"明暗分布"，细尺度负责"质感"。
  // 注意 cell 的对比不能拉满：真实恒星表面的亮暗差只有 20~30%，画面里那种
  // 白热 vs 暗红的巨大反差是过曝和 bloom 造成的。拉满的话大斑块会吃掉整个
  // 动态范围，颗粒再细也被淹没 —— 这正是之前一直读作"熔岩团"的根本原因。
  float macro = ((cell - 0.5) * 1.1 + 0.5) * 0.66 + (ridge - 0.5) * 0.34;
  macro = smoothstep(0.10, 0.90, macro);

  // 米粒做**乘性**调制：亮区按比例加亮、暗区按比例压暗，整体平均不变。
  // 加成性的话整颗星会被高频噪声抬亮一档，颜色发白、层次变平。
  float grain = (gran - 0.5) * 0.66
              + (granRidge - 0.5) * 0.26
              - (lanes - 0.5) * 0.30;
  grain *= uGranule * fineFade;

  float lum = macro * 0.70 + 0.16;
  lum += grain * (0.50 + 0.44 * macro);
  lum = clamp(lum, 0.0, 1.0) * shade;

  vec3 c0 = vec3(0.26, 0.040, 0.008);
  vec3 c1 = vec3(0.92, 0.22, 0.020);
  vec3 c2 = vec3(1.00, 0.56, 0.11);
  vec3 c3 = vec3(1.00, 0.93, 0.74);
  vec3 col = mix(c0, c1, smoothstep(0.10, 0.38, lum));
  col = mix(col, c2, smoothstep(0.36, 0.66, lum));
  col = mix(col, c3, smoothstep(0.68, 0.95, lum));

  // 临边昏暗：边缘更暗更红，这是"球感"的命门
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(normalize(vNormalV), normalize((viewMatrix * vec4(V, 0.0)).xyz)), 0.0);
  col *= mix(0.30, 1.0, pow(ndv, 0.62));
  col = mix(col, col * vec3(1.0, 0.48, 0.22), pow(1.0 - ndv, 2.0) * 0.62);
  col += vec3(1.0, 0.36, 0.08) * pow(1.0 - ndv, 9.0) * 0.55;

  // 温和的指数压缩：保留明暗层次，只把最亮处交给 bloom
  col = 1.0 - exp(-col * uIntensity * 0.42);
  gl_FragColor = vec4(col * 1.55, 1.0);
}
`;

export const CORONA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uFlow;
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(normalize(vNormalV), normalize((viewMatrix * vec4(V, 0.0)).xyz)), 0.0);
  float rim = pow(1.0 - ndv, 2.4);

  vec3 d = normalize(vPos);
  float a = atan(d.z, d.x);
  float t = uTime * uFlow;
  float swirl = fbm(d * 5.0 + vec3(0.0, t * 0.10, 0.0));
  float streak = pow(0.5 + 0.5 * sin(a * 26.0 + swirl * 9.0), 5.0);
  float flicker = 0.78 + 0.22 * fbm(d * 3.0 + t * 0.16);

  float alpha = rim * (0.30 + streak * 0.85) * flicker * uStrength;
  vec3 col = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.68, 0.28), streak);
  gl_FragColor = vec4(col * (0.9 + streak * 0.8), alpha);
}
`;

/* 磁力线耀斑：沿 tube 的 uv.x 流动，首尾淡出 */
export const PROM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PROM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uFlow;
varying vec2 vUv;
void main() {
  float fade = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
  float pulse = pow(fract(vUv.x * 2.0 - uTime * 0.22 * uFlow), 10.0);
  float a = fade * (0.08 + pulse * 0.55) * uStrength;
  gl_FragColor = vec4(vec3(1.0, 0.42, 0.10) * 1.0, a);
}
`;

/* ---------------------------------------------------------------- 壳层 */

export const SHELL_VERT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uExplode;
uniform float uLayerOffset;
uniform float uAssemble;
varying vec3 vDir;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRadius;
void main() {
  vec3 n = normalize(position);
  float t = uAssemble;
  float lump = sin(n.x * 9.0 + uTime * 0.2) *
               sin(n.y * 11.0 + uTime * 0.13) *
               sin(n.z * 7.0) * (1.0 - t) * 0.55;
  float R = uRadius
          + uExplode * uLayerOffset
          + (1.0 - t) * 0.10 * uRadius
          + lump;
  vec3 p = n * R;

  vDir = n;
  vRadius = R;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCutD;
uniform float uSeamWidth;
uniform float uFade;
uniform float uFresnel;
uniform float uTilesU;
uniform float uTilesV;
uniform float uHoneycomb;
uniform float uLattice;
uniform float uReveal;
uniform float uPlateDetail;
uniform vec3 uColorOut;
uniform vec3 uColorIn;
uniform vec3 uSeamColor;
uniform vec3 uEnergyColor;
varying vec3 vDir;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRadius;
${NOISE}

void main() {
  // 自写剖切：比 clippingPlanes 简单，且不必给 ShaderMaterial 注入裁剪 chunk
  if (vWorld.x > uCutD) discard;
  if (uFade < 0.01) discard;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(N, V));
  // 球缘处球面 UV 的导数爆炸，缝会被拉成宽带；按视角淡出，保住"一个球"的完整轮廓
  float limbFade = smoothstep(0.04, 0.32, facing);

  vec3 n = normalize(vDir);
  float u = atan(n.z, n.x) * 0.15915494 + 0.5;
  float v = asin(clamp(n.y, -1.0, 1.0)) * 0.31830989 + 0.5;
  vec2 tile = vec2(u * uTilesU, v * uTilesV);

  if (uHoneycomb > 0.5) {
    tile.x += mod(floor(tile.y), 2.0) * 0.5;
  }

  vec2 g = fract(tile);
  vec2 d = min(g, 1.0 - g);
  float edge = min(d.x, d.y);
  float px = max(fwidth(tile.x), fwidth(tile.y));
  // 远景一个瓦片只占几像素，倒角 / 铆点 / 次级线会并成一张亮网格（线框球）。
  // 按屏幕导数淡出细节，近景 plate 视角再完整补回。
  // 远景球直径约 390px / 120 列时 px≈0.15，阈值必须压到 0.055 以下才能真的归零
  float detailFade = 1.0 - smoothstep(0.012, 0.055, px);
  float aa = clamp(px * 1.1, 0.0015, 0.035);
  // 近景时把缝钳到约 2 像素，否则按瓦片比例算会变成粗橙带
  float w = min(uSeamWidth, px * 1.8);
  float seam = (1.0 - smoothstep(w, w + aa, edge)) * limbFade;

  float tid = hash21(floor(tile) + 7.31);
  // 分层模式下按瓦片逐渐"掀开"，露出内层。
  // revealFade：远景一块 tile 只有约 3 像素，掀开的洞里透出的内层桁架线会被
  // 采样成一片白色碎十字，完全不读作"洞"只读作噪点；所以掀板必须随像素密度
  // 淡出 —— 远景保持完整球壳轮廓，近景才真的掀板。
  float revealFade = 1.0 - smoothstep(0.018, 0.050, px);
  if (uReveal > 0.001 && hash21(floor(tile) + 19.7) < uReveal * revealFade) discard;

  bool front = gl_FrontFacing;
  vec3 Nf = front ? N : -N;
  vec3 L = normalize(-vWorld);
  float lit = max(dot(Nf, L), 0.0);
  float fres = pow(1.0 - facing, 3.0);

  vec3 base = front ? uColorOut : uColorIn;
  // 每块板的个体色差，少量"烧蚀板"偏暖
  base *= 0.70 + 0.52 * tid * (0.25 + 0.75 * detailFade);
  base = mix(base, base * vec3(1.18, 0.92, 0.76), step(0.86, tid) * 0.6 * uPlateDetail);
  base *= front ? (0.68 + 0.40 * lit) : (0.32 + 0.52 * lit);

  // 板面磨损 + 细颗粒 + 次级分割线（大板里套小板）
  float wear = vnoise(vec3(tile * 0.8, tid * 17.0));
  float fine = vnoise(vec3(tile * 7.0, tid * 11.0));
  base *= mix(1.0, (0.82 + 0.36 * wear) * (0.90 + 0.20 * fine), uPlateDetail * detailFade);
  vec2 sub = fract(tile * 3.0);
  float subEdge = min(min(sub.x, 1.0 - sub.x), min(sub.y, 1.0 - sub.y));
  float subLine = (1.0 - smoothstep(0.012, 0.035, subEdge)) * uPlateDetail * 0.16;
  base += uEnergyColor * subLine * 0.35 * detailFade;

  // 倒角：跟随屏幕像素宽度的亮边 + 内侧暗槽，让"板"有厚度
  float bw = min(0.055, px * 4.0);
  float bevel = smoothstep(w, w + bw, edge) - smoothstep(w + bw, w + bw * 2.0, edge);
  float groove = smoothstep(w, w + bw, edge);
  base *= 1.0 - 0.28 * (1.0 - groove) * detailFade;

  vec3 col = base + vec3(0.10, 0.15, 0.21) * bevel * uPlateDetail * detailFade;
  // 四角铆点
  float rivet = 1.0 - smoothstep(0.018, 0.055, length(d));
  col += uEnergyColor * rivet * 0.20 * uPlateDetail * limbFade * detailFade;
  // 金属高光
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(Nf, H), 0.0), 26.0) * limbFade;
  col += uEnergyColor * spec * 0.16 * uPlateDetail * detailFade;

  if (uLattice > 0.5) {
    float line = (1.0 - smoothstep(w * 0.30, w * 0.30 + aa, edge)) * limbFade;
    col = uColorOut * (0.30 + 0.18 * tid);
    col += uEnergyColor * line * 0.95;
  } else {
    // 合拢态不该是一整张发光网格：绝大多数板缝只是暗槽，只有少量"通电"板
    // 才有橙色脉络并沿经向缓慢流动，这样读起来才是"极细脉络"而非网格球
    float circuit = hash21(floor(tile) + 31.7);
    float charged = smoothstep(0.94, 0.99, circuit);   // active 是 GLSL 保留字
    float flow = 0.55 + 0.45 * pow(fract(u * 6.0 - uTime * 0.10 + circuit * 4.0), 8.0);
    // 每块通电板只点亮一对边（随机横或竖）：整块描边在远景会变成一张张"贴纸"，
    // 只留单边就退化成断续短划，远看像板面上一段段供电线路。
    float pickX = step(0.5, hash21(floor(tile) + 53.1));
    float nearX = step(d.x, d.y);
    float edgeOn = mix(1.0 - nearX, nearX, pickX);
    // 远景连暗槽基线也淡出：94% 的板缝纯黑，球面连续安静，只留少量通电脉络
    float seamGlow = seam * (0.09 * detailFade + charged * 0.91 * flow * edgeOn);
    col += uSeamColor * seamGlow * (front ? 1.0 : 1.4) * 0.88;
    col += uEnergyColor * seam * charged * flow * edgeOn * 0.10;
  }

  col += uEnergyColor * fres * uFresnel * 0.55;

  // 合拢态外表面看不到恒星，板面只靠 lambert 就是均匀近黑、只剩缝发光。
  // 补一层程序化天光的大尺度明暗 + 球缘极淡暖光，让球读成实体而不是线框。
  vec3 keyDir = normalize(vec3(0.55, 0.42, 0.72));
  float envGrad = 0.5 + 0.5 * dot(Nf, keyDir);
  // 只给极淡的天光梯度：linear HDR 里 0.05 经 ACES 会亮成灰蓝球，量级要压到 0.01
  vec3 env = mix(vec3(0.0025, 0.0045, 0.0080), vec3(0.014, 0.022, 0.034), envGrad);
  col += env * (0.65 + 0.35 * uPlateDetail);
  col += vec3(0.030, 0.016, 0.007) * pow(1.0 - facing, 4.0) * 0.55;

  gl_FragColor = vec4(col, uFade);
}
`;

/* 剖切面：一个圆环，精确表达壳体厚度。uInner 为归一化内半径。 */
export const CAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CAP_FRAG = /* glsl */ `
uniform float uInner;
uniform vec3 uColor;
uniform vec3 uRim;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  if (r > 1.0 || r < uInner) discard;
  vec3 col = uColor * (0.45 + 0.55 * (1.0 - r));
  float outer = smoothstep(0.955, 0.998, r);
  float inner = 1.0 - smoothstep(uInner, uInner + 0.012, r);
  col += uRim * (outer + inner * 0.6) * 0.62;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------------------------------------------------------------- 行星 */

export const PLANET_VERT = /* glsl */ `
uniform float uRelief;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vRelief;
${NOISE}
void main() {
  vec3 n = normalize(position);
  // 顶点数多，只用 3 octave 做山脉，别把 fbm 搬进 vertex shader
  float h = vnoise(n * 4.0) * 0.60 + vnoise(n * 11.0) * 0.28 + vnoise(n * 27.0) * 0.12;
  h = smoothstep(0.30, 0.72, h);
  float land = smoothstep(0.47, 0.56, vnoise(n * 4.0 + 3.1));
  vec3 p = position + normal * (h * land * uRelief);
  vPos = p;
  vRelief = h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PLANET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCity;
uniform float uGroundDetail;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vRelief;
${NOISE}
void main() {
  vec3 n = normalize(vPos);
  float land0 = vnoise(n * 4.0 + 3.1);
  float land = smoothstep(0.47, 0.56, land0);
  float coast = 1.0 - smoothstep(0.0, 0.028, abs(land0 - 0.515));

  vec3 sea   = vec3(0.018, 0.055, 0.105);
  vec3 low   = vec3(0.10, 0.16, 0.11);
  vec3 rock  = vec3(0.22, 0.21, 0.19);
  vec3 snow  = vec3(0.72, 0.76, 0.80);
  vec3 col = mix(sea, mix(low, rock, smoothstep(0.25, 0.75, vRelief)), land);
  col = mix(col, snow, land * smoothstep(0.78, 0.95, vRelief));
  col += vec3(0.16, 0.24, 0.28) * coast * 0.45;

  // 恒星在原点：光照方向是从表面指向原点，而不是指向行星中心
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(-vWorld);
  float ndl = dot(N, L);
  float day = max(ndl, 0.0);
  float night = smoothstep(0.10, -0.16, ndl);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * (1.0 - land) * day;
  col += vec3(1.0, 0.72, 0.40) * spec * 1.4;
  col *= 0.10 + 1.05 * day;

  // 城市灯：网格化聚落，只落在低地陆地，带轻微闪烁
  vec2 cu = vec2(atan(n.z, n.x) * 3.0, asin(clamp(n.y, -1.0, 1.0)) * 6.0);
  vec2 cell = floor(cu * 15.0);
  float grid = step(0.86, hash21(cell)) * step(0.45, hash21(cell + 3.7));
  float city = grid * smoothstep(0.55, 0.78, vnoise(n * 46.0))
             * land * (1.0 - smoothstep(0.50, 0.85, vRelief));
  float twinkle = 0.80 + 0.20 * sin(uTime * 2.0 + hash21(cell) * 30.0);
  col += vec3(1.0, 0.76, 0.40) * city * night * uCity * 1.6 * twinkle;

  // 近景地面细节：只在贴地视角打开。频率必须高到像素级 —— 贴地时相机离地
  // 只有 0.016（行星半径 0.35），可见范围在球面坐标里约 0.01，原来 n*150 在这个
  // 尺度上只画出几个大斑，整片地面仍读作一块纯色（S1 开场一直是这个毛病）。
  // 高频靠 fwidth 淡出，远景自动退回低频，不会 aliasing。
  if (uGroundDetail > 0.01) {
    float fw = fwidth(n.x) + fwidth(n.y) + fwidth(n.z);
    // 分三层，缺一层就会出现"近景有沙子、远景一片纯色"的断层：
    //   中频（38/84）岩石群与沟壑 —— 远景也读得出，是"地面不平"的主要来源
    //   高频（900/2100）砂砾 —— 只有贴地几米内看得见
    // 频率按"贴地时到底能看多远"算：相机离地 0.016、行星半径 0.35，地平线在
    // sqrt(2*R*h) ≈ 0.106 单位外，对应地心角 0.3 弧度（17°）。所以频率 38 在这
    // 片范围内只画出不到两个起伏 —— 那还是"没有细节"。可分辨上限约 300
    // （周期 > 2px），取 150 / 320 两档。
    float midFade = 1.0 - smoothstep(0.0020, 0.0070, fw);
    float mid = vnoise(n * 150.0) * 0.55 + vnoise(n * 320.0) * 0.45;
    // 分布范围拉大到 0.048~0.272（约 5.7:1），接近真实地表 rock/sand/basalt 的
    // albedo 差异。原来 0.072~0.248（3.4:1）在这个亮度下画不出地形。
    vec3 midCol = mix(vec3(0.048, 0.047, 0.043), vec3(0.272, 0.253, 0.212), mid);
    midCol = mix(midCol, vec3(0.090, 0.130, 0.085), smoothstep(0.58, 0.78, vnoise(n * 17.0)) * 0.45);
    // 权重里不能再乘 day：S1 的日出是"太阳刚露头、脚下还在晨昏线暗侧"，
    // 实测前景 day ≈ 0（把 day 输出成灰度图，脚下整片近黑，只有零星掠射点）。
    // 暗部里 albedo 是**唯一**的信息源，原来的 0.18 系数把它压到几乎不可见，
    // 整片地面只剩"环境光常数 × 单一底色"，于是读作一整块光滑斜坡。
    // 0.42 的提法有物理依据：夜空下的地面靠星光/气辉/地照也有亮度，
    // 不是靠直射太阳才有纹理。取 0.62 会把地面整体抬亮 47%（读作"已经天亮了"），
    // 所以收在 0.42 —— 均值回到原位，对比度靠上面拉大的 albedo 分布拿到。
    col = mix(col, midCol * (0.42 + 0.55 * day), uGroundDetail * land * midFade * 0.92);

    float nearFade = 1.0 - smoothstep(0.0010, 0.0045, fw);
    float grain = vnoise(n * 900.0) * 0.65 + vnoise(n * 2100.0) * 0.35;
    col *= mix(1.0, 0.76 + 0.48 * grain, uGroundDetail * land * nearFade);
  }

  // 地面大气透视。GRADE 里那套 haze 的 hazeStart 是 4、hazeFall 是 30，
  // 是按球壳尺度（半径 7~9）定的；贴地时地面最远也就 0.1 个单位，那套雾完全
  // 不起作用，于是地面从脚下到地平线一点衰减都没有，整片读作一块平灰。
  // 这里按局部尺度单独做一层，地平线才会真正融进大气里。
  float dist = length(cameraPosition - vWorld);
  // 衰减距离要按可见范围（地平线约 0.106 单位）定：指数取 5 时脚下几乎无雾、
  // 地平线约 24%。之前取 13 是整片地面一起罩进雾里，反而更平。
  float fogAmt = 1.0 - exp(-dist * 5.0);
  // 必须用 uGroundDetail 门控：轨道视角（S2）相机离行星 3.4，dist 会让
  // fogAmt 直接饱和到 1，整颗行星会被这层近地雾吞成橙色。
  col = mix(col, vec3(0.30, 0.108, 0.040), fogAmt * 0.62 * clamp(uGroundDetail, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

export const CLOUD_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CLOUD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCloud;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 n = normalize(vPos);
  float c = fbm(n * 5.0 + vec3(uTime * 0.006, 0.0, 0.0));
  float a = smoothstep(0.46, 0.70, c) * uCloud;
  if (a < 0.01) discard;
  vec3 L = normalize(-vWorld);
  float day = max(dot(normalize(vNormalW), L), 0.0);
  vec3 col = mix(vec3(0.16, 0.20, 0.26), vec3(0.95, 0.95, 0.96), 0.25 + 0.75 * day);
  gl_FragColor = vec4(col, a * 0.50);
}
`;

export const ATMO_FRAG = /* glsl */ `
uniform float uAtmo;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 L = normalize(-vWorld);
  // 晨昏线附近混入暖橙，这就是第一幕"日出橙边"的来源
  float twilight = exp(-abs(dot(N, L)) * 5.0);
  vec3 cool = mix(vec3(0.18, 0.48, 1.0), vec3(0.55, 0.74, 1.0), fres);
  vec3 warm = vec3(1.0, 0.38, 0.10);
  vec3 col = mix(cool, warm, twilight * 0.82);
  float a = fres * uAtmo;
  gl_FragColor = vec4(col * (1.0 + fres * 1.2), a);
}
`;

/* ------------------------------------------------------- 太空电梯（M4） */

/* 缆线几何自带 aOff（管截面偏移）、aX / aHelixR / aPhase / aT。
   螺旋圈数、管径缩放、glow 外推全在 vertex 里算，改参数不重建几何。 */
export const CABLE_VERT = /* glsl */ `
uniform float uRadiusScale;
uniform float uGrow;
uniform float uTurns;
attribute vec3 aOff;
attribute float aX;
attribute float aHelixR;
attribute float aPhase;
attribute float aT;
varying float vT;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  float th = aT * uTurns * 6.2831853 + aPhase;
  vec3 axis = vec3(aX, cos(th) * aHelixR, sin(th) * aHelixR);
  // 贴地/轨道近景里相机可能离缆线不到 0.1，真实管径会被透视放大成色块。
  // 按相机距离收回管径，保持屏幕空间粗细大致恒定；远景仍是完整编织。
  float dCam = length(cameraPosition - (modelMatrix * vec4(axis, 1.0)).xyz);
  float thin = mix(0.12, 1.0, smoothstep(0.20, 1.70, dCam));
  vec3 n = normalize(aOff);
  vec3 p = vec3(aX, cos(th) * aHelixR * thin, sin(th) * aHelixR * thin)
         + (aOff * uRadiusScale + n * uGrow) * thin;
  vT = aT;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CABLE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulseSpeed;
uniform float uPulseStrength;
uniform float uAtmoT;
uniform vec3 uBase;
uniform vec3 uEnergy;
uniform vec3 uAtmo;
varying float vT;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 L = normalize(-vWorld);          // 恒星在原点
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  // 从外侧看缆线大多是背光面，暗部要留基线，否则只剩剪影、编织读不出来
  float lit = 0.55 + 0.45 * max(dot(N, L), 0.0);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);

  float pulse = pow(fract(vT * 3.0 - uTime * uPulseSpeed), 12.0);
  vec3 col = uBase * lit;
  col += uEnergy * pulse * uPulseStrength * 0.72;
  col += uEnergy * fres * 0.34;   // 管截面冷边，勾出三股螺旋

  // 大气穿透：近地表的一段被散射染成暖橙，越往上越淡
  float atmos = 1.0 - smoothstep(0.0, uAtmoT, vT);
  col = mix(col, uAtmo * 0.75, atmos * 0.60);
  col += uAtmo * atmos * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* 加法叠加层：只输出脉冲与大气段，让第一幕里那根线真的看得见 */
export const CABLE_GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulseSpeed;
uniform float uPulseStrength;
uniform float uAtmoT;
uniform vec3 uEnergy;
uniform vec3 uAtmo;
varying float vT;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  float pulse = pow(fract(vT * 3.0 - uTime * uPulseSpeed), 12.0);
  float atmos = 1.0 - smoothstep(0.0, uAtmoT, vT);
  // DoubleSide + 加法混合原本把每个管叠 4 层，整条缆线烧成白带；这里只留一点呼吸感
  float a = pulse * uPulseStrength * 0.28 + atmos * 0.12;
  if (a < 0.004) discard;
  vec3 col = uEnergy * pulse * uPulseStrength * 0.85 + uAtmo * atmos * 0.65;
  gl_FragColor = vec4(col, a);
}
`;

export const TRAIL_VERT = /* glsl */ `
uniform float uPixelRatio;
attribute float aFade;
varying float vFade;
void main() {
  vFade = aFade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 视角离缆线只有 ~1.7，30/z 会把点放大到 50+ px；改成近场也只占几像素
  gl_PointSize = (0.8 + aFade * 1.4) * uPixelRatio * (2.4 / max(-mv.z, 0.25));
  gl_Position = projectionMatrix * mv;
}
`;

export const TRAIL_FRAG = /* glsl */ `
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.10, 0.5, d)) * vFade * 0.55;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.32, 0.72, 0.95) * 0.90, a);
}
`;

/* 贴地视角的天空：相机居中的加法混合穹顶，只加一道暖色地平线辉光 */
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uUp;
uniform float uStrength;
varying vec3 vDir;
void main() {
  float h = 1.0 - abs(dot(normalize(vDir), normalize(uUp)));
  float band = pow(h, 22.0);
  float glow = pow(h, 6.0) * 0.12;
  vec3 col = vec3(1.0, 0.42, 0.12) * band + vec3(0.10, 0.20, 0.38) * glow;
  float a = (band + glow) * uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * uStrength, a);
}
`;

/* 塔基向上的能量束：沿 y 流动的细脉冲 */
export const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float fade = 1.0 - smoothstep(0.0, 1.0, vUv.y);
  float pulse = pow(fract(vUv.y * 3.0 - uTime * 0.5), 10.0);
  float a = fade * (0.06 + pulse * 0.55) * uStrength;
  gl_FragColor = vec4(vec3(1.0, 0.62, 0.24) * 1.4, a);
}
`;

/* ---------------------------------------------------------------- 星空 / 能量点 */

export const POINTS_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = 0.70 + 0.30 * sin(uTime * 1.7 + aPhase);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * aSize * uPixelRatio * (60.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.12, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

export const FLOW_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aPhase;
varying float vAlpha;
void main() {
  float pulse = pow(fract(aPhase - uTime * 0.16), 14.0);
  vAlpha = 0.18 + pulse * 1.0;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (1.4 + pulse * 3.4) * uPixelRatio * (30.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

export const FLOW_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.42, 0.90, 1.0) * (1.0 + vAlpha), a);
}
`;

/* 工程灯：装甲层表面的成串小灯。给合拢态一个「这球是活的」的证据 ——
   没有它，那颗「完整安静的球」读起来就是一个静止模型。 */
export const WORKLIGHT_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
attribute float aPhase;
attribute float aKind;
varying float vOn;
varying float vKind;
void main() {
  float blink = pow(max(sin(uTime * 1.3 + aPhase * 6.2831853), 0.0), 16.0);
  // 基础亮度必须够：远景灯点是唯一能读出"这颗球有 8 倍行星半径"的证据，
  // 压暗就等于把尺度参照物删了。
  vOn = 0.34 + blink * 1.45;
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float persp = 26.0 / max(-mv.z, 1.0);
  // 透视缩小后必须钳到约 2 像素：远处的城市灯火也是一个像素的光斑，
  // 不会因为远就直接消失；不钳的话整片灯带在远景被采样成 0。
  gl_PointSize = clamp(uSize * uPixelRatio * persp * (1.0 + blink * 0.8),
                       2.2 * uPixelRatio, 30.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

export const WORKLIGHT_FRAG = /* glsl */ `
varying float vOn;
varying float vKind;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.14, 0.5, d)) * vOn;
  if (a < 0.006) discard;
  // 钠灯暖白为主，少量冷白检修灯 —— 暖色正好和 teal-orange 分级里的高光同向
  vec3 col = mix(vec3(1.00, 0.76, 0.46), vec3(0.74, 0.87, 1.00), step(0.92, vKind));
  col *= 0.80 + 0.40 * (1.0 - d * 2.0);
  gl_FragColor = vec4(col * vOn, a);
}
`;

/* ---------------------------------------------------------------- 后期调色 */

/* --------------------------------------------------- 景深 / 体积光 / 曝光 */

/* 深度取自 RenderPass 的 DepthTexture —— 它天然尊重 shader 里的 discard，
   所以剖切开口、掀板、层显隐的深度都是对的（BokehPass 覆盖材质重渲会把它们抹掉）。 */
const LINEAR_DEPTH = /* glsl */ `
float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
`;

export const DOF_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
    uFocus: { value: 10 },
    uAperture: { value: 1.0 },
    uMaxBlur: { value: 10 },
    uEnabled: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uAperture;
    uniform float uMaxBlur;
    uniform float uEnabled;
    varying vec2 vUv;
    ${LINEAR_DEPTH}

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uEnabled < 0.001) { gl_FragColor = base; return; }

      float z = viewZ(vUv);
      float coc = clamp(abs(z - uFocus) / max(z, 1e-3) * uAperture, 0.0, 1.0) * uMaxBlur;
      if (coc < 0.25) { gl_FragColor = base; return; }

      vec2 texel = fwidth(vUv);          // 全屏 quad 上即 1/分辨率
      vec2 c = vUv - 0.5;
      float rad = length(c);
      vec2 dir = normalize(c + 1e-5);
      // 猫眼：真实光圈在画面边缘会把散景沿径向压扁
      float cat = smoothstep(0.55, 1.0, rad) * 0.55;

      vec3 acc = base.rgb;
      float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float ang = fi * 2.39996323 + 0.7;
        float rr = sqrt((fi + 0.5) / 16.0) * coc;
        vec2 off = vec2(cos(ang), sin(ang)) * rr;
        off -= dir * dot(off, dir) * cat;
        acc += texture2D(tDiffuse, vUv + off * texel).rgb;
        wsum += 1.0;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }
  `,
};

/* 体积光：只输出光柱本身（不含原图），半分辨率渲染后由 COMP 叠回 */
export const GODRAYS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uSunUV: { value: new Vector2(0.5, 0.5) },
    uVisible: { value: 0 },
    uDensity: { value: 0.9 },
    uDecay: { value: 0.94 },
    uThreshold: { value: 1.1 },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uSunUV;
    uniform float uVisible;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uThreshold;
    uniform float uNear;
    uniform float uFar;
    varying vec2 vUv;
    ${LINEAR_DEPTH}

    #define STEPS 20

    void main() {
      if (uVisible < 0.001) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

      float sceneZ = viewZ(vUv);
      vec2 delta = (vUv - uSunUV) * (uDensity / float(STEPS));
      vec2 uv = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);

      for (int i = 0; i < STEPS; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        // 采样点比当前像素更近 → 被前景挡住，透光大幅衰减（不硬切，保留一点散射）
        float occ = viewZ(uv) < sceneZ * 0.96 ? 0.12 : 1.0;
        acc += s * smoothstep(uThreshold, uThreshold + 1.2, lum) * illum * occ;
        illum *= uDecay;
      }
      gl_FragColor = vec4(acc / float(STEPS) * uVisible, 1.0);
    }
  `,
};

export const GODRAYS_COMP_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tRays: { value: null },
    uStrength: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tRays;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 rays = texture2D(tRays, vUv).rgb;   // 半分辨率双线性上采样，天然柔化
      gl_FragColor = vec4(base + rays * uStrength, 1.0);
    }
  `,
};

/* 曝光适应：先算 log-average 亮度到 1x1，再做时间平滑 */
export const LUM_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      float sum = 0.0;
      for (int y = 0; y < 5; y++) {
        for (int x = 0; x < 5; x++) {
          vec2 uv = (vec2(float(x), float(y)) + 0.5) / 5.0;
          vec3 c = texture2D(tDiffuse, uv).rgb;
          sum += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
        }
      }
      float avg = exp(sum / 25.0);
      gl_FragColor = vec4(avg, avg, avg, 1.0);
    }
  `,
};

export const ADAPT_SHADER = {
  uniforms: {
    tLum: { value: null },
    tPrev: { value: null },
    uRate: { value: 0.1 },
    uKey: { value: 0.20 },
    uMin: { value: 0.55 },
    uMax: { value: 1.85 },
    uBias: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tLum;
    uniform sampler2D tPrev;
    uniform float uRate;
    uniform float uKey;
    uniform float uMin;
    uniform float uMax;
    uniform float uBias;
    varying vec2 vUv;
    void main() {
      float lum = texture2D(tLum, vec2(0.5)).r;
      float prev = texture2D(tPrev, vec2(0.5)).r;
      float target = clamp(uKey / max(lum, 1e-4) * uBias, uMin, uMax);
      float adapted = mix(prev, target, uRate);
      gl_FragColor = vec4(adapted, adapted, adapted, 1.0);
    }
  `,
};

export const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tExposure: { value: null },
    uAutoExposure: { value: 0 },
    uAberration: { value: 0.0035 },
    uHalation: { value: 0.70 },
    uHaloRadius: { value: 0.080 },
    uSharp: { value: 0.15 },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
    // 大气透视：远景向散射色靠拢，给巨构压出空气厚度
    uHaze: { value: 0.0 },
    uHazeStart: { value: 4.0 },
    uHazeFall: { value: 30.0 },
    uHazeColor: { value: new Color(0.055, 0.042, 0.030) },
    // anamorphic：水平拉丝 + 光圈鬼影，只在恒星真正露出来时才出现
    uSunUV: { value: new Vector2(0.5, 0.5) },
    uSunVisible: { value: 0 },
    uSunDepth: { value: 10 },
    uFlare: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tExposure;
    uniform float uAutoExposure;
    uniform float uAberration;
    uniform float uHalation;
    uniform float uHaloRadius;
    uniform float uSharp;
    uniform float uNear;
    uniform float uFar;
    uniform float uHaze;
    uniform float uHazeStart;
    uniform float uHazeFall;
    uniform vec3 uHazeColor;
    uniform vec2 uSunUV;
    uniform float uSunVisible;
    uniform float uSunDepth;
    uniform float uFlare;
    varying vec2 vUv;
    ${LINEAR_DEPTH}

    // interleaved gradient noise：比 sin-hash 白噪分布均匀，不结块
    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 texel = fwidth(vUv);        // 全屏 quad 上即 1/分辨率，省掉一个 uniform
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ab = uAberration * r2 * 4.0;

      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;

      // 大气透视：远处向散射色靠拢。深度取自场景 RT —— 剖切开口 / 掀板处的
      // 真实距离，所以不会把「透过开口看到的恒星」误判成远景而糊上一层雾。
      if (uHaze > 0.001) {
        float z = viewZ(vUv);
        float h = 1.0 - exp(-max(z - uHazeStart, 0.0) / max(uHazeFall, 0.001));
        col = mix(col, uHazeColor, clamp(h * uHaze, 0.0, 0.92));
      }

      // 轻微 unsharp：MSAA 后细线仍会被 bloom 糊掉，把板缝 / 缆线拉回一点
      vec3 nb = (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb
               + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
      col += (col - nb) * uSharp;

      // 胶片 halation：与 bloom 分开。三个结构差异 —— 只有真亮源触发(gate)、
      // 比 bloom 宽得多、红扩散半径最大绿次之蓝最小。给 blur 染橙色是假胶片。
      if (uHalation > 0.001) {
        vec3 halo = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float fi = float(i);
          float ang = fi * 2.39996323;              // golden angle 均匀盘分布
          float rad = sqrt((fi + 0.5) / 12.0);
          vec2 off = vec2(cos(ang), sin(ang)) * rad * uHaloRadius;
          off.x *= texel.x / texel.y;              // 修正宽高比，光晕保持圆
          vec3 s = texture2D(tDiffuse, vUv + off).rgb;
          float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
          float gate = smoothstep(0.65, 1.60, lum);
          vec3 spread = vec3(exp(-rad * 1.8), exp(-rad * 3.0), exp(-rad * 4.6));
          halo += s * gate * spread;
        }
        // 12 tap 求平均会把光晕稀释掉：亮源只占少数 tap，改用较松的归一
        col += halo * (uHalation / 8.0);
      }

      // anamorphic 光晕：变形宽银幕镜头的光学特征 —— 一道横向拉丝 + 沿光轴
      // 排开的光圈鬼影。两处关键：只在恒星真的在画面里、且没被挡住时才加
      // （屏幕位置有前景深度 → 判定遮挡）；拉丝在 y 方向衰减远快于 x。
      if (uFlare > 0.001 && uSunVisible > 0.001) {
        float occ = smoothstep(uSunDepth * 0.72, uSunDepth * 0.97, viewZ(uSunUV));
        float k = uFlare * uSunVisible * occ;
        if (k > 0.001) {
          vec2 d = vUv - uSunUV;
          float streak = exp(-abs(d.x) * 4.2) * exp(-abs(d.y) * 190.0);
          float core = exp(-length(vec2(d.x * 0.60, d.y * 1.85)) * 10.0);
          col += (vec3(0.52, 0.74, 1.00) * streak * 0.24
                + vec3(1.00, 0.72, 0.44) * core * 0.16) * k;

          vec2 toC = vec2(0.5) - uSunUV;
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            vec2 gc = uSunUV + toC * (0.62 + fi * 0.52) * 1.75;
            float gr = 0.016 + fi * 0.013;
            float g = smoothstep(gr, gr * 0.12, length((vUv - gc) * vec2(1.0, 1.32)));
            vec3 gt = mix(vec3(0.42, 0.70, 1.00), vec3(1.00, 0.58, 0.34), fract(fi * 0.41));
            col += gt * g * 0.085 * k;
          }
        }
      }

      // 曝光适应：tExposure 是 1×1 的时间平滑结果，1.0 表示「不加不减」
      if (uAutoExposure > 0.001) {
        float e = texture2D(tExposure, vec2(0.5)).r;
        col *= mix(1.0, e, uAutoExposure);
      }

      // 暗角 / 颗粒 / dither / 遮幅 全部搬到 OutputPass 之后的 FINAL_SHADER：
      // 那是显示空间，才是「最终影像」该被处理的地方。这里只留线性 HDR 该做的事。
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* 最终分级：跑在 OutputPass 之后，输入已经是 tonemap + sRGB 编好的显示空间图像。
   这一步只做「影像」该做的事 —— 分级、暗角、颗粒、抖动、遮幅。
   放在这里而不是线性 HDR 里的原因：lift / gamma / gain 和胶片颗粒本来就是
   对最终画面的操作，在线性空间做会得到完全不同的曲线，且颗粒会被 tonemap 压扁。 */
export const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.022 },
    uDither: { value: 0.60 },
    uVignette: { value: 0.34 },
    uLetterboxBar: { value: 0 },
    uGrade: { value: 1 },
    uLift: { value: new Color(0.006, 0.012, 0.020) },
    uGain: { value: new Color(1.06, 1.00, 0.94) },
    uSat: { value: 0.92 },
    uContrast: { value: 0.22 },
    uGamma: { value: 1.00 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uDither;
    uniform float uVignette;
    uniform float uLetterboxBar;
    uniform float uGrade;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uSat;
    uniform float uContrast;
    uniform float uGamma;
    uniform float uFade;
    varying vec2 vUv;

    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      // 2.39:1 硬遮幅放最后：黑边不参与分级 / 颗粒 / 暗角，
      // 否则黑边会被染上杂色或者压出梯度，一眼就假。
      if (uLetterboxBar > 0.0001 &&
          (vUv.y < uLetterboxBar || vUv.y > 1.0 - uLetterboxBar)) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec3 col = texture2D(tDiffuse, vUv).rgb;

      if (uGrade > 0.001) {
        // teal-orange：科幻片的色彩语法 —— 阴影偏青、高光偏暖、中间调降饱和
        vec3 g = clamp(col, 0.0, 1.0);
        g = g + uLift * (1.0 - g);                       // lift：抬阴影，偏青
        g = g * uGain;                                    // gain：高光偏橙
        g = pow(max(g, 1e-5), vec3(1.0 / max(uGamma, 0.05)));
        float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(l), g, uSat);                        // 中间调去数码味
        // S 曲线在暗部近似 g²，会把上游的 lift 平方掉 —— 阴影里的青提不起来。
        // S3 实测：开分级反而比关分级更暗、更不蓝（B-R +11.9 vs +13.3），
        // 也就是这一层在暗调画面上是**反向**的。
        // 用 smoothstep 给脚部加权 0：暗部保持线性，lift 才活得下来；
        // 0.5 是 g²(3-2g) 的不动点，所以中高调完全不受影响（S1/S5 逐像素不变）。
        vec3 curved = g * g * (3.0 - 2.0 * g);
        vec3 toeW = smoothstep(vec3(0.045), vec3(0.34), g);
        g = mix(g, curved, uContrast * toeW);
        col = mix(col, clamp(g, 0.0, 1.0), uGrade);
      }

      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.80, r2);

      // 颗粒：显示空间才是「最终影像」的属性，线性空间加会被 tonemap 压扁
      float n = ign(gl_FragCoord.xy + uTime * 17.0) - 0.5;
      col += n * uGrain * 0.85;
      // dither：sRGB 量化前 ±0.5/255，打散暗部色带
      col += (ign(gl_FragCoord.xy) - 0.5) * uDither * 0.0035;

      // 片头淡入 / 片尾淡出：乘在颗粒之后，淡到全黑时是**纯** 0，
      // 和遮幅黑边一致。若放在颗粒之前，黑场里会飘噪点，一眼是数码味。
      gl_FragColor = vec4(col * uFade, 1.0);
    }
  `,
};
