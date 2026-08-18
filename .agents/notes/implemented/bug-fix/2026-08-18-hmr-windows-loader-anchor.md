# Agent Note: Windows HMR loader anchors stay filesystem paths

Status: implemented

English | [中文](2026-08-18-hmr-windows-loader-anchor.zh.md)

## Problem

Packaged Windows launches can expose the HMR loader anchor as `C:\\snapshot\\...` instead of a `file:` URL. Passing that anchor to `new URL()` treats `C:` as a URL scheme, so `fileURLToPath()` aborts startup with `ERR_INVALID_URL_SCHEME`.

## Decision

Resolve native POSIX, Windows drive, and UNC anchors with the path module. Keep URL resolution for URL anchors and relative URL bases.

## Alternatives considered

- Normalize every loader anchor to a file URL at the packaging boundary: rejected because embedded runtimes own the anchor representation and the HMR service should accept both forms.
- Catch `ERR_INVALID_URL_SCHEME` and retry: rejected because the path form is known before parsing and should not rely on exception-driven control flow.

## Consequences

HMR can initialize in Windows packaged and source launches regardless of whether the loader supplies a filesystem path or a file URL. URL-based behavior remains unchanged.

## Testing

`apps/cli/tests/hmr-windows-path.spec.ts` covers drive, UNC, POSIX, file-URL, and path-anchor resolution.
