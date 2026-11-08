import { contextMetadata, reasoningMetadata } from './catalog.ts'
import type { Connection, ModelOption, Result } from '../../shared/chat'

export function validateConnection(connection: Connection): URL {
  if (
    !connection ||
    typeof connection.baseUrl !== 'string' ||
    typeof connection.apiKey !== 'string' ||
    typeof connection.model !== 'string'
  ) {
    throw new Error('Invalid connection settings.')
  }

  const url = new URL(connection.baseUrl.trim())

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP or HTTPS API base URL without credentials, query parameters, or a fragment.'
    )
  }

  url.pathname = url.pathname.replace(/\/+$/, '') + '/'

  return url
}

async function requestModels(connection: Connection): Promise<any> {
  const base = validateConnection(connection)
  const response = await fetch(new URL('models', base), {
    redirect: 'error',
    headers: {
      ...(connection.apiKey.trim() ? { Authorization: `Bearer ${connection.apiKey.trim()}` } : {})
    },
    signal: AbortSignal.timeout(30_000)
  })

  if (!response.ok) {
    // Don't echo provider responses: they may contain credentials or request content.
    throw new Error(
      `Server returned HTTP ${response.status}. Check the API URL, key, and model access.`
    )
  }

  try {
    return await response.json()
  } catch {
    throw new Error(
      'The server did not return JSON. Check that the URL ends at the API prefix, usually /v1.'
    )
  }
}

export async function safely<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Connection failed.'

    if (message === 'fetch failed') {
      message =
        'Could not reach the server. Check its address, network access, and whether the model server is running.'
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      message = 'The server timed out. Check that the model is loaded and try again.'
    }

    return { ok: false, error: message }
  }
}

export async function listModelCatalog(connection: Connection): Promise<ModelOption[]> {
  const data = await requestModels(connection)
  if (!Array.isArray(data.data)) {
    throw new Error('The server returned an unexpected model list.')
  }
  return data.data.flatMap((model: any) =>
    typeof model?.id === 'string'
      ? [{ id: model.id, name: model.id, ...reasoningMetadata(model), ...contextMetadata(model) }]
      : []
  )
}

export async function listModels(connection: Connection): Promise<string[]> {
  return (await listModelCatalog(connection)).map(model => model.id)
}
