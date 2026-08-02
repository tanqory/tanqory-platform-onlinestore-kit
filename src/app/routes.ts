import { decodeHandle } from './lib/handle'

/**
 * URL → template routing. ONE copy, shared by the client entry
 * (`createStorefrontEntry`) and the SPA soft-router inside
 * `<StorefrontShell>`. Previously this table was duplicated in every theme's
 * `main.tsx` AND `layouts/layout.tsx` with a comment telling authors to keep
 * the two in sync by hand — a route added to one and not the other rendered
 * the theme's 404 on a valid URL.
 */

/** Map a URL pathname → template name (a file under the theme's ./templates). */
export function resolveTemplate(pathname: string): string {
  const p = pathname !== '/' ? pathname.replace(/\/+$/, '') : '/'
  if (p === '/' || p === '') return 'index'
  if (p === '/cart') return 'cart'
  if (p === '/search') return 'search'
  if (p === '/contact') return 'contact'
  if (p === '/404') return '404'
  if (p === '/collections') return 'list-collections'
  if (/^\/collections\/[^/]+$/.test(p)) return 'collection'
  if (/^\/products\/[^/]+$/.test(p)) return 'product'
  if (/^\/pages\/[^/]+$/.test(p)) return 'page'
  // Shop policies (Settings) — a menu item of type "Policy" links to
  // /policies/<handle> (privacy-policy, refund-policy, …).
  if (/^\/policies\/[^/]+$/.test(p)) return 'policy'
  // Customer account — /account and its sub-routes (login, orders, addresses).
  if (p === '/account' || /^\/account\/[^/]+/.test(p)) return 'account'
  // Order matters: `/blogs/<blog>/<article>` must be tested BEFORE
  // `/blogs/<handle>` so blog-list doesn't shadow article-detail.
  if (/^\/blogs\/[^/]+\/[^/]+$/.test(p)) return 'article'
  if (/^\/blogs\/[^/]+$/.test(p)) return 'blog'
  return '404'
}

/** Extract `<handle>` from `/pages/<handle>` so the bootstrap can prefetch the
 *  matching Page in the same GraphQL round-trip the homepage uses. Returns
 *  undefined when the URL isn't a `/pages/...` route. */
export function resolvePageHandle(pathname: string): string | undefined {
  const m = pathname.match(/^\/pages\/([^/]+)\/?$/)
  return m ? decodeHandle(m[1]) : undefined
}

/** `<handle>` from `/products/<handle>`, else undefined. */
export function resolveProductHandle(pathname: string): string | undefined {
  const m = pathname.match(/^\/products\/([^/]+)\/?$/)
  return m ? decodeHandle(m[1]) : undefined
}

/** `<handle>` from `/collections/<handle>`, else undefined. */
export function resolveCollectionHandle(pathname: string): string | undefined {
  const m = pathname.match(/^\/collections\/([^/]+)\/?$/)
  return m ? decodeHandle(m[1]) : undefined
}

/** `<handle>` from `/blogs/<handle>` (blog list), else undefined. */
export function resolveBlogHandle(pathname: string): string | undefined {
  const m = pathname.match(/^\/blogs\/([^/]+)\/?$/)
  return m ? decodeHandle(m[1]) : undefined
}

/** `{ blogHandle, articleHandle }` from `/blogs/<blog>/<article>`, else undefined. */
export function resolveArticleMatch(
  pathname: string,
): { blogHandle: string; articleHandle: string } | undefined {
  const m = pathname.match(/^\/blogs\/([^/]+)\/([^/]+)\/?$/)
  return m ? { blogHandle: decodeHandle(m[1]), articleHandle: decodeHandle(m[2]) } : undefined
}

/** The detail-route handle vars to prefetch (page/product/collection) so the
 *  fetched record's templateSuffix is available before mount picks the template. */
export function detailHandles(pathname: string): {
  pageHandle?: string
  productHandle?: string
  collectionHandle?: string
} {
  const pageHandle = resolvePageHandle(pathname)
  const productHandle = resolveProductHandle(pathname)
  const collectionHandle = resolveCollectionHandle(pathname)
  return {
    ...(pageHandle ? { pageHandle } : {}),
    ...(productHandle ? { productHandle } : {}),
    ...(collectionHandle ? { collectionHandle } : {}),
  }
}

/** True when `templates/<name>.json` exists in the theme's template glob. */
export function templateExists(templateModules: Record<string, unknown>, name: string): boolean {
  return Object.keys(templateModules).some((k) => k.endsWith(`/${name}.json`))
}

/** `<type>.<suffix>` when the variant file exists, else the default `<type>`. */
export function variantOf(
  templateModules: Record<string, unknown>,
  base: string,
  suffix: string | null | undefined,
): string {
  const candidate = suffix ? `${base}.${suffix}` : base
  return templateExists(templateModules, candidate) ? candidate : base
}
