# Agent Note: Selectable TUI accent hues

Status: implemented

English | [中文](2026-08-15-tui-accent-hues.zh.md)

## Problem

The [terminal front door](2026-08-14-shipped-tui-cli-front-door.md) shipped one fixed interaction accent: ANSI bright blue (`94`) for the prompt, borders, role headers, and selection, with the DeepSeek `#4D6BFE` ink reserved for the truecolor banner gradient and brand mark. There was no way to change that emphasis color, so the terminal could not follow a visual-direction change without forking the package.

## Decision

The palette gains a selectable accent hue, orthogonal to the existing light/dark/system appearance preference. Shipped hues are `deepseek` (default, unchanged), `cosmic-orange`, `mist-blue`, `sage`, `lavender`, and `deep-blue`. Each hue is one `AccentHue` entry in `components/theme.ts` carrying a 24-bit truecolor ink, an ANSI bright code for the `accent` role, an ANSI code for the `brand` role, and a three-stop banner gradient.

The split keeps the palette's theme-adaptive contract intact. Interactive roles use the hue's ANSI codes, which the terminal remaps to its active scheme. On truecolor terminals the startup banner additionally paints the hue's gradient and `brandText` uses its exact ink. The default `deepseek` hue preserves the original blue role codes and truecolor stops.

The TUI registers its own `ui-accent` settings namespace beside the Web-owned `ui-theme` and `locale` sections, since the accent is terminal-owned and must persist even when the Web client stack is not composed. `/accent [id]` field-mutates `ui-accent.accent`; bare `/accent` opens a composer-attached selector over the shipped hues, and the Settings hub lists the current accent. External `settings/updated` events repaint the palette, banner, and chrome live, mirroring the existing theme and locale controllers.

## Alternatives considered

**Reuse the Web `ui-theme` namespace.** That schema is Web-owned and validates only `preference`, so adding an `accent` field would widen the browser schema for a terminal-only concern.

**Use a fixed 24-bit accent without an ANSI fallback.** This would break the theme-adaptive behavior that keeps the chrome legible on arbitrary terminal backgrounds.

## Verification

Unit tests assert the per-hue ANSI codes, truecolor ink, and gradient, and that unknown ids fall back to `deepseek`. A focused controller test persists `/accent cosmic-orange` through the `ui-accent` namespace and repaints through an external `settings/updated` event. Terminal snapshots pin the Accent selector, Settings-hub row, and command catalog.

## Consequences

Six accent hues ship, with `deepseek` as the zero-regression default. The palette, startup banner, brand ink, and `/palette` all follow the active accent, and the accent persists independently of the appearance preference. New accents are additive rows in `ACCENT_HUES`.
