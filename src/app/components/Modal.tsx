import { useEffect, useRef, type ReactNode } from 'react'
import { closeOverlay } from './useOverlayChannel'

/**
 * Centered modal surface used by `<SearchModal>`. Same focus/scroll/ESC
 * semantics as `<Drawer>` but anchored to the viewport centre and capped at
 * `maxWidth` instead of stretching to a side.
 *
 * The shared dim+blur backdrop comes from the `.overlay` class — overlay
 * tokens (z-index, transition timing) live in one place in styles.css.
 */
export function Modal({
  open,
  maxWidth = '640px',
  ariaLabel,
  children,
}: {
  open: boolean
  maxWidth?: string
  ariaLabel: string
  children: ReactNode
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      const id = window.requestAnimationFrame(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        first?.focus()
      })
      return () => window.cancelAnimationFrame(id)
    }
    previouslyFocused.current?.focus?.()
    return undefined
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeOverlay()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div
      className={`overlay overlay--center ${open ? 'overlay--open' : ''}`}
      aria-hidden={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeOverlay()
      }}
    >
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ maxWidth }}
      >
        {children}
      </div>
    </div>
  )
}
