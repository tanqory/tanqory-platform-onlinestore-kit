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
  /** Optional fetch override (testing / SSR). */
  fetcher?: typeof fetch
  /** Tune how much to load at boot. */
  prefetch?: {
    /** Max collections to fetch (default 20). */
    collectionLimit?: number
    /** Max products to inline under each collection (default 24). */
    productLimitPerCollection?: number
  }
}

const COLLECTIONS_QUERY = /* GraphQL */ `
  query NovaBootstrap($first: Int!, $productFirst: Int!) {
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
interface BootstrapData {
  collections: { edges: Array<{ node: GqlCollectionNode }> }
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
  const collectionLimit = opts.prefetch?.collectionLimit ?? 20
  const productLimitPerCollection = opts.prefetch?.productLimitPerCollection ?? 24

  const res = await f(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { 'x-publishable-key': opts.token } : {}),
    },
    body: JSON.stringify({
      query: COLLECTIONS_QUERY,
      variables: { first: collectionLimit, productFirst: productLimitPerCollection },
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

  // Reuse the createMockData factory — same cache shape, same DataApi.
  return createMockData(collections)
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
