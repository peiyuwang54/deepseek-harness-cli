# Agent Note: Portable pull-request CI recovery boundary

Status: implemented

English | [中文](2026-07-23-portable-required-pull-request-ci.zh.md)

## Problem

Required pull-request jobs assigned to organization-owned runner labels remain queued when GitHub cannot allocate those pools. The workflow is valid and standard GitHub-hosted jobs can still pass, but `all checks passed` never starts and an otherwise healthy pull request cannot satisfy branch protection.

Billing health, a runner definition's `Ready` state, and a large autoscaling ceiling do not prove that a named pool can receive a job. Required correctness checks need a known portable recovery path even when the ordinary low-latency path depends on repository-external runner provisioning.

## Decision

[CI](../../../../.github/workflows/ci.yml) runs the required primary Node 24 jobs on a hosted selector that defaults to standard `ubuntu-24.04` and accepts an optional repository-configured larger-runner label. The stable `all checks passed` aggregate uses standard `ubuntu-latest` unless the Linux failover switch retargets it with the workers. The [portable runner defaults](2026-08-19-portable-ci-runner-defaults.md) supersede this record's enterprise-primary allocation choice while preserving larger hosted capacity as explicit repository state. The required Windows job runs Windows Node under Wine on standard `ubuntu-latest` for the blocking surfaces; an independent native Windows job defaults to `windows-2025` but does not participate in the aggregate ([dual Windows decision](2026-08-08-native-windows-pull-request-ci.md)). Standard-hosted jobs also retain Node 22.19, Node 26, the Python SDK unit suite, and the [release-shaped Linux x64 Python runtime validation](../testing/2026-08-12-required-python-runtime-pull-request-ci.md), while the serial references remain the complete unsharded cross-platform definitions.

The three Linux primary jobs, Node compatibility, Python SDK unit suite, Python runtime validation, and `windows node 24 / wine blocking` remain dependencies of `all checks passed`; `windows node 24 / native complete` is deliberately absent. Branch protection continues to require `e2e` and `all checks passed`. With no primary-label variables, every required job has a standard GitHub-hosted assignment. A configured label that cannot allocate still leaves its jobs queued; deleting the variable restores the portable assignment, while the independent self-hosted switches remain available for a configured-pool outage.

The [larger-runner decision](2026-07-22-evidence-based-larger-hosted-runners.md) owns the measured higher-capacity profile. The [serial cross-platform reference](2026-07-21-serial-cross-platform-ci-reference.md) remains the independent completeness check, and the manual larger-runner suites retain size comparisons without expanding the ordinary required matrix.

## Alternatives considered

**Require larger-runner labels for the Linux primary jobs.** This gives configured repositories faster feedback, but a repository without those labels receives no verdict. The hosted-primary variables retain the measured profile without making it the runnable default.

**Select enterprise size from advertised core count.** Benchmarks show non-monotonic scaling and setup variance, so exact complete-job measurements choose the required pools instead.

**Skip or demote checks while capacity is unavailable.** This would make the status green by dropping evidence rather than by running the repository's required contracts.

**Use one worker policy on every host.** Outer gate concurrency and inner tool workers contend differently on Linux, Windows, and standard runners; measured host-specific bounds avoid turning additional cores into slower execution.

## Consequences

Ordinary pull requests need no repository-specific runner labels. Repositories that configure larger hosted labels spend that capacity on the Linux critical path and independent native Windows signal, while the Wine job keeps the required Windows verdict on standard Linux allocation. A live exact-head run distinguishes the commands branch protection consumes from the separate diagnostic contract; queue delay is reported separately from each job's `startedAt` to `completedAt` execution interval.

A configured runner label is an explicit acceleration dependency rather than an implicit correctness dependency. If it degrades, deleting the primary-label variable restores standard-hosted assignment, while the failover variables can route trusted pull requests to the proven self-hosted pools. Changing a pool definition's status alone remains insufficient evidence that it can receive work.
