import { Context } from '@deepseek-ai/cordis'
import { internals as cmdlineIo, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/startup.ts'

interface Parsed {
  value: unknown
  exits: number[]
  output: string
}

function parse(args: string[]): Parsed {
  const ctx = new Context()
  const exits: number[] = []
  let output = ''
  const capture = { write: (text: string) => { output += text; return true } }
  cmdlineIo.stdout = capture
  cmdlineIo.stderr = capture
  provideCmdline(ctx, { args, exit: code => void exits.push(code) })
  apply(ctx)
  return { value: ctx.get('terminalCliStartup')?.value, exits, output }
}

afterEach(() => {
  cmdlineIo.stdout = process.stdout
  cmdlineIo.stderr = process.stderr
})

describe('terminal CLI startup', () => {
  it('publishes interactive defaults and an initial prompt', () => {
    expect(parse([]).value).toEqual({ mode: 'interactive', prompt: [] })
    expect(parse(['inspect', 'this', 'repo']).value)
      .toEqual({ mode: 'interactive', prompt: ['inspect', 'this', 'repo'] })
  })

  it('normalizes exec flags without resolving stdin during startup', () => {
    expect(parse([
      'exec', '--provider', 'deepseek', '-m', 'deepseek-chat', '--reasoning-effort', 'high',
      '--sandbox', 'workspace-write', '--approval', 'never', '--json', 'run', 'tests',
    ]).value).toEqual({
      mode: 'exec',
      prompt: ['run', 'tests'],
      json: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
      approval: 'never',
    })
  })

  it('publishes exact and latest resume requests', () => {
    expect(parse(['resume', 'session-1', 'continue']).value)
      .toEqual({ mode: 'resume', sessionId: 'session-1', prompt: ['continue'] })
    expect(parse(['resume', '--last']).value)
      .toEqual({ mode: 'resume', prompt: [] })
  })

  it('prints help without publishing a startup value', () => {
    const result = parse(['exec', '--help'])
    expect(result.value).toBeUndefined()
    expect(result.exits).toEqual([0])
    expect(result.output).toContain('Usage: dsh exec')
  })

  it('rejects invalid choices and contradictory resume identity', () => {
    const invalid = parse(['exec', '--sandbox', 'unconfined', 'task'])
    expect(invalid.value).toBeUndefined()
    expect(invalid.exits).toEqual([1])
    expect(invalid.output).toContain('Allowed choices')

    const conflict = parse(['resume', '--last', 'session-1'])
    expect(conflict.value).toBeUndefined()
    expect(conflict.exits).toEqual([1])
    expect(conflict.output).toContain('mutually exclusive')
  })

  it('rejects an empty model-style option before publishing startup state', () => {
    const result = parse(['exec', '--model', '   ', 'task'])
    expect(result.value).toBeUndefined()
    expect(result.exits).toEqual([1])
    expect(result.output).toContain('must not be empty')
  })
})
