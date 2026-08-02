import { useT } from '../../theme-context'
import { Drawer } from '../components/Drawer'
import { useOverlay, closeOverlay } from '../components/useOverlayChannel'

interface NavLink {
  title: string
  url: string
}

export interface MobileNavDrawerProps {
  width: string
  heading: string
  links: NavLink[] | null
}

/**
 * Mobile / hamburger menu — left-side slide-over containing the same nav
 * the merchant configured for desktop (passed in via the `links` prop from
 * the layout, which already reads the menu via `useStorefrontMenus`).
 *
 * Renders nothing on desktop (gated by a CSS media query on the trigger,
 * not here — so the panel still works for narrow desktop windows).
 */
export function MobileNavDrawer(props: MobileNavDrawerProps): JSX.Element {
  const open = useOverlay('mobile-nav')
  const t = useT()
  const { width, heading, links } = props

  // Default to the same fallback header nav <Layout> uses if no live menu
  // was passed in. Keeps the drawer useful on a brand-new store.
  const navItems: NavLink[] =
    links && links.length > 0
      ? links
      : [
          { title: t('nav.shop') || 'Shop', url: '/collections/all' },
          { title: 'Collections', url: '/collections' },
          { title: 'About', url: '/pages/about' },
          { title: 'Journal', url: '/pages/journal' },
        ]

  return (
    <Drawer open={open} side="left" width={width} ariaLabel={heading}>
      <header className="drawer__head">
        <h2 className="drawer__title">{heading}</h2>
        <button
          type="button"
          className="drawer__close"
          aria-label="Close menu"
          onClick={() => closeOverlay()}
        >
          ✕
        </button>
      </header>
      <nav className="mobile-nav" aria-label="Mobile primary">
        <ul>
          {navItems.map((item) => (
            <li key={`${item.url}-${item.title}`}>
              <a href={item.url} onClick={() => closeOverlay()}>
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <footer className="mobile-nav__foot">
        <a href="/account">Account</a>
        <a href="/search">Search</a>
        <a href="/cart">Cart</a>
      </footer>
    </Drawer>
  )
}

export default MobileNavDrawer
