# 示例：两轮修订完整流程（森林游侠）

> 这是一个**格式真实**的样例：命令、JSON 字段、文件名都与 `bin/skin.mjs` / `bin/render.mjs` 一致。
> 照着做就能跑通整条链路。

## 需求

> 画一个"森林游侠"：绿斗篷、棕发、深色裤子、灰靴，脸要能看清五官，正反面都别有空白。

## R0 规划（不写像素）

- 调色板（14 色）：肤色 `#e8b48a` / 肤色暗 `#cf9871` / 发 `#6b4a2f` / 发暗 `#553a25` /
  眼白 `#ffffff` / 瞳 `#3f70c8` / 上衣 `#3f8f5f` / 上衣暗 `#34774f` / 上衣最深 `#2a6341` /
  皮带 `#7a5a35` / 铜扣 `#d9c26a` / 裤 `#4a5a78` / 裤暗 `#3d4c66` / 靴 `#6b6b73`
- 分区（查 `references/uv-layout.md`）：脸在头正面 8,8–15,15；衣服在躯干正面 20,20–27,31；
  袖子 44,20–47,24；手 44,25–47,31；裤 4,20–7,27；靴 4,28–7,31。

```bash
node bin/skin.mjs new -o ranger.png --template blank
```

## R1 铺底

`rounds/r1.txt`：

```text
# 头
rect 8,8,15,15,#e8b48a
rect 8,8,15,10,#6b4a2f
rect 0,8,7,15,#e8b48a
rect 16,8,23,15,#e8b48a
rect 24,8,31,15,#6b4a2f
# 躯干
rect 20,20,27,31,#3f8f5f
rect 16,20,19,31,#34774f
rect 28,20,31,31,#34774f
rect 32,20,39,31,#3f8f5f
# 右臂 / 右腿
rect 44,20,47,24,#3f8f5f
rect 44,25,47,31,#e8b48a
rect 4,20,7,27,#4a5a78
rect 4,28,7,31,#6b6b73
mirror-limbs
```

```bash
node bin/skin.mjs run rounds/r1.txt ranger.png -o ranger.png
```

## R1 检查：lint

```bash
node bin/skin.mjs lint ranger.png
```

```json
{
  "ok": true, "file": "ranger.png", "format": "modern", "score": 64, "grade": "C",
  "checks": [
    { "id": "format", "level": "pass", "msg": "64×64 现代格式" },
    { "id": "outside-pixels", "level": "pass", "msg": "所有不透明像素都属于有效部位区域" },
    { "id": "empty-base-part", "level": "warn", "msg": "基础层有 1 个部位完全空白：head", "evidence": { "missing": ["head"] } },
    { "id": "flat-face", "level": "warn", "msg": "这些部件的正面只有一种颜色，缺少细节：body、rightLeg", "evidence": { "parts": ["body", "rightLeg"] } },
    { "id": "low-detail", "level": "warn", "msg": "细节偏少：边缘能量 0.121 < 0.18（大面积平涂）", "evidence": { "edgeRatio": 0.121 } },
    { "id": "outer-unused", "level": "warn", "msg": "外层（帽子/外套/袖/裤）完全没用：加头发或衣摆会明显提升层次感" },
    { "id": "mirror-balance", "level": "info", "msg": "左右臂正面平均色差 0", "evidence": { "distance": 0 } }
  ],
  "summary": { "fail": 0, "warn": 4, "info": 1, "pass": 7 }
}
```

## R1 检查：渲染 + 看图

```bash
node bin/render.mjs ranger.png -o ranger.review
# → ranger.review/views/front.png …（8 张）
#   ranger.review/poses/{idle_0,walk_25,walk_75,wave_60}.png
#   ranger.review/texture/{full_4x.png, head_8x.png, body_8x.png, …}
#   ranger.review/report.json
```

用 `read_image` 逐张看，记录（节选）：

- `views/front.png`：脸是"一整块肤色"，看不出眼睛和嘴；上衣是一块平绿，没有衣褶或扣子 → 缺细节。
- `views/back.png`：背面全绿平板，头发只到头顶边缘，后脑勺是秃的 → 需要后脑头发 + 背带。
- `views/sideL.png`：头侧面有头发但没有鬓角过渡，显得很平。
- `poses/walk_25.png`：手臂摆动时肩部正常，没有露底 → 姿态这块没问题。
- `texture/body_8x.png`：躯干正面 8×12 里只有 1 种颜色。

## R1 问题清单 → R2 修改计划

| # | 问题 | 修改 |
|---|---|---|
| 1 | 脸缺五官 | 眼白/瞳孔/嘴/鼻影按坐标补上 |
| 2 | 上衣平板 | 加暗部边、铜扣一列、下摆皮带 |
| 3 | 后脑秃 | 加外层帽子正面/顶面/背面（棕发） |
| 4 | 头侧没有过渡 | 头侧面把发际线下移一行，加鬓角 |
| 5 | 裤子平板 | 加裤缝暗线 + 膝盖亮块 |

`rounds/r2.txt`：

```text
# 1. 五官
rect 9,12,10,12,#ffffff
rect 13,12,14,12,#ffffff
set ranger.png 10,12,#3f70c8 13,12,#3f70c8
rect 11,14,12,14,#b06a5a
rect 11,13,12,13,#cf9871
# 2. 上衣：暗部 + 铜扣 + 皮带
rect 20,20,20,31,#2a6341
rect 27,20,27,31,#2a6341
set ranger.png 23,23,#d9c26a 23,26,#d9c26a 23,29,#d9c26a
rect 20,30,27,31,#7a5a35
# 3. 外层头发（帽子层）
rect 40,8,47,11,#6b4a2f
rect 40,0,47,7,#6b4a2f
rect 56,8,63,15,#6b4a2f
# 4. 鬓角
rect 0,11,7,11,#6b4a2f
rect 16,11,23,11,#6b4a2f
# 5. 裤缝 + 膝盖
rect 5,20,5,27,#3d4c66
rect 6,23,7,24,#5d6d8c
mirror-limbs
```

```bash
node bin/skin.mjs run rounds/r2.txt ranger.png -o ranger.png
node bin/skin.mjs lint ranger.png          # → score 88, grade A
node bin/render.mjs ranger.png -o ranger.review
```

R2 的 lint（节选）：

```json
{ "ok": true, "score": 88, "grade": "A",
  "summary": { "fail": 0, "warn": 2, "info": 1, "pass": 9 },
  "checks": [
    { "id": "flat-face", "level": "pass", "msg": "已绘制部件的正面都有颜色变化" },
    { "id": "low-detail", "level": "pass", "msg": "细节密度合格：边缘能量 0.243", "evidence": { "edgeRatio": 0.243 } },
    { "id": "outer-unused", "level": "pass", "msg": "外层已使用（768 像素）" },
    { "id": "noise", "level": "warn", "msg": "有 6 个孤立噪点（与四周都不连色）", "evidence": { "count": 6, "samples": [{ "x": 21, "y": 22 }] } }
  ] }
```

R2 看图结论（节选）：`views/front.png` 现在能看清双眼与嘴，衣服有扣子和腰带；
`views/back.png` 后脑有头发、背上有皮带；`poses/wave_60.png` 抬起的手臂腋下没有露底。
剩余：`noise` 还报 6 个孤立点（都在皮带边缘，实际是描边，可接受）。

## 收尾

- 最终：`ranger.png`（88 分 A 级），快照 `ranger.round1.png` / `ranger.round2.png`。
- 汇报：两轮分数 64 → 88；剩余瑕疵 1 项（`noise` 6 点，视觉上属于描边不是脏点）。
