#!/usr/bin/env node
/* tools/analyze_skin.mjs — 用真实皮肤文件反推 UV 布局（归属：Lead）
 * 用法: node tools/analyze_skin.mjs <skin.png> [more.png ...]
 */
import { readFileSync } from 'node:fs';
import { decodePNG, px } from './png.mjs';

function regionStats(img, x0, y0, x1, y1) {
  let opaque = 0, n = 0, sum = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = px(img, x, y);
    if (p[3] > 0) { opaque++; sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++; }
  }
  return { opaque, total: (x1 - x0) * (y1 - y0), ratio: opaque / ((x1 - x0) * (y1 - y0)),
    mean: n ? sum.map(v => Math.round(v / n)) : null };
}

function rows(img, x0, y0, x1, y1) { return [y0, y1]; }

function eqRegion(img, a, b) {
  const [ax0, ay0, ax1, ay1] = a, [bx0, by0, bx1, by1] = b;
  if ((ax1 - ax0) !== (bx1 - bx0) || (ay1 - ay0) !== (by1 - by0)) return 'size-mismatch';
  let same = 0, total = 0, mirrorSame = 0;
  for (let y = 0; y < ay1 - ay0; y++) for (let x = 0; x < ax1 - ax0; x++) {
    const p = px(img, ax0 + x, ay0 + y), q = px(img, bx0 + x, by0 + y);
    const m = px(img, bx1 - 1 - x, by0 + y);
    total++;
    if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3]) same++;
    if (p[0] === m[0] && p[1] === m[1] && p[2] === m[2] && p[3] === m[3]) mirrorSame++;
  }
  return { identical: same + '/' + total, mirrored: mirrorSame + '/' + total };
}

for (const file of process.argv.slice(2)) {
  const img = decodePNG(readFileSync(file));
  console.log('='.repeat(72));
  console.log(file, img.width + 'x' + img.height);
  const R = (n, x0, y0, x1, y1) => {
    const s = regionStats(img, x0, y0, x1, y1);
    console.log('  ' + n.padEnd(26) + `[${x0},${y0},${x1},${y1}]`.padEnd(22) +
      'opaque=' + (100 * s.ratio).toFixed(0) + '%  mean=' + JSON.stringify(s.mean));
    return s;
  };

  console.log('--- 契约（当前 CONTRACT 3.3）假设的左臂/左腿/左袖区域 ---');
  R('契约 leftArm front', 44, 52, 48, 64);
  R('契约 leftLeg front', 4, 52, 8, 64);
  R('契约 leftSleeve 区(48-64,48-64)', 48, 48, 64, 64);

  console.log('--- 官方 skin-render 库坐标（真·现代布局）---');
  R('官方 leftArm front', 36, 52, 40, 64);
  R('官方 leftArm right', 32, 52, 36, 64);
  R('官方 leftLeg front', 20, 52, 24, 64);
  R('官方 leftLeg right', 16, 52, 20, 64);
  R('官方 leftSleeve front', 52, 52, 56, 64);
  R('官方 leftSleeve right', 48, 52, 52, 64);

  console.log('--- 基础层 ---');
  R('head front', 8, 8, 16, 16);
  R('body front', 20, 20, 28, 32);
  R('rightArm front', 44, 20, 48, 32);
  R('rightLeg front', 4, 20, 8, 32);

  console.log('--- 外层 ---');
  R('hat front', 40, 8, 48, 16);
  R('jacket front', 20, 36, 28, 48);
  R('rightSleeve front', 44, 36, 48, 48);
  R('rightPants front', 4, 36, 8, 48);

  console.log('--- 左臂/左腿：与右臂/右腿的关系（identical / mirrored）---');
  console.log('  契约 leftArm front  vs rightArm front: ' + JSON.stringify(eqRegion(img, [44, 52, 48, 64], [44, 20, 48, 32])));
  console.log('  官方 leftArm front  vs rightArm front: ' + JSON.stringify(eqRegion(img, [36, 52, 40, 64], [44, 20, 48, 32])));
  console.log('  契约 leftLeg front  vs rightLeg front: ' + JSON.stringify(eqRegion(img, [4, 52, 8, 64], [4, 20, 8, 32])));
  console.log('  官方 leftLeg front  vs rightLeg front: ' + JSON.stringify(eqRegion(img, [20, 52, 24, 64], [4, 20, 8, 32])));
  console.log('  官方 leftSleeve front vs rightSleeve front: ' + JSON.stringify(eqRegion(img, [52, 52, 56, 64], [44, 36, 48, 48])));

  // 每 4px 列的透明度直方图（用于定位左臂区）
  console.log('--- 列透明度剖面 (y=52..64 求和) ---');
  let line = '';
  for (let x = 0; x < 64; x++) {
    let o = 0;
    for (let y = 52; y < 64; y++) if (px(img, x, y)[3] > 0) o++;
    line += (o === 0 ? '.' : (o > 8 ? '#' : '+'));
  }
  console.log('  x:    ' + '0123456789'.repeat(6).slice(0, 64));
  console.log('  y52-63: ' + line);
  line = '';
  for (let x = 0; x < 64; x++) {
    let o = 0;
    for (let y = 48; y < 52; y++) if (px(img, x, y)[3] > 0) o++;
    line += (o === 0 ? '.' : (o > 2 ? '#' : '+'));
  }
  console.log('  y48-51: ' + line);
  line = '';
  for (let x = 0; x < 64; x++) {
    let o = 0;
    for (let y = 36; y < 48; y++) if (px(img, x, y)[3] > 0) o++;
    line += (o === 0 ? '.' : (o > 8 ? '#' : '+'));
  }
  console.log('  y36-47: ' + line);
}
