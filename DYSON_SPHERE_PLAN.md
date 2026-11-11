# 戴森球 Three.js 开发计划

> 目标：一个可自由穿行于「行星地表 → 太空电梯 → 戴森壳层 → 恒星全景」四层空间的实时 3D 场景。
> 风格：硬科幻写实 + 电影级光效。核心美学是 **冷金属巨构 vs 暖恒星烈焰的强冷暖对比**。

---

## 0. 体验设计（先定"看到什么"，再定"怎么写"）

四幕式体验，整个项目的镜头脚本：

| 幕 | 位置 | 画面 | 情绪 |
|---|---|---|---|
| 一 地表 | 赤道塔基，离地几十米 | 45° 的燃烧穹顶从地平线转过来，缆线插进光晕消失 | 渺小、黎明 |
| 二 攀爬 | 沿缆线升到同步轨道 | 大气由蓝变黑，一颗**完整的金属球**在远处缓缓转 | 敬畏、抵达 |
| 三 全景 | 球外 / 侧后方 | 黑球表面布满极细的橙色脉络，静得像冷却的熔岩 | 巨物、秩序 |
| 四 分层 | 靠近 + 剖切 | 装甲层掀开，三层同心巨构拉开，恒星在正中燃烧 | 揭示、震撼 |

**这条镜头线是项目的主轴**。所有资产、LOD、光照都为这四幕服务，不做用不上的东西。
**节奏原则**：前三幕只给出"一个球"，把全部炫技留到第四幕。先静，后炸。

---

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite 5 | 秒级 HMR，shader 热更 |
| 核心 | three ^0.16x（ESM） | 需要 InstancedMesh / EffectComposer / Line2 |
| 语言 | 原生 JS（或 TS，二选一，建议 JS + JSDoc） | 无框架负担，纯渲染项目不需要 React |
| Shader | `.glsl` 文件 + `vite-plugin-glsl`，或模板字符串 | 建议后者：字符串模板单文件内联，调试更快 |
| 后期 | three/addons 的 EffectComposer + 自写 ShaderPass | 需要 God Rays，官方没有 |
| UI | 原生 DOM + CSS 变量 | 只做少量信息卡与加载幕 |
| 调试 | Tweakpane 4（**生产环境也保留**，见 5.5） | 实时调 shader uniform + 预设持久化 |

**不用 OrbitControls 之外的控制库**。相机手感自己写，这是"电影感"的来源。

---

## 1.5 开发环境与验证约定（硬约束）

| 项 | 约定 |
|---|---|
| 浏览器 | 用本机已安装的 `/Applications/Google Chrome.app`（已确认存在） |
| **禁止** | 下载 / 安装无头 Chrome、Chromium，或 Puppeteer / Playwright 的 browser bundle；不执行 `npx playwright install`、`puppeteer browsers install` 之类会拉取浏览器的命令 |
| 依赖 | `npm i` 只装 `three` / `vite` / `tweakpane` / `vite-plugin-glsl`，不引入浏览器自动化包 |
| 预览 | `npm run dev` 起本地服务 → `open -a "Google Chrome" http://localhost:5173`；或用工作区内置预览面板打开 localhost |
| 效果验证 | 用户在本机 Chrome 目视确认。真需要自动截图时，只通过 CDP 连接**已经启动的** Chrome（`--remote-debugging-port`），绝不另下浏览器 |
| 静态检查 | `node --check` / `npm run build` / shader 语法自检，不依赖 headless 渲染 |

**为什么单列一节**：这类项目最常见的偷懒做法是装 Playwright 跑截图回归，顺手拖一个上百 MB 的 Chromium 下来。本机已有 Chrome，完全没有必要。

**读者假设**：你从 2025 年起就在用 three.js 开发。本文档**不解释** scene / camera / renderer / BufferGeometry / 材质等基础概念，只写架构决策、shader 思路、性能预算与美术取舍；脚手架也精简，不堆抽象层。

---

## 2. 尺度策略（本项目最关键的技术决策）

真实尺度：恒星半径 7×10⁸ m，戴森壳 1.5×10¹¹ m，太空电梯 3.6×10⁷ m。**跨 5 个数量级，float32 深度缓冲直接崩**。

**决策：不做物理正确的尺度，做"视觉压缩尺度"。** 定一套内部单位，全项目复用，绝不混用：

```
1 unit = 1000 km（名义值，不必物理正确）

恒星半径        R_sun  = 1.0
戴森壳半径      R_shell = 8.0        （视觉压缩，真实应为 215）
行星半径        R_planet = 0.35
行星轨道半径     2.6
太空电梯长度     0.35 → 4.2（含配重）
```

### 三层深度方案（缺一不可）

1. **对数深度**：`new WebGLRenderer({ logarithmicDepthBuffer: true })`
   解决 0.01 到 100 的深度精度。代价：不能和自定义 depth 重建的 pass 混用，需注意。

2. **动态 near/far**：每帧根据相机到原点距离调整
   ```js
   const d = camera.position.length();
   camera.near = THREE.MathUtils.clamp(d * 1e-3, 1e-4, 0.5);
   camera.far  = Math.max(d * 8, 120);
   camera.updateProjectionMatrix();
   ```
   配对数深度，可覆盖 5 个数量级不掉 z-fighting。

3. **分级 LOD + 可见性切换**（按相机高度 `alt = |pos|`）

   | 层级 | 条件 | 开启 | 关闭 |
   |---|---|---|---|
   | L0 地表 | alt < 0.05 | 局部地形 patch、大气内雾、塔基细节 | 壳层远端、暗星 |
   | L1 轨道 | 0.05 ~ 1.5 | 电梯全段、行星全貌、壳层近侧 | 地表 patch |
   | L2 全景 | > 1.5 | 壳层全量、环带、恒星细节 | 电梯舱细节、城市灯 |

4. **电梯的"非线性拉伸"**：缆线顶点着色器里对 y 做 `y' = pow(y, 0.85)` 的压缩，让顶端不至于被裁掉，近端细节保住。视觉上几乎看不出。

---

## 3. 场景对象树

```
scene
├─ starGroup
│   ├─ starCore        Sphere(1, 160, 96) 自定义对流 shader
│   ├─ starCorona      backside sphere R*1.05，fresnel 加法混合
│   ├─ prominences     8~12 条 TubeGeometry 耀斑弧
│   ├─ glowSprites     3 层 billboard 径向渐变（4 / 8 / 16 倍）
│   └─ starLight       PointLight(decay=0) + GodRay 源点
├─ shellGroup           三层同心球壳，可 explode / 剖切
│   ├─ layerArmor       装甲层 R=8.7  InstancedMesh 42000，近黑致密瓦，缝 0.02
│   ├─ layerTruss       结构层 R=8.0  合并桁架（12 经 + 8 纬 + 斜撑），透空
│   ├─ layerCollector   收能层 R=7.4  InstancedMesh 38000，六边蜂窝，朝内暖反光
│   ├─ energyFlow       沿桁架流动的光带（Line2 + uv 脉冲）
│   ├─ ringBands        2 条极薄 Torus 环带（藏在结构层内）
│   └─ debris           Points 尘埃 20000
├─ planetGroup
│   ├─ surface         Sphere(0.35, 256, 128)，顶点噪声位移
│   ├─ atmosphere      backside sphere R*1.06，Rayleigh 近似
│   ├─ clouds          sphere R*1.02，半透明 fbm
│   └─ groundPatch     L0 专用 PlaneGeometry 局部地形
├─ elevatorGroup
│   ├─ cable           3 股螺旋 TubeGeometry，上细下粗
│   ├─ climbers        InstancedMesh × 32，沿曲线 t 运动
│   ├─ stations        4 个环状站 + 1 个主同步站
│   ├─ counterweight   顶端大环 Torus + 太阳板阵列
│   └─ baseTower       塔身 + 光环 + 向上能量束
├─ starfield
│   ├─ brightStars     Points 2000，色温随机 3000K~12000K
│   ├─ dimStars        Points 20000
│   └─ milkyWay        backside 巨球，噪声大圆带
└─ postFX
```

---

## 4. 模块详细设计

### 4.1 恒星（画面主角）

**几何**：`IcosahedronGeometry(1, 64)`。用二十面体而非 UV 球，避免极点拉伸。

**Fragment shader 结构**（自上而下 4 层叠加）：

```glsl
// 1. 对流胞：3D simplex FBM，4 octave，域随时间漂移
float f = fbm(p * 3.0 + vec3(0.0, time * 0.03, 0.0));

// 2. 米粒组织：高频噪声叠加，制造"沸腾"质感
float gran = fbm(p * 26.0 + time * 0.15) * 0.12;

// 3. 色带映射：暗橙 → 亮黄 → 炽白
vec3 col = mix(C_DEEP, C_MID, smoothstep(0.32, 0.62, f + gran));
col = mix(col, C_HOT, pow(smoothstep(0.55, 0.95, f), 3.0));

// 4. 临边昏暗（limb darkening）：边缘变暗再补暖色，这是"球感"的命门
float ndv = dot(N, V);
col *= pow(ndv, 0.38);
col += C_RIM * pow(1.0 - ndv, 4.0) * 0.9;

// 输出 HDR，交给 bloom
gl_FragColor = vec4(col * 4.0, 1.0);
```

**关键参数**
- 色值（sRGB）：`C_DEEP #C63A06` / `C_MID #FF8C2B` / `C_HOT #FFF4DC` / `C_RIM #FF6A18`
- 对流速度 `0.03`、米粒速度 `0.15`，都极慢——快一点就变"火焰贴图"，失去巨物感
- 输出乘 4.0 是 HDR 强度，配合 bloom 才有灼烧感

**日冕**：backside 球，`alpha = pow(1.0 - ndv, 3.0) * 0.55`，`blending: AdditiveBlending`，`depthWrite: false`。半径 1.05，不要太大，否则糊成一团。

**耀斑**：从表面随机两点生成 `CatmullRomCurve3` 弧，`TubeGeometry(curve, 64, 0.008, 6)`。shader 里 `u` 方向加流动噪声，首尾 alpha 淡出。整体极其克制的加法混合——**只在 1~2 条上做完整亮度，其余半透明**，否则画面碎。

**第 5 个细节：恒星磁场线**。可选的加分项——用 12 条从极区出发的大弧，极暗青色，缓慢流动。带来的"科学感"远超成本。

### 4.2 壳层：一个球，三层，可以拆开

**核心判断：从外面看，它必须是一颗完整、安静的球。**

远看是一个完美的球体轮廓——这才是戴森球的标志性形象，也是"我要一个球"的要求。它不该一上来就炫技：走近、再触发分层，它才裂成三层同心的巨构。**先给出一个球，再让球打开**，节奏感全在这。

**三层同心结构**

| 层 | 半径 | 几何 | 视觉职责 |
|---|---|---|---|
| 收能层 Collector | 7.4 | 六边形蜂窝密铺曲瓦，38000 片，几乎无缝 | 朝恒星侧，暖橙反光，画面唯一明亮处 |
| 结构层 Truss | 8.0 | 只有骨架：12 经 + 8 纬 + 斜撑，无面 | 冷灰金属、透空，能看穿到里层 |
| 装甲层 Armor | 8.7 | 致密矩形装甲瓦，42000 片，缝宽 0.02 | 近黑，只有缝隙透光——就是"外表面" |

层距 0.6~0.7：合拢时严丝合缝叠成一颗球，拉开时互不穿插。

**三个动作，构成"分层"的全部交互**

1. **Explode 径向分层**：`uExplode` 0→1，每层沿自身法线膨胀 `+1.0 × layerIndex`。
   注意：**不能用 `group.position` 平移**（那是"错位"不是"分层"）。要在 vertex shader 里 `p += normalize(p) * uExplode * aLayerOffset`，让拉开后的每一层**仍然是完整的球**——视觉上才是"分层"，而不是"散架"。
2. **Cutaway 剖切**：`uCut` 用一个 `THREE.Plane` 楔形裁掉 90° 扇区。`renderer.localClippingEnabled = true`，材质传 `clippingPlanes`。剖开才看得见壳体厚度、内三层、以及正中的恒星。
3. **Peel 单层显隐**：任一层可单独淡出或滑走，用于"只看结构层"这类展示视角。

**剖切必须解决的坑：切面不能是空心的**

单面球壳一剖就露馅（能看到对面的内壁，像纸糊的）。三级方案按投入递增：
- **够用**：每层内外各一个面（外表面 + 内表面），`side: THREE.DoubleSide`，剖口处读起来已经有"壳"的厚度感
- **更好**：每片瓦直接做成有厚度的扁盒，剖口自然露出截面，顺带解决近看发飘
- **最好**：stencil 封盖（three 官方 `webgl_clipping_stencil` 那套）做真截面。**只给装甲层做**，内两层用扁盒即可

**缝隙与光（决定"它是不是一颗球"）**

- 装甲层缝宽 **0.02**，很细。缝一宽球就破了，立刻变成鸟笼。
- 恒星的光从细缝里漏出 → 远看是**一颗黑球上布满极细的橙色脉络，像冷却中的熔岩壳**。这个意象比"发光网格球"高级得多，也更"真"。
- 收能层几乎无缝，只有六边形网格的暗线；它只在内视角与分层后才被看见。

**外表面照明**：反照率 0.10~0.14（近黑），不吃直接光（本来就被自己挡住），只吃 ①缝隙溢光 ②能量线自发光 ③极弱冷色环境光。**宁可暗，也不要均匀补光——亮起来的地方必须来自缝隙。**

**A. 几何与实例化**
- 三层各一个 InstancedMesh，共用同一套"曲瓦"生成器：从 `SphereGeometry` 取一块经纬 patch（8×8 段），保证贴合球面、不起平面感
- 瓦片数：装甲 42000 / 收能 38000 / 桁架用 `mergeGeometries` 合成 1 个 mesh
- 朝向：法线沿球心，`instanceMatrix` 一次性设定，之后不再写

**B. GPU 动画**
三层合计 8 万个实例，CPU 逐帧写 matrix 必卡。`uTime` 驱动的旋转、`uExplode` 的膨胀、`uCut` 的裁切全部在 GPU 侧完成，CPU 只更新几个 uniform。这也是"分层"能做成实时滑块的前提。

**C. 材质三件套**

1. **缝隙溢光**：`emissive` 出 HDR 值，缝里透出的光就是全画面唯一的自然光。装甲层缝细 → bloom 后是一条条细线，不是一团糊光。
2. **外表面近黑**：`#0E1824`，`metalness 0.85 / roughness 0.55`。不接受直接光，只吃环境光与自发光。
3. **fresnel 边缘 + 能量线**：`rim = pow(1.0 - ndv, 3.0)`，青色 `#4FD6FF`，强度 0.5；沿瓦片一条边有流动亮线，全局同相位 → 整颗球在"心跳"。
   **冷青 × 暖橙的对撞就是这张图的灵魂。** 注意：合拢时 fresnel 强度要压到 0.25，否则球边缘会发亮圈、破坏"一个球"的完整感；分层后再放到 0.5。

**D. 能量流**
沿结构层桁架的 `Line2`（宽 2px），`fract(uv.x * 3.0 - uTime * 0.4)` 做宽尾脉冲，`#7AF0FF` × 3.0 HDR。合拢时被装甲遮住只透出一点点，分层后才完整显形——**这是给"分层"这个动作的奖励**，观众会觉得拆开是有意义的。

**E. 铺设动画 uAssemble（开场杀手锏）**
0→1 的 uniform：
- 0.0：三层瓦片全部悬在各自球面外侧 0.4~1.8 处，缓慢自转
- 0.5：按"极区 → 赤道"的顺序（用瓦片纬度做延迟）依次飞入
- 1.0：全部锁合，缝对齐，球面完整

vertex shader：`p = mix(p + normal * aOffset, p, wave)`，`wave = smoothstep(0.0, 1.0, uAssemble * 1.6 - aLat * 0.6)`。
4 秒完成后立刻给一个 `uExplode` 0→0.25→0 的回弹——先立住"球"，再暗示"它能打开"。这一下比任何 loading 动画都值。

**F. 环带**
2 条极薄 Torus（`R=8.0, tube 0.02`），穿在结构层上，转速不同。合拢时完全藏在球内不可见；分层后成为画面里唯一的曲线元素，把三层"串"起来，视觉锚点。成本极低。

### 4.3 行星地表层

**先算一个角尺寸（决定第一幕的全部观感）**
行星轨道 2.6、恒星 R=1.0 → 从地表看恒星的角直径 `2·asin(1/2.6) ≈ 45°`，**是太阳的 45 倍**。
所以"日出"不是一个小圆盘升起，而是**一片占满半个天空的燃烧穹顶缓缓转过来**；抬头望去，壳层内表面在更远处形成发光的金属天穹。
按太阳尺寸去设计会立刻显得假——这个数字必须写进 `config.js` 并作为构图的基准。

**表面**
- `SphereGeometry(0.35, 256, 128)`
- 顶点位移：`p += normal * fbm(p * 4.0) * 0.004`（山脉，幅度要小，否则像土豆）
- 海陆：`fbm < 0.5` 为海（`#0B1A2A`，低 roughness 0.15 出高光），否则陆地（`#2E4034`）

**夜面城市灯（让行星"活着"）**
```glsl
float night = smoothstep(0.1, -0.15, dot(N, L));
float cityMask = smoothstep(0.55, 0.75, fbm(p * 40.0)) * step(0.5, fbm(p*4.0)); // 只在陆地平原
col += vec3(1.0, 0.82, 0.5) * cityMask * night * 2.5;
```
配合轻微闪烁（`sin(time + hash) `），远景看是暖黄的城市网。

**大气**
第二个 backside 球，R×1.06。Rayleigh 近似：
```glsl
float fres = pow(1.0 - ndv, 4.0);
vec3 atm = mix(vec3(0.25,0.55,1.0), vec3(0.55,0.75,1.0), fres);
gl_FragColor = vec4(atm * fres * 1.6, fres);
```
日出时（相机在夜面侧看恒星方向）会自然出现橙红色边缘——**这正是第一幕要的画面**。

**云层**：R×1.02，`alpha = smoothstep(0.45, 0.7, fbm(p*5 + time*0.01)) * 0.45`，缓慢自转。

**地表 patch（L0 近景）**
相机 alt < 0.02 时淡入一块 `PlaneGeometry(200, 200)` 局部地形，高精度噪声 + 岩石/草色混合 + 远景大气雾（`FogExp2` 暖蓝）。这是"贴地感"的唯一来源，也是分尺度方案的第二层。

**塔基 baseTower**
圆环平台（Torus 半径 0.03）+ 塔身（CylinderGeometry 上细下粗）+ 3 层旋转光环 + 一束向上的能量柱（细长 Cone，additive，内部粒子上升）。能量柱必须**很淡**，只是暗示。

### 4.4 太空电梯

**缆线 cable**
- 3 股螺旋缠绕：`CatmullRomCurve3` 沿轴向采样，每股再绕轴旋转生成螺旋点
- `TubeGeometry(curve, 512, 0.006, 6)`
- **上细下粗**：vertex shader 里 `radius *= mix(1.0, 0.25, vY)`，或用 `TubeGeometry` 分段生成后手动缩放。视觉真实性提升巨大
- 材质：深灰 `#1B2632`，`metalness 1.0 / roughness 0.4`
- **能量脉冲**：`emissive = pow(fract(uv.y * 2.0 - uTime * 0.25), 8.0) * 3.0`，青色。光沿缆线向上奔涌

**攀爬舱 climbers**
- `InstancedMesh` × 32，小胶囊体（`CapsuleGeometry(0.008, 0.02)`）
- 沿曲线 t 运动：`t += speed * dt`，到顶回到底（或循环）
- 每舱 2 个自发光窗（用 instanceColor 或单独小 mesh）
- **拖尾**：高速时用 `Line2` 拖尾或 sprite 序列，长度随速度变化

**站点 stations**
4 个环状站（Torus + 辐条）分布在 t = 0.35 / 0.55 / 0.75 / 0.9。主同步站最大（半径 0.12），带自发光窗格与旋转的太阳能板。

**顶端配重 counterweight**
巨大 Torus（半径 0.3，tube 0.015）+ 内侧太阳板阵列。缓慢自转。**它是画面顶部的"句号"**，让缆线有终点。

**大气穿透效果**
缆线在行星大气范围内的那一段（y < 行星半径 × 1.06），叠加橙→透明渐变，模拟散射。这是"穿越感"的关键一笔——上升时看到缆线由橙变黑，再接上太空的黑，情绪转折就在这一帧。

### 4.5 星空

- **亮星**：2000 颗，`size 0.5~1.5`，色温随机 3000K~12000K 映射到 RGB（`kelvinToRGB()`），shader 里闪烁 `alpha *= 0.7 + 0.3*sin(uTime*2.0 + aPhase)`
- **暗星**：20000 颗，`size 0.2`，低亮度，提供背景密度
- **银河带**：一个 `SphereGeometry(200)` backside，shader 里用 3D noise 沿某个大圆产生带状密度：`d = 1.0 - abs(dot(dir, bandNormal))`，`pow(d, 8.0)` 压出窄带。颜色蓝紫 + 淡橙，极淡（乘 0.15）
- 星空必须**跟随相机**（`starfield.position.copy(camera.position)`），实现"无限远"

---

## 5. 相机与交互

### 5.1 手感（决定"高级感"的一半）

- OrbitControls：`enableDamping = true, dampingFactor = 0.05`
- **对数缩放映射**：滚轮 delta 映射为 `dist *= (1 ± 0.001 * delta)`，而非线性加减。远近通吃，近处不会"滑走"
- `minDistance = 0.4`（行星半径 + 一点），`maxDistance = 40`
- 松开后 1.2 秒内轻微惯性收尾
- **禁止极角穿地**：`maxPolarAngle = Math.PI * 0.92`，防止相机钻进行星内部

### 5.2 自适应曝光与后期强度（三级）

```js
const t = smoothstep(0.05, 1.5, alt);
composer.bloomPass.strength = lerp(0.35, 1.05, t);
renderer.toneMappingExposure = lerp(0.95, 1.30, t);
```

### 5.3 自动巡游 Cinematic

用时间线而非 tween 库：一个关键帧数组

```js
const shots = [
  { pos: [0.42, 0.40, 0.62],  target: [0, 0.35, 0],  fov: 55, dur: 6, ease: easeInOutCubic, caption: '赤道塔基' },
  { pos: [1.30, 1.60, 1.10],  target: [0, 1.2, 0],   fov: 50, dur: 8 },
  { pos: [3.20, 2.80, 3.00],  target: [0, 0, 0],     fov: 45, dur: 8 },
  { pos: [11.0, 6.50, 12.0],  target: [0, 0, 0],     fov: 40, dur: 10 },
];
```
- 位置用 `CatmullRomCurve3` 串联，保证转角平滑
- target 单独插值，fov 单独插值
- 播放时禁用控制；用户任何输入立即中断并接管（这是尊重用户）
- **开场默认播放**：3 秒 uAssemble 聚合 → 镜头拉远 → 完成。这个开场比任何 loading 动画都值

### 5.4 热点信息卡

点击电梯站 / 壳层面板 / 恒星 → 弹出 CSS 卡片（DOM 投影 `vector.project(camera)`）：

```
轨道同步站 SYN-04
收集功率   1.28 × 10¹⁷ W
维护周期   已运行 41,022 天
```

虚构但自洽的数据，显著提升沉浸感。**卡片用毛玻璃 + 细边框，字号克制，绝不用亮色渐变按钮**。

### 5.5 参数面板（Tweakpane 4，生产环境保留）

右下角抽屉按钮 → 展开分栏面板。这是调视觉的主力工具，也让成品具备"可玩"属性。

```
恒星     对流速度 / HDR 亮度倍数(1~8) / 日冕强度 / 耀斑数量(0~12)
壳层     分层展开 uExplode(0~1) / 剖切角度(0~90°) / 剖切朝向
         单层显隐(收能·结构·装甲) / 缝隙宽度(0.01~0.05) / 瓦片数
         外表面反照率 / 能量线速度 / 铺设进度 uAssemble(0~1，手动拖)
行星     云量 / 城市灯强度 / 大气厚度
电梯     攀爬舱数量 / 舱速 / 缆线粗细 / 脉冲频率
相机     fov / 阻尼 / 自动巡游开关
后期     bloom strength+threshold / 曝光 / GodRays / 颗粒 / 暗角
```

**四个工程要点**
1. **单一数据源**：所有控件只写 `params` 对象，`render()` 每帧统一把 `params → uniform`。绝不在 `on('change')` 回调里散着改（否则必然出现"面板和画面不一致"）。
2. **调参不重建几何**：每层预分配满额实例，用 `instancedMesh.count` 控制渲染数量；`uExplode` / `uCut` 全部走 uniform。拖滑块必须丝滑，一旦重建 buffer 就会卡。
3. **剖切必须复用 Plane 对象**：每帧新建 `Plane` 或重建 `clippingPlanes` 数组会触发材质重编译，直接卡半秒。永远只改 `plane.normal` 与 `plane.constant`。
4. **预设持久化**：`localStorage` 存 `params`，附带「重置 / 导出 JSON / 导入 JSON」。调出好看的参数固化成交付物里的三套预设。

移动端：面板默认折叠成图标抽屉，且只保留 6 个最关键的滑块。

---

## 6. 渲染与后期（艺术效果的最后一公里）

`EffectComposer` 顺序：

1. `RenderPass`
2. `UnrealBloomPass` — `threshold 0.72, strength 0.9, radius 0.55`
3. `GodRaysPass`（自写）— 屏幕空间径向模糊，以恒星投影点为源，24 采样，`strength 0.35`。**不用体积光**，成本 1/20，效果 90%
4. `ChromaticAberrationPass`（自写）— 强度随距中心距离增长，边缘 0.0015
5. `VignettePass` + `FilmGrain(0.028)` + 轻微调色（lift/gamma/gain）
6. `OutputPass` — `ACESFilmicToneMapping`

**三条铁律**
- 所有发光体输出 HDR（值 2~8），光晕**只**由 bloom 产生。绝不用 sprite 假 glow 叠加（会发灰）
- `renderer.outputColorSpace = SRGBColorSpace`，所有颜色定义用 sRGB，内部线性计算
- 抗锯齿用 SMAA（后处理链内），比 MSAA 便宜，且和 composer 兼容

---

## 7. 性能预算

| 指标 | 目标 |
|---|---|
| 三角面 | < 800k |
| Draw calls | < 120 |
| 纹理 | **全部程序化，0 外部贴图**（体积小、任意缩放不糊） |
| 帧率 | M1/M2 @1440p 60fps；集显 40fps |

**优化清单**
- 壳层瓦片：InstancedMesh + GPU 动画（0 CPU）
- 桁架：`mergeGeometries` 合并（几十个 mesh → 1 个）
- LOD：合拢态只渲染装甲层外壳（内两层被完全遮挡，直接 `visible = false`）；分层/剖切时才唤醒内两层
- 星点：Points + 自定义 `frustumCulled` 包围球
- 自适应分辨率：`devicePixelRatio` clamp 1.5，连续 2 秒 < 50fps 降到 1.0
- 静止降频：相机静止 3 秒后 `requestAnimationFrame` 降到 30fps
- 阴影：**只保留行星自阴影**，壳层不投影（戴森球投影无物理意义，纯浪费）
- Shader 预编译：`renderer.compile(scene, camera)` 在 loading 幕布后执行，避免首帧卡顿

---

## 8. 美术方向

**调色板**

| 用途 | 色值 |
|---|---|
| 恒星暗部 / 中层 / 高光 | `#C63A06` / `#FF8C2B` / `#FFF4DC` |
| 能量 / 科技青 | `#4FD6FF` / `#7AF0FF` |
| 金属暗 / 中 / 亮 | `#1B2632` / `#38495C` / `#6E7F91` |
| 行星海 / 陆 / 城市灯 | `#0B1A2A` / `#2E4034` / `#FFD98A` |
| 背景 | `#05070C` → `#0C1420` |

**构图原则**
- **合拢时**：全画面最亮的只有那道缝合处的橙色细线和远处的星点，球体本身压到接近黑——"暗球 + 一根亮线"是最耐看的构图
- **分层时**：三层同心就是构图本身，机位尽量贴近轴线看，让三层形成同心环；此时才允许出现大面积的暖光
- 电梯缆线作为**引导线**贯穿画面，斜切 15°~20° 最有张力
- 壳层缝隙的**重复节奏**是"巨构感"的来源，务必让它规律中有扰动
- 留白：画面 30% 以上是接近黑的太空，不填满

**氛围层**
- 极淡的漂浮尘埃粒子（Points，500 颗，近相机，慢速漂移）——提供"空间感"
- 远景雾（`FogExp2`，极浅，只作用于行星）
- 轻微镜头呼吸（fov ±0.3°，正弦 4 秒周期）——几乎察觉不到，但画面会"活"

**参考**
《星际穿越》土星段落、Kurzgesagt 的戴森球、Isaac Arthur 概念图、Orbital Ring 的结构感。

---

## 9. 里程碑（每个阶段独立可交付、可截图）

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **M0** 脚手架 | Vite + three + 渲染循环 + OrbitControls + 星空占位 + composer 骨架 | 本机 Chrome 打开即见黑底星空；只 `npm i three vite tweakpane`，无任何浏览器下载 |
| **M1** 恒星 | 对流 shader + 日冕 + 耀斑 + bloom | 恒星看起来"在燃烧"，不是贴图球 |
| **M2** 行星 | 表面 + 大气 + 云 + 夜灯 | 第一幕构图成立，日出有橙边 |
| **M3** 壳层 | 三层同心壳 + 缝隙溢光 + Explode 分层 + Plane 剖切 + uAssemble | 合拢时是一颗**完整的球**（没有破绽）；拉开后三层套叠不穿插；剖口不露馅 |
| **M4** 电梯 | 缆线 + 舱 + 站 + 配重 + 大气渐变 | 第二幕镜头成立，缆线上细下粗 |
| **M5** 合成 | 尺度统一、光照统一、三级 LOD、曝光曲线、调色 | 三层切换无跳变（这是最容易翻车的一步） |
| **M6** 交互 | 自动巡游 + 热点卡片 + Tweakpane 参数面板 + 预设持久化 + 加载幕 | 开场 4 秒能抓住人；关键参数全部可实时调、可存预设 |
| **M7** 打磨 | 自适应分辨率、移动端降级、性能压测 | 稳定 60fps，build 体积 < 1MB；验证只走 `npm run build` 与本机 Chrome |

**建议先做 M1（恒星）**。恒星对了，整个项目的信心就有了；恒星不对，后面全是白搭。

---

## 10. 风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 尺度穿帮 | 面板比行星还大 / 电梯穿行星 | 锁定第 2 节数值表，写成 `config.js` 常量，禁止硬编码 |
| 深度精度 | 远景壳层闪烁、缝里 z-fighting | 对数深度 + 动态 near + `polygonOffset` |
| 画面"糊成一团光" | bloom 过强，全屏发白 | threshold 不低于 0.7；HDR 输出值克制在 2~6 |
| 球"不圆" | 瓦片贴合球面有缝、边缘呈多边形 | 瓦片用球面 patch 而非平面方块；缝宽随距离淡出（`fwidth` 抗锯齿）；远处用一层纯球壳兜底 |
| 剖切露馅 | 剖口看见对面内壁、像纸糊 | 瓦片做扁盒 + DoubleSide + 装甲层 stencil 封盖 |
| 分层穿插 | 三层拉近时互相穿透 | 层距 0.7 ≥ 单层瓦片厚度 ×3，且 explode 位移必须沿法线（不是平移） |
| 首帧卡死 | 十几个 shader 同步编译 | loading 幕布 + `renderer.compile()` |
| 移动端崩 | 8 万实例 + God rays | 按 UA/性能探测降级到 8000 瓦片、关 God rays、关尘埃 |

---

## 11. 交付物

- 完整 Vite 项目，`npm i && npm run dev` 即看
- `npm run build` 产出纯静态 `dist/`，可直接部署
- 4 张定帧截图（对应四幕，其中一张必须是「合拢态的完整球」）+ 一段 15 秒巡游录屏
- 三套参数预设 JSON：**冷峻工程**（近黑金属 + 高对比）／ **黄昏暖调**（缝隙偏橙、曝光高）／ **电影冷青**（能量线加强、强暗角）

---

## 12. 已确认的方向（本版已按此定稿）

| 项 | 决策 | 直接后果 |
|---|---|---|
| 壳层形态 | **一个完整的球 + 可分层拆解**（三层同心：收能 7.4 / 结构 8.0 / 装甲 8.7） | 合拢态必须是完美球面、缝宽 0.02；全部戏剧性押在 Explode 与剖切两个动作上；外表面走"近黑 + 缝隙溢光"路线 |
| 交互深度 | **全交互 + 参数面板** | 增加 Tweakpane 模块与预设持久化；性能预算里要给面板留出重绘开销 |
| 语言 | 中文 UI + 虚构遥测数据 | 信息卡与面板文案全部中文；数字用"×10¹⁷ W / 已运行 41,022 天"这类自洽量纲 |

**由这两个选择新增的三处风险**（已并入第 10 节）：

- **球容易拍成"灰球"**：唯一解药是让缝隙亮度远高于一切其他表面。调参顺序不能反——先关掉环境光、只留 emissive 缝隙，确认"单靠缝隙就好看"，再一点点加极弱补光。反过来永远调不出来。
- **"球"和"分层"两个状态必须都成立**：合拢态一旦有破绽（缝太宽、边界发亮、瓦片对不齐），"一个球"的印象就废了；这时分层做得再炫也救不回来。所以 **M3 的验收必须先过"合拢态截图"这一关**，再去做 Explode。（原型已按此顺序验收通过）
- **参数面板会引入状态竞争**：`uExplode`、`uCut`、层显隐三者互相影响（剖切平面在分层后位置要对得上）。必须统一走一个 `syncShellUniforms()`，且 `Plane` / 实例 buffer 全程复用，否则拖滑块会卡顿和闪烁。

---

## 13. 实现记录：M0 + M3 原型（已跑通）

```
package.json / index.html / src/style.css
src/config.js      全项目唯一数值来源 + 三套预设
src/shaders.js     恒星 / 壳层 / 剖切圆环 / 行星 / 星空 / 能量点 / 后期调色，全部程序化
src/objects.js     makeStar / makeShell / makeStarfield / makePlanet
src/panel.js       Tweakpane 4（生产保留）+ localStorage 预设 + JSON 导入导出
src/main.js        渲染循环 / 动态 near/far / 对数 dolly / 后期链 / 开场与分层时间线
```

**已实现**：三层同心壳（7.4 / 8.0 / 8.7）、`uExplode` 径向分层、`uCut` 剖切 + 解析圆环截面、`uAssemble` 铺设开场、装甲层渐进掀开、缝隙溢光、恒星 FBM 对流 + 日冕、星空色温闪烁、能量流光点、行星/电梯占位、Tweakpane 全参数、三套预设、URL 定帧参数。

URL 定帧：`?explode=0.85&cut=0.6&assemble=1&noopen=1`（`noopen=1` 跳过开场动画）。

### 与原计划的三处有意偏离

| 原计划 | 原型做法 | 原因 |
|---|---|---|
| 42000 / 38000 片 InstancedMesh 瓦片 | **连续球面 + 程序化瓦片 shader**，每层 1 个 draw call | 必须保证"完美球面轮廓"，实例化瓦片在球缘必然出现接缝与多边形边；shader 缝隙精确、抗锯齿可控、剖切不会露出瓦片侧壁。代价：近看没有独立板件几何，正式版可改成"远用球面 / 近用 InstancedMesh"的 LOD 双轨 |
| `THREE.Plane` + `clippingPlanes` 剖切 | fragment 里 `if (vWorld.x > uCutD) discard`，截面圆环半径用 `sqrt(R² - d²)` 解析算出 | 自写 ShaderMaterial 要手动注入 clipping chunk，易与 composer 冲突；解析圆环天然表达壳体厚度，且不会"剖开后像纸糊" |
| `logarithmicDepthBuffer: true` | 关闭，改用每帧动态 `near = clamp(d*0.002, 0.01, 0.5)` / `far = max(d*12, 400)` | 自写 ShaderMaterial 需注入 logdepthbuf 的 pars/vertex/fragment chunk；原型阶段动态 near/far 已足够（z≈25 处深度精度约 8e-4，远小于 0.10 壳厚）。开关留在 `config.js` 的 `USE_LOG_DEPTH` |

### 验证方式（遵守 1.5 节）

- `npm i` 只装了 `three` / `vite` / `tweakpane`，**未下载任何浏览器**
- `npm run build` 通过
- 用本机 `/Applications/Google Chrome.app` 的 `--headless=new --screenshot` 截定帧，并开 `--enable-logging=stderr` 抓控制台；据此修掉两个真实编译错误：`SHELL_FRAG` 漏引 `NOISE` 导致 `hash21` 未定义、`PLANET_FRAG` 把 `vec3` 写成 `float`
- 合拢态与分层态两张定帧目视确认：球面完整、缝隙细、三层可辨、恒星可见、无破面

### 13.1 表面细节专项（已完成）

**恒星**
- 几何换成 `IcosahedronGeometry(r, 5)`，避免 UV 球极点把对流胞拉成条
- 域扭曲 FBM 对流胞 + ridged 米粒 + 高频颗粒三层叠加；黑子用 `smoothstep(0.54, 0.66, spotField)` 只压最亮的一小片，形成**离散暗斑**而不是整体压暗
- 亮度先做 `smoothstep(0.10, 0.90, lum)` 拉开分布，再走四段色带（暗红棕 → 橙 → 金 → 白）；输出改为温和的 `1 - exp(-col * k)` 压缩后交 ACES，保住纹理层次，不让中心烧成纯白
- 临边昏暗 `pow(ndv, 0.62)` + 边缘偏红 + 极细色球层亮边
- 日冕加 26 条径向射线（噪声扰动）+ 10 条二次贝塞尔磁力线弧（`CatmullRomCurve3` 会过冲甩出长直线，已换 `QuadraticBezierCurve3`）
- 新增参数：对流胞尺度 / 流动速度 / 米粒组织 / 黑子 / 日冕射线 / 磁力线耀斑

**装甲板**
- 每板独立色差 + 少量偏暖"烧蚀板"，板面双层噪声（磨损 + 细颗粒）
- 倒角亮边 + 内侧暗槽 + 四角铆点 + 金属高光 + 次级分割线（大板套小板）
- **关键修复**：缝隙宽度原本按瓦片 UV 比例算，凑近后变成十几像素的粗橙带，把板面全盖住。改为屏幕空间钳制 `w = min(uSeamWidth, fwidth(tile) * 1.8)`，缝在任意距离都约 2 像素；倒角宽度同样跟随像素宽度
- 新增参数：装甲板细节

**新增检视视角**：`?view=star`（隐藏三层壳与行星，拉近看恒星表面）、`?view=plate`（贴近装甲层看板件）。定帧截图存 `preview/04` `preview/05`。

### 13.2 M2 行星地表（已完成）

**表面**：`SphereGeometry(0.35, 384, 192)`，vertex shader 用 3 octave 噪声做山脉位移（只在陆地）；fragment 组合海/低地/岩石/雪线 + 海岸线 + 海洋镜面高光。**修掉一处旧 bug**：原来的光方向写成「指向行星中心」，实际恒星在原点，应为 `normalize(-vWorld)`。

**云层**：独立球 R×1.02，FBM alpha，缓慢自转。注意必须用 `FrontSide` —— `DoubleSide` 会把背面云也叠一遍，整颗行星糊成灰球。

**大气**：Rayleigh 近似 fresnel 边缘 + 晨昏线暖橙混入（`exp(-|dot(N,L)|*5)`），这就是第一幕"日出橙边"。

**夜面城市灯**：网格化聚落 + 高频噪声阈值 + 只在低地陆地 + 轻微闪烁。网格密度从 7 提到 15，否则灯会变成大块"金条"。

**贴地近景**：`uGroundDetail` 在贴地视角打开高频岩石/砂/植被斑块，另加 2600 个贴面碎屑点。相机在晨昏线附近（`camera.up` 取行星径向 `(1,0,0)`），恒星角直径约 45° 正好从地平线升起；`controls.enabled = false` 避免 OrbitControls 的 up 四元数在运行时改不动。

**塔基 / 缆线归位**：整组改用相对行星中心的局部坐标，沿径向 +X 由地表向外，塔基放在相机可见侧。远端站点与配重环、塔基光环在贴地视角隐藏（相机离塔基不到 0.1，半径 0.02 的环会被放大成横跨画面的青色带）。

**关键取舍：贴地视角的大气必须换实现。** 相机距行星中心 0.362，而大气壳半径 0.371 —— 相机在大气球壳**内部**，整块大气从内侧糊成一片白雾。改为贴地时隐藏大气壳，换成相机居中的加法天空穹顶（`SKY_FRAG`），只投一道暖色地平线辉光；同时关掉恒星光晕精灵（近距离放大到糊满全屏）与磁力线弧（像两根天线）。`near` 在贴地视角单独压到 0.001。

**新增检视视角**：`?view=ground`（第一幕）、`?view=planet`（轨道看云/大气/夜灯）。参数面板新增「行星 / 地表」7 项：地形起伏 / 云量 / 城市灯 / 大气强度 / 塔基能量束 / 云层自转 / 贴地细节。定帧存 `preview/07` `preview/08`。

### 13.3 M4 太空电梯（已完成）

**模块拆分**：电梯从 `objects.js` 独立成 `src/elevator.js`，`makeElevator(parent, materials)` 挂在 `planet.group` 下，沿用行星局部坐标沿径向 +X 从 0.35 到 1.4；`objects.js` 只留行星本体与塔基。`showPlanet` 现在连带控制电梯显隐。

**缆线几何**：中心主线 + 3 股螺旋合并进单个 `BufferGeometry`（420 段 × 8 径向 × 4 股）。自定义属性 `aOff`（管截面偏移）、`aX`、`aHelixR`、`aPhase`、`aT`；螺旋角 `th = aT * uTurns * 2π + aPhase` 在 vertex 里实时算，改编织圈数不重建几何。`taper = 1 - 0.78*t` 烘焙进管半径与螺旋半径，形成上细下粗。

**shader**

- `CABLE_VERT`：距离自适应粗细。`dCam = length(cameraPosition - axisW)`，`thin = mix(0.12, 1.0, smoothstep(0.20, 1.70, dCam))`，近景收管径、远景放完整编织；`uTurns` / `uRadiusScale` / `uGrow` 全部走 uniform
- `CABLE_FRAG`：暗部基线 `0.55 + 0.45 * max(dot(N,L),0)`（从外侧看大多是背光面，不给基线就只剩剪影）+ `pow(1 - abs(dot(N,V)), 3)` 冷边勾出三股螺旋；`pow(fract(vT*3 - t*uPulseSpeed), 12)` 窄能量脉冲；`uAtmoT` 以内染暖橙大气散射
- `CABLE_GLOW_FRAG`：加法叠加层，只画背面
- `TRAIL_VERT` / `TRAIL_FRAG`：拖尾点，尺寸与亮度按近场重新标定

**动体与构件**：`InstancedMesh` 最多 64 个攀爬舱，黄金角分配径向挂点避开中心主线；每舱 6 个拖尾点，方向随上下行翻转；4 个节点站（含 1 个同步站，带辐条 / 舷窗 / 太阳能板）+ 顶端配重环，均缓慢自转。

**参数 / 视角**：Tweakpane 新增「太空电梯 M4」8 项（编织圈数 / 缆径 / 脉冲速度 / 脉冲强度 / 攀爬舱数 / 攀爬速度 / 节点站 / 配重环），三套预设补齐；新增 `?view=elevator` 第二幕与 badge 文案；`shot=1` 撤掉加载幕布供定帧截图。

**验证中修掉的 6 个问题**

| 现象 | 原因 | 处理 |
|---|---|---|
| 集成后 JS 直接抛错 | `trailMat` 没有 `uTime`，而 `materials` 是全局统一更新列表 | 补 `uTime`，并把主循环改成 `if (m.uniforms.uTime)` 守卫 |
| 整条缆线是一串白色大光球，结构完全看不见 | 拖尾点用 `30.0/max(-mv.z,1)`，视角离缆线仅 1.7 时单点放大到 50+ px，20 舱 × 6 点叠成白带 | 改 `2.4/max(-mv.z,0.25)`，同时降点亮度与攀爬舱材质白度 |
| 缆线烧成一条白亮带 | glow 层 `DoubleSide` + 加法混合，每根管正反面叠 4 层；实体层脉冲与大气段也过强 | glow 改 `BackSide`、alpha 与强度减半；实体层反而补暗部基线与 fresnel 冷边，让编织重新可读 |
| 定帧截图忽明忽暗，连 HUD 一起变灰 | `#loading` 有 0.8s 淡出，headless 抓帧截到半透明幕布 | 加 `shot=1` 直接 `display:none`，保证对比图亮度一致 |
| 第一幕右上角橙色多边形、行星视角右侧乱几何 | 相机离缆线只有 0.098，真实管径被透视放大成色块 | `CABLE_VERT` 加距离自适应 `thin`；`ground` / `planet` 归为 `closeUp`，隐藏站点 / 配重 / 舱 / 拖尾 |
| 电梯元素重复、塔基一片过曝 | `objects.js` 里旧缆线 / `cableGlow` / `farParts` 未删 | 全部移除；塔基光柱缩到 0.34，避免与缆线 glow 全长叠加 |

**定帧**：`preview/09` 第二幕、`10` 第一幕、`11` 行星全景、`12` 合拢态远景。`npm run build` 通过；本机 Chrome 四视角截图 + `--enable-logging=stderr` 抓日志，无 shader / JS 编译错误，**未下载任何浏览器**。

**M4 遗留（非回归）**

- 第一幕缆线仍贴画面右边缘：`camera.up=(1,0,0)` 时，整条缆线几乎落在相机正前方 0.08 的平面上，水平投影 0.052 / 深度 0.08 直接出画。要让它完整进入构图必须重调贴地相机，会动到已定好的日出构图，留到 M5 巡游镜头一起做
- 合拢态仍是橙色网格球，而非「近黑球 + 极细橙色脉络」（`preview/01` 与 `12` 一致，属 M0 遗留）

### 13.4 画质专项：着色器调研与落地（已完成）

**调研结论（选型依据）**

| 方案 | 结论 |
|---|---|
| AgX / Khronos PBR Neutral tonemap | `three@0.169` 两者都在，`OutputPass` 每帧比对 `renderer.toneMapping` 并重建 defines，可实时切。但社区共识是「已经为 ACES 调好色的场景换 AgX 不会立刻变好，且暗部会去饱和」→ **默认不动**，做成对比开关。`preview/17` 实测 AgX 版球面更灰更闷，证实此判断 |
| Halation（胶片红晕） | 与「染色 bloom」是两回事：必须**按通道不同扩散半径**（红最宽）、**只有真亮源触发**（gate）、**比 bloom 宽得多**。只给 blur 加橙色一眼就假 |
| 屏幕空间体积光 / god rays | 需要恒星屏幕坐标 + occlusion mask，另开一 pass；本场景剖切态收益大但改动面广，本轮不做 |
| Karis average / soft-knee bloom | 需替换 `UnrealBloomPass` 内部 mip 加权，留到正式版换物理 bloom 时一起做 |
| FXAA / SMAA vs MSAA | 优先 MSAA：FXAA 会把板面细纹和编织缆线一起糊掉 |

**落地 5 项**

1. **修掉一个真实画质 bug**：`antialias: true` 只作用于默认 framebuffer，而 `EffectComposer` 的 RenderPass 渲到自建 RT，等于整个后期链**从来没有抗锯齿**。改为给 composer 传 `WebGLRenderTarget({ type: HalfFloatType, samples: 4 })`，缆线 / 板缝 / 星点全部走 4x MSAA。5 张定帧 8 秒，性能可接受
2. **`GRADE_SHADER` 重写**：12 tap golden-angle 盘采样的 gated halation，用 `vec3 exp(-rad*1.8/3.0/4.6)` 实现红宽蓝窄；`off.x *= texel.x/texel.y` 修正宽高比；轻微 unsharp；颗粒与暗部抖动都换成 interleaved gradient noise；色差 / 暗角保留。`texel = fwidth(vUv)` 省掉分辨率 uniform
3. **壳层远景 LOD**：`detailFade = 1 - smoothstep(0.012, 0.055, fwidth(tile))`，远景把倒角 / 铆点 / 次级线 / 磨损 / 个体色差全部淡出，近景 `?view=plate` 完整补回。阈值按球直径 390px / 120 列时 `px≈0.15` 标定
4. **合拢态收敛**：缝隙改为「绝大多数是暗槽，只有约 3% 通电板有橙色脉络」；补一层极淡程序化天光梯度 + 球缘暖光给球面体积；**合拢态只渲染最外层**（原来三层同心球同时渲染，内层桁架线叠成一张网）
5. **画质参数化**：面板新增「画质 / 胶片」分组（色调映射 / 胶片红晕 / 红晕半径 / 锐化 / 暗部抖动），三套预设补齐；`?tm=AgX|Neutral` 供定帧 A/B 对比

**验证中修掉的问题**

- `active` 是 GLSL 保留字（`patch` 之后第二次踩），壳层 shader 整段不编译 → 改名 `charged`
- 第一版天光在线性 HDR 里给到 0.05，经 ACES 后亮成「蓝灰线框球」，比原来的橙色网格球更吵 → 压到 0.01 量级，并把 `detailFade` 阈值从 `0.05~0.20` 校准到 `0.012~0.055`（原阈值下远景仍残留 22% 细节）
- 误判「三层叠加」为唯一根因，单层化后网格仍在 → 真正残留是暗槽基线 `0.09` 与 `groove` 没跟随 `detailFade`，已一并修掉
- halation 用 12 tap 求平均会被稀释（亮源只占少数 tap），归一从 `/12` 改 `/8`，默认强度 / 半径上调

**定帧**：`preview/13` 合拢态、`14` 第二幕、`15` 恒星特写、`16` 分层态、`17` AgX 对比、`18` 装甲板近景。`npm run build` 通过，本机 Chrome 多视角截图 + stderr 日志无 shader / JS 错误，**未下载任何浏览器**。

**遗留**：halation 目前是刻意保守的微妙效果（参数可拉到 1.2 / 半径 0.14）；要做真正宽厚的红晕需换成 bloom mip 链上取一级，而不是在 grade pass 里盘采样。

### 原型阶段仍未做（后续里程碑）

> **影视质感升级见 [`CINEMATIC_UPGRADE_PLAN.md`](./CINEMATIC_UPGRADE_PLAN.md)**：把「画质更好」升级为「像一部片子拍出来的」，含镜头语言 / 体积光 / 比例参照物 / 后期链重构 / 58 秒分镜表，编号 C0–C4。
> **C0 + C1 已落地**（见该文档第 15 节与本文件 13.5）：焦段系统、景深、手持、2.39 遮幅、体积光、大气透视、anamorphic 光晕、曝光适应，六镜头 58 秒分镜 `preview/19..24`。

- 第一幕（S1）已随 C0 重构成 24mm + 2.39 遮幅；缆线本身仍未进入构图，留给 C4 分镜级重排
- ~~合拢态脉络形态：孤立小方框~~ → C1 已改成「每块只点亮一对边」，远景退化为断续短划
- 恒星表面在 85mm 特写下仍是熔岩团而非米粒组织（C2 材质密度）
- M5/M6：三级 LOD 曝光曲线、自动巡游、热点信息卡、移动端降级
- 远景瓦片密度：程序化 shader 的板件细节在远景是亚像素级，正式版用「远球面 / 近 InstancedMesh」双轨 LOD 补回真实几何厚度

### 13.5 C0 + C1：电影感（镜头语言 / 光与大气）

> 详细记录见 [`CINEMATIC_UPGRADE_PLAN.md`](./CINEMATIC_UPGRADE_PLAN.md) 第 15 节。这里只记架构层面的变动。

**后期链从 4 个 pass 变成「手动三段 + composer 五段」**

```
场景 → rtScene(HalfFloat + 4×MSAA + DepthTexture)
     ├→ 亮度测量 8×8 → 曝光平滑 1×1 ping-pong ─┐
     └→ 体积光 半分辨率 20 step ─┐               │
composer: SourcePass → 叠加体积光 → bloom → DOF → grade ← ┘ → OutputPass
```

- **场景必须单独一条 RT**：composer 的 RT1/RT2 每帧互写，`clear()` 会连深度一起清，深度纹理挂上去迟早被清掉（且与 pass 数量奇偶有关）。`src/cinema/passes.js` 的 `SourcePass` 用一次全屏 blit 把场景搬进链，代价 0.2ms
- **MSAA 与可读深度不冲突**：`three@0.169` 在多采样 RT 上会 `blitFramebuffer` 时带上 `DEPTH_BUFFER_BIT`，深度被 resolve 进 `DepthTexture`
- **恒星遮挡在 shader 里判**：JS 只算视锥可见性，遮挡用 `viewZ(uSunUV)` 与视深度 `uSunDepth` 比较，避免 GPU 回读 stall

**新增模块**

- `src/cinema/lens.js` 焦段表（24/28/35/50/85mm，垂直 FOV）
- `src/cinema/shot.js` 缓动 / 三频手持 / 呼吸 / `driveShot()`
- `src/cinema/sequence.js` S1–S6 六镜头 58 秒，每镜头带完整参数 state 与 prevState 过渡
- `src/cinema/passes.js` `SourcePass`

**顺带修的观感问题**：合拢态 / 分层态的通电脉络原来是「每块板描一圈边」，远景变成满球橙色方框（贴纸感）。改成每块只点亮随机一对边 `edgeOn`、通电比例压到 1.5%，远处退化成断续短划 —— S3/S4/S6 的差别非常大。

**验证**：`npm run build` 通过；本机 Chrome 六镜头定帧 `preview/19..24` + 26 秒连续播放过场，stderr 无 shader / JS / `GL_INVALID` 错误，**未下载任何浏览器**。

**已知取舍**：从地表看恒星角直径约 40°，2.39 遮幅把 35mm 的有效垂直视场压到 28°，装不下 —— S1 因此用 24mm（有效 39°）。这不是 bug，是压缩尺度 + 宽银幕的必然结果，记在这里免得以后又被"修"回去。

---

### 13.6 A + B + C3：运转的证据（已完成）

C1 交付后发现一个更基础的问题：**画面里没有任何东西能证明这颗球有多大、在不在动。**
8 倍行星半径的壳摆在纯黑背景里，缺少尺度参照，也缺少运动参照。

物理上先把话说清（这一条决定了做什么、不做什么）：

- **刚性壳不该整体自转。** 牛顿壳层定理：均匀球壳内部引力为零，壳面靠自身
  压缩应力平衡，不靠绕转维持。强行整体自转会让离心力（∝ r·ω²，极点为 0、
  赤道最大）把壳拉成盘。**所以合拢态保持静止是对的。**
- **戴森云**才大量公转，但它不构成本项目"一颗完整的球"的视觉前提。

因此不做"整球旋转"，改做三件事：

**A1 · 恒星真自转**（`uSpin`）
旋转噪声采样坐标而不是让噪声形变 —— 形变是"沸腾"，旋转才是"在转"。

**A2 · 工程灯阵列**（840 点 / 14 条经线成串）
静态尺度证据。三个坑：z-fighting（抬升 0.004 → 0.06）、亚像素消失
（`gl_PointSize` 加 2.2px 下限）、随机撒点读作噪点（改成等距成串）。
配 `traffic` 穿梭机（4 架低多边形梭形 + 导航灯）沿倾斜大圆轨道运行。

**B · 分层态三层反向自转**（`SPIN_RATE = {-0.115, +0.078, -0.036}`）
动态机械证据。合拢态权重 0，explode/cut 打开后 smoothstep 淡入。
速度从 0.045 提到 0.078 的原因：球壳绕轴转轮廓不变，唯一能读出旋转的是板缝与
灯带位移，2.6°/s 在十几秒的镜头里根本看不出来。

**C3.1 · 物理 bloom**（`src/cinema/bloom.js`）
5 级 mip / 13-tap 降采样 / 第一级 Karis average / 9-tap tent 上采样加法叠加。
`uScatter` 必须按「叠加量」重新标定，不能照搬 `UnrealBloomPass.strength` ——
实测 0.13 只有 0.3 个灰阶，5.0 核心过曝，**1.5（`bloom * 3.0`）**才落在
"高光真的溢出去、但不洗掉明暗层次"。

这一项的视觉收益比预期大得多：灯点有了光晕之后，S3 合拢态从"一颗平面网格球"
变成"一颗安静的球，表面有文明灯火"，尺度感是灯带来的。

**C3.2 · teal-orange 分级**（`FINAL_SHADER`）
跑在 `OutputPass` 之后（显示空间）：lift/gamma/gain + 饱和度 + S 曲线，
暗角/颗粒/dither/遮幅一并迁入。`GRADE_SHADER` 只留线性 HDR 该做的事。

**顺带修掉的三处画面事故**

| 现象 | 真实原因 | 修法 |
|---|---|---|
| 球壳表面一片白色碎十字 | `uReveal` 掀板在远景退化：一块 tile 只 3 像素，洞里透出的内层桁架被采样成碎点 | 加 `revealFade`，远景不掀板 |
| S4 顶底被切，读不出三层 | 35mm 在 41 距离装不下 20.4 直径（遮幅后有效垂直视场约 24°） | 改 24mm + 距离 34→28 |
| S1 右侧一片没有结构的灰墙 | 塔基 `platform` 圆盘直径 0.096，相机距它 0.085 | 贴地时隐藏 platform，只留 spire + 光柱 |

**验证**：`npm run build` 通过；六镜头定帧归档 `preview/25..30`；
`?view=plate` / `?view=ground` 检视视角回归正常；headless stderr 无 shader / JS /
`GL_INVALID` 错误，**未下载任何浏览器**。

**已知局限**：S3 合拢态整幅在暗部，S 曲线把 lift 的提亮抵消，teal-orange 在那个
镜头里几乎看不出色彩分离（取材问题，不是 bug）；恒星在 85mm 特写下仍是"熔岩团"
而不是"米粒组织"，留待 C2。

---

### 13.7 恒星米粒组织 + 运动模糊（已完成）

**恒星：从「熔岩团」到米粒组织**

问题不在噪声质量，在频谱分配。旧实现是 `cell`（频率 5.6，权重 0.70 且对比 ×2.4）
压着 `gran`（频率 34，权重 0.22）—— 频率 34 画出的是"对流胞"尺度，不是米粒；
而 `cell` 的对比拉满之后吃掉整个动态范围，颗粒再细也被淹没。

关键认知：**真实恒星表面亮暗差只有 20~30%**。画面里那种白热 vs 暗红的巨大反差
是过曝和 bloom 造成的，不是表面本身的属性。所以改法不是"加更多细节"，而是
**把大尺度的对比压回去，把动态范围让给高频**：

- 米粒频率 118 / 232，2 octave `vnoise`（不用 5 octave `fbm`：基频 100 的 fbm
  最高 octave 到 1700，只会糊成中频块）
- 米粒做**乘性**调制而非加性，整体平均亮度不变
- `cell` 对比 `×2.4 → ×1.1`
- `fwidth` 淡出，远处恒星自动退回平滑（S6 窗口里那颗就是靠这个）

黑子同步重做：本影 + 半影 + 半影放射细丝。少了细丝层，暗斑就是纯色块，
大尺度下读作"大陆板块"。

副产品：`vnoise` 调用从 11 次降到 6 次，性能反而更好。

**运动模糊（C3.3）**

`src/cinema/motionblur.js`。深度反投影回世界坐标 → 上一帧 viewProj 重投影 →
屏幕速度 → 12 tap 定向模糊。放在 bloom 之后、DOF 之前。

不用径向模糊的理由：径向模糊假设画面中心就是运动中心，环绕运镜时星空会被搅成
漩涡；重投影能天然区分远近，这才是正确的透视结果。

三道保护：天空（深度 1）跳过、`w ≈ 0` 跳过、超速 clamp。定帧时速度恒为 0，
画面与关闭时逐像素一致（残留差异是 HalfFloat RT 往返量化）。

**已知局限**：这套分镜运镜很稳（S3 十秒移动 5 个单位），真实屏幕速度只有
0.002~0.008，成片里几乎看不到运动模糊 —— 它是为手动快速旋转准备的能力。

**验证**：build 通过；六镜头重新定帧 `preview/25..30`；`?mbfake=` 验证采样链路；
全程只用本机 Chrome，未下载任何浏览器。

### 13.8 C4 · 转场与叙事连续性（已完成）

**误判纠正**：`explode` 在切点本来就在过渡（`shot.js` 一直有 `u < 0.3` 从上一镜
`mixState` 的逻辑）。S3→S4 的"硬切感"只来自**机位**：S3 收在距中心 22.7，S4 开在
34.1，方向几乎一致但距离跳 1.5 倍，读作一次 dolly 跳变。

**S3→S4 做成连续镜头**，三件缺一不可：

1. S4 的 `from` 与 S3 的 `to` **逐位相同**（pos / target / focus / exposure）
2. `ease: 'out'` —— 开头快、结尾慢，才有"被冲击推开"的读法
3. `impact`（新增）—— 沿视线把相机往后推一下，起势 `1-e^(-26t)`（约 2 帧到 35%）

探针实测 `Δpos / Δtarget / Δfov / Δfocus / Δexp` 全为 **0.0000**；像素扫描球体
屏幕宽度 893px vs 894px。

**顺带修掉的真 bug**：`morph` 原来是全局 0.3，在**换主体**的切点上出事 ——
S5（恒星特写）的头 2.4 秒里 S4 的壳层还赖着，而相机此时贴着壳层，画面是
**壳板内表面**；S6 的布尔量在 `k=0.5` 处整块弹出。默认改成 0，只有 S4 给 0.075。
之前所有定帧都取 `u=0.55` 所以没暴露。

**首尾淡入淡出**：`FINAL_SHADER` 新增 `uFade`，乘在颗粒**之后**（否则黑场里飘
噪点，与遮幅黑边不一致）。开头 1.6s / 结尾 2.2s。序列是 modulo 循环的，S6 环绕镜
硬切回 S1 地面日出必须中间留黑。

**时长** 58s → 55s（S4 14→11s）：`ease:'out'` 3 秒走完 97%，剩 11 秒只挪 0.8%，
那不是稳定是卡住。

**新增入口**：`?film=S4@0.02`（锁任意 u 定帧）、`?fade=0.35`（检查淡入淡出）。

**验证**：build 通过；定帧 `preview/31..34`；全程只用本机 Chrome，未下载任何浏览器。

### 13.9 全片复核与打磨（C4 之后）

用「六镜头 × 5 进度点 = 30 帧联系表」扫全片（`preview/39-全片联系表.png`），
发现四个只盯切点看不出来的问题：

**① 分级在暗调画面上是反向的。** `?p.grade=0/1` 对比实测：开分级比关分级更暗
（mean 14.18 vs 14.83）、更不蓝（暗部 B−R +12.07 vs +12.90）。根因是
`FINAL_SHADER` 的 S 曲线在暗部近似 `g²`，把上游只有 0.006~0.020 的 lift 平方掉。
修法是给 S 曲线脚部加 `smoothstep(0.045, 0.34, g)` 权重 —— 中高调逐像素不变
（`g²(3-2g)` 在 g=0.5 是不动点），暗部保住 lift。

**② S2 的缆环是纯色面片。** 场景只有一盏点光（给塔基），电梯的环/板全是
`MeshBasicMaterial`，不受光。恒星在世界原点，故入射方向就是 `normalize(-vW)`，
给一套 `N·L + Fresnel` 的假光照，颜色从纯青 `0x66c8e0` 去饱和到钢青 `0x4d94ab`。
不能用 MeshStandardMaterial（点光照不到缆线，会渲染成黑）。

**③ S1 前景地面：不是频率不够，是脚下 day ≈ 0。** 纯红输出 `land` 排除了"其实是
海"；灰度输出 `day` 显示脚下整片近黑（站在晨昏线暗侧）。所以加法线扰动无效
（扰动只能放大 day），而 albedo 被 `(0.18 + 1.00*day)` 压到 18%。改为
`(0.42 + 0.55*day)` 并把 albedo 分布从 3.4:1 拉到 5.7:1。系数不用 0.62 是因为
那会把地面抬亮 47%，读作"已经天亮"。

**④ S6 与 S4 同构图。** 原来 S6 也是"顺着孔口看进去的管子"。试过侧视分层、
远景、低角度三条路都不成立 —— **三层只有在顺着孔轴看进去时才成立**（外层不透明，
内层全在外层轮廓内），远景则被 fwidth 淡出洗掉网格。最终改为**合拢**（explode 0 /
cut 0）+ `linear` 缓动（out/inOut 结尾速度归零会"停住"）+ `orbit -0.62` + 淡出。

**验证**：build 通过；S3→S4 切点连续性回归（球体屏宽 893 vs 894px）；定帧
`preview/35..39`；全程只用本机 Chrome，未下载任何浏览器。

### 13.10 成片导出 + S1 地面建模级细节（已完成）

**成片**：浏览器内 `MediaRecorder` + `canvas.captureStream(30)` 直接编码 H.264，
`tools/recv.mjs`（端口 4174）接 `POST /save` 落盘到 `out/`。
`?capw=&caph=` 把渲染缓冲钉死在 1920×1080（headless 的 `--window-size` 会少 87px）。
成品 `out/dyson-film.mp4` 1920×1080 / 56.046s / H.264 / ~19.4 Mbps；
MediaRecorder 输出的是分片 MP4（`mvhd` 时长为 0），用
`avconvert -p PresetPassthrough` 重封装成 `dyson-film-remux.mp4`。

**S1 地面道具**：`src/groundprops.js`，岩脊 12 / 中景石块 110 / 近景碎石 300 /
3 个陨坑的环形岩缘 74 / 3 桅杆 + 2 模块箱 + 1 缆索锚块。全部确定性随机
（`mulberry32(0x5eed1a7)`），随分镜每次播放完全一致。

四个坑（详见 `CINEMATIC_UPGRADE_PLAN.md` §20.2）：

1. 自写 `ShaderMaterial` **必须自己乘 `instanceMatrix`**，否则实例全塌到原点 ——
   画面一片空白且没有任何报错。
2. 贴地机位的**可见地面只有 arc 0.065~0.177 一条窄带**，摆位必须按屏幕投影筛选
   （`tools/probe-s1.mjs` 是离线探针），不能按"离相机多远"想当然。
3. 行星顶点位移（`uRelief` 0.012）比石头还高，**整片埋掉**；GPU 噪声无法在 JS
   对齐，而 S1 掠射机位下位移又不出剪影 → S1 `relief: 0`。
4. **S1 的景深一直是满模糊**：焦点 2.4 而地面 0.07~0.18，`|z-focus|/z` 比值 20 倍，
   任何 `dof > 0.02` 都被 clamp 到 1。要地面细节必须 `dof: 0`。

**顺带修的真 bug**：`elevator.js` 里 `buildCableGeometry` 的定义在上一轮抽
`litmat.js` 时被误删，引用还在 → 启动即 `ReferenceError`，页面停在加载幕布。
rollup 不报未定义标识符，只能靠真跑一次发现。已按 `CABLE_VERT` 的属性重写。

**验证**：build 通过；八格联系表 `preview/43-全片联系表.png` 逐格复核；
S1 定帧 `preview/40`、`preview/44`；S2 缆索编织结构回归正常。
