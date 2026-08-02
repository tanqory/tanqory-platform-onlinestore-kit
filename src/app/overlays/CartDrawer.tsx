import { useT } from '../../theme-context'
import { Drawer } from '../components/Drawer'
import { ImageResponsive } from '../components/ImageResponsive'
import { Money } from '../components/Money'
import { Button } from '../components/Button'
import { useCartDrawerState } from '../hooks/use-cart-drawer-state'

export interface CartDrawerProps {
  width: string
  emptyHeading: string
  emptySubtext: string
  checkoutLabel: string
  viewCartLabel: string
}

/**
 * Slide-over cart summary — the "mini cart" pattern. Triggered by the header
 * 🛒 button or (optionally) auto-opens after add-to-cart. Shows live line
 * items, subtotal, checkout CTA + a "View full cart" escape hatch to `/cart`.
 *
 * MARKUP ONLY. Every behaviour — the real cart from `useCart()`, the +/- and
 * Remove mutations, `checkoutUrl` resolution, and the `CART_VIEWED` /
 * `PRODUCT_REMOVED_FROM_CART` / `CHECKOUT_STARTED`-then-flush analytics
 * contract — comes from `useCartDrawerState()`. A theme that wants a different
 * cart drawer copies this file, restyles it, and keeps the money path.
 */
export function CartDrawer(props: CartDrawerProps): JSX.Element {
  const { width: widthAttr, emptyHeading, emptySubtext, checkoutLabel, viewCartLabel } = props
  const cart = useCartDrawerState()
  const t = useT()

  return (
    <Drawer open={cart.open} side="right" width={widthAttr} ariaLabel="Cart">
      <header className="drawer__head">
        <h2 className="drawer__title">{t('cart.title')}</h2>
        <button
          type="button"
          className="drawer__close"
          aria-label="Close cart"
          onClick={() => cart.close()}
        >
          ✕
        </button>
      </header>

      {cart.isEmpty ? (
        <div className="drawer__empty">
          <h3>{emptyHeading}</h3>
          <p className="u-text-muted">{emptySubtext}</p>
          <Button label={t('common.shopCollection')} link="/collections/all" variant="primary" size="lg" />
        </div>
      ) : (
        <>
          <ul className="drawer__lines">
            {cart.lines.map((l) => (
              <li key={l.id} className="drawer__line">
                <div className="drawer__thumb">
                  <ImageResponsive src={l.image?.url} alt={l.image?.altText ?? l.title} />
                </div>
                <div className="drawer__body">
                  <strong className="drawer__line-title">{l.title}</strong>
                  {l.variantTitle && (
                    <span className="u-text-muted drawer__variant">{l.variantTitle}</span>
                  )}
                  <div className="drawer__qty" role="group" aria-label="Quantity">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => void cart.updateQuantity(l.id, l.quantity - 1)}
                    >
                      −
                    </button>
                    <span aria-live="polite">{l.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => void cart.updateQuantity(l.id, l.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="drawer__line-price">
                  <Money value={l.lineSubtotal} />
                  <button
                    type="button"
                    className="drawer__remove"
                    aria-label={`${t('cart.remove')} ${l.title}`}
                    onClick={() => void cart.remove(l.id)}
                  >
                    {t('cart.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <footer className="drawer__foot">
            <div className="drawer__row">
              <span>{t('cart.subtotal')}</span>
              <strong><Money value={cart.subtotal} /></strong>
            </div>
            <p className="u-text-muted drawer__shipping-note">
              {t('cart.shippingNote')}
            </p>
            <Button
              label={checkoutLabel}
              link={cart.checkoutUrl}
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => cart.startCheckout()}
            />
            <a href="/cart" className="drawer__view-cart" onClick={() => cart.close()}>
              {viewCartLabel} →
            </a>
          </footer>
        </>
      )}
    </Drawer>
  )
}

export default CartDrawer
