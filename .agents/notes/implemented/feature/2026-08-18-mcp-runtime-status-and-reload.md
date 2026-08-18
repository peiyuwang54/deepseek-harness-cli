# Agent Note: MCP runtime status and manual reload

Status: implemented

English | [中文](2026-08-18-mcp-runtime-status-and-reload.zh.md)

## Problem

The scoped tool registry can show which MCP-qualified tools are currently visible, but it cannot distinguish a connected server with no tools from a failed server, expose reconnect progress, or safely replace a connection after its retry budget is exhausted. Inferring connection health from tool names would report stale tools as healthy during an outage. Reusing the composition-wide `/reload` action would reload unrelated plugins and still provide no per-server result.

## Decision

`@deepseek-ai/dsh-mcp` owns the `ctx.mcp` runtime registry. It is the Service Definition for MCP connection diagnostics and lifecycle control. Each `@deepseek-ai/dsh-mcp-client` instance is a Service Provider that registers its stable name, transport, current connection state, synchronized tool count, reconnect progress, and immediate reload function for the instance's effect lifetime. The TUI is a Consumer that obtains the service optionally, so embeddings without it retain tool-only discovery.

The registry exposes detached, name-sorted snapshots with `connecting`, `connected`, `reconnecting`, or `failed` state. It does not expose transport errors or credentials. `/mcp`, `/mcp desc`, and `/mcp schema` merge those server snapshots with the receiving Agent's scoped tool schemas: connection state is host-level, while tool names, descriptions, and schemas remain scope-filtered. A configured server with no visible tools is still shown.

`/mcp reload [server]` runs only while every live Agent is idle, because one globally registered server may serve several Agents. Omission selects every active server; a name selects exactly one. Each supervisor cancels a pending backoff, removes current-generation ownership before closing it, waits for the existing bounded transport-close barrier and serialized tool-sync queue, resets the outage budget, then makes one immediate connection and discovery attempt. Concurrent reloads for one server share the same replacement operation. If that immediate attempt fails, the command reports failure and the configured automatic reconnect policy continues from the failed attempt. Reload does not reread `$DSH_HOME/mcp.json`; catalog add and remove still require a new process.

This decision partially supersedes the original [single-package MCP topology](2026-07-07-mcp-client-plugin.md), because human diagnostics now create a real Service Provider / Consumer seam. It retains the concrete client's one-instance-per-server transport design, naming rules, and tool bridge. It also fulfills the runtime-service condition recorded by the [managed MCP catalog](2026-08-18-managed-mcp-server-catalog.md) without making the catalog a second connection owner. The original client, automatic reconnect, managed catalog, and TUI front-door notes remain active because their naming, retry, credential, composition, and presentation decisions still guide future work.

The user-facing command was compared with the documented [Gemini CLI `/mcp reload` and status views](https://geminicli.com/docs/cli/commands/#mcp). DeepSeek Harness uses its own Cordis service and MCP supervisor; no Gemini source was copied.

## Alternatives considered

**Infer status from registered MCP tools.** Rejected because the reconnect supervisor intentionally keeps the last good generation registered during a transient outage, and a connected server may legitimately advertise zero tools.

**Call the Loader-backed `/reload`.** Rejected because config-tree refresh owns composition changes, not one connection generation. Reloading unrelated rows expands the failure surface and cannot report the selected server's immediate outcome.

**Make the managed catalog own live clients.** Rejected because Cordis plugin instances already own transports, tool registrations, teardown, and HMR. A catalog-side manager would duplicate that lifecycle and create two writers for one server.

**Expose runtime controls directly from `dsh-mcp-client` to the TUI.** Rejected because the Consumer would depend on a concrete provider package, and another MCP provider could not participate without reproducing the command.

## Consequences

Users can distinguish connected, reconnecting, and failed MCP servers and can retry one server without restarting the CLI. Manual reload preserves the supervisor's no-overlapping-process and serialized-generation guarantees, but it adds a second trigger that must remain coalesced with automatic reconnect and disposal. Unit tests pin registry lifetime, duplicate names, concurrent fan-out, status transitions, backoff cancellation, generation replacement, and same-server reload coalescing. TUI command tests pin scoped visibility, status rendering, idle admission, absence fallback, and immediate failure reporting; the existing keyless TUI checkpoint continues to pin schema projection.
