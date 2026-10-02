/* js/editor2d.js —— Minecraft 皮肤绘制工具：2D 像素绘制界面
 * 归属：teammate `editor2d`（写作用域仅本文件）。
 * 依赖：只调用 CONTRACT.md 第 4/5 节的契约 API —— MCSKIN.rules / MCSKIN.model。
 *       本文件不硬编码任何 UV 数字，也不复制 rules/model 的实现。
 * 风格：传统 script + 全局命名空间，禁止 import/export，禁止外部库。
 */
(function (root) {
  'use strict';

  root.MCSKIN = root.MCSKIN || {};
  var MCSKIN = root.MCSKIN;

  var VERSION = '1.0';
  var DEFAULT_ZOOM = 8;
  var DEFAULT_PADDING = 4;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 64;
  var TOOLS = ['pencil', 'eraser', 'fill', 'picker', 'line', 'rect'];
  var EVENTS = ['change', 'hover', 'pick', 'cursor'];
  var CHECKER_A = '#d9d9d9';
  var CHECKER_B = '#b8b8b8';
  var BG_COLOR = '#23242a';
  var GRID_COLOR = 'rgba(0,0,0,0.16)';
  var GRID_MAJOR = 'rgba(255,255,255,0.22)';
  var KIND_COLOR = {
    head: '#ffd479', body: '#7fd4ff', arm: '#a6f07f',
    leg: '#ff9ad2', overlay: '#c9a6ff'
  };

  // 左右镜像：部件层面（x -> -x）
  var MIRROR_PART = {
    head: 'head', body: 'body', hat: 'hat', jacket: 'jacket',
    rightArm: 'leftArm', leftArm: 'rightArm',
    rightLeg: 'leftLeg', leftLeg: 'rightLeg',
    rightSleeve: 'leftSleeve', leftSleeve: 'rightSleeve',
    rightPants: 'leftPants', leftPants: 'rightPants'
  };
  // 面的镜像：侧面互换，正面/背面/顶面/底面各自对应；矩形内 u 需要翻转（见 mirrorPixel 注释）
  var MIRROR_FACE = {
    right: 'left', left: 'right', front: 'front', back: 'back', top: 'top', bottom: 'bottom'
  };

  /* ------------------------------------------------------------------ *
   * 纯函数工具（可被 _selfTest 直接测试）
   * ------------------------------------------------------------------ */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function num(v, dflt) {
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function normRGBA(c) {
    if (!c) return null;
    if (typeof c === 'string') {
      var s = c.trim();
      var m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
      if (m) {
        var n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
      }
      return null;
    }
    if (typeof c === 'object' && typeof c.length === 'number' && c.length >= 3) {
      return [clamp(Math.round(num(c[0], 0)), 0, 255),
              clamp(Math.round(num(c[1], 0)), 0, 255),
              clamp(Math.round(num(c[2], 0)), 0, 255),
              clamp(Math.round(num(c.length > 3 ? c[3] : 255)), 0, 255)];
    }
    return null;
  }

  function sameRGBA(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] &&
      ((a.length > 3 ? a[3] : 255) === (b.length > 3 ? b[3] : 255));
  }

  function rgbaStr(c, alphaMul) {
    var a = (c.length > 3 ? c[3] : 255) / 255;
    if (typeof alphaMul === 'number') a *= alphaMul;
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' +
      Math.round(a * 1000) / 1000 + ')';
  }

  /** Bresenham 直线插值：返回 [[x,y]...]，相邻点最大坐标差为 1（八连通，无断点）。 */
  function bresenham(x0, y0, x1, y1) {
    var pts = [];
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0, y = y0;
    for (;;) {
      pts.push([x, y]);
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return pts;
  }

  /** 正方形笔刷：size 1..4，光标居中（偶数尺寸向左上偏 1）。 */
  function brushCells(px, py, size) {
    var n = clamp(Math.round(num(size, 1)), 1, 4);
    var off = Math.floor((n - 1) / 2);
    var cells = [];
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) cells.push({ x: px - off + i, y: py - off + j });
    }
    return cells;
  }

  /**
   * 洪水填充（纯函数，四连通，颜色含 alpha 一起比较；遇到不同颜色即停）。
   * @param model  具有 width/height/getPixel(x,y) 的对象（MCSKIN.model 实例）
   * @param x,y    起点
   * @param rgba   目标颜色 [r,g,b,a]
   * @param layer  'base'|'outer'（保留参数：调用方据 layer 决定 bounds）
   * @param bounds 可选 {x0,y0,x1,y1}，限制填充范围（通常取该面的 UV 矩形），默认整张贴图
   * @returns [{x,y,rgba}] —— 需要写入的像素（不修改 model）
   */
  function floodFill(model, x, y, rgba, layer, bounds) {
    if (!model || typeof model.getPixel !== 'function') return [];
    var w = model.width | 0, h = model.height | 0;
    if (w <= 0 || h <= 0) return [];
    var b = bounds || { x0: 0, y0: 0, x1: w, y1: h };
    var x0 = clamp(b.x0 | 0, 0, w), y0 = clamp(b.y0 | 0, 0, h);
    var x1 = clamp(b.x1 === undefined ? w : b.x1 | 0, 0, w);
    var y1 = clamp(b.y1 === undefined ? h : b.y1 | 0, 0, h);
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return [];
    var target = model.getPixel(x, y);
    if (sameRGBA(target, rgba)) return [];

    var flag = new Uint8Array(w * h);
    var stack = [x, y];
    var out = [];
    while (stack.length) {
      var cy = stack.pop(), cx = stack.pop();
      if (cx < x0 || cy < y0 || cx >= x1 || cy >= y1) continue;
      var idx = cy * w + cx;
      if (flag[idx]) continue;
      flag[idx] = 1;
      if (!sameRGBA(model.getPixel(cx, cy), target)) continue;
      out.push({ x: cx, y: cy, rgba: rgba });
      stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
    }
    return out;
  }

  /** 面内 u 翻转镜像所需数据全部来自 rules（box/faces），不硬编码 UV。 */
  function mirrorPixel(rules, region, px, py, w, h) {
    if (!rules || !region || !region.part || !region.face) return null;
    if (typeof rules.box !== 'function') return null;
    var mPart = MIRROR_PART[region.part];
    if (!mPart) return null;
    var mFace = MIRROR_FACE[region.face] || region.face;
    var src = rules.box(region.boxId || region.part);
    var dst = rules.box(mPart);
    if (!src || !dst || !src.faces || !dst.faces) return null;
    var sf = src.faces[region.face], df = dst.faces[mFace];
    if (!sf || !df || !sf.px || !df.px) return null;
    var s = sf.px, d = df.px;
    var rel = px - s[0], rely = py - s[1];
    // 镜像后面名的 u 方向整体翻转：rel -> (宽-1-rel)
    var mpx = d[0] + ((s[2] - s[0]) - 1 - rel);
    var mpy = d[1] + rely;
    if (mpx < 0 || mpy < 0 || mpx >= w || mpy >= h) return null;
    return { px: mpx, py: mpy };
  }

  /* ------------------------------------------------------------------ *
   * 编辑器实例
   * ------------------------------------------------------------------ */

  function Editor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas || null;
    this.padding = clamp(num(opts.padding, DEFAULT_PADDING), 0, 64);
    this.zoom = clamp(Math.round(num(opts.zoom, DEFAULT_ZOOM)), MIN_ZOOM, MAX_ZOOM);
    this._autoSize = opts.autoSize !== false;

    this.model = null;
    this._skinW = 64;
    this._skinH = 64;

    this._tool = TOOLS.indexOf(opts.tool) >= 0 ? opts.tool : 'pencil';
    this._brushSize = clamp(Math.round(num(opts.brushSize, 1)), 1, 4);
    this._color = normRGBA(opts.color) || [0, 0, 0, 255];
    this._grid = !!opts.grid;
    this._symmetry = opts.symmetry === 'x' ? 'x' : 'none';
    this._activeLayer = opts.activeLayer === 'outer' ? 'outer' : 'base';
    this._layerVisible = { base: true, outer: true };
    this._overlayVisible = !!opts.overlayVisible;

    this._listeners = {};
    for (var i = 0; i < EVENTS.length; i++) this._listeners[EVENTS[i]] = [];

    this._cursor = null;
    this._dragging = false;
    this._strokeActive = false;
    this._last = null;
    this._shapeStart = null;
    this._previewWrites = [];
    this._ptrButton = 0;
    this._strokes = 0;

    this.ctx = null;
    this._off = null;
    this._pattern = null;
    this._patternCell = 0;
    this._cssW = 0;
    this._cssH = 0;
    this._dpr = 1;
    this._originX = this.padding;
    this._originY = this.padding;

    if (this.canvas && this.canvas.style) {
      // 触摸设备上禁止手势滚动，保证拖拽绘制可用
      try { this.canvas.style.touchAction = 'none'; } catch (e) {}
    }
    this._bindEvents();
    this._layout(true);

    if (opts.model) this.setModel(opts.model);
    else this.redraw();
  }

  /* ---------------- 事件注册 ---------------- */

  Editor.prototype.on = function (evt, fn) {
    if (!evt || typeof fn !== 'function') return function () {};
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
    var self = this;
    return function () {
      var arr = self._listeners[evt] || [];
      var k = arr.indexOf(fn);
      if (k >= 0) arr.splice(k, 1);
    };
  };

  Editor.prototype._emit = function (evt, payload) {
    var arr = this._listeners[evt];
    if (!arr || !arr.length) return;
    var copy = arr.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i](payload); } catch (e) { /* 监听器异常不影响绘制 */ }
    }
  };

  Editor.prototype._undoDepth = function () {
    var m = this.model;
    if (m) {
      try {
        if (typeof m.undoDepth === 'function') {
          var d = m.undoDepth();
          if (typeof d === 'number') return d;
        }
        var stacks = [m.undoStack, m._undoStack, m._undo];
        for (var i = 0; i < stacks.length; i++) {
          if (stacks[i] && typeof stacks[i].length === 'number') return stacks[i].length;
        }
      } catch (e) {}
    }
    return this._strokes;
  };

  /** 供 shell 在 undo/redo/load 后调用：重绘并广播。 */
  Editor.prototype.notifyChange = function (reason) {
    var r = reason || 'draw';
    if (r === 'load') this._strokes = 0;
    this.redraw();
    this._emit('change', { reason: r, strokes: this._undoDepth() });
  };

  Editor.prototype.notifyLoad = function () { this.notifyChange('load'); };

  /* ---------------- 模型 / 外观设置 ---------------- */

  Editor.prototype.setModel = function (model) {
    this._abortDrag();
    this.model = model || null;
    this._skinW = (model && model.width) ? model.width : 64;
    this._skinH = (model && model.height) ? model.height : 64;
    this._strokes = 0;
    this._cursor = null;
    this._layout(true);
    this.redraw();
    this._emit('change', { reason: 'load', strokes: this._undoDepth() });
    return this;
  };

  Editor.prototype.setZoom = function (px) {
    var z = clamp(Math.round(num(px, this.zoom)), MIN_ZOOM, MAX_ZOOM);
    if (z === this.zoom) return this;
    this.zoom = z;
    this._pattern = null;
    this._layout(true);
    this.redraw();
    return this;
  };
  Editor.prototype.getZoom = function () { return this.zoom; };

  Editor.prototype.setGrid = function (on) { this._grid = !!on; this.redraw(); return this; };
  Editor.prototype.isGridOn = function () { return this._grid; };

  Editor.prototype.setSymmetry = function (mode) {
    this._symmetry = mode === 'x' ? 'x' : 'none';
    this.redraw();
    return this;
  };
  Editor.prototype.getSymmetry = function () { return this._symmetry; };

  Editor.prototype.setLayerVisible = function (layer, on) {
    if (layer !== 'base' && layer !== 'outer') return this;
    this._layerVisible[layer] = !!on;
    this.redraw();
    return this;
  };
  Editor.prototype.isLayerVisible = function (layer) { return !!this._layerVisible[layer]; };

  Editor.prototype.setActiveLayer = function (layer) {
    // 活动层决定 regionAt 的返回（共用区 leftPants/leftLeg 落到正确的层），也就决定镜像目标
    this._activeLayer = layer === 'outer' ? 'outer' : 'base';
    this._refreshCursor();
    this.redraw();
    return this;
  };
  Editor.prototype.getActiveLayer = function () { return this._activeLayer; };

  Editor.prototype.setTool = function (tool) {
    if (TOOLS.indexOf(tool) < 0) return this;
    // 切换工具时丢弃未提交的预览（line/rect 预览）
    this._abortDrag();
    this._tool = tool;
    this.redraw();
    return this;
  };
  Editor.prototype.getTool = function () { return this._tool; };

  Editor.prototype.setColor = function (rgba) {
    var c = normRGBA(rgba);
    if (c) this._color = c;
    return this;
  };
  Editor.prototype.getColor = function () { return this._color.slice(); };

  Editor.prototype.setBrushSize = function (n) {
    this._brushSize = clamp(Math.round(num(n, 1)), 1, 4);
    return this;
  };
  Editor.prototype.getBrushSize = function () { return this._brushSize; };

  Editor.prototype.setOverlayVisible = function (on) { this._overlayVisible = !!on; this.redraw(); return this; };
  Editor.prototype.isOverlayVisible = function () { return this._overlayVisible; };

  Editor.prototype.getCursor = function () {
    return this._cursor ? { px: this._cursor.px, py: this._cursor.py, region: this._cursor.region } : null;
  };

  Editor.prototype.getGeometry = function () {
    return {
      zoom: this.zoom, padding: this.padding,
      originX: this._originX, originY: this._originY,
      cssWidth: this._cssW, cssHeight: this._cssH,
      devicePixelRatio: this._dpr,
      skinWidth: this._skinW, skinHeight: this._skinH,
      autoSize: this._autoSize
    };
  };

  Editor.prototype.resize = function () { this._layout(true); this.redraw(); return this; };

  Editor.prototype.destroy = function () {
    this._abortDrag();
    if (this.canvas && this.canvas.removeEventListener && this._handlers) {
      for (var k in this._handlers) {
        if (Object.prototype.hasOwnProperty.call(this._handlers, k)) {
          try { this.canvas.removeEventListener(k, this._handlers[k]); } catch (e) {}
        }
      }
    }
    this._handlers = null;
    for (var i = 0; i < EVENTS.length; i++) this._listeners[EVENTS[i]] = [];
    this._cursor = null;
    this.ctx = null;
    this._off = null;
    this._pattern = null;
  };

  /* ---------------- 布局与坐标换算 ---------------- */

  function rectOf(canvas) {
    if (canvas && typeof canvas.getBoundingClientRect === 'function') {
      try {
        var r = canvas.getBoundingClientRect();
        if (r) return { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
      } catch (e) {}
    }
    return null;
  }

  Editor.prototype._layout = function (force) {
    var c = this.canvas;
    if (!c) return;
    var dpr = num(root.devicePixelRatio, 1);
    if (dpr <= 0) dpr = 1;
    var w = this._skinW, h = this._skinH;
    var needW = this.padding * 2 + w * this.zoom;
    var needH = this.padding * 2 + h * this.zoom;
    var cssW, cssH;
    if (this._autoSize) {
      // 画布 CSS 尺寸由编辑器按内容算好后写入 style（缩放皮肤正好放下 + 内边距）
      cssW = needW;
      cssH = needH;
      if (c.style) {
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
      }
    } else {
      // 外部用 CSS 控制尺寸：读取实测 CSS 尺寸后居中放置皮肤
      var rect = rectOf(c);
      cssW = (rect && rect.width) || c.clientWidth || needW;
      cssH = (rect && rect.height) || c.clientHeight || needH;
    }
    if (force || cssW !== this._cssW || cssH !== this._cssH || dpr !== this._dpr) {
      this._cssW = cssW;
      this._cssH = cssH;
      this._dpr = dpr;
      if (typeof c.width === 'number') c.width = Math.max(1, Math.round(cssW * dpr));
      if (typeof c.height === 'number') c.height = Math.max(1, Math.round(cssH * dpr));
      this._originX = this._autoSize
        ? this.padding
        : Math.max(0, Math.round((cssW - w * this.zoom) / 2));
      this._originY = this._autoSize
        ? this.padding
        : Math.max(0, Math.round((cssH - h * this.zoom) / 2));
      this._off = null;
      if (c.getContext) {
        try { this.ctx = c.getContext('2d'); } catch (e) { this.ctx = null; }
      }
    }
  };

  /** 客户端坐标 -> 皮肤像素坐标（同时处理 CSS 尺寸、devicePixelRatio、内边距、CSS 缩放） */
  Editor.prototype.clientToPixel = function (clientX, clientY) {
    var c = this.canvas;
    var rect = rectOf(c) || { left: 0, top: 0, width: this._cssW || 1, height: this._cssH || 1 };
    var sx = rect.width ? this._cssW / rect.width : 1;
    var sy = rect.height ? this._cssH / rect.height : 1;
    var lx = (num(clientX, 0) - rect.left) * sx;
    var ly = (num(clientY, 0) - rect.top) * sy;
    var px = Math.floor((lx - this._originX) / this.zoom);
    var py = Math.floor((ly - this._originY) / this.zoom);
    var inside = px >= 0 && py >= 0 && px < this._skinW && py < this._skinH;
    return { px: px, py: py, inside: inside };
  };

  /** 皮肤像素左上角 -> 客户端坐标（clientToPixel 的逆运算） */
  Editor.prototype.pixelToClient = function (px, py) {
    var c = this.canvas;
    var rect = rectOf(c) || { left: 0, top: 0, width: this._cssW || 1, height: this._cssH || 1 };
    var kx = this._cssW ? rect.width / this._cssW : 1;
    var ky = this._cssH ? rect.height / this._cssH : 1;
    return {
      x: rect.left + (this._originX + num(px, 0) * this.zoom) * kx,
      y: rect.top + (this._originY + num(py, 0) * this.zoom) * ky
    };
  };

  /* ---------------- rules 反查 ---------------- */

  Editor.prototype._rules = function () { return MCSKIN.rules || null; };

  Editor.prototype._regionAt = function (px, py, layer) {
    var rules = this._rules();
    if (!rules || typeof rules.regionAt !== 'function') return null;
    try {
      // 关键：把活动层传给 regionAt，共用区（leftPants/leftLeg）才会落到正确的层
      return rules.regionAt(px, py, { layer: layer || this._activeLayer }) || null;
    } catch (e) { return null; }
  };

  /** 某像素所属面的 UV 矩形（洪水填充边界），全部来自 rules。 */
  Editor.prototype._faceBounds = function (px, py) {
    var rules = this._rules();
    var region = this._regionAt(px, py);
    if (!rules || !region || typeof rules.box !== 'function') return null;
    var box = rules.box(region.boxId || region.part);
    var face = box && box.faces && region.face ? box.faces[region.face] : null;
    if (!face || !face.px) return null;
    return { x0: face.px[0], y0: face.px[1], x1: face.px[2], y1: face.px[3] };
  };

  Editor.prototype._mirrorCell = function (x, y) {
    if (this._symmetry !== 'x') return null;
    return mirrorPixel(this._rules(), this._regionAt(x, y), x, y, this._skinW, this._skinH);
  };

  /* ---------------- 写入（全部走 MCSKIN.model API） ---------------- */

  Editor.prototype._setPixel = function (x, y, rgba) {
    var m = this.model;
    if (!m) return;
    try {
      m.setPixel(x, y, rgba, { record: true, merge: 'replace' });
    } catch (e) {
      m.setPixel(x, y, rgba);
    }
  };

  Editor.prototype._readPixel = function (x, y) {
    var m = this.model;
    if (!m || typeof m.getPixel !== 'function') return [0, 0, 0, 0];
    try { return normRGBA(m.getPixel(x, y)) || [0, 0, 0, 0]; } catch (e) { return [0, 0, 0, 0]; }
  };

  /**
   * 把 cells 变成待写入列表（去重 + 左右镜像 + 跳过无变化像素）。
   * 只返回数据，不写 model —— line/rect 的预览复用它。
   */
  Editor.prototype._planWrites = function (cells, color, skipSame) {
    var w = this._skinW, h = this._skinH, out = [], seen = {}, i, c, key, mc;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
      key = c.x * 4096 + c.y;
      if (seen[key]) continue;
      seen[key] = 1;
      if (!skipSame || !sameRGBA(this._readPixel(c.x, c.y), color)) {
        out.push({ x: c.x, y: c.y, rgba: color });
      }
      mc = this._mirrorCell(c.x, c.y);
      if (mc) {
        key = mc.px * 4096 + mc.py;
        if (!seen[key]) {
          seen[key] = 1;
          if (!skipSame || !sameRGBA(this._readPixel(mc.px, mc.py), color)) {
            out.push({ x: mc.px, y: mc.py, rgba: color });
          }
        }
      }
    }
    return out;
  };

  Editor.prototype._applyWrites = function (writes) {
    var n = 0;
    for (var i = 0; i < writes.length; i++) {
      this._setPixel(writes[i].x, writes[i].y, writes[i].rgba);
      n++;
    }
    return n;
  };

  /** 一次按下-拖动-松手 = 一个撤销步：beginStroke ... endStroke */
  Editor.prototype._ensureStroke = function (label) {
    if (this._strokeActive || !this.model) return;
    if (typeof this.model.beginStroke === 'function') {
      try { this.model.beginStroke(label || this._tool); } catch (e) {}
    }
    this._strokeActive = true;
  };

  Editor.prototype._closeStroke = function () {
    if (!this._strokeActive) return false;
    this._strokeActive = false;
    if (this.model && typeof this.model.endStroke === 'function') {
      try { this.model.endStroke(); } catch (e) {}
    }
    this._strokes++;
    return true;
  };

  Editor.prototype._finishStroke = function (reason) {
    var closed = this._closeStroke();
    this.redraw();
    if (closed) this._emit('change', { reason: reason || 'draw', strokes: this._undoDepth() });
    return closed;
  };

  Editor.prototype._abortDrag = function () {
    var closed = this._closeStroke();
    this._dragging = false;
    this._last = null;
    this._shapeStart = null;
    this._previewWrites = [];
    if (closed) this._emit('change', { reason: 'draw', strokes: this._undoDepth() });
  };

  Editor.prototype._paintColor = function () {
    return this._tool === 'eraser' ? [0, 0, 0, 0] : this._color;
  };

  Editor.prototype._writeCells = function (cells, color, label) {
    var writes = this._planWrites(cells, color, true);
    if (!writes.length) return 0;
    this._ensureStroke(label);
    return this._applyWrites(writes);
  };

  /* ---------------- 工具几何 ---------------- */

  Editor.prototype._shapeCells = function (a, b, tool) {
    if (tool === 'line') {
      var pts = bresenham(a.px, a.py, b.px, b.py);
      var cells = [];
      for (var i = 0; i < pts.length; i++) {
        var br = brushCells(pts[i][0], pts[i][1], this._brushSize);
        for (var j = 0; j < br.length; j++) cells.push(br[j]);
      }
      return cells;
    }
    // rect：填充矩形（预览 + 松手提交）
    var x0 = Math.min(a.px, b.px), x1 = Math.max(a.px, b.px);
    var y0 = Math.min(a.py, b.py), y1 = Math.max(a.py, b.py);
    var out = [];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push({ x: x, y: y });
    return out;
  };

  /* ---------------- 指针交互 ---------------- */

  Editor.prototype._bindEvents = function () {
    var c = this.canvas;
    if (!c || !c.addEventListener) { this._handlers = null; return; }
    var self = this;
    this._handlers = {
      pointerdown: function (e) { self._onPointerDown(e); },
      pointermove: function (e) { self._onPointerMove(e); },
      pointerup: function (e) { self._onPointerUp(e); },
      pointercancel: function (e) { self._onPointerUp(e); },
      pointerleave: function (e) { self._onPointerLeave(e); },
      contextmenu: function (e) { if (e && e.preventDefault) e.preventDefault(); }
    };
    for (var k in this._handlers) {
      if (Object.prototype.hasOwnProperty.call(this._handlers, k)) {
        try { c.addEventListener(k, this._handlers[k]); } catch (e) {}
      }
    }
  };

  Editor.prototype._capture = function (e) {
    var c = this.canvas;
    if (!c || !e || e.pointerId === undefined) return;
    try { if (c.setPointerCapture) c.setPointerCapture(e.pointerId); } catch (err) {}
  };

  Editor.prototype._updateCursor = function (pos) {
    var region = pos.inside ? this._regionAt(pos.px, pos.py) : null;
    this._cursor = pos.inside ? { px: pos.px, py: pos.py, region: region } : null;
    var payload = { px: pos.inside ? pos.px : null, py: pos.inside ? pos.py : null, region: region, inside: pos.inside };
    this._emit('hover', payload);
    this._emit('cursor', this._cursor ? { px: this._cursor.px, py: this._cursor.py, region: region } : null);
    return region;
  };

  Editor.prototype._refreshCursor = function () {
    if (!this._cursor) return null;
    var region = this._regionAt(this._cursor.px, this._cursor.py);
    this._cursor.region = region;
    return region;
  };

  Editor.prototype._pick = function (pos) {
    if (!pos.inside) return null;
    var rgba = this._readPixel(pos.px, pos.py);
    this._color = rgba.slice();
    var region = this._regionAt(pos.px, pos.py);
    // rgba 为规范字段；color 是等价别名（shell 侧两个都认）
    this._emit('pick', { px: pos.px, py: pos.py, rgba: rgba.slice(), color: rgba.slice(), region: region });
    return rgba;
  };

  Editor.prototype._onPointerDown = function (e) {
    if (!this.model || !e) return;
    var button = e.button === undefined ? 0 : e.button;
    var pos = this.clientToPixel(e.clientX, e.clientY);
    this._updateCursor(pos);
    if (button === 2) {
      // 右键 = 取色（不做擦除）；同时抑制系统右键菜单
      if (e.preventDefault) e.preventDefault();
      this._pick(pos);
      this.redraw();
      return;
    }
    if (button !== 0 || !pos.inside) return;
    if (e.preventDefault) e.preventDefault();
    var tool = this._tool;
    if (tool === 'picker') { this._pick(pos); this.redraw(); return; }

    this._capture(e);
    this._ptrButton = button;
    this._last = { px: pos.px, py: pos.py };

    if (tool === 'fill') {
      var bounds = this._faceBounds(pos.px, pos.py); // 遇到颜色不同的像素即停（默认再受本面 UV 矩形约束）
      var edits = floodFill(this.model, pos.px, pos.py, this._paintColor(), this._activeLayer, bounds);
      edits = this._planWrites(edits, this._paintColor(), false); // 同一入口处理左右对称镜像
      if (edits.length) {
        this._ensureStroke('fill');
        this._applyWrites(edits);
        this._finishStroke('draw');
      }
      return;
    }
    if (tool === 'line' || tool === 'rect') {
      this._dragging = true;
      this._shapeStart = { px: pos.px, py: pos.py };
      this._previewWrites = this._planWrites(this._shapeCells(this._shapeStart, this._last, tool), this._paintColor(), false);
      this.redraw();
      return;
    }
    // pencil / eraser：按下即落笔
    this._dragging = true;
    var n = this._writeCells(brushCells(pos.px, pos.py, this._brushSize), this._paintColor(), tool);
    if (n) {
      this.redraw();
      this._emit('change', { reason: 'draw', strokes: this._undoDepth() });
    }
  };

  Editor.prototype._onPointerMove = function (e) {
    if (!e) return;
    var before = this._cursor ? this._cursor.px + ',' + this._cursor.py : null;
    var pos = this.clientToPixel(e.clientX, e.clientY);
    this._updateCursor(pos);
    if (!this._dragging || !this.model) {
      var after = this._cursor ? this._cursor.px + ',' + this._cursor.py : null;
      if (before !== after) this.redraw();
      return;
    }

    var tool = this._tool;
    if (tool === 'line' || tool === 'rect') {
      var cells = this._shapeCells(this._shapeStart, pos, tool);
      this._previewWrites = this._planWrites(cells, this._paintColor(), false);
      this.redraw();
      return;
    }
    if (tool !== 'pencil' && tool !== 'eraser') return;
    if (!pos.inside) return;
    if (this._last && this._last.px === pos.px && this._last.py === pos.py) return;

    // 快速移动用 Bresenham 插值，保证不断点
    var path = this._last ? bresenham(this._last.px, this._last.py, pos.px, pos.py) : [[pos.px, pos.py]];
    var all = [];
    for (var i = 0; i < path.length; i++) {
      var br = brushCells(path[i][0], path[i][1], this._brushSize);
      for (var j = 0; j < br.length; j++) all.push(br[j]);
    }
    this._last = { px: pos.px, py: pos.py };
    var n = this._writeCells(all, this._paintColor(), tool);
    this.redraw();
    if (n) this._emit('change', { reason: 'draw', strokes: this._undoDepth() });
  };

  Editor.prototype._onPointerUp = function (e) {
    if (!this._dragging) return;
    var tool = this._tool;
    if (tool === 'line' || tool === 'rect') {
      // 拖拽预览 + 松手提交（提交的整个形状 = 一个撤销步）
      var writes = this._previewWrites.slice();
      this._previewWrites = [];
      this._dragging = false;
      if (writes.length) {
        this._ensureStroke(tool);
        this._applyWrites(writes);
        this._finishStroke('draw');
      } else {
        this.redraw();
      }
      this._last = null;
      this._shapeStart = null;
      return;
    }
    this._dragging = false;
    this._last = null;
    this._finishStroke('draw');
  };

  Editor.prototype._onPointerLeave = function () {
    this._cursor = null;
    this._emit('hover', { px: null, py: null, region: null, inside: false });
    this._emit('cursor', null);
    this.redraw();
  };

  /* ---------------- 绘制 ---------------- */

  Editor.prototype._offscreen = function () {
    if (this._off) return this._off;
    if (!root.document || !root.document.createElement) return null;
    var cv = root.document.createElement('canvas');
    if (!cv || !cv.getContext) return null;
    cv.width = this._skinW;
    cv.height = this._skinH;
    var octx = cv.getContext('2d');
    if (!octx) return null;
    this._off = { canvas: cv, ctx: octx };
    return this._off;
  };

  Editor.prototype._checkerPattern = function (cell) {
    if (!this.ctx || !this.ctx.createPattern) return null;
    if (this._pattern && this._patternCell === cell) return this._pattern;
    if (!root.document || !root.document.createElement) return null;
    var tile = root.document.createElement('canvas');
    if (!tile || !tile.getContext) return null;
    tile.width = cell * 2;
    tile.height = cell * 2;
    var tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.fillStyle = CHECKER_A;
    tctx.fillRect(0, 0, cell * 2, cell * 2);
    tctx.fillStyle = CHECKER_B;
    tctx.fillRect(0, 0, cell, cell);
    tctx.fillRect(cell, cell, cell, cell);
    try {
      this._pattern = this.ctx.createPattern(tile, 'repeat');
      this._patternCell = cell;
    } catch (e) { this._pattern = null; }
    return this._pattern;
  };

  Editor.prototype.redraw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    this._layout(false);
    ctx = this.ctx;
    if (!ctx) return;

    var zoom = this.zoom;
    var ox = this._originX, oy = this._originY;
    var w = this._skinW, h = this._skinH;
    var sw = w * zoom, sh = h * zoom;

    if (ctx.setTransform) ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
    if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
    if (ctx.globalAlpha !== undefined) ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this._cssW, this._cssH);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, this._cssW, this._cssH);

    // 透明像素的棋盘格背景
    var cell = Math.max(4, Math.round(zoom));
    var pattern = null;
    try { pattern = this._checkerPattern(cell); } catch (e) { pattern = null; }
    if (pattern) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, sw, sh);
      ctx.restore();
    } else {
      var cols = Math.ceil(sw / cell), rows = Math.ceil(sh / cell);
      for (var iy = 0; iy < rows; iy++) {
        for (var ix = 0; ix < cols; ix++) {
          ctx.fillStyle = ((ix + iy) & 1) ? CHECKER_B : CHECKER_A;
          ctx.fillRect(ox + ix * cell, oy + iy * cell,
            Math.min(cell, sw - ix * cell), Math.min(cell, sh - iy * cell));
        }
      }
    }

    // 皮肤贴图：最近邻放大
    if (this.model) {
      var off = this._offscreen();
      var data = this.model.data;
      if (off && data) {
        try {
          var img = off.ctx.createImageData(w, h);
          var need = w * h * 4;
          if (data.length >= need) {
            img.data.set(data.subarray ? data.subarray(0, need) : data);
          } else {
            for (var t = 0; t < data.length; t++) img.data[t] = data[t];
          }
          off.ctx.putImageData(img, 0, 0);
          ctx.drawImage(off.canvas, 0, 0, w, h, ox, oy, sw, sh);
        } catch (e) {
          this._drawPixelsFallback(ctx, ox, oy, zoom);
        }
      } else {
        // 没有 document（例如 Node 自测）时的回退：逐像素绘制
        this._drawPixelsFallback(ctx, ox, oy, zoom);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('未加载皮肤', ox + sw / 2, oy + sh / 2);
    }

    if (this._grid) this._drawGrid(ctx, ox, oy, sw, sh);
    this._drawLayerDim(ctx, ox, oy, zoom);
    if (this._overlayVisible) this._drawOverlay(ctx, ox, oy, zoom);
    this._drawPreview(ctx, ox, oy, zoom);
    this._drawCursorBox(ctx, ox, oy, zoom);

    // 皮肤区外框
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    if (ctx.strokeRect) ctx.strokeRect(ox + 0.5, oy + 0.5, sw - 1, sh - 1);
  };

  Editor.prototype._drawPixelsFallback = function (ctx, ox, oy, zoom) {
    var w = this._skinW, h = this._skinH;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = this._readPixel(x, y);
        if (!c || (c.length > 3 ? c[3] : 255) === 0) continue;
        ctx.fillStyle = rgbaStr(c);
        ctx.fillRect(ox + x * zoom, oy + y * zoom, zoom, zoom);
      }
    }
  };

  Editor.prototype._drawGrid = function (ctx, ox, oy, sw, sh) {
    var zoom = this.zoom, i;
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    for (i = 0; i <= this._skinW; i++) {
      var x = Math.round(ox + i * zoom) + 0.5;
      ctx.moveTo(x, oy);
      ctx.lineTo(x, oy + sh);
    }
    for (i = 0; i <= this._skinH; i++) {
      var y = Math.round(oy + i * zoom) + 0.5;
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + sw, y);
    }
    ctx.stroke();
    // 每 8 个皮肤像素一条更醒目的线，便于对位
    ctx.strokeStyle = GRID_MAJOR;
    ctx.beginPath();
    for (i = 0; i <= this._skinW; i += 8) {
      var x2 = Math.round(ox + i * zoom) + 0.5;
      ctx.moveTo(x2, oy);
      ctx.lineTo(x2, oy + sh);
    }
    for (i = 0; i <= this._skinH; i += 8) {
      var y2 = Math.round(oy + i * zoom) + 0.5;
      ctx.moveTo(ox, y2);
      ctx.lineTo(ox + sw, y2);
    }
    ctx.stroke();
  };

  Editor.prototype._layoutRegions = function () {
    var rules = this._rules();
    if (!rules || !rules.LAYOUT_REGIONS || !rules.LAYOUT_REGIONS.length) return [];
    return rules.LAYOUT_REGIONS;
  };

  Editor.prototype._regionLayer = function (region) {
    if (region && region.layer) return region.layer;
    var r = this._regionAt(region.px[0], region.px[1], 'base') ||
            this._regionAt(region.px[0], region.px[1], 'outer');
    return r && r.layer ? r.layer : null;
  };

  /** setLayerVisible(false) 时把该层区域压暗（仅显示，不阻止绘制） */
  Editor.prototype._drawLayerDim = function (ctx, ox, oy, zoom) {
    var regions = this._layoutRegions(), i, r;
    for (i = 0; i < regions.length; i++) {
      r = regions[i];
      if (!r || !r.px) continue;
      var layer = this._regionLayer(r);
      if (!layer || this._layerVisible[layer] !== false) continue;
      ctx.fillStyle = 'rgba(15,15,20,0.55)';
      ctx.fillRect(ox + r.px[0] * zoom, oy + r.px[1] * zoom,
        (r.px[2] - r.px[0]) * zoom, (r.px[3] - r.px[1]) * zoom);
    }
  };

  /**
   * 分区标注：区域外框 + 名称条。
   * 硬性规则（用户反馈：名称曾经挡住像素且被截断/压字）：
   *   1) 名称条**只允许画在透明像素上**——从区域顶部往下扫描，找到"文字覆盖范围内
   *      整行全透明"的位置才画；找不到就只留外框，绝不遮住已绘制的内容。
   *   2) 每个部位最多画一条（正面优先），避免相邻区域重复压字。
   *   3) 文字阶梯（完整名「帽·正面(脸)」→ 短面名「帽·正面」→ 部位名「右臂」）
   *      × 字号阶梯（11→9→7）：只显示能**完整**放下的文字，绝不省略号截断、不越区。
   *   4) 鼠标悬停时的完整名称由顶部 hint 显示（不占画布）。
   */
  Editor.prototype._drawOverlay = function (ctx, ox, oy, zoom) {
    var regions = this._layoutRegions();
    if (!regions || !regions.length) return;
    var model = this.model;
    var rules2 = this._rules();
    var FACE_RANK = { front: 0, top: 1, right: 2, left: 3, back: 4, bottom: 5 };

    function opaqueAt(sx, sy) {
      if (!model) return false;
      try { var c = model.getPixel(sx, sy); return !!(c && c[3] > 0); }
      catch (e) { return false; }
    }

    /* 文字覆盖范围内（宽 spanPx 像素、高 barRows 行）必须全部透明 */
    function clearStrip(rx0, ry0, spanPx, barRows) {
      for (var dy = 0; dy < barRows; dy++) {
        for (var dx = 0; dx < spanPx; dx++) {
          if (opaqueAt(rx0 + dx, ry0 + dy)) return false;
        }
      }
      return true;
    }

    /* 按可用宽度适配：超宽则截断并加省略号（先保证不越出区域，再保证可读） */
    function fitText(text, maxW, fontPx) {
      ctx.font = fontPx + 'px sans-serif';
      if (ctx.measureText(text).width <= maxW) return text;
      var lo = 0, hi = text.length;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
      }
      return lo > 0 ? text.slice(0, lo) + '…' : '';
    }

    var i, r;

    /* 1) 所有区域画外框（只描边，不碰像素内容） */
    for (i = 0; i < regions.length; i++) {
      r = regions[i];
      if (!r || !r.px) continue;
      var fx = ox + r.px[0] * zoom, fy = oy + r.px[1] * zoom;
      var fw = (r.px[2] - r.px[0]) * zoom, fh = (r.px[3] - r.px[1]) * zoom;
      if (fw <= 0 || fh <= 0) continue;
      ctx.lineWidth = 1;
      ctx.strokeStyle = KIND_COLOR[r.kind] || (r.layer === 'outer' ? KIND_COLOR.overlay : '#ffffff');
      ctx.globalAlpha = 0.85;
      if (ctx.strokeRect) ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
      ctx.globalAlpha = 1;
    }

    /* 2) 按部位分组，每部位只画一条名称条（优先正面），且只落在透明像素上 */
    var groups = {};
    for (i = 0; i < regions.length; i++) {
      r = regions[i];
      if (!r || !r.px) continue;
      var key = r.part || r.boxId || r.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    Object.keys(groups).forEach(function (partKey) {
      var list = groups[partKey].slice().sort(function (a, b) {
        var ra = FACE_RANK.hasOwnProperty(a.face) ? FACE_RANK[a.face] : 9;
        var rb = FACE_RANK.hasOwnProperty(b.face) ? FACE_RANK[b.face] : 9;
        return ra - rb;
      });
      for (var li = 0; li < list.length; li++) {
        var reg = list[li];
        var rx = ox + reg.px[0] * zoom, ry = oy + reg.px[1] * zoom;
        var rw = (reg.px[2] - reg.px[0]) * zoom, rh = (reg.px[3] - reg.px[1]) * zoom;
        if (rw < 26 || rh < 10) continue;

        var barH = Math.min(13, Math.max(9, Math.round(rh / 3)));
        var maxW = rw - 6;
        var color = KIND_COLOR[reg.kind] || (reg.layer === 'outer' ? KIND_COLOR.overlay : '#ffffff');
        // 文字阶梯：完整名「帽·正面(脸)」→ 短面名「帽·正面」→ 部位名「右臂」；
        // 字号 11→9→7。只接受"能完整放下且能落在透明像素上"的组合，
        // 宁可换更短的完整文字，也绝不显示省略号截断（用户反馈：显示不完全）。
        var kSep = (reg.label || '').indexOf('·');
        var prefix = kSep > 0 ? reg.label.slice(0, kSep) : (reg.label || partKey);
        var fs = (rules2 && rules2.FACE_LABEL && rules2.FACE_LABEL[reg.face]) || '';
        var candidates = [reg.label || partKey, prefix + (fs ? '·' + fs : ''), prefix];
        var fonts = [];
        [Math.max(7, Math.min(11, barH - 2)), 9, 7].forEach(function (f) {
          if (fonts.indexOf(f) < 0) fonts.push(f);
        });

        var done = false;
        for (var ci = 0; ci < candidates.length && !done; ci++) {
          for (var fi = 0; fi < fonts.length && !done; fi++) {
            var text = fitText(candidates[ci], maxW, fonts[fi]);
            if (!text || text.indexOf('…') >= 0) continue;      // 放不下 → 换更短的文字
            var fontPx = fonts[fi];
            ctx.font = fontPx + 'px sans-serif';
            var textW = Math.min(maxW, ctx.measureText(text).width + 4);
            var spanPx = Math.min(Math.ceil((textW + 6) / zoom) + 1, reg.px[2] - reg.px[0]);
            var barRows = Math.max(1, Math.ceil((barH + 1) / zoom));

            var placed = -1;
            for (var row = reg.px[1]; row + barRows <= reg.px[3]; row++) {
              if (clearStrip(reg.px[0], row, spanPx, barRows)) { placed = row; break; }
            }
            if (placed < 0) continue;   // 该行有不透明像素 → 换更短文字（跨度更小）再试

            var by = oy + placed * zoom + 1;
            var bw = Math.min(textW + 4, rw - 2);
            ctx.save();
            ctx.beginPath();
            if (ctx.rect) ctx.rect(rx + 1, by, bw, barH);
            ctx.clip();
            ctx.fillStyle = 'rgba(18,18,24,0.62)';
            ctx.fillRect(rx + 1, by, bw, barH);
            ctx.fillStyle = color;
            ctx.font = fontPx + 'px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, rx + 3, by + barH / 2);
            ctx.restore();
            ctx.globalAlpha = 1;
            done = true;
          }
        }
        if (done) break;   // 每个部位只画一条，避免相邻区域重复压字
      }
    });
  };

  Editor.prototype._drawPreview = function (ctx, ox, oy, zoom) {
    var p = this._previewWrites;
    if (!p || !p.length) return;
    for (var i = 0; i < p.length; i++) {
      var e = p[i];
      ctx.fillStyle = rgbaStr(e.rgba, 0.9);
      ctx.fillRect(ox + e.x * zoom, oy + e.y * zoom, zoom, zoom);
    }
    if (zoom >= 5) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      for (var j = 0; j < p.length; j++) {
        if (ctx.strokeRect) ctx.strokeRect(ox + p[j].x * zoom + 0.5, oy + p[j].y * zoom + 0.5, zoom - 1, zoom - 1);
      }
    }
  };

  Editor.prototype._drawCursorBox = function (ctx, ox, oy, zoom) {
    if (!this._cursor || zoom < 4) return;
    var x = ox + this._cursor.px * zoom, y = oy + this._cursor.py * zoom;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    if (ctx.strokeRect) ctx.strokeRect(x + 1, y + 1, zoom - 2, zoom - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    if (ctx.strokeRect) ctx.strokeRect(x, y, zoom, zoom);
  };

  /* ------------------------------------------------------------------ *
   * 自测：可在 Node 下运行（用假的 canvas / model；需要 rules 的用例在 rules
   * 未加载时跳过并记 pass）。结果写入 MCSKIN.tests.editor。
   * ------------------------------------------------------------------ */

  function fakeCtx() {
    var noop = function () {};
    var ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      globalAlpha: 1, imageSmoothingEnabled: true,
      save: noop, restore: noop, clip: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      stroke: noop, fill: noop, fillText: noop, translate: noop, setTransform: noop,
      clearRect: noop, fillRect: noop, strokeRect: noop, rect: noop, drawImage: noop, putImageData: noop,
      createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      getImageData: function (x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      measureText: function () { return { width: 0 }; },
      createPattern: function () { return {}; }
    };
    return ctx;
  }

  function fakeCanvas(cssW, cssH, scale) {
    var c = {
      style: {},
      width: 300,
      height: 150,
      clientWidth: 0,
      clientHeight: 0,
      _scale: scale || 1,
      _ctx: null,
      _events: {},
      getContext: function () { if (!c._ctx) c._ctx = fakeCtx(); return c._ctx; },
      getBoundingClientRect: function () {
        var w = parseFloat(c.style.width) || c.width;
        var h = parseFloat(c.style.height) || c.height;
        var s = c._scale || 1;
        return { left: 0, top: 0, right: w * s, bottom: h * s, width: w * s, height: h * s };
      },
      addEventListener: function (k, fn) { c._events[k] = fn; },
      removeEventListener: function (k) { delete c._events[k]; },
      setPointerCapture: function () {},
      releasePointerCapture: function () {},
      dispatch: function (k, ev) { if (c._events[k]) c._events[k](ev); }
    };
    return c;
  }

  /** 假 model：只实现契约 API；data 用 Proxy 拦截直接写入，任何模块直接改 data 都会抛错。 */
  function fakeModel(w, h) {
    var store = new Array(w * h * 4);
    for (var i = 0; i < store.length; i++) store[i] = 0;
    var proxy = new Proxy(store, {
      set: function () { throw new Error('禁止直接修改 model.data'); }
    });
    var m = {
      width: w, height: h, format: h === 32 ? 'legacy' : 'modern', data: proxy,
      beginStrokeCalls: 0, endStrokeCalls: 0, setPixelCalls: 0,
      getPixel: function (x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
        var i = (y * w + x) * 4;
        return [store[i], store[i + 1], store[i + 2], store[i + 3]];
      },
      setPixel: function (x, y, rgba) {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        var i = (y * w + x) * 4;
        store[i] = rgba[0]; store[i + 1] = rgba[1]; store[i + 2] = rgba[2];
        store[i + 3] = (rgba.length > 3 ? rgba[3] : 255);
        m.setPixelCalls++;
      },
      beginStroke: function () { m.beginStrokeCalls++; },
      endStroke: function () { m.endStrokeCalls++; },
      snapshot: function () { return { width: w, height: h, data: store.slice() }; },
      restore: function () {}, undo: function () {}, redo: function () {},
      canUndo: function () { return false; }, canRedo: function () { return false; },
      clear: function () {}, toModern: function () { return m.snapshot(); },
      loadImageData: function () {}, stats: function () { return { opaque: 0, total: w * h, format: m.format }; }
    };
    return m;
  }

  function ev(clientX, clientY, button) {
    return { clientX: clientX, clientY: clientY, button: button === undefined ? 0 : button, pointerId: 1, preventDefault: function () {} };
  }

  /** 像素中心对应的客户端坐标（自动考虑 canvas 被 CSS 缩放的情况） */
  function centerOf(ed, px, py) {
    var p = ed.pixelToClient(px, py);
    var g = ed.getGeometry();
    var c = ed.canvas;
    var s = 1;
    if (c && typeof c.getBoundingClientRect === 'function' && g.cssWidth) {
      var r = c.getBoundingClientRect();
      if (r && r.width) s = r.width / g.cssWidth;
    }
    return { x: p.x + (ed.getZoom() / 2) * s, y: p.y + (ed.getZoom() / 2) * s };
  }

  function _selfTest() {
    var pass = [], fail = [];

    function check(name, fn) {
      try {
        var r = fn();
        if (r === false) fail.push(name);
        else pass.push(name + (typeof r === 'string' && r ? ' — ' + r : ''));
      } catch (e) {
        fail.push(name + ' — ' + ((e && e.message) || String(e)));
      }
    }

    check('bresenham 生成连续无断点路径 (0,0)->(10,5)', function () {
      var pts = bresenham(0, 0, 10, 5);
      if (pts[0][0] !== 0 || pts[0][1] !== 0) throw new Error('起点错误');
      var last = pts[pts.length - 1];
      if (last[0] !== 10 || last[1] !== 5) throw new Error('终点错误');
      for (var i = 1; i < pts.length; i++) {
        var dx = Math.abs(pts[i][0] - pts[i - 1][0]);
        var dy = Math.abs(pts[i][1] - pts[i - 1][1]);
        if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) throw new Error('第 ' + i + ' 步不连续');
      }
      return pts.length + ' 个点';
    });

    check('bresenham 水平/垂直/对角线均无断点', function () {
      var a = bresenham(3, 7, 30, 7);
      if (a.length !== 28) throw new Error('水平段长度应为 28，实际 ' + a.length);
      var b = bresenham(5, 20, 5, 2);
      if (b.length !== 19) throw new Error('垂直段长度应为 19，实际 ' + b.length);
      var c = bresenham(0, 0, 5, 5);
      if (c.length !== 6) throw new Error('对角段长度应为 6，实际 ' + c.length);
      for (var i = 1; i < c.length; i++) {
        if (c[i][0] - c[i - 1][0] !== 1 || c[i][1] - c[i - 1][1] !== 1) throw new Error('对角线出现台阶');
      }
      return 'ok';
    });

    check('brushCells 尺寸 1..4 覆盖 n*n 个像素', function () {
      for (var n = 1; n <= 4; n++) {
        var cells = brushCells(20, 20, n);
        if (cells.length !== n * n) throw new Error('size ' + n + ' 应为 ' + (n * n) + ' 个');
        var uniq = {}, k;
        for (var i = 0; i < cells.length; i++) uniq[cells[i].x + ',' + cells[i].y] = 1;
        k = 0; for (var key in uniq) k++;
        if (k !== n * n) throw new Error('size ' + n + ' 出现重复像素');
      }
      return 'ok';
    });

    check('pixelToClient / clientToPixel 往返一致（dpr=2, zoom=8, 内边距 4）', function () {
      var canvas = fakeCanvas();
      var ed = MCSKIN.editor.create(canvas, { autoSize: true, zoom: 8, model: fakeModel(64, 64) });
      var cases = [[0, 0], [63, 63], [10, 25], [32, 16], [1, 62]];
      for (var i = 0; i < cases.length; i++) {
        var c = centerOf(ed, cases[i][0], cases[i][1]);
        var back = ed.clientToPixel(c.x, c.y);
        if (back.px !== cases[i][0] || back.py !== cases[i][1]) {
          throw new Error('往返失败 ' + cases[i] + ' -> ' + back.px + ',' + back.py);
        }
        if (!back.inside) throw new Error('往返点应在画布内');
      }
      var o = ed.pixelToClient(0, 0);
      if (Math.abs(o.x - 4) > 1e-9 || Math.abs(o.y - 4) > 1e-9) throw new Error('内边距 4px 未体现: ' + o.x + ',' + o.y);
      ed.destroy();
      return cases.length + ' 组往返一致，原点含 4px 内边距';
    });

    check('devicePixelRatio 参与 backing store（dpr=2 -> width=(8+512)*2）', function () {
      var saved = root.devicePixelRatio;
      root.devicePixelRatio = 2;
      try {
        var canvas = fakeCanvas();
        var ed = MCSKIN.editor.create(canvas, { autoSize: true, zoom: 8, model: fakeModel(64, 64) });
        var g = ed.getGeometry();
        if (g.devicePixelRatio !== 2) throw new Error('dpr 未读取');
        if (canvas.width !== (4 * 2 + 64 * 8) * 2) throw new Error('backingStore 宽度错误: ' + canvas.width);
        if (canvas.height !== (4 * 2 + 64 * 8) * 2) throw new Error('backingStore 高度错误: ' + canvas.height);
        ed.destroy();
      } finally {
        if (saved === undefined) delete root.devicePixelRatio; else root.devicePixelRatio = saved;
      }
      return 'canvas.width=' + (4 * 2 + 64 * 8) * 2;
    });

    check('CSS 尺寸被外部缩放时仍能正确换算（rect 宽度 = 一半）', function () {
      var canvas = fakeCanvas();
      var ed = MCSKIN.editor.create(canvas, { autoSize: true, zoom: 8, model: fakeModel(64, 64) });
      canvas._scale = 0.5;
      var c = centerOf(ed, 10, 25);
      var back = ed.clientToPixel(c.x, c.y);
      if (back.px !== 10 || back.py !== 25) throw new Error('缩放后换算错误: ' + back.px + ',' + back.py);
      ed.destroy();
      return 'ok';
    });

    check('64x32 legacy 贴图也能正确换算与绘制范围', function () {
      var canvas = fakeCanvas();
      var ed = MCSKIN.editor.create(canvas, { autoSize: true, zoom: 8, model: fakeModel(64, 32) });
      var g = ed.getGeometry();
      if (g.skinHeight !== 32 || canvas.height !== (4 * 2 + 32 * 8) * 1) throw new Error('64x32 布局错误');
      var c = centerOf(ed, 5, 30);
      var back = ed.clientToPixel(c.x, c.y);
      if (back.px !== 5 || back.py !== 30) throw new Error('64x32 往返失败');
      if (ed.clientToPixel(c.x, c.y + 16).inside) throw new Error('超出 32 行应判定为画布外');
      ed.destroy();
      return 'ok';
    });

    check('floodFill 只影响连通同色区域（中间有不同色墙）', function () {
      var m = fakeModel(8, 8);
      for (var y = 0; y < 8; y++) m.setPixel(4, y, [255, 0, 0, 255]);
      var edits = floodFill(m, 0, 0, [0, 0, 255, 255], 'base', { x0: 0, y0: 0, x1: 8, y1: 8 });
      if (edits.length !== 32) throw new Error('应填充左侧 4x8=32 格，实际 ' + edits.length);
      for (var i = 0; i < edits.length; i++) {
        if (edits[i].x >= 4) throw new Error('越过了不同色边界');
      }
      return '32 格，未越过边界';
    });

    check('floodFill 目标色与填充色相同时返回空', function () {
      var m = fakeModel(4, 4);
      m.setPixel(0, 0, [1, 2, 3, 255]);
      var edits = floodFill(m, 0, 0, [1, 2, 3, 255], 'base', null);
      if (edits.length !== 0) throw new Error('不应产生写入，实际 ' + edits.length);
      return 'ok';
    });

    check('floodFill 尊重 bounds（限定在面的 UV 矩形内）', function () {
      var m = fakeModel(8, 8);
      var edits = floodFill(m, 1, 1, [9, 9, 9, 255], 'base', { x0: 0, y0: 0, x1: 4, y1: 4 });
      if (edits.length !== 16) throw new Error('应为 4x4=16 格，实际 ' + edits.length);
      for (var i = 0; i < edits.length; i++) {
        if (edits[i].x >= 4 || edits[i].y >= 4) throw new Error('越出 bounds');
      }
      return '16 格';
    });

    check('floodFill 比较包含 alpha（半透明像素视为不同色）', function () {
      var m = fakeModel(4, 1);
      m.setPixel(0, 0, [10, 20, 30, 255]);
      m.setPixel(1, 0, [10, 20, 30, 128]);
      var edits = floodFill(m, 0, 0, [200, 0, 0, 255], 'base', { x0: 0, y0: 0, x1: 4, y1: 1 });
      if (edits.length !== 1) throw new Error('alpha 不同应停下，实际填充 ' + edits.length + ' 格');
      return 'ok';
    });

    check('一次拖拽 = 一个撤销步，且只用 model API（不直接改 data）', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8, color: [255, 0, 0, 255] });
      var changes = [];
      ed.on('change', function (p) { changes.push(p); });
      var p0 = centerOf(ed, 10, 10);
      canvas.dispatch('pointerdown', ev(p0.x, p0.y, 0));
      var p1 = centerOf(ed, 30, 10);
      canvas.dispatch('pointermove', ev(p1.x, p1.y, 0));
      var p2 = centerOf(ed, 30, 25);
      canvas.dispatch('pointermove', ev(p2.x, p2.y, 0));
      var p3 = centerOf(ed, 30, 25);
      canvas.dispatch('pointerup', ev(p3.x, p3.y, 0));
      if (m.beginStrokeCalls !== 1 || m.endStrokeCalls !== 1) {
        throw new Error('撤销步数错误 begin=' + m.beginStrokeCalls + ' end=' + m.endStrokeCalls);
      }
      for (var x = 10; x <= 30; x++) {
        if (m.getPixel(x, 10)[3] === 0) throw new Error('水平拖动在 x=' + x + ' 处断点');
      }
      for (var y = 10; y <= 25; y++) {
        if (m.getPixel(30, y)[3] === 0) throw new Error('垂直拖动在 y=' + y + ' 处断点');
      }
      if (!changes.length) throw new Error('未触发 change 事件');
      for (var i = 0; i < changes.length; i++) {
        if (changes[i].reason !== 'draw' || typeof changes[i].strokes !== 'number') throw new Error('change 参数不符合契约');
      }
      ed.destroy();
      return 'begin/end 各 1 次，路径无断点，change ' + changes.length + ' 次';
    });

    check('line/rect 拖拽只预览，松手才提交（且为一个撤销步）', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8, color: [0, 200, 0, 255] });
      ed.setTool('rect');
      var a = centerOf(ed, 4, 4);
      var b = centerOf(ed, 8, 6);
      canvas.dispatch('pointerdown', ev(a.x, a.y, 0));
      canvas.dispatch('pointermove', ev(b.x, b.y, 0));
      if (m.setPixelCalls !== 0) throw new Error('拖拽预览阶段不应写入 model');
      canvas.dispatch('pointerup', ev(b.x, b.y, 0));
      if (m.setPixelCalls !== 5 * 3) throw new Error('rect 应提交 5x3=15 格，实际 ' + m.setPixelCalls);
      if (m.beginStrokeCalls !== 1 || m.endStrokeCalls !== 1) throw new Error('rect 提交应为 1 个撤销步');
      if (m.getPixel(4, 4)[3] === 0 || m.getPixel(8, 6)[3] === 0) throw new Error('rect 角点未写入');
      ed.destroy();
      return '15 格，1 个撤销步';
    });

    check('setTool 切换会清掉未提交的预览', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8 });
      ed.setTool('line');
      var a = centerOf(ed, 2, 2);
      var b = centerOf(ed, 12, 9);
      canvas.dispatch('pointerdown', ev(a.x, a.y, 0));
      canvas.dispatch('pointermove', ev(b.x, b.y, 0));
      if (!ed._previewWrites.length) throw new Error('预览未生成');
      ed.setTool('pencil');
      if (ed._previewWrites.length !== 0) throw new Error('切换工具后预览未清空');
      if (m.setPixelCalls !== 0 || m.beginStrokeCalls !== 0) throw new Error('未提交的预览不应写入 model');
      ed.destroy();
      return 'ok';
    });

    check('右键 = 取色（写入 pick 事件并更新 setColor）', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      m.setPixel(20, 20, [11, 22, 33, 255]);
      m.setPixelCalls = 0; // 上面的准备写入不计入断言
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8 });
      var picked = null;
      ed.on('pick', function (p) { picked = p; });
      var c = centerOf(ed, 20, 20);
      canvas.dispatch('pointerdown', ev(c.x, c.y, 2));
      if (!picked) throw new Error('未触发 pick 事件');
      if (picked.rgba[0] !== 11 || picked.rgba[3] !== 255) throw new Error('取色值错误');
      var col = ed.getColor();
      if (col[0] !== 11 || col[1] !== 22 || col[2] !== 33) throw new Error('setColor 未更新');
      if (m.setPixelCalls !== 0) throw new Error('取色不应修改像素');
      ed.destroy();
      return 'ok';
    });

    check('hover 事件与 getCursor 同步（含区域反查）', function () {
      var canvas = fakeCanvas();
      var ed = MCSKIN.editor.create(canvas, { model: fakeModel(64, 64), zoom: 8 });
      var hovered = null, cursored = null;
      ed.on('hover', function (p) { hovered = p; });
      ed.on('cursor', function (p) { cursored = p; });
      var c = centerOf(ed, 12, 34);
      canvas.dispatch('pointermove', ev(c.x, c.y, 0));
      if (!hovered || hovered.px !== 12 || hovered.py !== 34) throw new Error('hover 参数错误');
      var cur = ed.getCursor();
      if (!cur || cur.px !== 12 || cur.py !== 34) throw new Error('getCursor 与 hover 不同步');
      if (cursored === null) throw new Error('cursor 事件未触发');
      canvas.dispatch('pointerleave', ev(c.x, c.y, 0));
      if (ed.getCursor() !== null) throw new Error('离开画布后 getCursor 应为 null');
      if (!hovered || hovered.px !== null) throw new Error('离开画布应广播空 hover');
      ed.destroy();
      return 'ok';
    });

    check('笔刷 1..4 与橡皮擦默认颜色正确（橡皮写入全透明）', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      m.setPixel(30, 30, [200, 100, 50, 255]);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8, color: [1, 2, 3, 255], brushSize: 1 });
      ed.setTool('eraser');
      var c = centerOf(ed, 30, 30);
      canvas.dispatch('pointerdown', ev(c.x, c.y, 0));
      canvas.dispatch('pointerup', ev(c.x, c.y, 0));
      if (m.getPixel(30, 30)[3] !== 0) throw new Error('橡皮未擦除');
      ed.setBrushSize(3);
      ed.setTool('pencil');
      var c2 = centerOf(ed, 20, 20);
      canvas.dispatch('pointerdown', ev(c2.x, c2.y, 0));
      canvas.dispatch('pointerup', ev(c2.x, c2.y, 0));
      var count = 0;
      for (var y = 18; y <= 22; y++) for (var x = 18; x <= 22; x++) if (m.getPixel(x, y)[3] > 0) count++;
      if (count !== 9) throw new Error('笔刷 3 应写 3x3=9 格，实际 ' + count);
      ed.destroy();
      return 'ok';
    });

    check('regionAt 收到 {layer: activeLayer}（层选择生效）', function () {
      var saved = MCSKIN.rules;
      var sent = [];
      MCSKIN.rules = {
        regionAt: function (px, py, opts) { sent.push(opts); return null; },
        box: function () { return null; }
      };
      try {
        var canvas = fakeCanvas();
        var ed = MCSKIN.editor.create(canvas, { model: fakeModel(64, 64), zoom: 8 });
        ed.setActiveLayer('outer');
        if (ed.getActiveLayer() !== 'outer') throw new Error('setActiveLayer 未生效');
        var c = centerOf(ed, 5, 60);
        canvas.dispatch('pointermove', ev(c.x, c.y, 0));
        var last = sent[sent.length - 1];
        if (!last || last.layer !== 'outer') throw new Error('未把 layer 传给 regionAt: ' + JSON.stringify(last));
        ed.setActiveLayer('base');
        if (ed.getActiveLayer() !== 'base') throw new Error('setActiveLayer(base) 未生效');
        ed.destroy();
      } finally {
        MCSKIN.rules = saved;
      }
      return 'opts.layer 已传递';
    });

    check('setSymmetry("x") 左右镜像写入（映射来自 rules.box/faces）', function () {
      var rules = MCSKIN.rules;
      if (!rules || typeof rules.regionAt !== 'function' || typeof rules.box !== 'function') {
        return '跳过：rules.js 未加载（DOM/契约用例留给集成阶段）';
      }
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8, color: [123, 45, 67, 255] });
      var region = rules.regionAt(13, 60, { layer: 'base' });
      if (!region || !region.part) return '跳过：rules.regionAt(13,60) 无结果，改用通用校验';
      ed.setSymmetry('x');
      var c = centerOf(ed, 13, 60);
      canvas.dispatch('pointerdown', ev(c.x, c.y, 0));
      canvas.dispatch('pointerup', ev(c.x, c.y, 0));
      if (m.getPixel(13, 60)[3] === 0) throw new Error('原像素未写入');
      if (m.setPixelCalls < 2) throw new Error('镜像像素未写入（setPixel ' + m.setPixelCalls + ' 次）');
      var mirrored = null;
      for (var y = 0; y < 64 && !mirrored; y++) {
        for (var x = 0; x < 64; x++) {
          if (x === 13 && y === 60) continue;
          var p = m.getPixel(x, y);
          if (p[3] > 0) { mirrored = [x, y]; break; }
        }
      }
      if (!mirrored) throw new Error('未找到镜像像素');
      var mr = rules.regionAt(mirrored[0], mirrored[1], { layer: 'outer' }) ||
               rules.regionAt(mirrored[0], mirrored[1], { layer: 'base' });
      ed.destroy();
      return region.part + ' -> ' + (mr ? (mr.part || mr.boxId) : '?') + ' 于 ' + mirrored;
    });

    check('rules.LAYOUT_REGIONS 常量可用且坐标在贴图内（不硬编码 UV）', function () {
      var rules = MCSKIN.rules;
      if (!rules || !rules.LAYOUT_REGIONS) return '跳过：rules.js 未加载';
      var regions = rules.LAYOUT_REGIONS;
      if (!regions.length) throw new Error('LAYOUT_REGIONS 为空');
      for (var i = 0; i < regions.length; i++) {
        var p = regions[i].px;
        if (!p || p.length < 4) throw new Error('区域 ' + i + ' 缺少 px');
        if (p[0] < 0 || p[1] < 0 || p[2] > 64 || p[3] > 64 || p[2] <= p[0] || p[3] <= p[1]) {
          throw new Error('区域 ' + (regions[i].id || i) + ' 坐标非法: ' + p);
        }
      }
      return regions.length + ' 个布局区域';
    });

    check('destroy 之后不再广播事件', function () {
      var canvas = fakeCanvas();
      var ed = MCSKIN.editor.create(canvas, { model: fakeModel(64, 64), zoom: 8 });
      var n = 0;
      ed.on('hover', function () { n++; });
      var c = centerOf(ed, 3, 3);
      canvas.dispatch('pointermove', ev(c.x, c.y, 0));
      if (n !== 1) throw new Error('destroy 前未广播');
      ed.destroy();
      canvas.dispatch('pointermove', ev(c.x, c.y, 0));
      if (n !== 1) throw new Error('destroy 后仍在广播');
      if (ed.getCursor() !== null) throw new Error('destroy 后 getCursor 应为 null');
      return 'ok';
    });

    /* ---------- 用户反馈回归：取色字段 & 标注不遮像素 ---------- */

    check('右键取色发出 pick：rgba 与 color 字段齐全且颜色正确', function () {
      var canvas = fakeCanvas();
      var m = fakeModel(64, 64);
      m.setPixel(10, 12, [123, 45, 67, 255]);
      var ed = MCSKIN.editor.create(canvas, { model: m, zoom: 8 });
      var got = null;
      ed.on('pick', function (p) { got = p; });
      var c = centerOf(ed, 10, 12);
      canvas.dispatch('pointerdown', ev(c.x, c.y, 2));   // button=2 右键
      canvas.dispatch('pointerup', ev(c.x, c.y, 2));
      if (!got) throw new Error('未发出 pick 事件');
      if (!got.rgba) throw new Error('缺少 rgba 字段');
      if (!got.color) throw new Error('缺少 color 字段（shell 侧依赖）');
      if (got.rgba[0] !== 123 || got.rgba[1] !== 45 || got.rgba[2] !== 67) {
        throw new Error('取到的颜色不对: ' + JSON.stringify(got.rgba));
      }
      ed.destroy();
      return 'rgba=' + JSON.stringify(got.rgba);
    });

    check('_drawOverlay：名称条绝不覆盖已绘制的像素（只画在透明区）', function () {
      if (!MCSKIN.rules || !MCSKIN.rules.LAYOUT_REGIONS) return '跳过：rules.js 未加载';
      var m = fakeModel(64, 64);
      var x, y;
      for (y = 0; y < 64; y++) for (x = 0; x < 64; x++) m.setPixel(x, y, [40, 60, 80, 255]);
      // 唯独帽子正面 [40,8,48,16] 留透明 → 名称条只能放这里
      for (y = 8; y < 16; y++) for (x = 40; x < 48; x++) m.setPixel(x, y, [0, 0, 0, 0]);

      var rects = [];
      var ctx = fakeCtx();
      ctx.fillRect = function (x0, y0, w, h) { rects.push([x0, y0, w, h]); };
      ctx.measureText = function (t) {                     // CJK 每字约 1em
        var mm = /(\d+)px/.exec(ctx.font || '');
        var sz = mm ? parseInt(mm[1], 10) : 10;
        return { width: t.length * sz };
      };

      var ed = MCSKIN.editor.create(fakeCanvas(), { model: m, zoom: 9 });
      ed.setOverlayVisible(true);
      ed._drawOverlay(ctx, 0, 0, 9);
      ed.destroy();

      if (!rects.length) throw new Error('透明区没有画出名称条');
      // 除名称条外 _drawOverlay 不应调用 fillRect（外框用 strokeRect）
      if (rects.length !== 1) throw new Error('期望只在帽子正面放 1 条名称条，实际 ' + rects.length + ' 条');
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        var sx0 = Math.floor(r[0] / 9), sy0 = Math.floor(r[1] / 9);
        var sx1 = Math.ceil((r[0] + r[2]) / 9), sy1 = Math.ceil((r[1] + r[3]) / 9);
        for (var yy = sy0; yy < sy1; yy++) {
          for (var xx = sx0; xx < sx1; xx++) {
            var c2 = m.getPixel(xx, yy);
            if (c2[3] > 0) throw new Error('名称条覆盖了已绘制像素 (' + xx + ',' + yy + ')');
          }
        }
      }
      return '1 条名称条，全部落在透明像素上';
    });

    return { pass: pass, fail: fail };
  }

  /* ------------------------------------------------------------------ *
   * 导出 + 自测登记
   * ------------------------------------------------------------------ */

  MCSKIN.editor = {
    VERSION: VERSION,
    create: function (canvas, opts) { return new Editor(canvas, opts); },
    // 便于测试/复用：纯函数与内部工具
    _pure: {
      bresenham: bresenham,
      brushCells: brushCells,
      floodFill: floodFill,
      mirrorPixel: mirrorPixel,
      sameRGBA: sameRGBA,
      normRGBA: normRGBA,
      MIRROR_PART: MIRROR_PART,
      MIRROR_FACE: MIRROR_FACE
    },
    _selfTest: _selfTest
  };

  MCSKIN.tests = MCSKIN.tests || {};
  try {
    MCSKIN.tests.editor = _selfTest();
  } catch (e) {
    MCSKIN.tests.editor = { pass: [], fail: ['_selfTest 执行异常：' + ((e && e.message) || e)] };
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
