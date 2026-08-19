# Agent Note: 通过 Playwright MCP 提供默认关闭的浏览器验证

Status: implemented

[English](2026-08-19-playwright-mcp-browser-validation.md) | 中文

## Problem

通用 MCP 客户端能够连接浏览器服务器，但仓库此前没有提供经过审查的配置、安装路径、安全默认值或基于证据的验证工作流。要求用户自行设计该组合会让浏览器验证难以发现，也容易引入首次运行时下载包、持久登录 profile 或不受限的网络与文件设置。

## Decision

`examples/mcp-browser/playwright.cordis.yml` 是官方 `@playwright/mcp` 服务器的一份默认关闭 overlay，固定使用版本 `0.0.79`。运行时命令是预先安装的 `playwright-mcp` 可执行文件；插件激活不会调用包管理器。该 overlay 通过通用 MCP 客户端使用稳定的 `playwright` 命名空间，可以由 `--patch` 选择，也可以等价地写入受管 MCP catalog。

参考配置默认采用无头执行和内存浏览器 profile，阻止 Service Worker，省略内联图片响应，保留 Playwright 的常规工作区文件限制，并将直接 HTTP 请求限制在 loopback 来源。它不会关闭浏览器 sandbox、授予设备权限、加载已保存的认证状态或启用不受限文件访问。文档将页面内容标记为不可信输入，说明 Playwright 的来源过滤器不覆盖重定向且不构成安全边界，并区分 MCP 工具准入与受信任 stdio 服务器及浏览器进程的隔离。

验证依据页面状态、无障碍快照、控制台输出、网络响应和已保存的截图，而不是模型断言。Playwright 会将自动命名的产物写入工作目录下的 `.playwright-mcp`，显式指定的相对文件名则从工作目录解析。内联图片响应保持省略，使用户直接检查已保存的视觉证据。

## Verification

示例测试会解析提交的 overlay，固定包版本、可执行文件、命名空间和完整安全参数列表，拒绝首次运行时执行包管理器及不安全 flag，然后仅将上游进程替换为包自有的 MCP fixture（测试前置数据）。真实 Cordis Loader 启动必须通过通用桥接器发现 `mcp__playwright__greet`。顶层 Cordis 配置门禁会纳入每个 `examples/mcp-*/*.cordis.yml` 应用 overlay，并证明其包能够从 CLI 安装中解析。

## Alternatives considered

**直接向 `agent-loop` 添加浏览器行为。** 否决，因为浏览器自动化是一项可选外部能力，已经由完整 MCP seam 表达；循环专用行为会重复实现 Playwright，并违反插件归属原则。

**在启动期间通过 `npx` 启动浮动版本的包。** 否决，因为 profile 激活会执行未审查的网络下载，而且行为可能在没有仓库 diff 的情况下改变。

**默认允许远程来源或使用持久浏览器 profile。** 否决，因为本地 UI 验证不需要这两项。用户可以复制 overlay，并明确接受扩大网络范围、凭据和状态所带来的后果。

## Consequences

浏览器验证现在易于发现、可以复现、无需时可从模型工具目录中移除，而且无需再增加一套核心能力 seam。它仍依赖单独安装的第三方可执行文件和浏览器；启用期间会向每次请求添加服务器工具 schema、创建工作区产物，并在 agent sandbox 外运行受信任的浏览器进程。现有的[第三方记忆 MCP 示例](2026-07-31-third-party-memory-mcp-examples.md)、[API 浏览器信任](../architecture/2026-07-28-api-browser-trust-boundary.md)和浏览器 GIF 证据决策仍然相互独立，均未被取代：它们分别规定记忆提供方、Web API 入站信任和 PR 证据。
