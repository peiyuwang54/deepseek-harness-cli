# Agent Note: Traditional Chinese terminal interface

Status: implemented

English | [中文](2026-08-18-tui-traditional-chinese.zh.md)

## Problem

The terminal interface offered Simplified Chinese but no Traditional Chinese copy. Users could persist only the eight existing locale identifiers, and the Chinese selector label did not distinguish the available script.

## Decision

The shared `locale.preference` setting accepts `zh-tw` as the ninth interface locale. The terminal selector labels `zh` as `简体中文` and adds `繁體中文`; `/language` also recognizes the explicit identifier, both Chinese-script names, and `Traditional Chinese`. Traditional Chinese owns complete terminal chrome and credential-management copy rather than converting Simplified Chinese at runtime.

The browser continues to ship only its `zh` and `en` dictionaries. It validates and preserves `zh-tw` as a shared terminal preference but retains its browser-derived language when the selected locale has no browser dictionary.

## Alternatives considered

**Render Simplified Chinese under a Traditional Chinese label.** Rejected because a language selector must describe the text the interface actually displays.

**Convert strings at runtime.** Rejected because script conversion does not choose region-appropriate terminology and creates a second, implicit localization path.

## Verification

Focused TUI tests cover alias resolution, persistence, immediate chrome refresh, credential copy, and compact duration formatting. The locale Host test accepts `zh-tw` and still rejects unknown identifiers. A keyless terminal snapshot pins both Chinese script choices in the selector.

## Consequences

DeepSeek Harness advertises nine interface languages. New terminal-owned copy must add an entry to both terminal dictionaries and the shared preference schema; browser support remains explicit and independent.
