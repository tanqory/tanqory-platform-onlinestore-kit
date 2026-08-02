import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { SectionTree } from '../SectionTree'
import { useCart } from '../cart'
import { useData } from '../data'
import { collectBoundIdentifiers, DynamicSourceProvider } from '../dynamic-source'
import type { ResourceContextValue } from '../dynamic-source'
import { useSettings, useT } from '../theme-context'
import type { ContentNode, PageDoc } from '../types'
import { apiBase } from './lib/api-base'
import type { StorefrontEnv } from './env'
import { resolveTemplate } from './routes'
import { CookieConsent } from './components/CookieConsent'
import { TrackingPixels } from './components/TrackingPixels'
import { CartDrawer, type CartDrawerProps } from './overlays/CartDrawer'
import { SearchModal, type SearchModalProps } from './overlays/SearchModal'
import { MobileNavDrawer, type MobileNavDrawerProps } from './overlays/MobileNavDrawer'

/* ============================================================================
 * Build-time storefront env, provided by the shell and consumed by the hooks
 * that talk to the storefront GraphQL directly (menus, url redirects).
 *
 * The theme passes `import.meta.env` in — see env.ts for why this package can
 * never read it itself.
 * ==========================================================================*/

const StorefrontEnvContext = createContext<StorefrontEnv>({})

export function StorefrontEnvProvider({
  value,
  children,
}: {
  value: StorefrontEnv
  children: ReactNode
}): JSX.Element {
  return <StorefrontEnvContext.Provider value={value}>{children}</StorefrontEnvContext.Provider>
}

export function useStorefrontEnv(): StorefrontEnv {
  return useContext(StorefrontEnvContext)
}

/* ==========================================================================*/

function lookupTemplate(
  templates: Record<string, { default?: PageDoc }>,
  name: string,
): ContentNode[] {
  for (const [key, mod] of Object.entries(templates)) {
    if (key.endsWith(`/${name}.json`)) return mod.default?.sections ?? []
  }
  return []
}

/**
 * SPA router — intercepts internal `<a>` clicks, `history.pushState`s the
 * new URL, and triggers a React re-render so the body swaps templates
 * without a full page reload. Cuts perceived navigation time from
 * ~3-6s (cold-start HTML fetch + JS eval) to a few ms.
 *
 * Skips:
 *   - external origins
 *   - `target="_blank"` / `download` / right-click / cmd+click
 *   - links with `data-full-page-nav="true"` (escape hatch — e.g. checkout)
 *   - paths under `/checkout/`, `/account/`, `/orders/` — these are served
 *     by separate centralized microservices (studio-checkouts /
 *     studio-accounts) intercepted by the storefront router at the edge.
 *     SPA navigation would never reach those services because the theme
 *     SPA has no routes for them — it would just render the theme's 404.
 *
 * Each section that consumes `window.location.pathname` (PageBody,
 * BlogPosts, ArticleBody, useUrlRedirect) reads it via `useEffect` keyed on
 * `pathname`, so they refetch when the route changes.
 */
export function useSoftRoute(enabled: boolean): string {
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  )

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    const navigate = (next: string) => {
      if (next !== window.location.pathname + window.location.search) {
        window.history.pushState({}, '', next)
      }
      setPathname(window.location.pathname)
      // Match a fresh page load — scroll to top unless the merchant is
      // jumping to an in-page anchor.
      if (!next.includes('#')) {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      if (a.target && a.target !== '_self') return
      if (a.hasAttribute('download')) return
      if (a.dataset.fullPageNav === 'true') return
      let url: URL
      try {
        url = new URL(a.href, window.location.origin)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      // Hash-only nav stays a normal anchor jump.
      if (url.pathname === window.location.pathname && url.hash) return
      // Centralized checkout / account / orders microservices are intercepted
      // by the storefront router at the edge — they're NOT routes the theme
      // SPA owns. Skipping SPA nav forces a real HTTP navigation that the
      // router can intercept and forward to studio-checkouts / studio-accounts.
      if (
        url.pathname === '/checkout' ||
        url.pathname.startsWith('/checkout/') ||
        url.pathname === '/account' ||
        url.pathname.startsWith('/account/') ||
        url.pathname === '/orders' ||
        url.pathname.startsWith('/orders/')
      ) {
        return
      }
      e.preventDefault()
      navigate(url.pathname + url.search + url.hash)
    }

    const onPop = () => setPathname(window.location.pathname)

    document.addEventListener('click', onClick)
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('popstate', onPop)
    }
  }, [enabled])

  return pathname
}

/**
 * Resolve the user's preferred locale + country.
 *
 * Precedence: URL ?locale= / ?country= (set by the switcher form submission,
 * also shareable) → localStorage (sticky across visits) → SSG default from
 * settings.json. Runs once on mount to avoid SSR/CSR hydration mismatch.
 *
 * The setter persists to BOTH localStorage and the URL search params (replace
 * state, no reload) so deep-linking + back/forward keep working.
 */
export const LOCALE_KEY = 'tq-locale'
export const COUNTRY_KEY = 'tq-country'

export function usePersistedChoice(
  paramName: string,
  storageKey: string,
  fallback: string,
  /**
   * When true, changing the value triggers a full page reload instead of an
   * in-place URL replace. Needed for `country` (prices are baked at fetch time,
   * so only a fresh fetch with the new X-Tanqory-Country header shows the right
   * currency) AND for `locale` (the UI-string map is selected at boot from
   * ?locale=, and the SSG bakes the default locale — a reload re-selects the
   * chosen locale's strings).
   */
  reloadOnChange = false,
): [string, (next: string) => void] {
  const [value, setValue] = useState(fallback)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URLSearchParams(window.location.search).get(paramName)
    if (url) {
      setValue(url)
      try {
        window.localStorage.setItem(storageKey, url)
      } catch {
        /* private mode etc. */
      }
      return
    }
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) setValue(stored)
    } catch {
      /* private mode etc. */
    }
  }, [paramName, storageKey])
  const update = (next: string): void => {
    setValue(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storageKey, next)
    } catch {
      /* private mode etc. */
    }
    const url = new URL(window.location.href)
    url.searchParams.set(paramName, next)
    if (reloadOnChange) {
      // Full reload so the storefront's GraphQL bootstrap re-fires with the
      // new X-Tanqory-Country header → fresh Money fields in the new
      // currency. replaceState alone would leave stale prices on screen.
      window.location.href = url.toString()
      return
    }
    window.history.replaceState(null, '', url.toString())
  }
  return [value, update]
}

/**
 * Storefront menu shape (subset of GraphQL `Menu.items`).
 * Each item knows where it links and (optionally) the resource it points at.
 */
export interface MenuLink {
  title: string
  url: string
}

/**
 * Editor preview cue — paints a selection outline on whichever section the
 * editor has highlighted, and a softer hover outline on whichever section
 * the visitor is pointing at. Only runs inside the `preview-*` iframe; the
 * public storefront never sees these affordances.
 *
 * The selection class is applied via DOM mutation (not React state) because
 * theme-kit's `SectionTree` owns the section wrappers and we don't want to
 * push selection state up through every section component. A
 * MutationObserver re-applies the class after PreviewBridge re-renders
 * (e.g. `tanqory-preview-update-section` swaps a section's settings).
 */
export function usePreviewSelection(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let currentId: string | null = null

    const paint = () => {
      document
        .querySelectorAll('.tq-preview-selected')
        .forEach((el) => el.classList.remove('tq-preview-selected'))
      if (!currentId) return
      const el = document.querySelector(`[data-tq-section-id="${CSS.escape(currentId)}"]`)
      if (el) el.classList.add('tq-preview-selected')
    }

    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'tanqory-preview-select') {
        currentId = String(e.data.sectionId ?? '') || null
        paint()
      }
    }

    // Also self-select on click — instant feedback for the merchant before
    // the editor round-trips through the postMessage protocol.
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const el = t?.closest?.('[data-tq-section-id]') as HTMLElement | null
      if (!el) return
      currentId = el.dataset.tqSectionId ?? null
      paint()
    }

    // Re-paint after PreviewBridge tree state changes — without this, an
    // edit that re-renders the section drops the highlight.
    const obs = new MutationObserver(() => paint())
    obs.observe(document.body, { childList: true, subtree: true })

    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick)
    document.body.classList.add('tq-preview')

    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('click', onClick)
      document.body.classList.remove('tq-preview')
      obs.disconnect()
      document
        .querySelectorAll('.tq-preview-selected')
        .forEach((el) => el.classList.remove('tq-preview-selected'))
    }
  }, [enabled])
}

/**
 * Checks `Query.urlRedirects` against the current pathname and, if it matches
 * a redirect rule, navigates to the target. Runs once at boot — keeps the
 * fetch off the SSG render path so it costs nothing if the merchant has no
 * redirects configured (resolver returns an empty connection, hook returns
 * synchronously after one round-trip).
 *
 * Why client-side: the storefront is statically served (`vite preview`), so
 * there's no router-level place to intercept the URL before render. A brief
 * flash on the matching path is acceptable for the migration use case
 * (renamed product / collection / page) — it beats a 404.
 */
export function useUrlRedirect(pathname?: string): void {
  const env = useStorefrontEnv()
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!env.VITE_TANQORY_BACKEND || !env.VITE_TANQORY_STORE_ID) return
    const url = `${apiBase(env.VITE_TANQORY_BACKEND)}/api/v1/stores/${encodeURIComponent(
      env.VITE_TANQORY_STORE_ID,
    )}/graphql`
    const currentPath = pathname ?? window.location.pathname
    let cancelled = false
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.VITE_TANQORY_STOREFRONT_TOKEN
          ? { 'x-publishable-key': env.VITE_TANQORY_STOREFRONT_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        // Server-side filter keeps the response small — we only care about
        // exact-path matches. The pageSize cap of 5 lets us tolerate `query`
        // false positives (substring match) without paying for a full list.
        query: `query R($q: String) {
          urlRedirects(first: 5, query: $q) {
            nodes { path target }
          }
        }`,
        variables: { q: currentPath },
      }),
    })
      .then((r) => r.json())
      .then((j: { data?: { urlRedirects?: { nodes: Array<{ path: string; target: string }> } } }) => {
        if (cancelled) return
        const match = j.data?.urlRedirects?.nodes.find((n) => n.path === currentPath)
        if (match) window.location.replace(match.target)
      })
      .catch(() => {
        /* a failed redirect lookup should never break the page */
      })
    return () => {
      cancelled = true
    }
  }, [pathname, env])
}

/**
 * Fetches the four menus the chrome renders (header + 3 footer columns) in
 * a single GraphQL round-trip. Which Menu handle drives each slot is set in
 * the editor's Theme settings panel (`headerMenuHandle`, etc.) so merchants
 * can rename or re-wire navigations without touching theme code. Returns
 * `null` for any slot whose handle is blank, missing in the backend, or
 * empty — callers fall back to their hardcoded link list so the theme stays
 * usable on a brand-new store.
 */
export function useStorefrontMenus(handles: {
  header: string
  footerShop: string
  footerHelp: string
  footerCompany: string
}): {
  main: MenuLink[] | null
  footerShop: MenuLink[] | null
  footerHelp: MenuLink[] | null
  footerCompany: MenuLink[] | null
} {
  const env = useStorefrontEnv()
  const [menus, setMenus] = useState<{
    main: MenuLink[] | null
    footerShop: MenuLink[] | null
    footerHelp: MenuLink[] | null
    footerCompany: MenuLink[] | null
  }>({ main: null, footerShop: null, footerHelp: null, footerCompany: null })
  const prevHandlesRef = useRef({ header: '', shop: '', help: '', company: '' })

  // GraphQL aliases need to be stable strings, so we resolve handle changes
  // into the dep array — the effect re-fires whenever the merchant picks a
  // different handle in the editor.
  const headerHandle = handles.header
  const shopHandle = handles.footerShop
  const helpHandle = handles.footerHelp
  const companyHandle = handles.footerCompany

  // Seed every slot from the data source's prefetched/mock menus (`data.menu`
  // sync) — this works in BOTH mock preview and live (no network, no env gate),
  // so the header/footer render REAL menu data instead of the hardcoded fallback
  // even in the editor. The GraphQL effect below still upgrades a live store
  // with on-demand menus; the hardcoded list is only the last resort.
  const data = useData()
  useEffect(() => {
    const toLinks = (handle: string): MenuLink[] | null => {
      const m = handle ? data.menu?.(handle) : null
      if (!m?.items?.length) return null
      const links = m.items
        .filter((it) => Boolean(it.url))
        .map((it) => ({ title: it.title, url: it.url as string }))
      return links.length ? links : null
    }
    // When a handle CHANGES (merchant picks a different menu in the editor)
    // RE-RESOLVE that slot fresh — otherwise `prev ?? …` would keep the old
    // menu and the picker would appear to do nothing. When the handle is
    // unchanged (some other re-render) keep the existing value so a live
    // GraphQL-fetched menu isn't clobbered by the sync seed.
    const ph = prevHandlesRef.current
    setMenus((prev) => ({
      main: headerHandle !== ph.header ? toLinks(headerHandle) : prev.main ?? toLinks(headerHandle),
      footerShop: shopHandle !== ph.shop ? toLinks(shopHandle) : prev.footerShop ?? toLinks(shopHandle),
      footerHelp: helpHandle !== ph.help ? toLinks(helpHandle) : prev.footerHelp ?? toLinks(helpHandle),
      footerCompany:
        companyHandle !== ph.company ? toLinks(companyHandle) : prev.footerCompany ?? toLinks(companyHandle),
    }))
    prevHandlesRef.current = { header: headerHandle, shop: shopHandle, help: helpHandle, company: companyHandle }
  }, [data, headerHandle, shopHandle, helpHandle, companyHandle])

  useEffect(() => {
    if (!env.VITE_TANQORY_BACKEND || !env.VITE_TANQORY_STORE_ID) return
    const url = `${apiBase(env.VITE_TANQORY_BACKEND)}/api/v1/stores/${encodeURIComponent(
      env.VITE_TANQORY_STORE_ID,
    )}/graphql`
    // Only request slots whose handle is set — an empty handle means "fall
    // back to hardcoded" and we don't want to spend an alias on it.
    const slots: Array<{ alias: string; handle: string }> = []
    if (headerHandle) slots.push({ alias: 'main', handle: headerHandle })
    if (shopHandle) slots.push({ alias: 'footerShop', handle: shopHandle })
    if (helpHandle) slots.push({ alias: 'footerHelp', handle: helpHandle })
    if (companyHandle) slots.push({ alias: 'footerCompany', handle: companyHandle })
    if (slots.length === 0) return

    const fieldList = slots
      .map((s, i) => `${s.alias}: menu(handle: $h${i}) { items { title url } }`)
      .join('\n          ')
    const argList = slots.map((_, i) => `$h${i}: String!`).join(', ')
    const variables = Object.fromEntries(slots.map((s, i) => [`h${i}`, s.handle]))

    let cancelled = false
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.VITE_TANQORY_STOREFRONT_TOKEN
          ? { 'x-publishable-key': env.VITE_TANQORY_STOREFRONT_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        query: `query M(${argList}) {
          ${fieldList}
        }`,
        variables,
      }),
    })
      .then((r) => r.json())
      .then((j: { data?: Record<string, { items?: Array<{ title: string; url?: string | null }> } | null> }) => {
        if (cancelled) return
        const pluck = (key: string): MenuLink[] | null => {
          const m = j.data?.[key]
          if (!m?.items?.length) return null
          return m.items
            .filter((it): it is { title: string; url: string } => Boolean(it.url))
            .map((it) => ({ title: it.title, url: it.url }))
        }
        setMenus({
          main: pluck('main'),
          footerShop: pluck('footerShop'),
          footerHelp: pluck('footerHelp'),
          footerCompany: pluck('footerCompany'),
        })
      })
      .catch(() => {
        /* leave hardcoded fallback */
      })
    return () => {
      cancelled = true
    }
  }, [headerHandle, shopHandle, helpHandle, companyHandle, env])

  return menus
}

/**
 * Shared header/footer chrome state — derived once, consumed by the theme's
 * SiteHeader / SiteFooter and by `<StorefrontShell>`'s global overlays.
 * Header/footer are EDITABLE SECTIONS (the theme's sections/Header.tsx,
 * Footer.tsx) so they appear in the editor's section tree; the shell only
 * renders the page body + the global overlays.
 */
export function useChrome(opts?: Record<string, unknown>) {
  const settings = useSettings()
  const t = useT()
  // A section setting (Header/Footer section attributes) OVERRIDES the global
  // Theme setting; falling back to the global keeps brand-new templates working.
  const a = opts ?? {}
  const headerMenu = (a.menu as string) || (settings.headerMenuHandle as string) || ''
  const footerShopMenu = (a.shopMenu as string) || (settings.footerShopMenuHandle as string) || ''
  const footerHelpMenu = (a.helpMenu as string) || (settings.footerHelpMenuHandle as string) || ''
  const footerCompanyMenu = (a.companyMenu as string) || (settings.footerCompanyMenuHandle as string) || ''
  const menus = useStorefrontMenus({
    header: headerMenu,
    footerShop: footerShopMenu,
    footerHelp: footerHelpMenu,
    footerCompany: footerCompanyMenu,
  })
  const data = useData()
  const { totalQuantity } = useCart()
  const shopName =
    ((a.logo as string) || (settings.shopName as string) || '').trim() ||
    data.shop?.name?.trim() ||
    'Your store'
  // Settings → Brand. Only used when the merchant hasn't overridden the brand
  // with theme text (`a.logo` / settings.shopName) — an explicit theme choice
  // still wins. Until now a merchant could upload a logo and the storefront
  // never showed it: theme-kit didn't even request the field.
  const brandLogo =
    !((a.logo as string) || (settings.shopName as string) || '').trim() && data.shop?.brand?.logo
      ? data.shop.brand.logo
      : null
  // Brand colours as CSS custom properties on the shell, so any section that
  // uses var(--color-brand) follows Settings → Brand without new plumbing.
  const brandColors = data.shop?.brand?.colors?.primary?.[0]
  const brandVars: Record<string, string> = {
    ...(brandColors?.background ? { '--color-brand': brandColors.background } : {}),
    ...(brandColors?.foreground ? { '--color-brand-contrast': brandColors.foreground } : {}),
  }
  const year = new Date().getFullYear()
  const locales = (data.localization?.availableLanguages ?? []).map((l) => ({
    code: l.isoCode,
    label: l.name,
  }))
  const activeLocale = data.localization?.language?.isoCode ?? locales[0]?.code ?? 'en'
  const liveCountries = data.localization?.availableCountries ?? []
  const countries = liveCountries.map((c) => ({
    code: c.isoCode,
    label: c.name,
    currency: c.currency.isoCode,
  }))
  const activeCountry = data.localization?.country.isoCode ?? null
  const showCountrySwitch = countries.length > 0
  const showLocaleSwitch = locales.length > 0
  const showSwitchers = a.showLocale === false ? false : showCountrySwitch || showLocaleSwitch
  const footerTagline =
    (a.tagline as string) ||
    (data.shop?.description as string | undefined) ||
    (settings.footerTagline as string | undefined) ||
    ''
  const footerColumns = [
    { handle: footerShopMenu, links: menus.footerShop },
    { handle: footerHelpMenu, links: menus.footerHelp },
    { handle: footerCompanyMenu, links: menus.footerCompany },
  ]
    .map((c) => ({ title: (c.handle && data.menu?.(c.handle)?.title) || '', links: c.links ?? [] }))
    .filter((c) => c.links.length > 0)
  const flag = (k: string, g: string) => (a[k] !== undefined ? a[k] !== false : settings[g] !== false)
  const enableSearchModal = flag('showSearch', 'enableSearchModal')
  const enableCartDrawer = flag('showCart', 'enableCartDrawer')
  const enableAccountDropdown = flag('showAccount', 'enableAccountDropdown')
  const enableMobileNavDrawer = settings.enableMobileNavDrawer !== false
  // Brand colours ride along on the chrome style that already exists, so
  // Settings → Brand reaches the header without a second mechanism. Section
  // attributes (a.bg/a.fg) still win — an explicit theme choice beats the
  // brand default.
  const chromeStyle =
    a.bg || a.fg || Object.keys(brandVars).length
      ? ({
          ...brandVars,
          ...(a.bg ? { background: a.bg as string } : {}),
          ...(a.fg ? { color: a.fg as string } : {}),
        } as React.CSSProperties)
      : undefined
  const showPoweredBy = a.showPoweredBy !== undefined ? a.showPoweredBy !== false : settings.showPoweredBy !== false
  const poweredByLabel = (a.poweredByLabel as string) || (settings.poweredByLabel as string) || 'Made with Tanqory'
  const navItems: Array<{ title: string; url: string }> =
    menus.main ?? [
      { title: t('nav.shop') || 'Shop', url: '/collections/all' },
      { title: 'Collections', url: '/collections' },
      { title: 'About', url: '/pages/about' },
      { title: 'Journal', url: '/pages/journal' },
    ]
  return {
    settings, t, menus, data, totalQuantity, shopName, year, brandLogo, brandVars,
    locales, activeLocale, countries, activeCountry,
    showCountrySwitch, showLocaleSwitch, showSwitchers,
    footerTagline, footerColumns, chromeStyle, showPoweredBy, poweredByLabel,
    enableSearchModal, enableCartDrawer, enableAccountDropdown, enableMobileNavDrawer,
    navItems,
  }
}

/**
 * Presentation slots. Each receives the props the DEFAULT surface would have
 * received, so a theme can render its own markup without re-deriving state.
 * Return `null` to render nothing. Omit a slot to keep the default.
 */
export interface StorefrontShellSlots {
  searchModal?: (props: SearchModalProps) => ReactNode
  cartDrawer?: (props: CartDrawerProps) => ReactNode
  mobileNav?: (props: MobileNavDrawerProps) => ReactNode
  cookieConsent?: () => ReactNode
  trackingPixels?: () => ReactNode
}

export interface StorefrontShellProps {
  /** The page's section tree, rendered by theme-kit's mount(). */
  children: ReactNode
  /** The theme's `import.meta.glob('../templates/*.json', { eager: true })`. */
  templates: Record<string, { default?: PageDoc }>
  /** `import.meta.env` read by the theme (see env.ts). */
  env?: StorefrontEnv
  /** Optional presentation overrides for the global surfaces. */
  slots?: StorefrontShellSlots
}

/**
 * The storefront application shell — SPA soft-routing, url redirects, editor
 * preview affordances, dynamic-source (metafield) binding, and the global
 * overlay surfaces. Everything a theme's `layouts/layout.tsx` used to carry
 * except its own markup.
 */
export function StorefrontShell(props: StorefrontShellProps): JSX.Element {
  return (
    <StorefrontEnvProvider value={props.env ?? {}}>
      <ShellBody {...props} />
    </StorefrontEnvProvider>
  )
}

function ShellBody({ children, templates, slots }: StorefrontShellProps): JSX.Element {
  const { settings, menus, enableSearchModal, enableCartDrawer, enableMobileNavDrawer } = useChrome()

  // SPA routing — when enabled, internal link clicks update React state
  // instead of triggering a full page load. Falls back to native nav when
  // off (or in SSG / no-JS).
  //
  // Disable in preview mode (the editor's iframe): the editor pushes live
  // section/setting updates via `tanqory-preview-update-section` into the
  // bridge's tree state, and the bridge re-renders its own `<SectionTree>`
  // as `children`. If softRoute is on, the shell would overwrite that
  // child render with its own template lookup and every edit would silently
  // get lost. Same logic for the click-to-navigate interceptor — clicking a
  // CTA in preview mode should select the section, not navigate away.
  const isPreview =
    typeof window !== 'undefined' &&
    (/^preview-/.test(window.location.hostname) ||
      new URLSearchParams(window.location.search).has('preview'))

  const enableSpa = !isPreview && settings.enableSpaNavigation !== false
  const softPathname = useSoftRoute(enableSpa)
  const softTree = enableSpa ? lookupTemplate(templates, resolveTemplate(softPathname)) : null

  useUrlRedirect(softPathname)
  usePreviewSelection(isPreview)

  // Resource context for dynamic sources — bind any block to `product.*` /
  // `collection.*` / `shop.*`. We collect the bound metafield identifiers from
  // the current page's content (collectBoundIdentifiers) and fetch exactly
  // those from the live storefront (`metafields(identifiers)`), then expose the
  // resolved resources. Shop bindings work on every page; product/collection
  // only on their own templates.
  const data = useData()
  const currentPath =
    (enableSpa ? softPathname : null) ??
    (typeof window !== 'undefined' ? window.location.pathname : '/')
  const pageTree = (softTree ?? lookupTemplate(templates, resolveTemplate(currentPath)) ?? []) as ContentNode[]
  const boundIds = useMemo(() => collectBoundIdentifiers(pageTree), [pageTree])
  const [resourceValue, setResourceValue] = useState<ResourceContextValue>({})
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: ResourceContextValue = {}
      if (boundIds.shop.length && data.fetchShopMetafields && data.shop) {
        const mf = await data.fetchShopMetafields(boundIds.shop)
        next.shop = { ...data.shop, metafields: mf }
      }
      const productHandle = currentPath.match(/\/products\/([^/?#]+)/)?.[1]
      if (productHandle) {
        next.product = data.fetchProduct
          ? await data.fetchProduct(productHandle, { metafields: boundIds.product })
          : data.productByHandle?.(productHandle) ?? null
      }
      const collectionHandle = currentPath.match(/\/collections\/([^/?#]+)/)?.[1]
      if (collectionHandle) {
        const base = data.collectionByHandle?.(collectionHandle) ?? null
        const cmf =
          boundIds.collection.length && data.fetchCollectionMetafields
            ? await data.fetchCollectionMetafields(collectionHandle, boundIds.collection)
            : {}
        next.collection = base ? { ...base, metafields: cmf } : null
      }
      if (!cancelled) setResourceValue(next)
    })()
    return () => {
      cancelled = true
    }
  }, [data, currentPath, boundIds])

  const searchProps: SearchModalProps = {
    placeholder: (settings.searchPlaceholder as string) || 'Search products…',
    ctaLabel: (settings.searchCtaLabel as string) || 'See all results →',
    maxWidth: (settings.searchModalWidth as string) || '640px',
    debounceMs: Number(settings.searchDebounceMs ?? 250),
    maxResults: Number(settings.searchMaxResults ?? 6),
  }
  const cartProps: CartDrawerProps = {
    width: (settings.cartDrawerWidth as string) || '420px',
    emptyHeading: (settings.cartEmptyHeading as string) || 'Your cart is empty',
    emptySubtext: (settings.cartEmptySubtext as string) || 'Add a few things to get started.',
    checkoutLabel: (settings.cartCheckoutLabel as string) || 'Checkout',
    viewCartLabel: (settings.cartViewLabel as string) || 'View full cart',
  }
  const mobileNavProps: MobileNavDrawerProps = {
    width: (settings.mobileNavWidth as string) || '320px',
    heading: (settings.mobileNavHeading as string) || 'Menu',
    links: menus.main,
  }

  return (
    <DynamicSourceProvider value={resourceValue}>
      <main>{softTree ? <SectionTree tree={softTree} /> : children}</main>

      {slots?.cookieConsent ? slots.cookieConsent() : <CookieConsent />}
      {slots?.trackingPixels ? slots.trackingPixels() : <TrackingPixels />}

      {/* Overlay surfaces — render once per shell. Each is a no-op when its
       *  matching overlay isn't the active one (driven by useOverlayChannel),
       *  so mounting them all here is cheap. */}
      {enableSearchModal &&
        (slots?.searchModal ? slots.searchModal(searchProps) : <SearchModal {...searchProps} />)}
      {enableCartDrawer &&
        (slots?.cartDrawer ? slots.cartDrawer(cartProps) : <CartDrawer {...cartProps} />)}
      {enableMobileNavDrawer &&
        (slots?.mobileNav ? slots.mobileNav(mobileNavProps) : <MobileNavDrawer {...mobileNavProps} />)}
    </DynamicSourceProvider>
  )
}
