# `@deepseek-ai/dsh-command-jobs`

English | [中文](README.zh.md)

Human-facing background-job controls over [`ctx.jobs`](../jobs/README.md). The plugin registers `/ps`, `/stop`, and the Codex-compatible `/clean` alias through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers the same owner-fenced operations without a model turn. Loading it also attaches a job controller; producers may therefore start work for an Agent even when that Agent's preset omits the model-facing [`job_*` tools](../tool-jobs/README.md).

## Commands

| Input | Result |
|---|---|
| `/ps` | Lists caller-visible `running` and `stopping` jobs as `<id> [<kind>] <status> — <label>`. Completed, killed, and failed records are omitted. Labels use only their first line and are capped at 80 Unicode code points. Output is never consumed. |
| `/stop` | Requests cancellation of every caller-visible `running` job with the reason `Stopped by /stop.`. Jobs already `stopping` are left alone. The result reports the requested count and every cancellation hook that failed. |
| `/clean` | Performs the same operation as `/stop`, using `Stopped by /clean.` as the cancellation reason. |
| Either command with arguments | Returns its usage line without reading or mutating jobs. |

Both commands pass the exact invoking Agent to the registry. Owned jobs from another session therefore remain invisible and cannot be cancelled; unowned jobs retain the registry's intentionally open access. `/stop` reports a request rather than claiming settlement because producer cleanup may finish later.

## Composition

Mount the command registry, one job backend, and this consumer:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: command-jobs
  name: '@deepseek-ai/dsh-command-jobs'
```

The shipped base bundle mounts the plugin globally so TUI and Web commands share it. Model-facing job tools remain an independent preset choice.

## Model Experience

### Human background-job control

#### What the model sees

The command adapter adds no model-visible content. Command input, result text, job labels, and cancellation acknowledgements remain in log-only `command/run` / `command/done` events and never enter derived model history.

#### Token effect

The commands add no model tokens.

#### KV Cache effect

Command execution does not change a model request or its reusable prefix.

## Known Limitations and Deferred Work

- **No output preview** — `/ps` deliberately uses non-consuming snapshots; use the model-facing `job_output` tool or the producing surface for output.
- **Cancellation is asynchronous** — `/stop` and `/clean` request every running cancellation but do not wait for producer settlement.
- **The registry is broader than terminals** — unlike Codex's terminal-only process list, Harness also includes generic background subagents and future job kinds.
