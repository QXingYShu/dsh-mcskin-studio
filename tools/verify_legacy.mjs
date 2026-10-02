#!/usr/bin/env node
/* tools/verify_legacy.mjs — 独立验证 rules.convertLegacy64x32（归属：Lead）
 * 用自造的"每个面都有不同图案"的 64×32 皮肤，检验：
 *   1) 基础 4 块是否落在现代正确坐标（不放大、不位移）
 *   2) 左臂/左腿是否是右臂/右腿的"逐面水平镜像（外↔内换位）"
 *   3) 外层是否被补齐
 *   4) 用真实参考图 HIM.png 跑一遍，统计各区域占用
 */
import { readFileSync } from 'node:fs';
import { decodePNG, px } from './png.mjs';

const sandbox = { window: {} };
const src = readFileSync('js/rules.js', 'utf8');
new Function('window', src)(sandbox.window);
const R = sandbox.window.MCSKIN.rules;

const W64 = 64, W32 = 64;
function blank(w, h) { return new Uint8ClampedArray(w * h * 4); }
function set(d, w, x, y, c) { const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; }
function get(d, w, x, y) { return px({ width: w, data: d }, x, y); }

// 自造 64×32：右臂每个面一种颜色，右腿每个面一种颜色，头/躯干也涂开
const d32 = blank(W32, 32);
const ARM_COLORS = { right: [255, 0, 0, 255], front: [0, 255, 0, 255], left: [0, 0, 255, 255], back: [255, 255, 0, 255], top: [255, 0, 255, 255], bottom: [0, 255, 255, 255] };
const LEG_COLORS = { right: [200, 0, 0, 255], front: [0, 200, 0, 255], left: [0, 0, 200, 255], back: [200, 200, 0, 255], top: [200, 0, 200, 255], bottom: [0, 200, 200, 255] };
// 旧版 64×32 里的右臂/右腿格子（像素坐标直接沿用）
const ARM32 = { right: [40, 20, 44, 32], front: [44, 20, 48, 32], left: [48, 20, 52, 32], back: [52, 20, 56, 32], top: [44, 16, 48, 20], bottom: [48, 16, 52, 20] };
const LEG32 = { right: [0, 20, 4, 32], front: [4, 20, 8, 32], left: [8, 20, 12, 32], back: [12, 20, 16, 32], top: [4, 16, 8, 20], bottom: [8, 16, 12, 20] };
function paint(map, colors) {
  for (const f of Object.keys(map)) {
    const [x0, y0, x1, y1] = map[f];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(d32, W32, x, y, colors[f]);
  }
}
paint(ARM32, ARM_COLORS);
paint(LEG32, LEG_COLORS);
for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) set(d32, W32, x, y, [120, 80, 60, 255]);  // 头正面
for (let y = 20; y < 32; y++) for (let x = 20; x < 28; x++) set(d32, W32, x, y, [40, 120, 160, 255]); // 躯干正面

const conv = R.convertLegacy64x32(d32);
let pass = [], fail = [];
function ok(n, c, extra) { (c ? pass : fail).push(n + (c ? '' : ' — ' + (extra === undefined ? '' : JSON.stringify(extra)))); }

// 1) 基础块位置
ok('转换输出 64×64', conv.width === 64 && conv.height === 64);
ok('头正面保留在 (8,8)', JSON.stringify(get(conv.data, 64, 10, 10)) === JSON.stringify([120, 80, 60, 255]), get(conv.data, 64, 10, 10));
ok('躯干正面保留在 (20,20)', JSON.stringify(get(conv.data, 64, 22, 22)) === JSON.stringify([40, 120, 160, 255]), get(conv.data, 64, 22, 22));

// 2) 右臂/右腿基础层保留
function sameBox(d, w, box, color) {
  const [x0, y0, x1, y1] = box;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (JSON.stringify(get(d, w, x, y)) !== JSON.stringify(color)) return false;
  }
  return true;
}
ok('右臂正面保留原色', sameBox(conv.data, 64, [44, 20, 48, 32], ARM_COLORS.front));
ok('右腿正面保留原色', sameBox(conv.data, 64, [4, 20, 8, 32], LEG_COLORS.front));

// 3) 左臂 = 右臂逐面镜像（外↔内换位 + 水平翻转）
const LARM = { right: [32, 52, 36, 64], front: [36, 52, 40, 64], left: [40, 52, 44, 64], back: [44, 52, 48, 64], top: [36, 48, 40, 52], bottom: [40, 48, 44, 52] };
const MIRROR = { right: 'left', left: 'right', front: 'front', back: 'back', top: 'top', bottom: 'bottom' };
let mirrorOk = true, mirrorBad = '';
for (const f of Object.keys(LARM)) {
  const sf = MIRROR[f];
  const srcBox = ARM32[sf], dstBox = LARM[f];
  const srcW = srcBox[2] - srcBox[0];
  for (let y = 0; y < dstBox[3] - dstBox[1]; y++) {
    for (let x = 0; x < srcW; x++) {
      const a = get(conv.data, 64, dstBox[0] + x, dstBox[1] + y);
      // 源应水平翻转：dst 的第 x 列 = 源的 (srcW-1-x) 列
      const bIdx = (() => { const p = ARM32[sf]; return [p[0] + (srcW - 1 - x), p[1] + y]; })();
      const b = get32(bIdx[0], bIdx[1]);
      if (JSON.stringify(a) !== JSON.stringify(b)) { mirrorOk = false; mirrorBad = 'leftArm.' + f + ' x=' + x + ' y=' + y + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + '(源 ' + sf + ')'; }
    }
  }
}
function get32(x, y) { return px({ width: W32, data: d32 }, x, y); }
ok('左臂 = 右臂逐面水平镜像（外↔内换位）', mirrorOk, mirrorBad);

// 左腿
let legOk = true, legBad = '';
const LLEG = { right: [16, 52, 20, 64], front: [20, 52, 24, 64], left: [24, 52, 28, 64], back: [28, 52, 32, 64], top: [20, 48, 24, 52], bottom: [24, 48, 28, 52] };
for (const f of Object.keys(LLEG)) {
  const sf = MIRROR[f];
  const srcBox = LEG32[sf], dstBox = LLEG[f];
  const srcW = srcBox[2] - srcBox[0];
  for (let y = 0; y < dstBox[3] - dstBox[1]; y++) {
    for (let x = 0; x < srcW; x++) {
      const a = get(conv.data, 64, dstBox[0] + x, dstBox[1] + y);
      const b = get32(srcBox[0] + (srcW - 1 - x), srcBox[1] + y);
      if (JSON.stringify(a) !== JSON.stringify(b)) { legOk = false; legBad = 'leftLeg.' + f + ' x=' + x + ' y=' + y; }
    }
  }
}
ok('左腿 = 右腿逐面水平镜像', legOk, legBad);

// 4) 外层补齐：必须与对应基础层**逐像素一致**（这才是"补齐"的正确判据，不是看有无像素）
function sameRegion(a, b, box) {
  const [x0, y0, x1, y1] = box;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (JSON.stringify(get(a, 64, x, y)) !== JSON.stringify(get(b, 64, x, y))) return false;
  }
  return true;
}
ok('hat 外层 == head 基础层（逐像素）', sameRegion(conv.data, conv.data, [32, 8, 64, 16]) &&
  (function () { // 顶底条 [32,0,64,8] ← head [0,0,32,8]
    for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) {
      if (JSON.stringify(get(conv.data, 64, 32 + x, y)) !== JSON.stringify(get(conv.data, 64, x, y))) return false;
    }
    return true;
  })());

// 5) 真实参考图：左臂/左腿应等于"右臂/右腿逐面镜像"，且不透明率与右臂/右腿一致
function ratio(d, x0, y0, x1, y1) { let o = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (get(d, 64, x, y)[3] > 0) o++; return o / ((x1 - x0) * (y1 - y0)); }
for (const [file, label] of [['HIM.png', 'HIM.png(64×32)']]) {
  const img = decodePNG(readFileSync(file));
  if (img.height !== 32) { fail.push(label + ' 不是 64×32'); continue; }
  const real = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
  const c2 = R.convertLegacy64x32(real);
  const regions = {
    '右臂基础': [40, 16, 56, 32], '左臂基础': [32, 48, 48, 64], '右腿基础': [0, 16, 16, 32],
    '左腿基础': [16, 48, 32, 64], '左裤外层': [0, 48, 16, 64], '左袖外层': [48, 48, 64, 64],
    '帽子外层': [32, 0, 64, 16], '外套外层': [16, 32, 40, 48]
  };
  const res = {};
  for (const r of Object.keys(regions)) { const b = regions[r]; res[r] = +ratio(c2.data, b[0], b[1], b[2], b[3]).toFixed(3); }
  console.log('真实参考图 ' + label + ' 转换后各区域不透明率: ' + JSON.stringify(res));
  // 左臂/左腿的不透明率必须与右臂/右腿相同（镜像不改变像素数量）
  ok(label + ' 左臂不透明率 == 右臂', Math.abs(res['左臂基础'] - res['右臂基础']) < 0.001, [res['左臂基础'], res['右臂基础']]);
  ok(label + ' 左腿不透明率 == 右腿', Math.abs(res['左腿基础'] - res['右腿基础']) < 0.001, [res['左腿基础'], res['右腿基础']]);
  // 左臂正面必须逐像素等于右臂正面的水平镜像
  let mir = true, bad = '';
  for (const f of Object.keys(LARM)) {
    const sf = MIRROR[f], srcBox = ARM32[sf], dstBox = LARM[f], sw = srcBox[2] - srcBox[0];
    for (let y = 0; y < dstBox[3] - dstBox[1] && mir; y++) {
      for (let x = 0; x < sw; x++) {
        const a = get(c2.data, 64, dstBox[0] + x, dstBox[1] + y);
        const b = px({ width: 64, data: real }, srcBox[0] + (sw - 1 - x), srcBox[1] + y);
        if (JSON.stringify(a) !== JSON.stringify(b)) { mir = false; bad = label + ' leftArm.' + f + ' x=' + x + ' y=' + y; break; }
      }
    }
  }
  ok(label + ' 左臂 = 右臂逐面水平镜像（真实像素）', mir, bad);
}

console.log('\nPASS ' + pass.length + ' / FAIL ' + fail.length);
fail.forEach(f => console.log('  ✗ ' + f));
process.exit(fail.length ? 1 : 0);
