# Agent Note：持久额外可写根目录

Status: implemented

[English](2026-08-18-additional-writable-roots.md) | 中文

## Problem

Agent 会话原本只有来自 `SessionHeader.cwd` 的一个不可变工作区根目录。跨同级仓库或共享目录工作时，即使用户只想额外开放一条路径，也必须使用 `danger-full-access`。仅存在于启动参数中的白名单无法随恢复保留，而 CLI 接受路径但某个沙箱后端忽略它，则会夸大权限边界。

## Decision

交互式与 Headless 入口都接受可重复的 `--add-dir <dir>`。相对路径以会话 cwd 为基准解析。`SandboxPolicyService.addWritableRoots()` 要求每项输入都指向已存在目录，解析文件系统身份，移除主根目录与重复项，并且只在所有输入验证通过后追加一条完整的 `sandbox/writable-roots` 快照。恢复时折叠最后一条快照，也可以继续添加根目录。主根目录仍是进程 cwd；额外根目录只扩大 `workspace-write`。`read-only` 不授予其中任何目录，`danger-full-access` 仍绕过限制。

`SandboxExecutionPolicy` 携带必填的 `additionalWritableRoots` 数组。进程内文件系统围栏、Bubblewrap、Landlock、Seatbelt 与 Windows ACL runner 都消费同一份解析后的根目录集合。策略上下文以 JSON 列出已声明根目录，因此模型可见权限仍可从会话日志重建。新增事件只增加一种成员，不改变会话信封，因此不提升 `SESSION_FORMAT_VERSION`。

Windows 从排序、去重后的规范根目录集合派生常驻写入 SID。一个 SID 会授予该精确集合中的每个根目录，而私有临时 SID 仍限定在活跃的会话/根目录集合对。集合变化会产生不同 SID，不会在已有身份下静默累积权限。Runner 接受重复的 `--workspace` 参数，并以完整且与顺序无关的集合验证由 seam 管理的 SID。

命令界面沿用 Codex CLI 可重复的 [`--add-dir`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs)；持久化与强制执行使用 DeepSeek Harness 自身的会话日志和沙箱 seam，没有复制 Codex 源代码。

此决策部分取代[共享沙箱策略](2026-07-14-cross-family-fs-sandbox.md)与 [Windows ACL 沙箱](2026-08-08-windows-acl-restricted-token-sandbox.md)说明中的单根目录假设。它们记录的能力归属、升权、后端限制与 ACL 机制仍然有效。

## Alternatives considered

**把每个额外目录当作单次调用升权。** 否决，因为多项目任务需要跨工具与回合保持稳定权限，而批准升权有意只应用于一次重试。

**把额外根目录存入用户设置。** 否决，因为目录权限属于会话，必须和模型可见策略一起回放，不应被无关会话继承。

**让后端直接读取 CLI 参数。** 否决，因为进程内文件系统工具与子进程沙箱会解析出不同策略，嵌入调用方也无法通过类型化路径获得同一行为。

## Consequences

用户可以运行 `deepseek --add-dir ../shared` 或 `deepseek exec --add-dir ../shared "task"`，重复该选项，并在恢复时保留相同根目录集合。无效批次失败时不会部分修改会话。针对性测试覆盖参数解析、验证、回放、策略上下文、文件系统包含关系、所有 POSIX profile、Windows SID 派生与 runner 参数、组合包启动顺序，以及当前可用的真实沙箱后端。无密钥快照固定已变化的 `workspace-write` 上下文。
