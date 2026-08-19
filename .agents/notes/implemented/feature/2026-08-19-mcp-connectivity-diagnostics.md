# Agent Note: MCP connectivity diagnostics independent of Tools

Status: implemented

English | [中文](2026-08-19-mcp-connectivity-diagnostics.zh.md)

## Problem

Catalog syntax alone cannot show whether an enabled managed MCP server can initialize, while inferring connection health from Tools incorrectly rejects servers that expose only Resources or Prompts. A diagnostic must use the same transport and credential handling as profile startup without retaining tools, processes, or credentials.

## Decision

`managedMcpTargets()` parses the authoritative version-0 catalog and resolves environment references only for enabled entries. `deepseek doctor` connects each enabled target through `probeMcpConnection()`, completes initialize and every advertised `tools/list` page, and closes the client immediately. `--mcp-timeout-ms` sets the per-request limit and defaults to 5000 milliseconds. Disabled entries are reported without starting them.

A successful probe reports the discovered tool count. A connection failure is blocking only when the catalog entry sets `failOnStartupError`; otherwise it is a warning, matching profile activation. Catalog parsing or reference-resolution failure remains blocking. Diagnostic output never includes resolved credential values.

The MCP client treats an absent Tools capability as a valid empty tool generation. Resource-only and Prompt-only servers therefore stay connected and remain available through `ctx.mcp`, while a transition from a tool generation to no Tools disposes the old registrations.

## Verification

CLI tests cover disabled-entry skipping, optional and required failures, timeout forwarding, and a real credential-scrubbed stdio fixture from catalog parsing through initialize, discovery, and process close. MCP client tests prove that a server without Tools publishes no registrations and removes a previous tool generation.

## Alternatives considered

**Report only catalog validity.** Rejected because valid JSON cannot detect a missing executable, refused HTTP connection, failed OAuth refresh, or protocol initialization error.

**Infer health from the runtime tool list.** Rejected because a connected server may legitimately publish zero tools, and doctor runs without mounting a profile.

**Make every connection failure blocking.** Rejected because managed MCP startup already distinguishes optional servers from entries that set `failOnStartupError`; diagnostics use the same availability decision.

## Consequences

Doctor may start local commands and make network requests declared by enabled managed MCP entries. The bounded probe closes every connection and never registers tools, but server-owned startup side effects still occur. Resource-only and Prompt-only servers participate in the runtime catalog without inventing placeholder tools.
