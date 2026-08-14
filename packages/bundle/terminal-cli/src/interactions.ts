/** Serialized terminal implementations of approvals and ask-user questions. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { CliOutput } from './io.ts'
import { LineInput, sanitizeTerminal } from './io.ts'

/** Render one question and parse its numbered/label/free-text answer. */
async function askOne(
  input: LineInput,
  output: CliOutput,
  question: AskUserQuestionItem,
  signal?: AbortSignal,
): Promise<AskUserQuestionAnswer['answers'][number]> {
  const heading = question.header === undefined ? '' : `${sanitizeTerminal(question.header)}\n`
  output.write(`\n${heading}${sanitizeTerminal(question.question)}\n`)
  if (question.detail !== undefined) output.write(`${sanitizeTerminal(question.detail)}\n`)
  const options = question.options ?? []
  options.forEach((option, index) => {
    output.write(`  ${index + 1}. ${sanitizeTerminal(option.label)}${option.description === undefined ? '' : ` — ${sanitizeTerminal(option.description)}`}\n`)
  })
  const suffix = options.length === 0
    ? '> '
    : question.multiSelect === true ? 'Select comma-separated numbers or type an answer: ' : 'Select a number or type an answer: '
  const line = await input.read(suffix, signal)
  if (line === undefined) {
    throw new UserQuestionError('terminal input closed before the question was answered', 'ASK_ABORTED')
  }
  const tokens = question.multiSelect === true ? line.split(',').map(value => value.trim()).filter(Boolean) : [line.trim()]
  const selected: string[] = []
  const custom: string[] = []
  for (const token of tokens) {
    const numeric = /^\d+$/u.test(token) ? Number(token) : undefined
    const match = numeric === undefined
      ? options.find(option => option.label.toLocaleLowerCase() === token.toLocaleLowerCase())
      : options[numeric - 1]
    if (match === undefined) {
      if (token !== '') custom.push(token)
    } else if (!selected.includes(match.label)) {
      selected.push(match.label)
    }
  }
  return {
    id: question.id,
    selected,
    ...custom.length === 0 ? {} : { custom: custom.join(', ') },
  }
}

/**
 * Register the one terminal interaction provider and approval answerer.
 * @param ctx - application context carrying question and approval registries.
 * @param agent - exact root Agent allowed to own terminal interactions.
 * @param input - serialized line-input owner shared by both interaction kinds.
 * @param output - terminal stream that receives questions and choices.
 * @returns a disposer that removes both registrations.
 */
export function installTerminalInteractions(
  ctx: Context,
  agent: Agent,
  input: LineInput,
  output: CliOutput,
): () => void {
  const disposeQuestions = ctx.userQuestions.registerProvider({
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      if (request.agent !== undefined && request.agent !== agent) {
        throw new UserQuestionError('terminal interaction is available only to the root terminal Agent', 'DELEGATED_CALLER')
      }
      const answers = []
      for (const question of request.questions) {
        answers.push(await askOne(input, output, question, request.signal))
      }
      return { answers }
    },
  })

  const disposeApproval = ctx.on('approval/request', async (request: ApprovalRequest, next): Promise<ApprovalOutcome> => {
    if (request.agent !== agent) return await next()
    output.write(`\nApproval requested by ${sanitizeTerminal(request.toolName)}${request.reason === undefined ? '' : `: ${sanitizeTerminal(request.reason)}`}\n`)
    let line: string | undefined
    try {
      line = await input.read('Allow once? [y/N] ', request.signal)
    } catch {
      return 'cancelled'
    }
    if (line === undefined) return 'rejected'
    return /^(?:y|yes)$/iu.test(line.trim()) ? 'allowed-once' : 'rejected'
  })

  return () => {
    disposeApproval()
    disposeQuestions()
  }
}
