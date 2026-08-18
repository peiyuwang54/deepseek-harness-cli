# Agent Note: Doctor runtime and terminal diagnostics

Status: implemented

English | [中文](2026-08-18-cli-doctor-runtime-assets.zh.md)

## Problem

`deepseek doctor` checked only basic directories and the API credential. A packaged executable could therefore report healthy while a missing profile overlay later made startup fail, and terminal capability problems were hidden in the same generic status row.

## Decision

The boot-free doctor validates every shipped profile overlay, the preset tree, and the optional web frontend asset. It reports installation channel, host sandbox-runner availability, truecolor, interactive mouse input, and clipboard command availability as separate checks. Asset and Node failures remain blocking; host capability probes are warnings unless the launcher explicitly reports active sandbox enforcement.

## Alternatives considered

**Rely on release smoke tests only.** Rejected: a user needs a local diagnostic that can inspect an installed tree without entering profile boot, and release checks cannot describe the terminal capabilities of the current host.

**Treat every host capability probe as a hard failure.** Rejected: Terminal.app and minimal CI images can lack optional mouse, clipboard, or truecolor support while TUI and headless profiles remain usable.

## Consequences

Release smoke tests and users can identify missing `cordis.patch.yml` files before profile boot. Doctor intentionally does not claim that a runner probe proves per-call confinement; only a running profile can provide that evidence.

## Verification

`pnpm exec vitest run apps/cli/tests/doctor-completion.spec.ts` and `pnpm exec tsc -p apps/cli/tsconfig.json --noEmit` pass.
