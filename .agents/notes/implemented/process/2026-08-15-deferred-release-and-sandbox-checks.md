# Agent Note: Defer release and real-kernel checks during feature development

Status: implemented

English | [中文](2026-08-15-deferred-release-and-sandbox-checks.zh.md)

## Problem

Pre-release CLI feature work needs a short feedback loop, while npm publication rehearsals and real-kernel confinement matrices prove separate release and platform concerns. Running those jobs on every ordinary `master` push reports failures that do not diagnose the focused terminal behavior under development and consumes platform runners before a release candidate exists.

## Decision

Ordinary pull requests and `master` pushes retain the release workflow checks. The pack jobs run and succeed with a message that packing is manual; they do not skip the check name. Publication stays dispatch-only. The real-kernel Sandbox workflow also remains visible on `master` pushes while its OS matrix is skipped. Manual dispatch remains available for dsh/vendor package rehearsals and the bwrap, Landlock, and Seatbelt matrix.

This is a temporary pre-release policy while the CLI feature and terminal UI are changing quickly. Before the first tagged release, restore automatic package rehearsals and the platform sandbox matrix so release artifacts and confinement are proved on the publication candidate.

## Alternatives considered

**Delete the release and Sandbox workflows.** Rejected because manual dispatch preserves the exact publication and platform proofs, keeps the deferred coverage visible, and avoids recreating the workflows before release.

**Run every job on each `master` push.** Rejected because it spends the slowest platform signals on unrelated feature iterations and presents expected packaging or kernel failures as if they diagnosed the outgoing UI behavior.

## Consequences

Feature iterations are judged by focused behavior tests, snapshots, type checks, and source gates instead of unrelated publication or scarce platform runners. A deferred pack check is green and does not claim that npm artifacts were produced. A skipped Sandbox matrix does not claim that real-kernel confinement passed. See [fork hosted CI](2026-08-15-fork-github-hosted-ci.md) for the pull-request check names.
