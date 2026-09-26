# dsh-atomic-write

[English](README.md) | 中文

零依赖的原子文件替换，供绝不允许在磁盘上留下不完整、被符号链接劫持或权限过宽内容的文件型存储共用：用户设置文档（`dsh-settings-file`）与凭据存储（`dsh-credentials-local`）。

## 接口面

```ts
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

declare const text: string
declare const render: (previous: string) => string

await writeFileAtomic('/home/u/.dsh/settings.yaml', text, { mode: 0o600 })

// Read-modify-write against the same file from several processes.
await withFileLock('/home/u/.dsh/settings.yaml', async () => {
  await writeFileAtomic('/home/u/.dsh/settings.yaml', render(text), { mode: 0o600 })
})
```

`writeFileAtomic` 提交一份已经渲染好的字符串。约定按故障利用它的先后顺序列出：

- **独占创建临时文件**（`wx` + 随机后缀）：open 拒绝跟随预先埋在可猜测临时路径上的符号链接。
- **全新 inode 携带 `mode` 走完 rename**：替换权限过宽的旧文件时直接收窄，不存在 chmod 竞态。`mode` 为必填，让权限决策始终可见于每个调用点（与所有新建 inode 一样受进程 umask 影响）。
- **`rename` 替换的是符号链接目标本身**，绝不写穿到其指向的文件。
- **同目录兄弟文件**保证 rename 落在同一文件系统上，交换保持原子。
- 自动创建父目录；任何失败都会移除临时文件并重新抛出该失败；读取方只会观察到旧内容或完整的新内容。

`withFileLock` 跨进程串行化同一文件的写入方，服务于单靠原子提交无法保证安全的读-渲染-提交循环。锁是以 `wx` 创建、内容为 `<pid>\n` 的同目录 `<filename>.lock`，因此读取方从不参与竞争；等待方按指数退避，超时即失败而非无限阻塞。`EEXIST` 直接表示竞争；只有一次新的 `lstat` 确认锁路径存在时，`EPERM` 才表示竞争，从而兼容 Windows 的独占创建行为，又不掩盖无关的权限故障。只有信号探测证明记录中的进程已经不存在时，竞争者才会接管锁。针对同一已退出持有者的竞争者通过一份与记录绑定的认领文件串行化，并在移除锁之前重新读取记录并再次探测。存活、格式错误、不可读、自身持有或其他用户持有的锁保持原样。对于合理持锁时间更长的操作，`waitMs` 可以延长默认的两秒期限。

## 模型体验

无：本包是纯文件系统原语，此处没有任何内容会到达模型请求。

#### KV Cache 影响

无；此处没有任何内容会进入请求前缀。

## 已知限制与暂缓事项

- **原子但不保证持久**——不对文件或其所在目录做 `fsync`，因此崩溃后可能观察到 rename 被回退。此处的文件型存储在启动时重新读取并重新发布，把持久性留作调用方的策略。
- **仅支持字符串内容**——在有消费方需要之前，不提供 `Buffer` 或流式形态。
- **部分遗留锁仍需操作者恢复**——格式错误或不可读的记录、被存活进程复用的 PID，以及在持有接管认领时退出的竞争者都需要操作者检查。文件存续时间本身永远不能授权移除。
- **仅限同一主机和 PID namespace**——持有者探测在竞争者所在主机运行。不同 PID namespace 或多台主机上的写入方不得共享同一锁文件。
