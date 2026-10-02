#!/usr/bin/env node
/* tests/build_visual.mjs — 把参考图注入 tests/visual_check.html（归属：Lead） */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const REFS = [
  { name: '苦力怕娘', file: resolve(root, '苦力怕娘.png'), w: 64, h: 64 },
  { name: 'HIM', file: resolve(root, 'HIM.png'), w: 64, h: 32 }
];

const html = readFileSync(resolve(here, 'visual_check.html'), 'utf8');
const refs = REFS.map(r => {
  if (!existsSync(r.file)) throw new Error('缺少参考图: ' + r.file);
  return { name: r.name, w: r.w, h: r.h, dataurl: 'data:image/png;base64,' + readFileSync(r.file).toString('base64') };
});
const inject = '<script>window.__REFS__ = ' + JSON.stringify(refs) + ';<\/script>';
// 必须插在 </head> 之前（页面主脚本在 body 末尾，早于 </body> 注入就来不及了）
let out;
if (html.includes('</head>')) out = html.replace('</head>', inject + '\n</head>');
else out = inject + '\n' + html;
// 输出文件在 tests/out/ 下，相对路径要比模板多退一层
out = out.replace(/(src|href)="\.\.\/js\//g, '$1="../../js/');
out = out.replace(/(src|href)="\.\.\/css\//g, '$1="../../css/');
const outDir = resolve(root, 'tests/out');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'visual_check_built.html');
writeFileSync(outFile, out, 'utf8');
console.log(JSON.stringify({ out: outFile, refs: refs.map(r => r.name) }));
