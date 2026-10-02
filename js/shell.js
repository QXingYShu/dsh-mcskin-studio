/* shell.js — 总装：文件读写、控件绑定、模块联动（归属：Lead）
 * 全局命名空间：MCSKIN.shell
 * 不使用 ES module 语法。
 */
(function () {
  'use strict';
  window.MCSKIN = window.MCSKIN || {};
  var U = MCSKIN.util;
  var tests = { pass: [], fail: [] };
  function ok(name, cond) { (cond ? tests.pass : tests.fail).push(name); }

  var CRASH = null;   // 初始化期的错误
  var S = {
    model: null,
    editor: null,
    renderer: null,
    glOk: false,
    tools: [
      { id: 'pencil', label: '铅笔', key: 'P' },
      { id: 'eraser', label: '橡皮', key: 'E' },
      { id: 'fill', label: '填充', key: 'F' },
      { id: 'picker', label: '吸管', key: 'I' },
      { id: 'line', label: '直线', key: 'L' },
      { id: 'rect', label: '矩形', key: 'R' }
    ],
    tool: 'pencil',
    color: [58, 160, 106, 255],
    alpha: 255,
    outerVisible: true,
    baseVisible: true,
    partVisible: {}
  };

  function setStatus(text) {
    var el = document.getElementById('statusLine');
    if (el) el.textContent = text;
  }

  function toast(text, isError) {
    setStatus(text);
    if (isError) {
      var el = document.getElementById('statusLine');
      if (el) el.style.color = 'var(--danger)';
      setTimeout(function () { if (el) el.style.color = ''; }, 4000);
    }
  }

  function require_(name, obj) {
    if (!obj) throw new Error('缺少模块 MCSKIN.' + name + '（文件 js/' + name + '.js 未加载或报错）');
    return obj;
  }

  /* ===================== 工具条 / 部件按钮 ===================== */

  function buildToolButtons() {
    var host = document.getElementById('toolTools');
    if (!host) return;
    host.innerHTML = '';
    S.tools.forEach(function (t) {
      var b = U.el('button', {
        type: 'button',
        'data-tool': t.id,
        title: t.label + '（快捷键 ' + t.key + '）'
      }, [t.label]);
      if (t.id === S.tool) b.classList.add('on');
      b.addEventListener('click', function () { setTool(t.id); });
      host.appendChild(b);
    });
  }

  function setTool(id) {
    S.tool = id;
    if (S.editor) S.editor.setTool(id);
    U.$$('#toolTools button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tool') === id);
    });
  }

  function buildPartButtons() {
    var host = document.getElementById('partVis');
    if (!host) return;
    var rules = MCSKIN.rules;
    var parts = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
    host.innerHTML = '';
    parts.forEach(function (p) {
      var label = (rules && rules.PART_LABEL && rules.PART_LABEL[p]) || p;
      var b = U.el('button', { type: 'button', class: 'toggle on', 'data-part': p, title: '显示/隐藏 ' + label }, [label]);
      b.addEventListener('click', function () {
        S.partVisible[p] = !(S.partVisible[p] !== false);
        var on = S.partVisible[p];
        b.classList.toggle('on', on);
        if (S.renderer) S.renderer.setPartVisible(p, on);
      });
      host.appendChild(b);
    });
  }

  /* ===================== 引导面板内容 ===================== */

  function buildGuide() {
    var host = document.getElementById('guideBody');
    if (!host) return;
    var rules = MCSKIN.rules;
    var fmt = S.model ? (S.model.format === 'legacy' ? '64×32（旧版格式）' : '64×64（现代格式）') : '—';
    var html = '';
    html += '<h3>当前贴图</h3><p>格式：<b>' + fmt + '</b>　每格 1 像素，左上角是 (0,0)。</p>';
    html += '<h3>皮肤怎么"包"到立体模型上</h3>' +
      '<p>Minecraft 皮肤是一张<b>展开图（UV 图）</b>：把方块人剪开摊平。同一个方块的 6 个面，在贴图上排成一条"十字带"——' +
      '侧面 / 正面 / 侧面 / 背面 横着排 4 格宽，上下再各接一条顶面和底面。</p>' +
      '<ul>' +
      '<li><b>头</b>：贴图左上角那 32×16 的一带就是头的"十字带"（侧面 8×8 一个格）。</li>' +
      '<li><b>躯干</b>：中上一带（宽 8、高 12 的正面）。</li>' +
      '<li><b>手臂</b>：宽 4、高 12 的一带；<b>腿</b>：同样是宽 4、高 12 的一带。</li>' +
      '<li><b>第二层（外层面）</b>：贴图右半（x≥32）与下半（y≥32）是帽子 / 外套 / 袖子 / 裤子，' +
      '它们比本体大一圈（每边 0.25 像素），盖在本体外面，可以画透明的头发、帽子、衣服。</li>' +
      '</ul>';
    html += '<h3>像素区块 → 立体部位 对照表</h3>';
    html += '<table class="guide-table"><thead><tr><th>部位</th><th>贴图区域（x, y, 宽×高）</th></tr></thead><tbody>';
    var layout = (rules && rules.LAYOUT_REGIONS) ? rules.LAYOUT_REGIONS : [];
    layout.filter(function (r) { return r.kind !== 'overlay'; }).forEach(function (r) {
      html += '<tr><td>' + r.label + '</td><td class="num">' + r.px[0] + ', ' + r.px[1] + ', ' +
        (r.px[2] - r.px[0]) + '×' + (r.px[3] - r.px[1]) + '</td></tr>';
    });
    html += '</tbody></table>';
    if (!layout.length) html += '<p>（等 rules.js 提供 LAYOUT_REGIONS 后这里会列出完整对照表）</p>';

    html += '<h3>6 个面永远按这个顺序排</h3>' +
      '<p>每个方块都是：<code>右面 · 正面 · 左面 · 背面</code> 横排，上面接<code>顶面</code>，下面接<code>底面</code>。' +
      '所以看到一条 4 格宽的横带，就从左到右读成「右、前、左、后」。</p>';

    html += '<h3>点击部位名可以只看它</h3><div id="guideParts"></div>';

    html += '<h3>怎么用</h3><ul>' +
      '<li>左边画，右边立刻就是立体的。</li>' +
      '<li>打开工作目录里的参考图：把 <code>苦力怕娘.png</code> 或 <code>HIM.png</code> 拖进页面，或者点「打开皮肤…」。</li>' +
      '<li>「部位标注」打开后，画布上会写出每一块属于哪个部位。</li>' +
      '<li>想画第二层（头发/帽子/衣服），先把「当前编辑层」切到外层面。</li>' +
      '</ul>';

    host.innerHTML = html;

    var partsHost = document.getElementById('guideParts');
    if (partsHost && rules) {
      ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'hat', 'jacket'].forEach(function (p) {
        var box = rules.box ? rules.box(p) : null;
        var label = (rules.PART_LABEL && rules.PART_LABEL[p]) || p;
        var chip = U.el('div', { class: 'part-chip', 'data-part': p });
        var sw = U.el('span', { class: 'swatch' });
        var name = U.el('span', null, [label]);
        var id = U.el('span', { class: 'pid' }, [p]);
        chip.appendChild(sw); chip.appendChild(name); chip.appendChild(id);
        if (box && box.min) {
          chip.title = '3D 盒 位置=[' + box.min.join(', ') + '] 尺寸=[' + box.size.join(', ') + ']';
        }
        chip.addEventListener('click', function () {
          if (document.getElementById('partVis')) {
            var btn = document.querySelector('#partVis button[data-part="' + p + '"]');
            if (btn) btn.click();
          }
        });
        // 用贴图正面区域的主色做色块
        if (box && box.faces && box.faces.front && S.model) {
          var f = box.faces.front.px;
          var dom = U.dominantColors(S.model.data, S.model.width, f[0], f[1], f[2], f[3], 1);
          if (dom.length && dom[0].color) {
            var c = dom[0].color.split(',').map(Number);
            sw.style.background = U.rgbaToCss([c[0], c[1], c[2], 255]);
          }
        }
        partsHost.appendChild(chip);
      });
    }
  }

  /* ===================== 模型 / 预览同步 ===================== */

  function skinSnapshotForRenderer() {
    if (!S.model) return null;
    return { width: S.model.width, height: S.model.height, data: S.model.data };
  }

  function pushSkinToRenderer() {
    if (!S.renderer) return;
    var snap = skinSnapshotForRenderer();
    if (snap) S.renderer.setSkin(snap, S.model.format);
  }

  function onModelChanged(info) {
    pushSkinToRenderer();
    updateUndoButtons();
    updateFootInfo();
    buildGuideThrottled();
  }

  var guideTimer = null;
  function buildGuideThrottled() {
    if (guideTimer) return;
    guideTimer = setTimeout(function () { guideTimer = null; buildGuide(); }, 400);
  }

  function updateUndoButtons() {
    var u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
    if (u) u.disabled = !(S.model && S.model.canUndo && S.model.canUndo());
    if (r) r.disabled = !(S.model && S.model.canRedo && S.model.canRedo());
  }

  function updateFootInfo() {
    var el = document.getElementById('footInfo');
    if (!el || !S.model) return;
    var st = S.model.stats();
    el.textContent = '贴图 ' + S.model.width + '×' + S.model.height + '（' + S.model.format + '）· 不透明像素 ' +
      st.opaque + ' / ' + st.total + ' · 缩放 ' + (S.editor ? S.editor.getZoom() : '?') + '×';
  }

  function updateCursorHint(region) {
    var el = document.getElementById('cursorHint');
    if (!el) return;
    if (!region) { el.textContent = '把鼠标移到画布上，这里会告诉你这个像素是哪个部位'; return; }
    var face = (MCSKIN.rules.FACE_LABEL && MCSKIN.rules.FACE_LABEL[region.face]) || region.face;
    var layer = region.layer === 'outer' ? '外层面' : '基础层';
    var box = '';
    if (region.overlaps && region.overlaps.length > 1) box = '（与 ' + region.overlaps.filter(function (o) { return o !== region.boxId; }).join('、') + ' 共用像素）';
    el.textContent = '👉 ' + region.label + ' · ' + face + ' · ' + layer + box;
  }

  /* ===================== 载入 / 保存 ===================== */

  function loadImageFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
          toast('这个文件是 ' + img.width + '×' + img.height + '，不是 64×64 或 64×32 的皮肤贴图；仍按左上角 64×64 区域载入。', true);
        }
        var w = Math.min(img.width, 64);
        var h = img.height === 32 ? 32 : 64;
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        var imgData = ctx.getImageData(0, 0, w, h);
        setNewModel(w, h, imgData.data, file.name);
      };
      img.onerror = function () { toast('图片解析失败：' + file.name, true); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('文件读取失败', true); };
    reader.readAsDataURL(file);
  }

  function setNewModel(w, h, data, label) {
    if (S.editor) S.editor.setModel(null);
    var m = MCSKIN.model.create(w, h);
    m.loadImageData({ width: w, height: h, data: data });
    S.model = m;
    if (S.editor) { S.editor.setModel(m); S.editor.redraw(); }
    pushSkinToRenderer();
    updateUndoButtons();
    updateFootInfo();
    buildGuide();
    var badge = document.getElementById('canvasBadge');
    if (badge) badge.textContent = w + '×' + h + (h === 32 ? '（旧版）' : '');
    toast('已载入 ' + (label || (w + '×' + h)));
  }

  function newSkin(legacy) {
    var m;
    if (legacy) {
      m = MCSKIN.model.create(64, 32);
      // 用默认皮肤的左上象限内容（把 64×64 的默认皮肤降级成 64×32 观感）
      var def = MCSKIN.rules.defaultSkin();
      for (var y = 0; y < 32; y++) {
        for (var x = 0; x < 64; x++) {
          var px = U.getPixel(def.data, 64, x, y);
          m.setPixel(x, y, px, { record: false });
        }
      }
      m.clearHistory && m.clearHistory();
    } else {
      m = MCSKIN.model.create(64, 64);
      var d2 = MCSKIN.rules.defaultSkin();
      m.loadImageData(d2);
    }
    S.model = m;
    if (S.editor) { S.editor.setModel(m); S.editor.redraw(); }
    pushSkinToRenderer();
    updateUndoButtons();
    updateFootInfo();
    buildGuide();
    var badge = document.getElementById('canvasBadge');
    if (badge) badge.textContent = m.width + '×' + m.height + (m.format === 'legacy' ? '（旧版）' : '');
    toast('已新建 ' + m.width + '×' + m.height + ' 皮肤');
  }

  function saveSkin(legacy) {
    if (!S.model) return;
    if (!legacy) {
      U.download('my-skin-64x64.png', U.dataToDataURL(S.model.width, S.model.height, S.model.data));
      toast('已导出 my-skin-64x64.png');
      return;
    }
    // 旧版 64×32：取左上 64×32 区域（与官方 64×32 布局一致）
    var w = 64, h = 32;
    var modern = S.model.toModern();
    var out = U.blankData(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        U.setPixel(out, w, x, y, U.getPixel(modern.data, modern.width, x, y));
      }
    }
    U.download('my-skin-64x32.png', U.dataToDataURL(w, h, out));
    toast('已导出 my-skin-64x32.png（左上 64×32 区域）');
  }

  /* ===================== 控件绑定 ===================== */

  function bindControls() {
    function on(id, evt, fn) {
      var e = document.getElementById(id);
      if (e) e.addEventListener(evt, fn);
    }

    on('btnNew', 'click', function () { newSkin(false); });
    on('btnNewLegacy', 'click', function () { newSkin(true); });
    on('btnOpen', 'click', function () { document.getElementById('fileInput').click(); });
    on('btnSave', 'click', function () { saveSkin(false); });
    on('btnSaveLegacy', 'click', function () { saveSkin(true); });
    on('btnShot', 'click', function () {
      if (!S.renderer) { toast('3D 预览不可用，无法导出截图', true); return; }
      try {
        U.download('skin-3d-preview.png', S.renderer.screenshot());
        toast('已导出 skin-3d-preview.png');
      } catch (e) { toast('截图失败：' + e.message, true); }
    });
    on('fileInput', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) loadImageFile(f);
      e.target.value = '';
    });

    on('btnUndo', 'click', function () { if (S.model && S.model.undo()) { afterHistory(); } });
    on('btnRedo', 'click', function () { if (S.model && S.model.redo()) { afterHistory(); } });

    on('colorInput', 'input', function (e) {
      var c = U.hexToRgba(e.target.value, S.alpha);
      setColor(c, true);
    });
    // 十六进制颜色：输入满 6 位即实时生效并同步色块；失焦时非法输入回退
    on('hexInput', 'input', function (e) {
      var t = String(e.target.value || '').trim();
      if (/^#?[0-9a-f]{6}$/i.test(t)) {
        var c = U.hexToRgba(t, S.alpha);
        setColor(c, false);
        e.target.value = U.rgbToHex(c);              // 归一化为 #rrggbb
        var ci = document.getElementById('colorInput');
        if (ci) ci.value = U.rgbToHex(c);
      }
    });
    on('hexInput', 'change', function (e) {
      var c = U.hexToRgba(e.target.value, S.alpha);
      if (!c) { e.target.value = U.rgbToHex(S.color); return; }
      setColor(c, true);
    });

    on('brushRange', 'input', function (e) {
      var v = parseInt(e.target.value, 10);
      document.getElementById('brushOut').textContent = v;
      if (S.editor) S.editor.setBrushSize(v);
    });

    on('alphaRange', 'input', function (e) {
      S.alpha = parseInt(e.target.value, 10);
      document.getElementById('alphaOut').textContent = S.alpha;
      setColor([S.color[0], S.color[1], S.color[2], S.alpha], false);
    });

    on('zoomRange', 'input', function (e) {
      var v = parseInt(e.target.value, 10);
      document.getElementById('zoomOut').textContent = v;
      if (S.editor) S.editor.setZoom(v);
      updateFootInfo();
    });

    function toggle(id, initial, fn) {
      var b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle('on', !!initial);
      b.addEventListener('click', function () {
        var on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        fn(on);
      });
    }

    toggle('tglGrid', true, function (on) { if (S.editor) S.editor.setGrid(on); });
    toggle('tglOverlay', true, function (on) { if (S.editor) S.editor.setOverlayVisible(on); });
    toggle('tglSymmetry', false, function (on) { if (S.editor) S.editor.setSymmetry(on ? 'x' : 'none'); });
    toggle('tglBase', true, function (on) {
      S.baseVisible = on;
      if (S.editor) S.editor.setLayerVisible('base', on);
      if (S.renderer) S.renderer.setShowBase(on);
    });
    toggle('tglOuter', true, function (on) {
      S.outerVisible = on;
      if (S.editor) S.editor.setLayerVisible('outer', on);
      if (S.renderer) S.renderer.setShowLayer(on);
    });
    toggle('tglAuto', true, function (on) { if (S.renderer) S.renderer.setAutoRotate(on); });
    toggle('tglOuter3d', true, function (on) { if (S.renderer) S.renderer.setShowLayer(on); });
    toggle('tglLight', true, function (on) { if (S.renderer) S.renderer.setLighting(on); });
    toggle('tglGround', false, function (on) { if (S.renderer) S.renderer.setShowGround(on); });

    on('layerSelect', 'change', function (e) {
      if (S.editor) S.editor.setActiveLayer(e.target.value);
    });

    on('animSelect', 'change', function (e) { if (S.renderer) S.renderer.setAnimation(e.target.value); });

    on('btnRotL', 'click', function () { nudgeRot(-15, 0); });
    on('btnRotR', 'click', function () { nudgeRot(15, 0); });
    on('btnRotU', 'click', function () { nudgeRot(0, -8); });
    on('btnRotD', 'click', function () { nudgeRot(0, 8); });
    on('btnReset', 'click', function () {
      if (!S.renderer) return;
      S.renderer.setRotation(20, 10);
      S.renderer.setZoom(1);
      updateHud();
    });

    // 拖放皮肤文件
    ['dragover', 'drop'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          loadImageFile(e.dataTransfer.files[0]);
        }
      });
    });

    // 快捷键
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) { if (S.model && S.model.redo()) afterHistory(); }
        else if (S.model && S.model.undo()) afterHistory();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); if (S.model && S.model.redo()) afterHistory(); return; }
      if (e.ctrlKey || e.metaKey) return;
      var map = { p: 'pencil', b: 'pencil', e: 'eraser', f: 'fill', i: 'picker', l: 'line', r: 'rect' };
      if (map[k]) { setTool(map[k]); return; }
      if (k >= '1' && k <= '6') { setTool(S.tools[parseInt(k, 10) - 1].id); }
      if (k === 'g') { var b = document.getElementById('tglGrid'); if (b) b.click(); }
    });
  }

  function afterHistory() {
    // editor 若提供 notifyChange 就走它（会重绘并广播 change），否则退回 redraw
    if (S.editor) {
      if (typeof S.editor.notifyChange === 'function') S.editor.notifyChange('undo');
      else S.editor.redraw();
    }
    pushSkinToRenderer();
    updateUndoButtons();
    updateFootInfo();
  }

  function nudgeRot(dy, dp) {
    if (!S.renderer) return;
    var r = S.renderer.getRotation();
    S.renderer.setRotation(r.yaw + dy, r.pitch + dp);
    updateHud();
  }

  function updateHud() {
    var hud = document.getElementById('glHud');
    if (!hud || !S.renderer) return;
    var r = S.renderer.getRotation();
    hud.textContent = 'yaw ' + Math.round(r.yaw) + '° / pitch ' + Math.round(r.pitch) + '° · 缩放 ' +
      (Math.round(S.renderer.getZoom() * 100) / 100) + '×';
  }

  function setColor(rgba, syncInputs) {
    S.color = rgba;
    if (S.editor) S.editor.setColor(rgba);
    if (syncInputs) {
      var ci = document.getElementById('colorInput');
      var hi = document.getElementById('hexInput');
      if (ci) ci.value = U.rgbToHex(rgba);
      if (hi) hi.value = U.rgbToHex(rgba);
    }
  }

  /* ===================== 测试报告 ===================== */

  function runAllSelfTests() {
    var mods = ['util', 'rules', 'model', 'renderer', 'editor'];
    var pass = [], fail = [];
    mods.forEach(function (name) {
      var mod = MCSKIN[name];
      if (mod && typeof mod._selfTest === 'function') {
        try { mod._selfTest(); } catch (e) { fail.push(name + '._selfTest 抛异常: ' + e.message); }
      }
      var t = MCSKIN.tests && MCSKIN.tests[name];
      if (!t) { fail.push(name + ': 未提供自测结果'); return; }
      (t.pass || []).forEach(function (p) { pass.push(name + ': ' + p); });
      (t.fail || []).forEach(function (f) { fail.push(name + ': ' + f); });
    });
    return { pass: pass, fail: fail, modules: MCSKIN.tests || {} };
  }

  function renderTestReport() {
    var el = document.getElementById('testReport');
    if (!el) return;
    var r = runAllSelfTests();
    MCSKIN.selfTestReport = r;
    el.textContent = '自测 ' + r.pass.length + ' 通过 / ' + r.fail.length + ' 失败';
    el.className = r.fail.length ? 'bad' : 'good';
    el.title = r.fail.length ? r.fail.join('\n') : r.pass.slice(0, 12).join('\n') + (r.pass.length > 12 ? '\n…' : '');
    // 供无头浏览器读取
    var dump = document.createElement('script');
    dump.type = 'application/json';
    dump.id = 'selftest-json';
    dump.textContent = JSON.stringify({ pass: r.pass.length, fail: r.fail.length, failures: r.fail, passed: r.pass });
    var old = document.getElementById('selftest-json');
    if (old) old.remove();
    document.body.appendChild(dump);
    return r;
  }

  /* ===================== 初始化 ===================== */

  /* 构建版本：底栏显示，用于确认用户浏览器没有缓存旧 JS（改代码时 +1） */
  var BUILD_ID = 'v1.3 · 2026-09-30';

  function init() {
    var verEl = document.getElementById('footVersion');
    if (verEl) verEl.textContent = BUILD_ID;

    try {
      require_('util', MCSKIN.util);
      require_('rules', MCSKIN.rules);
      require_('model', MCSKIN.model);
    } catch (e) {
      CRASH = e.message;
      setStatus('初始化失败：' + CRASH);
      var el = document.getElementById('testReport');
      if (el) { el.textContent = '模块缺失：' + CRASH; el.className = 'bad'; }
      return;
    }

    buildToolButtons();
    buildPartButtons();
    bindControls();

    // 模型
    S.model = MCSKIN.model.create(64, 64);
    try { S.model.loadImageData(MCSKIN.rules.defaultSkin()); } catch (e) { /* 忽略 */ }

    // 3D 预览（可能失败，不能影响其它部分）
    if (MCSKIN.renderer) {
      try {
        S.renderer = MCSKIN.renderer.create(document.getElementById('glCanvas'), {
          // 用户一拖动/滚轮就关掉自动旋转：否则它会持续跟手抢角度，
          // 表现出来就是"转不动、不听指挥、无法自由拖动"
          onUserInteract: function () {
            var b = document.getElementById('tglAuto');
            if (b && b.classList.contains('on')) {
              b.classList.remove('on');
              if (S.renderer) S.renderer.setAutoRotate(false);
            }
          }
        });
        S.renderer.setSkin(skinSnapshotForRenderer(), S.model.format);
        S.renderer.setAutoRotate(true);
        S.renderer.setAnimation('idle');
        // renderer 用 ok / glError 表示 WebGL 是否可用（见 renderer3d.js）
        S.glOk = (S.renderer.ok !== false) && !S.renderer.glError;
      } catch (e) {
        S.glOk = false;
        var errEl = document.getElementById('glError');
        if (errEl) { errEl.hidden = false; errEl.textContent = '3D 预览初始化失败：' + e.message; }
      }
      if (!S.glOk) {
        var e2 = document.getElementById('glError');
        if (e2 && !e2.textContent) { e2.hidden = false; e2.textContent = '当前浏览器不支持 WebGL，3D 预览不可用。2D 绘制仍可正常使用。'; }
      }
    } else {
      var e3 = document.getElementById('glError');
      if (e3) { e3.hidden = false; e3.textContent = '缺少 js/renderer3d.js，3D 预览不可用。'; }
    }

    // 2D 编辑器
    if (MCSKIN.editor) {
      S.editor = MCSKIN.editor.create(document.getElementById('editorCanvas'), {});
      S.editor.setModel(S.model);
      S.editor.setColor(S.color);
      S.editor.setZoom(9);
      S.editor.setGrid(true);
      S.editor.setOverlayVisible(true);
      S.editor.on('change', function () { onModelChanged(); });
      S.editor.on('hover', function (e) { updateCursorHint(e && e.region); });
      S.editor.on('cursor', function (e) { updateCursorHint(e && e.region); });
      S.editor.on('pick', function (e) {
        // editor 发出的字段是 rgba（color 为别名），两者都认
        var c = e && (e.rgba || e.color);
        if (!c) return;
        setColor([c[0], c[1], c[2], S.alpha], true);
        toast('已吸取颜色 ' + U.rgbToHex(c) + (e.region && e.region.label ? ' · ' + e.region.label : ''));
      });
      S.editor.redraw();
    } else {
      toast('缺少 js/editor2d.js，无法绘制', true);
    }

    updateUndoButtons();
    updateFootInfo();
    buildGuide();
    updateHud();

    var r = renderTestReport();
    var parts = ['2D 编辑器', '3D 预览'];
    setStatus('就绪 · ' + parts.join(' + ') + ' · 自测 ' + r.pass.length + '/' + (r.pass.length + r.fail.length) + ' 通过' +
      (r.fail.length ? '（有失败项）' : ''));

    // 定时刷新 HUD（视角可能被鼠标改变）
    setInterval(updateHud, 500);

    MCSKIN.shellApi = {
      newSkin: newSkin,
      loadImageFile: loadImageFile,
      saveSkin: saveSkin,
      setTool: setTool,
      setColor: setColor,
      runAllSelfTests: runAllSelfTests,
      renderTestReport: renderTestReport,
      state: S
    };
  }

  function _selfTest() {
    ok('页面存在 editorCanvas', !!document.getElementById('editorCanvas'));
    ok('页面存在 glCanvas', !!document.getElementById('glCanvas'));
    ok('script 顺序：util→rules→model→renderer3d→editor2d→shell', (function () {
      var srcs = U.$$('script[src]').map(function (s) { return s.getAttribute('src'); });
      var want = ['js/util.js', 'js/rules.js', 'js/model.js', 'js/renderer3d.js', 'js/editor2d.js', 'js/shell.js'];
      return want.every(function (w, i) { return srcs[i] === w; });
    })());
    ok('初始化未崩溃', !CRASH);
    MCSKIN.tests = MCSKIN.tests || {};
    MCSKIN.tests.shell = tests;
    return tests;
  }

  MCSKIN.shell = { VERSION: '1.0', init: init, _selfTest: _selfTest };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
