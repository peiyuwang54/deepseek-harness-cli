# Agent Note: Shared workspace file search

Status: implemented

English | [中文](2026-10-27-shared-workspace-file-search.zh.md)

## Problem

The TUI and local file-reference provider independently implemented the same bounded fuzzy index, cancellation, path validation, and ranking. Their copies failed the duplication gate and could drift when fixing traversal or lifecycle behavior.

## Decision

The existing `dsh-file-reference-local/search` export owns the shared search implementation. Every caller supplies the resolved `respectIgnoreFiles` value: the provider retains basename-only exclusion, and the TUI retains its configurable ignore-file handling. The shared grammar remains in `dsh-file-reference/grammar`; the TUI adapts directory insertion to Pi's closing-quote convention without duplicating token parsing or path validation.

## Alternatives considered

Importing the TUI from the provider would invert package ownership. A new utility package would add a package for functionality already owned by the file-reference provider. Disabling clone detection would preserve two implementations of the same lifecycle and ranking rules.

## Consequences

The TUI declares both file-reference packages as dependencies and no longer owns `ignore`. Search limits, cancellation, candidate ordering, symlink rejection, and insertion text remain unchanged. Disabling ignore-file handling also bypasses nested `.ignore` files, preserving the provider's unfiltered discovery and enforcing the TUI's documented opt-out throughout the tree. Provider and TUI tests cover their distinct ignore and quote policies; focused coverage and the assembled TUI file-completion snapshots exercise both filtering modes.
