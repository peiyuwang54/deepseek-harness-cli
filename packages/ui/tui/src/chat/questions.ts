/**
 * Ask-user-question sub-machine for the interactive chat channel. Registers the
 * user-questions provider, presents one question overlay at a time in FIFO
 * order, and settles each request on answer, abort, overlay error, or channel
 * shutdown.
 * @module @deepseek-ai/dsh-tui/chat/questions
 */

import { errorChain } from '@deepseek-ai/dsh-llm'
import {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionAnswerItem,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { TuiOverlaySession } from '../extension/types.ts'
import { QuestionDialog } from '../components/dialogs.ts'
import type { ChatChannelDeps } from './channel.ts'

/** One queued or active ask-user-question request and its running answers. */
interface PendingQuestion {
  request: AskUserQuestionRequest
  index: number
  answers: AskUserQuestionAnswerItem[]
  resolve(answer: AskUserQuestionAnswer): void
  reject(error: unknown): void
  onAbort: () => void
  overlay: TuiOverlaySession | undefined
}

/** Collaborators the question queue needs from the chat channel. */
export interface QuestionQueueDeps extends ChatChannelDeps {
  /** Current row budget after reserving the editor. */
  questionMaxHeight(): number
}

/** Ask-user-question controller for one chat channel. */
export interface QuestionQueue {
  /** Reject the active and all queued questions (shutdown). */
  rejectAll(): void
  /** Remove the user-questions provider registration. */
  unregister(): void
}

/**
 * Build the ask-user-question queue for one chat channel.
 * @param deps - channel collaborators and overlay host.
 * @returns the controller used at shutdown to drain and unregister.
 */
export function createQuestionQueue(deps: QuestionQueueDeps): QuestionQueue {
  const { ctx, resolved, palette, overlayManager } = deps
  const questionQueue: PendingQuestion[] = []
  let activeQuestion: PendingQuestion | undefined

  const removeAbortListener = (pending: PendingQuestion): void => {
    pending.request.signal?.removeEventListener('abort', pending.onAbort)
  }

  const rejectQuestion = (pending: PendingQuestion): void => {
    void pending.overlay?.close()
    pending.overlay = undefined
    removeAbortListener(pending)
    pending.reject(new UserQuestionError(
      'ask_user_question was interrupted before the user answered',
      'ASK_ABORTED',
    ))
  }

  const startNextQuestion = (): void => {
    if (activeQuestion !== undefined || deps.isDisposed()) return
    const pending = questionQueue.shift()
    if (pending === undefined) return
    activeQuestion = pending
    const show = (): void => {
      const question = pending.request.questions[pending.index]
      if (question === undefined) {
        activeQuestion = undefined
        removeAbortListener(pending)
        pending.resolve({ answers: pending.answers })
        startNextQuestion()
        return
      }
      const session = overlayManager.open({
        ...pending.request.signal === undefined ? {} : { signal: pending.request.signal },
        create: () => new QuestionDialog(
          question,
          pending.index + 1,
          pending.request.questions.length,
          pending.request.questions.length - pending.answers.length,
          resolved.maxQuestionOptions,
          () => deps.questionMaxHeight(),
          palette,
          (selection) => {
            pending.overlay = undefined
            void session.close()
            pending.answers.push({ id: question.id, ...selection })
            pending.index += 1
            show()
          },
          () => {
            activeQuestion = undefined
            rejectQuestion(pending)
            startNextQuestion()
          },
        ),
        options: {
          width: resolved.questionDialogWidth,
          maxHeight: resolved.questionDialogMaxHeight,
        },
      }, 'inline')
      pending.overlay = session
      void session.closed.then((result) => {
        if (pending.overlay !== session) return
        pending.overlay = undefined
        /* v8 ignore next 2 -- close, abort, and shutdown settle the owner before this callback */
        if (result.reason !== 'error') return
        activeQuestion = undefined
        removeAbortListener(pending)
        pending.reject(new UserQuestionError(
          `ask_user_question TUI failed: ${errorChain(result.error)}`,
          'ASK_ABORTED',
        ))
        startNextQuestion()
      })
      deps.requestRender()
    }
    show()
  }

  const unregister = ctx.userQuestions.registerProvider({
    ask(request) {
      return new Promise<AskUserQuestionAnswer>((resolveAnswer, reject) => {
        const pending: PendingQuestion = {
          request,
          index: 0,
          answers: [],
          resolve: resolveAnswer,
          reject,
          overlay: undefined,
          onAbort: () => {
            if (activeQuestion === pending) {
              activeQuestion = undefined
              rejectQuestion(pending)
              startNextQuestion()
              return
            }
            // A non-active pending ask remains in the queue until this listener settles it.
            questionQueue.splice(questionQueue.indexOf(pending), 1)
            rejectQuestion(pending)
          },
        }
        request.signal?.addEventListener('abort', pending.onAbort, { once: true })
        questionQueue.push(pending)
        startNextQuestion()
      })
    },
  })

  return {
    rejectAll(): void {
      if (activeQuestion !== undefined) {
        const pending = activeQuestion
        activeQuestion = undefined
        rejectQuestion(pending)
      }
      for (const pending of questionQueue.splice(0)) rejectQuestion(pending)
    },
    unregister,
  }
}
