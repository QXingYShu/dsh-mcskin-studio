# dsh-mcskin-studio 插件接口契约 v1（Lead 维护，队友只读）

> 目标：把本仓库的 **mcskin-artist skill**（AI 绘制/审查 Minecraft 皮肤）包装成一个
> **DeepSeek Harness UI 插件**，让用户在 DSH 设置界面里直接看到技能状态、跑质量评分、
> 看多视角多姿态渲染图；同时给 agent 提供两个工具（`skin_lint` / `skin_render`）。
>
> 依据：**harness 自带的官方插件开发规范**
> `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（SKILL.md +
> references/host-plugin.md + references/ui-plugin.md + templates/decoration/ 四文件模板）。
> 不要照抄本机那两个半成品插件（maid-atelier / dsh-plugin-manager）。

## 1. 官方规范要点（Lead 已核实）

**包形态**：一个 bundle = 一个目录，含 4 个文件：
```
plugin/dsh-mcskin-studio/
  package.json        # exports {".":"./index.js","./client":"./client.js"}；dsh.bundle.patch；dsh.client{platform,inject}
  cordis.patch.yml    # - insert: [{id, name}]
  index.js            # Host 半边
  client.js           # Client 半边（浏览器）
```
（另加 README/LICENSE/locale/icon.svg 由 Lead 提供，不在两位队友范围内。）

**Host 半边**：`export const inject = [...]` + `export function apply(ctx) {}`；
需要工具时 `ctx.tools.register(defineTool({name, description, parameters}))`（`defineTool` 来自
`@deepseek-ai/dsh-tools`）；所有资源注册进 `ctx.effect`/`ctx.on` 并返回清理函数。

**Client 半边**：`window.__ModuleLoader__.load({ id, factory(require) { … return { inject, apply(ctx) } } })`，
React 由 `require('react')` 取；通过 `ctx.slots.inject(slot, () => ctx.slots.register({name, id, order}, Component))`
向 slot 贡献内容；我们注册的目标 slot 是 **`settings.plugins.tab`**（官方 README：贡献需 `id`、`order`、本地化 `label`）。
副作用放进 `apply` 的 `ctx.effect`/`ctx.on` 并返回清理。

## 2. 我们要提供的能力

### 2.1 Host 服务 `skinStudio`（client 面板通过 Remote 调用）
> Host 服务注册方式：参考官方 `dsh-host-plugin-inventory`：`ctx.effect(...)` 里
> `ctx.api? / ctx.remote?` —— **具体注册 API 请两位队友先 grep asar 内的官方包确认**
> （`dsh/node_modules/@deepseek-ai/dsh-host-plugin-inventory/lib/index.js` 是最简范例）。
> 若 Remote 注册复杂，**降级方案**：Client 不走 Remote，改为直接用 fetch 调我们 Host 注册的 HTTP 路由
> （官方 `dsh-host-webserver` 提供 `ctx.webServer.register({kind:'exact',path,handler})`，见
> 本机 `dsh-plugin-manager/lib/index.js` 用法，但那是半成品；请以 asar 内 `dsh-host-webserver` 的 README 为准）。

服务/路由需提供：
- `status()` → `{ skillInstalled: bool, skillPath, version, nodeAvailable }`
  - skill 目录：`~/.dsh/skills/mcskin-artist`（也接受 `~/.agents/skills/mcskin-artist`）
- `lint({ file })` → 直接 `spawn` `node <skill>/bin/skin.mjs lint <file>`，解析 stdout JSON，返回完整报告
- `render({ file, outDir })` → `spawn` `node <skill>/bin/render.mjs <file> -o <outDir>`，
  返回 `{ views:[{id,file}], poses:[{id,file}], texture:[file], report }`（把 report.json 读出来）
- `openStudio(url)`（可选）→ 打开网页版绘制工具

### 2.2 Agent 工具（`ctx.tools.register`）
| 工具名 | 参数 | 行为 |
|---|---|---|
| `skin_lint` | `{ file: string }` | 跑 lint；返回 `{score, grade, summary, checks:[{id,level,msg}]}` 摘要（JSON 字符串） |
| `skin_render` | `{ file: string, outDir?: string }` | 跑 render；返回产物路径清单 + report 摘要 |

约束：**不得**执行任意 shell；只允许 spawn `node <已解析的 skill 路径>/bin/{skin,render}.mjs`，
参数数组传参（不拼字符串），超时 120s，输出截断到 ~8KB。skill 不存在时返回可读中文错误。

## 3. 分工与写作用域

| 文件 | 负责人 | 内容 |
|---|---|---|
| `index.js` | teammate `plugin-host` | Host：inject + apply + skinStudio 服务/HTTP 路由 + 两个 agent 工具 |
| `client.js` | teammate `plugin-client` | Client：settings.plugins.tab 标签页「皮肤工作台」 |
| 其余全部 | Lead | package.json / cordis.patch.yml / icon.svg / locale / README / LICENSE / 安装与验证脚本 |

两位队友**不得**修改 `package.json`、`cordis.patch.yml` 或彼此的文件。

## 4. 交付与验证

1. `node --check plugin/dsh-mcskin-studio/index.js` 与 `client.js` 通过。
2. 各自文件顶部写注释说明：注入什么、注册什么 slot/工具、如何清理。
3. 分块写入（每次 ≤300 行），每块后 `--check`。
4. 完成后向 lead 汇报：注册的 slot id、工具名、对外接口签名、验证方式与结果。

## 5. Lead 后续会做的事

- 写 manifest（package.json/cordis.patch.yml/icon/locale/README/LICENSE）
- 在本机用 `plugin_manager install_bundle` 或等价方式安装验证（需要用户在 GUI 或 CLI 侧配合）
- `git init` + 提交 + `gh repo create --public --source . --push`（不加 dsh-plugin 标签）
