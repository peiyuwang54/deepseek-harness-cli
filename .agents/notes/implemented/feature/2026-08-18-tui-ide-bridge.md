# Agent Note: TUI IDE bridge protocol

Status: implemented

English | [中文](2026-08-18-tui-ide-bridge.zh.md)

## Problem

The terminal `/ide` command can identify the terminal host and insert file references, but it cannot read the active editor selection, show diagnostics, navigate to a location, or hand a reviewable diff to an editor.

## Decision

The TUI reads `DSH_IDE_BRIDGE_URL` as a trusted HTTP(S) bridge root and sends optional `DSH_IDE_BRIDGE_TOKEN` as a bearer credential. The shared protocol exposes `GET /context`, `POST /open`, `POST /diff`, and `POST /diff/<id>/accept`; positions are zero-based, diff ownership remains with the bridge, and the TUI keeps only the returned diff id. The client validates every response at the external JSON boundary, limits responses to one MiB, and aborts requests after five seconds.

`/ide context` and `/ide diagnostics` render the current file, selection, and bounded diagnostic list. `/ide open` and `/ide jump` open a path with an optional one-based line and column that the client converts to zero-based protocol positions. `/ide diff` computes the existing read-only Git diff before asking the bridge to display it, and `/ide accept` asks the bridge to apply a previously displayed diff. Without an endpoint, the existing terminal-native file reference and workspace actions remain available.

## Alternatives considered

**Editor-specific adapters:** Separate VS Code, Cursor, and Windsurf integrations would duplicate request semantics and make the terminal depend on vendor APIs. A small HTTP protocol lets each editor provide one adapter while the TUI keeps one client.

**Local file polling:** Polling editor files cannot represent selections, diagnostics, or an editor-owned diff review and can race with unsaved buffers. The bridge remains the authority for those states.

**Applying patches in the TUI:** Writing a patch directly would bypass the editor's review and ownership model. The bridge displays and accepts its own diff id instead.

## Consequences

The protocol requires a companion bridge extension or service; the repository does not claim that every terminal host provides one. The TUI never stores bridge tokens or editor payloads in the Session, and malformed or oversized responses fail closed. The protocol is transport-specific to HTTP(S) but editor-neutral; a future provider can reuse the same operations over another transport without changing the command vocabulary.
