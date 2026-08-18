# Agent Note: Optional TUI completion notifications

Status: implemented

English | [中文](2026-08-18-tui-completion-notifications.zh.md)

## Problem

When a terminal turn finishes outside the user's immediate view, the TUI gives no optional terminal-level signal. Adding a notification must not create transcript content, model-visible input, or a second turn-state authority.

## Decision

The TUI registers `ui-notifications` with an `enabled` boolean that defaults to `false`. `/notifications`, `/notifications status`, `/notifications on`, and `/notifications off` read or field-mutate that namespace through the existing settings provider. A live Agent status transition from `running` to `idle` emits one BEL byte only after the TUI owns the terminal; startup, idle-to-idle updates, and a disabled setting emit nothing. The preference is applied immediately to the mounted renderer and follows external `settings/updated` events.

The notification is a terminal side effect, not a Session event or model input. It uses the existing terminal writer so the host decides how its terminal presents a bell, while the default remains silent for terminals and users that do not want audible or visual alerts.

## Alternatives considered

**Always emit a notification on completion.** This would change the default terminal behavior and make unattended or scripted embeddings noisy, so completion alerts remain opt-in.

**Append a visible transcript notice.** A transcript row would be durable presentation state and could be mistaken for model output; the requirement is satisfied by a terminal-only side effect.

**Use an OSC desktop-notification protocol.** OSC support and permission vary across terminal hosts. BEL is the portable terminal primitive already accepted by the runtime writer, so host-specific notification protocols remain outside the TUI.

## Verification

The TUI test suite covers persisted on/off commands, status reporting, the running-to-idle bell, and the disabled path. TypeScript compilation and the documentation gates validate the settings wiring and bilingual package documentation.

## Consequences

Users can enable a lightweight completion signal without changing chat history or model context. Terminal hosts may ignore or render BEL according to their own preferences. Desktop notifications, notification text, and per-channel delivery policy remain outside this package.
