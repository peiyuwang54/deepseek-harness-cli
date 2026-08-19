# Agent Note: Default-off browser validation through Playwright MCP

Status: implemented

English | [中文](2026-08-19-playwright-mcp-browser-validation.zh.md)

## Problem

The generic MCP client can connect a browser server, but the repository provided no reviewed configuration, installation path, safe defaults, or evidence-based validation workflow. Requiring users to invent that composition makes browser validation undiscoverable and encourages first-run package downloads, persistent signed-in profiles, or unrestricted network and file settings.

## Decision

`examples/mcp-browser/playwright.cordis.yml` is a default-off overlay for the official `@playwright/mcp` server pinned at version `0.0.79`. The runtime command is the preinstalled `playwright-mcp` executable; plugin activation never invokes a package manager. The overlay uses the generic MCP client with the stable `playwright` namespace and can be selected through `--patch` or expressed equivalently in the managed MCP catalog.

The reference defaults to headless execution, an in-memory browser profile, blocked Service Workers, omitted inline image responses, Playwright's ordinary workspace file restrictions, and direct HTTP requests limited to loopback origins. It never disables the browser sandbox, grants device permissions, loads stored authentication, or enables unrestricted file access. The documentation identifies page content as untrusted, states that Playwright's origin filter does not cover redirects or form a security boundary, and distinguishes MCP tool admission from confinement of the trusted stdio server and browser processes.

Validation uses page state, accessibility snapshots, console output, network responses, and a saved screenshot rather than a model assertion. Playwright writes automatically named artifacts under `.playwright-mcp` in the working directory, while explicit relative filenames resolve from the working directory. Inline image responses remain omitted so users inspect saved visual evidence directly.

## Verification

The example test parses the checked-in overlay, pins the package version, executable, namespace, and complete safety argument list, rejects first-run package execution and unsafe flags, then replaces only the upstream process with the package-owned MCP fixture. A real Cordis Loader boot must discover `mcp__playwright__greet` through the generic bridge. The top-level Cordis configuration gate includes every `examples/mcp-*/*.cordis.yml` app overlay and proves its package resolves from the CLI installation.

## Alternatives considered

**Add browser behavior directly to `agent-loop`.** Rejected because browser automation is an optional external capability already expressed by the complete MCP seam; loop-specific behavior would duplicate Playwright and violate plugin ownership.

**Launch a floating package through `npx` during startup.** Rejected because profile activation would perform an unreviewed network download and could change behavior without a repository diff.

**Enable remote origins or a persistent browser profile by default.** Rejected because local UI validation needs neither. Users can copy the overlay and explicitly accept the broader network, credential, and state consequences.

## Consequences

Browser validation is discoverable, reproducible, removable from the model tool catalog when unused, and assembled without another core capability seam. It still depends on a separately installed third-party executable and browser, adds the server's tool schemas to every request while active, creates workspace artifacts, and runs trusted browser processes outside the agent sandbox. The active [third-party memory MCP examples](2026-07-31-third-party-memory-mcp-examples.md), [API browser trust](../architecture/2026-07-28-api-browser-trust-boundary.md), and browser-GIF evidence decisions remain distinct and unsuperseded: they govern memory providers, inbound Web API trust, and pull-request evidence respectively.
