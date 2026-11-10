import { flushSync } from 'react-dom'

export type TransitionMode = 'regions' | 'groups' | 'tabs'

type ViewTransitionScope = Element & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransition
}

const activeTransitions = new WeakMap<Element, ViewTransition>()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Scope view transitions to a specific container so neighboring chrome stays interactive.
export function runScopedTransition(scope: Element | null, mode: TransitionMode, update: () => void) {
  const target = scope as ViewTransitionScope | null
  if (!target || prefersReducedMotion() || typeof target.startViewTransition !== 'function') {
    update()
    return
  }

  target.setAttribute('data-transition', mode)
  const transition = target.startViewTransition(() => {
    flushSync(update)
  })
  activeTransitions.set(target, transition)
  transition.ready.catch(() => {})
  transition.finished.catch(() => {}).finally(() => {
    if (activeTransitions.get(target) === transition) target.removeAttribute('data-transition')
  })
}
