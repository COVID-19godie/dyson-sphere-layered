import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * 屏幕空间运动模糊（相机速度）。
 *
 * 做法：用当前帧深度把像素反投影回世界坐标，再用**上一帧**的 viewProj 投回屏幕，
 * 两者之差就是这一像素在这一帧里横移了多少 —— 沿这个方向做定向模糊。
 *
 * 为什么不用「按相机角速度做径向模糊」那种廉价方案：
 * 径向模糊假设画面中心就是运动中心，环绕运镜时背景（恒星、星空）会被错误地
 * 搅成漩涡，而实际上远景几乎不动、只有近景在飞。重投影能天然区分：远处世界点
 * 在屏幕上的位移小，近处位移大，这是正确的透视结果。
 *
 * 放在 bloom 之后、DOF 之前：
 *   - 在 bloom 之前会让高光的溢光被拉成条，看起来像"光在漏";
 *   - 在 DOF 之后会把已经虚化的边缘再抹一遍，景深读数会糊掉。
 */

const MB_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform float uScale;
uniform float uMaxVel;
uniform float uFake;
varying vec2 vUv;

const int TAPS = 12;

void main() {
  vec4 base = texture2D(tDiffuse, vUv);

  // 调试：定帧截图时相机是静止的，速度恒为 0，没法看效果。
  // ?mbfake=0.02 强制一个水平速度，专门用来确认采样方向和强度。
  if (uFake > 0.0001) {
    vec2 vel = vec2(uFake, 0.0);
    vec3 acc = vec3(0.0);
    float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < TAPS; i++) {
      float f = (float(i) + jitter) / float(TAPS) - 0.5;
      acc += texture2D(tDiffuse, vUv + vel * f).rgb;
    }
    gl_FragColor = vec4(acc / float(TAPS), 1.0);
    return;
  }

  float d = texture2D(tDepth, vUv).x;

  // 天空（深度 1）不参与：无穷远点反投影会退化成巨大的世界坐标，
  // 重投影后速度乱飞，整片背景会被撕开。
  if (d >= 0.99999) { gl_FragColor = base; return; }

  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * ndc;
  if (abs(world.w) < 1e-6) { gl_FragColor = base; return; }
  world /= world.w;

  vec4 prevClip = uPrevViewProj * vec4(world.xyz, 1.0);
  if (abs(prevClip.w) < 1e-6) { gl_FragColor = base; return; }

  vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
  vec2 vel = (vUv - prevUv) * uScale;

  float len = length(vel);
  // 超长速度（一般是重建失败或刚切镜头）直接归零，否则整屏拖影
  if (len > uMaxVel) vel *= uMaxVel / len;
  else if (len < 0.0006) { gl_FragColor = base; return; }

  // 抖动：等距采样会让运动物体的边缘出现条纹
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) + jitter) / float(TAPS) - 0.5;
    acc += texture2D(tDiffuse, vUv + vel * f).rgb;
  }
  gl_FragColor = vec4(acc / float(TAPS), 1.0);
}
`;

export class MotionBlurPass extends Pass {
  constructor(depthTexture) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uScale: { value: 1.0 },
      uMaxVel: { value: 0.035 },
      uFake: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: MB_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.quad.dispose();
    this.material.dispose();
  }
}
