# Agent Note: Manual real-API e2e for the private fork

Status: implemented

English | [中文](2026-08-14-private-fork-manual-real-api-e2e.zh.md)

## Problem

The private fork inherits a real-API e2e workflow that requires the repository secret `DEEPSEEK_API_KEY_EXTERNAL`. Automatic push, pull-request, and nightly triggers fail at preflight when the fork intentionally has no key, producing red workflow runs and owner notifications without exercising a model test.

Configuring a key solely to make those automatic runs green would add credential maintenance and spend external API quota on ordinary repository activity. The keyless CI workflow already covers builds, types, unit tests, and snapshots without that operational cost.

## Decision

[The real-API workflow](../../../../.github/workflows/e2e.yml) has only the `workflow_dispatch` trigger. Pushes, pull requests, and schedules cannot start it. A maintainer deliberately starts a run from GitHub Actions when live-provider evidence is worth the credential and API cost.

The existing preflight remains strict: a manually dispatched run without `DEEPSEEK_API_KEY_EXTERNAL` fails before build and test execution instead of reporting a false green from self-skipped suites. The workflow continues to scope the secret to the preflight and test steps and pins the public DeepSeek API endpoint.

Concurrent manual runs for the same ref cancel the older run. The [real-API e2e design note](2026-06-19-real-api-e2e-ci.md) continues to own the separate-workflow, secret-mapping, preflight, and least-privilege decisions; this note owns only the private fork's trigger policy.

## Alternatives considered

**Configure the secret and retain automatic triggers.** This restores pre-merge, post-merge, and nightly live-provider signals, but it gives routine pushes and elapsed time permission to consume a maintained external credential. The private fork does not need that continuous signal.

**Treat a missing key as a successful skip.** This avoids failure notifications but makes a requested real-API run indistinguishable from a run that exercised the provider. Manual dispatch plus strict preflight keeps the result honest.

**Disable or delete the workflow.** This prevents all accidental runs but removes the checked-in, reproducible path for an intentional live-provider check. Manual-only dispatch retains that path without automatic execution.

## Consequences

Repository activity no longer produces real-API e2e failures or DeepSeek API usage. A maintainer must configure `DEEPSEEK_API_KEY_EXTERNAL` and start the workflow explicitly to obtain live-provider evidence.

The fork gives up automatic pre-merge, post-merge, and nightly detection of external API drift. Reintroducing any automatic trigger requires deliberately accepting its credential exposure, notification, and API-cost consequences.
