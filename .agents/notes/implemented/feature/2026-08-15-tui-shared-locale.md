# Agent Note: Shared Web and TUI locale preference

Status: implemented

English | [中文](2026-08-15-tui-shared-locale.zh.md)

## Problem

The browser already persists `locale.preference`, but the shipped terminal had only English shell copy and no language action. Copying the browser's React locale runtime into the Host terminal would introduce client connection and UI slot dependencies while still not producing terminal-native controls.

## Decision

The TUI bundle mounts the existing Host half of `dsh-client-locale`, so Web and TUI register and mutate the same `locale.preference` field in the shared settings document. The renderer adds `/language [zh|en]`; the bare command opens a composer-attached selector and field-addressed writes avoid replacing any other settings value. External `settings/updated` events refresh the live TUI.

Terminal-owned copy lives in a small typed bilingual dictionary. The welcome dashboard, default composer placeholder, editor footer, Settings hub, and language/appearance selectors read the current locale at render time. Model responses, tool payloads, custom placeholders, and third-party command text stay in their source language. The browser React runtime and dictionaries remain browser-owned.

## Alternatives considered

Copying the browser React locale runtime into the TUI was rejected because it would couple the Host renderer to client connection and UI-slot services without providing terminal-native controls. A TUI-only preference file was rejected because Web and terminal changes would drift. An environment-only language flag was also rejected because it would not support live switching or durable cross-surface updates.

## Verification

Focused tests prove the shared namespace mutation and an externally initiated locale update. Headless-terminal snapshots pin the Chinese Settings hub and the composer-attached language selector. The bundle test requires the locale Host row and its runtime dependency; package TypeScript and repository graph gates cover the new dependency edge.

## Consequences

Changing language in Web or TUI now carries to the other surface through the same settings document, without a second preference store. This first terminal dictionary deliberately covers product chrome rather than arbitrary model or plugin content; further TUI-owned strings can migrate into the same typed copy table without changing the durable contract.
