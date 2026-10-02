#!/usr/bin/env node
/* tools/probe_tools.mjs — 用宿主真实的 dsh-tools 校验我们注册的工具（归属：Lead）
 *
 * 动机：defineTool 会立即解引用 options.output.render 并把 parameters 转成
 * JSON Schema；形状不对会在真机启动时炸，静态检查看不出来。这里把 harness 安装里
 * 真实的 dsh-tools（及其依赖闭包）抽到临时目录，导入我们的 index.js，让它内部
 * 的 `import('@deepseek-ai/dsh-tools')` 解析到真实实现，跑一遍完整注册。
 *
 * 用法: node tools/probe_tools.mjs [bundleDir]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/* ---- 一次性读取 asar 目录树（进程内，避免每文件起一次进程） ---- */
const asar = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar');
const bundleDir = resolve(process.argv[2] ?? 'plugin/dsh-mcskin-studio');

const out = { ok: true, checks: [], errors: [], notes: [] };
const check = (name, cond, extra) => {
  if (cond) out.checks.push(name); else { out.ok = false; out.errors.push(name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
const bail = (why, extra) => { console.log(JSON.stringify({ ok: false, skipped: why, ...extra }, null, 2)); process.exit(0); };

if (!existsSync(asar)) bail('asar-missing', { asar });

const buf = readFileSync(asar);
const headerSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.toString('utf8', 16, 16 + headerSize));

function nodeAt(parts) {
  let node = header;
  for (const p of parts) {
    node = node?.files?.[p];
    if (!node) return null;
  }
  return node;
}
function dataOf(entry) {
  return buf.subarray(16 + headerSize + Number(entry.offset), 16 + headerSize + Number(entry.offset) + entry.size);
}
function writeSubtree(node, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const dest = join(destDir, name);
    if (child.files) writeSubtree(child, dest);
    else { mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, dataOf(child)); }
  }
}

/* ---- 抽包：seed + 依赖闭包 ---- */
const tmp = mkdtempSync(join(tmpdir(), 'mcskin-probe-'));
const nmRoot = join(tmp, 'node_modules', '@deepseek-ai');
const copied = new Set();

function extractPkg(pkg) {
  if (copied.has(pkg)) return true;
  copied.add(pkg);
  const node = nodeAt(['dsh', 'node_modules', '@deepseek-ai', pkg]);
  if (!node) { out.notes.push('asar 内无 @deepseek-ai/' + pkg); return false; }
  const destDir = join(nmRoot, pkg);
  writeSubtree(node, destDir);
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(join(destDir, 'package.json'), 'utf8')); } catch { /* no manifest */ }
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (!dep.startsWith('@deepseek-ai/')) continue;
    extractPkg(dep.slice('@deepseek-ai/'.length));
  }
  return true;
}

/* dsh-tools 的 imports 里出现过、但因提升而不在 dependencies 里的包，一并播种 */
for (const pkg of ['dsh-tools', 'cordis', 'cosmokit', 'schemastery', 'dsh-scope', 'dsh-llm', 'dsh-util-values', 'dsh-brand', 'dsh-sandbox']) {
  extractPkg(pkg);
}
out.notes.push('已抽取包: ' + [...copied].join(', '));
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'probe', type: 'module', private: true }));

/* ---- 让 bundle 在临时目录里解析到真实 dsh-tools ---- */
cpSync(join(bundleDir, 'index.js'), join(tmp, 'index.js'));
cpSync(join(bundleDir, 'package.json'), join(tmp, 'package.json'));

try {
  const bundle = await import(pathToFileURL(join(tmp, 'index.js')).href);
  check('bundle 在真实 dsh-tools 环境下可加载', true);

  const registered = [];
  const ctx = {
    tools: { register(t) { registered.push(t); return () => {}; } },
    webServer: { register(r) { out.notes.push('route ' + r.path); return () => {}; } },
    effect(fn) { return fn(); },
    on() { return () => {}; }, get() {}, logger: console
  };
  const disposer = bundle.apply(ctx);
  check('apply() 在真实环境下未抛异常（defineTool 通过）', true);
  check('apply() 返回清理函数', typeof disposer === 'function');

  check('注册了 2 个工具', registered.length === 2, registered.map((t) => t?.name));
  const lint = registered.find((t) => t?.name === 'skin_lint');
  const render = registered.find((t) => t?.name === 'skin_render');
  check('存在 skin_lint', !!lint);
  check('存在 skin_render', !!render);

  for (const tool of [lint, render]) {
    if (!tool) continue;
    check(`${tool.name}: output.render 是函数`, typeof tool.output?.render === 'function');
    check(`${tool.name}: parameters 已转成 JSON Schema`, tool.parameters?.type === 'object' && !!tool.parameters?.properties);
    check(`${tool.name}: file 为必填字符串`, tool.parameters?.properties?.file?.type === 'string');
    check(`${tool.name}: required 含 file`, (tool.parameters?.required ?? []).includes('file'));
  }

  if (lint) {
    const good = lint.output.render({ file: 'x.png' }, {
      ok: true,
      report: { score: 88, grade: 'A', summary: { fail: 0, warn: 1, info: 0, pass: 9 }, checks: [{ id: 'low-detail', level: 'warn', msg: '细节偏少' }] }
    });
    check('skin_lint render 正常分支产出文本', typeof good?.content?.[0]?.text === 'string' && good.content[0].text.includes('88'));
    const bad = lint.output.render({ file: 'x.png' }, { ok: false, error: 'boom' });
    check('skin_lint render 错误分支 isError', bad?.isError === true);
  }
  if (render) {
    const r = render.output.render({}, {
      ok: true, outDir: '/tmp/out',
      views: [{ id: 'front', file: '/tmp/out/views/front.png' }],
      poses: [{ id: 'walk_25', file: '/tmp/out/poses/walk_25.png' }],
      texture: ['/tmp/out/texture/full_4x.png'], errors: []
    });
    check('skin_render render 产出路径清单', typeof r?.content?.[0]?.text === 'string' && r.content[0].text.includes('views/front.png'));
  }

  /* 真实执行一次工具（技能已安装时） */
  const status = await bundle.skillStatus();
  out.skillInstalled = status.skillInstalled;
  const skin = resolve('tests/skill_demo/ranger.png');
  if (status.skillInstalled && existsSync(skin) && lint) {
    const value = await lint.execute({ file: skin });
    check('skin_lint 真实执行返回结构化值', value?.ok === true && typeof value.report.score === 'number',
      { ok: value?.ok, error: value?.error });
    if (value?.ok) out.lint = { score: value.report.score, grade: value.report.grade };
  }
} catch (error) {
  out.ok = false;
  out.errors.push('异常: ' + (error && error.stack ? error.stack.split('\n').slice(0, 5).join(' | ') : error.message));
}

console.log(JSON.stringify(out, null, 2));
rmSync(tmp, { recursive: true, force: true });
process.exit(out.ok ? 0 : 1);