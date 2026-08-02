import { useEffect, useState } from 'react'
import { setConsent, setBannerRequired, hasDecided } from '../../consent'
import { useData } from '../../data'
import { Link } from './Link'

interface BannerConfig {
  enabled?: boolean
  title?: string | null
  body?: string | null
  acceptLabel?: string | null
  declineLabel?: string | null
  manageLabel?: string | null
  position?: string | null
  colorTheme?: string | null
}

/**
 * Cookie-consent banner — shown site-wide when the merchant enables it in
 * Settings → Customer privacy. Renders the merchant's configured copy/labels/
 * position/theme (not hardcoded) and ENFORCES the choice: Accept/Decline/Manage
 * write the consent state that TrackingPixels + analytics gate on. Lives in the
 * layout Shell, so it wraps every page.
 */
export function CookieConsent(): JSX.Element | null {
  const { shop } = useData()
  const cfg = ((shop as { cookieBanner?: BannerConfig })?.cookieBanner ?? {}) as BannerConfig
  const enabled = Boolean(cfg.enabled)
  const [show, setShow] = useState(false)
  const [managing, setManaging] = useState(false)
  const [analytics, setAnalytics] = useState(true)
  const [marketing, setMarketing] = useState(true)

  useEffect(() => {
    // Tell the consent layer whether a banner is in effect (this gates tracking).
    setBannerRequired(enabled)
    if (enabled && !hasDecided()) setShow(true)
  }, [enabled])

  if (!enabled || !show) return null

  const decide = (a: boolean, m: boolean): void => {
    setConsent({ analytics: a, marketing: m })
    setShow(false)
  }

  const position = cfg.position === 'top' ? 'cookie-consent--top' : 'cookie-consent--bottom'
  const theme = cfg.colorTheme === 'dark' ? 'cookie-consent--dark' : 'cookie-consent--light'

  return (
    <div
      className={`cookie-consent ${position} ${theme}`}
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="cookie-consent__inner">
        <div className="cookie-consent__copy">
          {/* Defaulted, not gated — matching the dashboard's own preview, which
              shows "Cookie consent" while saving an empty string. */}
          <strong className="cookie-consent__title">{cfg.title || 'Cookie consent'}</strong>
          <p className="cookie-consent__text">
            {cfg.body || 'We use cookies to improve your experience.'}{' '}
            <Link href="/policies/privacy-policy">Privacy Policy</Link>.
          </p>
        </div>

        {managing ? (
          <div className="cookie-consent__manage">
            <label className="cookie-consent__toggle">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              Analytics
            </label>
            <label className="cookie-consent__toggle">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
              />
              Marketing
            </label>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => decide(analytics, marketing)}
            >
              {cfg.acceptLabel || 'Save'}
            </button>
          </div>
        ) : (
          <div className="cookie-consent__actions">
            {/* Always rendered. This used to be gated on `cfg.manageLabel`, so a
                blank label removed the ONLY route to granular consent and left
                shoppers with Accept/Decline — which is the thing GDPR/CCPA
                actually require. A missing label is a missing label; it is not
                permission to drop the control. Default the text instead. */}
            <button type="button" className="btn btn--ghost" onClick={() => setManaging(true)}>
              {cfg.manageLabel || 'Manage preferences'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => decide(false, false)}>
              {cfg.declineLabel || 'Decline'}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => decide(true, true)}>
              {cfg.acceptLabel || 'Accept'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
