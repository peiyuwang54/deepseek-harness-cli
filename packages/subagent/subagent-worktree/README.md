# @deepseek-ai/dsh-subagent-worktree

English | [中文](README.zh.md)

`dsh-subagent-worktree` gives coding subagents an isolated Git checkout. Each checkout uses a `dsh/subagent/<id>` branch and lives under `$DSH_HOME/subagent-worktrees` (or the configured root). The manager never changes the user's current checkout during creation.

The checkout remains after the subagent exits. Call `merge(id, targetCwd)` to merge it into a clean, explicitly selected checkout, or `discard(id)` to remove the checkout and branch. A dirty checkout must be discarded with `force: true`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `root` | `$DSH_HOME/subagent-worktrees` | Persistent checkout directory. |
| `maxConcurrent` | `4` | Maximum simultaneous `git worktree add` operations. |

The service requires Git and a parent session with an absolute workspace directory. Non-Git workspaces fail before a child is published.

## Model Experience

None, as this package manages host-side Git checkouts; it does not register a model-facing tool or add content to model requests.

#### KV Cache effect

None; worktree metadata stays outside the session transcript.

## Known Limitations and Deferred Work

- Worktree records are durable on disk, but an isolated continuable child does not yet recreate a missing checkout during cold resume.
- Merge is an explicit fast-forward-capable Git merge and does not resolve conflicts automatically.
