import * as THREE from 'three';
import { CFG } from './config.js';

/**
 * 尺度参照物。
 *
 * 观众无法从「8.7 个视觉单位」推出这颗球有多大 —— 必须有一件熟悉尺度的东西
 * 在旁边飞。这是「不可能感」的真正来源，也是 C2 里性价比最高的一项。
 *
 * 做法上刻意保守：只有低多边形剪影 + 引擎光 + 航行灯，不建模细节。
 * 剪影在远景比任何细节都有效，而细节一旦糊掉就变成脏点。
 */

const SHELL_R = CFG.shell.layers[2].r;

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(198,228,255,0.62)');
  g.addColorStop(0.55, 'rgba(120,170,255,0.14)');
  g.addColorStop(1.0, 'rgba(90,140,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 96, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 一架梭形：机身 4 个三角面 + 两片尾翼，18 个顶点，纯剪影 */
function dartGeometry() {
  const v = new Float32Array([
     0.00,  0.00,  0.55,  -0.26,  0.00, -0.45,   0.00,  0.09, -0.34,
     0.00,  0.00,  0.55,   0.00,  0.09, -0.34,   0.26,  0.00, -0.45,
     0.00,  0.00,  0.55,   0.26,  0.00, -0.45,   0.00, -0.09, -0.34,
     0.00,  0.00,  0.55,   0.00, -0.09, -0.34,  -0.26,  0.00, -0.45,
    -0.26,  0.00, -0.45,  -0.40,  0.20, -0.58,   0.00,  0.09, -0.34,
     0.26,  0.00, -0.45,   0.00,  0.09, -0.34,   0.40,  0.20, -0.58,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function makeTraffic(scene, materials) {
  const group = new THREE.Group();
  scene.add(group);

  const tex = radialTexture();
  const bodyGeo = dartGeometry();
  // 纯剪影：不吃光照，只保证不会变成纯黑看不见
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x0b1119, side: THREE.DoubleSide });

  const ships = [];
  const RIB = [
    { r: 9.65, size: 0.075, inc: 0.30, tilt: -0.22, speed: 0.043, phase: 0.0, hue: 0.0 },
    { r: 10.60, size: 0.105, inc: -0.16, tilt: 0.40, speed: 0.028, phase: 2.1, hue: 1.0 },
    { r: 11.80, size: 0.130, inc: 0.52, tilt: 0.10, speed: 0.019, phase: 4.3, hue: 0.0 },
    { r: 9.95, size: 0.058, inc: -0.42, tilt: -0.55, speed: 0.055, phase: 5.6, hue: 1.0 },
  ];

  RIB.forEach((cfg) => {
    const g = new THREE.Group();
    g.scale.setScalar(cfg.size);
    g.add(new THREE.Mesh(bodyGeo, bodyMat));

    const drive = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: cfg.hue > 0.5 ? 0x9fd0ff : 0xffd2a0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    drive.scale.setScalar(1.9);
    drive.position.z = -0.62;
    g.add(drive);

    const strobe = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: 0xff5a3c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    strobe.scale.setScalar(0.55);
    strobe.position.set(0, 0.13, -0.1);
    g.add(strobe);

    group.add(g);
    ships.push({
      g, drive, strobe,
      phase: cfg.phase,
      speed: cfg.speed,
      // 轨道平面：先绕 Z 倾斜，再给一点绕 X 的进动
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(cfg.inc * 0.6, cfg.tilt, cfg.inc)),
      radius: cfg.r,
      size: cfg.size,
    });
  });

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();

  return {
    group,
    update(t, dt, p) {
      const on = p.traffic > 0.001;
      group.visible = on;
      if (!on) return;
      const k = p.traffic;

      for (const s of ships) {
        s.phase += dt * s.speed;
        const a = s.phase;
        _p.set(Math.cos(a) * s.radius, 0, Math.sin(a) * s.radius).applyQuaternion(s.quat);
        _t.set(-Math.sin(a), 0, Math.cos(a)).applyQuaternion(s.quat);
        s.g.position.copy(_p);
        _n.copy(_p).add(_t);
        s.g.lookAt(_n);

        // 引擎亮度跟着自身摆动一点点，别像贴了张静态贴图
        s.drive.material.opacity = (0.78 + 0.22 * Math.sin(t * 3.1 + s.phase * 7.0)) * k;

        // 航行灯：短促的红色双闪
        const bl = Math.pow(Math.max(0, Math.sin(t * 1.15 + s.phase * 5.0)), 22.0);
        s.strobe.material.opacity = bl * 1.2 * k;
        s.strobe.scale.setScalar(0.42 + bl * 0.42);
      }
    },
    setVisible(v) { group.visible = v; },
    get radiusHint() { return SHELL_R; },
  };
}
