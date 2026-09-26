/**
 * The script text injected for a merchant's connected pixel.
 *
 * The pixel wizard's snippets call a BARE `analytics.subscribe(...)`, but nothing defines a global
 * called `analytics` (the theme only exposes `window.tqAnalytics`), so an unwrapped snippet threw a
 * ReferenceError at its first `analytics.subscribe` — no event of any kind (page_viewed included) ever
 * reached the pixel. Wrapping hands the bus in as a parameter without adding a global; the vendor
 * loaders still attach `fbq` / `gtag` / `ttq` to `window` as they always did.
 */
export function wrapPixelCode(code: string): string {
  return `(function(analytics){\n${code}\n})(window.tqAnalytics);`
}
