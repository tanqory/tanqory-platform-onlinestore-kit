/**
 * Link — anchor wrapper. Today it's just an `<a>`; when theme-kit gains
 * client-side routing this is the one place to swap in router-aware
 * navigation (prefetch, soft-nav) without touching every section.
 *
 * Sections should call <Link href={…}> instead of raw <a href={…}> so the
 * upgrade is non-breaking.
 */
import type { ReactNode } from 'react'

export function Link({
  href,
  children,
  className,
  target,
  rel,
  prefetch: _prefetch = false,
  ariaLabel,
}: {
  href?: string | null
  children: ReactNode
  className?: string
  target?: '_blank' | '_self'
  rel?: string
  prefetch?: boolean
  ariaLabel?: string
}): JSX.Element {
  const safeHref = href || '#'
  const computedRel = target === '_blank' ? rel ?? 'noopener noreferrer' : rel
  return (
    <a href={safeHref} className={className} target={target} rel={computedRel} aria-label={ariaLabel}>
      {children}
    </a>
  )
}
