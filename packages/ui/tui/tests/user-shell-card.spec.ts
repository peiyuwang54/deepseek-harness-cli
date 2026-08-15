import { describe, expect, it } from 'vitest'
import { UserShellCommandComponent } from '../src/components/transcript.ts'
import { createPalette } from '../src/components/theme.ts'
import type { UserShellResult } from '../src/chat/user-shell.ts'

const palette = createPalette(false)

const outcome = (overrides: Partial<UserShellResult> = {}): UserShellResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  stdout: { text: '', truncated: false },
  stderr: { text: '', truncated: false },
  ...overrides,
})

describe('UserShellCommandComponent', () => {
  it('renders running, interrupted, expanded, collapsed, and hidden states', () => {
    const running = new UserShellCommandComponent('printf one\\ntwo', '/workspace', 2, palette, true)
    expect(running.render(80).join('\n')).toContain('○ Shell')
    expect(running.render(80).join('\n')).toContain('$ printf one\\ntwo')

    const interrupted = new UserShellCommandComponent('sleep 10', '/workspace', 5, palette, false)
    expect(interrupted.render(80).join('\n')).toContain('Interrupted before a result was recorded.')
    interrupted.setVisibility('hidden')
    expect(interrupted.render(80)).toEqual([])

    running.settle(outcome({
      stdout: { text: 'one\ntwo\nthree', truncated: true },
      stderr: { text: 'warning', truncated: true },
    }))
    const collapsed = running.render(80).join('\n')
    expect(collapsed).toContain('● Shell')
    expect(collapsed).toContain('… +')
    running.setVisibility('expanded')
    const expanded = running.render(80).join('\n')
    expect(expanded).toContain('stderr:')
    expect(expanded).toContain('warning')
    expect(expanded).toContain('[stdout truncated]')
    expect(expanded).toContain('[stderr truncated]')
    expect(expanded).toContain('[exit 0]')
  })

  it.each([
    [outcome({ timedOut: true }), '[timed out]'],
    [outcome({ aborted: true }), '[cancelled]'],
    [outcome({ signal: 'SIGTERM' }), '[signal SIGTERM]'],
    [outcome({ exitCode: null }), '[exit unknown]'],
    [outcome({ sandbox: { mode: 'read-only', denied: true } }), '[sandbox denied under read-only]'],
    [outcome({ sandbox: { mode: 'workspace-write', denied: false, runnerFailed: true } }), '[sandbox runner failed under workspace-write]'],
  ])('renders settled failure detail %#', (result, marker) => {
    const card = new UserShellCommandComponent('command', '/workspace', 20, palette, true)
    card.setVisibility('expanded')
    card.settle(result)
    expect(card.render(80).join('\n')).toContain(marker)
  })
})
