import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useData, type Product } from '../../data'
import type { Article, PredictiveSearchResults } from '../../storefront'

export interface StorefrontSearchOptions {
  /** Only run while the surface is visible (e.g. the search overlay is open). */
  active?: boolean
  /** Wait this long after the last keystroke before querying. Default 200ms. */
  debounceMs?: number
  /** Cap on the product hits handed back. Default 6. */
  maxResults?: number
}

export interface StorefrontSearchState {
  term: string
  setTerm: (term: string) => void
  clear: () => void
  /** The term the current `results` were produced for (post-debounce, trimmed). */
  query: string
  products: Product[]
  collections: Array<{ handle: string; title: string; image?: unknown }>
  pages: Array<{ handle: string; title: string }>
  articles: Article[]
  /** Query completions from the backend (empty in the local fallback). */
  suggestions: string[]
  /** True while a predictive request for the current term is in flight. */
  loading: boolean
  /**
   * Where `products` came from:
   *   'predictive' — the storefront `predictiveSearch` query (real search:
   *                  ranking, synonyms, description/tag matches, collections,
   *                  pages, articles)
   *   'local'      — the offline fallback: a title `includes()` filter over the
   *                  bootstrap product list. Editor canvas / mock mode / a
   *                  failed request.
   *   'idle'       — no query yet.
   */
  source: 'predictive' | 'local' | 'idle'
}

/**
 * Search-as-you-type against the REAL storefront index, headless.
 *
 * Debounces, then calls `data.predictiveSearch()`. Responses are sequence-
 * guarded: typing again invalidates the in-flight request, so a slow early
 * response can never overwrite the results for what the customer has since
 * typed (the classic out-of-order autocomplete bug).
 *
 * Falls back to the previous client-side title filter over the bootstrap
 * products when `predictiveSearch` is unavailable or the request fails — the
 * editor canvas and offline/mock mode keep working exactly as before.
 */
export function useStorefrontSearch(
  options: StorefrontSearchOptions = {},
): StorefrontSearchState {
  const { active = true, debounceMs = 200, maxResults = 6 } = options
  const data = useData()
  const predictiveSearch = data.predictiveSearch

  const [term, setTerm] = useState('')
  const [query, setQuery] = useState('')
  // `for` pins the response to the term it answered, so a result is never
  // shown next to a different query.
  const [remote, setRemote] = useState<{ for: string; res: PredictiveSearchResults } | null>(null)
  const [loading, setLoading] = useState(false)
  // Monotonic request id — only the newest request may commit its result.
  const seq = useRef(0)

  // Reset when the surface closes so reopening starts clean, and abandon any
  // in-flight request (its result can no longer commit).
  useEffect(() => {
    if (!active) {
      seq.current += 1
      setTerm('')
      setQuery('')
      setRemote(null)
      setLoading(false)
    }
  }, [active])

  // Debounce the input so we don't issue a request per keystroke.
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => setQuery(term.trim()), debounceMs)
    return () => window.clearTimeout(id)
  }, [term, debounceMs, active])

  useEffect(() => {
    if (!active) return
    const id = ++seq.current
    if (!query || !predictiveSearch) {
      setRemote(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void predictiveSearch(query, { limit: maxResults })
      .then((res) => {
        if (seq.current !== id) return // superseded — discard
        setRemote({ for: query, res })
        setLoading(false)
      })
      .catch(() => {
        if (seq.current !== id) return
        // Leave the local fallback in place rather than blanking the list.
        setRemote(null)
        setLoading(false)
      })
    return () => {
      // Unmount / new query: invalidate this request's right to commit.
      if (seq.current === id) seq.current += 1
    }
  }, [query, predictiveSearch, maxResults, active])

  // Offline fallback — flatten products across collections + dedupe by handle
  // (same canonical product takes its first collection appearance, matching the
  // bootstrap dedup in createMockData).
  const allProducts = useMemo(() => {
    const seen = new Set<string>()
    const out: Product[] = []
    for (const c of data.allCollections()) {
      for (const p of c.products) {
        if (!seen.has(p.handle)) {
          seen.add(p.handle)
          out.push(p)
        }
      }
    }
    return out
  }, [data])

  const localResults = useMemo(() => {
    if (!query) return []
    const q = query.toLowerCase()
    return allProducts.filter((p) => p.title.toLowerCase().includes(q)).slice(0, maxResults)
  }, [allProducts, query, maxResults])

  // Predictive results are only used while they answer the CURRENT query.
  // Until then (first keystrokes, slow network, request failed) the local
  // filter renders — instant feedback, and identical to the pre-hook behaviour.
  const hit = remote && remote.for === query ? remote.res : null

  const clear = useCallback(() => setTerm(''), [])

  return {
    term,
    setTerm,
    clear,
    query,
    products: hit ? hit.products.slice(0, maxResults) : localResults,
    collections: hit ? hit.collections : [],
    pages: hit ? hit.pages : [],
    articles: hit ? hit.articles : [],
    suggestions: hit ? hit.queries : [],
    loading,
    source: !query ? 'idle' : hit ? 'predictive' : 'local',
  }
}
