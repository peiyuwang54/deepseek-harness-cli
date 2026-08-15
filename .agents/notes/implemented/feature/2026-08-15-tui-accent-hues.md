# Agent Note: Selectable TUI accent hues

Status: implemented

English | [中文](2026-08-15-tui-accent-hues.zh.md)

## Problem

The [terminal front door](2026-08-14-shipped-tui-cli-front-door.md) shipped one fixed interaction accent: ANSI bright blue (`94`) for the prompt, borders, role headers, and selection, with the DeepSeek `#4D6BFE` ink reserved for the truecolor banner gradient and brand mark. There was no way to change that emphasis color, so the terminal could not follow a visual-direction change without forking the package.

## Decision

The palette gains a selectable accent hue that the user chooses together with the light or dark appearance. Shipped hues are `deepseek` (default, unchanged), `cosmic-orange`, `mist-blue`, `sage`, `lavender`, and `deep-blue`, with the iPhone finishes sampled from Apple's published CSS. Each hue is one `AccentHue` entry in `components/theme.ts` carrying an ANSI bright code for the `accent` role, an ANSI code for the `brand` role, and two truecolor inks — a bright `dark` stop and a deep `light` stop — each with a three-stop banner gradient.

Each background remembers its own hue. The TUI persists a `{ light, dark }` selection in the `ui-accent` namespace, and the live palette reads the entry matching the active terminal color scheme. Interactive roles use the hue's ANSI codes, which the terminal remaps to its active scheme; on truecolor terminals the startup banner additionally paints that background's gradient and `brandText` uses its ink. The composer and submitted user cards use a quiet tint derived from the same ink; the default `deepseek` selection preserves the original Web bubble surfaces, blue role codes, and truecolor stops.

The TUI registers its own `ui-accent` settings namespace beside the Web-owned `ui-theme` and `locale` sections, since the hue is terminal-owned and must persist even when the Web client stack is not composed. Bare `/theme` opens one composer-attached picker with a top `DeepSeek` system-default row followed by `Light ·` and `Dark ·` cards for every hue. Selecting a card field-mutates `ui-theme.preference` and the matching `ui-accent` field together; `/theme light|dark|system [id]` offers the same direct path, while `/theme deepseek` resets the product default. The Settings hub exposes one Theme row instead of separate Appearance and Accent rows. External `settings/updated` events repaint the palette, banner, chrome, composer, and user cards live, mirroring the locale controller.

## Alternatives considered

**Reuse the Web `ui-theme` namespace.** That schema is Web-owned and validates only `preference`, so adding an `accent` field would widen the browser schema for a terminal-only concern.

**Use a fixed 24-bit accent without an ANSI fallback.** This would break the theme-adaptive behavior that keeps the chrome legible on arbitrary terminal backgrounds.

**Use one hue for both backgrounds.** A bright iPhone finish is illegible on a light terminal and a deep finish on a dark one, so the per-background ink split was required once the accent became selectable.

## Verification

Unit tests assert the per-hue ANSI codes, per-background truecolor ink, gradients, tinted card surfaces, and unknown-id fallback to `deepseek`. A focused controller test persists `/theme light cosmic-orange` through both settings namespaces and confirms that the chrome and chat-card surface repaint together. Terminal snapshots pin the unified Theme picker, Settings-hub row, and command catalog.

## Consequences

Six theme hues ship, with a `deepseek`/`deepseek` selection as the zero-regression default. The palette, startup banner, brand ink, composer, user cards, and `/palette` all follow the active background's hue. Appearance and hue remain independently durable for Web compatibility and per-background memory, but the terminal presents them as one theme choice. New hues are additive rows in `ACCENT_HUES`.
