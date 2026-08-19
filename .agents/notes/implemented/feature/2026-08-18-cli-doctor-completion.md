# Agent Note: Boot-free diagnostics and shell completion

Status: implemented

English | [中文](2026-08-18-cli-doctor-completion.zh.md)

## Problem

Installation failures are difficult to classify when the normal profile boot is the first command a user runs, and launcher options are not discoverable from shell completion.

## Decision

The launcher provides `deepseek doctor [--json]` without mounting a profile. It reports Node and platform support, workspace and harness-home access, credential presence, managed MCP configuration and [bounded connectivity](2026-08-19-mcp-connectivity-diagnostics.md), shipped runtime assets, and terminal capabilities. It returns nonzero only for blocking checks. `deepseek completion <shell>` emits static completion scripts for bash, zsh, fish, and PowerShell and registers both shipped command names.

## Alternatives considered

- **Boot a profile for diagnostics** — rejected because a broken profile or missing runtime asset would prevent the diagnostic command from running.
- **Generate completions from the live plugin catalog** — rejected because completion must remain available before profile initialization and must not execute third-party plugin code.

## Consequences

Doctor does not contact the model or mutate user files. It starts enabled managed MCP servers only for the bounded connectivity diagnostic and closes each probe immediately. A missing API key, missing harness home, non-TTY output, missing truecolor advertisement, or optional MCP failure is a warning; malformed configuration, a required MCP failure, inaccessible workspace, unsupported Node, or incomplete runtime assets are blocking errors. Completion scripts cover launcher commands and common options but do not attempt to discover third-party plugin commands.
