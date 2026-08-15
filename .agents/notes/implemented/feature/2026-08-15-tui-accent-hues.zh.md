# Agent Note: 可选 TUI 强调色

Status: implemented

[English](2026-08-15-tui-accent-hues.md) | 中文

## 问题

[终端前端](2026-08-14-shipped-tui-cli-front-door.md)只固定使用一种交互强调色：prompt、边框、角色标题与选择态统一采用 ANSI 亮蓝（`94`），真彩色启动 banner 渐变与品牌标志则使用 DeepSeek 的 `#4D6BFE`。没有任何方式能更改该强调色，因此终端无法在不 fork 包的前提下跟随视觉转向。

## 决策

调色板新增可选的强调色（accent hue），用户会将它与明色或暗色外观一起选择。随附色相为 `deepseek`（默认，行为不变）、`cosmic-orange`、`mist-blue`、`sage`、`lavender` 和 `deep-blue`，其中 iPhone 配色取自 Apple 已发布的 CSS。每种色相都是 `components/theme.ts` 中的一个 `AccentHue` 条目，包含用于 `accent` 角色的 ANSI 亮色码、用于 `brand` 角色的 ANSI 色码，以及两套真彩色——暗色背景用的亮色 `dark` 与浅色背景用的深色 `light`——每套各带一段三段式 banner 渐变。

每个背景各自记住自己的色相。TUI 在 `ui-accent` 命名空间中持久化 `{ light, dark }` 选择，运行中的调色板读取与当前终端颜色方案匹配的那一项。交互角色使用该色相的 ANSI 码，由终端映射到当前配色方案；真彩色终端还会让启动 banner 绘制该背景的渐变，并让 `brandText` 使用对应色值。composer 与已提交用户卡片使用从同一色值派生的淡色表面，无需等待终端回复 OSC 11 背景查询；支持时使用精确 24 位背景，否则回退到 xterm 256 色。零状态欢迎面板保留终端背景。默认 `deepseek` 选择保留原有 Web 气泡表面、蓝色角色码与真彩色渐变节点。

TUI 在 Web 自有的 `ui-theme` 与 `locale` 之外注册自己的 `ui-accent` 设置命名空间，因为色相归终端所有，即使未组合 Web 客户端栈也必须能够持久化。进程会等待该命名空间载入已存值，再让聊天界面读取初始调色板。不带参数的 `/theme` 会打开一个附着 composer 的统一选择器：顶部是 `DeepSeek` 系统默认行，下面是每种色相的 `Light ·` 与 `Dark ·` 主题卡。选择卡片会一起字段级修改 `ui-theme.preference` 与对应的 `ui-accent` 字段；`/theme light|dark|system [id]` 提供相同的直接路径，`/theme deepseek` 则重置产品默认值。Settings hub 只显示一个 Theme 行，不再拆分 Appearance 与 Accent。外部 `settings/updated` 事件会实时重绘调色板、banner、界面、composer 与用户卡片，与 locale 控制器行为一致。

## 考虑过的替代方案

**复用 Web 的 `ui-theme` 命名空间。** 该 schema 归 Web 所有且只校验 `preference`，为终端专属关注点添加 `accent` 字段会放宽浏览器 schema。

**采用无 ANSI 回退的固定 24 位强调色。** 这会破坏让界面在任意终端背景下保持可读的「适配主题」行为。

**两个背景共用一个色相。** 亮的 iPhone 配色在浅色终端上、深的配色在深色终端上都不可读，因此在强调色变为可选后，必须按背景拆分色值。

## 验证

单元测试断言每种色相的 ANSI 码、按背景区分的真彩色、渐变、带色调的卡片表面、终端不回复背景查询时的回退，以及未知 id 回退到 `deepseek`。一个聚焦的 controller 测试通过两个设置命名空间持久化 `/theme light cosmic-orange`，并确认界面与聊天卡片表面同步重绘。终端快照固定统一 Theme 选择器、Settings hub 行与命令目录。

## 后果

随附六种主题色，`deepseek`/`deepseek` 是零回归的默认选择。调色板、启动 banner、品牌色、欢迎面板、composer、用户卡片与 `/palette` 都跟随当前背景的色相。为兼容 Web 与保留逐背景记忆，外观和色相仍独立持久化，但终端会把它们呈现为一个主题选择。新增色相只需在 `ACCENT_HUES` 中追加一行。
