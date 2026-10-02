/* util.js — 通用小工具（颜色、像素、DOM、PNG 编解码辅助）
 * 归属：Lead。全局命名空间 MCSKIN.util
 * 不使用 ES module 语法。
 */
(function () {
  'use strict';
  window.MCSKIN = window.MCSKIN || {};
  var tests = { pass: [], fail: [] };
  function ok(name, cond) { (cond ? tests.pass : tests.fail).push(name); }

  /* ---------------- 颜色 ---------------- */

  function clamp255(v) {
    v = Math.round(v);
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  function rgbaToCss(rgba) {
    return 'rgba(' + clamp255(rgba[0]) + ',' + clamp255(rgba[1]) + ',' + clamp255(rgba[2]) + ',' +
      (Math.round((rgba[3] / 255) * 1000) / 1000) + ')';
  }

  function rgbToHex(rgba) {
    function h(v) { var s = clamp255(v).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h(rgba[0]) + h(rgba[1]) + h(rgba[2]);
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexToRgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    if (!rgb) return [0, 0, 0, 255];
    return [rgb[0], rgb[1], rgb[2], alpha === undefined ? 255 : clamp255(alpha)];
  }

  function cssToRgba(css) {
    var s = String(css).trim();
    if (s.charAt(0) === '#') {
      var rgba = hexToRgba(s, 255);
      return rgba;
    }
    var m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (!m) return [0, 0, 0, 255];
    var parts = m[1].split(',').map(function (p) { return parseFloat(p); });
    return [clamp255(parts[0]), clamp255(parts[1] || 0), clamp255(parts[2] || 0),
      parts.length > 3 ? clamp255(parts[3] * 255) : 255];
  }

  function sameColor(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }

  function mixColor(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t
    ].map(clamp255);
  }

  /* ---------------- 像素缓冲 ---------------- */

  function idx(width, x, y) { return (y * width + x) * 4; }

  function getPixel(data, width, x, y) {
    var i = idx(width, x, y);
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  function setPixel(data, width, x, y, rgba) {
    var i = idx(width, x, y);
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }

  function cloneData(data) {
    return new Uint8ClampedArray(data.length) .set
      ? (function () { var c = new Uint8ClampedArray(data.length); c.set(data); return c; })()
      : new Uint8ClampedArray(data);
  }

  function blankData(w, h) { return new Uint8ClampedArray(w * h * 4); }

  // 放大倍数整数倍（最近邻），用于 64×32 → 64×64 的关键区域转换
  function scaleUp(data, w, h, factor) {
    var out = new Uint8ClampedArray(w * factor * h * factor * 4);
    var W = w * factor;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = idx(w, x, y);
        var c = [data[s], data[s + 1], data[s + 2], data[s + 3]];
        for (var dy = 0; dy < factor; dy++) {
          for (var dx = 0; dx < factor; dx++) {
            setPixel(out, W, x * factor + dx, y * factor + dy, c);
          }
        }
      }
    }
    return out;
  }

  function flipHorizontal(data, x0, y0, x1, y1, w) {
    for (var y = y0; y < y1; y++) {
      for (var i = 0; i < Math.floor((x1 - x0) / 2); i++) {
        var xa = x0 + i, xb = x1 - 1 - i;
        var a = getPixel(data, w, xa, y);
        var b = getPixel(data, w, xb, y);
        setPixel(data, w, xa, y, b);
        setPixel(data, w, xb, y, a);
      }
    }
  }

  // Bresenham 直线（返回 [{x,y}]，含首尾），任意方向
  function linePoints(x0, y0, x1, y1) {
    var pts = [];
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0, y = y0, guard = 0;
    for (;;) {
      pts.push({ x: x, y: y });
      if (x === x1 && y === y1) break;
      if (++guard > 100000) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return pts;
  }

  function rectPoints(x0, y0, x1, y1) {
    var pts = [], x, y;
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (x = ax; x <= bx; x++) { pts.push({ x: x, y: ay }); pts.push({ x: x, y: by }); }
    for (y = ay; y <= by; y++) { pts.push({ x: ax, y: y }); pts.push({ x: bx, y: y }); }
    return pts;
  }

  /* ---------------- DOM ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ---------------- 其它 ---------------- */

  function download(filename, dataUrlOrBlob) {
    var a = document.createElement('a');
    a.href = (typeof dataUrlOrBlob === 'string') ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (typeof dataUrlOrBlob !== 'string') URL.revokeObjectURL(a.href);
      a.remove();
    }, 200);
  }

  // Uint8ClampedArray → canvas → dataURL
  function dataToDataURL(width, height, data) {
    var c = document.createElement('canvas');
    c.width = width; c.height = height;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(width, height);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  function dataToCanvas(width, height, data, scale) {
    scale = scale || 1;
    var src = document.createElement('canvas');
    src.width = width; src.height = height;
    src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    if (scale === 1) return src;
    var dst = document.createElement('canvas');
    dst.width = width * scale; dst.height = height * scale;
    var dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  }

  // 判断贴图是否为空（用于"未来应有的内容"检查）
  function dominantColors(data, width, x0, y0, x1, y1, limit) {
    var counts = {};
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var c = getPixel(data, width, x, y);
        var k = c.join(',');
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    var arr = Object.keys(counts).map(function (k) { return { color: k, n: counts[k] }; });
    arr.sort(function (a, b) { return b.n - a.n; });
    return arr.slice(0, limit || 8);
  }

  /* ---------------- 自测 ---------------- */

  function _selfTest() {
    ok('hexToRgba(#ff0000) = [255,0,0,255]', JSON.stringify(hexToRgba('#ff0000')) === '[255,0,0,255]');
    ok('rgbToHex 往返', rgbToHex(hexToRgba('#1a2b3c')) === '#1a2b3c');
    ok('cssToRgba(rgba(1,2,3,0.5))', (function () {
      var c = cssToRgba('rgba(1,2,3,0.5)');
      return c[0] === 1 && c[1] === 2 && c[2] === 3 && Math.abs(c[3] - 128) <= 1;
    })());
    ok('linePoints 水平连续且长度正确', (function () {
      var p = linePoints(0, 0, 4, 0);
      return p.length === 5 && p[4].x === 4 && p[4].y === 0;
    })());
    ok('linePoints 对角线不中断', (function () {
      var p = linePoints(0, 0, 3, 3);
      return p.length === 4 && p.every(function (q) { return q.x === q.y; });
    })());
    ok('scaleUp 放大 2 倍保留左上像素', (function () {
      var d = blankData(2, 2);
      setPixel(d, 2, 0, 0, [10, 20, 30, 255]);
      var s = scaleUp(d, 2, 2, 2);
      return JSON.stringify(getPixel(s, 4, 0, 0)) === '[10,20,30,255]' &&
        JSON.stringify(getPixel(s, 4, 1, 1)) === '[10,20,30,255]' &&
        JSON.stringify(getPixel(s, 4, 2, 0)) === '[0,0,0,0]';
    })());
    ok('flipHorizontal 正确镜像', (function () {
      var d = blankData(4, 1);
      setPixel(d, 4, 0, 0, [1, 2, 3, 255]);
      flipHorizontal(d, 0, 0, 4, 1, 4);
      return JSON.stringify(getPixel(d, 4, 3, 0)) === '[1,2,3,255]' &&
        JSON.stringify(getPixel(d, 4, 0, 0)) === '[0,0,0,0]';
    })());
    ok('rectPoints 覆盖四个角', (function () {
      var p = rectPoints(1, 1, 3, 3);
      var has = function (x, y) { return p.some(function (q) { return q.x === x && q.y === y; }); };
      return has(1, 1) && has(3, 1) && has(3, 3) && has(1, 3);
    })());
    ok('sameColor 正确比较', sameColor([1, 2, 3, 4], [1, 2, 3, 4]) && !sameColor([1, 2, 3, 4], [1, 2, 3, 5]));

    window.MCSKIN.tests = window.MCSKIN.tests || {};
    window.MCSKIN.tests.util = tests;
    return tests;
  }

  window.MCSKIN.util = {
    VERSION: '1.0',
    clamp255: clamp255,
    rgbaToCss: rgbaToCss,
    rgbToHex: rgbToHex,
    hexToRgb: hexToRgb,
    hexToRgba: hexToRgba,
    cssToRgba: cssToRgba,
    sameColor: sameColor,
    mixColor: mixColor,
    idx: idx,
    getPixel: getPixel,
    setPixel: setPixel,
    cloneData: cloneData,
    blankData: blankData,
    scaleUp: scaleUp,
    flipHorizontal: flipHorizontal,
    linePoints: linePoints,
    rectPoints: rectPoints,
    $: $,
    $$: $$,
    el: el,
    download: download,
    dataToDataURL: dataToDataURL,
    dataToCanvas: dataToCanvas,
    dominantColors: dominantColors,
    _selfTest: _selfTest
  };
})();
