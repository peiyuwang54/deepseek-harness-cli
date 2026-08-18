# Agent Note: First-class MCP catalog controls and capability discovery

Status: implemented

English | [中文](2026-08-18-mcp-capability-management.zh.md)

## Problem

The CLI could connect configured MCP servers and expose tools, but users could not pause a configured server without editing JSON, and the TUI had no way to inspect MCP Resources or Prompts. This made server lifecycle and non-tool MCP capabilities invisible at the primary interface.

## Decision

The managed `$DSH_HOME/mcp.json` catalog accepts an optional `enabled` flag. `deepseek mcp enable <name>` and `deepseek mcp disable <name>` update that flag under the existing lock and atomic-write path. Disabled entries remain inspectable but are excluded from profile patch projection; enabling or disabling takes effect after the next CLI start.

The runtime MCP registry owns transport-independent discovery methods for Resources, URI templates, Prompts, resource reads, and prompt expansion. The MCP client delegates these methods to the current SDK generation and drains paginated lists. The TUI exposes them as `/mcp resources [server] [uri]` and `/mcp prompts [server] [prompt]`. Capability absence and connection loss return explicit diagnostics; OAuth remains transport-owned and no credential is persisted by the registry.

## Alternatives considered

**Keep editing `mcp.json` manually.** Rejected: it makes a routine safety action depend on hand-editing a secret-bearing catalog and gives users no clear disabled state.

**Register Resources and Prompts as model tools.** Rejected: their protocol semantics are not tool calls, and injecting every resource or prompt into each model request would add token cost and blur user-controlled discovery with model-visible tools.

**Cache discovery during startup.** Rejected: optional MCP capabilities must not delay or fail tool-only startup; on-demand calls preserve startup behavior and reflect the server's current catalog.

## Consequences

Users can temporarily disable an MCP server without deleting its configuration or secret references. Resource and Prompt inspection is available in the terminal while tool registration remains unchanged. Discovery calls use the configured MCP call timeout and are unavailable while a server is disconnected. OAuth login, token storage, and browser authorization remain future transport-specific work.
