---
name: mcskin-artist
description: "Draw, review and iterate on Minecraft skins (64×64 / 64×32) end-to-end from the command line: batch pixel drawing, programmatic lint scoring, and multi-view multi-pose 3D screenshot review. | 从命令行端到端绘制与审查 Minecraft 皮肤：批量像素绘制、lint 质量评分、多视角多姿态 3D 截图审查。触发：画/绘制/审查 MC 皮肤、skin 绘制、皮肤质检、多视角预览皮肤。"
argument-hint: "[skin.png 或 绘制需求描述]"
version: "1.0.0"
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

> **Language / 语言**: This skill supports both English and Chinese. Detect the user's language from the first message and keep answering in that language. 本 Skill 支持中英文：按用户第一条消息的语言，全程使用同一语言。

> **Execution Root / 执行根目录**: Run every `Bash` command from the directory that contains this `SKILL.md`. `bin/...`、`lib/...`、`references/...` 都是相对本 Skill 根目录的路径。
>
> **Critical rule / 关键规则**: 不要给命令加 `cd ~/.dsh/skills/...`、`cd ~/.claude/...` 之类猜测出来的前缀；当前目录就是 skill 根目录，直接 `node bin/skin.mjs ...`。

---

# mcskin-artist：AI 绘制 + 审查 Minecraft 皮肤

## 1. 能力总览

| 能力 | 工具 | 产出 |
|---|---|---|
| 像素级绘制 | `bin/skin.mjs`（set/fill/rect/line/mirror-limbs/run 批量脚本） | 64×64 / 64×32 皮肤 PNG |
| 程序化审查 | `bin/skin.mjs lint` | 13 项检查 + 0~100 分 + A/B/C/D 等级（JSON，含证据坐标） |
| 多视角 3D 审查 | `bin/render.mjs` | 8 视角 PNG（正/背/左右侧/两个 3/4/俯/仰） |
| 多姿态审查 | `bin/render.mjs` | 4 个确定性姿态帧 PNG（idle / walk×2 / wave） |
| 像素级细节审查 | `bin/render.mjs --crops`（默认开） | 整张 4× + 每个部位 8× 贴图裁切 |
| 多轮修改 | 上面的组合 + 文件快照 | 每轮 `<name>.round<N>.png`，可回滚 |

**你（AI）的工作方式**：把绘制当成"写代码 + 跑测试 + 看图评审"的循环 —— 命令画像素、
`lint` 当单元测试、`render` 出的图当人工评审材料，用 `read_image` 真的把图看一遍再改。

## 2. 标准工作流（多轮）

> 硬性节奏：**每轮必须"先 lint 再看图"**，两者都不许省。

### R0 规划（不动手像素）
1. 读需求，确定风格关键词（角色、配色、材质）。
2. 选定调色板（建议 ≤24 色，最多不超过 40），写下来：每个颜色一个 `#rrggbb` + 用途。
3. 用 `references/uv-layout.md` 确定每个部位落在哪些坐标；不确定就查：
   ```bash
   node bin/skin.mjs pixel skin.png 21,22      # 这个像素属于哪个部位/哪个面
   node bin/skin.mjs parts skin.png            # 每个部位当前有多少内容
   ```
4. 建议新建 64×64（现代格式）：
   ```bash
   node bin/skin.mjs new -o skin.png --template blank
   ```
   （`--template blank` 是默认值；想要一张有内容的起点用 `--template default`）

### R1 铺底
用 `run` 批量脚本一次画完大色块（比逐条命令快得多，也省 token）：
```bash
node bin/skin.mjs run rounds/r1.txt skin.png -o skin.png
```
脚本里只写 `命令 参数`，不要写皮肤路径与 `-o`（见 §4 示例）。
铺底要求：6 个基础层部位都要有内容，别留空白（lint 会报 `empty-base-part`）。

### R2+ 精修循环（最多 5 轮）
每一轮依次做 4 件事：

1. **存档**：`cp skin.png skin.round<N-1>.png`（改之前先存，方便回滚）。
2. **lint**：
   ```bash
   node bin/skin.mjs lint skin.png
   ```
   记下 `score` 与每条 `warn/fail` 的 `id` + `evidence`（证据里有具体坐标，直接照着改）。
3. **渲染 + 看图**（关键步骤，不许跳过）：
   ```bash
   node bin/render.mjs skin.png -o skin.review
   ```
   然后用 `read_image` **逐张**打开：
   - `skin.review/views/*.png`（8 张，按 §5 清单看）
   - `skin.review/poses/*.png`（4 张姿态帧，看关节处有没有错位/露底）
   - `skin.review/texture/*.png`（贴图 4×/8×，看像素级缺陷）
   每张都要写一句"我看到了什么"，不要只看一张就下结论。
4. **写问题清单 + 修改计划，然后改**：把问题按"坐标 + 期望效果"写成新的 `run` 脚本执行，
   然后回到第 2 步重新 lint + render。

### 终止条件
- 达到 §6 质量门槛（`grade ≥ A`、`fail = 0`、`warn ≤ 2`，且 §5 视觉清单全部通过）；
- **且**至少完成 2 轮"lint + 看图"（禁止一轮就交付）。

### 收尾
1. 保存最终文件（`skin.png`），保留每轮存档 `skin.round1.png …`。
2. 汇报三段：最终 `score/grade`、每轮分数变化、还剩哪些已知小瑕疵。

## 3. 绘制 CLI：`bin/skin.mjs`

所有命令的 stdout 都是**纯 JSON**；出错 `{"ok":false,"error":"..."}` 且 exit 1。
`lint` 无论分数高低都 exit 0（**分数门槛由你判断**：`fail===0`、`warn≤2`、`grade≥A`）。

| 命令 | 用法 | 说明 |
|---|---|---|
| `new` | `new -o out.png [--size 64\|32] [--template blank\|default]` | 新建（`blank` 为默认） |
| `convert` | `convert legacy.png -o out.png` | 64×32 → 64×64（逐面镜像补齐左肢） |
| `info` | `info skin.png` | 尺寸/格式/不透明像素/已画部位 |
| `pixel` | `pixel skin.png 21,22` | 查该像素颜色 + 所属部位/面/层 |
| `set` | `set skin.png 9,12,#3f70c8 10,12,#3f70c8` | 逐像素上色（可多组） |
| `fill` | `fill skin.png 20,20,#3f8f5f [--bounds region]` | 洪水填充；`--bounds region` 只在当前面内扩散 |
| `rect` | `rect skin.png 20,20,27,31,#3f8f5f [--outline #2a6341]` | 矩形（**含端点**）+ 可选边框 |
| `line` | `line skin.png 20,20,27,20,#2a6341` | 直线 |
| `mirror-limbs` | `mirror-limbs skin.png [--include-outer]` | 右臂/右腿逐面镜像到左侧（`--include-outer` 连袖/裤） |
| `palette` | `palette skin.png [--limit 30]` | 颜色统计（检查调色板是否失控） |
| `parts` | `parts skin.png` | 每个部位/面的不透明数、颜色数、平均色 |
| `crops` | `crops skin.png -o dir [--scale 8]` | 贴图裁切 |
| `lint` | `lint skin.png` | §6 的质量报告 |
| `run` | `run script.txt skin.png -o out.png` | 批量执行脚本里的多行命令 |
| `selftest` | `selftest` | 工具自检（应 fail=0） |

## 4. `run` 脚本格式

一行一个命令，`#` 开头是注释，空行忽略。**不要**写皮肤路径与 `-o`：

```text
# rounds/r1.txt —— 森林游侠 铺底
rect 8,8,15,15,#e8b48a           # 头正面：肤色
rect 8,8,15,10,#6b4a2f           # 头发（盖住额头三行）
rect 20,20,27,31,#3f8f5f         # 躯干：上衣
rect 16,20,19,31,#34774f         # 躯干右侧面：暗部
rect 44,20,47,24,#3f8f5f         # 右臂：袖子
rect 44,25,47,31,#e8b48a         # 右臂：手
rect 4,20,7,27,#4a5a78           # 右腿：裤子
rect 4,28,7,31,#6b6b73           # 右腿：鞋
mirror-limbs                     # 右臂/右腿镜像到左边
```
执行：`node bin/skin.mjs run rounds/r1.txt skin.png -o skin.png`

## 5. 视觉审查清单（怎么"看"）

### 视角（`views/`）
- **front**：脸是否可辨（两眼对称、间距合理）、发际线是否压住额头、衣服中缝/扣子是否居中、左右臂色差是否过大。
- **front34L / front34R**：发梢/帽檐是否有厚度（外层生效）、鼻梁与下颌的明暗过渡、肩线是否断裂。
- **sideR / sideL**：头厚 8、躯干厚 4、四肢厚 4 的比例是否正常；前后缘是否齐；袖口/裤脚有没有收边。
- **back**：背面不能是纯色平板（至少要有发尾、衣褶或背带）；鞋跟要有区分。
- **top / bottom**：头顶分区有没有错位（头皮/头发交界）；脚底应是鞋底色而不是和鞋面一样。

### 姿态（`poses/`）
- **walk_25 / walk_75**：手臂前后摆时，肩/肘处贴图是否错位、有没有露出透明或杂色。
- **wave_60**：右臂抬起 180°，腋下/侧腰是否出现拉伸错位或空白。
- **idle_0**：呼吸起伏时躯干与腿交界是否稳定。

### 像素级（`texture/*.png`）
- `full_4x.png`：整体是否有孤立噪点、色带断层、锯齿边。
- `<part>_8x.png`：单个部位逐面看 —— 边界是否对齐、渐变是否至少 2~3 级、细节不该只有一块平色。

## 6. 质量门槛（"成品足够精细"的定义）

**硬门槛（必须全过）**
1. `lint` 报告：`fail === 0`，`warn ≤ 2`，`grade ≥ A`（即 `score ≥ 85`）。
2. 达到 §5 视觉清单的全部检查点，且**至少两轮**"lint + 看图"。
3. 格式为 64×64 现代格式（64×32 必须先 `convert`）。

**精细度硬指标（lint 与 parts 可查）**
- 内容量：不透明像素 ≥1200（完整皮肤通常 ≥2500；空皮会直接 `content-coverage: fail`）；
- ≥4 个基础层部件的正面 `distinctColors ≥ 3`（有明暗/图案，不是一块平色）；
- 外层（`hat/jacket/rightSleeve/leftSleeve/rightPants/leftPants`）至少用了一处（头发/帽子/衣摆）；
- `edgeRatio ≥ 0.18`（细节密度达标，不做大面积平涂）；
- 噪点 ≤ 4；调色板 `distinct ≤ 40` 且没有 ≤6 距离的近重复色；
- 左右肢体对称（`mirror-balance` 记录的距离应接近 0，除非刻意做不对称设计）。

## 7. 多轮修改协议

- 每轮必须产出三段：**① lint 分数 ② 看图结论（每张图一句话）③ 本轮改动清单**。
- 改动要"成块"：一次改一类问题（例如本轮只修脸、下一轮只修衣褶），不要每轮都全图微调。
- **连续两轮分数不涨 → 换策略**：从"叠加细节"改为"局部重画"（先用 `rect` 把问题区域铺回底色再画）。
- 禁止：只跑 `lint` 不看图（会把分数刷高但图很丑）；只靠想象不看图就改（坐标写错）；一轮就交付。
- 每轮开始前先存快照 `skin.round<N>.png`，改坏了可以退回。

## 8. 故障处理

| 现象 | 处理 |
|---|---|
| `render.mjs` 报没有浏览器 / WebGL 不可用 | 退化为 `node bin/skin.mjs crops skin.png -o skin.review/texture` 只看贴图裁切，同时在汇报里说明"本轮无法做 3D 审查" |
| `render.mjs` 的 `report.json` 里 `errors` 非空 | 把 errors 原文贴进汇报；缺 `texture/` 时单独跑一次 `crops` |
| 不确定坐标属于哪个部位 | 先 `node bin/skin.mjs pixel skin.png x,y` 查询，再动手改 |
| **Windows PowerShell 下参数被拆坏** | 带逗号的参数必须**整段加引号**：`node bin/skin.mjs set skin.png '9,12,#3f70c8'`。不加引号时 pwsh 会把 `a,b` 当数组、把 `#` 当注释起点，参数会被拆散（不是 CLI 的问题） |
| `lint` 报 `outside-pixels` | 用 evidence 里的坐标 `set` 成透明 `#00000000`，或改到正确部位 |
| 分数上不去、图也看不出问题 | 优先加"外层"（头发/衣摆/腰带）与 2~3 级明暗，而不是加更多颜色 |

## 9. 文件与路径约定

- 皮肤文件放当前工作目录：`<name>.png`；每轮快照 `<name>.round<N>.png`。
- 审查产物放 `<name>.review/`（`views/ poses/ texture/ report.json`）。
- 批量绘制脚本放 `rounds/r<N>.txt`。
- 所有命令在**本 SKILL.md 所在目录**执行；路径参数用相对/绝对路径都可以，但不要假设 `cd` 过。
- 参考：`references/uv-layout.md`（贴图↔部位对照）、`examples/revision-loop.md`（两轮修订范例）。
