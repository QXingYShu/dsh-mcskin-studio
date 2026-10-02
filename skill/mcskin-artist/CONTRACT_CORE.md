# mcskin-artist 接口附录：`bin/skin-core.mjs`（Core ↔ CLI 分工）

> 背景：原计划 `bin/skin.mjs` 单文件实现，因单个代理一次产出过大而反复失败。
> 现拆成两层，**两个文件由不同人写，接口如下（Lead 维护）**：
>
> - `bin/skin-core.mjs` —— **Lead 实现**：纯函数库（无命令行副作用、不读 argv、不写 stdout）。
> - `bin/skin.mjs` —— **cli-main 实现**：命令行外壳（解析 argv、调度 core、`run` 批量、stdout JSON）。

## 1. `bin/skin-core.mjs` 导出（Lead 保证，cli-main 直接调用）

```js
// —— 解析 ——
parseColor(str) -> [r,g,b,a] | null        // '#rgb' | '#rrggbb' | '#rrggbbaa' | 'r,g,b' | 'r,g,b,a'
parseCoord(str) -> {x,y} | null            // 'x,y'
parseRect(str)  -> {x0,y0,x1,y1} | null    // 'x0,y0,x1,y1'

// —— 文件/皮肤对象 ——
// skin = { w, h, format:'modern'|'legacy', data:Uint8ClampedArray }
loadSkin(path) -> skin                     // 读 PNG；h===32 → legacy（data 仍是 64×32 原始像素）
saveSkin(path, skin) -> void               // 写 PNG（modern 原样；legacy 原样写 64×32）
newSkin(size /*64|32*/, template /*'blank'|'default'*/) -> skin
convertLegacy(skin32) -> skin64            // 调 rules.convertLegacy64x32
regionAt(x, y, opts) -> region | null      // rules.regionAt
partsList() -> 12 个盒的 id/label 列表

// —— 像素操作（都返回 {changed, edits}；edits=[{x,y,rgba}]）——
getPixel(skin, x, y) -> [r,g,b,a]
setPixels(skin, entries /*[{x,y,rgba}]*/) -> {changed, edits}
fillOp(skin, x, y, rgba, opts /*{boundsRegion:rect|null}*/) -> {changed, edits}
rectOp(skin, x0, y0, x1, y1, rgba, opts /*{outline:rgba|null}*/) -> {changed, edits}
lineOp(skin, x0, y0, x1, y1, rgba) -> {changed, edits}
mirrorLimbsOp(skin, opts /*{includeOuter:bool}*/) -> {changed, edits, mirrored:[string]}

// —— 统计 ——
paletteOf(skin, limit) -> {distinct, colors:[{hex,count}]}
partsOf(skin) -> [{part, layer, totalOpaque, faces:{front:{opaque,distinctColors,mean},...}}]

// —— 审查 / 导出 ——
lintSkin(skin, opts /*{file}*/) -> report   // 结构、12 个检查项、计分，完全按 CONTRACT.md §1.2
cropsOf(skin, outDir, scale) -> files[]     // 写 full_<4x>.png + 每个有内容部件 <part>_<8x>.png；返回相对文件名

// —— 自测 ——
selftest() -> {ok, pass, fail, failures:[]}  // 纯内存用例，不依赖外部文件
```

## 2. `bin/skin.mjs`（cli-main 实现）职责

- 用法与命令集合完全按 `CONTRACT.md` §1.1（14 个命令 + `selftest`）。
- 只做：argv 解析（`-o/--out`、`--size/--template/--bounds/--outline/--include-outer/--limit/--scale`）、
  调 core 对应函数、把结果按 §1.1/§1.2 的 JSON 结构输出、错误处理（`{"ok":false,"error"}` + exit 1）。
- 自身不实现像素算法、不实现 lint 打分（全在 core）。
- `run <script> <skin>`：读脚本 → 逐行（跳过 `#` 注释/空行）解析为 `cmd args...` → 只支持
  `set/fill/rect/line/mirror-limbs/palette/parts` → 全部作用于**同一份内存 skin** → 结束时一次性 `-o <out>` 写盘；
  stdout `{ok,results:[{line,cmd,ok,changed|output|error}],changed}`；任一行失败 → 该行 ok:false，整体 exit 1。
- `crops`：调 `core.cropsOf`。
- `selftest`：调 `core.selftest()`，把结果原样输出（ok/fail 一致）。
- loader/约定仍按 `CONTRACT.md` §0.1（stdout 纯 JSON、零依赖、Node≥18）。
