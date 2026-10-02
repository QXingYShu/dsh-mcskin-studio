#!/usr/bin/env node
/* tools/install_skill.mjs — 把 skill/mcskin-artist 打包安装到 DSH 技能目录（归属：Lead）
 *
 * 用法：
 *   node tools/install_skill.mjs            # 安装到 ~/.dsh/skills/mcskin-artist（源码 + 依赖）
 *   node tools/install_skill.mjs --dev      # 只把依赖注入源码目录 skill/mcskin-artist/lib/（开发自测）
 *   node tools/install_skill.mjs --check    # 只校验（frontmatter / 引用文件 / node --check）
 *   node tools/install_skill.mjs --target <dir>   # 指定安装目标
 *
 * 依赖映射（工作区是唯一真相，安装时拷贝，避免两份代码漂移）：
 *   js/rules.js        → lib/rules.js
 *   js/model.js        → lib/model.js
 *   js/renderer3d.js   → lib/renderer3d.js
 *   tools/png.mjs      → lib/png.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = resolve(root, 'skill/mcskin-artist');
const DEFAULT_TARGET = join(os.homedir(), '.dsh/skills/mcskin-artist');

const DEPS = [
  ['js/rules.js', 'lib/rules.js'],
  ['js/model.js', 'lib/model.js'],
  ['js/renderer3d.js', 'lib/renderer3d.js'],
  ['tools/png.mjs', 'lib/png.mjs']
];

const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const CHECK_ONLY = args.includes('--check');
const targetIdx = args.indexOf('--target');
const TARGET = targetIdx >= 0 ? resolve(args[targetIdx + 1]) : DEFAULT_TARGET;

function fail(msg, extra) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2));
  process.exit(1);
}

if (!existsSync(SRC)) fail('源目录不存在: ' + SRC);

/* ---------- 源内文件清单（跳过 lib/ 与 _stage/，lib 是依赖产物） ---------- */
function listSource(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    if (name === 'lib' || name === '_stage' || name.startsWith('.')) continue;
    if (statSync(full).isDirectory()) listSource(full, base, out);
    else out.push(rel);
  }
  return out;
}

function copyDeps(destLib) {
  mkdirSync(destLib, { recursive: true });
  const done = [];
  for (const [from, to] of DEPS) {
    const src = resolve(root, from);
    if (!existsSync(src)) fail('依赖缺失: ' + src);
    const dst = resolve(destLib, to.replace(/^lib\//, ''));
    cpSync(src, dst);
    done.push(to);
  }
  return done;
}

/* ---------- --dev：只注入依赖到源目录 ---------- */
if (DEV) {
  const deps = copyDeps(join(SRC, 'lib'));
  console.log(JSON.stringify({ ok: true, mode: 'dev', deps, target: SRC }, null, 2));
  process.exit(0);
}

/* ---------- --check：安装前校验 ---------- */
function check() {
  const problems = [];
  const skillMd = join(SRC, 'SKILL.md');
  if (!existsSync(skillMd)) problems.push('缺少 SKILL.md');
  else {
    const txt = readFileSync(skillMd, 'utf8');
    // 容忍 CRLF：Windows 检出后行尾是 \r\n，不能只匹配 \n
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
    if (!fm) problems.push('SKILL.md 缺少 frontmatter');
    else {
      const head = fm[1];
      if (!/^name:\s*mcskin-artist\s*$/m.test(head)) problems.push('frontmatter name 必须为 mcskin-artist');
      if (!/^description:/m.test(head)) problems.push('frontmatter 缺 description');
      if (!/^allowed-tools:/m.test(head)) problems.push('frontmatter 缺 allowed-tools');
    }
    // 正文里出现的 bin/… 引用必须存在
    const refs = new Set([...txt.matchAll(/`?(bin\/[a-z0-9_.-]+\.mjs)`?/g)].map(m => m[1]));
    for (const r of refs) {
      if (!existsSync(join(SRC, r))) problems.push('SKILL.md 引用了不存在的文件: ' + r);
    }
  }
  // 源文件语法检查
  const srcFiles = listSource(SRC);
  for (const rel of srcFiles) {
    if (!rel.endsWith('.mjs') && !rel.endsWith('.js')) continue;
    const r = spawnSync(process.execPath, ['--check', join(SRC, rel)], { encoding: 'utf8' });
    if (r.status !== 0) problems.push('语法错误 ' + rel + ': ' + (r.stderr || '').split('\n')[0]);
  }
  // 依赖存在性
  for (const [from] of DEPS) if (!existsSync(resolve(root, from))) problems.push('依赖缺失: ' + from);
  // 关键文件必须齐
  const required = ['SKILL.md', 'bin/skin.mjs', 'bin/render.mjs', 'bin/headless.mjs', 'harness/render.html'];
  for (const f of required) if (!existsSync(join(SRC, f))) problems.push('缺少必需文件: ' + f);
  return { srcFiles, problems };
}

if (CHECK_ONLY) {
  const { srcFiles, problems } = check();
  console.log(JSON.stringify({
    ok: problems.length === 0, mode: 'check', files: srcFiles, problems
  }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

/* ---------- 完整安装 ---------- */
const { problems } = check();
if (problems.length) fail('安装前校验未通过', { problems });

mkdirSync(TARGET, { recursive: true });
// 清掉旧安装（保留 skill 自身之外的内容不涉及：整个目录就是本 skill）
for (const name of readdirSync(TARGET)) rmSync(join(TARGET, name), { recursive: true, force: true });

const srcFiles = listSource(SRC);
for (const rel of srcFiles) {
  const dst = join(TARGET, rel);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(join(SRC, rel), dst);
}
const deps = copyDeps(join(TARGET, 'lib'));

console.log(JSON.stringify({
  ok: true, mode: 'install', target: TARGET,
  files: srcFiles.length + deps.length, deps,
  installedAt: new Date().toISOString()
}, null, 2));
