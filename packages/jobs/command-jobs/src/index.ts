/**
 * Human-facing `/ps` and `/stop` commands over the background-job registry.
 * @module @deepseek-ai/dsh-command-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'

export const name = 'command-jobs'
export const inject = ['commands', 'jobs']

const PS_USAGE = 'Usage: /ps (no arguments)'
const STOP_USAGE = 'Usage: /stop (no arguments)'
const STOP_REASON = 'Stopped by /stop.'
const MAX_LABEL_CODE_POINTS = 80

/** Return whether a job still owns live producer work. */
function isActive(job: JobSnapshot): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Render one bounded, single-line job label for a human command result. */
function labelSummary(label: string): string {
  const [firstLine = ''] = label.split(/\r?\n|\r/u, 1)
  const points = Array.from(firstLine)
  const truncated = points.length > MAX_LABEL_CODE_POINTS || /[\r\n]/u.test(label)
  const head = points.slice(0, MAX_LABEL_CODE_POINTS).join('')
  return `${head}${truncated ? ' […]' : ''}`
}

/** Render owner-visible live jobs without consuming their output. */
function renderActiveJobs(jobs: readonly JobSnapshot[]): string {
  const active = jobs.filter(isActive)
  if (active.length === 0) return 'Background jobs\n\n  • No background jobs running.'
  return [
    'Background jobs',
    '',
    ...active.map(job => `  • ${job.id} [${job.kind}] ${job.status} — ${labelSummary(job.label)}`),
  ].join('\n')
}

/** Execute one argument-free `/ps` request. */
function executePs(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: PS_USAGE }
  return { kind: 'success', text: renderActiveJobs(ctx.jobs.list(invocation.agent)) }
}

/** Render an arbitrary cancellation failure without trusting object coercion. */
function cancellationFailure(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown cancellation failure'
}

/** Execute one argument-free `/stop` request against every running visible job. */
function executeStop(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: STOP_USAGE }
  const running = ctx.jobs.list(invocation.agent).filter(job => job.status === 'running')
  if (running.length === 0) return { kind: 'success', text: 'No running background jobs to stop.' }

  let requested = 0
  const failures: string[] = []
  for (const job of running) {
    try {
      if (ctx.jobs.kill(job.id, invocation.agent, STOP_REASON) === 'requested') requested += 1
    } catch (error: unknown) {
      failures.push(`${job.id}: ${cancellationFailure(error)}`)
    }
  }
  const noun = requested === 1 ? 'job' : 'jobs'
  const summary = `Requested cancellation for ${String(requested)} background ${noun}.`
  if (failures.length === 0) return { kind: 'success', text: summary }
  return {
    kind: 'error',
    text: `${summary}\nFailed to stop ${String(failures.length)}: ${failures.join('; ')}`,
  }
}

/**
 * Register the background-job commands and their owner-scoped controller.
 * @param ctx - context carrying the command and job registries.
 */
export function apply(ctx: Context): void {
  ctx.jobs.attachController('command-jobs')
  ctx.commands.register({
    name: 'ps',
    description: 'List running background jobs',
    handler: invocation => executePs(ctx, invocation),
  })
  ctx.commands.register({
    name: 'stop',
    description: 'Stop all running background jobs',
    handler: invocation => executeStop(ctx, invocation),
  })
}
