import { randomUUID } from 'node:crypto'
import { isQuestionOptional, type UserQuestion } from '../../shared/run.ts'

type QuestionResult = {
  id: string
  questions: UserQuestion['questions']
  answers?: string[]
  withdrawn?: boolean
  rejected?: boolean
}

type PendingQuestion = {
  runId: string
  questions: UserQuestion['questions']
  answer: (answers: string[] | null, rejected?: boolean) => void
}

export class QuestionQueue {
  private pending = new Map<string, PendingQuestion>()

  ask(
    runId: string,
    questions: UserQuestion['questions'],
    signal: AbortSignal,
    emit: (question: UserQuestion | null) => void
  ): Promise<QuestionResult> {
    signal.throwIfAborted()

    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
        emit(null)
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }

      this.pending.set(id, {
        runId,
        questions,
        answer: (answers, rejected) => {
          cleanup()
          resolve({
            id,
            questions,
            ...(answers ? { answers } : { withdrawn: true }),
            ...(rejected ? { rejected: true } : {})
          })
        }
      })
      signal.addEventListener('abort', abort, { once: true })
      emit({ id, questions })
    })
  }

  answer(runId: string, id: string, answers: string[]) {
    const pending = this.pending.get(id)

    if (!pending || pending.runId !== runId) {
      throw new Error('This question is no longer pending, or its answer is invalid.')
    }
    const invalidAnswers = !Array.isArray(answers) || answers.length !== pending.questions.length ||
      answers.some((answer, index) =>
        typeof answer !== 'string' || answer.length > 4000 ||
        (!answer.trim() && !isQuestionOptional(pending.questions[index]))
      )
    if (invalidAnswers) {
      throw new Error('This question is no longer pending, or its answer is invalid.')
    }

    pending.answer(answers.map(answer => answer.trim()))
  }

  reject(runId: string, id: string) {
    const pending = this.pending.get(id)

    if (!pending || pending.runId !== runId) throw new Error('This question is no longer pending.')

    pending.answer(null, true)
  }

  withdraw(runId: string) {
    for (const item of this.pending.values()) {
      if (item.runId === runId) item.answer(null)
    }
  }
}
