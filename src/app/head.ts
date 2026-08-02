import type { DataApi } from '../data'
import { resolvePageHandle, resolveProductHandle, resolveCollectionHandle } from './routes'

/**
 * Per-route document head (title + meta description) from the merchant's SEO
 * fields. Precedence — title: the resource's SEO title verbatim (merchant owns
 * it) → "<resource title> — <shop>" → shop name; description: SEO description →
 * page bodySummary → shop description (home only). Runs client-side on every
 * route (the SSG only prerenders home), so product/collection/page pages that
 * are client-rendered still get a correct, unique title + description.
 */
export interface HeadMeta {
  title: string
  description: string
  keywords: string[]
  /** Absolute URL of the page's lead image, for og:image / twitter:image. */
  image: string
  /** 'website' for the home page, 'product'/'article' for detail pages. */
  type: string
  /** Shop name — og:site_name. */
  siteName: string
  /** Absolute URL for the favicon / tab icon (square brand mark). */
  favicon: string
}

/** Resolve a possibly-relative asset URL to an absolute one, against the
 *  current origin — social scrapers require absolute og:image URLs. */
export function absUrl(url: string | undefined | null): string {
  if (!url) return ''
  if (/^https?:\/\//.test(url)) return url
  if (typeof window === 'undefined') return url
  return new URL(url, window.location.origin).toString()
}

/** Build a HeadMeta from a resource's SEO (shared by blog/article, which resolve
 *  their SEO asynchronously rather than from the sync bootstrap). */
export function headFrom(
  seo:
    | { title?: string | null; description?: string | null; keywords?: string[] | null }
    | null
    | undefined,
  resourceTitle: string,
  shopName: string,
  fallbackDesc?: string | null,
  image?: string | null,
): HeadMeta {
  return {
    title: seo?.title?.trim() ? seo.title.trim() : `${resourceTitle} — ${shopName}`,
    description: (seo?.description || fallbackDesc || '').trim(),
    keywords: (seo?.keywords ?? []).filter(Boolean),
    image: absUrl(image),
    type: 'article',
    siteName: shopName,
    favicon: '',
  }
}

export function computeHead(
  pathname: string,
  data: DataApi,
  settings: Record<string, unknown>,
): HeadMeta {
  const shop = data.shop as
    | {
        name?: string
        description?: string
        brand?: {
          logo?: { url?: string } | null
          squareLogo?: { url?: string } | null
          coverImage?: { url?: string } | null
        } | null
      }
    | undefined
  const shopName = (shop?.name || (settings as { shopName?: string }).shopName || 'Store').trim()
  let seoTitle: string | null | undefined
  let rawTitle: string | undefined
  let description: string | null | undefined
  let keywords: string[] = []
  let image: string | undefined
  let type = 'website'
  const isDetail = { pg: resolvePageHandle(pathname), pr: resolveProductHandle(pathname), co: resolveCollectionHandle(pathname) }
  if (isDetail.pr) {
    const r = data.productByHandle(isDetail.pr) as
      | { seo?: { title?: string | null; description?: string | null; keywords?: string[] }; title?: string; featuredImage?: { url?: string } | null }
      | undefined
    seoTitle = r?.seo?.title; rawTitle = r?.title; description = r?.seo?.description; keywords = r?.seo?.keywords ?? []
    image = r?.featuredImage?.url; type = 'product'
  } else if (isDetail.co) {
    const r = data.collectionByHandle(isDetail.co) as
      | { seo?: { title?: string | null; description?: string | null; keywords?: string[] }; title?: string; image?: { url?: string } | null }
      | undefined
    seoTitle = r?.seo?.title; rawTitle = r?.title; description = r?.seo?.description; keywords = r?.seo?.keywords ?? []
    image = r?.image?.url
  } else if (isDetail.pg) {
    const r = data.pageByHandle(isDetail.pg)
    seoTitle = r?.seo?.title; rawTitle = r?.title; description = r?.seo?.description || r?.bodySummary; keywords = r?.seo?.keywords ?? []
    type = 'article'
  }
  const isHome = !isDetail.pg && !isDetail.pr && !isDetail.co
  const title = seoTitle?.trim() ? seoTitle.trim() : rawTitle ? `${rawTitle} — ${shopName}` : shopName
  return {
    title,
    description: (description || (isHome ? shop?.description : '') || '').trim(),
    keywords: keywords.filter(Boolean),
    // og:image fallback chain: the resource's own image → the brand cover image
    // (Settings → Brand, a purpose-built share banner) → the brand logo. Both
    // brand images were SAVED_ONLY — carried on the SDL, rendered nowhere.
    image: absUrl(image || shop?.brand?.coverImage?.url || shop?.brand?.logo?.url),
    type,
    siteName: shopName,
    // The square brand mark makes the best favicon / tab icon; fall back to the
    // primary logo. Also previously SAVED_ONLY.
    favicon: absUrl(shop?.brand?.squareLogo?.url || shop?.brand?.logo?.url),
  }
}

/**
 * Write the computed head into the live document (client-side).
 *
 * Beyond title/description/keywords this now emits the canonical link + Open
 * Graph + Twitter card tags that were missing entirely — which is why a shared
 * product link previewed as the bare shop name on every page. The canonical and
 * og:url use the page's own URL (the host the storefront is served on is the
 * correct canonical for that page); forcing canonical to a configured primary
 * domain when a shopper is on a different host is the store-api#558 follow-up.
 */
export function applyHead({ title, description, keywords, image, type, siteName, favicon }: HeadMeta): void {
  if (typeof document === 'undefined') return
  const head = document.head
  if (title) document.title = title

  const upsert = (selector: string, make: () => HTMLElement, content: string) => {
    if (!content) return
    let el = head.querySelector(selector)
    if (!el) {
      el = make()
      head.appendChild(el)
    }
    if (el.tagName === 'LINK') el.setAttribute('href', content)
    else el.setAttribute('content', content)
  }
  const meta = (name: string, content: string) =>
    upsert(`meta[name="${name}"]`, () => {
      const m = document.createElement('meta')
      m.setAttribute('name', name)
      return m
    }, content)
  const prop = (property: string, content: string) =>
    upsert(`meta[property="${property}"]`, () => {
      const m = document.createElement('meta')
      m.setAttribute('property', property)
      return m
    }, content)

  const url = window.location.origin + window.location.pathname

  meta('description', description)
  meta('keywords', keywords.join(', '))

  upsert('link[rel="canonical"]', () => {
    const l = document.createElement('link')
    l.setAttribute('rel', 'canonical')
    return l
  }, url)

  prop('og:type', type)
  prop('og:url', url)
  prop('og:title', title)
  prop('og:description', description)
  prop('og:site_name', siteName)
  if (image) prop('og:image', image)

  meta('twitter:card', image ? 'summary_large_image' : 'summary')
  meta('twitter:title', title)
  meta('twitter:description', description)
  if (image) meta('twitter:image', image)

  if (favicon) {
    upsert(
      'link[rel="icon"]',
      () => {
        const l = document.createElement('link')
        l.setAttribute('rel', 'icon')
        return l
      },
      favicon,
    )
  }
}

/**
 * Apply the merchant's Settings → Brand fonts to the storefront (store#510).
 *
 * Theme typography reads `--font-display` / `--font-body` (tokens.css), so we
 * override those two vars on the root element from the brand's font list
 * ([0] → display, [1] → body) and load the families from Google Fonts.
 *
 * Deliberately client-only + applied on the root element (not the React tree):
 * it runs after hydration, so there is no server/client markup mismatch, and
 * `display=swap` means the default font shows until the brand font loads rather
 * than blank text. A store with no brand fonts is a no-op (tokens.css default).
 */
export function applyBrandFonts(source: { shop?: unknown }): void {
  if (typeof document === 'undefined') return
  // `brand.fonts` is a live-storefront field the kit's Shop type doesn't
  // declare yet — read it structurally rather than widening the public type.
  const data = source as { shop?: { brand?: { fonts?: string[] | null } | null } | null }
  const fonts = (data.shop?.brand?.fonts ?? []).filter(
    (f) => typeof f === 'string' && f.trim() !== '',
  )
  if (!fonts.length) return
  const display = fonts[0]
  const body = fonts[1] || fonts[0]
  const root = document.documentElement
  root.style.setProperty('--font-display', `"${display}", system-ui, sans-serif`)
  root.style.setProperty('--font-body', `"${body}", system-ui, sans-serif`)

  const families = Array.from(new Set([display, body]))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&')
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`
  let link = document.getElementById('tq-brand-fonts') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = 'tq-brand-fonts'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  if (link.href !== href) link.href = href
}
