# `@deepseek-ai/dsh-headless`

English | [中文](README.zh.md)

The non-interactive execution bundle used by `deepseek exec` and the compatible `dsh --profile headless` spelling. [`cordis.patch.yml`](cordis.patch.yml) composes the coding Agent and `headless-runner` directly over [`dsh-base`](../base/README.md), without a Host, HTTP server, Web runtime, or browser plugin.

## Commands

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

`--json` writes one JSON value per line using `thread.*`, `turn.*`, and `item.*` lifecycle events. Without it, stdout contains the final result and a newline. `--output-last-message` also writes that result without an added newline to the selected file.

`--output-schema` accepts an object-rooted JSON Schema from the supported [`dsh-tools` subset](../../core/tools/README.md). The Agent receives a scoped `structured_output` tool; success requires one committed schema-valid call, and the captured object becomes the final result. Invalid schema files and completed turns without a valid capture exit nonzero.

Repeat `--image` to attach ordered PNG, JPEG, WebP, or GIF files. The attachment service validates and stores every image before the user message enters the Session.

`resume <session-id>` continues an exact persisted Session. `resume --last` selects the newest Session created in the current directory; add `--all` to consider other workspaces. Repeat `--add-dir` to add existing writable directories relative to the session cwd; the complete root set is durable, so resumed sessions retain earlier roots and may add more. `--ephemeral` prevents persistence for a fresh run and cannot be combined with resume. `--full-auto`, `--yolo`, and `--dangerously-bypass-approvals-and-sandbox` use the same permission presets as the terminal command.

## Execution

After Loader settlement, the runner resolves the shared default model and Agent preset, creates or resumes one Agent, submits one user message, and waits until it becomes idle. It flushes the Session before deriving the result and exit status. A completed final turn exits 0; all other outcomes exit 1. Text mode writes durable model failures and runner failures to stderr, while JSON mode preserves JSONL framing with an `error` event. The process opens no listening port.

## Model Experience

None, as ordinary runs add no model-visible content and structured mode adds only the caller-selected schema tool and its completion instruction.

#### KV Cache effect

Text, image, and resume modes add no fixed request prefix. Structured mode adds the schema-specific tool and instruction, so its request prefix differs from an ordinary run.

## Known Limitations and Deferred Work

- One process submits one task. Continued interaction requires another `exec resume` invocation or the interactive terminal.
- JSONL reports stable lifecycle categories but does not expose raw provider chunks or every product-specific Session event.
- `ctx.appExit` is launcher-owned; embedding the bundle without the `dsh` launcher must provide that service.
