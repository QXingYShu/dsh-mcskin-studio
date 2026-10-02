#!/usr/bin/env node
/* tests/build_probe.mjs — 生成注入了参考图 data URL 的探针脚本（归属：Lead）
 * 输出 tests/out/auto_probe_injected.js，供 tools/headless.mjs --apply 使用。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const REFS = {
  __REF_SKIN_DATAURL__: resolve(root, '苦力怕娘.png'),
  __REF_SKIN_LEGACY_DATAURL__: resolve(root, 'HIM.png')
};

const probeFile = process.env.PROBE === 'drag' ? resolve(here, 'drag_probe.js') : resolve(here, 'auto_probe.js');
const probe = readFileSync(probeFile, 'utf8');
let head = '';
for (const [name, file] of Object.entries(REFS)) {
  if (!existsSync(file)) { console.error('缺少参考图: ' + file); }
  const url = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  head += `window.${name} = ${JSON.stringify(url)};\n`;
}

const outDir = resolve(root, 'tests/out');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'auto_probe_injected.js');
writeFileSync(outFile, '/* 自动生成，请勿手改 */\n' + head + probe, 'utf8');
console.log(JSON.stringify({ out: outFile, bytes: probe.length + head.length }));
