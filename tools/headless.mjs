#!/usr/bin/env node
/* tools/headless.mjs — 用系统自带 Edge 的 headless 模式跑页面验收（归属：Lead）
 *
 * 用法:
 *   node tools/headless.mjs tests/page_probe.html            # 只跑探针、dump DOM
 *   node tools/headless.mjs index.html --apply js/tests/auto_probe.js
 *
 * 产出:
 *   tests/out/<name>.dom.html   页面序列化 DOM
 *   tests/out/<name>.png        页面截图
 *   stdout                      探针写入的 JSON（<script id="probe-json">）
 *
 * 为什么这么做：环境里没有 playwright/puppeteer，但 Windows 自带 Edge 支持
 * `--headless=new --dump-dom` 与 `--screenshot`，可以拿到真实渲染结果。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('找不到 Edge/Chrome，无法做无头验收');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node tools/headless.mjs <page.html> [--apply <inject.js>] [--width 1600] [--height 1000] [--timeout 15000]');
  process.exit(2);
}

const pagePath = resolve(args[0]);
let applyPath = null, width = 1600, height = 1000, budget = 15000;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--apply') applyPath = resolve(args[++i]);
  else if (args[i] === '--width') width = parseInt(args[++i], 10);
  else if (args[i] === '--height') height = parseInt(args[++i], 10);
  else if (args[i] === '--timeout') budget = parseInt(args[++i], 10);
}

if (!existsSync(pagePath)) { console.error('页面不存在: ' + pagePath); process.exit(2); }

// 若需要注入探针脚本，则生成一个临时页面
let target = pagePath;
let tmpPage = null;
if (applyPath) {
  if (!existsSync(applyPath)) { console.error('注入脚本不存在: ' + applyPath); process.exit(2); }
  const html = readFileSync(pagePath, 'utf8');
  const inject = readFileSync(applyPath, 'utf8');
  const tag = '<script>\n' + inject + '\n</script>';
  tmpPage = join(dirname(pagePath), '__probe_page.html');
  writeFileSync(tmpPage, html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + tag, 'utf8');
  target = tmpPage;
}

const outDir = resolve('tests/out');
mkdirSync(outDir, { recursive: true });
const base = pagePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
const pngPath = join(outDir, base + '.png');
if (existsSync(pngPath)) rmSync(pngPath);

const profile = join(outDir, '__edge_profile');
mkdirSync(profile, { recursive: true });

const common = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--user-data-dir=' + profile,
  '--window-size=' + width + ',' + height,
  '--virtual-time-budget=' + budget,
  '--run-all-compositor-stages-before-draw',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist'
];

const url = pathToFileURL(target).href;

function run(extra) {
  return spawnSync(findBrowser(), common.concat(extra, [url]), {
    encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024
  });
}

const domRes = run(['--dump-dom']);
if (domRes.error) { console.error('启动浏览器失败: ' + domRes.error.message); process.exit(3); }
const dom = domRes.stdout || '';
writeFileSync(join(outDir, base + '.dom.html'), dom, 'utf8');

const shotRes = run(['--screenshot=' + pngPath]);
const hasPng = existsSync(pngPath);

if (tmpPage) rmSync(tmpPage);

// 提取探针 JSON（注入脚本的注释里也可能出现同样的字符串，所以逐个尝试直到解析成功）
let probe = null;
const re = /<script[^>]*id="probe-json"[^>]*>([\s\S]*?)<\/script>/g;
const candidates = [];
let mm;
while ((mm = re.exec(dom)) !== null) candidates.push(mm[1]);
for (const raw of candidates) {
  const text = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { probe = JSON.parse(text); break; } catch (e) { /* 试下一个 */ }
}
if (!probe) probe = { parseError: 'no valid probe-json found', candidates: candidates.length };

const title = (/<title>([\s\S]*?)<\/title>/.exec(dom) || [, ''])[1];
const result = {
  page: pagePath,
  url,
  exitCode: domRes.status,
  stderrTail: (domRes.stderr || '').slice(-1500),
  title,
  domBytes: dom.length,
  screenshot: hasPng ? { path: pngPath, bytes: statSync(pngPath).size } : null,
  probe
};
console.log(JSON.stringify(result, null, 2));

if (!hasPng && shotRes.error) console.error('截图失败: ' + shotRes.error.message);
process.exit(0);
