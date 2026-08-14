# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

此私有仓库中的终端 CLI（命令行界面）目前通过源码分发。公开的 `@deepseek-ai/dsh` 包是 DeepSeek AI 独立发布的版本；如需使用本仓库中的代码，请按照下文的源码流程操作。

### 前置条件

- Git，以及有权访问此私有仓库的 GitHub 账号。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- pnpm。本仓库固定使用 `pnpm@11.7.0`；如果 `pnpm --version` 无法运行，请通过 Corepack 或 npm 安装。
- 提交模型任务前需要准备 DeepSeek API Key。查看帮助、转储配置以及不带提示词的启动过程不会调用模型。

安装固定 pnpm 版本的一种方式是：

```sh
npm install --global pnpm@11.7.0
```

### 从源码运行

克隆仓库、安装 workspace 依赖，然后构建各个包与 Web 前端：

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-web-to-cli.git
cd deepseek-harness-web-to-cli
pnpm install
pnpm run build
```

`pnpm-lock.yaml` 发生变化后，请重新运行 `pnpm install`。拉取到影响包或 Web 前端的源码变更后，请重新运行 `pnpm run build`。

### 配置 API Key

在启动 `dsh` 的 shell 中设置 Key。

macOS 或 Linux：

```sh
export DEEPSEEK_API_KEY="sk-your-key-here"
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
```

也可以把 Key 写入所选工作区根目录下的 `.env` 文件：

```dotenv
DEEPSEEK_API_KEY=sk-your-key-here
```

本仓库会忽略 `.env`，但绝不能提交真实凭据。启动器还支持 `$DSH_HOME`（默认为 `~/.dsh`）下的用户级凭据层，详见[凭据提供方参考](packages/credentials/credentials-local/README.md)。

### 验证安装

以下命令会验证本地启动器，但不会发送模型请求：

```sh
pnpm dsh --version
pnpm dsh --help
pnpm dsh exec --help
```

根帮助中应列出 `cli`、`exec`、`resume`、`web` 和 `plugin`。

### 启动交互式终端会话

可以在当前仓库中运行，也可以通过 `-C` 选择另一工作区，或直接在命令中提供第一条提示词：

```sh
pnpm dsh
pnpm dsh -C /path/to/project
pnpm dsh -C /path/to/project "Inspect this repository and explain how to run its tests"
```

首次调用会在 `$DSH_HOME/profiles/cli` 下初始化内置 `cli` profile。启动横幅会显示会话 ID、工作区、模型、沙箱和审批策略；提交任务前请核对工作区与权限。

- `/help` 列出可用的斜杠命令。
- `/exit`、`/quit`、Ctrl-D 或空闲时的 Ctrl-C 会关闭会话。
- 轮次运行期间按 Ctrl-C 会请求取消；再次中断会退出进程。

### 运行一个非交互任务

脚本、管道和 CI 使用 `exec`：

```sh
pnpm dsh exec "Summarize this repository"
pnpm dsh exec --sandbox workspace-write "Fix the failing tests and summarize the changes"
git diff --cached | pnpm dsh exec "Review this staged diff"
pnpm dsh exec --json "Summarize package.json" > run.jsonl
```

全新 `exec` 会话默认使用 `read-only`，审批策略为 `never`。只有任务需要修改所选工作区时，才添加 `--sandbox workspace-write`。在人类可读模式下，stdout 只包含 assistant 的最终答案，stderr 承载进度；`--json` 将 JSONL 事件写入 stdout。缺少提示词、轮次失败或操作被拒绝时，进程会返回非零退出码。

### 恢复终端会话

恢复当前工作区中符合条件的最新会话，或在恢复前选择工作区：

```sh
pnpm dsh resume --last
pnpm dsh -C ../another-project resume --last
```

启动横幅会显示会话 ID，可用于显式调用 `pnpm dsh resume <session-id>`。终端恢复只接受同一工作区中持久化的 root 会话；Web 与自定义 preset 会话使用不同组合，因此终端 profile 不会打开它们。

### 启动 Web UI

同一个源码工作区也可以启动浏览器应用：

```sh
pnpm dsh web
pnpm dsh web --port 8080
```

请打开命令打印的 URL。在启动服务器的终端中按 Ctrl-C 即可停止。接下来可按照 [Web UI 指南](docs/user/guide/index.md)配置模型并选择工作区。

### 权限默认值

| 调用方式 | 随附默认值 | 效果 |
|---|---|---|
| `pnpm dsh` | `workspace-write` + `ask` | 交互式 agent 可以修改所选工作区，并能在操作需要审批时发起询问。 |
| `pnpm dsh exec` | `read-only` + `never` | 除非 flag 显式修改策略，否则无人值守任务不能写入，也不会等待终端审批。 |
| `--sandbox workspace-write` | 显式覆盖 | 授予本次调用工作区写权限；使用前请确认所选目录。 |

使用 `pnpm dsh cli --help`、`pnpm dsh exec --help` 或 `pnpm dsh resume --help` 查看提供方、模型、推理强度、沙箱和审批选项。stdin、输出、恢复、权限与中断的精确行为由[终端 CLI 参考](packages/bundle/terminal-cli/README.md)定义。

### 更新源码工作区

拉取最新源码并重新构建：

```sh
git pull
pnpm install
pnpm run build
```

### 故障排查

| 现象 | 处理方法 |
|---|---|
| `pnpm: command not found` | 安装 `pnpm@11.7.0`，然后确认 `pnpm --version` 可以运行。 |
| Node 报告 engine 不匹配 | 使用 Node.js `^22.19.0` 或 `>=24.0.0`。 |
| 缺少模型凭据 | 导出 `DEEPSEEK_API_KEY`，或将其写入所选工作区的 `.env`。 |
| `interactive mode requires a TTY` | 在终端中运行 `pnpm dsh`，重定向输入或输出时改用 `pnpm dsh exec`。 |
| `a prompt is required` | 传入提示词文本、管道传入非空 stdin，或使用 `-` 显式读取 stdin。 |
| `exec` 任务无法编辑文件 | 确认目标工作区后添加 `--sandbox workspace-write`。 |
| 无法判断配置来源 | 运行 `pnpm dsh --dump-config`，在不启动应用的情况下检查组合后的 profile。 |

### 更多文档

- [`dsh` 命令与 profile](apps/cli/README.md)
- [终端交互、自动化、权限与限制](packages/bundle/terminal-cli/README.md)
- [Web UI 指南](docs/user/guide/index.md)
- [贡献者设置与开发工作流](docs/development.md)

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
