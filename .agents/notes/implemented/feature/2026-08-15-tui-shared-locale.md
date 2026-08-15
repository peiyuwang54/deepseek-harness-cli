# Agent Note: Shared Web and TUI locale preference

Status: implemented

English | [中文](2026-08-15-tui-shared-locale.zh.md)

## Problem

The browser already persists `locale.preference`, but the shipped terminal had only English shell copy and no language action. Copying the browser's React locale runtime into the Host terminal would introduce client connection and UI slot dependencies while still not producing terminal-native controls.

## Decision

The TUI bundle mounts the existing Host half of `dsh-client-locale`, so Web and TUI register and mutate the same `locale.preference` field in the shared settings document. The setting accepts English, Chinese, Arabic, French, Russian, Spanish, Japanese, and Korean. The renderer adds `/language [en|zh|ar|fr|ru|es|ja|ko]`; the bare command opens a composer-attached selector and field-addressed writes avoid replacing any other settings value. External `settings/updated` events refresh the live TUI.

Terminal-owned copy lives in a typed eight-language dictionary. The welcome dashboard, default composer placeholder, editor footer, live-turn row, Settings hub, and language/appearance selectors read the current locale at render time. Model responses, tool payloads, custom placeholders, and third-party command text stay in their source language. The browser React runtime and dictionaries remain browser-owned: it applies shared Chinese and English preferences, and retains its browser-derived language when the stored preference is terminal-only.

## Alternatives considered

Copying the browser React locale runtime into the TUI was rejected because it would couple the Host renderer to client connection and UI-slot services without providing terminal-native controls. A TUI-only preference file was rejected because Web and terminal changes would drift. An environment-only language flag was also rejected because it would not support live switching or durable cross-surface updates.

## Verification

Focused tests prove all eight terminal locale ids, native-name command resolution, the shared namespace mutation, browser fallback for terminal-only preferences, and an externally initiated locale update. Headless-terminal snapshots pin the Chinese Settings hub and the eight-language composer selector. The bundle test requires the locale Host row and its runtime dependency; package TypeScript and repository graph checks cover the dependency edge.

## Consequences

Web and TUI share one preference store while interpreting only the locale dictionaries each front door ships. The terminal dictionary covers product chrome rather than arbitrary model or plugin content; further TUI-owned strings can migrate into the same typed copy table without changing the durable setting.
