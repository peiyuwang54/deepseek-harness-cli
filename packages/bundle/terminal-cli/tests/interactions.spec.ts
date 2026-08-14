import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { installTerminalInteractions } from '../src/interactions.ts'
import type { CliOutput } from '../src/io.ts'
import { LineInput } from '../src/io.ts'

function output(): { stream: CliOutput; text(): string } {
  let written = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written += String(chunk)
      callback()
    },
  }) as CliOutput
  return { stream, text: () => written }
}

function input(...answers: Array<string | undefined | Error>): {
  lineInput: LineInput
  read: ReturnType<typeof vi.fn>
} {
  const pending = [...answers]
  const read = vi.fn(async () => {
    const answer = pending.shift()
    if (answer instanceof Error) throw answer
    return answer
  })
  return { lineInput: { read } as unknown as LineInput, read }
}

function agent(id: string): Agent {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return { id: session.id, session } as Agent
}

async function mounted(): Promise<{ ctx: Context; root: Agent }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(ApprovalService)
  const root = agent('terminal-root')
  ctx.agents.register(root)
  return { ctx, root }
}

describe('terminal interactions', () => {
  it('renders question context and parses numeric, label, custom, and free-text answers', async () => {
    const { ctx, root } = await mounted()
    const scripted = input('2, FIRST, something else, first', 'plain answer')
    const rendered = output()
    const controller = new AbortController()
    installTerminalInteractions(ctx, root, scripted.lineInput, rendered.stream)

    const result = await ctx.userQuestions.ask({
      questions: [
        {
          id: 'choices',
          header: 'Pick\u001b[31m',
          question: 'Which\u0000 ones?',
          detail: 'Choose carefully',
          multiSelect: true,
          options: [
            { label: 'First', description: 'the first choice' },
            { label: 'Second' },
          ],
        },
        { id: 'free', question: 'Explain' },
      ],
      signal: controller.signal,
    })

    expect(result).toEqual({
      answers: [
        { id: 'choices', selected: ['Second', 'First'], custom: 'something else' },
        { id: 'free', selected: [], custom: 'plain answer' },
      ],
    })
    expect(rendered.text()).toBe(
      '\nPick[31m\nWhich ones?\nChoose carefully\n'
      + '  1. First — the first choice\n'
      + '  2. Second\n'
      + '\nExplain\n',
    )
    expect(scripted.read).toHaveBeenNthCalledWith(
      1,
      'Select comma-separated numbers or type an answer: ',
      controller.signal,
    )
    expect(scripted.read).toHaveBeenNthCalledWith(2, '> ', controller.signal)
    await ctx.fiber.dispose()
  })

  it('returns an empty structured answer for blank input and reports closed input as aborted', async () => {
    const { ctx, root } = await mounted()
    const scripted = input('', undefined)
    const rendered = output()
    installTerminalInteractions(ctx, root, scripted.lineInput, rendered.stream)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'blank', question: 'Optional?', options: [{ label: 'Yes' }] }],
    })).resolves.toEqual({ answers: [{ id: 'blank', selected: [] }] })
    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'closed', question: 'Still there?' }],
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_ABORTED' })

    await ctx.fiber.dispose()
  })

  it('accepts questions only for its exact root Agent', async () => {
    const { ctx, root } = await mounted()
    const foreign = agent('foreign-root')
    ctx.agents.register(foreign)
    const scripted = input('yes')
    const rendered = output()
    installTerminalInteractions(ctx, root, scripted.lineInput, rendered.stream)

    await expect(ctx.userQuestions.ask({
      agent: root,
      questions: [{ id: 'own', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    })).resolves.toEqual({ answers: [{ id: 'own', selected: ['Yes'] }] })
    await expect(ctx.userQuestions.ask({
      agent: foreign,
      questions: [{ id: 'foreign', question: 'Proceed?' }],
    })).rejects.toMatchObject({
      code: 'DELEGATED_CALLER',
      message: 'terminal interaction is available only to the root terminal Agent',
    })
    expect(scripted.read).toHaveBeenCalledTimes(1)

    await ctx.fiber.dispose()
  })

  it('maps approval input to allowed, rejected, and cancelled outcomes and delegates foreign requests', async () => {
    const { ctx, root } = await mounted()
    const foreign = agent('approval-foreign')
    const scripted = input(' YES ', 'no', undefined, new Error('question aborted'))
    const rendered = output()
    installTerminalInteractions(ctx, root, scripted.lineInput, rendered.stream)

    await expect(ctx.approval.request({
      agent: root,
      toolName: 'bash\u001b[2J',
      reason: 'write\u0000 access',
    })).resolves.toBe('allowed-once')
    await expect(ctx.approval.request({ agent: root, toolName: 'edit' })).resolves.toBe('rejected')
    await expect(ctx.approval.request({ agent: root, toolName: 'read' })).resolves.toBe('rejected')
    await expect(ctx.approval.request({ agent: root, toolName: 'write' })).resolves.toBe('cancelled')
    await expect(ctx.approval.request({ agent: foreign, toolName: 'foreign' })).resolves.toBe('unavailable')

    expect(rendered.text()).toBe(
      '\nApproval requested by bash[2J: write access\n'
      + '\nApproval requested by edit\n'
      + '\nApproval requested by read\n'
      + '\nApproval requested by write\n',
    )
    expect(scripted.read).toHaveBeenCalledTimes(4)
    for (let index = 1; index <= 4; index += 1) {
      expect(scripted.read).toHaveBeenNthCalledWith(index, 'Allow once? [y/N] ', undefined)
    }
    await ctx.fiber.dispose()
  })

  it('unregisters both interaction contributions together', async () => {
    const { ctx, root } = await mounted()
    const scripted = input('yes')
    const rendered = output()
    const dispose = installTerminalInteractions(ctx, root, scripted.lineInput, rendered.stream)

    dispose()

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'gone', question: 'Proceed?' }],
    })).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await expect(ctx.approval.request({ agent: root, toolName: 'bash' })).resolves.toBe('unavailable')
    expect(scripted.read).not.toHaveBeenCalled()
    expect(rendered.text()).toBe('')
    await ctx.fiber.dispose()
  })
})
