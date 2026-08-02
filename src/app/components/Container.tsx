/**
 * Container — max-width gutter wrapper used by every section. Centralized
 * so the global `--nova-container` width + horizontal padding can be tuned
 * in one place.
 */
import type { ReactNode } from 'react'

export function Container({
  children,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'header' | 'footer' | 'main' | 'aside'
}): JSX.Element {
  return <As className={`container ${className}`.trim()}>{children}</As>
}
