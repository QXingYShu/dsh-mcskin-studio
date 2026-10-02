#!/usr/bin/env node
/* tools/mount_plugin.mjs — 用宿主同款 cordis 离线挂载插件 bundle（归属：Lead）
 *
 * 目的：在不改动用户 profile 的前提下，验证 plugin/dsh-mcskin-studio 的
 * Host 半边能被真实 loader 加载、apply() 不抛错、并真的注册出
 * 两个 agent 工具与三条 HTTP 路由。
 * 用法: node tools/mount_plugin.mjs [bundleDir]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const bundleDir = resolve(process.argv[2] ?? 'plugin/dsh-mcskin-studio');
if (!existsSync(resolve(bundleDir, 'index.js'))) {
  console.log(JSON.stringify({ ok: false, error: 'bundle 无 index.js: ' + bundleDir }));
  process.exit(1);
}

const profilesNM = resolve(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'node_modules');
const candidates = [
  resolve(profilesNM, '@deepseek-ai/cordis'),
  resolve(profilesNM, '@deepseek-ai/dsh-tools'),
  resolve(profilesNM, '@deepseek-ai/dsh-host-webserver')
];
const missing = candidates.filter((p) => !existsSync(p));
if (missing.length) {
  console.log(JSON.stringify({ ok: false, skipped: 'missing-deps', missing }, null, 2));
  process.exit(0);
}

const require = createRequire(bundleDir + '/');
const out = { ok: true, checks: [], errors: [] };
const check = (name, cond, extra) => {
  if (cond) out.checks.push(name); else { out.ok = false; out.errors.push(name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
};

try {
  const cordisMod = require('@deepseek-ai/cordis');
  const cordis = cordisMod.default ?? cordisMod;
  const bundle = await import(require.resolve(resolve(bundleDir, 'index.js')).replace(/\\/g, '/'));

  check('导出 inject', Array.isArray(bundle.inject) && bundle.inject.includes('tools'), bundle.inject);
  check('导出 apply', typeof bundle.apply === 'function');

  const registeredTools = [];
  const registeredRoutes = [];
  let effectRan = false;
  let disposed = false;

  const app = cordis({ ...{} });
  // 只挂我们需要的最小 ctx 表面，模拟宿主注入的服务
  const ctx = {
    tools: {
      register(tool) { registeredTools.push(tool.name ?? '(unnamed)'); return () => {}; }
    },
    webServer: {
      register(route) { registeredRoutes.push({ kind: route.kind, path: route.path }); return () => {}; }
    },
    effect(fn) { effectRan = true; return fn(); },
    on() { return () => {}; },
    get() { return undefined; },
    set() {},
    logger: console
  };

  const disposer = bundle.apply(ctx);
  check('apply() 未抛异常', true);
  check('effect 已执行', effectRan);
  check('注册了两个 agent 工具', registeredTools.length === 2, registeredTools);
  check('注册了 skin_lint 工具', registeredTools.includes('skin_lint'), registeredTools);
  check('注册了 skin_render 工具', registeredTools.includes('skin_render'), registeredTools);
  check('注册了三条 HTTP 路由', registeredRoutes.length === 3, registeredRoutes);
  check('路由路径正确',
    registeredRoutes.map((r) => r.path).sort().join(',') === '/api/mcskin/lint,/api/mcskin/render,/api/mcskin/status',
    registeredRoutes.map((r) => r.path));

  if (typeof disposer === 'function') { disposer(); disposed = true; }
  check('返回清理函数且可调用', disposed);

  // 真实跑一次 skill lint（如果技能已安装）
  const status = await bundle.skillStatus();
  out.skillInstalled = status.skillInstalled;
  if (status.skillInstalled) {
    const skin = resolve('tests/skill_demo/ranger.png');
    if (existsSync(skin)) {
      const lint = await bundle.runLint(skin);
      check('真实 lint 调用成功', lint.ok === true && typeof lint.report.score === 'number',
        { ok: lint.ok, error: lint.error });
      if (lint.ok) out.lint = { score: lint.report.score, grade: lint.report.grade };
    }
  }

  void app;
} catch (error) {
  out.ok = false;
  out.errors.push('挂载异常: ' + (error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error.message));
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);