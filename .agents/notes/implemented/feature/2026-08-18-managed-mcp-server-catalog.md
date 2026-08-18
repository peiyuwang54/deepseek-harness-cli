# Agent Note: Managed MCP server catalog

Status: implemented

English | [中文](2026-08-18-managed-mcp-server-catalog.zh.md)

## Problem

The MCP client accepts complete Cordis plugin configuration, but requiring every CLI user to author patch YAML makes ordinary server setup hard to discover and easy to get wrong. Storing authentication values directly in a shared configuration file would also expose secrets through file reads, command output, and config dumps.

## Decision

The boot-free `deepseek mcp` command manages a version-0 catalog at `$DSH_HOME/mcp.json`. `list`, `get`, `add`, and `remove` cover stdio and Streamable HTTP servers. Writers use the shared cross-process file lock and atomic replacement utility; the replacement file uses mode `0600` and newly created parent directories use mode `0700` where POSIX permissions apply. An existing name must be removed before replacement, so a mistyped update cannot silently change trusted executable code.

The catalog stores environment-variable source names rather than resolved values. `--env KEY[=SOURCE]` maps launch environment values into a stdio process, and `--header NAME=SOURCE` maps them into HTTP headers. Profile composition resolves the references immediately before plugin boot and fails when a source is unset. URL user information is rejected. `get`, `list`, and config dumps never resolve the references; a dump renders `<environment:SOURCE>`.

The launcher projects each catalog entry into one ordinary `@deepseek-ai/dsh-mcp-client` insertion with a stable `managed-mcp-<server>` row id. The layer follows shipped bundle layers and precedes the profile and home patch layers, so existing Cordis overrides retain final authority. Projection applies only to the shipped `tui`, `headless`, and `web` profiles. Custom profiles continue to declare their own MCP rows. Catalog changes take effect on the next process start; the TUI's `/mcp` views inspect tools already published into the current Agent scope.

The durable parser rejects unknown fields, unsupported versions, malformed names, invalid transport data, and invalid environment or header references. It does not accept an earlier schema by inference or silently skip an invalid server.

## Alternatives considered

**Require `cordis.patch.yml` for every server.** Direct patches remain the advanced and custom-profile path, but they do not provide a concise product command, writer coordination, or safe reference-oriented credential defaults.

**Store literal environment and header values.** File permissions alone do not prevent secrets from appearing in inspection output, backups, or copied configuration. References keep secret material under the existing launch-environment ownership.

**Mutate live MCP instances from the TUI.** A second runtime manager would duplicate Cordis lifecycle ownership and require a connection-status service before it could report reliable reload results. This catalog remains a launch-time input; live `/mcp` management can be added only through an effect-scoped service owned by the MCP client lifecycle.

## Consequences

Common MCP setup now has one stable CLI surface and works across all shipped app profiles without changing the underlying plugin architecture. Managed configuration remains inspectable and deterministic while secret values stay out of the durable file and config dumps.

Server executables are still trusted local code outside the agent sandbox, and the CLI does not install them. OAuth, enable or disable state, and live reload are not provided by this catalog. Unit tests pin parsing, mutation, permissions, reference resolution, redaction, and generated patches; a built-bin e2e test pins real command dispatch and dump composition. No Session snapshot is added because management is boot-free and creates no transcript event.
