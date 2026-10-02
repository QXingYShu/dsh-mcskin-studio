#!/usr/bin/env node
/* tools/verify_unwrap.mjs — 用"展开网接缝连续性"判定 UV↔几何 的左右朝向（归属：Lead）
 *
 * 判据（与左右手约定无关、与观察方向无关）：
 *   皮肤展开图是一张连通的网。四个侧面在贴图上是左右相邻的四块：
 *     右面 | 正面 | 左面 | 背面
 *   相邻两块之间那条"公共贴图线"，必须映射到两面在 3D 里的同一条棱。
 *   也就是说：把面参数化 f(s,t)（s: 贴图 u 方向 0→1，t: 贴图 v 方向 0→1），
 *   接缝处 A 面的 s=1 曲线应等于 B 面的 s=0 曲线（逐点相同）。
 *
 * 这个判据能唯一确定 u 的朝向（v 的朝向由"贴图 v 向下 / 模型 y 向上"另行确定）。
 */
import { readFileSync } from 'node:fs';

const sandbox = { window: {} };
new Function('window', readFileSync('js/rules.js', 'utf8'))(sandbox.window);
const R = sandbox.window.MCSKIN.rules;

// 由 quad 与贴图朝向重建面参数化：
// quad = [TL, TR, BR, BL] 对应贴图 (u0,v0),(u1,v0),(u1,v1),(u0,v1)
// f(s,t) = (1-t)*((1-s)*TL + s*TR) + t*((1-s)*BL + s*BR)
function facePoint(quad, s, t) {
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const top = lerp(quad[0], quad[1], s);
  const bot = lerp(quad[3], quad[2], s);
  return lerp(top, bot, t);
}
const near = (a, b, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

// 侧面的贴图相邻顺序：右(u 0..1) → 正 → 左 → 背 → 回到右
const NET = ['right', 'front', 'left', 'back'];

function seamReport(geo, label) {
  const lines = [];
  let ok = 0, bad = 0;
  for (let i = 0; i < NET.length; i++) {
    const a = NET[i], b = NET[(i + 1) % NET.length];
    let match = 0, total = 0, example = '';
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const pa = facePoint(geo[a], 1, t);   // A 面 s=1 边
      const pb = facePoint(geo[b], 0, t);   // B 面 s=0 边
      total++;
      if (near(pa, pb)) match++; else if (!example) example = `${a}.s1(${JSON.stringify(pa)}) vs ${b}.s0(${JSON.stringify(pb)})`;
    }
    if (match === total) { ok++; lines.push(`  ✔ ${a} → ${b} 接缝闭合 (${match}/${total})`); }
    else { bad++; lines.push(`  ✘ ${a} → ${b} 接缝断裂 (${match}/${total}) 例: ${example}`); }
  }
  console.log(label + '：' + ok + ' 条闭合 / ' + bad + ' 条断裂');
  lines.forEach(l => console.log(l));
  return bad === 0;
}

console.log('=== 1) rules.js 当前的 BOXES[].geometry ===');
const bodies = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
const cur = {};
for (const id of bodies) cur[id] = R.box(id).geometry;
const curOk = bodies.every(id => seamReport(cur[id], '  ' + id));

console.log('\n=== 2) rules.js 里保存的 geometryContract（审计用） ===');
let conOk = true;
for (const id of bodies) {
  const b = R.box(id);
  if (!b.geometryContract) { console.log('  ' + id + '：无 geometryContract'); continue; }
  conOk = seamReport(b.geometryContract, '  ' + id) && conOk;
}

console.log('\n=== 3) 敏感性检验：把每条接缝故意打断，判据必须报错 ===');
/* 若判据只是"恒真"，它就没有价值。这里构造若干个"错误朝向"的几何，
   其中每一个都应该让至少一条接缝断裂。 */
function build(min, size, opts) {
  const [x0, y0, z0] = min, [w, h, d] = size;
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  // 基准：rules.js 当前实现
  const g = {
    right: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
    front: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
    left: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
    back: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]]
  };
  if (opts && opts.flipFront) g.front = [g.front[1], g.front[0], g.front[3], g.front[2]];
  if (opts && opts.flipRightZ) g.right = [[x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [x0, y0, z1]];
  if (opts && opts.swapFrontBack) { const t = g.front; g.front = g.back; g.back = t; }
  return g;
}
function countBreaks(geo) {
  let bad = 0;
  for (let i = 0; i < NET.length; i++) {
    const a = NET[i], b = NET[(i + 1) % NET.length];
    let match = 0;
    for (let k = 0; k <= 4; k++) { if (near(facePoint(geo[a], 1, k / 4), facePoint(geo[b], 0, k / 4))) match++; }
    if (match !== 5) bad++;
  }
  return bad;
}
const base = build([-4, 24, -4], [8, 8, 8], null);
const variants = {
  '基准（rules.js 现实现）': { geo: base, want: 0 },
  '正面 u 反向（v1.1 旧表）': { geo: build([-4, 24, -4], [8, 8, 8], { flipFront: true }), want: 2 },
  '右面 z 反向': { geo: build([-4, 24, -4], [8, 8, 8], { flipRightZ: true }), want: 2 },
  '正面/背面互换': { geo: build([-4, 24, -4], [8, 8, 8], { swapFrontBack: true }), want: 4 }
};
let sensOk = true;
for (const name of Object.keys(variants)) {
  const v = variants[name];
  const bad = countBreaks(v.geo);
  const good = bad === v.want;
  if (!good) sensOk = false;
  console.log('  ' + (good ? '✔' : '✘') + ' ' + name + ' → 断裂 ' + bad + ' 条（期望 ' + v.want + '）');
}

console.log('\n=== 结论 ===');
console.log('  rules.js 当前 geometry：' + (curOk ? '4 条接缝全部闭合 ✓ → 展开网自洽，是正确的 UV↔几何 映射' : '有断裂 ✗'));
console.log('  geometryContract（v1.1 字面值）：' + (conOk ? '闭合' : '有断裂 ✗ → 不要使用'));
console.log('  敏感性检验：' + (sensOk ? '通过（错误朝向都能被检出）✓' : '未通过 ✗'));
process.exit(curOk && sensOk ? 0 : 1);
