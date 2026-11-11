import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * 物理 bloom（mip 链 + Karis average）。
 *
 * 为什么不用 UnrealBloomPass：它是对「阈值后的亮部」做几层高斯近似再相加，
 * 有两个硬伤 ——
 *   ① 没有 Karis average，单个超亮像素（星点、板缝高光）会在各层里被反复放大，
 *      运镜时抖成「萤火虫」；
 *   ② 各级权重是硬编码的加法，能量不守恒，调 strength 会同时改变「亮度」和「范围」，
 *      没法只想要更宽或只要更亮。
 *
 * 这里的做法是 COD:AW（Jimenez 2014）那套：
 *   降采样 13-tap → 第一级额外做 Karis 加权（1/(1+luma)）+ soft-knee 阈值
 *   上采样 9-tap tent，逐级累加回上一级
 * 好处是「范围」由 mip 级数决定、「亮度」由 scatter 决定，两个旋钮互不干扰。
 */

const HI = THREE.HalfFloatType;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 tap(vec2 o) {
  vec3 c = texture2D(tDiffuse, vUv + uTexel * o).rgb;
  if (uPrefilter > 0.5) {
    // soft knee：阈值附近线性过渡，硬阈值会让亮部边缘跳变
    float l = luma(c);
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float w = max(soft, l - uThreshold) / max(l, 1e-4);
    c *= w;
  }
  return c;
}

void main() {
  vec3 a = tap(vec2(-2.0, -2.0));
  vec3 b = tap(vec2( 0.0, -2.0));
  vec3 c = tap(vec2( 2.0, -2.0));
  vec3 d = tap(vec2(-1.0, -1.0));
  vec3 e = tap(vec2( 1.0, -1.0));
  vec3 f = tap(vec2(-1.0,  1.0));
  vec3 g = tap(vec2( 1.0,  1.0));
  vec3 h = tap(vec2(-2.0,  2.0));
  vec3 i = tap(vec2( 0.0,  2.0));
  vec3 j = tap(vec2( 2.0,  2.0));
  vec3 k = tap(vec2( 0.0,  0.0));
  vec3 l = tap(vec2(-1.0,  0.0));
  vec3 m = tap(vec2( 1.0,  0.0));

  // 13-tap 权重（已归一）
  vec3 sum = a * 0.03125 + c * 0.03125 + h * 0.03125 + j * 0.03125
           + d * 0.0625 + e * 0.0625 + f * 0.0625 + g * 0.0625
           + b * 0.125 + i * 0.125 + l * 0.125 + m * 0.125
           + k * 0.125;

  // Karis average：把每个 tap 的核权重再乘 1/(1+luma)，超亮像素的权重被压到接近 0。
  // 只在第一级做 —— 后面几级已经没有 firefly 了。最后按总权重归一，核形状不变。
  if (uPrefilter > 0.5) {
    float wa = 0.03125 / (1.0 + luma(a));
    float wb = 0.125 / (1.0 + luma(b));
    float wc = 0.03125 / (1.0 + luma(c));
    float wd = 0.0625 / (1.0 + luma(d));
    float we = 0.0625 / (1.0 + luma(e));
    float wf = 0.0625 / (1.0 + luma(f));
    float wg = 0.0625 / (1.0 + luma(g));
    float wh = 0.03125 / (1.0 + luma(h));
    float wi = 0.125 / (1.0 + luma(i));
    float wj = 0.03125 / (1.0 + luma(j));
    float wk = 0.125 / (1.0 + luma(k));
    float wl = 0.125 / (1.0 + luma(l));
    float wm = 0.125 / (1.0 + luma(m));
    vec3 acc = a * wa + b * wb + c * wc + d * wd + e * we + f * wf + g * wg
             + h * wh + i * wi + j * wj + k * wk + l * wl + m * wm;
    float ws = wa + wb + wc + wd + we + wf + wg + wh + wi + wj + wk + wl + wm;
    sum = acc / max(ws, 1e-5);
  }

  gl_FragColor = vec4(sum, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
void main() {
  // 9-tap tent：双线性采样 + [1 2 1] 可分离卷积，上采样时天然平滑，不需要额外 blur
  vec3 s = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 1.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2( 0.0, -1.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 1.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  0.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv).rgb * 4.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  0.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 1.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2( 0.0,  1.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 1.0;
  gl_FragColor = vec4(s * (1.0 / 16.0) * uScatter, 1.0);
}
`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uScatter;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  gl_FragColor = vec4(base + bloom * uScatter, 1.0);
}
`;

const LEVELS = 5;

const quadMat = (frag, extra) => new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uPrefilter: { value: 0 },
    uThreshold: { value: 0.8 },
    uKnee: { value: 0.35 },
    uScatter: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: frag,
  depthTest: false,
  depthWrite: false,
  ...extra,
});

export class PhysicalBloomPass extends Pass {
  constructor() {
    super();
    this.mips = [];
    for (let i = 0; i < LEVELS; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, {
        type: HI,
        depthBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      }));
    }
    this.downMat = quadMat(DOWN_FRAG);
    this.upMat = quadMat(UP_FRAG, {
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.compMat = quadMat(COMP_FRAG);
    this.downQuad = new FullScreenQuad(this.downMat);
    this.upQuad = new FullScreenQuad(this.upMat);
    this.compQuad = new FullScreenQuad(this.compMat);
    this.needsSwap = true;
    this._w = 1;
    this._h = 1;
  }

  setSize(width, height) {
    this._w = Math.max(1, Math.round(width));
    this._h = Math.max(1, Math.round(height));
    let w = this._w;
    let h = this._h;
    for (const m of this.mips) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      m.setSize(w, h);
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const prevAutoClear = renderer.autoClear;

    // 1) 预过滤 + 降到 1/2
    this.downMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.downMat.uniforms.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    this.downMat.uniforms.uPrefilter.value = 1;
    renderer.setRenderTarget(this.mips[0]);
    renderer.clear();
    this.downQuad.render(renderer);

    // 2) 逐级降到 1/32
    this.downMat.uniforms.uPrefilter.value = 0;
    for (let i = 1; i < LEVELS; i++) {
      const src = this.mips[i - 1];
      this.downMat.uniforms.tDiffuse.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      renderer.setRenderTarget(this.mips[i]);
      renderer.clear();
      this.downQuad.render(renderer);
    }

    // 3) 逐级上采样叠加（加法混合，不清屏）
    renderer.autoClear = false;
    for (let i = LEVELS - 1; i > 0; i--) {
      const src = this.mips[i];
      this.upMat.uniforms.tDiffuse.value = src.texture;
      this.upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      renderer.setRenderTarget(this.mips[i - 1]);
      this.upQuad.render(renderer);
    }
    renderer.autoClear = prevAutoClear;

    // 4) 合成
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.compMat.uniforms.tBloom.value = this.mips[0].texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }

  dispose() {
    this.mips.forEach((m) => m.dispose());
    this.downQuad.dispose();
    this.upQuad.dispose();
    this.compQuad.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compMat.dispose();
  }
}
