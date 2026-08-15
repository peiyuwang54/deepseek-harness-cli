# Agent Note: Fork CI on GitHub-hosted runners

Status: implemented

English | [中文](2026-08-15-fork-github-hosted-ci.zh.md)

## Problem

This community fork does not have DeepSeek's enterprise runner pools (`dsh-ubuntu-24-04-16core`, `dsh-windows-2025-16core`). Required `node 24` jobs stayed queued, so `all checks passed` never ran. Deferred release pack jobs used a job-level `if: workflow_dispatch`, which skipped the check name on pull requests; branch protection treats a missing required check as failure. The CLI release workflow had no `pull_request` trigger, so a required `plan release` check also failed immediately.

## Decision

Required Linux workers default to `ubuntu-latest`. The native Windows job defaults to `windows-2025`. `DSH_CI_FAILOVER_LINUX` and `DSH_CI_FAILOVER_WINDOWS` still retarget onto the in-house self-hosted pools when those variables are `selfhosted`; see the [failover runbook](2026-07-26-ci-failover-runbook.md).

Concurrency on the GitHub-hosted default is sized for a 2-core machine: `DSH_GATE_CONCURRENCY=2`, two coverage workers, four snapshot workers.

[Release (dsh)](../../../../.github/workflows/release.yml) and [Release (vendor)](../../../../.github/workflows/release-vendor.yml) pack jobs always run. Off `workflow_dispatch` they print that packing is manual and succeed. Dispatch still packs.

[Release deepseek-harness-cli](../../../../.github/workflows/deepseek-harness-cli-release.yml) runs `plan release` on pull requests and skips build, package, release, npm, and brew jobs there.

Manual benchmark matrices keep the enterprise runner names; those jobs stay dispatch-only.

## Testing

`scripts/ci-workflow.spec.ts` pins `ubuntu-latest` / `windows-2025` as the unset defaults, the pack-job defer step, and the CLI release plan-only pull-request contract.

## Alternatives considered

**Leave the enterprise labels and wait for DeepSeek runners.** Rejected because this fork cannot allocate those labels; queued required jobs block every pull request.

**Delete the release workflows from pull_request.** Rejected because branch protection already names `Pack npm tarballs` and `plan release`; a succeeding no-op keeps those names green without packing.

**Run the five-target CLI exe build on every pull request.** Rejected because macos-15-intel, ubuntu-24.04-arm, and a full pkg SEA build are release cost, not pull-request signal.

## Consequences

Pull requests on this fork can finish required Linux and Wine jobs on standard GitHub-hosted runners. Coverage and snapshot lanes are slower than the 16-core enterprise pools. Self-hosted failover still exists for a writer who has those machines. Dispatch remains the only way to pack npm tarballs or build release exes.
