/**
 * A handle read out of `location.pathname` is percent-encoded — the stored
 * handle is not. A Thai or CJK handle ("เสื้อยืด") arrives as "%E0%B9%80…",
 * matches nothing, and the route silently falls back to whatever record is
 * first — the wrong product, or a blank page. Decode every handle taken from
 * a URL.
 *
 * Malformed input (a stray `%` in a handle) keeps the raw segment rather than
 * throwing URIError, which would take the whole render down.
 */
export function decodeHandle(raw: string): string
export function decodeHandle(raw: string | undefined): string | undefined
export function decodeHandle(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** First capture of `re` against the current pathname, decoded. SSR-safe. */
export function handleFromPath(re: RegExp): string | undefined {
  if (typeof window === 'undefined') return undefined
  return decodeHandle(window.location.pathname.match(re)?.[1])
}
