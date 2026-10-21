import { useEffect, useState } from 'react'
import type { ModelOption, SavedConnection } from '../../../../shared/chat'

export function useConnectionModel(connection: SavedConnection | undefined, lockedModel?: string, conversationId = '', savedEffort?: string) {
  const [effortChoice, setEffortChoice] = useState<{ key: string; value: string }>()
  const effortKey = conversationId || connection?.id || ''
  const effort = effortChoice?.key === effortKey ? effortChoice.value : savedEffort ?? connection?.effort ?? ''
  const [catalog, setCatalog] = useState<{
    connectionId: string
    models: ModelOption[]
    model: string
    loading: boolean
    error: string
  }>({ connectionId: '', models: [], model: '', loading: false, error: '' })
  const accountConnection = connection?.provider === 'chatgpt'

  useEffect(() => {
    if (!connection) {
      return
    }

    let current = true
    const selected = connection
    setCatalog({ connectionId: selected.id, models: [], model: '', loading: true, error: '' })

    void window.granite.connections.models(selected.id)
      .then(result => {
        if (!current) {
          return
        }

        if (!result.ok) {
          throw new Error(result.error)
        }

        const remembered = localStorage.getItem(`granite.model.${selected.id}`)
        const model =
          [remembered, selected.model, result.value[0]?.id].find(id =>
            result.value.some(item => item.id === id)
          ) ?? ''
        setCatalog({
          connectionId: selected.id,
          models: result.value,
          model,
          loading: false,
          error: model ? '' : 'No models are available for this account.'
        })
      })
      .catch(error => {
        if (current) {
          setCatalog({
            connectionId: selected.id,
            models: [],
            model: '',
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load account models.'
          })
        }
      })

    return () => {
      current = false
    }
  }, [connection?.id, connection?.accountId, connection?.model, accountConnection])

  useEffect(() => {
    const refreshed = (event: Event) => {
      const { connectionId, models } = (event as CustomEvent<{ connectionId: string; models: ModelOption[] }>).detail
      if (connectionId !== connection?.id) return
      setCatalog(current => ({
        connectionId,
        models,
        model: lockedModel || (models.some(item => item.id === current.model) ? current.model : models[0]?.id ?? ''),
        loading: false,
        error: models.length ? '' : 'No models are available for this connection.'
      }))
    }
    window.addEventListener('granite:models-refreshed', refreshed)
    return () => window.removeEventListener('granite:models-refreshed', refreshed)
  }, [connection?.id, lockedModel])

  const matches = catalog.connectionId === connection?.id
  const model = lockedModel ?? (accountConnection ? (matches ? catalog.model : '') : connection?.model ?? '')
  const loading = accountConnection && (!matches || catalog.loading)

  return {
    model,
    locked: Boolean(lockedModel),
    effort,
    reasoningLevels: matches ? catalog.models.find(item => item.id === model)?.reasoningLevels ?? [] : [],
    defaultReasoningLevel: matches ? catalog.models.find(item => item.id === model)?.defaultReasoningLevel : undefined,
    selectEffort(value: string) {
      setEffortChoice({ key: effortKey, value })
    },
    models: accountConnection && matches ? catalog.models : [],
    loading,
    ready: Boolean(connection && model && !loading),
    error: accountConnection && matches ? catalog.error : '',
    select(model: string) {
      if (lockedModel || !connection || !matches || !catalog.models.some(item => item.id === model)) {
        return
      }

      localStorage.setItem(`granite.model.${connection.id}`, model)
      setCatalog(current => ({ ...current, model }))
    },
  }
}

export type ModelSelection = ReturnType<typeof useConnectionModel>
