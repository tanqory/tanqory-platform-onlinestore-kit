import { useEffect, useState } from 'react'

/**
 * Tiny event-bus that lets any element in the layout open/close one of the
 * overlay surfaces (cart drawer, search modal, account dropdown, mobile nav)
 * without threading props or a context provider through every component.
 *
 * Trigger:   `openOverlay('cart')`  /  `closeOverlay()`
 * Subscribe: `const open = useOverlay('cart')` — returns true while the named
 *            overlay is the active one, false otherwise.
 *
 * Why DOM events instead of a React context: the header buttons that trigger
 * these are deep inside the layout tree; the overlay surfaces mount as
 * siblings (or even portals later). A custom event keeps both sides
 * decoupled and survives any future refactor that moves either piece.
 *
 * Only ONE overlay is open at a time — opening a new one closes the previous.
 * That's standard storefront UX and saves us from juggling z-index / focus
 * conflicts.
 */
export type OverlayName = 'cart' | 'search' | 'account' | 'mobile-nav'

const EVENT = 'tq:overlay'

interface OverlayDetail {
  name: OverlayName | null
}

export function openOverlay(name: OverlayName): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OverlayDetail>(EVENT, { detail: { name } }))
}

export function closeOverlay(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OverlayDetail>(EVENT, { detail: { name: null } }))
}

/** Subscribe to whether a specific named overlay is the active one. */
export function useOverlay(name: OverlayName): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<OverlayDetail>).detail
      setOpen(detail.name === name)
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [name])
  return open
}
