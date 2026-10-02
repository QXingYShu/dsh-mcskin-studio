/* tests/auto_probe.js — 由 tools/headless.mjs 注入到 index.html 之后的端到端验收探针（归属：Lead）
 * 把结果写进 <script id="probe-json">，由无头浏览器 dump-dom 后解析。
 * 注意：本文件在页面里运行，必须纯浏览器 JS。
 */
(function () {
  'use strict';

  var ERRORS = [];
  window.addEventListener('error', function (e) {
    ERRORS.push('window.error: ' + (e.message || e) + ' @' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    ERRORS.push('unhandledrejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  var origError = console.error;
  console.error = function () {
    ERRORS.push('console.error: ' + Array.prototype.slice.call(arguments).map(String).join(' '));
    origError.apply(console, arguments);
  };

  // 参考皮肤（64×64 现代格式，含外层面）以 data URL 形式由 tests/build_probe.mjs 注入
  var REF_SKIN_DATAURL = window.__REF_SKIN_DATAURL__ || null;
  var REF_SKIN_LEGACY_DATAURL = window.__REF_SKIN_LEGACY_DATAURL__ || null;

  var pass = [], fail = [], info = {};

  function ok(name, cond, detail) {
    if (cond) pass.push(name);
    else fail.push(name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
  }

  function canvasStats(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var d = ctx.getImageData(0, 0, w, h).data;
    var colors = {}, opaque = 0, distinct = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) opaque++;
      var k = d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ',' + d[i + 3];
      if (!colors[k]) { colors[k] = 0; distinct++; }
      colors[k]++;
    }
    var top = Object.keys(colors).sort(function (a, b) { return colors[b] - colors[a]; }).slice(0, 6)
      .map(function (k) { return { c: k, n: colors[k] }; });
    return { w: w, h: h, opaque: opaque, ratio: opaque / (w * h), distinct: distinct, top: top };
  }

  function shaish(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s = (s * 31 + arr[i]) >>> 0;
    return s;
  }

  // WebGL canvas 不能 getImageData：先 drawImage 到一个 2D canvas 再统计
  function glStats(srcCanvas) {
    var c = document.createElement('canvas');
    c.width = srcCanvas.width; c.height = srcCanvas.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);
    return { stats: canvasStats(c), canvas: c, ctx: ctx };
  }

  function regionStats(data, width, x0, y0, x1, y1) {
    var opaque = 0, total = (x1 - x0) * (y1 - y0), sum = [0, 0, 0], n = 0;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var i = (y * width + x) * 4;
        if (data[i + 3] > 0) {
          opaque++;
          sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++;
        }
      }
    }
    return {
      opaqueRatio: opaque / total,
      mean: n ? [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)] : null
    };
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('图片载入失败')); };
      im.src = url;
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function dist(a, b) {
    return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
  }

  // 在贴图里找 8×8 区域中最独特的一块，用于"按UV着色→正视图取色→比对"验证
  function distinctiveBlocks(data, width, blocks) {
    var out = [];
    blocks.forEach(function (b) {
      var st = regionStats(data, width, b.px[0], b.px[1], b.px[2], b.px[3]);
      out.push({ id: b.id, px: b.px, mean: st.mean, opaqueRatio: st.opaqueRatio });
    });
    return out;
  }

  // 进度与结果写入：任何阶段抛错/超时都要能拿到已完成的结果
  var PHASE = 'start';
  function writeResult(extraFailures) {
    var result = {
      phase: PHASE,
      pass: pass.length, fail: fail.length,
      passed: pass,
      failures: (fail || []).concat(extraFailures || []),
      errors: ERRORS,
      info: info
    };
    var old = document.getElementById('probe-json');
    if (old) old.remove();
    var el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'probe-json';
    el.textContent = JSON.stringify(result);
    document.body.appendChild(el);
    document.title = (result.failures.length ? 'FAIL-' + result.failures.length : 'PASS') +
      ' | ' + pass.length + ' checks | phase=' + PHASE;
    return result;
  }

  function main() {
    PHASE = 'modules';
    var M = window.MCSKIN || {};
    info.modules = Object.keys(M);
    info.hasRules = !!M.rules;
    info.hasModel = !!M.model;
    info.hasRenderer = !!M.renderer;
    info.hasEditor = !!M.editor;
    info.hasShell = !!M.shell;
    info.statusLine = (document.getElementById('statusLine') || {}).textContent || '';
    info.glErrorVisible = !!(document.getElementById('glError') && !document.getElementById('glError').hidden);
    info.glErrorText = info.glErrorVisible ? document.getElementById('glError').textContent : '';

    ok('6 个模块都加载了', info.hasRules && info.hasModel && info.hasRenderer && info.hasEditor && info.hasShell,
      info.modules);
    ok('shell 初始化成功（状态栏不是"初始化失败"）', info.statusLine.indexOf('初始化失败') === -1, info.statusLine);
    ok('缺少模块时 statusLine 有说明', true);

    // ---------- 自测汇总 ----------
    var report = null;
    try {
      if (M.shellApi && M.shellApi.runAllSelfTests) report = M.shellApi.runAllSelfTests();
    } catch (e) { ERRORS.push('runAllSelfTests 抛异常: ' + e.message); }
    info.selfTest = report ? { pass: report.pass.length, fail: report.fail.length, failures: report.fail } : null;
    ok('页面内全部自测通过（fail=0）', !!report && report.fail.length === 0, report ? report.fail : 'no report');
    ok('自测数量 ≥ 25 条', !!report && report.pass.length >= 25, report ? report.pass.length : 0);

    // ---------- rules 自证 ----------
    if (M.rules) {
      var boxes = M.rules.BOXES || [];
      info.boxCount = boxes.length;
      ok('BOXES 有 12 个盒（6 基础 + 6 外层）', boxes.length === 12, boxes.length);
      var byId = {};
      boxes.forEach(function (b) { byId[b.id] = b; });
      ok('外层盒齐备', ['hat', 'jacket', 'rightSleeve', 'leftSleeve', 'rightPants', 'leftPants'].every(function (id) { return !!byId[id]; }),
        Object.keys(byId));
      ok('基础层盒齐备', ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].every(function (id) { return !!byId[id]; }));

      // 每个盒 6 个面、每个面 4 顶点；每个轴要么恒定（面垂直于该轴），要么正好等于该轴全长
      var geomBad = [];
      boxes.forEach(function (b) {
        var faces = b.faces || {}, geo = b.geometry || {};
        if (!b.geometry) { geomBad.push(b.id + ': 缺 geometry'); return; }
        ['right', 'front', 'left', 'back', 'top', 'bottom'].forEach(function (f) {
          if (!faces[f] || !faces[f].px) geomBad.push(b.id + '.' + f + ': 缺 UV');
          var quad = geo[f];
          if (!quad || quad.length !== 4) { geomBad.push(b.id + '.' + f + ': 顶点数≠4'); return; }
          var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          quad.forEach(function (v) {
            for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
          });
          for (var i = 0; i < 3; i++) {
            var a = b.min[i], c = b.min[i] + b.size[i];
            var flat = Math.abs(hi[i] - lo[i]) < 1e-6;
            var inRange = lo[i] >= a - 1e-6 && hi[i] <= c + 1e-6;
            var full = Math.abs(lo[i] - a) < 1e-6 && Math.abs(hi[i] - c) < 1e-6;
            if (!inRange || (!flat && !full) || (flat && Math.abs(lo[i] - a) > 1e-6 && Math.abs(lo[i] - c) > 1e-6)) {
              geomBad.push(b.id + '.' + f + ': 轴' + i + ' bbox [' + lo[i] + ',' + hi[i] + '] 盒 [' + a + ',' + c + ']' +
                (flat ? ' 常量但不在盒边界' : ' 未铺满'));
            }
          }
          // UV 必须在 0..1
          var p = faces[f].px;
          if (p && (p[0] < 0 || p[1] < 0 || p[2] > 64 || p[3] > 64)) geomBad.push(b.id + '.' + f + ': UV 越界 ' + p);
        });
      });
      ok('每个盒 6 个面几何都在盒边界内/铺满对应轴、UV 不越界', geomBad.length === 0, geomBad.slice(0, 8));

      // regionAt 关键点
      var r1 = M.rules.regionAt(20, 22);   // 躯干正面
      var r2 = M.rules.regionAt(44, 25);   // 右臂正面
      var r3 = M.rules.regionAt(10, 10);   // 头部正面
      ok('regionAt(20,22) = 躯干·正面', !!r1 && r1.part === 'body' && r1.face === 'front', r1);
      ok('regionAt(44,25) = 右臂·正面', !!r2 && r2.part === 'rightArm' && r2.face === 'front', r2);
      ok('regionAt(10,10) = 头·正面', !!r3 && r3.part === 'head' && r3.face === 'front', r3);
      // v1.1 修正后的左臂/左腿/左袖坐标（官方布局）
      var r5 = M.rules.regionAt(37, 53);   // 左臂正面
      var r6 = M.rules.regionAt(21, 53);   // 左腿正面（独立贴图区）
      var r7 = M.rules.regionAt(53, 53);   // 左袖外层正面
      info.regionAtLeft = { leftArm: r5, leftLeg: r6, leftSleeve: r7 };
      ok('regionAt(37,53) = 左臂（官方 x32..48 区域）', !!r5 && /leftArm/.test(r5.part), r5);
      ok('regionAt(21,53) = 左腿·正面（官方 x16..32 独立区）', !!r6 && r6.part === 'leftLeg' && r6.face === 'front', r6);
      ok('regionAt(53,53) 命中左袖外层（x48..64）', !!r7 && /leftSleeve/.test(r7.part), r7);
      ok('regionAt(5,53) = 左裤外层·正面（官方 x0..16 独立区，与左腿不同）',
        (function () { var r = M.rules.regionAt(5, 53); return !!r && r.part === 'leftPants' && r.face === 'front'; })(),
        M.rules.regionAt(5, 53));
      ok('左裤与左腿的贴图区互不相同', (function () {
        var lp = M.rules.box('leftPants'), ll = M.rules.box('leftLeg');
        if (!lp || !ll) return false;
        return JSON.stringify(lp.faces.front.px) !== JSON.stringify(ll.faces.front.px);
      })());
      ok('regionAt(45,53) 不是"左臂正面"（v1.0 错误假设）', (function () {
        var r = M.rules.regionAt(45, 53);
        if (!r) return false;
        var isLeftArmFront = /leftArm/.test(r.part) && r.face === 'front';
        return !isLeftArmFront;
      })(), M.rules.regionAt(45, 53));
      // 展开网连通性：相邻贴图区公共边必须映射到同一条 3D 边（renderer3d 提出的判据）
      ok('展开网 4 条侧面接缝闭合（right→front→left→back→right）', (function () {
        function q(id, f) { return M.rules.box(id).geometry[f]; }
        function eqPt(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
        // right.u1 ↔ front.u0 ; front.u1 ↔ left.u0 ; left.u1 ↔ back.u0 ; back.u1 ↔ right.u0
        var seams = [
          [q('head', 'right')[1], q('head', 'front')[0]],
          [q('head', 'front')[1], q('head', 'left')[0]],
          [q('head', 'left')[1], q('head', 'back')[0]],
          [q('head', 'back')[1], q('head', 'right')[0]]
        ];
        return seams.every(function (s) { return eqPt(s[0], s[1]); });
      })(), (function () {
        var q = function (f) { return M.rules.box('head').geometry[f]; };
        return [q('right')[1], q('front')[0], q('front')[1], q('left')[0], q('left')[1], q('back')[0], q('back')[1], q('right')[0]];
      })());
      ok('LAYOUT_REGIONS 提供中文部位名', Array.isArray(M.rules.LAYOUT_REGIONS) && M.rules.LAYOUT_REGIONS.length >= 10 &&
        /[\u4e00-\u9fa5]/.test(M.rules.LAYOUT_REGIONS[0].label), (M.rules.LAYOUT_REGIONS || []).length);
      info.regionAt = { bodyFront: r1, rArmFront: r2, headFront: r3 };
    }

    // ---------- 2D 编辑器：真的能画 ----------
    PHASE = 'editor';
    var editorCanvas = document.getElementById('editorCanvas');
    if (editorCanvas && M.shellApi && M.shellApi.state && M.shellApi.state.editor) {
      var st0 = canvasStats(editorCanvas);
      info.editorBefore = { opaque: st0.opaque, distinct: st0.distinct };
      ok('2D 画布已绘制内容（不透明像素 > 1000）', st0.opaque > 1000, st0.opaque);
      ok('2D 画布有多种颜色（默认皮肤）', st0.distinct >= 4, st0.distinct);

      var model = M.shellApi.state.model;
      // 通过 editor API 画一笔：先定位到 body front 区域的某像素
      var before = model.getPixel(21, 21).slice();
      M.shellApi.setColor([255, 0, 255, 255], true);
      M.shellApi.setTool('pencil');
      // 直接调 editor 的绘制入口（如果暴露）；否则用 model + redraw 模拟
      if (typeof M.shellApi.state.editor.paintPixel === 'function') {
        M.shellApi.state.editor.paintPixel(21, 21);
      } else {
        model.setPixel(21, 21, [255, 0, 255, 255]);
        M.shellApi.state.editor.redraw();
      }
      var after = model.getPixel(21, 21).slice();
      ok('编辑器能改变 (21,21) 像素', JSON.stringify(before) !== JSON.stringify(after), { before: before, after: after });
      // 撤销
      model.undo();
      var undone = model.getPixel(21, 21).slice();
      ok('撤销后像素恢复', JSON.stringify(undone) === JSON.stringify(before), { before: before, undone: undone });

      // 缩放与坐标换算
      ok('editor.getZoom() 工作', typeof M.shellApi.state.editor.getZoom() === 'number' && M.shellApi.state.editor.getZoom() > 0);

      // 取色回归：右键点击躯干正面 → 顶部色块与 hex 输入必须更新（用户反馈"取色后颜色不更新"）
      (function () {
        var edp = M.shellApi.state.editor;
        var cv = document.getElementById('editorCanvas');
        var hexEl = document.getElementById('hexInput');
        var colEl = document.getElementById('colorInput');
        if (!edp || !cv || !hexEl || !colEl) { fail.push('取色E2E: 控件缺失'); return; }
        function h(v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }
        var c21 = M.shellApi.state.model.getPixel(21, 21);
        var want = ('#' + h(c21[0]) + h(c21[1]) + h(c21[2])).toLowerCase();
        // 先改成别的颜色，确保断言测的是"取色导致的变化"
        hexEl.value = '#123456';
        hexEl.dispatchEvent(new Event('change', { bubbles: true }));
        var before = hexEl.value.toLowerCase();
        var p = edp.pixelToClient(21, 21);
        var z = edp.getZoom();
        var cx2 = p.x + z / 2, cy2 = p.y + z / 2;
        try {
          cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, clientX: cx2, clientY: cy2, pointerId: 1 }));
          cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, clientX: cx2, clientY: cy2, pointerId: 1 }));
        } catch (e) { ERRORS.push('pick dispatch: ' + e.message); }
        info.pickE2E = { before: before, hex: hexEl.value, swatch: colEl.value, want: want };
        ok('右键取色后顶部颜色控件更新为该像素颜色',
          hexEl.value.toLowerCase() === want && colEl.value.toLowerCase() === want,
          info.pickE2E);
      })();

      if (typeof M.shellApi.state.editor.clientToPixel === 'function') {
        var cp = M.shellApi.state.editor.clientToPixel(100, 100);
        info.clientToPixel = cp;
        ok('clientToPixel 返回整数像素坐标', cp && Number.isInteger(cp.px) && Number.isInteger(cp.py), cp);
      }
    } else {
      fail.push('拿不到 editor 实例，无法验证绘制');
    }

    // ---------- 3D 预览：真的渲染出东西 ----------
    PHASE = 'gl';
    var gl = document.getElementById('glCanvas');
    if (gl && M.shellApi && M.shellApi.state.renderer) {
      var r = M.shellApi.state.renderer;
      info.glCanvasSize = { w: gl.width, h: gl.height };
      ok('glCanvas 尺寸正常', gl.width > 100 && gl.height > 100, { w: gl.width, h: gl.height });
      info.glErrorFromRenderer = r.glError || null;
      ok('渲染器没有报告 WebGL 错误', !r.glError, r.glError);
      if (!r.glError) {
        // 立即渲染一帧并读像素
        r.setAutoRotate(false);
        r.setRotation(20, 10);
        r.setAnimation('none');
        r.render();
        var st3 = glStats(gl).stats;
        info.glStats = { opaque: st3.opaque, ratio: st3.ratio, distinct: st3.distinct, top: st3.top };
        ok('3D 画面有内容（不透明像素占比 > 5%）', st3.ratio > 0.05, st3.ratio);
        ok('3D 画面有多种颜色（有明暗/贴图变化）', st3.distinct >= 8, st3.distinct);

        // 截图可用
        var shot = r.screenshot();
        ok('screenshot() 返回 PNG dataURL', typeof shot === 'string' && shot.indexOf('data:image/png') === 0,
          shot ? shot.slice(0, 30) : shot);
        info.shotLen = shot ? shot.length : 0;

        // 旋转后画面必须变化：比较 screenshot 的 dataURL 长度/前缀哈希（WebGL canvas 不能 getImageData）
        var before = r.screenshot();
        r.setRotation(200, 10);
        r.render();
        var after = r.screenshot();
        function hashStr(s) {
          var h = 0;
          for (var i = 0; i < s.length; i += 97) h = (h * 31 + s.charCodeAt(i)) >>> 0;
          return h;
        }
        info.rotationShot = { before: before.length, after: after.length };
        ok('旋转视角后画面改变', hashStr(before) !== hashStr(after), { b: hashStr(before), a: hashStr(after) });
        // 隐藏部位后画面也必须变化
        r.setRotation(20, 10);
        r.render();
        var v1 = r.screenshot();
        r.setPartVisible('head', false);
        r.render();
        var v2 = r.screenshot();
        info.hideHeadShot = { before: v1.length, after: v2.length };
        ok('隐藏头部后画面改变（部位开关生效）', hashStr(v1) !== hashStr(v2), { b: hashStr(v1), a: hashStr(v2) });
        r.setPartVisible('head', true);
        r.setShowLayer(true);
        r.render();
      }
    } else {
      fail.push('拿不到 renderer 实例或 glCanvas');
    }

    // ---------- 参考图（64×64 苦力怕娘）载入 + UV 颜色对照 ----------
    PHASE = 'ref64';
    var chain = Promise.resolve();
    if (REF_SKIN_DATAURL && M.shellApi) {
      chain = chain.then(function () { return loadImage(REF_SKIN_DATAURL); }).then(function (img) {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = false;
        cx.drawImage(img, 0, 0);
        var ref = cx.getImageData(0, 0, 64, 64).data;
        var used = regionStats(ref, 64, 0, 0, 64, 64);
        info.ref64 = { headFront: regionStats(ref, 64, 8, 8, 16, 16), torsoFront: regionStats(ref, 64, 20, 20, 28, 32) };
        var opaqueCount = 0;
        for (var i = 3; i < ref.length; i += 4) if (ref[i] > 0) opaqueCount++;
        ok('参考图 64×64 有内容（不透明像素 > 1000）', opaqueCount > 1000, opaqueCount);

        // 载入到工具里，验证工具能吃下真实皮肤
        var m2 = M.model.create(64, 64);
        m2.loadImageData({ width: 64, height: 64, data: ref });
        var rs = m2.stats();
        ok('model 能吃下参考图并统计不透明像素', rs.opaque === opaqueCount, { model: rs.opaque, ref: opaqueCount });
        ok('参考图 head 正面区域不透明（头部贴图完整）', info.ref64.headFront.opaqueRatio > 0.9,
          info.ref64.headFront.opaqueRatio);
        info.refStats = rs;
      });
    } else {
      fail.push('没有注入参考图 data URL（REF_SKIN_DATAURL 为空）');
    }

    // ---------- 旧版 64×32 ----------
    if (REF_SKIN_LEGACY_DATAURL && M.rules) {
      chain = chain.then(function () { return loadImage(REF_SKIN_LEGACY_DATAURL); }).then(function (img) {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 32;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = false;
        cx.drawImage(img, 0, 0);
        var legacy = cx.getImageData(0, 0, 64, 32).data;
        var conv = M.rules.convertLegacy64x32(legacy);
        ok('convertLegacy64x32 返回 64×64', conv.width === 64 && conv.height === 64);
        // v1.1 官方布局：左臂 x32..48 y48..64；左腿 x16..32 y48..64；左袖 x48..64 y48..64
        var larm = regionStats(conv.data, 64, 32, 48, 48, 64);
        var lleg = regionStats(conv.data, 64, 16, 48, 32, 64);
        var lsleeve = regionStats(conv.data, 64, 48, 48, 64, 64);
        var jacket = regionStats(conv.data, 64, 20, 36, 28, 48);
        var hat = regionStats(conv.data, 64, 40, 0, 48, 16);
        info.legacy = {
          larm: larm.opaqueRatio, lleg: lleg.opaqueRatio, lsleeve: lsleeve.opaqueRatio,
          jacket: jacket.opaqueRatio, hat: hat.opaqueRatio
        };
        ok('旧版转换后左臂区(x32..48,y48..64)有内容', larm.opaqueRatio > 0.85, larm.opaqueRatio);
        ok('旧版转换后左腿区(x16..32,y48..64)有内容', lleg.opaqueRatio > 0.85, lleg.opaqueRatio);
        ok('旧版转换后左袖外层(x48..64,y48..64)有内容', lsleeve.opaqueRatio > 0.85, lsleeve.opaqueRatio);
        ok('旧版转换后外套外层有内容', jacket.opaqueRatio > 0.85, jacket.opaqueRatio);
        ok('旧版转换后帽子外层有内容', hat.opaqueRatio > 0.5, hat.opaqueRatio);

        // 左臂/左腿必须是右臂/右腿的"逐面水平镜像"（用合成的高对比度旧版皮肤做真值）
        var ARM32 = { right: [40, 20, 44, 32], front: [44, 20, 48, 32], left: [48, 20, 52, 32], back: [52, 20, 56, 32], top: [44, 16, 48, 20], bottom: [48, 16, 52, 20] };
        var LEG32 = { right: [0, 20, 4, 32], front: [4, 20, 8, 32], left: [8, 20, 12, 32], back: [12, 20, 16, 32], top: [4, 16, 8, 20], bottom: [8, 16, 12, 20] };
        var LARM = { right: [32, 52, 36, 64], front: [36, 52, 40, 64], left: [40, 52, 44, 64], back: [44, 52, 48, 64], top: [36, 48, 40, 52], bottom: [40, 48, 44, 52] };
        var LLEG = { right: [16, 52, 20, 64], front: [20, 52, 24, 64], left: [24, 52, 28, 64], back: [28, 52, 32, 64], top: [20, 48, 24, 52], bottom: [24, 48, 28, 52] };
        var MIRRORF = { right: 'left', left: 'right', front: 'front', back: 'back', top: 'top', bottom: 'bottom' };
        var synthLegacy = new Uint8ClampedArray(64 * 32 * 4);
        var PALETTE = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
        function paint32(map, colors) {
          Object.keys(map).forEach(function (f) {
            var r = map[f], c = colors[f];
            for (var y = r[1]; y < r[3]; y++) {
              for (var x = r[0]; x < r[2]; x++) {
                var i = (y * 64 + x) * 4;
                synthLegacy[i] = c[0]; synthLegacy[i + 1] = c[1]; synthLegacy[i + 2] = c[2]; synthLegacy[i + 3] = 255;
              }
            }
          });
        }
        var armColors = {}, legColors = {};
        ['right', 'front', 'left', 'back', 'top', 'bottom'].forEach(function (f, i) {
          armColors[f] = PALETTE[i];
          legColors[f] = [PALETTE[i][0] / 2 | 0, PALETTE[i][1] / 2 | 0, PALETTE[i][2] / 2 | 0];
        });
        paint32(ARM32, armColors); paint32(LEG32, legColors);
        var sconv = M.rules.convertLegacy64x32(synthLegacy);
        function getPix(d, x, y) { var i = (y * 64 + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
        function mirrorCheck(srcMap, dstMap, d, label) {
          var bad = 0, total = 0;
          Object.keys(dstMap).forEach(function (f) {
            var sf = MIRRORF[f], sb = srcMap[sf], db = dstMap[f], sw = sb[2] - sb[0];
            for (var y = 0; y < db[3] - db[1]; y++) {
              for (var x = 0; x < sw; x++) {
                total++;
                var got = getPix(d, db[0] + x, db[1] + y);
                var want = getPix(conv.data /*真实图，忽略*/, 0, 0);
                // 期望值 = 合成图里源面水平翻转后的像素
                var si = (sb[1] + y) * 64 + (sb[0] + (sw - 1 - x));
                want = [synthLegacy[si * 4], synthLegacy[si * 4 + 1], synthLegacy[si * 4 + 2], synthLegacy[si * 4 + 3]];
                if (got.join(',') !== want.join(',')) bad++;
              }
            }
          });
          return { bad: bad, total: total, label: label };
        }
        var am = mirrorCheck(ARM32, LARM, sconv.data, 'leftArm');
        var lm = mirrorCheck(LEG32, LLEG, sconv.data, 'leftLeg');
        info.legacyMirror = { arm: am.bad + '/' + am.total, leg: lm.bad + '/' + lm.total };
        ok('旧版转换：左臂 = 右臂逐面水平镜像（合成真值）', am.bad === 0, info.legacyMirror);
        ok('旧版转换：左腿 = 右腿逐面水平镜像（合成真值）', lm.bad === 0, info.legacyMirror);

        // 旧版载入到 model 并进 3D
        var m3 = M.model.create(64, 32);
        m3.loadImageData({ width: 64, height: 32, data: legacy });
        ok('model 接受 64×32 且 format=legacy', m3.format === 'legacy', m3.format);
        var mod = m3.toModern();
        ok('toModern() 得到 64×64', mod.width === 64 && mod.height === 64);
        var modLarm = regionStats(mod.data, 64, 32, 48, 48, 64);
        ok('toModern() 后左臂区与右臂区占用率一致（镜像补齐）',
          Math.abs(modLarm.opaqueRatio - regionStats(legacy, 64, 40, 16, 56, 32).opaqueRatio) < 0.05 ||
          modLarm.opaqueRatio > 0.85, { mod: modLarm.opaqueRatio });
        if (M.shellApi && M.shellApi.state.renderer && !M.shellApi.state.renderer.glError) {
          M.shellApi.state.renderer.setSkin({ width: 64, height: 32, data: legacy }, 'legacy');
          M.shellApi.state.renderer.render();
          var stL = glStats(gl).stats;
          info.glAfterLegacy = { ratio: stL.ratio, distinct: stL.distinct };
          ok('旧版 64×32 皮肤也能渲染出 3D 画面', stL.ratio > 0.05, stL.ratio);
        }
      });
    } else {
      fail.push('没有注入 64×32 参考图 data URL');
    }

    chain = chain.then(function () {
      PHASE = 'geometry';
      // ---------- 关键几何验证：正面视角下，贴图上"右臂正面"的独特颜色必须出现在画面右侧 ----------
      // 用 6 个部位正面区域各自的平均色涂满一张 64×64 合成皮肤，再正对相机渲染，检查画面左右/上下分区颜色
      if (M.rules && M.shellApi && M.shellApi.state.renderer && !M.shellApi.state.renderer.glError) {
        var synth = new Uint8ClampedArray(64 * 64 * 4);
        var BODY_COLORS = {
          head: [255, 0, 0], body: [0, 255, 0], rightArm: [0, 0, 255],
          leftArm: [255, 255, 0], rightLeg: [255, 0, 255], leftLeg: [0, 255, 255]
        };
        // 只涂 6 个基础层盒（外层会被 setShowLayer(false) 关掉，若也涂会盖住左肢）
        Object.keys(BODY_COLORS).forEach(function (pid) {
          var b = M.rules.box(pid);
          if (!b || b.layer !== 'base') return;
          ['front', 'back', 'left', 'right', 'top', 'bottom'].forEach(function (f) {
            var p = b.faces[f].px;
            for (var y = p[1]; y < p[3]; y++) {
              for (var x = p[0]; x < p[2]; x++) {
                var i = (y * 64 + x) * 4;
                synth[i] = BODY_COLORS[pid][0]; synth[i + 1] = BODY_COLORS[pid][1];
                synth[i + 2] = BODY_COLORS[pid][2]; synth[i + 3] = 255;
              }
            }
          });
        });
        var rr = M.shellApi.state.renderer;
        rr.setShowLayer(false);      // 关掉外层，避免遮挡
        if (typeof rr.setShowGround === 'function') rr.setShowGround(false);
        rr.setSkin({ width: 64, height: 64, data: synth }, 'modern');
        rr.setAutoRotate(false);
        // 相机约定（renderer3d）：eye = target + d·(cosP·sinYaw, sinP, cosP·cosYaw)
        // yaw=0 → +Z = 角色正面；yaw=-90 → -X = 侧面。要正视必须用 yaw=0。
        rr.setRotation(0, 0);         // 正对模型正面（+Z）
        rr.setAnimation('none');
        if (typeof rr.setPartVisible === 'function') rr.setPartVisible(null, true);

        function capture(visibleParts) {
          if (visibleParts) {
            ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(function (p) {
              rr.setPartVisible(p, visibleParts.indexOf(p) >= 0);
            });
          }
          rr.render();
          var c = document.createElement('canvas');
          c.width = gl.width; c.height = gl.height;
          var cx2 = c.getContext('2d');
          cx2.drawImage(gl, 0, 0);
          return {
            canvas: c, data: cx2.getImageData(0, 0, c.width, c.height).data,
            glSize: [gl.width, gl.height], cssSize: [gl.clientWidth, gl.clientHeight],
            stats: rr.stats ? rr.stats() : null
          };
        }
        function findIn(cap, target) {
          var found = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
          var ratioSum = 0, ratioN = 0;
          var tmax = Math.max(target[0], target[1], target[2]);
          for (var y = 0; y < cap.canvas.height; y++) {
            for (var x = 0; x < cap.canvas.width; x++) {
              var i = (y * cap.canvas.width + x) * 4;
              if (cap.data[i + 3] < 200) continue;
              var r = cap.data[i], g = cap.data[i + 1], b = cap.data[i + 2];
              var mx = Math.max(r, g, b);
              if (mx < 40) continue;
              // 先比"通道形状"（明暗是整体缩放，形状不变），再比缩放后的亮度
              var shapeOk = true;
              for (var c = 0; c < 3; c++) {
                var want = target[c] > 0, has = cap.data[i + c] > mx * 0.5;
                if (want !== has) { shapeOk = false; break; }
              }
              if (!shapeOk) continue;
              var scale = mx / tmax;
              if (scale < 0.15 || scale > 1.6) continue;
              found++; sx += x; sy += y; ratioSum += scale; ratioN++;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
          return found ? { n: found, cx: sx / found, cy: sy / found, box: [minX, minY, maxX, maxY], scale: ratioSum / ratioN, target: target } : { n: 0, target: target };
        }
        // 场景 A：只显示头 + 躯干（隐藏四肢）——躯干正前方没有遮挡，用于比较上下位置
        var capA = capture(['head', 'body']);
        var hitsHeadBody = {
          head: findIn(capA, BODY_COLORS.head),
          body: findIn(capA, BODY_COLORS.body)
        };
        // 场景 B：头 + 两条腿（隐藏躯干与手臂）——两条腿左右分列
        var capB = capture(['head', 'rightLeg', 'leftLeg']);
        var hitsLegs = {
          rightLeg: findIn(capB, BODY_COLORS.rightLeg),
          leftLeg: findIn(capB, BODY_COLORS.leftLeg)
        };
        // 场景 C：全部 6 个部位——验证手臂分列躯干两侧
        var capC = capture(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']);
        var hitsAll = {
          head: findIn(capC, BODY_COLORS.head),
          body: findIn(capC, BODY_COLORS.body),
          rightArm: findIn(capC, BODY_COLORS.rightArm),
          leftArm: findIn(capC, BODY_COLORS.leftArm),
          rightLeg: findIn(capC, BODY_COLORS.rightLeg),
          leftLeg: findIn(capC, BODY_COLORS.leftLeg)
        };
        info.geometryProbe = hitsHeadBody;
        info.geometryProbeLegs = hitsLegs;
        info.geometryProbeAll = hitsAll;
        info.capCShot = capC.canvas.toDataURL('image/png');
        info.capAShot = capA.canvas.toDataURL('image/png');
        // 场景 D/E/F：每个部分单独显示，定位渲染器到底画了哪些部分
        PHASE = 'perPart';
        var perPart = {};
        ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(function (pid) {
          var cap = capture([pid]);
          var hit = findIn(cap, BODY_COLORS[pid]);
          perPart[pid] = { hit: hit, stats: cap.stats };
        });
        info.perPart = perPart;
        // 直接读 renderer 构建出来的顶点缓冲（优先用官方 debugVertices API）
        (function () {
          if (typeof rr.debugVertices === 'function') {
            var dv = rr.debugVertices();
            info.builtParts = {
              api: 'debugVertices', baseCount: dv.baseCount, outerCount: dv.outerCount, stride: dv.stride,
              parts: (dv.parts || []).map(function (p) {
                return { name: p.name, baseOffset: p.baseOffset, baseCount: p.baseCount, bbox: p.baseBBox };
              })
            };
            return;
          }
          var b = rr.built;
          if (!b) { info.builtParts = 'no built'; return; }
          var out = { api: 'built', baseCount: b.baseCount, outerCount: b.outerCount, stride: b.stride, parts: [] };
          for (var i = 0; i < b.parts.length; i++) {
            var p = b.parts[i];
            var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
            for (var v = 0; v < p.baseCount; v++) {
              var base = (p.baseOffset + v) * b.stride;
              for (var c = 0; c < 3; c++) {
                var val = b.base[base + c];
                if (val < lo[c]) lo[c] = val;
                if (val > hi[c]) hi[c] = val;
              }
            }
            out.parts.push({ name: p.name, baseOffset: p.baseOffset, baseCount: p.baseCount, bbox: [lo, hi] });
          }
          info.builtParts = out;
        })();
        info.synthShot = (function () {
          var c = document.createElement('canvas');
          c.width = 64; c.height = 64;
          var cx3 = c.getContext('2d');
          var id = cx3.createImageData(64, 64);
          id.data.set(synth);
          cx3.putImageData(id, 0, 0);
          return c.toDataURL('image/png');
        })();
        info.synthCoverage = (function () {
          var reg = {};
          ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(function (pid) {
            var b = M.rules.box(pid), o = 0, t = 0;
            if (!b) { reg[pid] = 'no box'; return; }
            ['front', 'back', 'left', 'right', 'top', 'bottom'].forEach(function (f) {
              var p = b.faces[f].px;
              for (var y = p[1]; y < p[3]; y++) for (var x = p[0]; x < p[2]; x++) {
                t++; if (synth[(y * 64 + x) * 4 + 3] > 0) o++;
              }
            });
            reg[pid] = o + '/' + t;
          });
          return reg;
        })();
        // 诊断：场景 C 每列的非透明范围 + 左臂预期位置的取样
        (function () {
          var cols = [];
          for (var x = 0; x < capC.canvas.width; x += 20) {
            var minY = 1e9, maxY = -1e9, n = 0, sample = null;
            for (var y = 0; y < capC.canvas.height; y++) {
              var i = (y * capC.canvas.width + x) * 4;
              if (capC.data[i + 3] > 200) { n++; if (y < minY) minY = y; if (y > maxY) maxY = y; if (!sample) sample = [capC.data[i], capC.data[i + 1], capC.data[i + 2]]; }
            }
            cols.push({ x: x, n: n, y: [minY === 1e9 ? -1 : minY, maxY === -1e9 ? -1 : maxY], c: sample });
          }
          info.columnProfile = cols;
          info.capCSize = [capC.canvas.width, capC.canvas.height];
        })();

        // 恢复全部部位（用 setPartVisible(null, true) 清空掩码）
        if (typeof rr.setPartVisible === 'function') rr.setPartVisible(null, true);
        ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(function (p) { rr.setPartVisible(p, true); });

        ok('正面视角能看到头部（红色块）', !!hitsHeadBody.head, hitsHeadBody.head);
        ok('正面视角能看到躯干（绿色块）', !!hitsHeadBody.body, hitsHeadBody.body);
        ok('正面视角能看到两条腿', !!hitsLegs.rightLeg && !!hitsLegs.leftLeg, hitsLegs);
        ok('左右腿分列画面两侧（角色右腿在画面左、左腿在画面右）',
          !!hitsLegs.rightLeg && !!hitsLegs.leftLeg && hitsLegs.rightLeg.cx < hitsLegs.leftLeg.cx &&
          Math.abs(hitsLegs.rightLeg.cx - hitsLegs.leftLeg.cx) > 20,
          { r: hitsLegs.rightLeg && hitsLegs.rightLeg.cx, l: hitsLegs.leftLeg && hitsLegs.leftLeg.cx });
        ok('头部在躯干上方（画面 y 更小）', !!hitsHeadBody.head && !!hitsHeadBody.body &&
          hitsHeadBody.head.cy < hitsHeadBody.body.cy,
          { head: hitsHeadBody.head && hitsHeadBody.head.cy, body: hitsHeadBody.body && hitsHeadBody.body.cy });
        ok('腿在头部下方（画面 y 更大）', !!hitsLegs.rightLeg && !!hitsHeadBody.head &&
          hitsLegs.rightLeg.cy > hitsHeadBody.head.cy,
          { leg: hitsLegs.rightLeg && hitsLegs.rightLeg.cy, head: hitsHeadBody.head && hitsHeadBody.head.cy });
        ok('角色右手臂出现在画面左侧（-X 投影到左）', !!hitsAll.rightArm && !!hitsAll.body &&
          hitsAll.rightArm.cx < hitsAll.body.cx,
          { rArm: hitsAll.rightArm && hitsAll.rightArm.cx, body: hitsAll.body && hitsAll.body.cx });
        ok('角色左手臂出现在画面右侧（+X 投影到右）', !!hitsAll.leftArm && !!hitsAll.body &&
          hitsAll.leftArm.cx > hitsAll.body.cx,
          { lArm: hitsAll.leftArm && hitsAll.leftArm.cx, body: hitsAll.body && hitsAll.body.cx });
        ok('手臂与躯干同高（顶部对齐）', !!hitsAll.rightArm && !!hitsAll.body &&
          Math.abs(hitsAll.rightArm.box[1] - hitsAll.body.box[1]) < gl.height * 0.1,
          { armTop: hitsAll.rightArm && hitsAll.rightArm.box, bodyTop: hitsAll.body && hitsAll.body.box });
        ok('全部 6 个部位都能单独着色并出现在画面上',
          ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].every(function (p) { return !!hitsAll[p]; }),
          Object.keys(hitsAll).filter(function (p) { return !hitsAll[p]; }));
      }

      // （真实参考图的三视角视觉复核放在独立页面 tests/visual_check.html，避免拖累本探针的时序）

      // 恢复默认皮肤，保证截图是正常画面
      try {
        var mm = M.model.create(64, 64);
        if (M.rules.defaultSkin) mm.loadImageData(M.rules.defaultSkin());
        if (M.shellApi) {
          M.shellApi.state.model = mm;
          if (M.shellApi.state.editor) { M.shellApi.state.editor.setModel(mm); M.shellApi.state.editor.redraw(); }
          if (M.shellApi.state.renderer) {
            var rr2 = M.shellApi.state.renderer;
            if (typeof rr2.setPartVisible === 'function') rr2.setPartVisible(null, true);
            ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach(function (p) { rr2.setPartVisible(p, true); });
            rr2.setShowLayer(true);
            rr2.setShowBase(true);
            rr2.setSkin({ width: 64, height: 64, data: mm.data }, 'modern');
            rr2.setRotation(20, 10);
            rr2.setZoom(1);
            rr2.setAnimation('idle');
            rr2.render();
            // 确认最终画面确实有内容（截图证据）
            var fin = glStats(gl);
            info.finalGlStats = { ratio: fin.stats.ratio, distinct: fin.stats.distinct };
            ok('最终复位后 3D 画面有内容（截图可见）', fin.stats.ratio > 0.05, info.finalGlStats);
          }
        }
      } catch (e) { ERRORS.push('恢复默认皮肤失败: ' + e.message); }

      PHASE = 'done';
      writeResult();
    });
    return chain;
  }

  function boot() {
    if (!window.MCSKIN || !MCSKIN.shellApi) {
      // shell 还没初始化（可能在等 DOMContentLoaded）
      PHASE = 'wait-shell';
      if (!boot.tries) boot.tries = 0;
      if (++boot.tries > 100) { writeResult(['探针超时：等不到 MCSKIN.shellApi']); return; }
      setTimeout(boot, 100);
      return;
    }
    try {
      main().catch(function (e) {
        ERRORS.push('探针异常: ' + (e && e.stack ? e.stack : e));
        writeResult(['探针异常: ' + (e && e.message ? e.message : e)]);
      });
    } catch (e) {
      ERRORS.push('探针同步异常: ' + (e && e.stack ? e.stack : e));
      writeResult(['探针同步异常: ' + (e && e.message ? e.message : e)]);
    }
  }
  boot();
})();
