import { useEffect, useRef, type ReactNode } from 'react'
import { closeOverlay } from './useOverlayChannel'

/**
 * Side-anchored slide-over surface. Used by `<CartDrawer>` (right) and
 * `<MobileNavDrawer>` (left). Renders an opaque overlay + a sliding panel.
 *
 * Owns:
 *   - body scroll lock while open
 *   - focus trap (Tab / Shift+Tab cycle inside the panel)
 *   - ESC to close
 *   - return-focus to the trigger that opened it
 *
 * Doesn't own:
 *   - WHEN to be open — `open` is driven by `useOverlay()` in the parent
 *   - WHERE to render — just an inline div. Themes can portal it later if
 *     a `<details>` ancestor traps z-index.
 */
export function Drawer({
  open,
  side = 'right',
  width = '420px',
  ariaLabel,
  children,
}: {
  open: boolean
  /** Which edge the panel slides in from. */
  side?: 'left' | 'right'
  /** Max-width of the panel on desktop (full-bleed on mobile). */
  width?: string
  /** ARIA label for the dialog — read by screen readers. */
  ariaLabel: string
  children: ReactNode
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Body scroll lock — saves the user's scroll position so closing the
  // drawer doesn't jump them to the top.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Focus management — capture the trigger when we open, send focus into
  // the panel, restore focus on close.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      // Defer one frame so the panel is in the DOM before we focus into it.
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

  // Key handlers: ESC closes; Tab/Shift+Tab cycle within the panel.
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
      className={`overlay ${open ? 'overlay--open' : ''}`}
      aria-hidden={!open}
      onClick={(e) => {
        // Only close on backdrop click, not clicks inside the panel.
        if (e.target === e.currentTarget) closeOverlay()
      }}
    >
      <div
        ref={panelRef}
        className={`drawer drawer--${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  )
}
