import { useEffect } from 'react'
import { getAnalytics } from '../../analytics'
import { useCart, type CartLine } from '../../cart'
import type { Money } from '../../data'
import { closeOverlay, useOverlay } from '../components/useOverlayChannel'

export interface CartDrawerState {
  /** True while the `cart` overlay is open. Fires `CART_VIEWED` on each open. */
  open: boolean
  lines: CartLine[]
  lineCount: number
  isEmpty: boolean
  subtotal: Money
  /** Always a usable href — the live cart's checkout URL, or `/checkout`. */
  checkoutUrl: string
  /** +/- a line. Passing 0 removes it (cart layer semantics, unchanged). */
  updateQuantity: (lineId: string, quantity: number) => Promise<void>
  /** Removes the line AND fires `PRODUCT_REMOVED_FROM_CART` for it. */
  remove: (lineId: string) => Promise<void>
  /**
   * Call from the checkout CTA's `onClick`. Fires `CHECKOUT_STARTED` and
   * FLUSHES the analytics buffer — the click is followed by a full-page
   * navigation to a different origin, so a buffered event would die with the
   * page and the merchant would see traffic that never converts.
   */
  startCheckout: () => void
  close: () => void
}

/**
 * Mini-cart state + its complete analytics contract, headless.
 *
 * A theme's cart drawer becomes markup: every event a merchant's funnel
 * depends on (`CART_VIEWED`, `PRODUCT_REMOVED_FROM_CART`, `CHECKOUT_STARTED`
 * + flush) is fired from here, so a theme cannot forget one.
 */
export function useCartDrawerState(): CartDrawerState {
  const open = useOverlay('cart')
  const { lines, subtotal, checkoutUrl, updateQuantity, remove } = useCart()

  // The mini-cart is the primary cart surface (it auto-opens after
  // add-to-cart), so opening it is a cart_viewed for the merchant's funnel.
  useEffect(() => {
    if (open) getAnalytics().track('CART_VIEWED', { lineCount: lines.length })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return {
    open,
    lines,
    lineCount: lines.length,
    isEmpty: lines.length === 0,
    subtotal,
    checkoutUrl: checkoutUrl ?? '/checkout',
    updateQuantity,
    remove: async (lineId) => {
      const line = lines.find((l) => l.id === lineId)
      if (line) {
        getAnalytics().track('PRODUCT_REMOVED_FROM_CART', {
          lineId: line.id,
          title: line.title,
          quantity: line.quantity,
          ...(line.productHandle ? { handle: line.productHandle } : {}),
        })
      }
      await remove(lineId)
    },
    startCheckout: () => {
      const a = getAnalytics()
      a.track('CHECKOUT_STARTED', { value: subtotal, lineCount: lines.length })
      a.flush()
    },
    close: () => closeOverlay(),
  }
}
