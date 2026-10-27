import { useState } from 'react'
import type { UserQuestion } from '../../../../shared/run'

export default function QuestionPrompt({ question, onAnswer, onStop }: {
  question: UserQuestion; onAnswer: (answers: string[]) => Promise<boolean>; onStop: () => Promise<void>
}) {
  const [answers, setAnswers] = useState<string[]>(question.questions.map(() => ''))
  const [sending, setSending] = useState(false)
  return <form className="question-panel" aria-label="Agent question" onSubmit={event => {
    event.preventDefault(); setSending(true)
    void onAnswer(answers).finally(() => setSending(false))
  }}>
    {question.questions.map((item, index) => <fieldset key={index} disabled={sending}>
      <legend>{item.title}</legend>
      {item.options && <div className="question-options">{item.options.map(option => <button key={option} type="button" aria-pressed={answers[index] === option}
        onClick={() => setAnswers(previous => previous.map((answer, at) => at === index ? option : answer))}>{option}</button>)}</div>}
      <label>Your answer<input aria-label={`Answer ${index + 1}`} maxLength={4000} value={answers[index]} onChange={event => setAnswers(previous => previous.map((answer, at) => at === index ? event.target.value : answer))} /></label>
    </fieldset>)}
    <div className="question-actions"><button type="button" disabled={sending} onClick={() => void onStop()}>Stop task</button><button type="submit" disabled={sending || answers.some(answer => !answer.trim())}>{sending ? 'Sending…' : 'Send answer'}</button></div>
  </form>
}
