# Agent Note: 受管 MCP 服务器 catalog

Status: implemented

[English](2026-08-18-managed-mcp-server-catalog.md) | 中文

## Problem

MCP client 接受完整的 Cordis 插件配置，但要求每位 CLI 用户编写 patch YAML，会让普通服务器配置难以发现且容易出错。把身份验证值直接保存在共享配置文件中，还会通过文件读取、命令输出与配置 dump 暴露密钥。

## Decision

无需启动 profile 的 `deepseek mcp` 命令会管理 `$DSH_HOME/mcp.json` 中版本为 0 的 catalog。`list`、`get`、`add` 与 `remove` 覆盖 stdio 和 Streamable HTTP 服务器。写入方使用共享的跨进程文件锁和原子替换工具；在 POSIX 权限生效的平台上，替换文件使用 `0600` 模式，新建父目录使用 `0700` 模式。同名条目必须先删除才能替换，因此误写的更新不会悄悄改变受信任的可执行代码。

catalog 保存环境变量来源名称，而不是解析后的值。`--env KEY[=SOURCE]` 把启动环境值映射到 stdio 进程，`--header NAME=SOURCE` 则把值映射到 HTTP header。profile 组合会在插件启动前立即解析引用，并在来源未设置时停止。命令拒绝 URL 用户信息；`get`、`list` 与配置 dump 都不会解析引用，dump 会渲染 `<environment:SOURCE>`。

启动器会把每个 catalog 条目投影为一个普通的 `@deepseek-ai/dsh-mcp-client` 插入行，并使用稳定的 `managed-mcp-<server>` 行 id。该层位于随附组合包层之后、profile 与 home patch 层之前，因此现有 Cordis 覆盖层仍拥有最终控制权。投影只应用于随附的 `tui`、`headless` 与 `web` profile；自定义 profile 继续自行声明 MCP 行。catalog 修改会在下次进程启动时生效；TUI 的 `/mcp` 视图检查已经发布到当前 Agent 作用域的工具。

持久格式解析器会拒绝未知字段、不支持的版本、格式错误的名称、无效传输数据，以及无效的环境变量或 header 引用。它不会推断接收旧 schema，也不会静默跳过无效服务器。

## Alternatives considered

**要求每个服务器都使用 `cordis.patch.yml`。** 直接 patch 继续作为高级用法与自定义 profile 路径，但它不提供简洁的产品命令、写入协调，也没有默认使用引用的安全凭据方式。

**保存环境变量与 header 的字面值。** 仅靠文件权限无法阻止密钥出现在检查输出、备份或复制的配置中。引用会让密钥材料继续由现有启动环境持有。

**从 TUI 修改实时 MCP 实例。** 第二套运行时管理器会重复 Cordis 生命周期所有权，而且只有先提供连接状态服务，才能可靠报告 reload 结果。该 catalog 继续作为启动时输入；只有通过由 MCP client 生命周期持有、受 effect 约束的服务，才可增加实时 `/mcp` 管理。

## Consequences

常见 MCP 配置现在拥有一个稳定的 CLI 界面，并可在不改变底层插件架构的前提下跨所有随附应用 profile 工作。受管配置保持可检查且确定，密钥值则不会进入持久文件与配置 dump。

服务器可执行文件仍是 agent（智能体）沙箱之外的受信任本地代码，CLI 也不会安装它们。该 catalog 不提供 OAuth、启用或禁用状态与实时 reload。单元测试固定解析、修改、权限、引用解析、脱敏和生成的 patch；built-bin e2e 测试固定真实命令分派与 dump 组合。由于管理命令无需启动 profile，也不会产生 transcript 事件，因此不添加 Session 快照。
