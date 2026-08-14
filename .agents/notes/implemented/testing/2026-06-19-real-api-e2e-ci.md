# Agent Note: Real-API e2e in CI against the external DeepSeek API

Status: implemented

English | [中文](2026-06-19-real-api-e2e-ci.zh.md)

## Problem

The harness relies on real-API tests because a keyless suite proves the plumbing but not the live product. The [ACP inject postmortem](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) records the standing example: 178 keyless tests stayed green while a real ACP client session crashed immediately. The real-API e2e suite (`pnpm run test:e2e`) closes that gap with live DeepSeek model calls, tools, multi-turn Sessions, resume, and ACP-over-stdio.

The default [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) is deliberately keyless and runs for forks. `test:e2e` self-skips without `DEEPSEEK_API_KEY`, so placing it in that workflow could report green without exercising the provider. Real-API evidence needs a separate secret-bearing workflow with an explicit missing-secret failure.

## Decision

The dedicated [.github/workflows/e2e.yml](../../../../.github/workflows/e2e.yml) runs only `pnpm run test:e2e` against the public DeepSeek API using a repository secret. A preflight converts a missing key into a visible failure instead of a false green. The [private-fork trigger policy](2026-08-14-private-fork-manual-real-api-e2e.md) owns when that workflow runs; this note owns its separation, credential handling, preflight, and execution scope.

### A separate workflow, not a job in ci.yml

ci.yml remains keyless and forkable. Keeping secret-consuming tests in another file isolates credential availability and permissions from the ordinary quality checks, so contributors can run the complete keyless signal without putting an API key in that workflow.

### Preflight: fail loud, never false-green

The workflow requires `DEEPSEEK_API_KEY_EXTERNAL` whenever a real-API run is requested. An empty value exits before build and test execution with an annotation naming the missing secret. Without that check, every real suite would self-skip and a run requested as live-provider evidence would report a false success.

### Secret mapping and hygiene

The repository secret `DEEPSEEK_API_KEY_EXTERNAL` maps to the `DEEPSEEK_API_KEY` environment variable read by adapters and tests. The workflow limits credential access as follows:

- **Step-scoped secret.** Only the preflight and e2e steps receive `DEEPSEEK_API_KEY`; checkout, setup, dependency installation, and build do not.
- **`permissions: contents: read`.** The workflow can read the repository but cannot write contents, comments, or statuses with `GITHUB_TOKEN`.
- **Pinned endpoint.** The e2e step sets `DEEPSEEK_BASE_URL` to `https://api.deepseek.com`, so a repository `.env` cannot redirect the run.
- **No secret output.** The preflight reports only that the key is present, never its value or length.

### Scope and runtime

The job uses Node 24, builds the repository, and then runs the real-API suite with bounded workers, per-test retries, and a job timeout. Keyless gates and Node-version compatibility remain in ci.yml. The DeepSeek native `web_search` probe stays skipped because a successful live response does not reliably include structured source blocks; unit tests continue to cover response parsing.

## Security

Only reviewed refs should be selected for a manual run. Anyone with repository write access can modify workflow or test code and can already author a workflow that reads repository secrets; limiting write access and reviewing the selected ref are the controls for that trust set.

Manual-only dispatch avoids handing the key automatically to pull-request code. If the repository becomes public, workflow logs become public as well, so the no-secret-output rule remains mandatory. Adding an automatic PR trigger, especially `pull_request_target`, requires a new threat review before it can receive this secret.

## Alternatives considered

**Put the secret-consuming job in ci.yml.** Rejected because it would couple the forkable keyless checks to credential availability, permissions, and a different operational lifecycle.

**Allow the suite to self-skip when the key is missing.** Rejected because a requested real-API run could pass without making any provider request.

**Run automatically for repository events.** The private fork's choice and trade-offs are owned by the [manual-trigger Agent Note](2026-08-14-private-fork-manual-real-api-e2e.md).

## Consequences

The repository retains an honest, reproducible live-provider check without weakening keyless CI. A requested run either receives the intended credential and exercises the suite or fails before claiming coverage.

The workflow requires a maintained external API key and runner access to `https://api.deepseek.com`. It does not provide a live-provider signal unless a maintainer deliberately dispatches it under the current trigger policy.
