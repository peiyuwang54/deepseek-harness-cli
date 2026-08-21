# `dsh` CLI（命令行界面）行为参考

[English](README.md) | 中文

本参考定义 profile 启动、随附别名、MCP 管理、插件管理和配置 dump 等命令模式。argv 由 [`src/args.ts`](../src/args.ts) 统一解析一次，[`src/bin.ts`](../src/bin.ts) 只会动态导入选中的运行器。

## Profile 启动

`dsh --profile <name>` 启动位于 `$DSH_HOME/profiles/<name>` 的 profile。生效配置树以空根节点为起点，依次叠加 profile manifest（元数据清单）的 `dsh.profile.bundles` 列表中指定的各组合包 patch、从 `$DSH_HOME/mcp.json` 投影到随附 `web`、`tui` 和 `headless` profile 的 MCP 服务器行、profile 自身的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml`（这是各 profile 共享的机器本地偏好，因此优先于逐 profile 配置层），以及按 argv 顺序指定的各个 `--patch <path>` 覆盖层。对同一配置行，后应用的层优先。patch 会替换目标行的整个 `config` 值，而不是深度合并其中的键；patch 也可以插入新行。配置解析、schema 校验、模块解析或插件启动失败时，系统会报告错误并以非零状态退出。收到 SIGINT 或 SIGTERM 时，挂载的根节点会先 dispose（资源释放）再退出。

组合包名称先从 dsh 安装目录解析，再从 profile 目录解析。因此，内置组合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-tui-app`、`@deepseek-ai/dsh-headless`）始终来自当前运行的 `dsh` 所属的安装；树外组合包则来自 profile 中由 pnpm 管理的 `node_modules`。patch 行中的裸插件 `name` 会从 profile 目录开始，按照 Node 的模块解析规则逐级向父目录查找，直至由 dsh 维护的安装后备目录 `$DSH_HOME/profiles/node_modules`。该目录为 dsh 安装中的应用和组合包所依赖的每个包各维护一个符号链接，并在每次启动时修复这些链接。

`web`、`tui` 和 `headless` profile 首次使用时会从随附模板自动初始化（`web`：base + web-app；`tui`：base + tui-app；`headless`：base + headless）。其他缺失的 profile 会显式报错，并提示运行 `dsh plugin --profile <name> add <package>`。

### 应用参数

启动器自身的 flag 必须写在最前面，并在遇到第一个无法识别的 token 时结束；从该 token 开始的所有内容都会通过 `ctx.cmdlineArgs` 原样交给已启动的 profile，注入该 profile 的任意应用插件都可以解析这些内容（[`dsh-cmdline`](../../../packages/boot/cmdline/README.md)）。没有显式 profile 时，启动器会选择 `tui`，因此裸 `deepseek` 会打开终端，`deepseek --full-auto` 会抵达其启动提供方。`dsh --profile web --port 8080` 会将 `--port` 交给 web 应用，而裸 `dsh --help` 仍打印启动器自身的帮助。`-V`/`--version` 位于应用参数边界之前时，会打印启动器的版本。

每套组合只会挂载一次。普通插件注入 `cmdlineArgs`，解析所属应用的参数，并将解析结果作为服务提供。每个从 flag 取值的配置行都会注入该服务；Loader 会等到服务激活后，再对该行的配置求值（`port: !!js ctx.webStartup.port ?? 3080`），因此 flag 的优先级高于配置行中写明的值。要维持这一优先级，配置行必须保留该表达式；如果用户 patch 用字面量替换整个 `config`，也会随之移除运行时读取。帮助参数和被拒绝的参数都会请求退出：参数被拒绝时以非零状态退出，显示帮助时以 0 退出；依赖该提供方服务的配置行不会激活。在线编辑 `cordis.patch.yml` 时，系统会根据仍在运行的服务重新计算表达式，因此不会重置当前正在使用的端口。

启动器的 flag 必须写在应用参数之前，且启动器的解析器会消耗掉一个 `--`：必须以字面量 `--` 送达应用的参数需要写成 `-- --`。如果应用的第一个参数恰好等于 `web`、`tui`、`mcp` 或 `plugin`，会选择对应的子命令。`ctx.cmdlineArgs.get()` 是共享的不可变读取：多个插件可以解析同一份快照，没有读取方的 profile 则会忽略自己的应用参数。

随附的应用接受以下命令行参数：

| Profile | 参数 |
|---|---|
| `web` | `--host`、`--port`、可重复的 `--trusted-host`、`--no-open` |
| `tui` | `--resume <session>`、可重复的 `--add-dir`、`--sandbox`、`--ask-for-approval` 和权限快捷参数 |
| `headless` | 任务文本；`--json`、`--ephemeral`、可重复的 `--image`／`--add-dir`、输出控制、精确权限控制、快捷参数与 `resume` |

`deepseek exec "run the tests"` 别名会创建一个持久化 Agent（智能体）并打印最终结果；`dsh --profile headless` 保留为 profile 层写法。`--json` 发出 JSONL 生命周期事件；可重复的 `--image` 接收本地 PNG、JPEG、WebP 或 GIF 输入；`--output-schema` 要求符合 Schema 的结构化输出；`--output-last-message` 保存最终结果。`resume <id>` 继续指定 Session，`resume --last` 默认选择当前工作区中最新的 Session，添加 `--all` 后会考虑所有工作区。`--ephemeral` 只适用于新运行，权限控制和快捷参数与终端命令一致。Runner 会等待完全停稳并在输出前执行 flush，仅在得到已完成且有效的结果时以 0 退出；它不挂载 ApiProxy、Host、HTTP 服务器、Web 运行时或浏览器客户端，也不打开监听端口。输出与失败约定由 [headless 组合包 README](../../../packages/bundle/headless/README.md)负责。

可在不启动的情况下检查组合出的配置树：

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` 只打印组合包各层；`--dump-config` 额外加上受管 MCP 行、profile 的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml` 和 `--patch` overlay。两者都会打印注释，标明每行由哪个文件提供，以及哪些 overlay 修改过它；`!!js` 表达式保持未求值，受管 MCP 环境引用只显示已脱敏的来源名称，找不到目标的 patch 会报告到 stderr。dump 操作不会运行应用的命令行参数提供方，因此展示的是解析任何应用参数之前的组合配置树；如果调用中包含应用参数，dump 会拒绝该调用。

## MCP 服务器管理

`deepseek mcp` 管理 `$DSH_HOME/mcp.json` 中版本为 0 的用户 catalog，`dsh mcp` 提供相同命令。默认操作为 `list`；`get <name>` 在不解析密钥的前提下展示一个服务器；`enable <name>` 与 `disable <name>` 控制该条目是否投影到随附 profile；`add` 接受写在 `--` 之后的 stdio 命令或一个 `--url`；`remove <name>` 则删除该服务器。写入过程使用跨进程锁和原子替换，并在支持 POSIX 权限的平台上把文件模式设为 `0600`。

```sh
deepseek mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
deepseek mcp add github --env GITHUB_TOKEN -- npx -y @modelcontextprotocol/server-github
deepseek mcp add remote --url https://example.com/mcp --header Authorization=MCP_TOKEN
deepseek mcp list
deepseek mcp get remote
deepseek mcp remove filesystem
```

`--env KEY` 会转发同名的启动环境变量，`--env KEY=SOURCE` 则把另一个来源变量映射到服务器进程。HTTP 的 `--header NAME=SOURCE` 使用相同的引用模型。catalog 只保存来源名称，并在随附 profile 启动时解析；来源未设置时，系统会在服务器连接前停止启动。命令拒绝 URL 内嵌凭据，配置 dump 也只打印 `<environment:SOURCE>`，不会打印解析后的值。

受管服务器只会加载到三个随附应用 profile，add、remove、enable 或 disable 后需要重启。`deepseek mcp auth <name>` 会为 Streamable HTTP 条目启用 OAuth，启动 loopback 回调，并把注册／PKCE／发现结果／token 状态持久化到权限为 `0600` 的文件；`--code` 支持手动粘贴授权码，`--no-open` 只打印 URL 而不启动浏览器。自定义 profile 继续完全拥有自身组合，并可通过普通 patch 插入 `@deepseek-ai/dsh-mcp-client`。stdio 服务器命令会作为 agent（智能体）沙箱之外的受信任本地代码执行；启用前必须先安装并审查它。在 TUI 中，`/mcp`、`/mcp tools`、`/mcp desc` 与 `/mcp schema` 会合并实时连接状态与各服务器发布给当前作用域的工具；`/mcp auth <server>` 会指向无 profile 启动的 OAuth 流程；`/mcp resources [server] [uri]` 与 `/mcp prompts [server] [prompt]` 可检查 MCP Resources 和 Prompts。`/mcp reload [server]` 可在所有存活 Agent 都空闲时重连一个当前实例或全部实例，但不会重新读取受管 catalog。

## Doctor 与 Shell 补全

`deepseek doctor` 不会启动 profile，而是检查 Node 版本、平台、workspace、`$DSH_HOME`、凭据、受管 MCP catalog 与连接、随附运行时资产以及交互式终端能力。每个已启用的受管服务器都会接受有界的真实 initialize 与工具发现探测；禁用条目不会启动。服务器探测失败通常是警告，只有 catalog 条目设置 `failOnStartupError` 时才会阻断；无效配置始终会阻断。没有阻断性错误时返回 0；缺少 API Key 或输出不是交互终端等警告会显示出来，但不会阻止诊断。自动化脚本可以使用 `--json`，并通过 `--mcp-timeout-ms <ms>` 修改默认 5000 毫秒的单次请求探测超时。

```sh
deepseek doctor
deepseek doctor --json
deepseek doctor --mcp-timeout-ms 10000
```

`deepseek completion <shell>` 为 `bash`、`zsh`、`fish` 或 `powershell` 输出补全脚本。请按照对应 shell 的常规补全配置加载输出；脚本同时覆盖 `deepseek` 与 `dsh`。

```sh
deepseek completion zsh > ~/.zsh/completions/_deepseek
deepseek completion bash >> ~/.bash_completion
```

## 插件管理

`dsh plugin --profile <name> <args...>` 在 profile 缺失时先初始化它（有随附模板的用模板，其他名称只装 `@deepseek-ai/dsh-base`），然后以 profile 目录为工作目录，把依赖事务转发给 `pnpm`：`install` 是 `add` 的别名，`remove`、`why`、`update` 及其他所有 pnpm 子命令都照常可用；pnpm 必须在 PATH 上。相对路径 spec（`.`、`../plugin` 及其 `file:`/`link:` 形式）会先锚定到调用目录，因此在插件 checkout 中执行 `add .` 安装的是该 checkout，而不是 profile。每次成功运行后，系统都会根据当前安装状态更新 `dsh.profile.bundles`：如果某项依赖解析到的包在 manifest 中声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，该依赖就会加入配置层栈；如果某项依赖在 `update` 后获得该声明，也会随即激活。没有组合包声明的依赖仍作为普通依赖保留，并显示一次性警告；已移除的依赖则从配置层栈中删除。

`dsh plugin --profile <name> list` 不调用 pnpm，直接检查已安装的依赖。`dsh plugin --profile <name> verify` 会解析每个活动组合包、读取其 patch 文件，并检查组合包声明与活动层列表是否一致。两个命令都接受 `--json` 供自动化使用；profile 缺失或无效时返回非零状态。

`source <package>` 会打印已解析的包目录和声明的仓库。`enable <package>` 与 `disable <package>` 无需 pnpm 即可切换组合包层；新的列表会在下次启动 profile 时生效。

Codex 与 Claude Code subagent provider 是两个彼此独立的可选 Bundle。可以只添加一个包、在同一命令中添加两个包，或独立移除任一包：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
```

pnpm 操作成功后只会改变磁盘上的 Profile manifest 与 Bundle 列表；正在运行的 Profile 会保留本次启动时的 Bundle 集合。添加、移除或更新 Bundle 后须重启该 Profile。这个启动边界只适用于 Bundle 成员变化，Profile 或 home 中普通 `cordis.patch.yml` 的编辑通过热重载生效。下一次启动时，每个已安装 Bundle 只注册自己的休眠 Host provider；还须在复制出的 Preset 中单独启用对应工具行，新 Agent 才能看到该工具。[Codex provider README](../../../packages/subagent/subagent-codex/README.md)与 [Claude Code provider README](../../../packages/subagent/subagent-claude-code/README.md)负责可执行文件、身份验证、载荷与失败细节；[base Bundle 参考](../../../packages/bundle/base/README.md)负责默认依赖闭包。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui list
dsh plugin --profile tui verify --json
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

随源码发布的 Git 托管插件会在安装期间通过 `prepare` 脚本构建，而 pnpm ≥10 默认会阻止该脚本，直到使用方明确允许。首次运行 `add` 会失败，并显示 pnpm 的 `allowBuilds` 提示；dsh 还会提示应修改该 profile 的 `pnpm-workspace.yaml`。将输出的键复制到该文件后，重新运行命令即可。安装已经构建好的 tarball 或本地 checkout 时，无需加入 `allowBuilds`。

## 终端入口

裸 `deepseek` 会选择随附的 `tui` profile，`dsh tui` 保留为兼容写法。Startup 提供方持有 `--resume <session>`、可重复的 `--add-dir`、`--sandbox`、`--ask-for-approval`、权限快捷参数与应用帮助。`--sandbox` 接受 `read-only`、`workspace-write` 或 `danger-full-access`，`--ask-for-approval` 接受 `ask` 或 `never`。`--full-auto` 会关闭审批提示但保留工作区限制，两种无限制写法会同时关闭限制与审批提示。精确控制不能与快捷参数组合。帮助信息不要求 TTY；成功运行则要求 stdin 与 stdout 均为交互式终端，任一侧为管道时都会在终端 runner 激活前失败。Loader 结算后，runner 通过 `ctx.agents` 创建新的持久化根 Agent 或恢复指定身份，在未发布的 setup 阶段写入请求的权限控制并安装默认模型选择，再把进程 TUI 挂载到该根 Agent。此 profile 不挂载 Host、HTTP server、Web runtime 或浏览器 client。

```sh
deepseek
deepseek --resume <session>
deepseek --sandbox read-only --ask-for-approval ask
deepseek --full-auto
deepseek --yolo
deepseek --dangerously-bypass-approvals-and-sandbox
dsh tui --patch ./extra.cordis.yml
dsh tui --dump-default-config
dsh tui --help
```

## Web 别名

`dsh web` 是 `--profile web` 的硬编码别名；写在它之后的 flag 属于 web 应用，由组合包中的普通提供方解析。`--host` 和 `--port` 覆盖承载它们的那些行的组合取值，可重复的 `--trusted-host` 通过 `ctx.webRuntime.trustedHosts` 提供本次调用的 authority（部署表达式会拼接自己的 authority），`--no-open` 则只对本次调用关闭默认浏览器交接。客户端插件 HMR（热模块替换）接收器始终挂载，在单独运行的 `pnpm run dev:web` watcher 重建客户端 bundle 之前保持空闲。

```sh
dsh web
dsh web --no-open
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
dsh web --help
```

生产 Web 运行器需要已构建的包和前端产物（`pnpm run build`）。默认服务地址是 `http://127.0.0.1:3080`；本机启动时，只在完整 Loader 配置树结算后才用默认浏览器打开该规范宿主机 URL。继承的 `SSH_CONNECTION` 或 `SSH_TTY` 非空时会跳过浏览器交接，因为本地转发地址由 SSH 客户端或编辑器持有；宿主机 URL 仍会打印。CLI 目前有意不支持 `--host 0.0.0.0`，并会以用法错误退出。本机交接前会打印英文提示 `dsh web: opening the default browser; pass --no-open to disable`；若操作系统交接失败，stderr 诊断会说明原因、给出 URL 供手动访问，服务器仍继续运行。`--trusted-host` 可添加 `/api` 浏览器信任围栏接受的具名 authority。

进程关闭时，插件树最多有 5 秒完成 dispose。首次收到 `SIGINT` 或 `SIGTERM` 时会开始优雅排空：`SIGTERM` 是监督进程发出的常规停止请求，在所有运行模式下都以 0 退出；`SIGINT` 则报告 130。第二次收到信号时会立即强制退出。如果一次性运行在正常结束时已经卡在 dispose 阶段，第一次按下 `Ctrl+C` 就会直接升级为强制退出，而不会被忽略。

所有模式都将运行命令时所在的目录作为默认 workspace 根目录，以 65,536 字节渲染预算加载适用的 `AGENTS.md` 或 `CLAUDE.md` 指令，并使用内存 SQLite 会话内容索引。每次启动 profile 时，系统都会监视 profile 与 home 两个 `cordis.patch.yml` 配置层的有效变更，并以事务方式重新应用；一次性运行模式通过有界关闭流程退出，该流程会先 dispose 监视器。

新会话默认使用 `workspace-write` 权限预设。Bash 和文件系统修改仅限于会话 workspace 与平台临时根目录；读取、网络访问和进程可见性不受限制。`--sandbox` 与 `--ask-for-approval` 写入独立的持久调节项；如果二者的组合没有匹配的具名 preset，`/permissions` 会报告 `custom`。`deepseek --full-auto` 会固定 `workspace-write` + `never`；`deepseek --yolo` 及其长别名会在发布前固定配置的 full-access／no-approval preset。会话内不会注册启动快捷命令，运行中请用 `/permissions` 切换。`DSH_PERMISSION_MODE` 更改进程后备值。General settings 中存储的权限影响后续 Web 会话，不改变已打开的会话。

`DSH_TOOLS_MODE` 为进程选择 `native`、`code` 或 `both`；其他值会导致启动失败。随附的 `minimal` agent preset 会保留该部署的呈现方式，将完整系统提示词固定为 `You are a helpful software engineer assistant.`，并且仅组合持久 `bash` 和 `str_replace_editor`。创建 Web 会话时请选择极简模式；该 agent 不包含任何其他提示词段落或面向模型的插件，而共享的浏览器、workspace、持久化、沙箱与权限宿主保持不变。

## 共享部署行为

基础组合包挂载原生 DeepSeek 适配器、休眠的 pi-ai 多提供方适配器、settings 与凭据提供方、稳定的 `web_search` 和已禁用的会话遥测。提供方凭据依次从继承环境、`$DSH_HOME/.credentials.yaml`、调用目录的 `.env` 和 `$DSH_HOME/.env` 解析；受管文档从不物化进 `process.env`，而两个 `.env` 文件都是普通启动环境层。搜索使用 `DEEPSEEK_API_KEY` 并接受 `DEEPSEEK_SEARCH_BASE_URL`；只有 patch 层插入提供方并启用 `web_fetch` 后，该工具才可用。`llm-pi-ai:` settings 分节若写明 `openrouter` 且 `apiKeyEnv: OPENROUTER_API_KEY`，就会把该 catalog 路由注册为可用。

会话遥测默认留在本地。`DSH_TELEMETRY_MODE=FULL` 将每条已投影会话事件作为 OTLP/HTTP 日志流式发送，`DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 则仅在记录反馈时上传会话日志后缀。`DSH_TELEMETRY_OTLP_URL` 选择其他 collector。任何非空的 `DSH_TELEMETRY_DISABLED` 都是具有最终效力的遥测强制关闭开关。随附基础配置没有遥测脱敏规则，因此显式启用的导出可能包含消息文本、工具参数和结果，以及 workspace 路径；相关部署决策见[默认关闭 Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md)。

通过 `dsh plugin --profile <name> add <package-or-git-spec>` 安装外部插件组合包。安装的包拥有其依赖，并贡献其声明的 `cordis.patch.yml` 层。CLI 随附的 `@deepseek-ai/dsh-mcp-client` 同时供受管 catalog 和显式 patch 层使用；默认不启用任何服务器。

## 源码执行

请在仓库根目录中，于全新 checkout 之后及产物需要更新时单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>`。`package.json` 中的脚本不会构建，而是通过 `node --import tsx/esm` 启动 `apps/cli/src/bin.ts`，并转发所有参数。Typert Host 产物缺失时，profile 启动会因不含构建指引的模块解析错误而失败。这些 Host 产物存在后，如果前端或 Client plugin 组合包缺失，启动会失败并提示运行 `pnpm run build`。启动器不会检查产物是否为最新，因此已有的陈旧组合包可能继续运行旧版浏览器代码，直至重新构建。该进程会继承启动环境；当支持环境代理的 Node 版本必须遵循 `HTTP_PROXY` 和 `HTTPS_PROXY` 时，请设置 `NODE_USE_ENV_PROXY=1`。发布安装会直接启动平台可执行程序，无需重新构建仓库；在 Windows 上，[`apps/cli/install/install.ps1`](../install/install.ps1) 会下载 x64 Release 资产、校验其 SHA-256 伴随文件，并安装三个命令名。仅用于 checkout 的 [`scripts/install/install.ps1`](../../../scripts/install/install.ps1) 仍可从源码构建并测试目录包。见[根目录 Windows 安装一节](../../../README.md#install-windows)。
