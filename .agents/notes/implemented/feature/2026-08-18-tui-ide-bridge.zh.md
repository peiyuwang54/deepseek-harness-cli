# Agent Note: TUI IDE bridge protocol

Status: implemented

[English](2026-08-18-tui-ide-bridge.md) | 中文

## Problem

终端 `/ide` 命令可以识别终端宿主并插入文件引用，但无法读取当前编辑器选区、展示诊断、跳转到位置，也无法把可审查的 diff 交给编辑器。

## Decision

TUI 将 `DSH_IDE_BRIDGE_URL` 作为受信任的 HTTP(S) 桥接根地址读取，并把可选的 `DSH_IDE_BRIDGE_TOKEN` 作为 bearer 凭据发送。统一协议提供 `GET /context`、`POST /open`、`POST /diff` 和 `POST /diff/<id>/accept`；位置使用从 0 开始的坐标，diff 的所有权保留在桥接方，TUI 只保留返回的 diff id。客户端在外部 JSON 边界验证每个响应，将响应限制为 1 MiB，并在五秒后中止请求。

`/ide context` 和 `/ide diagnostics` 展示当前文件、选区与有上限的诊断列表。`/ide open` 和 `/ide jump` 打开带可选行列的位置；用户输入的一位起始行列会被客户端转换为协议使用的从 0 开始坐标。`/ide diff` 先计算现有的只读 Git diff，再要求桥接方展示；`/ide accept` 要求桥接方应用之前展示的 diff。没有配置地址时，原有终端原生文件引用和 workspace 操作继续可用。

## Alternatives considered

**针对编辑器分别适配：** 分别实现 VS Code、Cursor 和 Windsurf 会重复请求语义，并让终端依赖厂商 API。小型 HTTP 协议让每个编辑器提供一个适配器，而 TUI 只保留一个客户端。

**轮询本地文件：** 轮询无法表达选区、诊断或编辑器持有的 diff 审查，还可能与未保存缓冲区竞争。桥接方继续负责这些状态。

**由 TUI 直接应用补丁：** 直接写入补丁会绕过编辑器的审查和所有权模型，因此由桥接方展示并接受自己的 diff id。

## Consequences

协议需要配套的桥接扩展或服务；仓库不会声称每个终端宿主都已提供它。TUI 不会把桥接 token 或编辑器载荷写入 Session，格式错误或超限响应会安全失败。协议的传输固定为 HTTP(S)，但编辑器无关；未来其他传输提供方可以复用相同操作而无需改变命令词汇。
