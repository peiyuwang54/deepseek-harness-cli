# Agent Note: headless 是直接使用核心服务的入口

Status: implemented

[English](2026-08-09-headless-direct-core-entry-point.md) | 中文

## 问题

`headless` 的产品约定是一个本地任务：输出文本或 JSONL，退出状态反映成功与否，文本运行成功时 stderr 为空，并且不打开监听端口。包含 Workspace Host 服务、ApiProxy、HTTP、Web 运行时或浏览器插件的组合违背这一约定，也使本地完成状态依赖无关的传输树。

直接入口仍需要与 Web 所创建 Agent 相同的部署模型状态。独立的提供方／模型默认值会让同一部署产生两种答案，而在 Agent 与会话持久化完全停稳之前推导完成状态，会让 stdout 与退出状态观察到不完整状态。

## 决策

随附的 `headless` profile 包含 `dsh-base` 与 `dsh-headless`。headless 组合包提供自身的 persona 与工具模式、禁用 HMR（热模块替换）、显式挂载 Code Mode worker，并插入 `headless-runner`。其插件树不包含任何 `@deepseek-ai/dsh-host-*` 包、ApiProxy、HTTP server、Web 运行时或浏览器客户端。Code Mode 与会话持久化均为独立于 Web 呈现的一次性 Agent 能力。

`headless-runner` 是直接使用核心服务的入口。Loader 完全加载后，它读取 `ctx.agentDefaultModel.currentSelection()`，通过 `ctx.agents` 创建或恢复一个 Agent，在 Agent 作用域中安装该 `ModelSelection` 与选定的 Agent preset，等待启动工作完全停稳，锚定 Session 事件序号，提交一条普通用户消息及已接收的图片，再次等待完全停稳。随后，它等待 `ctx.sessions.flush`，再推导最终结果与 `turn/end` 结束原因；仅当原因为 `completed` 且所要求的结构化捕获存在时，才请求启动器以退出状态 0 有界关闭。文本模式把最终结果连同一个换行写入 stdout；JSON 模式把实时 Session 事件投影为 `thread.*`、`turn.*` 与 `item.*` JSONL。结束原因为 `error` 时，其持久化错误码与消息在文本模式写入 stderr；意外失败使用所选输出格式并以 1 退出。

[`deepseek exec` 自动化决策](../feature/2026-08-18-noninteractive-exec-automation.md)负责恢复选择、临时会话、图片、结构化输出、JSONL 字段、结果文件与命令行权限快捷参数。

`@deepseek-ai/dsh-agent-default-model` 拥有与传输无关的默认值，供没有会话级选择的 Agent 使用。`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel` 并注册 `agent-default-model` Settings 分节。组合配置提供 `{provider, model}`，用户设置还可以提供 `reasoningEffort`。`currentSelection()` 返回当前的完整选择，`saveSelection()` 则写入完整分节，因此不含强度的选择会清除已存强度。`dsh-base` 提供组合条目。直接入口与 ApiProxy 入口均消费该服务；只有 ApiProxy 负责会话级优先级、模型校验与已接受 Web 选择的持久化。

`loadProfile` 识别安装过程拥有的精确 headless 元组（`dsh-base`、`dsh-web-app`、`dsh-headless`），将其规范化为随附的 headless 模板，并保留 manifest（元数据清单）的其他所有字段。带额外项、缺少项或顺序不同的组合包列表归用户所有，保持不变。

本 Agent Note 负责 headless 的传输与完成约定。[应用持有自己的命令行](2026-08-06-app-owned-command-line.md)负责当前的 `dsh --profile headless` 语法；原 [`dsh run` 决策](../../archived/feature/2026-08-08-dsh-run-headless-command.md)记录已被取代的启动器持有语法，[GUI 分层与 RPC 协议](2026-07-19-gui-layering-and-rpc-protocol.md)负责浏览器网关边界，[Web 配置树启动与传输分层](2026-07-24-web-config-tree-boot-and-transport-layering.md)负责 Web 插件树，[默认模型跟随选择器](../feature/2026-08-07-default-model-follows-the-picker.md)负责共享 Agent 默认值的持久化。

## 验证

包测试围绕脚本化 Agent 工厂使用真实的 Session 存储、工具注册表与 Agent 注册表，固定空闲态到空闲态聚合、JSONL 投影、Token 用量、图片顺序、结构化捕获、恢复选择、临时元数据、权限快捷参数、结果文件、终止态诊断、Loader 加载期间的 dispose（资源释放）与退出前 flush 顺序。组装后的无密钥快照通过回放的工具往返驱动 headless profile，记录一条带 `source.kind: 'user'` 的 `user/message`，并在 stderr 暴露终止态模型失败。构建后二进制验收通过已发布入口访问 mock 提供方，并要求最终文本出现在 stdout、退出状态为 0 且 stderr 为空。配置转储验收排除随附 headless 树中的所有 Host、Web 与 Client 包；PTY 关闭覆盖要求不出现观察行，并在有界时间内完成 dispose。

## 考虑过的替代方案

| 替代方案 | 约定不匹配之处 |
|---|---|
| 保留 `dsh-web-app`，但隐藏观察行 | 进程仍会打开端口并携带 Host、Web 与浏览器插件树。 |
| 围绕 ApiProxy 构建纯 Host 一次性组合包 | ApiProxy 是客户端协议网关，而本地一次性入口没有客户端边界。 |
| 使用 `InProcessApiClient` 实现产品级协议覆盖 | 产品执行会仅为测试无关协议而依赖该协议。 |
| 为 headless 单独提供提供方／模型配置 | 直接创建与 Web 创建会拥有彼此独立的默认值和持久化。 |
| 省略 Code Mode 与会话持久化 | 两项能力都属于一次性 Agent 执行，而不是 Web 呈现。 |
| 规范化所有包含 Web 与 headless 组合包的元组 | 组合包列表是扩展面；只有精确的安装过程所属元组可以安全分类。 |

## 后果

`deepseek exec` 与 `dsh --profile headless` 提供本地 Agent 任务，而不是浏览器观察、Host API 或 HTTP。需要这些能力的用户选择 `dsh web`。文本模式成功时 stderr 为空，完成结果在持久化 flush 后推导，非临时 Session 可供后续调用使用。初始用户消息记录 `source.kind: 'user'`，因此不携带 ApiProxy `rpcId`。

ApiProxy 载体覆盖保留在 ApiProxy 包中。自定义一次性 profile 可以显式包含 Host 或 Web 组合包；随附 profile 与可识别的安装过程所属元组均不含 Web。
