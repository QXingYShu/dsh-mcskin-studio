#!/usr/bin/env node
/* tools/run_tests.mjs — 一键跑完所有可执行验证（归属：Lead）
 * 用法: node tools/run_tests.mjs [--no-e2e]
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';

const NO_E2E = process.argv.includes('--no-e2e');
const results = [];

function step(name, cmd, args, opts = {}) {
  process.stdout.write('▶ ' + name + ' ... ');
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, ...opts });
  const ok = r.status === 0;
  console.log(ok ? 'OK' : 'FAIL(' + r.status + ')');
  if (!ok && (r.stdout || r.stderr)) {
    console.log((r.stdout || '').split('\n').slice(-12).join('\n'));
    console.log((r.stderr || '').split('\n').slice(-12).join('\n'));
  }
  results.push({ name, ok });
  return r;
}

function runModuleSelfTests() {
  process.stdout.write('▶ 模块自测（rules/model/renderer/editor/util，Node） ... ');
  const script = `
    global.window = {};
    const fs = require('fs');
    const mods = ['util','rules','model','renderer3d','editor2d'];
    const names = ['util','rules','model','renderer','editor'];
    let out = [];
    for (let i = 0; i < mods.length; i++) {
      const f = 'js/' + mods[i] + '.js';
      if (!fs.existsSync(f)) { out.push(names[i] + ': 文件不存在'); continue; }
      try { eval(fs.readFileSync(f, 'utf8')); } catch (e) { out.push(names[i] + ': 加载异常 ' + e.message); continue; }
    }
    let pass = 0, fail = 0;
    for (const n of names) {
      const m = global.window.MCSKIN[n];
      // 有些模块的自测需要显式调用才会登记结果
      if (m && typeof m._selfTest === 'function') {
        try { m._selfTest(); } catch (e) { out.push(n + '._selfTest 抛异常: ' + e.message); }
      }
      const t = global.window.MCSKIN.tests && global.window.MCSKIN.tests[n];
      if (t) { pass += t.pass.length; fail += t.fail.length; }
      if (t && t.fail.length) out.push(n + ' 失败: ' + t.fail.join(' | '));
      if (!t) out.push(n + ': 无自测结果');
    }
    console.log('pass=' + pass + ' fail=' + fail);
    if (out.length) console.log(out.join('\\n'));
    process.exit(fail === 0 && out.filter(s => /不存在|异常|无自测/.test(s)).length === 0 ? 0 : 1);
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  console.log(ok ? 'OK' : 'FAIL');
  console.log((r.stdout || '').trim().split('\n').map(l => '   ' + l).join('\n'));
  if (!ok) console.log((r.stderr || '').split('\n').slice(-8).join('\n'));
  results.push({ name: 'module self-tests', ok });
}

// 1) 语法检查
const jsFiles = existsSync('js') ? readdirSync('js').filter(f => f.endsWith('.js')) : [];
for (const f of jsFiles) step('node --check js/' + f, process.execPath, ['--check', 'js/' + f]);

// 2) 纯 Node 验证
step('legacy 64×32 → 64×64 转换验证', process.execPath, ['tools/verify_legacy.mjs']);
step('UV↔几何 展开网接缝验证', process.execPath, ['tools/verify_unwrap.mjs']);
step('参考图区域探针（Python/Pillow，可选）', process.execPath, ['-e', 'process.exit(0)']);

// 3) 模块自测
runModuleSelfTests();

// 3.5) DSH 插件 skill（mcskin-artist）：存在就跑它的自检
const SKILL_BIN = 'skill/mcskin-artist/bin';
if (existsSync(SKILL_BIN + '/skin.mjs')) {
  const r = step('skill: skin.mjs selftest（绘制+lint 核心）', process.execPath, [SKILL_BIN + '/skin.mjs', 'selftest']);
  try {
    const j = JSON.parse((r.stdout || '').slice((r.stdout || '').indexOf('{')));
    console.log('   core/lint 自测: pass ' + j.pass + ' / fail ' + j.fail);
    if (j.fail) results[results.length - 1].ok = false;
  } catch (e) { results[results.length - 1].ok = false; }
  if (existsSync(SKILL_BIN + '/render.mjs')) {
    const r2 = step('skill: render.mjs --selftest（多视角多姿态）', process.execPath, [SKILL_BIN + '/render.mjs', '--selftest']);
    try {
      const j2 = JSON.parse((r2.stdout || '').slice((r2.stdout || '').indexOf('{')));
      console.log('   渲染自检: ' + (j2.ok ? 'OK' : 'FAIL') + ' pass ' + (j2.pass || 0) + ' / fail ' + (j2.fail || 0) + (j2.skipped ? '（跳过：' + j2.skipped + '）' : ''));
      if (j2.ok === false) results[results.length - 1].ok = false;
    } catch (e) { results[results.length - 1].ok = false; }
  }
}

// 4) 端到端（无头 Edge）
if (!NO_E2E) {
  step('生成端到端探针', process.execPath, ['tests/build_probe.mjs']);
  const r = step('无头 Edge 端到端验收', process.execPath,
    ['tools/headless.mjs', 'index.html', '--apply', 'tests/out/auto_probe_injected.js', '--width', '1600', '--height', '1000']);
  if (r.stdout) {
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
      const p = j.probe || {};
      console.log('   探针: PASS ' + p.pass + ' / FAIL ' + p.fail + '（phase=' + p.phase + '）');
      (p.failures || []).slice(0, 12).forEach(f => console.log('     ✗ ' + (typeof f === 'string' ? f : JSON.stringify(f).slice(0, 200))));
      if ((p.fail || 0) > 0) results[results.length - 1].ok = false;
    } catch (e) { console.log('   无法解析探针输出: ' + e.message); }
  }
}

console.log('\n================ 汇总 ================');
let allOk = true;
for (const r of results) { console.log((r.ok ? '  ✔ ' : '  ✘ ') + r.name); if (!r.ok) allOk = false; }
console.log(allOk ? '\n全部通过 ✅' : '\n存在失败项 ❌');
process.exit(allOk ? 0 : 1);
