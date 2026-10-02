#!/usr/bin/env node
/* tools/verify_plugin.mjs — 按官方规范校验插件 bundle（归属：Lead）
 *
 * 依据 harness 自带规范 @deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development：
 *   references/host-plugin.md（manifest / meta / icon / locale / 导出形态）
 *   references/ui-plugin.md（dsh.client：platform / immediately / inject、./client 导出）
 *   templates/decoration/（四文件起点）
 * 用法: node tools/verify_plugin.mjs [bundleDir]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const dir = resolve(process.argv[2] ?? 'plugin/dsh-mcskin-studio');
const problems = [];
const notes = [];
const ok = (name) => notes.push('✔ ' + name);
const bad = (name, extra) => problems.push('✘ ' + name + (extra ? ' — ' + JSON.stringify(extra) : ''));

if (!existsSync(dir)) { console.log(JSON.stringify({ ok: false, error: 'bundle 不存在: ' + dir })); process.exit(1); }

/* 1) 四文件起步 */
for (const f of ['package.json', 'cordis.patch.yml', 'index.js', 'client.js']) {
  if (existsSync(join(dir, f))) ok('存在 ' + f); else bad('缺少 ' + f);
}

/* 2) manifest */
let pkg = null;
if (existsSync(join(dir, 'package.json'))) {
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    ok('package.json 可解析');
  } catch (e) { bad('package.json 解析失败', e.message); }
}
if (pkg) {
  if (pkg.type === 'module') ok('type=module'); else bad('type 应为 module');
  const exp = pkg.exports ?? {};
  if (typeof exp['.'] === 'string' && existsSync(join(dir, exp['.']))) ok('exports["."] 指向存在的文件');
  else bad('exports["."] 无效', exp['.']);
  if (typeof exp['./client'] === 'string' && existsSync(join(dir, exp['./client']))) ok('exports["./client"] 指向存在的文件');
  else bad('exports["./client"] 无效', exp['./client']);
  if (pkg.exports?.['./package.json']) ok('导出 package.json（插件清单需要读它取 meta/icon）');
  else bad('建议导出 ./package.json');
  if (pkg.exports?.['./locale/*.json']) ok('导出 locale/*.json'); else bad('建议导出 ./locale/*.json');

  const dsh = pkg.dsh ?? {};
  const patch = dsh.bundle?.patch;
  if (typeof patch === 'string' && existsSync(join(dir, patch))) ok('dsh.bundle.patch 指向存在的文件');
  else bad('dsh.bundle.patch 无效', patch);
  const cli = dsh.client ?? {};
  if (cli.platform === 'web') ok('dsh.client.platform=web'); else bad('dsh.client.platform 应为 web');
  if (Array.isArray(cli.inject) && cli.inject.length) ok('dsh.client.inject 非空'); else bad('dsh.client.inject 缺失');
  if (Array.isArray(pkg.files) && pkg.files.length) ok('files 字段列出随包文件'); else notes.push('· files 未声明（官方模板也没写）');

  // meta / icon / locale
  if (pkg.meta?.title && pkg.meta?.description) ok('meta.title / meta.description 存在');
  else bad('缺少 meta.title / meta.description');
  if (typeof pkg.icon === 'string') {
    const ip = join(dir, pkg.icon);
    if (!pkg.icon.startsWith('/') && !/^[a-z]+:/i.test(pkg.icon) && existsSync(ip)) {
      const size = statSync(ip).size;
      if (size <= 256 * 1024) ok('icon 存在且 ≤256KiB'); else bad('icon 超过 256KiB', size);
    } else bad('icon 路径无效（必须是包内相对路径）', pkg.icon);
  } else bad('缺少 icon');
  for (const loc of ['en', 'zh']) {
    const lp = join(dir, 'locale', loc + '.json');
    if (existsSync(lp)) {
      try { JSON.parse(readFileSync(lp, 'utf8')); ok('locale/' + loc + '.json 可解析'); }
      catch (e) { bad('locale/' + loc + '.json 解析失败', e.message); }
    } else bad('缺少 locale/' + loc + '.json');
  }
}

/* 3) patch：必须是 Loader 的 insert 语法，且 name 指向本包 */
if (existsSync(join(dir, 'cordis.patch.yml'))) {
  const y = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
  if (/^\s*-\s*insert:\s*$/m.test(y)) ok('patch 含 insert 段');
  else bad('patch 缺少 - insert:');
  if (pkg && y.includes(pkg.name)) ok('patch 引用了包名 ' + pkg.name);
  else bad('patch 未引用包名');
  const idMatch = /-\s*id:\s*(\S+)/.exec(y);
  if (idMatch) ok('patch 行 id = ' + idMatch[1]); else bad('patch 行缺少 id');
}

/* 4) Host 导出形态 */
if (existsSync(join(dir, 'index.js'))) {
  const src = readFileSync(join(dir, 'index.js'), 'utf8');
  if (/export\s+function\s+apply\s*\(/.test(src)) ok('Host: export function apply(ctx)');
  else bad('Host 缺少 export function apply(ctx)');
  if (/export\s+const\s+inject\s*=/.test(src)) ok('Host: export const inject');
  if (/ctx\.effect\(/.test(src)) ok('Host: 用 ctx.effect 注册资源'); else bad('Host 未用 ctx.effect（规范要求）');
  if (/ctx\.tools\.register/.test(src)) ok('Host: 注册了 agent 工具'); else notes.push('· 未注册 agent 工具');
  if (/ctx\.webServer\.register/.test(src)) ok('Host: 注册了 HTTP 路由'); else notes.push('· 未注册 HTTP 路由');
}

/* 5) Client 形态 */
if (existsSync(join(dir, 'client.js'))) {
  const src = readFileSync(join(dir, 'client.js'), 'utf8');
  if (/__ModuleLoader__\.load\(/.test(src)) ok('Client: window.__ModuleLoader__.load');
  else bad('Client 缺少 __ModuleLoader__.load');
  if (/inject:\s*\[\s*['"]slots['"]/.test(src)) ok("Client: inject ['slots']");
  if (/ctx\.slots\.register/.test(src)) ok('Client: ctx.slots.register');
  else bad('Client 缺少 ctx.slots.register');
  if (/settings\.plugins\.tab/.test(src)) ok('Client: 注册到 settings.plugins.tab');
  else bad('Client 未注册 settings.plugins.tab');
  if (/ctx\.effect\(/.test(src)) ok('Client: 用 ctx.effect 并返回清理');
  if (/require\(['"]@deepseek-ai\/dsh-client-ui/.test(src)) bad('Client 不得引入 Harness UI 包（规范明令禁止）');
  else ok('Client 未引入 Harness UI 包');
}

/* 6) 危险面：不得有硬编码的本机路径 */
for (const f of ['index.js', 'client.js']) {
  const p = join(dir, f);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  if (/C:\\Users\\18002/.test(src)) bad(f + ' 含硬编码本机路径');
}

const result = { ok: problems.length === 0, bundle: dir, passed: notes.length, notes, problems };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
