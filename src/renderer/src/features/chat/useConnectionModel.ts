import { useEffect, useState } from 'react'
import type { ModelOption, SavedConnection } from '../../../../shared/chat'

export function useConnectionModel(connection: SavedConnection | undefined) {
  const [revision, setRevision] = useState(0)
  const [catalog, setCatalog] = useState<{
    connectionId: string
    models: ModelOption[]
    model: string
    loading: boolean
    error: string
  }>({ connectionId: '', models: [], model: '', loading: false, error: '' })
  const accountConnection = connection?.provider === 'chatgpt'

  useEffect(() => {
    if (!connection || !accountConnection) {
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
  }, [connection?.id, connection?.accountId, connection?.model, accountConnection, revision])

  const matches = catalog.connectionId === connection?.id
  const model = accountConnection ? (matches ? catalog.model : '') : connection?.model ?? ''
  const loading = accountConnection && (!matches || catalog.loading)

  return {
    model,
    models: accountConnection && matches ? catalog.models : [],
    loading,
    ready: Boolean(connection && model && !loading),
    error: accountConnection && matches ? catalog.error : '',
    select(model: string) {
      if (!connection || !matches || !catalog.models.some(item => item.id === model)) {
        return
      }

      localStorage.setItem(`granite.model.${connection.id}`, model)
      setCatalog(current => ({ ...current, model }))
    },
    refresh() {
      setRevision(current => current + 1)
    }
  }
}

export type ModelSelection = ReturnType<typeof useConnectionModel>
