# mcskin-artist Skill 接口契约 v1（Lead 维护，队友只读）

> 本文件定义 DeepSeek Harness 插件 skill `mcskin-artist` 的**全部对外接口**。
> 三个并行开发者必须严格按此实现；不得修改本文件。发现矛盾时先实现、后上报，由 Lead 裁决。
>
> Skill 根目录 = `skill/mcskin-artist/`（工作区内开发），安装目标 =
> `C:\Users\18002\.dsh\skills\mcskin-artist\`（由 Lead 的 `tools/install_skill.mjs` 拷贝）。

## 0. 背景：这套 skill 给 AI 什么能力

让 AI（DSH 会话里的 agent）不靠鼠标、纯靠命令行**绘制并审查 Minecraft 皮肤**：

1. **绘制**：批量像素操作（填色/矩形/线/镜像），多轮迭代，每轮存档。
2. **审查（程序化）**：`lint` 输出质量报告（分数+逐项证据），作为质量门禁。
3. **审查（视觉）**：`render` 输出**多视角 × 多姿态**的 3D 截图 + 皮肤贴图高清裁切，
   AI 用 `read_image` 逐张检查，写批评，再改。
4. **成品质量**：SKILL.md 里定义明确的质量数值门槛（lint 分数 + 视觉检查清单）。

## 0.1 通用约定（所有脚本遵守）

- 运行环境：Node ≥18，**零外部依赖**，离线可用（只用 Node 内置模块）。
- 所有脚本是 `.mjs`（ESM）；浏览器脚本 `lib/rules.js`、`lib/model.js`、`lib/renderer3d.js`
  是经典脚本（写 `window.MCSKIN.*`），在 Node 里用下面的加载器加载：
  ```js
  import fs from 'node:fs';
  function loadClassic(path, g = globalThis) {
    g.window = g.window || g;
    const src = fs.readFileSync(path, 'utf8');
    new Function('window', 'globalThis', src)(g.window, g);
    return g.window.MCSKIN;
  }
  const MCSKIN = loadClassic(new URL('../lib/rules.js', import.meta.url).pathname.slice(1)); // 见下：用 fileURLToPath
  ```
  正确写法：`import { fileURLToPath } from 'node:url'; const p = fileURLToPath(new URL('../lib/rules.js', import.meta.url));`
  （加载顺序：rules.js → model.js → renderer3d.js，都往同一个 window 挂。）
- **stdout 只输出纯 JSON**（机器可解析），进度/警告一律 stderr。异常时 stdout 输出
  `{"ok":false,"error":"..."}` 且 exit 1；成功 `{"ok":true,...}` exit 0。
- 颜色参数格式（通用解析）：`#rgb` / `#rrggbb` / `#rrggbbaa` 或 `r,g,b` / `r,g,b,a`（0-255）。
- 坐标格式：`x,y` 或 `x0,y0,x1,y1`（**矩形为含端点**，与 model.fillRect 一致）。
- 皮肤像素坐标 0..63；`lib/rules.js` 的 `regionAt(x,y,{layer})` 反查部位。
- 路径参数一律由调用者传入；脚本**不得**假设 cwd（用 `path.resolve` 相对 cwd 解析即可）。

## 1. `bin/skin.mjs` —— 绘制与审查 CLI（负责人：skin-cli）

用法：`node bin/skin.mjs <command> [args...]`（cwd 任意）。
**每个 mutating 命令**都有 `-o/--out <file>`（缺省 = 覆盖输入文件）。

### 1.1 命令清单（stdout 均为 JSON）

| 命令 | 参数 | 输出 JSON 要点 |
|---|---|---|
| `new` | `-o <out> [--size 64\|32] [--template blank\|default]` | `{ok,w,h,format}`；**默认 `blank`（全透明）**，要默认皮肤需显式 `--template default`（=rules.defaultSkin()） |
| `convert` | `<legacy.png> -o <out>` | `{ok,from:'64x32',to:'64x64'}`（rules.convertLegacy64x32） |
| `info` | `<skin>` | `{ok,w,h,format,opaque,total,regionsUsed,partsPainted}` |
| `pixel` | `<skin> <x>,<y>` | `{ok,x,y,rgba:[r,g,b,a],hex:"#rrggbb",region:{part,face,label,layer,boxId}}` |
| `set` | `<skin> <x>,<y>,<color> [<x>,<y>,<color> ...]` | `{ok,changed:n}`；同坐标后者覆盖 |
| `fill` | `<skin> <x>,<y>,<color> [--bounds region]` | `{ok,changed:n}`；默认经典洪水（异色即停）；`--bounds region` 限制在该点所在 UV 面内 |
| `rect` | `<skin> <x0>,<y0>,<x1>,<y1>,<color> [--outline <color>]` | `{ok,changed:n}`；填充+可选边框，**含端点** |
| `line` | `<skin> <x0>,<y0>,<x1>,<y1>,<color>` | `{ok,changed:n}`；Bresenham |
| `mirror-limbs` | `<skin> [--include-outer]` | `{ok,mirrored:['rightArm→leftArm','rightLeg→leftLeg', ...(outer)]}`；**逐面水平镜像+外↔内换位**（rules 的 MIRROR_FACE 规则同 tools/verify_legacy.mjs）：rightArm.face → leftArm.MIRROR(face) 水平翻转。`--include-outer` 同理做 rightSleeve→leftSleeve、rightPants→leftPants |
| `palette` | `<skin> [--limit 30]` | `{ok,colors:[{hex,count}],distinct}` 按 count 降序 |
| `parts` | `<skin>` | `{ok,parts:[{part,layer,faces:{front:{opaque,distinctColors,mean},...},totalOpaque}]}` —— 明细密度证据 |
| `crops` | `<skin> -o <dir> [--scale 8]` | `{ok,files:[...]}` 输出：`full_<4x>.png` 整张、每个有内容的 part 输出 `<part>_<8x>.png`（该 part 六面的包围盒裁切放大），文件名如 `head_8x.png`、`rightArm_outer_8x.png` |
| `lint` | `<skin> [--json]`（--json 默认开，保留兼容） | 见 §1.2 |
| `run` | `<script.txt> <skin> [-o <out>]` | 批量脚本：每行一个命令（`set/fill/rect/line/mirror-limbs/palette/parts`），`#` 注释、空行忽略；行内**不含** `skin` 路径与 `-o`（整个脚本只读写一次输入、一次输出）；stdout `{ok,results:[{line,cmd,ok,output|error}],changed:n}`，某行失败则整体 exit 1 且 results 内注明 |

### 1.2 `lint` 输出（审查引擎，质量门禁）

```json
{
  "ok": true,
  "file": "skin.png",
  "score": 87,              // 0..100
  "grade": "A",             // A>=85, B>=70, C>=55, D<55
  "checks": [
    { "id": "format", "level": "pass", "msg": "64×64 现代格式", "evidence": {} },
    { "id": "...", "level": "pass|warn|fail|info", "msg": "中文说明", "evidence": { } }
  ],
  "palette": { "distinct": 18, "top": [{"hex":"#3aa06a","count":412}] },
  "parts": [ { "part": "head", "layer": "base", "opaque": 384, "frontDistinctColors": 6, "frontEdgeRatio": 0.42 } ]
}
```

**检查项 id 与判定（固定，不得增删语义）**：

| id | 级别 | 规则 |
|---|---|---|
| `format` | fail（非64×64/64×32）否则 pass | 尺寸与格式 |
| `outside-pixels` | fail：有不透明像素不属于任何 region；evidence `{count, samples:[{x,y}]≤8}` | 脏点/越界 |
| `empty-base-part` | warn：6 个基础层部件里有任何 totalOpaque=0 且其它部件已画；evidence `{missing:[ids]}` | 漏画部位 |
| `content-coverage` | fail：全图不透明像素===0（空皮肤）；warn：<1200（半成品）；evidence `{totalOpaque}` | 内容量门禁（防止空皮/半成品拿高分） |
| `base-alpha` | warn：基础层部件内 alpha<255 的像素数>0（官方内层强制不透明）；evidence `{count}` | 半透明本体 |
| `flat-face` | warn：任意**已画**（opaque>20px）基础层部件的 front 面 distinctColors===1；evidence `{parts:[...]}` | 正面缺细节 |
| `low-detail` | **fail**：边缘能量 `edgeRatio` <0.10（几乎全是大色块）；**warn**：<0.18；evidence `{edgeRatio}` | 太糊/大平板 |
| `noise` | warn：孤立噪点（与四邻距离都>60 且四邻彼此相似）数>4；evidence `{count, samples≤8}` | 脏像素 |
| `palette-size` | warn：distinct>40；evidence `{distinct}` | 颜色失控 |
| `palette-dupes` | info：两两颜色距离≤6 的近重复组数；evidence `{groups≤10}` | 可合并颜色 |
| `outer-unused` | warn：外层（6 个 overlay 部件）总 opaque===0 且 format=modern | 没用第二层（头发/帽子） |
| `mirror-balance` | info：右臂 vs 左臂 front 面平均色距离；evidence `{distance}` | 左右一致性参考 |
| `legacy` | info（modern 时 pass）：format=legacy 时提示"建议 convert 后编辑" | — |

**计分**：起始100；每 `fail` −25、每 `warn` −6（`info` 不扣），clamp 到 [0,100]。
`score` 与 `grade` 必须与 checks 一致（自测要断言）。

### 1.3 `bin/skin.mjs` 自测

文件内提供 `node bin/skin.mjs selftest` → JSON `{ok,pass,fail,failures:[]}`，至少覆盖：
颜色解析 3 种格式、set/fill/rect/line 改动数与像素正确性、fill --bounds region 不越面、
mirror-limbs 逐面镜像与 verify_legacy 同规则、lint 各检查项的正反例（构造全透明→empty/outer-unused 触发；
构造单色脸→flat-face；构造越界像素→outside-pixels；分数公式）、run 脚本批处理。
`fail===0` 才 exit 0。

## 2. `bin/render.mjs` + `bin/headless.mjs` + `harness/render.html`（负责人：skin-render）

**目的**：给一张皮肤 PNG，产出多视角 3D 截图、多姿态帧、贴图高清裁切，供 AI `read_image` 审查。

### 2.1 用法

```
node bin/render.mjs <skin.png> -o <outdir> [--views default|all|<v1,v2,...>] [--poses default|none|<...>]
                     [--pose-views front] [--scale 1] [--no-crops]
```

- **视角预设**（`--views default` = 8 张，写进 `views/`）：
  | id | yaw | pitch | 说明 |
  |---|---|---|---|
  | `front` | 0 | 0 | 正视 |
  | `front34R` | -35 | 10 | 前右 3/4（角色右侧） |
  | `front34L` | 35 | 10 | 前左 3/4 |
  | `back` | 180 | 0 | 背面 |
  | `sideR` | -90 | 0 | 角色右侧面 |
  | `sideL` | 90 | 0 | 角色左侧面 |
  | `top` | 20 | 65 | 俯视 |
  | `bottom` | 200 | -35 | 仰视 |
  相机约定（renderer3d 已固化自测）：yaw=0 → +Z 角色正面；yaw=-90 → 角色右侧面。
- **姿态预设**（`--poses default` = 4 张，写进 `poses/`，全部在 `front` 视角渲染）：
  | id | animation | time(s) |
  |---|---|---|
  | `idle_0` | idle | 0.0 |
  | `walk_25` | walk | 0.25 |
  | `walk_75` | walk | 0.75 |
  | `wave_60` | wave | 0.6 |
  实现必须用 `renderer.setAnimation(mode)` + `setAnimationTime(t)` + `pauseAnimation(true)`（已由 Lead 加入
  `js/renderer3d.js`，随 `lib/renderer3d.js` 打包）得到**确定性姿态**；`setAutoRotate(false)`。
- `--pose-views` 可给姿态帧换视角（默认 `front`）。
- `--crops`（默认开）：调用 `bin/skin.mjs crops`（spawn 子进程）生成 `texture/` 裁切；`--no-crops` 关闭。
- 输出结构：
  ```
  <outdir>/views/*.png          # 每张约 400×460，透明背景外加静态棋盘/深色底？→ 用深色底即可
  <outdir>/poses/*.png
  <outdir>/texture/*.png        # full_4x.png + <part>_8x.png
  <outdir>/report.json          # 见下
  ```
- `report.json`：
  ```json
  { "ok":true, "skin":"a.png", "format":"64x64", "generatedAt":"...",
    "views":[{"id":"front","yaw":0,"pitch":0,"file":"views/front.png","bytes":12345}],
    "poses":[{"id":"walk_25","anim":"walk","time":0.25,"view":"front","file":"poses/walk_25.png"}],
    "texture":["texture/head_8x.png", ...],
    "errors":[] }
  ```

### 2.2 harness/render.html

- 引用 `../lib/rules.js`、`../lib/renderer3d.js`（model 不需要）。
- 由 `render.mjs` 生成注入文件：`window.__SKIN__=<dataURL>`、`window.__PLAN__=<json>`（views/poses 列表、画布尺寸、缩放）。
- 逐项：`setSkin` → 设置旋转/缩放 → 姿态（如上）→ `render()` → `canvas.toDataURL('image/png')`，
  收进 `{items:[{id,kind,dataurl}],errors:[]}`，写入 `<script id="probe-json">`，`document.title` = `RENDER-DONE` 或 `RENDER-FAIL`。
- 画布建议 400×460；`--scale` 时等比放大（受无头窗口尺寸限制，scale≤2）。
- WebGL 不可用时：items 空、errors 内写中文原因（render.mjs 据此报错）。

### 2.3 `bin/headless.mjs`

从工作区 `tools/headless.mjs` **复制并改造**（改造点）：
- 输出目录用系统临时目录（`fs.mkdtempSync(os.tmpdir()/mcskin-)`，用完删除 profile），不写 `tests/out`。
- 用法 `node bin/headless.mjs <html绝对路径> [--width N] [--height N] [--timeout ms]`；
  stdout 输出 JSON（含 `probe`、`title`、`exitCode`、`stderrTail`），probe 提取多个候选直到解析成功
  （注入脚本注释里可能出现同名 id —— 这段逻辑从原版保留）。
- Edge/Chrome 路径探测沿用原版候选列表；找不到浏览器时 stdout `{ok:false,error:"..."}` exit 1。
- 直接用 `child_process.spawnSync` 拉起浏览器，参数含 `--headless=new --use-angle=swiftshader
  --enable-unsafe-swiftshader --virtual-time-budget --dump-dom`（原版已验证可用）。

### 2.4 自测

`node bin/render.mjs --selftest` → JSON：无浏览器时**跳过渲染**、只验证计划生成/JSON 结构/注入文件生成
（`{ok:true, skipped:'no-browser'}` 当探测不到浏览器）；有浏览器时对一张有内容的皮肤
（`node bin/skin.mjs new -o <tmp> --template default`，注意 `--template` 默认是 `blank`）跑最小计划（views=front, poses=walk_25, --no-crops），
断言 PNG 文件非空 ≥1KB、report.json 各项齐全。exit 0 表示通过。

## 3. `SKILL.md` + `references/` + `examples/`（负责人：skill-author）

### 3.1 `SKILL.md` frontmatter（字段名与值照抄）

```yaml
---
name: mcskin-artist
description: "Draw, review and iterate on Minecraft skins (64×64 / 64×32) end-to-end from the command line: batch pixel drawing, programmatic lint scoring, and multi-view multi-pose 3D screenshot review. | 从命令行端到端绘制与审查 Minecraft 皮肤：批量像素绘制、lint 质量评分、多视角多姿态 3D 截图审查。触发：画/绘制/审查 MC 皮肤、skin 绘制、皮肤质检、多视角预览皮肤。"
argument-hint: "[skin.png 或 绘制需求描述]"
version: "1.0.0"
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---
```

### 3.2 正文必须包含（章节顺序固定）

1. **语言/执行根**：沿用 dot-skill 的两行惯例（中英双语支持提示 + 所有命令在本 SKILL.md 所在目录执行、
   `bin/...` `lib/...` 均为相对路径，禁止拼 `~/.dsh/...` 前缀）。
2. **能力总览**（绘制 / lint 审查 / 多视角多姿态渲染审查 / 多轮修改 / 质量门槛）。
3. **标准工作流（多轮）**——逐步编号，含硬性节奏：
   - R0 规划：需求 → 配色（≤24 色）、部位分区（引用 references/uv-layout.md）
   - R1 铺底：`skin.mjs new` + `run` 批量 rect/fill + `mirror-limbs`
   - R2+ 精修循环（最多 5 轮）：`lint`（记录分数）→ `render` → 用 `read_image` **逐张**看
     `views/` 与 `poses/` 与 `texture/` → 写「问题清单 + 修改计划」→ `run` 修改 → 再 lint/render
   - 终止条件：达 §5 质量门槛（且至少 2 轮视觉审查）
   - 收尾：保存最终 PNG + 汇报（最终分数、每轮分数变化、遗留问题）
   - **每轮把当前皮肤存档为 `<name>.round<N>.png`**，可回滚
4. **CLI 速查**：`bin/skin.mjs` 全部命令 + 参数 + 一段典型 `run` 脚本示例（脚本文件放 `examples/`）。
5. **视觉审查清单（怎么“看”）**——分视角/分姿态的具体检查点，例如：
   - front/front34：脸是否可辨、双眼是否对称、发际线、衣服正中线、左右臂色差
   - sideR/sideL：厚度是否对（头 8、躯干 4）、前后缘是否齐、袖口/裤脚收边
   - back：背面别是纯色平板；裤子/鞋后跟
   - top/bottom：头顶分区是否错位、脚底是否该有的鞋底
   - poses（walk_25/walk_75）：四肢摆动时贴图是否在关节处错位/露底（露出色差）
   - texture/*_8x.png：逐面看像素级缺陷（噪点、锯齿边、渐变断层）
6. **质量门槛（成品“足够精细”的定义）**：lint `grade ≥ A (score≥85)` 且所有 `fail=0`、`warn≤2`；
   视觉清单全部勾选；并列出"精细度"硬指标：≥4 个基础层部件 front 面 distinctColors≥3、外层已使用、
   噪点≤4、调色板≤40 且无 ≤6 距离近重复、64×64 完成（非 legacy）。
7. **多轮修改协议**：每轮必须产出（分数、看图结论、本轮改动点）三段；若连续两轮分数不涨 → 换策略提示
   （局部重画而非叠加细节）；禁止"只 lint 不看图"或"只看图不 lint"。
8. **故障处理**：headless 无浏览器 → 退化为 `crops` 裁切审查并告知用户；WebGL 不可用 → 同上；
   坐标不确定 → 先 `pixel`/`region` 查询再动手。
9. **文件与路径约定**：皮肤放当前工作目录 `<name>.png`，rounds 存档命名，渲染输出 `<name>.review/`。

### 3.3 `references/uv-layout.md`

从工作区 `README.md` 第三章整理：十字带规则、4×4 格子速查表、64×64 完整坐标表、64×32 旧版规则、
**face→3D 面对应（右/正/左/背 的贴图顺序）**、外层 0.25 膨胀说明。数据型事实表照抄（坐标是事实数据）。

### 3.4 `examples/revision-loop.md`

一份**虚构但格式真实**的完整两轮修订示例：需求 → R1 命令与 run 脚本 → lint 输出节选 → render 产物清单 →
read_image 观察记录（写"我看到了什么"）→ 问题清单 → R2 改动 run 脚本 → lint 分数提升 → 达标。
命令必须与 §1/§2 完全一致（不要发明不存在的参数）。

## 4. `tools/install_skill.mjs`（负责人：Lead）

- 默认 target：`C:\Users\18002\.dsh\skills\mcskin-artist`；`--target <dir>` 可覆盖；
  `--dev` = 把依赖拷进**源目录** `skill/mcskin-artist/lib/`（供开发自测）；
  `--check` = 只校验：frontmatter 可解析、引用的 `bin/...` `lib/...` 文件都存在且 `node --check` 通过。
- 依赖映射：`js/rules.js→lib/rules.js`、`js/model.js→lib/model.js`、`js/renderer3d.js→lib/renderer3d.js`、
  `tools/png.mjs→lib/png.mjs`。
- 源内自产文件（拷贝目标）：`SKILL.md`、`bin/**`、`harness/**`、`references/**`、`examples/**`、`CONTRACT.md`（可选）。
  跳过 `_stage/`、`lib/`（lib 由依赖映射生成，非手写）。

## 5. 质量与验收（Lead 执行，队友需保证自己的部分通过）

1. `node tools/install_skill.mjs --dev && node tools/install_skill.mjs --check`（装好依赖后）
2. `node skill/mcskin-artist/bin/skin.mjs selftest` → fail 0
3. `node skill/mcskin-artist/bin/render.mjs --selftest` → ok
4. Lead 端到端演示：CLI 从零画一张有细节的皮肤 → lint ≥A → render → 逐图审查 → 修一轮 → 分数提升 → 终版达标
5. 工作区回归：`node tools/run_tests.mjs` 必须全绿（renderer 改动不能破坏编辑器）
6. 安装到 `.dsh\skills`，`--check` 通过
