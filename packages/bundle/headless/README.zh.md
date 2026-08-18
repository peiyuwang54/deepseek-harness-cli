# `@deepseek-ai/dsh-headless`

[English](README.md) | 中文

`deepseek exec` 及兼容写法 `dsh --profile headless` 使用的非交互执行组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接在 [`dsh-base`](../base/README.md) 之上组合 coding Agent（智能体）与 `headless-runner`，不挂载 Host、HTTP server、Web runtime 或浏览器插件。

## 命令

```sh
deepseek exec "run the tests"
deepseek exec --json "review this repository"
deepseek exec --image screenshot.png "fix this UI"
deepseek exec --output-schema result.schema.json "analyze"
deepseek exec --output-last-message result.txt "summarize"
deepseek exec --add-dir ../shared "update both projects"
deepseek exec resume <session-id> "continue"
deepseek exec resume --last "continue"
```

`--json` 使用 `thread.*`、`turn.*` 与 `item.*` 生命周期事件，每行写入一个 JSON 值。未指定时，stdout 只包含最终结果及一个换行。`--output-last-message` 还会把该结果写入指定文件，末尾不额外添加换行。

`--output-schema` 接受 [`dsh-tools` 所支持子集](../../core/tools/README.md)中的对象根 JSON Schema。Agent 会获得一个有作用域的 `structured_output` 工具；成功要求一次已提交且符合 Schema 的调用，捕获的对象成为最终结果。Schema 文件无效或回合结束时没有有效捕获都会以非零状态退出。

可重复使用 `--image`，按顺序附加 PNG、JPEG、WebP 或 GIF 文件。附件服务会在用户消息进入 Session 前验证并保存所有图片。

`resume <session-id>` 继续指定的持久化 Session。`resume --last` 选择在当前目录创建的最新 Session；添加 `--all` 后也会考虑其他工作区。可重复传入 `--add-dir`，以会话 cwd 为基准添加已存在的可写目录；完整根目录集合会持久化，因此恢复的会话会保留原有根目录，也可继续添加。`--ephemeral` 让新运行不持久化，不能与 resume 同用。`--full-auto`、`--yolo` 与 `--dangerously-bypass-approvals-and-sandbox` 使用和终端命令相同的权限预设。

## 执行

Loader 结算后，runner 解析共享的默认模型与 Agent preset，创建或恢复一个 Agent，提交一条用户消息，并等待其进入 idle。它在推导结果与退出状态前对 Session 执行 flush。最终回合完成时以 0 退出，其他结果均以 1 退出。文本模式把持久化模型错误和 runner 错误写入 stderr；JSON 模式则用 `error` 事件保持 JSONL 格式。进程不会打开监听端口。

## 模型体验

普通运行不添加模型可见内容；结构化模式只添加调用方所选 Schema 对应的工具及其完成指令。

#### KV Cache 影响

文本、图片与 resume 模式不会添加固定请求前缀。结构化模式会添加 Schema 专属工具和指令，因此其请求前缀与普通运行不同。

## 已知限制与暂缓事项

- 一个进程只提交一个任务。继续交互需要再次运行 `exec resume`，或使用交互式终端。
- JSONL 提供稳定的生命周期分类，但不公开原始提供方 chunk 或每一种产品专属 Session 事件。
- `ctx.appExit` 由启动器持有；若不通过 `dsh` 启动器嵌入该组合包，宿主必须提供此服务。
