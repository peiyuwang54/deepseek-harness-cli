# Agent Note: 无 profile 诊断与 Shell 补全

Status: implemented

[English](2026-08-18-cli-doctor-completion.md) | 中文

## Problem

如果用户第一次运行的命令就是启动 profile，安装问题很难分类；启动器参数也无法通过 Shell 补全发现。

## Decision

启动器提供不挂载 profile 的 `deepseek doctor [--json]`。它报告 Node 与平台支持、workspace 和 Harness home 的访问、凭据是否存在、MCP catalog 语法、随附运行时资产和终端能力。只有阻断性检查失败时才返回非零状态。`deepseek completion <shell>` 输出 bash、zsh、fish 和 PowerShell 的静态补全脚本，并同时注册两个随附命令名。

## Alternatives considered

- **为诊断启动 profile** — 否决，因为损坏的 profile 或缺失的运行时资产会阻止诊断命令运行。
- **从实时插件 catalog 生成补全** — 否决，因为 profile 初始化之前也必须可以使用补全，而且不能执行第三方插件代码。

## Consequences

Doctor 不会访问模型、启动 MCP 服务器或修改用户文件。缺少 API Key、Harness home、非 TTY 输出和未声明 truecolor 都是警告；配置格式错误、workspace 无法访问、不支持的 Node 或运行时资产不完整属于阻断性错误。补全脚本覆盖启动器命令和常用参数，不尝试发现第三方插件命令。
