/**
 * Locale + country resolution for the storefront boot.
 *
 * Both mirror the precedence the `<LocaleSwitch>` chrome uses
 * (`usePersistedChoice` in shell.tsx) so that what the shopper sees in the
 * picker stays in sync with what GraphQL actually returns.
 */

export const DEFAULT_LOCALE = 'en'

/** Bundled UI-string maps keyed by locale code, built from the theme's
 *  `import.meta.glob('./locales/*.json', { eager: true })`. */
export function localeMapsFrom(
  localeModules: Record<string, { default: Record<string, string> }>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(localeModules).map(([path, mod]) => [
      path.match(/\/([^/]+)\.json$/)?.[1] ?? DEFAULT_LOCALE,
      mod.default,
    ]),
  )
}

/**
 * Pick the country (ISO 3166 alpha-2) for this page load:
 *
 *   URL ?country=SG  →  localStorage tq-country  →  undefined (no Market header,
 *                                                   backend uses store base)
 *
 * Runs at boot; switching country in the picker writes to BOTH URL +
 * localStorage and reloads the page.
 */
export function resolveCountry(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const fromUrl = new URLSearchParams(window.location.search).get('country')
  if (fromUrl && /^[A-Za-z]{2}$/.test(fromUrl)) return fromUrl.toUpperCase()
  try {
    const stored = window.localStorage.getItem('tq-country')
    if (stored && /^[A-Za-z]{2}$/.test(stored)) return stored.toUpperCase()
  } catch {
    /* private mode etc. */
  }
  return undefined
}

/**
 * Active UI locale code — URL ?locale= → localStorage `tq-locale` → default.
 * Mirrors resolveCountry + the LocaleSwitch precedence, and only accepts a code
 * the theme actually bundles a string map for (else the switcher would blank
 * the UI).
 */
export function resolveLocale(localeMaps: Record<string, Record<string, string>>): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const norm = (v: string | null): string | null =>
    v && /^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(v) ? v.toLowerCase() : null
  const u = norm(new URLSearchParams(window.location.search).get('locale'))
  if (u && localeMaps[u]) return u
  try {
    const s = norm(window.localStorage.getItem('tq-locale'))
    if (s && localeMaps[s]) return s
  } catch {
    /* private mode etc. */
  }
  return DEFAULT_LOCALE
}

/** The active locale's strings, with the default locale as the fallback base so
 *  a partially-translated locale shows English (not raw keys). */
export function pickLocale(
  localeMaps: Record<string, Record<string, string>>,
): Record<string, string> {
  const baseLocale = localeMaps[DEFAULT_LOCALE] ?? {}
  const code = resolveLocale(localeMaps)
  return code === DEFAULT_LOCALE ? baseLocale : { ...baseLocale, ...(localeMaps[code] ?? {}) }
}

/** The locale code to send to the backend (X-Tanqory-Lang) for content
 *  translation — only when non-default, so default-language requests skip the
 *  translation overlay entirely. */
export function localeHeader(
  localeMaps: Record<string, Record<string, string>>,
): string | undefined {
  const code = resolveLocale(localeMaps)
  return code !== DEFAULT_LOCALE ? code : undefined
}
