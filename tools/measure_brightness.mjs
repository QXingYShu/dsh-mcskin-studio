#!/usr/bin/env node
/* tools/measure_brightness.mjs — 测 3D 渲染相对原贴图的亮度比例（归属：Lead）
 * 用法: node tools/measure_brightness.mjs <渲染截图.png> <皮肤.png> [采样步长]
 * 输出: 整体与最亮若干像素的 "贴图色 → 渲染色" 对照，方便判断是否偏暗/偏淡。
 */
import { readFileSync } from 'node:fs';
import { decodePNG, px } from './png.mjs';

const [shotFile, skinFile, stepArg] = process.argv.slice(2);
const step = parseInt(stepArg || '4', 10);
const shot = decodePNG(readFileSync(shotFile));
const skin = decodePNG(readFileSync(skinFile));
const W = skin.width, H = skin.height;

function texAt(u, v) { // u,v in 0..1 of shot canvas → sample skin nearest
  const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  return px(skin, x, y);
}

// 采样：只取不透明的模型像素，并按亮度分组
let n = 0, ratioSum = [0, 0, 0], bright = [];
for (let y = 0; y < shot.height; y += step) {
  for (let x = 0; x < shot.width; x += step) {
    const s = px(shot, x, y);
    if (s[3] < 200) continue;
    // 用画面坐标反查不到真实 UV，只能做近似：把整张皮肤等比映射到画面
    // （这只用于"整体亮暗"的粗估，精确校验用 auto_probe 的合成纯色场景）
    const t = texAt(x / shot.width, y / shot.height);
    if (t[3] < 200) continue;
    const lum = (a) => 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
    const lr = lum(t) > 5 ? lum(s) / lum(t) : 1;
    n++;
    ratioSum[0] += lr;
    bright.push({ t, s, r: lr });
    if (bright.length > 20000) break;
  }
}
bright.sort((a, b) => b.r - a.r);
const q = (f) => bright.length ? bright[Math.floor(bright.length * f)] : null;
console.log('文件:', shotFile, ' 采样像素:', n);
console.log('亮度比 分位: 最高=' + (q(0) ? q(0).r.toFixed(2) : '-') +
  '  p75=' + (q(0.25) ? q(0.25).r.toFixed(2) : '-') +
  '  中位=' + (q(0.5) ? q(0.5).r.toFixed(2) : '-') +
  '  p25=' + (q(0.75) ? q(0.75).r.toFixed(2) : '-') +
  '  最低=' + (bright.length ? bright[bright.length - 1].r.toFixed(2) : '-'));
for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
  const s = q(f);
  if (s) console.log('  p' + Math.round(f * 100) + ': 贴图 ' + JSON.stringify(s.t.slice(0, 3)) +
    ' → 渲染 ' + JSON.stringify(s.s.slice(0, 3)) + '  比 ' + s.r.toFixed(2));
}
