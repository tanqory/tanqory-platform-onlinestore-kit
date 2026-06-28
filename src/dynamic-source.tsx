/**
 * Dynamic sources — bind a section/block setting to a live metafield, resource
 * property, or metaobject field (Shopify "Insert dynamic source", the ⛁ icon).
 *
 * A setting value is normally a primitive. When the merchant connects a dynamic
 * source the editor stores a `{ '@source': '<path>' }` object instead, and the
 * theme resolves it at render against the CURRENT page resource:
 *
 *   product.metafields.custom.subtitle     → the page product's metafield
 *   collection.metafields.custom.tagline   → the page collection's metafield
 *   shop.metafields.custom.announcement    → the store's metafield (any page)
 *   product.title / shop.name              → a plain resource property
 *   metaobject:size:medium.label           → a metaobject field (type:handle.key)
 *
 * The path grammar mirrors Shopify so themes/docs are portable. Resolution is
 * synchronous against already-loaded resources — the provider is responsible
 * for loading the bound metafields (see `collectBoundIdentifiers`).
 */
import { createContext, useContext, type ReactNode } from 'react'
import { useData } from './data'
import type { Product, Collection } from './data'
import type { Shop, Metaobject } from './storefront'

/** A setting bound to a dynamic source instead of a literal value. */
export interface BoundSource {
  '@source': string
}

export type Bound<T> = T | BoundSource

export function isBoundSource(v: unknown): v is BoundSource {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['@source'] === 'string'
  )
}

/** Resources a dynamic source can read from on the current page. */
export interface ResourceContextValue {
  shop?: (Shop & { metafields?: Record<string, string | null> }) | null
  product?: (Product & { metafields?: Record<string, string | null> }) | null
  collection?: (Collection & { metafields?: Record<string, string | null> }) | null
  /** Synchronous metaobject lookup (type, handle) → entry, from a warmed cache. */
  metaobject?: (type: string, handle: string) => Metaobject | null
}

const ResourceContext = createContext<ResourceContextValue>({})

/**
 * Provide the current page's resources to dynamic sources. Wrap the page once
 * (the layout does this). `shop` falls back to the data source so shop-level
 * bindings work on every page without extra wiring.
 */
export function DynamicSourceProvider({
  value,
  children,
}: {
  value: ResourceContextValue
  children: ReactNode
}): JSX.Element {
  return <ResourceContext.Provider value={value}>{children}</ResourceContext.Provider>
}

export function useResourceContext(): ResourceContextValue {
  const data = useData()
  const ctx = useContext(ResourceContext)
  // Shop is always available from the data source; an explicit provider value
  // (carrying loaded shop metafields) takes precedence.
  return { shop: data.shop, ...ctx }
}

const METAOBJECT_RE = /^metaobject:([^:]+):([^.]+)\.(.+)$/

/** Resolve a `@source` path against a resource context. Returns null if unbound. */
export function resolveBoundSource(
  source: string,
  ctx: ResourceContextValue,
): string | null {
  const mo = source.match(METAOBJECT_RE)
  if (mo) {
    const [, type, handle, field] = mo
    const obj = ctx.metaobject?.(type, handle)
    return obj?.values?.[field] ?? null
  }
  const parts = source.split('.')
  const root = parts[0]
  const resource =
    root === 'product'
      ? ctx.product
      : root === 'collection'
        ? ctx.collection
        : root === 'shop'
          ? ctx.shop
          : null
  if (!resource) return null
  if (parts[1] === 'metafields') {
    const ns = parts[2]
    const key = parts.slice(3).join('.')
    if (!ns || !key) return null
    return resource.metafields?.[`${ns}.${key}`] ?? null
  }
  // Plain resource property: product.title, shop.name, collection.title…
  const direct = (resource as unknown as Record<string, unknown>)[parts[1]]
  return direct == null ? null : String(direct)
}

/**
 * Resolve a possibly-bound setting value for the current page.
 *   const heading = useBound(attributes.heading)   // string | the literal | null
 * A plain value passes through unchanged; a `{ '@source' }` object resolves to
 * the live value (or null when the source has no value on this resource).
 */
export function useBound(value: unknown): unknown {
  const ctx = useResourceContext()
  if (!isBoundSource(value)) return value
  return resolveBoundSource(value['@source'], ctx)
}

/** Convenience: resolve to a string (empty when null/unbound-empty). */
export function useBoundText(value: unknown, fallback = ''): string {
  const resolved = useBound(value)
  if (resolved == null) return fallback
  return typeof resolved === 'string' ? resolved : String(resolved)
}

/**
 * Walk a content tree's section/block settings and collect every bound metafield
 * identifier, grouped by resource. The provider uses this to request exactly the
 * metafields the page binds (the live product/collection query takes identifiers).
 */
export function collectBoundIdentifiers(
  nodes: Array<{ settings?: Record<string, unknown>; blocks?: unknown[] }> | undefined,
): { product: Array<{ namespace: string; key: string }>; collection: Array<{ namespace: string; key: string }>; shop: Array<{ namespace: string; key: string }> } {
  const out = {
    product: [] as Array<{ namespace: string; key: string }>,
    collection: [] as Array<{ namespace: string; key: string }>,
    shop: [] as Array<{ namespace: string; key: string }>,
  }
  const seen = new Set<string>()
  const visitSettings = (settings?: Record<string, unknown>): void => {
    if (!settings) return
    for (const v of Object.values(settings)) {
      if (!isBoundSource(v)) continue
      const parts = v['@source'].split('.')
      const root = parts[0] as 'product' | 'collection' | 'shop'
      if (parts[1] !== 'metafields') continue
      const namespace = parts[2]
      const key = parts.slice(3).join('.')
      if (!namespace || !key || !(root in out)) continue
      const dedupe = `${root}:${namespace}.${key}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      out[root].push({ namespace, key })
    }
  }
  const walk = (list?: Array<{ settings?: Record<string, unknown>; blocks?: unknown[] }>): void => {
    for (const node of list ?? []) {
      visitSettings(node.settings)
      walk(node.blocks as typeof list)
    }
  }
  walk(nodes)
  return out
}
