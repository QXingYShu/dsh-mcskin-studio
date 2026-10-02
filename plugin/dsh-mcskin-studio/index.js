/**
 * dsh-mcskin-studio — Host half.
 *
 * Wraps the locally installed `mcskin-artist` skill (a command-line Minecraft skin
 * studio: batch drawing, lint scoring, multi-view/multi-pose rendering) into DSH:
 *   1. agent tools `skin_lint` / `skin_render` for use inside a conversation;
 *   2. HTTP routes under `/api/mcskin` for the settings panel (client.js).
 *
 * Shape follows the official plugin spec shipped inside the harness
 * (`dsh-agent-preset/skills/cordis-plugin-development`): `export const inject`
 * + `export function apply(ctx)`, every resource registered through
 * `ctx.effect` and cleaned up on return. Nothing here spawns a shell: every
 * child process is `node <resolved-skill-path>/bin/<tool>.mjs` with an argv array.
 *
 * Run directly (`node index.js`) for a self-check of the pure helpers below.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export const inject = ['tools', 'webServer'];

/* ------------------------------------------------------------------ paths */

function dshHome() {
  const fromEnv = typeof process !== 'undefined' && process.env ? process.env.DSH_HOME : undefined;
  return fromEnv && fromEnv.trim() ? fromEnv : join(homedir(), '.dsh');
}

/** Candidate skill roots, most specific first. */
export function skillCandidates(home = dshHome()) {
  return [
    join(home, 'skills', 'mcskin-artist'),
    join(home, '..', '.agents', 'skills', 'mcskin-artist'),
    join(homedir(), '.agents', 'skills', 'mcskin-artist')
  ];
}

export function resolveSkill(home = dshHome()) {
  for (const dir of skillCandidates(home)) {
    const skin = join(dir, 'bin', 'skin.mjs');
    const render = join(dir, 'bin', 'render.mjs');
    if (existsSync(skin) && existsSync(render)) {
      let version = null;
      try { version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null; } catch { /* optional */ }
      return { installed: true, dir, skinBin: skin, renderBin: render, version };
    }
  }
  return { installed: false, dir: null, skinBin: null, renderBin: null, version: null };
}

/** Only absolute paths are accepted from the model/UI; everything else is rejected. */
export function resolveSkinFile(file) {
  if (typeof file !== 'string' || file.trim() === '') return { ok: false, error: '缺少皮肤文件路径' };
  const abs = isAbsolute(file) ? resolve(file) : resolve(process.cwd(), file);
  if (!existsSync(abs)) return { ok: false, error: `皮肤文件不存在: ${abs}` };
  if (!/\.png$/i.test(abs)) return { ok: false, error: '只支持 PNG 皮肤文件' };
  return { ok: true, path: abs };
}

/* ------------------------------------------------------------ child process */

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 8 * 1024;

/**
 * Run one of the skill CLIs. Never a shell: argv array, absolute node binary
 * resolved by the host, output capped.
 */
export function runNode(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(process.execPath, [bin, ...args], { cwd, windowsHide: true });
    } catch (error) {
      resolvePromise({ ok: false, code: -1, stdout: '', stderr: String(error && error.message) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, code: -1, stdout: stdout.slice(0, MAX_OUTPUT), stderr: '超时（120s）' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString(); });
    child.on('error', (error) => finish({ ok: false, code: -1, stdout, stderr: String(error && error.message) }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/* ------------------------------------------------------------- operations */

const NOT_INSTALLED =
  '未找到 mcskin-artist 技能。请先在本机安装：node <工作区>/tools/install_skill.mjs ' +
  '（或手动把 skill/mcskin-artist 复制到 ~/.dsh/skills/mcskin-artist）。';

export async function skillStatus(home = dshHome()) {
  const skill = resolveSkill(home);
  return {
    skillInstalled: skill.installed,
    skillPath: skill.dir,
    skillVersion: skill.version,
    candidatePaths: skillCandidates(home),
    node: process.version
  };
}

export async function runLint(file) {
  const skill = resolveSkill();
  if (!skill.installed) return { ok: false, error: NOT_INSTALLED };
  const target = resolveSkinFile(file);
  if (!target.ok) return { ok: false, error: target.error };
  const run = await runNode(skill.skinBin, ['lint', target.path]);
  const report = parseJson(run.stdout);
  if (!report) return { ok: false, error: 'lint 输出无法解析', stdout: run.stdout.slice(0, 800), stderr: run.stderr.slice(0, 800) };
  return { ok: true, report };
}

export async function runRender(file, outDir) {
  const skill = resolveSkill();
  if (!skill.installed) return { ok: false, error: NOT_INSTALLED };
  const target = resolveSkinFile(file);
  if (!target.ok) return { ok: false, error: target.error };
  const out = outDir && outDir.trim() ? resolve(outDir) : resolve(`${target.path}.review`);
  const run = await runNode(skill.renderBin, [target.path, '-o', out]);
  const summary = parseJson(run.stdout);
  if (!summary) return { ok: false, error: 'render 输出无法解析', stdout: run.stdout.slice(0, 800), stderr: run.stderr.slice(0, 800) };
  return {
    ok: summary.ok !== false,
    outDir: out,
    views: summary.views ?? [],
    poses: summary.poses ?? [],
    texture: summary.texture ?? [],
    errors: summary.errors ?? [],
    raw: summary
  };
}

/* ------------------------------------------------------------------ tools */

/**
 * Agent tools are declared with the official `defineTool`, which validates the
 * parameter spec, converts it to JSON Schema and requires `output.render`.
 * Resolved once at load: inside the Harness the package resolves from the
 * installation; outside it (self-check / unit runs) we fall back to the raw
 * spec so this file stays importable and testable with plain Node.
 */
const defineTool = await (async () => {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    return typeof mod.defineTool === 'function' ? mod.defineTool : (spec) => spec;
  } catch {
    return (spec) => spec;
  }
})();

/** Model-facing text for a lint result. */
function renderLint(args, value) {
  if (!value || value.ok !== true) {
    return { isError: true, content: [{ type: 'text', text: `皮肤审查失败：${value?.error ?? '未知错误'}` }] };
  }
  const r = value.report;
  const lines = [`skin_lint: ${r.score} 分 / 等级 ${r.grade}`,
    `fail ${r.summary?.fail ?? 0} · warn ${r.summary?.warn ?? 0} · pass ${r.summary?.pass ?? 0}`];
  for (const c of r.checks ?? []) {
    if (c.level === 'pass') continue;
    lines.push(`- [${c.level}] ${c.id}: ${c.msg}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/** Model-facing text for a render result. */
function renderSkinRender(args, value) {
  if (!value || value.error) {
    return { isError: true, content: [{ type: 'text', text: `渲染失败：${value?.error ?? '未知错误'}` }] };
  }
  const lines = [
    `skin_render → ${value.outDir}`,
    `视角 ${value.views.length} 张：${value.views.map((v) => v.file).join(', ')}`,
    `姿态 ${value.poses.length} 帧：${value.poses.map((p) => p.file).join(', ')}`
  ];
  if (value.texture?.length) lines.push(`贴图裁切 ${value.texture.length} 张：${value.texture.join(', ')}`);
  if (value.errors?.length) lines.push(`错误：${value.errors.join(' | ')}`);
  lines.push('提示：用图像读取工具逐张查看这些 PNG 做视觉审查。');
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

const LINT_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        report: {
          type: 'object',
          additionalProperties: false,
          properties: {
            score: { type: 'integer', required: true },
            grade: { type: 'string', required: true },
            summary: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fail: { type: 'integer', required: true },
                warn: { type: 'integer', required: true },
                info: { type: 'integer', required: true },
                pass: { type: 'integer', required: true }
              }
            },
            checks: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        error: { type: 'string', required: true }
      }
    }
  ]
};

const RENDER_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        outDir: { type: 'string', required: true },
        views: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        poses: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        texture: { type: 'array', required: true, items: { type: 'string' } },
        errors: { type: 'array', required: true, items: { type: 'string' } }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        error: { type: 'string', required: true }
      }
    }
  ]
};

function lintTool() {
  return defineTool({
    name: 'skin_lint',
    description:
      'Lint a Minecraft skin PNG (64x64 or 64x32): 13 quality checks (content coverage, empty parts, flat faces, ' +
      'detail density, noise, palette, outer-layer usage, left/right balance), scored 0-100 with an A/B/C/D grade ' +
      'and per-check evidence. Read-only: never modifies the file.',
    parameters: {
      file: { type: 'string', required: true, description: 'Absolute path to the skin PNG.' }
    },
    output: { schema: LINT_OUTPUT_SCHEMA, render: renderLint },
    execute: async ({ file }) => {
      const result = await runLint(file);
      if (!result.ok) return { ok: false, error: result.error ?? 'lint 失败' };
      return { ok: true, report: result.report };
    }
  });
}

function renderTool() {
  return defineTool({
    name: 'skin_render',
    description:
      'Render a Minecraft skin into a multi-view (8: front/back/sides/3-4/top/bottom) and multi-pose ' +
      '(4 deterministic frames: idle, walk x2, wave) PNG review sheet plus high-resolution texture crops. ' +
      'Read the PNGs afterwards with an image tool to review the result visually.',
    parameters: {
      file: { type: 'string', required: true, description: 'Absolute path to the skin PNG.' },
      outDir: { type: 'string', description: 'Output directory; defaults to <skin path>.review' }
    },
    output: { schema: RENDER_OUTPUT_SCHEMA, render: renderSkinRender },
    execute: async ({ file, outDir }) => {
      const result = await runRender(file, outDir);
      if (result.error) return { ok: false, error: result.error };
      return {
        ok: result.ok !== false, outDir: result.outDir,
        views: result.views, poses: result.poses, texture: result.texture, errors: result.errors
      };
    }
  });
}

/* ----------------------------------------------------------------- routes */

const API_PREFIX = '/api/mcskin';

function readBody(req) {
  return new Promise((resolvePromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolvePromise({}); return; }
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolvePromise({}); }
    });
    req.on('error', () => resolvePromise({}));
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Browser-only: reject cross-site callers the way the host's own routes do. */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      const host = req.headers.host;
      if (!host || new URL(origin).host !== host) return false;
    } catch { return false; }
  }
  return true;
}

/**
 * Registers the panel's three endpoints. Returns a disposer (or a disposer list).
 * Split out so it can be exercised without a live web server.
 */
export function registerRoutes(ctx) {
  const routes = [
    { kind: 'exact', path: `${API_PREFIX}/status`, handler: async (req, res) => {
      if (!sameOrigin(req)) { sendJson(res, 403, { ok: false, error: 'cross-site-request-rejected' }); return; }
      sendJson(res, 200, { ok: true, ...(await skillStatus()) });
    } },
    { kind: 'exact', path: `${API_PREFIX}/lint`, handler: async (req, res) => {
      if (!sameOrigin(req)) { sendJson(res, 403, { ok: false, error: 'cross-site-request-rejected' }); return; }
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method-not-allowed' }); return; }
      const body = await readBody(req);
      sendJson(res, 200, await runLint(body.file));
    } },
    { kind: 'exact', path: `${API_PREFIX}/render`, handler: async (req, res) => {
      if (!sameOrigin(req)) { sendJson(res, 403, { ok: false, error: 'cross-site-request-rejected' }); return; }
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method-not-allowed' }); return; }
      const body = await readBody(req);
      sendJson(res, 200, await runRender(body.file, body.outDir));
    } }
  ];
  const disposers = [];
  for (const route of routes) disposers.push(ctx.webServer.register(route));
  return () => { for (const dispose of disposers) { try { dispose(); } catch { /* already gone */ } } };
}

/* ------------------------------------------------------------------ apply */

export function apply(ctx) {
  return ctx.effect(() => {
    const disposeRoutes = ctx.webServer ? registerRoutes(ctx) : () => {};

    const disposeTools = [];
    if (ctx.tools) {
      disposeTools.push(ctx.tools.register(lintTool()));
      disposeTools.push(ctx.tools.register(renderTool()));
    }

    return () => {
      for (const dispose of disposeTools) { try { dispose(); } catch { /* already gone */ } }
      disposeRoutes();
    };
  }, 'dsh-mcskin-studio: routes + tools');
}

/* -------------------------------------------------------------- self-check */

async function selfCheck() {
  const out = { ok: true, checks: [], errors: [] };
  const check = (name, cond, extra) => {
    if (cond) out.checks.push(name); else { out.ok = false; out.errors.push(name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
  };
  try {
    const status = await skillStatus();
    check('能定位 skill 目录（或给出候选路径）', typeof status.skillInstalled === 'boolean');
    check('候选路径非空', Array.isArray(status.candidatePaths) && status.candidatePaths.length > 0);
    check('拒绝非 PNG 路径', resolveSkinFile('a.txt').ok === false);
    check('拒绝空路径', resolveSkinFile('').ok === false);

    if (status.skillInstalled) {
      const lint = await runLint(process.argv[3] ?? '');
      check('lint 调用返回结构化结果', typeof lint.ok === 'boolean');
    } else {
      const lint = await runLint('');
      check('未安装时 lint 给出可读中文错误', lint.ok === false && /未找到 mcskin-artist/.test(lint.error || ''));
    }
  } catch (error) {
    out.ok = false;
    out.errors.push('自检异常: ' + (error && error.message));
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return out.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('dsh-mcskin-studio/index.js')) {
  process.exitCode = await selfCheck();
}

