import { createAnalytics } from '../analytics'
import { hasConsent, setBannerRequired } from '../consent'
import { createLiveData, createLiveDataFromSnapshot, createMockData } from '../data'
import type { DataApi, LiveDataOptions } from '../data'
import { mount } from '../mount'
import type { MountOptions } from '../mount'
import { apiBase } from './lib/api-base'
import { decodeHandle } from './lib/handle'
import type { StorefrontEnv } from './env'
import { applyBrandFonts, applyHead, computeHead, headFrom } from './head'
import type { HeadMeta } from './head'
import {
  DEFAULT_LOCALE,
  localeHeader,
  localeMapsFrom,
  pickLocale,
  resolveCountry,
  resolveLocale,
} from './locale'
import {
  detailHandles,
  resolveArticleMatch,
  resolveBlogHandle,
  resolveCollectionHandle,
  resolvePageHandle,
  resolveProductHandle,
  resolveTemplate,
  variantOf,
} from './routes'

/** The SSG data snapshot the prerender step embedded into the page (see the
 *  theme's entry-server.tsx) — present only on prerendered storefront HTML. */
declare global {
  interface Window {
    __TQ_STATE__?: { page?: string; bootstrap?: unknown }
  }
}

export interface StorefrontEntryOptions {
  /** `import.meta.env` read BY THE THEME (see env.ts for why). */
  env: StorefrontEnv
  /** `import.meta.glob('./sections/*.tsx', { eager: true })` — from the theme. */
  sections: Record<string, unknown>
  /** `import.meta.glob('./templates/*.json', { eager: true })` — from the theme. */
  templates: Record<string, unknown>
  /** `import.meta.glob('./layouts/*.tsx', { eager: true })` — from the theme. */
  layouts: Record<string, unknown>
  /** `import.meta.glob('./locales/*.json', { eager: true })` — from the theme. */
  locales: Record<string, { default: Record<string, string> }>
  /** The theme's `config/settings.json`. */
  settings: Record<string, unknown>
  /** The theme's offline fixtures (`lib/collections.json`). */
  mockData: Parameters<typeof createMockData>[0]
  /** Prefix for the live-data fallback console line. */
  name?: string
}

/**
 * Boot the storefront: route → template, live-vs-mock data, SEO head, brand
 * fonts, locale/country, deterministic hydration from `window.__TQ_STATE__`,
 * consent arming and the route/VIEW customer events.
 *
 * This is the whole of what used to be every theme's `main.tsx`. The theme
 * keeps only the `import.meta.glob` calls (they MUST resolve from the theme's
 * own directory) plus its `assets/styles.css` import.
 */
export function createStorefrontEntry(options: StorefrontEntryOptions): void {
  const {
    env,
    sections,
    templates: templateModules,
    layouts,
    locales: localeModules,
    settings,
    mockData,
    name = 'storefront',
  } = options

  const localeMaps = localeMapsFrom(localeModules)
  const activeLocale = pickLocale(localeMaps)

  const page =
    typeof window !== 'undefined' ? resolveTemplate(window.location.pathname) : 'index'

  /**
   * Upgrade a page/product/collection render to its standard template variant.
   * The merchant assigns a template to the resource; it arrives as
   * `templateSuffix` on the fetched record, so we render
   * `templates/<type>.<suffix>.json` when that file exists — otherwise keep the
   * default `<type>` template so a stale or removed suffix never renders a
   * blank page. Only applies on client routes, which always client-render (the
   * else branch below), so it never affects the prerendered/hydrated home markup.
   */
  const withTemplateVariant = (base: string, data: DataApi): string => {
    if (typeof window === 'undefined') return base
    const p = window.location.pathname
    let suffix: string | null | undefined
    if (base === 'page') suffix = data.pageByHandle(resolvePageHandle(p) ?? '')?.templateSuffix
    else if (base === 'product')
      suffix = data.productByHandle(resolveProductHandle(p) ?? '')?.templateSuffix
    else if (base === 'collection')
      suffix = data.collectionByHandle(resolveCollectionHandle(p) ?? '')?.templateSuffix
    else return base
    return variantOf(templateModules, base, suffix)
  }

  const bootData = async (): Promise<DataApi> => {
    const { VITE_TANQORY_BACKEND, VITE_TANQORY_STORE_ID, VITE_TANQORY_STOREFRONT_TOKEN } = env
    if (VITE_TANQORY_BACKEND && VITE_TANQORY_STORE_ID) {
      try {
        return await createLiveData({
          endpoint: apiBase(VITE_TANQORY_BACKEND),
          storeId: VITE_TANQORY_STORE_ID,
          token: VITE_TANQORY_STOREFRONT_TOKEN,
          country: resolveCountry(),
          locale: localeHeader(localeMaps),
          ...(typeof window !== 'undefined' ? detailHandles(window.location.pathname) : {}),
        })
      } catch (err) {
        // Log + fall through to mocks so a broken backend doesn't block the
        // storefront from rendering. Helpful during the cutover.
        // eslint-disable-next-line no-console
        console.error(`[${name}] live data fetch failed, falling back to mocks:`, err)
      }
    }
    return createMockData(mockData)
  }

  const baseMountOptions = (data: DataApi): MountOptions =>
    ({
      sections,
      pages: templateModules,
      shell: layouts,
      data,
      settings,
      locale: activeLocale,
      page,
    }) as MountOptions

  const ssgState = typeof window !== 'undefined' ? window.__TQ_STATE__ : undefined
  const { VITE_TANQORY_BACKEND, VITE_TANQORY_STORE_ID, VITE_TANQORY_STOREFRONT_TOKEN } = env

  // Storefront analytics — ONLY on the real published storefront (live data, not
  // the editor/preview plane). page_viewed events create sessions + device rows,
  // which power the merchant's Analytics/Reports/Live View. Beacons go same-origin
  // to /api/v1/analytics/events/batch (the edge worker forwards to the cell).
  const isPreviewHost =
    typeof window !== 'undefined' && /^preview-/.test(window.location.hostname)
  const analytics =
    VITE_TANQORY_BACKEND && VITE_TANQORY_STORE_ID && !isPreviewHost
      ? createAnalytics({ storeId: VITE_TANQORY_STORE_ID, consent: () => hasConsent('analytics') })
      : null

  /** Set the consent gate from shop data BEFORE the first pageViewed, so a store
   *  with the cookie banner enabled doesn't emit until the shopper has consented. */
  const armConsent = (data: DataApi): void => {
    const cb = (data.shop as { cookieBanner?: { enabled?: boolean } } | undefined)?.cookieBanner
    setBannerRequired(Boolean(cb?.enabled))
  }

  /** Emit the route/VIEW customer events (product/collection/search/cart) that map
   *  to the current URL. Fires once per page load alongside pageViewed — action
   *  events (add-to-cart, remove, checkout) fire from their section handlers. Both
   *  the internal analytics pipeline and connected pixels receive these. */
  const emitRouteEvents = (pathname: string, data: DataApi): void => {
    if (!analytics) return
    try {
      const product = decodeHandle(pathname.match(/\/products\/([^/]+)/)?.[1])
      const collection = decodeHandle(pathname.match(/\/collections\/([^/]+)/)?.[1])
      if (product) {
        const p = data.productByHandle?.(product)
        analytics.track(
          'PRODUCT_VIEWED',
          p ? { productId: p.id, title: p.title, handle: p.handle, price: p.price } : { handle: product },
        )
      } else if (collection) {
        const c = data.collectionByHandle?.(collection)
        analytics.track(
          'COLLECTION_VIEWED',
          c
            ? { collectionId: c.id, title: c.title, handle: collection, productCount: c.products?.length }
            : { handle: collection },
        )
      } else if (/^\/search\b/.test(pathname)) {
        const q = new URLSearchParams(window.location.search).get('q')?.trim()
        if (q) analytics.track('SEARCH_SUBMITTED', { query: q })
      } else if (/^\/cart\b/.test(pathname)) {
        analytics.track('CART_VIEWED', {})
      }
    } catch {
      /* telemetry must never break the page */
    }
  }

  if (
    ssgState?.bootstrap &&
    VITE_TANQORY_BACKEND &&
    VITE_TANQORY_STORE_ID &&
    page === (ssgState.page ?? 'index') &&
    // SSG bakes the DEFAULT locale's strings; a non-default ?locale= would render
    // different useT() text than the server did → hydration mismatch (#418). Those
    // visitors take the client-render path below instead.
    resolveLocale(localeMaps) === DEFAULT_LOCALE
  ) {
    // DETERMINISTIC HYDRATION: rebuild the DataApi synchronously from the exact
    // bootstrap the server rendered with — the first client render matches the
    // SSG markup byte-for-byte (no network, no drift, no React #418/#425). Fresh
    // data is fetched AFTER hydration and reconciled in place (SWR).
    const liveOpts: LiveDataOptions = {
      endpoint: apiBase(VITE_TANQORY_BACKEND),
      storeId: VITE_TANQORY_STORE_ID,
      token: VITE_TANQORY_STOREFRONT_TOKEN,
      country: resolveCountry(),
      locale: localeHeader(localeMaps),
    }
    const data = createLiveDataFromSnapshot(ssgState.bootstrap, liveOpts)
    mount({
      ...baseMountOptions(data),
      revalidate: async () => {
        try {
          return await createLiveData({ ...liveOpts, ...detailHandles(window.location.pathname) })
        } catch {
          return null // keep the snapshot data — a failed refresh must not blank the page
        }
      },
    })
    applyHead(computeHead(window.location.pathname, data, settings))
    applyBrandFonts(data)
    armConsent(data)
    analytics?.pageViewed()
    emitRouteEvents(window.location.pathname, data)
  } else {
    // No usable snapshot (mock build, or this route isn't the prerendered page).
    // Fetch first, then CLIENT-render: any SSG markup in #root belongs to a
    // different page/data, and hydrating against it would mismatch (#418). Because
    // this path always client-renders, choosing a `/pages/<handle>` template
    // variant here is safe (no prerendered markup to mismatch).
    void bootData().then(async (data) => {
      const pathname = window.location.pathname
      let finalPage = withTemplateVariant(page, data)
      let head: HeadMeta = computeHead(pathname, data, settings)
      // Blog + article are fetched on demand (not in the sync bootstrap), so
      // resolve their template variant + SEO head asynchronously before mount.
      const shop = data.shop as { name?: string } | undefined
      const shopName = (shop?.name || (settings as { shopName?: string }).shopName || 'Store').trim()
      const am = resolveArticleMatch(pathname)
      const bh = resolveBlogHandle(pathname)
      if (page === 'article' && am && data.articleByHandle) {
        const a = await data.articleByHandle(am.blogHandle, am.articleHandle)
        if (a) {
          finalPage = variantOf(templateModules, 'article', a.templateSuffix)
          head = headFrom(a.seo, a.title, shopName, a.excerpt)
        }
      } else if (page === 'blog' && bh && data.blogByHandle) {
        const b = await data.blogByHandle(bh)
        if (b) {
          finalPage = variantOf(templateModules, 'blog', b.templateSuffix)
          head = headFrom(b.seo, b.title, shopName)
        }
      }
      mount({ ...baseMountOptions(data), page: finalPage, forceClientRender: true })
      applyHead(head)
      applyBrandFonts(data)
      armConsent(data)
      analytics?.pageViewed()
      emitRouteEvents(pathname, data)
    })
  }
}
