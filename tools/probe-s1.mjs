/**
 * 离线探针：算出 S1 定帧处「地表上某点」投影到屏幕的位置。
 * 用来回答一个问题 —— 我摆的石头到底在画里，还是在画幅下面。
 *
 *   node tools/probe-s1.mjs
 */
import * as THREE from 'three';
import { CFG } from '../src/config.js';
import { SEQUENCE } from '../src/cinema/sequence.js';
import { driveShot } from '../src/cinema/shot.js';

const W = 1920, H = 1080, ASPECT = W / H;
const MATTE = 2.39;                       // 最终画面的宽高比，上下有黑边
const VIS_H = ASPECT / MATTE;             // 可见高度占整幅的比例（裁的是上下）
const Y_MAX = VIS_H;                      // 可见区 NDC 的 y 上限（±）

const cam = new THREE.PerspectiveCamera(30, ASPECT, 0.001, 1000);
const shot = SEQUENCE[0];
const U = 0.55;
driveShot(cam, shot, U, 0, { shake: 0, breath: 0 });
cam.updateMatrixWorld();
cam.updateProjectionMatrix();

const R = CFG.planet.r;
const orbit = CFG.planet.orbit;

const P = new THREE.Vector3()
  .addVectors(shot.from.pos, shot.to.pos).multiplyScalar(0.5);
P.z -= orbit;                             // 转到行星局部坐标
const T = new THREE.Vector3()
  .addVectors(shot.from.target, shot.to.target).multiplyScalar(0.5);
T.z -= orbit;

const N = P.clone().normalize();
const D = T.clone().sub(P).normalize();
const F = D.clone().addScaledVector(N, -D.dot(N)).normalize();
const S = new THREE.Vector3().crossVectors(N, F).normalize();

const camLocal = new THREE.Vector3().copy(cam.position);
camLocal.z -= orbit;
const h = camLocal.length() - R;

console.log('cam fov      ', cam.fov.toFixed(2), ' aspect', ASPECT.toFixed(3));
console.log('camera local ', camLocal.toArray().map((v) => v.toFixed(4)).join(', '));
console.log('height above ', h.toFixed(4), ' horizon', Math.sqrt(2 * R * h).toFixed(4));
console.log('N', N.toArray().map((v) => v.toFixed(3)).join(','));
console.log('F', F.toArray().map((v) => v.toFixed(3)).join(','));
console.log('');

const v = new THREE.Vector3();
const world = new THREE.Vector3();
const ndc = new THREE.Vector3();

function probe(arc, ang, label) {
  const th = arc / R;
  v.copy(N).multiplyScalar(Math.cos(th))
    .addScaledVector(F, Math.sin(th) * Math.cos(ang))
    .addScaledVector(S, Math.sin(th) * Math.sin(ang))
    .normalize()
    .multiplyScalar(R);
  world.copy(v).add(new THREE.Vector3(0, 0, orbit));
  ndc.copy(world).project(cam);
  const px = (ndc.x * 0.5 + 0.5) * W;
  const py = (-ndc.y * 0.5 + 0.5) * H;
  const vis = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= Y_MAX;
  const off = Math.hypot(Math.max(0, Math.abs(ndc.x) - 1), Math.max(0, Math.abs(ndc.y) - Y_MAX));
  console.log(
    `${label.padEnd(10)} arc ${arc.toFixed(3)} ang ${ang.toFixed(2).padStart(5)}`,
    `-> px ${px.toFixed(0).padStart(5)} ${py.toFixed(0).padStart(5)}`,
    `ndc ${ndc.x.toFixed(3).padStart(7)} ${ndc.y.toFixed(3).padStart(7)}`,
    vis ? '  IN' : `  OUT ${off.toFixed(2)}`,
  );
}

console.log('--- 沿视线中线（ang=0）---');
for (const a of [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.12, 0.14, 0.157]) probe(a, 0, 'center');
console.log('');
console.log('--- 横向（arc=0.12）---');
for (const g of [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9]) probe(0.12, g, 'lateral');
console.log('');
console.log('--- 塔基方向（ang 朝 +S 一侧）---');
const tower = new THREE.Vector3(CFG.elevator.from, 0, 0);
const tw = tower.clone().add(new THREE.Vector3(0, 0, orbit));
const tndc = tw.clone().project(cam);
console.log('tower ndc', tndc.x.toFixed(3), tndc.y.toFixed(3),
  'px', ((tndc.x * 0.5 + 0.5) * W).toFixed(0), ((-tndc.y * 0.5 + 0.5) * H).toFixed(0));
