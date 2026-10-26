import { randomUUID } from 'node:crypto'
import type { ApprovalRequest } from '../../shared/harness.ts'

export class ApprovalQueue {
  private pending = new Map<string, { requestId: string; agentId: string; resolve: (allow: boolean) => void }>()

  ask(
    request: Omit<ApprovalRequest, 'id'>,
    signal: AbortSignal,
    emit: (request: ApprovalRequest | null) => void
  ): Promise<boolean> {
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
        requestId: request.requestId,
        agentId: request.agentId,
        resolve: allow => {
          cleanup()
          resolve(allow)
        }
      })
      signal.addEventListener('abort', abort, { once: true })
      emit({ ...request, id })
    })
  }

  answer(requestId: string, id: string, allow: boolean) {
    const pending = this.pending.get(id)

    if (!pending || pending.requestId !== requestId || typeof allow !== 'boolean') {
      throw new Error('This approval is no longer pending.')
    }

    pending.resolve(allow)
  }

  withdraw(requestId: string) {
    for (const pending of this.pending.values()) {
      if (pending.requestId === requestId) pending.resolve(false)
    }
  }

  invalidateAgent(agentId: string) {
    for (const pending of this.pending.values()) {
      if (pending.agentId === agentId) pending.resolve(false)
    }
  }
}
