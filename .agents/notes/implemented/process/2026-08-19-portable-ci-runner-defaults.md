# Agent Note: Portable defaults for CI runner selection

Status: implemented

English | [中文](2026-08-19-portable-ci-runner-defaults.zh.md)

## Problem

Pull-request CI includes three required Linux jobs and one advisory native Windows job. A repository-specific hosted runner label has no meaning in a repository that has not configured that runner: GitHub leaves the job queued without assigning a runner, so no workflow step can report a useful failure. Runner capacity is deployment state, while the workflow also needs a usable default for standalone copies of the repository.

## Decision

Each affected job resolves its runner in this order: the trusted self-hosted failover selected by `DSH_CI_FAILOVER_LINUX` or `DSH_CI_FAILOVER_WINDOWS`, a repository-configured primary label from `DSH_CI_HOSTED_LINUX_RUNNER` or `DSH_CI_HOSTED_WINDOWS_RUNNER`, then the standard GitHub-hosted `ubuntu-24.04` or `windows-2025` label. The primary variables accept one hosted runner label. An unset primary variable is a complete, runnable configuration rather than an implicit dependency on an organization-owned runner.

This decision reverses only the required-by-default larger-runner assignment recorded in the [portable recovery boundary](2026-07-23-portable-required-pull-request-ci.md) and [larger-runner measurements](2026-07-22-evidence-based-larger-hosted-runners.md). Their job decomposition, measured capacity profile, aggregate membership, and self-hosted recovery mechanisms remain current.

The standard Linux path uses concurrency sized for the standard hosted machine: two general gate workers, five coverage workers, and four snapshot tasks. The coverage split assigns four workers to the instrumented multi-project run and one to the uninstrumented heavy suites; lower instrumented fan-out drops the large TUI suite's V8 coverage from the aggregate even though every test passes. A configured hosted Linux label retains the larger-runner settings, while the self-hosted path retains its shared-VM settings. The independent [CI failover runbook](2026-07-26-ci-failover-runbook.md) continues to own outage routing and the Dependabot exclusion; failover takes precedence over the primary hosted label.

`scripts/ci-workflow.spec.ts` pins the selector order, portable labels, conservative standard-runner concurrency, and separation between the Linux and Windows variables. The check deliberately cannot prove that an arbitrary configured label exists; GitHub owns runner registration and assignment.

## Alternatives considered

**Keep repository-specific labels in the workflow.** Rejected because a missing label produces an indefinite queue before repository code can run, and every standalone deployment must edit source merely to obtain a CI verdict.

**Always use standard GitHub-hosted runners.** Rejected because repositories with larger hosted capacity would give up useful parallelism. Repository variables preserve that capacity without making it a prerequisite.

**Probe runner availability in an earlier job.** Rejected because a workflow cannot dynamically change another job's `runs-on` after dispatch, and the unavailable runner prevents the affected job from executing the probe itself.

## Consequences

A repository with no Actions variables receives complete Linux and Windows signals on standard hosted runners. A repository with larger hosted pools sets two independent primary-label variables and retains the higher concurrency profile. Misspelled or unavailable configured labels can still queue indefinitely, but the dependency is explicit repository state, and deleting the variable restores the portable default. The workflow carries three capacity profiles—standard hosted, configured hosted, and self-hosted failover—whose selection and worker limits remain regression-tested.
