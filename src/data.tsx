import { createContext, useContext, type ReactNode } from 'react'

export interface Money {
  amount: string
  currencyCode: string
}
export interface Product {
  handle: string
  title: string
  price: Money
  featuredImage?: { url: string; altText?: string } | null
}
export interface Collection {
  handle: string
  title: string
  /** Optional hero image; falls back to first product's featuredImage. */
  image?: { url?: string; altText?: string } | null
  products: Product[]
}
export interface Page {
  handle: string
  title: string
  /** HTML body — rendered via dangerouslySetInnerHTML by the PageBody section. */
  body: string
  bodySummary?: string
  author?: string | null
  publishedAt?: string
  updatedAt?: string
}

/** The data interface every block consumes. Themes provide an implementation. */
export interface DataApi {
  collectionByHandle: (handle: string) => Collection | null
  /** All known collections (used by CollectionList). */
  allCollections: () => Collection[]
  /**
   * Look up a single product by its handle. Returns null when the handle
   * isn't found. Required by FeaturedProduct / ProductDetails sections
   * (ported from the canonical examples/react theme in PR #2).
   */
  productByHandle: (handle: string) => Product | null
  /**
   * Look up a Page by handle (the storefront's `/pages/<handle>` content).
   * Returns null if the handle wasn't prefetched at boot or the merchant
   * hasn't published a page with that handle. Live data prefetches only the
   * page matching the current URL, so other handles return null even when
   * they exist in the backend — themes should only call this for the page
   * the user is on.
   */
  pageByHandle: (handle: string) => Page | null
  /** Localization snapshot — what markets/countries the store has live.
   *  null = mock data; the country switcher should hide itself. */
  localization: Localization | null
}

/** Country/market shape mirrored from storefront GraphQL `Localization`. */
export interface LocalizedCurrency {
  isoCode: string
  name?: string
  symbol?: string
}
export interface LocalizedMarket {
  id: string
  handle: string
  name: string
}
export interface LocalizedCountry {
  isoCode: string
  name: string
  currency: LocalizedCurrency
  market: LocalizedMarket | null
}
export interface Localization {
  /** Currently-active country (resolved from the request's X-Tanqory-Country). */
  country: LocalizedCountry
  /** Every country the store has an active Market for — what the picker shows. */
  availableCountries: LocalizedCountry[]
}

const DataContext = createContext<DataApi | null>(null)

/** Wraps the app with a theme-provided data source (mock or live). */
export function DataProvider({ value, children }: { value: DataApi; children: ReactNode }): JSX.Element {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataApi {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within <DataProvider>')
  return ctx
}

/** Build an offline data source from fixture collections (theme passes its JSON). */
export function createMockData(collections: Collection[]): DataApi {
  // Flatten products from every collection once; subsequent lookups are O(1)
  // by handle. A product appearing in multiple collections returns the first
  // occurrence — matching the storefront's "canonical product page" semantics.
  const productsByHandle = new Map<string, Product>()
  for (const c of collections) {
    for (const p of c.products) {
      if (!productsByHandle.has(p.handle)) productsByHandle.set(p.handle, p)
    }
  }
  return {
    collectionByHandle: (handle) => collections.find((c) => c.handle === handle) ?? null,
    allCollections: () => collections,
    productByHandle: (handle) => productsByHandle.get(handle) ?? null,
    pageByHandle: () => null,
    localization: null,
  }
}

/**
 * Live data source backed by the Tanqory Storefront GraphQL API.
 *
 *   const data = await createLiveData({
 *     endpoint: 'https://api-do-sgp1.tanqory.com',
 *     storeId:  '<store-uuid>',
 *     token:    '<publishable-storefront-token>',
 *     prefetch: { collectionLimit: 20, productLimitPerCollection: 24 },
 *   })
 *
 * Returns the same `DataApi` shape as `createMockData` (sync read methods)
 * by pre-fetching collections + their products at boot and serving every
 * subsequent lookup from an in-memory cache. The trade-off: a single GraphQL
 * round-trip at boot, then zero network on render — exactly what the SSG
 * step + first hydration need.
 *
 * Per-handle pages (e.g. /products/<handle>) that miss the prefetch can
 * still be fetched lazily via `dataApi.refresh()` (TODO) — for now, raise
 * `prefetch.productLimitPerCollection` to cover the catalogue size.
 */
export interface LiveDataOptions {
  /** Base URL of the store-api (e.g. https://api-do-sgp1.tanqory.com). */
  endpoint: string
  /** Store UUID (the `:storeId` path param). */
  storeId: string
  /** Publishable storefront token — passed as `x-publishable-key`. */
  token?: string
  /**
   * ISO 3166 alpha-2 (e.g. "TH", "SG", "US"). When set, the backend resolves
   * the matching Market for this country, applies its currency + exchange
   * rate, and returns Money fields in that currency. Falls back to store
   * base currency if no Market matches the country.
   */
  country?: string
  /** Optional fetch override (testing / SSR). */
  fetcher?: typeof fetch
  /**
   * Page handle (from `/pages/<handle>`) to fetch alongside the homepage
   * bootstrap. The theme entry resolves the current URL once at boot and
   * passes the matching handle here so the PageBody section can read
   * `dataApi.pageByHandle(handle)` synchronously during hydration.
   */
  pageHandle?: string
  /** Tune how much to load at boot. */
  prefetch?: {
    /** Max collections to fetch (default 20). */
    collectionLimit?: number
    /** Max products to inline under each collection (default 24). */
    productLimitPerCollection?: number
    /** Max products to fetch at the top level (default 24) — these power the
     *  synthesized `featured` / `all` virtual collections when the store has
     *  no real collections yet. */
    topProductLimit?: number
  }
}

// Bootstrap fetches BOTH collections AND a flat product list. The flat list
// powers a synthesized "featured" virtual collection when the store has live
// products but the merchant hasn't built a real collection yet — without it,
// a brand-new merchant's first Active product would never appear on the
// storefront (collections-only bootstrap = empty homepage).
const COLLECTIONS_QUERY = /* GraphQL */ `
  query NovaBootstrap($first: Int!, $productFirst: Int!, $productsTop: Int!, $pageHandle: String) {
    page(handle: $pageHandle) {
      handle
      title
      body
      bodySummary
      author
      publishedAt
      updatedAt
    }
    collections(first: $first) {
      edges {
        node {
          id
          handle
          title
          image { url altText }
          products(first: $productFirst) {
            edges {
              node {
                id
                handle
                title
                featuredImage { url altText }
                priceRange { minVariantPrice { amount currencyCode } }
              }
            }
          }
        }
      }
    }
    products(first: $productsTop) {
      edges {
        node {
          id
          handle
          title
          featuredImage { url altText }
          priceRange { minVariantPrice { amount currencyCode } }
        }
      }
    }
    localization {
      country {
        isoCode
        name
        currency { isoCode name symbol }
        market { id handle name }
      }
      availableCountries {
        isoCode
        name
        currency { isoCode name symbol }
        market { id handle name }
      }
    }
  }
`

interface GqlMoney { amount: string; currencyCode: string }
type GqlImg = { url?: string; altText?: string | null } | null | undefined
interface GqlProductNode {
  id: string
  handle: string
  title: string
  featuredImage?: GqlImg
  priceRange?: { minVariantPrice?: GqlMoney }
}
interface GqlCollectionNode {
  id: string
  handle: string
  title: string
  image?: GqlImg
  products: { edges: Array<{ node: GqlProductNode }> }
}
interface GqlPageNode {
  handle: string
  title: string
  body: string
  bodySummary?: string | null
  author?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
}
interface BootstrapData {
  collections: { edges: Array<{ node: GqlCollectionNode }> }
  products: { edges: Array<{ node: GqlProductNode }> }
  page: GqlPageNode | null
  localization: {
    country: LocalizedCountry
    availableCountries: LocalizedCountry[]
  }
}

function normalizeImage(img: GqlImg): { url: string; altText?: string } | null {
  if (!img || !img.url) return null
  return {
    url: img.url,
    ...(img.altText ? { altText: img.altText } : {}),
  }
}

function normalizeProduct(p: GqlProductNode): Product {
  return {
    handle: p.handle,
    title: p.title,
    price: p.priceRange?.minVariantPrice ?? { amount: '0', currencyCode: 'USD' },
    featuredImage: normalizeImage(p.featuredImage),
  }
}

function normalizeCollection(c: GqlCollectionNode): Collection {
  return {
    handle: c.handle,
    title: c.title,
    image: normalizeImage(c.image),
    products: c.products.edges.map((e) => normalizeProduct(e.node)),
  }
}

export async function createLiveData(opts: LiveDataOptions): Promise<DataApi> {
  const f = opts.fetcher ?? (globalThis.fetch as typeof fetch | undefined)
  if (!f) {
    throw new Error('[theme-kit] createLiveData: fetch is not available in this environment')
  }
  const endpoint = opts.endpoint.replace(/\/$/, '')
  const url = `${endpoint}/api/v1/stores/${encodeURIComponent(opts.storeId)}/graphql`
  // Defaults stay under store-api's GraphQL cost budget (1000). Cost formula
  // for the bootstrap query: 3*N + 4*N*M + 4*T  (N = collectionLimit,
  // M = productLimitPerCollection, T = topProductLimit). 10 + 10 + 24 = 526
  // — plenty of headroom for a homepage prefetch. Bump in opts.prefetch only
  // if you're sure the store's cost-budget limit is higher than 1000.
  const collectionLimit = opts.prefetch?.collectionLimit ?? 10
  const productLimitPerCollection = opts.prefetch?.productLimitPerCollection ?? 10
  const topProductLimit = opts.prefetch?.topProductLimit ?? 24

  const res = await f(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { 'x-publishable-key': opts.token } : {}),
      // X-Tanqory-Country triggers backend Market resolution; if the store
      // has an active Market with this country, Money.currencyCode + amount
      // come back already-converted in the target currency.
      ...(opts.country ? { 'x-tanqory-country': opts.country.toUpperCase() } : {}),
    },
    body: JSON.stringify({
      query: COLLECTIONS_QUERY,
      variables: {
        first: collectionLimit,
        productFirst: productLimitPerCollection,
        productsTop: topProductLimit,
        pageHandle: opts.pageHandle ?? null,
      },
    }),
  })
  if (!res.ok) {
    throw new Error(
      `[theme-kit] createLiveData: HTTP ${res.status} from ${url} — ${await res.text().catch(() => '')}`,
    )
  }
  const json = (await res.json()) as { data?: BootstrapData; errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`[theme-kit] GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  const collections: Collection[] = (json.data?.collections.edges ?? []).map((e) =>
    normalizeCollection(e.node),
  )
  const topProducts: Product[] = (json.data?.products.edges ?? []).map((e) =>
    normalizeProduct(e.node),
  )

  // Themes commonly reference `featured` / `frontpage` / `all` as their homepage
  // collection. Synthesize one when the merchant hasn't created a real
  // collection yet but DOES have Active products — otherwise their first
  // product would never appear on the storefront. Also ensure `allProducts`
  // is wired even when no products exist outside of collections.
  if (topProducts.length > 0 && !collections.some((c) => c.handle === 'featured')) {
    collections.unshift({
      handle: 'featured',
      title: 'Featured',
      image: topProducts[0].featuredImage ?? null,
      products: topProducts.slice(0, productLimitPerCollection),
    })
  }
  // Mirror as `all` too — many themes (incl. our nova templates) reference it.
  if (topProducts.length > 0 && !collections.some((c) => c.handle === 'all')) {
    collections.push({
      handle: 'all',
      title: 'All products',
      image: topProducts[0].featuredImage ?? null,
      products: topProducts,
    })
  }

  // Reuse the createMockData factory — same cache shape, same DataApi.
  // It also indexes products by handle so productByHandle() works even for
  // products fetched only via the top-level products() query.
  const data = createMockData(collections)
  const pageNode = json.data?.page
  if (pageNode) {
    // Cache only the page that matched the URL. pageByHandle returns null
    // for everything else — themes should only call it for the current page.
    const page: Page = {
      handle: pageNode.handle,
      title: pageNode.title,
      body: pageNode.body,
      ...(pageNode.bodySummary ? { bodySummary: pageNode.bodySummary } : {}),
      ...(pageNode.author ? { author: pageNode.author } : {}),
      ...(pageNode.publishedAt ? { publishedAt: pageNode.publishedAt } : {}),
      ...(pageNode.updatedAt ? { updatedAt: pageNode.updatedAt } : {}),
    }
    data.pageByHandle = (handle) => (handle === page.handle ? page : null)
  }
  const loc = json.data?.localization
  if (loc) {
    // Only expose the localization payload when the store actually has Markets
    // (availableCountries non-empty). With zero markets, leave `null` so the
    // theme's country picker hides itself instead of showing a hardcoded list
    // that doesn't match what the merchant has configured.
    data.localization =
      loc.availableCountries.length > 0
        ? { country: loc.country, availableCountries: loc.availableCountries }
        : null
  }
  return data
}

export function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: money.currencyCode }).format(
      Number(money.amount),
    )
  } catch {
    return `${money.amount} ${money.currencyCode}`
  }
}
