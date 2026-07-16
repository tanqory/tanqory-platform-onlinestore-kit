/**
 * Cookie-consent state — the single source of truth the storefront consults
 * before running any tracking (analytics beacon, marketing pixels), so the
 * merchant's Customer-privacy banner actually ENFORCES the shopper's choice.
 *
 * Model: two purposes, `analytics` + `marketing`. The decision persists in
 * localStorage (`tq-cookie-consent`) and a `tq-consent-change` event lets
 * subscribers (pixels, analytics) react live to Accept/Decline/Manage.
 *
 * Gate semantics (`hasConsent`):
 *   - banner NOT required (merchant didn't enable it) → always allowed.
 *   - banner required + undecided → denied (opt-in / GDPR-safe).
 *   - banner required + decided    → the stored purpose flag.
 */
const KEY = 'tq-cookie-consent'
const EVENT = 'tq-consent-change'

export interface Consent {
  analytics: boolean
  marketing: boolean
}

// Set by the theme once shop data is known: is a consent banner in effect?
let bannerRequired = false

export function setBannerRequired(v: boolean): void {
  bannerRequired = v
}
export function isBannerRequired(): boolean {
  return bannerRequired
}

/** The stored decision, or null when the shopper hasn't chosen yet. */
export function getConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    if (raw === 'accepted') return { analytics: true, marketing: true }
    if (raw === 'declined') return { analytics: false, marketing: false }
    const p = JSON.parse(raw) as Partial<Consent>
    return { analytics: !!p.analytics, marketing: !!p.marketing }
  } catch {
    return null
  }
}

export function hasDecided(): boolean {
  return getConsent() !== null
}

export function setConsent(c: Consent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* private mode — the choice just won't persist across reloads */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: c }))
  } catch {
    /* SSR / no window */
  }
}

/** True when `purpose` may run right now (see gate semantics above). */
export function hasConsent(purpose: keyof Consent): boolean {
  if (!bannerRequired) return true
  const c = getConsent()
  return c ? c[purpose] : false
}

/** Subscribe to consent changes; returns an unsubscribe fn. */
export function onConsentChange(cb: (c: Consent) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<Consent>).detail)
  try {
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  } catch {
    return () => {}
  }
}
