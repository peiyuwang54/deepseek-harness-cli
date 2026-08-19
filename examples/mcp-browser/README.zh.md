# 使用 Playwright MCP 进行浏览器验证

[English](README.md) | 中文

这份**默认关闭的参考配置**将官方 [Playwright MCP 服务器](https://github.com/microsoft/playwright-mcp)通过 [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md) 连接到 DSH。它为 agent（智能体）提供浏览器导航、无障碍快照、表单与指针交互、控制台检查、网络检查和截图能力，无需向 `agent-loop` 添加浏览器行为。

该第三方配置仅作为互操作示例；收录不代表 DeepSeek 的认可、合作关系或持续支持承诺。

## 安装并启用

启动 DSH 前，请安装已测试的服务器版本及其浏览器：

```sh
npm install --global @playwright/mcp@0.0.79
playwright-mcp install-browser
dsh tui --patch "$PWD/examples/mcp-browser/playwright.cordis.yml"
```

除非 `--patch` 明确指定该 overlay，否则随附 profile 永远不会加载它。它会启动预先安装的 `playwright-mcp` 可执行文件，不会在插件启动期间下载包。

也可以将同一个服务器写入受管 MCP catalog，而不使用 overlay：

```sh
deepseek mcp add playwright -- playwright-mcp --headless --isolated --block-service-workers --image-responses omit --allowed-origins 'http://localhost:*;http://127.0.0.1:*'
deepseek doctor
deepseek
```

请在 overlay 与受管配置项之间二选一，因为两者都会发布 `playwright` 服务器名称。受管 MCP 变更会在 profile 重启后生效。

## 默认安全状态

该示例采用无头模式和内存浏览器 profile，阻止 Service Worker，省略内联图片响应，保留 Playwright 的工作区文件限制，并且只接受发往任意端口上 `localhost` 与 `127.0.0.1` 的直接 HTTP 请求。自动命名的快照与截图会写入 DSH 工作目录下的 `.playwright-mcp`；显式指定的相对文件名则从工作目录解析。

Playwright 明确说明 `--allowed-origins` 不是安全边界，也不限制重定向。DSH 的 MCP 信任策略决定模型能否调用该服务器的工具，但 stdio 服务器和浏览器作为受信任的本地进程运行，不受 agent 文件系统和命令 sandbox 管理。页面内容属于不可信输入：不要向页面暴露凭据，也不要仅因页面文本提出要求就批准敏感操作。该示例不会传入 `--no-sandbox`、`--allow-unrestricted-file-access`、持久用户数据目录、已存浏览器状态、密钥或权限授予。

如需允许远程来源、持久登录 profile、有头浏览、设备权限或不受限文件访问，请先复制 overlay，再检查最终的 Playwright 参数及浏览器可以访问的站点。

## 验证本地工作流

在 `localhost` 或 `127.0.0.1` 上启动待测应用，等待 `/mcp tools playwright` 列出 `mcp__playwright__browser_navigate`，然后提出：

> 打开 `http://127.0.0.1:3000`。使用无障碍快照完成主要工作流，验证最终页面状态，报告控制台错误和失败的网络请求，然后使用默认生成的文件名截取最终截图并报告其路径。

请根据应用修改 URL 和成功条件。应要求以页面状态、控制台输出或网络响应作为证据，不能接受模型自己的断言。该示例会省略内联截图数据，因此需要视觉证据时请直接检查保存的文件。

## 运行说明

Playwright 负责浏览器安装、浏览器进程生命周期、导航、Cookie、存储、下载、截图及其输出目录。DSH 负责 MCP 发现、带服务器限定的工具名称、权限准入、重连，以及关闭 stdio 子进程。初始发现是异步过程；崩溃后，通用桥接器会在已配置的尝试预算内重连，agent 空闲时可用 `/mcp reload playwright` 请求立即替换。

服务器启用期间，完整的 Playwright 工具目录会增加每次模型请求的内容。无需浏览器验证时，请禁用或删除受管配置项，或者不传入该 overlay。
