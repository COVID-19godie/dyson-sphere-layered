import * as THREE from 'three';

/**
 * "假光照"材质。
 *
 * 这个场景里唯一的真实光源是 objects.js 给塔基加的那一盏 PointLight，而且
 * 距离衰减半径是 0 —— 缆线、地面道具这些地方根本收不到光。所以凡是
 * MeshBasicMaterial 的物体都是纯色平涂：在 S2（缆索攀升）里表现为霓虹灯圈
 * 和蓝色占位面片，一眼就是没做完。
 *
 * 恒星在世界原点（行星组整体挂在 (0, 0, CFG.planet.orbit)），所以「指向光源」
 * 就是 normalize(-vW)，不需要任何 uniform 传光源位置 —— 这也是这里不去用
 * MeshStandardMaterial 的原因：后者要真实灯源，换过去会整个渲染成黑色。
 *
 * 用一个 N·L + 环境项 + Fresnel 边缘光，物体立刻有了体积：
 * - emis  自发光地板。灯、窗这类"自己会亮"的东西给 0.7~0.9，
 *         结构件给 0.10~0.25。
 * - amb   背光面的环境亮度，防止纯黑。
 * - fres  掠射边缘光的强度。金属件靠它出轮廓，逆光剪影也靠它不至于糊成黑块。
 * - rim   边缘光的颜色。默认取本体色提亮（金属、灯窗都适用）；
 *         石头这种"逆光剪影"要单独给一个暖色 —— 因为边缘光如果是乘在
 *         albedo 上的，深色石头乘出来还是深色，只会是一张黑纸片，
 *         根本读不出体积。真实的逆光石是靠轮廓上那一线天光。
 */
const cache = new Map();

export function litMat(color, emis = 0.30, amb = 0.12, fres = 0.35, rim = null) {
  const key = `${color}_${emis}_${amb}_${fres}_${rim ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rimCol = new THREE.Color(rim == null ? color : rim);
  if (rim == null) rimCol.multiplyScalar(1.7);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uEmis: { value: emis },
      uAmb: { value: amb },
      uFres: { value: fres },
      uRim: { value: rimCol },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        // InstancedMesh 必须自己乘 instanceMatrix：ShaderMaterial 不会像
        // 内置材质那样自动插入 #include <begin_vertex>，three 只负责
        // 声明 attribute 和 USE_INSTANCING 宏。漏了这一步，几百个实例
        // 会全部塌到模型原点（行星中心，球体内部）——画面上一个都看不到。
        #ifdef USE_INSTANCING
          mat4 xform = modelMatrix * instanceMatrix;
        #else
          mat4 xform = modelMatrix;
        #endif
        vN = normalize(mat3(xform) * normal);
        vec4 wp = xform * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uEmis;
      uniform float uAmb;
      uniform float uFres;
      uniform vec3 uRim;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        vec3 l = normalize(-vW);                  // 指向世界原点的恒星
        float ndl = max(dot(n, l), 0.0);
        vec3 v = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        // 天光：朝上的面接到更多来自天顶的散射。
        // 没有这一项，逆光的低多边形石头每个面都是 ndl≈0，整块石头
        // 就退化成一张同色的剪纸 —— 棱角白给了。
        float sky = 0.5 + 0.5 * n.y;
        float amb = uAmb * (0.30 + 1.40 * sky);
        float k = uEmis + (1.0 - uEmis) * (amb + (1.0 - uAmb) * ndl);
        gl_FragColor = vec4(uColor * k + uRim * rim * uFres, 1.0);
      }
    `,
  });

  cache.set(key, mat);
  return mat;
}
