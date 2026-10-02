# dsh-mcskin-studio

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的 Minecraft 皮肤工作台：**一个插件 + 一个 skill + 一个网页绘制工具**，让 AI 与人协作绘制并审查 Minecraft 皮肤（64×64 / 64×32），成品带可量化的质量门槛。

```
┌─ plugin/dsh-mcskin-studio ── DSH 插件：设置面板「皮肤工作台」+ 两个 agent 工具
├─ skill/mcskin-artist ────── AI 技能：批量绘制 CLI、lint 评分、多视角多姿态渲染
└─ js/ + css/ + index.html ── 网页版绘制工具（零依赖、file:// 可直接打开）
```

## 它解决什么

AI 画像素皮肤有三个老问题：**没有像素级的操作手段**、**不知道"哪里画错了"**、**改完看不见效果**。
这套东西把它们变成可编程的闭环：

| 能力 | 做法 |
|---|---|
| 画 | `node bin/skin.mjs run rounds/r2.txt skin.png -o skin.png` —— 批量像素脚本，一次改几百点 |
| 查 | `node bin/skin.mjs pixel skin.png 21,22` —— 这个像素属于哪个部位/哪个面/哪一层 |
| 审（程序化） | `node bin/skin.mjs lint skin.png` —— 13 项检查，0-100 分 + A/B/C/D + 逐项证据坐标 |
| 审（视觉） | `node bin/render.mjs skin.png -o skin.review` —— 8 视角 + 4 姿态 + 贴图高清裁切，AI 逐张 `read_image` 看 |
| 改 | 多轮迭代，每轮存档 `skin.round<N>.png`，连续两轮不涨分就换策略 |

## 快速开始

```bash
git clone https://github.com/QXingYShu/dsh-mcskin-studio.git
cd dsh-mcskin-studio

# 1) 装技能（把 skill 拷进 ~/.dsh/skills/mcskin-artist，并注入它依赖的 lib/）
node tools/install_skill.mjs
#   想直接用仓库里的副本（改代码时），用 --dev 把依赖注入 skill/mcskin-artist/lib/：
node tools/install_skill.mjs --dev

# 2) 装插件（在 DSH 里：设置 → 插件 → 安装 bundle，或命令行）
dsh plugin --profile <你的profile> add .
#   或者在 DSH 设置界面里选这个 bundle 目录安装
#   新装入的 bundle 走 HMR 热激活，一般不需要重启

# 3) 打开网页版绘制工具（无需服务器）
start index.html      # Windows；macOS/Linux 用 open / xdg-open
```

命令行长这样（`skin.mjs` 在技能目录里，`--dev` 之后即可直接用）：

```bash
node skill/mcskin-artist/bin/skin.mjs new -o skin.png --template default
node skill/mcskin-artist/bin/skin.mjs run rounds/r2.txt skin.png -o skin.png
node skill/mcskin-artist/bin/skin.mjs lint skin.png
node skill/mcskin-artist/bin/render.mjs skin.png -o skin.review
```

装好后：
- **人**：设置 → 内置插件 → 「皮肤工作台」；或直接双击 `index.html` 用网页版画。
- **AI**：会话里说「画一张 MC 皮肤」即触发 `mcskin-artist` 技能；会话内还有 `skin_lint` / `skin_render` 两个工具。

## 目录

```
plugin/dsh-mcskin-studio/   插件本体（官方 4 文件形态：package.json + cordis.patch.yml + index.js + client.js）
skill/mcskin-artist/        AI 技能：SKILL.md（工作流/审查清单/质量门槛）+ bin/(CLI/渲染) + references/
js/ css/ index.html         网页版绘制工具（同一套 rules/渲染代码，零外部依赖）
tools/                      安装、验证、无头浏览器驱动、零依赖 PNG 编解码、asar 读取
tests/                      端到端验收探针 + 示例产物
docs/web-studio.md          网页版工具的完整文档（UV 映射对照表、格式说明）
```

## 验证

```bash
node tools/run_tests.mjs        # 一键：语法 + 转换/接缝验证 + 181 项模块自测 + 无头浏览器端到端 60 项
node tools/verify_plugin.mjs plugin/dsh-mcskin-studio   # 插件是否符合 DSH 官方规范（32 项）
node tools/probe_tools.mjs plugin/dsh-mcskin-studio     # 用宿主真实 dsh-tools 校验 agent 工具定义（18 项）
```

## 插件遵循的官方规范

插件形态不是自创的，来自 Harness 安装内置的插件开发文档
（`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development`）：

- bundle = 一个包目录 + `cordis.patch.yml`（`- insert:` 行）
- Host：`export const inject` + `apply(ctx)`，资源用 `ctx.effect` 注册并返回清理
- agent 工具：官方 `defineTool`（含 `parameters` 与 `output.render`）+ `ctx.tools.register`
- Client：`window.__ModuleLoader__.load` + `ctx.slots.inject/register`，贡献到 `settings.plugins.tab`
- 展示元信息：`package.json` 的 `meta` + `icon` + `locale/{en,zh}.json`

`tools/probe_tools.mjs` 会把安装里的真实 `dsh-tools` 抽出来跑一遍我们注册的工具，
因此"工具定义形状不对导致插件启动即崩"这类问题能在提交前被抓住。

## 安全边界

插件只会 `spawn` 已定位的技能路径下的 `node bin/{skin,render}.mjs`（参数数组传参，不拼 shell 字符串），
拒绝非 `.png` 路径，输出截断 8KB，超时 120s；HTTP 路由做同源校验；不引入任何第三方依赖。

## 许可

MIT，见 [LICENSE](LICENSE)。技能与网页工具部分同样 MIT。
