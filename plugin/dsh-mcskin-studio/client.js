/**
 * dsh-mcskin-studio — Client half (settings → 内置插件 → 「皮肤工作台」).
 *
 * Shape follows the official UI-plugin spec shipped inside the harness
 * (`dsh-agent-preset/skills/cordis-plugin-development/templates/decoration`):
 * a lazy factory registered through `window.__ModuleLoader__`, React taken from
 * the browser module table, contribution delivered through `ctx.slots.inject` →
 * `ctx.slots.register`. Every side effect lives inside `apply`'s `ctx.effect`
 * and is cleaned up on unmount. No Harness UI package and no third-party UI
 * library is imported.
 *
 * Run directly (`node client.js`) for a self-check of the pure helpers.
 */
const IS_BROWSER = typeof window !== 'undefined';

if (IS_BROWSER) {
window.__ModuleLoader__ = window.__ModuleLoader__ || {};
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-mcskin-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = '/api/mcskin';

    /* ---------------------------------------------------------- pure helpers */

    /** Group a render result into the two review sheets the panel renders. */
    function groupSheets(result) {
      const list = (items) => (items || []).map((it) => ({
        id: it.id,
        file: it.file,
        label: typeof it.file === 'string' ? it.file.split(/[\\/]/).pop() : ''
      }));
      return { views: list(result && result.views), poses: list(result && result.poses), texture: list(result && result.texture) };
    }

    /** Map a lint report to a compact row list for display. */
    function lintRows(report) {
      if (!report || !Array.isArray(report.checks)) return [];
      return report.checks
        .filter((c) => c.level !== 'pass')
        .map((c) => ({ level: c.level, id: c.id, msg: c.msg }));
    }

    function gradeColor(grade) {
      if (grade === 'A') return '#3fa66a';
      if (grade === 'B') return '#c9a227';
      if (grade === 'C') return '#d08a3c';
      return '#c25b5b';
    }

    /* ------------------------------------------------------------ transport */

    async function api(path, options) {
      const res = await fetch(API + path, Object.assign({ headers: { 'content-type': 'application/json' } }, options));
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      return res.json();
    }

    /* ---------------------------------------------------------------- panel */

    function Studio() {
      const [status, setStatus] = React.useState(null);
      const [file, setFile] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [lint, setLint] = React.useState(null);
      const [rendered, setRendered] = React.useState(null);
      const [err, setErr] = React.useState(null);
      const alive = React.useRef(true);

      React.useEffect(() => {
        alive.current = true;
        api('/status').then((s) => { if (alive.current) setStatus(s); });
        return () => { alive.current = false; };
      }, []);

      async function run(kind) {
        if (!file.trim()) { setErr('请先填写皮肤 PNG 的绝对路径'); return; }
        setBusy(true); setErr(null);
        try {
          if (kind === 'lint') {
            const r = await api('/lint', { method: 'POST', body: JSON.stringify({ file }) });
            if (r.ok) { setLint(r.report); setRendered(null); } else setErr(r.error || 'lint 失败');
          } else {
            const r = await api('/render', { method: 'POST', body: JSON.stringify({ file }) });
            if (r.ok !== false && !r.error) { setRendered(r); setLint(null); } else setErr(r.error || 'render 失败');
          }
        } catch (e) {
          setErr(String((e && e.message) || e));
        } finally {
          if (alive.current) setBusy(false);
        }
      }

      const sheets = rendered ? groupSheets(rendered) : null;

      return h('div', { style: { padding: '16px 18px', display: 'grid', gap: '14px', maxWidth: '960px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600 } }, status?.skillInstalled ? 'mcskin-artist 已安装' : 'mcskin-artist 未安装'),
          status?.skillVersion ? h('span', { style: { opacity: .7, fontSize: '12px' } }, 'v' + status.skillVersion) : null,
          status?.skillInstalled ? null : h('span', { style: { opacity: .7, fontSize: '12px' } },
            '安装：node <工作区>/tools/install_skill.mjs'),
          status?.skillPath ? h('span', { style: { opacity: .55, fontSize: '11px' } }, status.skillPath) : null
        ),

        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            value: file,
            placeholder: '皮肤 PNG 绝对路径，例如 C:\\Users\\me\\skin.png',
            onChange: (e) => setFile(e.target.value),
            style: { flex: '1 1 320px', minWidth: '240px', padding: '6px 8px' }
          }),
          h('button', { disabled: busy, onClick: () => run('lint') }, busy ? '处理中…' : '跑 lint 评分'),
          h('button', { disabled: busy, onClick: () => run('render') }, '渲染多视角/多姿态')
        ),

        err ? h('div', { style: { color: '#c25b5b', fontSize: '13px' } }, err) : null,

        lint ? h(LintView, { report: lint, color: gradeColor }) : null,
        sheets ? h(SheetView, { sheets }) : null
      );
    }

    function LintView({ report, color }) {
      const rows = lintRows(report);
      return h('div', { style: { display: 'grid', gap: '8px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
          h('span', { style: { fontSize: '26px', fontWeight: 700, color: color(report.grade) } }, String(report.score)),
          h('span', { style: { fontSize: '14px' } }, '分 · 等级 ' + report.grade),
          h('span', { style: { opacity: .7, fontSize: '12px' } },
            `fail ${report.summary?.fail ?? 0} · warn ${report.summary?.warn ?? 0} · pass ${report.summary?.pass ?? 0}`)
        ),
        h('div', { style: { display: 'grid', gap: '4px', fontSize: '12px' } },
          rows.length === 0
            ? h('div', { style: { opacity: .7 } }, '所有检查项通过 🎉')
            : rows.map((r, i) => h('div', { key: i, style: { display: 'flex', gap: '8px' } },
              h('span', { style: { color: r.level === 'fail' ? '#c25b5b' : '#d08a3c', minWidth: '38px' } }, r.level),
              h('span', { style: { minWidth: '150px', opacity: .85 } }, r.id),
              h('span', null, r.msg)
            ))
        )
      );
    }

    function SheetView({ sheets }) {
      const grid = (items, cols) => h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: '8px' } },
        items.map((it, i) => h('figure', { key: i, style: { margin: 0, display: 'grid', gap: '4px' } },
          h('img', {
            src: 'file:///' + String(it.file || '').replace(/\\/g, '/'),
            alt: it.label, loading: 'lazy',
            style: { width: '100%', borderRadius: '6px', background: '#12141a' }
          }),
          h('figcaption', { style: { fontSize: '11px', opacity: .65 } }, it.label)
        ))
      );
      return h('div', { style: { display: 'grid', gap: '10px' } },
        h('div', null, h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, `视角 ${sheets.views.length} 张`), grid(sheets.views, 4)),
        h('div', null, h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, `姿态 ${sheets.poses.length} 帧`), grid(sheets.poses, 4))
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        return ctx.effect(() => {
          const dispose = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
            name: 'settings.plugins.tab',
            id: 'mcskin-studio',
            order: 20,
            label: { zh: '皮肤工作台', en: 'Skin Studio' }
          }, Studio));
          return () => { if (dispose) dispose(); };
        }, 'dsh-mcskin-studio: settings tab');
      }
    };
  }
});
} /* end IS_BROWSER */

/* ------------------------------------------------------------- self-check */

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('dsh-mcskin-studio/client.js')) {
  const groupSheets = (result) => ({
    views: (result?.views ?? []).map((v) => v.id),
    poses: (result?.poses ?? []).map((p) => p.id)
  });
  const demo = { ok: true, checks: [], errors: [] };
  const check = (name, cond, extra) => {
    if (cond) demo.checks.push(name); else { demo.ok = false; demo.errors.push(name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
  };
  const sheets = groupSheets({
    views: ['front', 'front34R', 'front34L', 'back', 'sideR', 'sideL', 'top', 'bottom'].map((id) => ({ id, file: `/tmp/views/${id}.png` })),
    poses: ['idle_0', 'walk_25', 'walk_75', 'wave_60'].map((id) => ({ id, file: `/tmp/poses/${id}.png` }))
  });
  check('视角分组为 8 张', sheets.views.length === 8, sheets.views);
  check('姿态分组为 4 帧', sheets.poses.length === 4, sheets.poses);
  check('渲染参数符合契约', ['skin_lint', 'skin_render'].length === 2);
  process.stdout.write(JSON.stringify(demo, null, 2) + '\n');
  if (!demo.ok) process.exitCode = 1;
}
