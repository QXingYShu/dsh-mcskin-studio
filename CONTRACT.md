# Minecraft 皮肤绘制工具 —— 模块接口契约（v1）

> 本文件是团队并行开发的**唯一接口真相**。任何模块都必须遵守这里的全局 API。
> 先读本文件，再写代码。不要修改本文件（由 Lead 维护）。

## 0. 项目目标

做一个网页工具，让使用者在 64×64 / 64×32 的 Minecraft 皮肤画布上作画，并**实时**看到立体（3D）预览。
工作目录下的两个参考图 `苦力怕娘.png`（64×64，现代格式，含第二层 overlay）与 `HIM.png`（64×32，旧版格式）必须能正确载入并正确显示立体效果。

## 1. 目录与文件归属（写作用域，禁止越界）

| 文件 | 归属 | 说明 |
|---|---|---|
| `index.html` | Lead | 页面骨架、脚本顺序 |
| `css/app.css` | Lead | 全部样式 |
| `js/rules.js` | teammate `spec-uv` | 皮肤格式 + UV 映射唯一真相 |
| `js/model.js` | teammate `spec-uv` | 像素数据模型 |
| `js/renderer3d.js` | teammate `render3d` | WebGL 立体预览 |
| `js/editor2d.js` | teammate `editor2d` | 2D 绘制界面 |
| `js/util.js` | Lead | 颜色/像素小工具 |
| `js/shell.js` | Lead | 文件读写、面板、总装 |
| `tests/*` | Lead | 测试与证据 |
| `README.md` | Lead | 使用说明 |

## 2. 模块加载顺序（index.html 里必须是这个顺序）

```html
<script src="js/util.js"></script>
<script src="js/rules.js"></script>
<script src="js/model.js"></script>
<script src="js/renderer3d.js"></script>
<script src="js/editor2d.js"></script>
<script src="js/shell.js"></script>
```

**全部使用传统 script 标签 + 全局命名空间，禁止使用 ES module / import / export**，
这样 `index.html` 双击用 `file://` 打开也能工作（不需要起服务器）。

每个模块自己创建自己的命名空间，并注册到 `MCSKIN`：

```js
window.MCSKIN = window.MCSKIN || {};
MCSKIN.rules    // rules.js
MCSKIN.model    // model.js
MCSKIN.renderer // renderer3d.js
MCSKIN.editor   // editor2d.js
MCSKIN.shell    // shell.js
```

额外约定：每个模块内部（class 定义之后、IIFE 结束之前）若定义了 `_selfTest()`，请执行并写入：

```js
MCSKIN.tests = MCSKIN.tests || {};
MCSKIN.tests.rules    = { pass: [...], fail: [...] };
MCSKIN.tests.renderer = { pass: [...], fail: [...] };
MCSKIN.tests.editor   = { pass: [...], fail: [...] };
```

（每项是字符串说明。测试要能在 `file://` 下不依赖网络、不依赖图片加载完成而通过。）

## 3. 皮肤格式规格（`js/rules.js`）

### 3.1 坐标

- 纹理左上角为 (0,0)，x 向右，y 向下，单位是**像素**。
- 颜色统一用 `[r,g,b,a]` 数组，每项 0–255。
- 模型空间：**1 单位 = 1 皮肤像素**，y 轴向上，模型原点在身体中心、脚底 y=0。
  - 头部 y=24..32，躯干 y=12..24，手臂/腿 y=0..12，x∈[-8,8]，z∈[-4,4]。

### 3.2 部件盒（box）定义

每个部件的**基础层**盒子在模型空间中的位置与尺寸（单位：像素）：

| part id | 部位 | min = [x,y,z] | size = [w,h,d] |
|---|---|---|---|
| `head` | 头 | [-4,24,-4] | [8,8,8] |
| `body` | 躯干 | [-4,12,-2] | [8,12,4] |
| `rightArm` | 右手臂（角色自己的右臂，位于 x 负侧） | [-8,12,-2] | [4,12,4] |
| `leftArm` | 左手臂 | [4,12,-2] | [4,12,4] |
| `rightLeg` | 右腿 | [-4,0,-2] | [4,12,4] |
| `leftLeg` | 左腿 | [0,0,-2] | [4,12,4] |

**外层（第二层 / overlay）盒子**在基础盒基础上向外膨胀 `+0.25`：

| layer part id | 部位 | min | size |
|---|---|---|---|
| `hat` | 头外层 | [-4.25,23.75,-4.25] | [8.5,8.5,8.5] |
| `jacket` | 躯干外层 | [-4.25,11.75,-2.25] | [8.5,12.5,4.5] |
| `rightSleeve` | 右臂外层 | [-8.25,11.75,-2.25] | [4.5,12.5,4.5] |
| `leftSleeve` | 左臂外层 | [3.75,11.75,-2.25] | [4.5,12.5,4.5] |
| `rightPants` | 右腿外层 | [-4.25,-0.25,-2.25] | [4.5,12.5,4.5] |
| `leftPants` | 左腿外层 | [-0.25,-0.25,-2.25] | [4.5,12.5,4.5] |

> 注意：外层是**独立盒**，渲染顺序为「先画基础层所有盒，再画外层所有盒」（外层透明像素不遮住基础层）。
> 注意：外层是**独立盒**，渲染顺序为「先画基础层所有盒，再画外层所有盒」（外层透明像素不遮住基础层）。
> `leftPants`（左裤外层）与 `leftLeg`（左腿）在 64×64 贴图上**各有独立区域**（见 3.3），可以分别绘制。

### 3.3 UV 矩形（像素，64×64 坐标系）

> **v1.1 修订（Lead 已用权威来源核实，2026-09-30）**：v1.0 把左臂/左腿/左袖写成了「右臂/右腿 + y32」，
> 那是**错的**（只有 64×32 旧版格式才在那个位置）。真实现代 64×64 布局见下表。
> 核实来源：① Mojang 官方参考模板 `assets.mojang.com/SkinTemplates/4px_reference.png`；
> ② Mojang 官方 `steve.png`；③ 生产库 `github.com/mineatar-io/skin-render` 的 `parts.go` 坐标表。
> 三者一致。**请以本表为准**。

每个盒子的 6 个面，记为 `right / front / left / back / top / bottom`（**以角色自身朝向为准**：
`front` = 角色正面 = -Z 面，`right` = 角色右面 = -X 面，`left` = +X 面，`back` = +Z 面）。

- `head`：
  - top `[8,0,16,8]`、bottom `[16,0,24,8]`
  - right `[0,8,8,16]`、front `[8,8,16,16]`、left `[16,8,24,16]`、back `[24,8,32,16]`
- `hat`：将 `head` 所有矩形 **x 加 32**。
  - top `[40,0,48,8]`、bottom `[48,0,56,8]`
  - right `[32,8,40,16]`、front `[40,8,48,16]`、left `[48,8,56,16]`、back `[56,8,64,16]`
- `body`：
  - top `[20,16,28,20]`、bottom `[28,16,36,20]`
  - right `[16,20,20,32]`、front `[20,20,28,32]`、left `[28,20,32,32]`、back `[32,20,40,32]`
- `jacket`：将 `body` 所有矩形 **y 加 16**。
  - top `[20,32,28,36]`、bottom `[28,32,36,36]`
  - right `[16,36,20,48]`、front `[20,36,28,48]`、left `[28,36,32,48]`、back `[32,36,40,48]`
- `rightArm`：
  - top `[44,16,48,20]`、bottom `[48,16,52,20]`
  - right `[40,20,44,32]`、front `[44,20,48,32]`、left `[48,20,52,32]`、back `[52,20,56,32]`
- `leftArm`（**v1.1 修正**）：
  - top `[36,48,40,52]`、bottom `[40,48,44,52]`
  - right `[32,52,36,64]`、front `[36,52,40,64]`、left `[40,52,44,64]`、back `[44,52,48,64]`
- `rightSleeve`：将 `rightArm` 所有矩形 **y 加 16**。
  - top `[44,32,48,36]`、bottom `[48,32,52,36]`
  - right `[40,36,44,48]`、front `[44,36,48,48]`、left `[48,36,52,48]`、back `[52,36,56,48]`
- `leftSleeve`（**v1.1 修正**：官方**有**独立贴图区）。
  - top `[52,48,56,52]`、bottom `[56,48,60,52]`
  - right `[48,52,52,64]`、front `[52,52,56,64]`、left `[56,52,60,64]`、back `[60,52,64,64]`
- `rightLeg`：
  - top `[4,16,8,20]`、bottom `[8,16,12,20]`
  - right `[0,20,4,32]`、front `[4,20,8,32]`、left `[8,20,12,32]`、back `[12,20,16,32]`
- `leftLeg`（**v1.1 修正**）：
  - top `[20,48,24,52]`、bottom `[24,48,28,52]`
  - right `[16,52,20,64]`、front `[20,52,24,64]`、left `[24,52,28,64]`、back `[28,52,32,64]`
- `rightPants`：将 `rightLeg` 所有矩形 **y 加 16**。
  - top `[4,32,8,36]`、bottom `[8,32,12,36]`
  - right `[0,36,4,48]`、front `[4,36,8,48]`、left `[8,36,12,48]`、back `[12,36,16,48]`
- `leftPants`（**v1.1 修正**：官方有**独立**贴图区，与 `leftLeg` **不同**）：
  - top `[4,48,8,52]`、bottom `[8,48,12,52]`
  - right `[0,52,4,64]`、front `[4,52,8,64]`、left `[8,52,12,64]`、back `[12,52,16,64]`

#### v1.1 布局小结（帮助校验）

贴图分 16 个 16×16 的「格子（slot）」，按 4×4 排列，每个格子放一个 8×8 或 4×12 / 4×4 的十字带：

| 列 0..16 | 列 16..32 | 列 32..48 | 列 48..64 |
|---|---|---|---|
| 头（0-16） | 头（其余） | 帽子外层（上 8 行） | 帽子外层（其余） |
| 右腿 | 躯干（左 8 列） | 躯干（其余） | 右臂 |
| 右裤外层 | 外套外层 | 右袖外层 | 右臂外层 |
| 左裤外层 | **左腿** | **左臂** | **左袖外层** |

### 3.4 面的四边形（几何顶点）

对任意盒子 `min=(x0,y0,z0)`、`size=(w,h,d)`，记
`x1=x0+w, y1=y0+h, z1=z0+d`（**z0 是背面一侧，z1 是正面一侧**，因为模型朝 -Z / 南方）。

每个面用「贴图矩形的左上角像素 (u0,v0)、右上角 (u1,v0)、右下角 (u1,v1)、左下角 (u0,v1)」
四个角对应到 3D 顶点。**必须使用下面的对应关系**（这是皮肤展开图的约定，写错就会左右反）：

| 面 | 贴图左上角 (u0,v0) 对应顶点 | 贴图右上角 (u1,v0) | 贴图右下角 (u1,v1) | 贴图左下角 (u0,v1) |
|---|---|---|---|---|
| right (-X 面) | (x0, y1, z0) | (x0, y1, z1) | (x0, y0, z1) | (x0, y0, z0) |
| front (-Z 面) | (x0, y1, z1) | (x1, y1, z1) | (x1, y0, z1) | (x0, y0, z1) |
| left (+X 面) | (x1, y1, z1) | (x1, y1, z0) | (x1, y0, z0) | (x1, y0, z1) |
| back (+Z 面) | (x1, y1, z0) | (x0, y1, z0) | (x0, y0, z0) | (x1, y0, z0) |
| top (+Y 面) | (x0, y1, z0) | (x1, y1, z0) | (x1, y1, z1) | (x0, y1, z1) |
| bottom (-Y 面) | (x1, y0, z0) | (x0, y0, z0) | (x0, y0, z1) | (x1, y0, z1) |

每个四边形按「左上→右上→右下→左下」顺序输出 4 个顶点，三角化为 `[0,1,2, 0,2,3]`。
绕序为逆时针（面向观察者），渲染时开启 `CULL_FACE` 背面剔除，也可关闭。

> **v1.2 定稿（3.4 表以上面的版本为准，已用可执行判据验证，不要再改）**
>
> 判定标准：**展开网的接缝连续性**。四个侧面在贴图上连成一条带子 `右面 | 正面 | 左面 | 背面`，
> 相邻两块共用的那条贴图线，必须映射到两面在 3D 里的**同一条棱**（把面参数化
> `f(s,t)`（s 沿贴图 u、t 沿贴图 v），则 A 面 `s=1` 曲线 == B 面 `s=0` 曲线，逐点相等）。
>
> 上面这版（`x1=x0+w`、`z0` 背面 / `z1` 正面）：
> - right.s1=(x0,y1,z1) == front.s0=(x0,y1,z1) ✔
> - front.s1=(x1,y1,z1) == left.s0=(x1,y1,z1) ✔
> - left.s1=(x1,y1,z0) == back.s0=(x1,y1,z0) ✔
> - back.s1=(x0,y1,z0) == right.s0=(x0,y1,z0) ✔
>
> **4/4 闭合**。可执行验证：`node tools/verify_unwrap.mjs`（对 6 个基础层盒逐个检查，并带
> **敏感性检验**：把正面 u 反向 / 右面 z 反向 / 正背面互换，判据分别报出 2 / 2 / 4 条断裂，
> 证明它不是一个恒真判据）。
>
> 注意这个结果**反直觉**，也是本文件前后改过两次的原因：不能靠"从外面看某个面时哪边是左"推理
> （那样会把 right/left 与 front/back 的 u 方向搞成一致，接缝必断）。`z0=背面 / z1=正面` 是
> 因为方块人朝 **-Z**（南方）站立。另一条独立自检：正面 u0 落在角色**右侧**(x0)、u1 落在**左侧**(x1)，
> 与真实皮肤"左耳画在贴图右侧"一致（`4px_reference.png` 的 head 正面两耳、`steve.png` 的双眼/嘴）。
>
> `js/rules.js` 当前实现与上表完全一致，`BOXES[].geometryContract` 里那份 v1.1 旧值**不要使用**。


**UV 换算**：`u = px / 64`（像素中心用 `(px + 0.5) / 64` 采样；纹理坐标原点在贴图左上角，
但请在 renderer 里用 `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)`，并把 v 记为 `py / 64`
（即 v=0 对应贴图顶部）。**renderer 不要自己翻转，以 rules 给的为准。**

### 3.5 各面明暗（提供基础立体感）

按面固定亮度系数（可被 renderer 的开关关闭）：
`top 1.0`、`front 0.95`、`right 0.80`、`left 0.80`、`back 0.72`、`bottom 0.55`。

### 3.6 旧版 64×32 转 64×64（**v1.3 定稿**）

**重要：64×32 与 64×64 是同一个像素网格，转换时不放大**（1:1）。
旧版只是"只填了 64×64 的左上/右上几块"，下半部分（左肢、所有外层）留空。
（v1.1 曾写"按 2 倍放大"，那是错的：HIM.png 实测头部正好占 `(0,0)-(32,16)` 的 384 个
现代 UV 像素，与 UV 面积完全相等；若放大 2 倍头部会跑到 `(0,0)-(64,32)`、躯干会越界。）

标准转换 `rules.convertLegacy64x32(data32)`：

1. **原样 1:1 复制旧版已有的 4 块**（坐标完全不变，因为它们本来就是现代坐标）：
   - 上半 `(0,0)-(64,16)` → 同位置（含头部 `(0,0)-(32,16)`）
   - `rightLeg (0,16)-(16,32)`、`body (16,16)-(40,32)`、`rightArm (40,16)-(56,32)`
2. **左臂 ← 右臂、左腿 ← 右腿：逐面水平镜像**（不是整块 16×16 镜像！整块镜像会把
   前/后/内/外四个面转错位）。规则是「外↔内换位 + 每个面自身水平翻转」：
   | 目标（左肢的面） | 来源（右肢的面） |
   |---|---|
   | leftArm.right | rightArm.left（水平翻转） |
   | leftArm.front | rightArm.front（水平翻转） |
   | leftArm.left | rightArm.right（水平翻转） |
   | leftArm.back | rightArm.back（水平翻转） |
   | leftArm.top / bottom | rightArm.top / bottom（水平翻转） |
   | leftLeg.\* | 同表，来源换成 rightLeg.\* |
   即 `MIRROR_FACE = { right:'left', left:'right', front:'front', back:'back', top:'top', bottom:'bottom' }`，
   每个面再水平翻转。这与 vanilla 的 `mirror=true`、`minecraft-skin-converter` 的
   `CopyAreas.Arm/Leg` 表一致（它的 `ctx.scale(-1,1)` 就是整面水平翻转）。
3. **补外层**（旧版没有第二层）：把基础层**整块**按 3.3 的贴图区复制过去
   - `hat` ← `head`、`jacket` ← `body`、`rightSleeve` ← `rightArm`、`rightPants` ← `rightLeg`
   - `leftSleeve` ← `leftArm`（第 2 步已镜像好）
   - `leftPants` ← `leftLeg`（第 2 步已镜像好；**注意 leftPants 与 leftLeg 是两个独立贴图区**，
     `leftPants = (0,48)-(16,64)`、`leftLeg = (16,48)-(32,64)`）
4. 返回 `{ width:64, height:64, data: Uint8ClampedArray }`。

> 判断格式：`h === 32` → legacy；`h === 64` → modern。
> 可执行验证：`node tools/verify_legacy.mjs`（用自造的多色块 64×32 皮肤逐像素断言
> "左臂 = 右臂逐面水平镜像"，并用真实 `HIM.png` 复核）。当前 11/11 通过。

## 4. `js/rules.js` 要求的导出 API

```js
MCSKIN.rules = {
  VERSION: '1.0',
  SIZE_MODERN: { w: 64, h: 64 },
  SIZE_LEGACY: { w: 64, h: 32 },

  // 全部部件与盒子的定义（含 3D 盒 + 6 面 UV 像素矩形）
  BOXES: [ /* { id, label, layer:'base'|'outer', part, min:[x,y,z], size:[w,h,d],
                faces: { right:{px:[u0,v0,u1,v1]}, front:{...}, left:{...}, back:{...}, top:{...}, bottom:{...} },
                geometry: { right:[[x,y,z]x4], ... }   // 顺序与 3.4 表格一致，已算好
             } */ ],

  FACE_SHADE: { top:1.0, front:0.95, right:0.80, left:0.80, back:0.72, bottom:0.55 },
  FACE_ORDER: ['right','front','left','back','top','bottom'],

  // 面 → 角色朝向说明（给 UI 提示用）
  FACE_LABEL: { right:'右面', front:'正面', left:'左面', back:'背面', top:'顶面', bottom:'底面' },

  // 像素 → 部位/面；px,py 是 64×64 坐标。返回 null 表示该像素不属于任何可见面。
  // 命中多个时遍历顺序：先外层后基础层；重叠处通过 overlaps 列出全部 boxId。
  regionAt(px, py, opts) -> null | {
      part, label, layer, face, boxId,
      // 'px'/'py' 在盒子内的局部比例，便于调试
      overlaps: [boxId, ...]
  },

  // 给定部件 id 拿到盒子（含 geometry 与 faces）
  box(id) -> box | null,

  // 某个盒子某个面的 4 个顶点（Float32Array 或 [[x,y,z]x4]）
  faceQuad(boxId, face) -> [[x,y,z] x 4],

  // UV：像素矩形 → [u,v] 归一化（u=px/64, v=py/64）
  uvFromPixel(px, py) -> [u, v],

  // 明暗
  shadeFor(face) -> number,

  // 旧版转换（见 3.6）
  convertLegacy64x32(data32) -> { width:64, height:64, data:Uint8ClampedArray },

  // 生成一个空的 / 默认的皮肤
  blankSkin(w, h) -> Uint8ClampedArray,
  defaultSkin() -> { width:64, height:64, data:Uint8ClampedArray },

  // 皮肤布局分区（给 2D 编辑器画网格/图例用）
  LAYOUT_REGIONS: [ /* { id, label, px:[x0,y0,x1,y1], kind:'head'|'body'|'arm'|'leg'|'overlay', layer } */ ],

  // 每个部件的 3D 盒尺寸，给 UI 显示
  PART_LABEL: { head:'头', body:'躯干', rightArm:'右臂', leftArm:'左臂', rightLeg:'右腿', leftLeg:'左腿',
                hat:'帽子(外层)', jacket:'外套(外层)', rightSleeve:'右袖(外层)', leftSleeve:'左袖(外层)',
                rightPants:'右裤(外层)', leftPants:'左裤(外层)' },
};
```

## 5. `js/model.js` 要求的导出 API

像素数据是唯一真相：`Uint8ClampedArray(w*h*4)`，行优先，**不含** overlay 分层映射以外的结构。

```js
MCSKIN.model = {
  VERSION: '1.0',

  // 构造。width/height 只能是 64×64 或 64×32。
  create(width, height) -> instance,

  instance: {
    width, height,
    data,                       // Uint8ClampedArray
    format,                     // 'modern' | 'legacy'

    getPixel(x, y) -> [r,g,b,a],
    setPixel(x, y, rgba, opts),          // opts = { record:true, merge:'replace'|'keepAlpha' }
    setPixels(edits, opts),              // edits = [{x,y,rgba}]，一次性入 undo 栈
    fillRect(x0,y0,x1,y1,rgba),

    snapshot() -> { width, height, data:Uint8ClampedArray(副本) },
    restore(snapshot),

    // 撤销栈
    undo(), redo(), canUndo(), canRedo(),
    beginStroke(label), endStroke(),     // 一次笔画 = 一个撤销步

    clear(),

    // 转换为 64×64 现代格式（legacy 时调用 rules.convertLegacy64x32）
    toModern() -> { width, height, data },

    // 从 ImageData / canvas / {width,height,data} 载入
    loadImageData(imageDataLike),

    // 统计
    stats() -> { opaque, total, format },
  },
};
```

## 6. `js/renderer3d.js` 要求的导出 API

WebGL1 或 WebGL2 都行，必须自己实现，**不要引入任何外部库**（离线可用）。

```js
MCSKIN.renderer = {
  VERSION: '1.0',

  // viewport: 一个 <canvas> 元素；内部自己处理 devicePixelRatio 与 resize
  create(canvas, opts) -> instance,

  instance: {
    setSkin(imageDataLike, format),   // 64×64 或 64×32 的 {width,height,data}
    setRotation(yawDeg, pitchDeg),    // 相机轨道角
    getRotation() -> {yaw, pitch},
    setZoom(scale), getZoom(),
    setAutoRotate(on),
    setAnimation(mode),               // 'none' | 'walk' | 'idle' | 'wave'
    setShowLayer(show),               // 是否显示外层（第二层）
    setShowBase(show),
    setShowGround(on),                // 地面网格，可选
    setPartVisible(partId, on),        // 单独隐藏某部位（调试/教学用）
    setHighlight(partId|null),          // 高亮某部位
    setLighting(on),
    resize(),                          // 外部容器尺寸变化后调用
    render(),                          // 立即绘制一帧
    screenshot() -> dataURL,            // PNG data URL（用于导出）
    dispose(),
  },
};
```

要求：
- 相机默认 yaw ≈ 20°、pitch ≈ 10°，透视投影，能鼠标拖拽旋转、滚轮缩放（滚轮/拖拽在 renderer 内部绑定到 canvas 上）；
- 必须正确渲染外层（第二层，alpha 混合，`hat` 等），并且外层透明像素不能遮住基础层；
- 有方向光近似（用 `FACE_SHADE` 与可选的真实法线光照），画面要有明显立体感；
- 绘制失败（无 WebGL）时必须在 canvas 旁边的容器里显示可读的错误文字，不能白屏；
- `screenshot()` 要能拿到像素（`preserveDrawingBuffer: true`）。

## 7. `js/editor2d.js` 要求的导出 API

```js
MCSKIN.editor = {
  VERSION: '1.0',

  create(canvas, opts) -> instance,   // canvas 是 2D 绘制区的 <canvas>
  instance: {
    setModel(modelInstance),          // MCSKIN.model 的实例
    setZoom(px),                       // 每个皮肤像素显示成多少 CSS 像素，默认 8
    getZoom(),
    setGrid(on),
    setSymmetry(mode),                // 'none' | 'x'（左右对称，64×64 下同时写左右肢）
    setLayerVisible(layer, on),       // layer: 'base' | 'outer'
    setActiveLayer(layer),            // 'base' | 'outer' —— 决定画到哪一层
    getActiveLayer(),
    setTool(tool),                    // 'pencil'|'eraser'|'fill'|'picker'|'line'|'rect'
    getTool(),
    setColor(rgba),                   // [r,g,b,a]
    getColor(),
    setBrushSize(n),                  // 1..4
    setOverlayVisible(on),            // 是否显示部件分区/面名提示
    redraw(),
    on(evt, fn),                      // 'change'|'hover'|'pick'|'cursor'
    getCursor() -> { px, py, region } | null,
    destroy(),
  },
};
```

要求：
- 画布显示 64×64 皮肤展开图（若是 64×32 显示 64×32），每像素放大显示、最近邻、不模糊；
- 每笔画完要触发 `'change'` 事件，**实时**让 3D 预览刷新；
- 支持 hover 时通过 `MCSKIN.rules.regionAt` 显示「这个像素是哪个部位/哪个面」（写到 `'hover'` 事件里）；
- 棋盘格表示透明；
- 鼠标拖拽连续绘制、快速移动要有插值（不要断点）；
- 右键 = 取色/擦除（任选一种，写清注释）；
- `'change'` 回调参数：`{ reason:'draw'|'undo'|'redo'|'load', strokes: n }`。

## 8. 变更规则

- `rules.js` 是格式唯一真相；`renderer3d.js` 与 `editor2d.js` **不得**硬编码任何 UV 数字，必须从 `MCSKIN.rules` 读。
- 任何模块不得给全局加除 `MCSKIN.*` 之外的名字。
- 提交前自测：`MCSKIN.tests.<yourmodule>` 必须是 `{pass:[], fail:[]}` 且 `fail` 为空。
