# Agent Note: CLI distribution preserves failures and verifies release origin

Status: implemented

English | [中文](2026-10-26-cli-distribution-hardening.zh.md)

## Problem

An npm shim that consumes its own termination signal reports interrupted work as success. Publishing the shim before its platform dependencies exposes incomplete installations, while interpolating a dispatch version into shell source permits command injection. Checksums downloaded beside an executable detect corruption but do not identify the build that produced it.

## Decision

The [distribution design](../feature/2026-08-15-dsh-cli-exe-distribution.md) retains its three channels. The shim removes its signal-forwarding listeners before re-sending a child's terminating signal to itself, preserves ordinary exit codes, and reports synchronous and asynchronous spawn failures without a Node stack trace.

The release workflow receives the dispatch version through an environment variable and validates every version source as `X.Y.Z` or `X.Y.Z-rc.N` before publishing job outputs. All five platform versions precede the main version. Retries skip versions already in the registry and repair their dist-tags; only an explicit registry `E404` permits a new publication. Registry authentication and transport errors stop publication.

Every action in the CLI release workflow is pinned to a commit. The packaging job signs GitHub provenance for the release tarballs, and npm publications request provenance using job-scoped OIDC. npm authentication retains the protected `NPM_TOKEN` until the package owner configures Trusted Publishing in npm; repository changes cannot establish that trust relationship.

The POSIX installer configures fish through its own `conf.d` file and configures macOS Bash through the first existing login profile as well as `.bashrc`. A missing login profile is created as `.bash_profile`.

## Alternatives considered

**Exit with zero after forwarding a signal.** This hides cancellation from automation. Restoring default signal handling preserves the operating system's termination status.

**Publish the main package first or republish existing versions on retry.** The former exposes missing dependencies; the latter fails because npm versions are immutable. Dependency-first publication with explicit registry error handling supports interrupted releases.

**Remove `NPM_TOKEN` immediately.** OIDC authentication fails until the owner registers this workflow as a trusted publisher. Provenance can be added independently while token authentication remains available.

**Treat a release checksum as proof of origin.** The checksum and executable can be replaced together. Signed provenance supplies a separately verifiable workflow identity; automatic installer checks remain checksum-based.

## Consequences

Release jobs need narrowly scoped attestation and OIDC permissions. Users can explicitly verify downloaded tarballs against the release workflow identity; installers do not require GitHub CLI or automatically enforce this verification. A live release is required to validate registry publication and attestation issuance.

## Verification

The shim tests cover ordinary exits, spawn errors, signal forwarding, and real POSIX termination. Workflow tests execute version validation and publication scripts against a fake registry, including resume, publication failure, and authentication failure. Installer tests exercise fish and macOS Bash configuration through the real installer with an isolated home directory. These checks require no production credentials.
