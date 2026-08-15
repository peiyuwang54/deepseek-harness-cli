# Agent Note: 可选 TUI 强调色

Status: implemented

[English](2026-08-15-tui-accent-hues.md) | 中文

## 问题

[终端前端](2026-08-14-shipped-tui-cli-front-door.md)只固定使用一种交互强调色：prompt、边框、角色标题与选择态统一采用 ANSI 亮蓝（`94`），真彩色启动 banner 渐变与品牌标志则使用 DeepSeek 的 `#4D6BFE`。没有任何方式能更改该强调色，因此终端无法在不 fork 包的前提下跟随视觉转向。

## 决策

调色板新增可选的强调色（accent hue），与既有的明／暗／跟随系统外观偏好相互正交。随附色相为 `deepseek`（默认，行为不变）、`cosmic-orange`、`mist-blue`、`sage`、`lavender` 和 `deep-blue`。每种色相都是 `components/theme.ts` 中的一个 `AccentHue` 条目，包含 24 位真彩色、用于 `accent` 角色的 ANSI 亮色码、用于 `brand` 角色的 ANSI 色码，以及三段式 banner 渐变。

这一拆分保持了调色板「适配主题」的既有契约。交互角色使用该色相的 ANSI 码，由终端映射到当前配色方案。真彩色终端还会让启动 banner 绘制该色相的渐变，并让 `brandText` 使用精确色值。默认 `deepseek` 色相保留原有蓝色角色码与真彩色渐变节点。

TUI 在 Web 自有的 `ui-theme` 与 `locale` 之外注册自己的 `ui-accent` 设置命名空间，因为强调色归终端所有，即使未组合 Web 客户端栈也必须能够持久化。`/accent [id]` 会字段级修改 `ui-accent.accent`；不带参数时打开附着 composer 的内建色相选择器，Settings hub 也会列出当前强调色。外部 `settings/updated` 事件会实时重绘调色板、banner 与界面，与既有的 theme、locale 控制器行为一致。

## 考虑过的替代方案

**复用 Web 的 `ui-theme` 命名空间。** 该 schema 归 Web 所有且只校验 `preference`，为终端专属关注点添加 `accent` 字段会放宽浏览器 schema。

**采用无 ANSI 回退的固定 24 位强调色。** 这会破坏让界面在任意终端背景下保持可读的「适配主题」行为。

## 验证

单元测试断言每种色相的 ANSI 码、真彩色与渐变，以及未知 id 回退到 `deepseek`。一个聚焦的 controller 测试通过 `ui-accent` 命名空间持久化 `/accent cosmic-orange`，并通过外部 `settings/updated` 事件重新着色。终端快照固定 Accent 选择器、Settings hub 行与命令目录。

## 后果

随附六种强调色，`deepseek` 是零回归的默认值。调色板、启动 banner、品牌色与 `/palette` 都跟随当前强调色，且强调色独立于外观偏好持久化。新增色相只需在 `ACCENT_HUES` 中追加一行。
