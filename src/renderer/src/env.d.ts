import type { GraniteBridge } from '../../shared/chat'

declare global {
  interface Window { granite: GraniteBridge }
}
