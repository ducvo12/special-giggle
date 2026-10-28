import { useId, useRef, useState } from 'react'
import { isQuestionOptional, type UserQuestion } from '../../../../shared/run'
import PromptChoices from './PromptChoices'

export default function QuestionPrompt({ question, onAnswer, onReject, autoFocus = true }: {
  question: UserQuestion; onAnswer: (answers: string[]) => Promise<boolean>
  onReject: () => Promise<boolean>; autoFocus?: boolean
}) {
  const titleId = useId()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>(question.questions.map(() => ''))
  const [custom, setCustom] = useState('')
  const [sending, setSending] = useState(false)
  const [finished, setFinished] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const item = question.questions[index]
  if (!item) return null
  const optional = isQuestionOptional(item)
  async function choose(value: string) {
    if (pending.current || !value.trim() && !optional) return
    const next = answers.map((answer, at) => at === index ? value.trim() : answer)
    setAnswers(next); setError('')
    if (index < question.questions.length - 1) { setIndex(index + 1); setCustom(''); return }
    pending.current = true; setSending(true)
    try {
      if (await onAnswer(next)) setFinished('Answer sent.')
      else setError('Could not send your answer. Try again.')
    } catch { setError('Could not send your answer. Try again.') }
    finally { pending.current = false; setSending(false) }
  }
  async function reject() {
    if (pending.current) return
    pending.current = true; setSending(true); setError('')
    try {
      if (await onReject()) setFinished('Question rejected.')
      else setError('Could not reject this question. Try again.')
    } catch { setError('Could not reject this question. Try again.') }
    finally { pending.current = false; setSending(false) }
  }
  return <section className="question-panel" aria-labelledby={titleId} aria-busy={sending}>
    {finished ? <p id={titleId} className="prompt-feedback" role="status">{finished}</p> : <>
      {question.questions.length > 1 && <p className="question-progress" aria-live="polite">Question {index + 1} of {question.questions.length}</p>}
      <h2 id={titleId} className="prompt-title">{item.title}</h2>
      <PromptChoices key={index} label={item.title} options={item.options ?? []} disabled={sending} autoFocus={autoFocus || index > 0}
        onChoose={at => void choose(item.options![at])} custom={{ value: custom, optional, onChange: setCustom, onSubmit: () => void choose(custom) }} />
      {error && <p className="prompt-error" role="alert">{error}</p>}
      <div className="question-actions">
        <span className="prompt-key-hint">{sending ? 'Sending…' : item.options?.length ? '↑ ↓ to choose · Enter to submit' : optional ? 'Enter to submit or skip' : 'Enter to submit'}</span>
        {index > 0 && <button type="button" className="prompt-text-action" disabled={sending} onClick={() => { setIndex(index - 1); setCustom(''); setError('') }}>Back</button>}
        <button type="button" className="prompt-text-action" disabled={sending} onClick={() => void reject()}>Reject</button>
      </div>
    </>}
  </section>
}
