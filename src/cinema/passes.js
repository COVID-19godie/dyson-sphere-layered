import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`;

/**
 * 把一条外部 RT 的结果搬进 composer 的 ping-pong 链。
 *
 * 为什么不直接把 composer 自己的 renderTarget1 挂上 depthTexture：
 * composer 每帧在 RT1 / RT2 之间来回写，pass 写之前会 clear()，
 * 而 clear 默认连 DEPTH_BUFFER_BIT 一起清 —— DOF、体积光、大气透视读到的深度
 * 就会变成一片空白。给场景单独一条 RT，深度永远有效，也不用操心 pass 数量的奇偶。
 * 代价只有一次全屏 blit。
 */
export class SourcePass extends Pass {
  constructor(source) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: source } },
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  render(renderer, writeBuffer) {
    renderer.setRenderTarget(writeBuffer);
    this.fsQuad.render(renderer);
  }

  setSize() { /* 全屏 quad，无需随尺寸重建 */ }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
