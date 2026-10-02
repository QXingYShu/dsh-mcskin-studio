/* tests/drag_probe.js — 模拟鼠标拖拽/滚轮，验证 3D 视角可交互（归属：Lead）
 * 注入 index.html：dispatch 真实 mousedown/mousemove/mouseup/wheel 事件，断言 yaw/pitch/zoom 改变。
 */
(function () {
  'use strict';
  var out = { pass: 0, fail: 0, checks: [], errors: [] };
  function ok(name, cond, detail) {
    if (cond) out.pass++; else { out.fail++; out.checks.push('✗ ' + name + ' → ' + JSON.stringify(detail)); }
  }
  window.addEventListener('error', function (e) { out.errors.push(String(e.message)); });

  function finish() {
    var el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'probe-json';
    el.textContent = JSON.stringify(out);
    document.body.appendChild(el);
    document.title = 'DRAG ' + (out.fail ? 'FAIL' : 'PASS');
  }

  function boot() {
    if (!window.MCSKIN || !MCSKIN.shellApi) {
      if (!boot.n) boot.n = 0;
      if (++boot.n > 100) { out.errors.push('等不到 shellApi'); finish(); return; }
      setTimeout(boot, 100); return;
    }
    try { run(); } catch (e) { out.errors.push('异常: ' + (e && e.stack || e)); finish(); }
  }

  function run() {
    var st = MCSKIN.shellApi.state;
    var R = st.renderer;
    if (!R || R.glError) { out.errors.push('renderer 不可用: ' + (R && R.glError)); finish(); return; }
    var canvas = document.getElementById('glCanvas');
    var rect = canvas.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var toggle = document.getElementById('tglAuto');

    // —— 诊断：真实鼠标会命中哪个元素？有没有东西盖在 canvas 上？
    var hit = document.elementFromPoint(cx, cy);
    out.hitTest = {
      at: [Math.round(cx), Math.round(cy)],
      tag: hit && hit.tagName, id: hit && hit.id, cls: hit && hit.className,
      isCanvas: hit === canvas
    };
    (function () {
      var g = document.getElementById('glError');
      if (!g) { out.glErrorStyle = 'missing'; return; }
      var cs = getComputedStyle(g);
      out.glErrorStyle = {
        hiddenAttr: g.hasAttribute('hidden'), display: cs.display, visibility: cs.visibility,
        pointerEvents: cs.pointerEvents, bg: cs.backgroundColor, text: (g.textContent || '').slice(0, 60),
        rect: [Math.round(g.getBoundingClientRect().width), Math.round(g.getBoundingClientRect().height)]
      };
    })();
    (function () {
      var h = document.querySelector('.viewport-hud');
      if (h) { var cs = getComputedStyle(h); out.hudStyle = { pointerEvents: cs.pointerEvents, display: cs.display }; }
    })();
    out.version = (document.getElementById('footVersion') || {}).textContent || 'no-version-badge';
    out.canvasRect = { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) };
    ok('画布命中测试：canvas 中心点属于 glCanvas（没有被别的元素盖住）', hit === canvas, out.hitTest);

    // 1) 拖拽应"接管视角"：关掉自动旋转（这是用户报告"不能自由拖动"的根因）
    R.setAutoRotate(true);
    if (toggle) toggle.classList.add('on');
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 4, clientY: cy }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 4, clientY: cy }));
    out.autoRotateAfterMousedown = R.autoRotate;
    ok('按下鼠标后自动旋转被关掉（用户接管）', R.autoRotate === false, { autoRotate: R.autoRotate });
    ok('「自动旋转」按钮状态同步为关闭', !toggle || !toggle.classList.contains('on'),
      toggle ? { cls: toggle.className } : null);

    // 0) 以关掉自动旋转的状态做后续精确断言
    R.setAutoRotate(false);
    R.setAnimation('none');
    var r0 = R.getRotation();

    // 2) 拖拽：mousedown → 5 次 mousemove → mouseup
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 }));
    for (var i = 1; i <= 5; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + i * 12, clientY: cy + i * 6 }));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 60, clientY: cy + 30 }));
    var r1 = R.getRotation();
    out.yawAfterDrag = r1.yaw; out.pitchAfterDrag = r1.pitch; out.yawBefore = r0.yaw;
    ok('拖拽后 yaw 改变（|Δ|>1°）', Math.abs(r1.yaw - r0.yaw) > 1, { before: r0.yaw, after: r1.yaw });
    ok('拖拽后 pitch 改变（|Δ|>1°）', Math.abs(r1.pitch - r0.pitch) > 1, { before: r0.pitch, after: r1.pitch });

    // 2) 拖拽结束后角度应保持（没有被别的逻辑改回去）
    var r2 = R.getRotation();
    ok('松手后角度保持', Math.abs(r2.yaw - r1.yaw) < 0.01 && Math.abs(r2.pitch - r1.pitch) < 0.01, r2);

    // 3) 滚轮缩放
    var z0 = R.getZoom();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: cx, clientY: cy }));
    var z1 = R.getZoom();
    ok('滚轮后 zoom 改变', Math.abs(z1 - z0) > 0.001, { before: z0, after: z1 });

    // 4) 视角改了画面要变（截屏对比）
    var beforeShot = R.screenshot();
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx - 80, clientY: cy }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx - 80, clientY: cy }));
    R.render();
    var afterShot = R.screenshot();
    function h(s) { var x = 0; for (var i = 0; i < s.length; i += 101) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
    ok('拖拽后画面改变', h(beforeShot) !== h(afterShot), { b: h(beforeShot), a: h(afterShot) });

    // 5) 复位按钮应能回到默认视角
    var btn = document.getElementById('btnReset');
    if (btn) { btn.click(); var r3 = R.getRotation(); ok('复位按钮生效（yaw≈20,pitch≈10）', Math.abs(r3.yaw - 20) < 1 && Math.abs(r3.pitch - 10) < 1, r3); }

    // 6) 自动旋转：开起来 1 秒后 yaw 应变化
    R.setAutoRotate(true);
    var a0 = R.getRotation().yaw;
    setTimeout(function () {
      var a1 = R.getRotation().yaw;
      out.autoRotate = { before: a0, after: a1 };
      ok('自动旋转生效（yaw 变化）', Math.abs(a1 - a0) > 0.5, { before: a0, after: a1 });
      R.setAutoRotate(false);
      finish();
    }, 700);
  }
  boot();
})();
