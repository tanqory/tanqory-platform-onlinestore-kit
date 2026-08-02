// Storefront API base.
//
// On the CLIENT (browser) use the same-origin storefront host
// ({slug}.mytanqory.com / preview-<themeId>.mytanqory.com) so store-api stays
// INTERNAL per endpoint-map §2-4 — the browser never addresses api-<cell>
// directly; the edge + cell ingress route /api/v1/* to the cell's store-api.
//
// On the SERVER (SSR / prerender, runs inside the theme-runtime pod) there is no
// origin, so fall back to the build-time backend (VITE_TANQORY_BACKEND, an
// internal/cell URL). SSR behavior is unchanged → no regression.
export function apiBase(fallback?: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return (fallback || '').replace(/\/$/, '')
}
