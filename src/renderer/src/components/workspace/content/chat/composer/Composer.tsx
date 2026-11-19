import { useRef } from 'react'
import type { Agent, AgentMessage } from '../../../../../../../shared/agent'
import type { SavedConnection } from '../../../../../../../shared/chat'
import type { RunSnapshot } from '../../../../../../../shared/run'
import { attachmentAccept, type ChatAttachment } from '../attachments'
import ChatModelPicker from './ChatModelPicker'
import ContextIndicator from './ContextIndicator'
import { latestContextResponse } from './context-display'
import type { ModelSelection } from './useConnectionModel'
import type { useAttachmentPicker } from './useAttachmentPicker'

interface ComposerProps {
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  modelSelection: ModelSelection
  messages: AgentMessage[]
  draft: string
  attachments: ChatAttachment[]
  attachmentPicker: ReturnType<typeof useAttachmentPicker>
  onAttachmentsChange: (files: ChatAttachment[]) => void
  busy: boolean
  loaded: boolean
  submitting: boolean
  stopping: boolean
  run?: RunSnapshot
  progress: string
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function Composer({
  agent, connections, connection, modelSelection, messages, draft, attachments, attachmentPicker,
  busy, loaded, submitting, stopping, run, progress,
  onSelectConnection, onOpenSettings, onDraftChange, onAttachmentsChange, onSend, onStop
}: ComposerProps) {
  const contextResponse = latestContextResponse(messages, modelSelection.model)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachmentDisabled = !agent || !loaded || submitting || attachmentPicker.reading
  const status = busy ? progress : 'Enter to send · Shift + Enter for a new line'

  return (
    <form
      className={`composer ${busy ? 'generating' : ''}`}
      onSubmit={event => {
        event.preventDefault()
        if (!attachmentPicker.reading) void onSend()
      }}
    >
      <div className="composer-prompt-header" aria-hidden="true">
        <span className="composer-prompt-icon">✦</span>
        <span className="composer-prompt-host">archon:~$</span>
      </div>

      {attachments.length > 0 && (
        <ul className="composer-attachments" aria-label="Draft attachments">
          {attachments.map(file => (
            <li key={file.id} className="composer-attachment" title={file.name}>
              {file.dataUrl && <img src={file.dataUrl} alt="" />}

              <span>
                {file.name}
              </span>

              <button type="button" className="quiet-button" aria-label={`Remove ${file.name}`}
                disabled={attachmentDisabled} onClick={() => onAttachmentsChange(attachments.filter(item => item.id !== file.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        aria-label="Message"
        value={draft}
        disabled={submitting || !agent || !loaded}
        placeholder={`Message ${agent?.name ?? 'your agent'}…`}
        rows={2}
        onChange={event => onDraftChange(event.target.value)}
        onPaste={event => {
          if (attachmentDisabled) return
          const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
          if (!images.length) return

          if (!event.clipboardData.getData('text/plain')) event.preventDefault()
          void attachmentPicker.attach(images)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()

            if (!submitting && !attachmentPicker.reading) {
              void onSend()
            }
          }
        }}
      />

      <input ref={fileInput} type="file" accept={attachmentAccept(window.granite.platform)} multiple hidden disabled={attachmentDisabled}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          void attachmentPicker.attach(files)
        }} />

      {attachmentPicker.error && (
        <p className="activity-error" role="alert">
          {attachmentPicker.error}
        </p>
      )}

      <div className="composer-controls">
        <button type="button" className="composer-attach quiet-button" aria-label="Attach files"
          title={window.granite.platform === 'darwin' ? 'Attach PDFs, images, text, or code files' : 'Attach images, text, or code files'}
          disabled={attachmentDisabled}
          onClick={() => fileInput.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <span className="composer-status">
          {attachmentPicker.reading ? 'Reading files…' : status}
        </span>

        <div className="composer-actions">
          <ContextIndicator
            status={run?.context ?? contextResponse?.contextStatus}
            usage={contextResponse?.contextUsage}
            loading={!loaded || modelSelection.contextLoading}
            hasResponse={Boolean(contextResponse)}
            limit={modelSelection.contextWindow}
            maxOutput={modelSelection.maxOutputTokens}
          />
          {connections.length ? (
            <ChatModelPicker
              connections={connections}
              connection={connection}
              selection={modelSelection}
              disabled={busy || !loaded}
              onSelectConnection={onSelectConnection}
            />
          ) : (
            <button
              type="button"
              className="model-connect quiet-button"
              disabled={busy || !loaded}
              onClick={onOpenSettings}
            >
              Connect model
            </button>
          )}

          {busy && (
            <button
              type="button"
              className="stop-button"
              disabled={stopping}
              onClick={() => void onStop()}
            >
              ■ {stopping ? 'Stopping…' : run?.startedAt === null ? 'Cancel queued' : 'Stop'}
            </button>
          )}

          <button
            type="submit"
            className="send-button"
            aria-label={busy ? 'Send update' : 'Send message'}
            title={busy ? 'Send a message to steer this run' : 'Send message'}
            disabled={attachmentDisabled || (!draft.trim() && !attachments.length)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  )
}
