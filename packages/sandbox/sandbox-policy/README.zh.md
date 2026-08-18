# dsh-sandbox-policy：沙箱策略归属位置（`ctx.sandboxPolicy`）

[English](README.md) | 中文

沙箱策略解析的唯一归属位置：部署默认 [`SandboxMode`](../sandbox/README.md) 与回退根目录，加上每个会话的持久模式覆盖、不可变主工作区根目录和额外可写根目录。每项负责强制执行的能力在每次调用时都会收到一项解析完成的模式与根目录集合策略；模型在每次请求前会收到当前策略，而不会另收一份能力清单。

## 为何需要共享归属位置

文件系统工具、一次性 bash 命令和终端会话可以用不同组合强制执行同一套模式词汇。如果各自解析模式与根目录，就可能漂移成分裂世界，正是[沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)所警告的情况。每个强制执行后端都会消费归属方解析出的完整策略，而当前上下文只说明该策略对于任何受 DSH 文件沙箱强制执行的可用操作有何含义。[跨家族 fs 沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)记录了共享策略决策。

## 配置

- `mode`：部署默认 `SandboxMode`（`read-only`／`workspace-write`／`danger-full-access`），加载时验证。默认为 `read-only`（故障安全）。
- `workspaceRoot`：无 agent（智能体）的调用或没有 cwd 的会话在 `workspace-write` 下可写入的回退目录。默认为 `process.cwd()`；无论显式配置还是采用默认值，都会解析为其绝对文件系统标识。普通 agent 调用改用其会话头中不可变的 `cwd`。

## 接口

- `ctx.sandboxPolicy.resolve({ session?, mode? })`：解析一项完整的逐调用策略。显式批准的模式优先于会话最后一条 `sandbox/mode` 事件，后者又优先于 `defaultMode`；会话不可变的 `cwd` 成为主 `workspaceRoot`，最新的 `sandbox/writable-roots` 快照提供 `additionalWritableRoots`。
- `ctx.sandboxPolicy.addWritableRoots(session, paths)`：以会话 cwd 为基准解析相对路径，要求每条路径都指向已存在目录，规范化并去重完整集合，然后只在全部输入验证通过后追加一条持久快照。
- `ctx.sandboxPolicy.defaultMode`／`ctx.sandboxPolicy.workspaceRoot`：`resolve()` 使用的部署默认值与回退根目录。
- `sandbox:policy`：直接派生自 `resolve({ session })` 的请求时缓存安全上下文贡献。它说明该模式中与具体能力无关的文件操作约定，以及 `workspace-write` 下规范化的可写根目录集合；工具归属方仍负责特定于操作的拒绝与升权引导。
- `effectiveSandboxMode(events)`：会话 `sandbox/mode` 事件的纯 fold（最后一次切换胜出，没有则为 `undefined`），在 `resolve()` 内使用。
- `setSandboxMode(session, mode)`：逐会话覆盖的唯一写入路径：恰好追加一条 `sandbox/mode` 事件。切换本身就是事件；不会在带外修改模式。
- `effectiveAdditionalWritableRoots(events)`／`setAdditionalWritableRoots(session, roots)`：折叠并写入完整的额外根目录快照。
- `SANDBOX_MODES`：所有模式，用于选项展示与运行时验证。

可选的 `./invariant` 配套组件会拒绝未知的持久模式、非绝对根目录或重复的额外根目录；Session 与其配套组件负责相关存储与核心执行封闭规则。agent loop（智能体循环）会将组装后的完整运行时上下文快照记录为一条带来源的 `user/message`，因此无需内存中的「上次告知」镜像，也能重建确切的策略输入。

## 逐会话存储

运行时切换是在对应会话日志中追加的一条 `sandbox/mode` 事件。`effective = explicit grant ?? fold(events) ?? deployment default`，因此覆盖会通过回放跨重启保留，两个会话也绝不会看到彼此状态。不可变的 `SessionHeader.cwd` 是主根目录；每条 `sandbox/writable-roots` 事件替换额外根目录快照。两类事件都只进入日志；在下一次请求前，归属方会将解析后的当前策略贡献给完整运行时上下文快照。

## 模型体验

### 当前文件沙箱策略

#### 模型看到的内容

每个 agent 会话的当前运行时上下文快照中都有一项 `sandbox:policy` 贡献。它不枚举已装载的能力。工具插件继续负责操作与升权引导，批准策略单独贡献给同一份快照，计划引导仍由 `dsh-plan-mode` 的系统段落管理。

##### 只读

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### 工作区写入

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under these writable roots: ["<primary workspace root>","<additional root>"]. Some platform temporary areas may also be writable.
```

##### 完全访问

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

#### Token 影响

首次请求和有效策略每次变化时增加一条简洁的持久上下文消息；未变化的请求不增加内容。`workspace-write` 携带规范化后的声明根目录集合；平台特定的临时路径会以摘要表述，不会加入依赖主机的字节。

#### KV Cache 影响

模式切换时，稳定的系统提示词仍逐字节相同。变化后的完整上下文快照会追加到保留的历史之后，从而保留此前已缓存的前缀；后续未变化的请求会复用该保留快照。

## 已知限制与暂缓事项

- **每个会话只有一个主工作区根目录**：`SessionHeader.cwd` 仍是工作目录，也是相对 `--add-dir` 路径的解析基准；额外根目录只扩大写入范围，不改变进程 cwd。
- **仅限文件操作模式**：`SandboxMode` 管控文件操作；网络和进程策略不在其词汇中，因此这里没有限制它们的旋钮。
- **有意概述临时区域**：强制执行后端会授予不同的平台临时区域，这些区域在策略解析后才会选定，因此无法在当前上下文中如实枚举。
