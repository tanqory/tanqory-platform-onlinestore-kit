/**
 * Storefront analytics — emit customer events to store-api's analytics pipeline
 * so the merchant's dashboards (sessions, device type, reports, live view)
 * populate. The batch is POSTed SAME-ORIGIN to `/api/v1/analytics/events/batch`
 * (the edge worker forwards it to the store's cell — no CORS); the endpoint is
 * public. Payload matches store-api's EventBatchSchema exactly:
 *   { storeId, sessionId, visitorId (all UUIDs), events[1..50], context }
 *
 * The theme creates ONE analytics instance for the real storefront (never in the
 * editor/preview plane) and calls `pageViewed()` on each route + the product/
 * cart/checkout emitters from the matching sections.
 *
 * CUSTOMER EVENTS (standard web-pixel): every `track()` also publishes to
 * a client-side bus so the merchant's CONNECTED pixels (Settings → Customer
 * events, injected by the theme's TrackingPixels) can react to live shopper
 * actions. A pixel subscribes with `window.tqAnalytics.subscribe(name, cb)`.
 * Bus delivery is gated on MARKETING consent (pixels are tracking); the internal
 * telemetry POST is gated separately on ANALYTICS consent.
 */

import { getConsent } from './consent'

const VISITOR_KEY = 'tq-visitor-id'
const SESSION_KEY = 'tq-session'
const SESSION_TTL_MS = 30 * 60 * 1000
const SENT_KEY = 'tq-px-sent'
const DEFAULT_ENDPOINT = '/api/v1/analytics/events/batch'

/** store-api SessionEventType values we emit from the storefront. */
export type StorefrontEventType =
  | 'PAGE_VIEWED'
  | 'COLLECTION_VIEWED'
  | 'PRODUCT_VIEWED'
  | 'PRODUCT_ADDED_TO_CART'
  | 'PRODUCT_REMOVED_FROM_CART'
  | 'CART_VIEWED'
  | 'CHECKOUT_STARTED'
  | 'CHECKOUT_COMPLETED'
  | 'SEARCH_SUBMITTED'

/**
 * `checkout_completed` — the CONFIRMED order (the event every purchase pixel binds to: Meta Purchase,
 * GA4 purchase, Google Ads conversion, TikTok CompletePayment, Pinterest checkout, Snapchat PURCHASE,
 * X Purchase). The shape is the one the pixel wizard's snippets read
 * (`event.data.checkout.totalPrice.{amount,currencyCode}`, `.lineItems[].variant.id/.title`,
 * `.order.id`). `currencyCode` is ALWAYS the order's own currency — a producer that cannot state it must
 * not emit the event. The buyer's email, if included, is a SHA-256 of the normalised address, never raw.
 * Producers (the checkout app, or a theme that renders its own thank-you) must publish once per order:
 * see `Analytics.checkoutCompleted`.
 */
export interface CheckoutCompletedData {
  checkout: {
    currencyCode: string
    totalPrice: { amount: number; currencyCode: string }
    subtotalPrice?: { amount: number; currencyCode: string }
    totalTax?: { amount: number; currencyCode: string }
    lineItems: Array<{
      title: string
      quantity: number
      variant: { id: string | null; sku?: string | null; price?: { amount: number; currencyCode: string } | null }
    }>
    order: { id: string; number?: string | number | null }
    emailSha256?: string
  }
}

/** The normalized event delivered to pixel subscribers on the client bus. */
export interface StorefrontEvent {
  /** Unique per emission (UUID). */
  id: string
  /** Lowercase contract name, e.g. `product_added_to_cart`. */
  name: string
  /** The store-api SessionEventType. */
  type: StorefrontEventType
  /** ISO-8601. */
  timestamp: string
  /** Event-specific payload (product id, query, quantity…). */
  data: Record<string, unknown>
  /** Session context (userAgent, referrer, utm, screen, locale, timezone). */
  context: Record<string, unknown>
}

export interface Analytics {
  /** Queue an event; flushes automatically at batchSize / on page hide. */
  track(type: StorefrontEventType, properties?: Record<string, unknown>): void
  /** Convenience for the current page. */
  pageViewed(properties?: Record<string, unknown>): void
  /** Force-send the queued events now. */
  flush(): void
  /** Subscribe to customer events (for pixels/apps). See `subscribe()`. */
  subscribe(eventName: string, cb: (e: StorefrontEvent) => void): () => void
  /**
   * Publish `checkout_completed` for a confirmed order — AT MOST ONCE per order id (remembered in
   * localStorage, so a reload of the thank-you page does not double-count a purchase). Returns whether
   * it was published. Refuses (false) without a valid ISO-4217 currency or an order id: no default.
   * Consent: an EXPLICIT marketing grant is required (deny until decided) and Global Privacy Control
   * blocks it — independent of the store's banner setting.
   */
  checkoutCompleted(data: CheckoutCompletedData): boolean
}

export interface AnalyticsOptions {
  storeId: string
  endpoint?: string
  batchSize?: number
  /** Optional consent gate — return false to drop events (GDPR). Defaults to on. */
  consent?: () => boolean
}

const NOOP: Analytics = {
  track() {},
  pageViewed() {},
  flush() {},
  subscribe: () => () => {},
  checkoutCompleted: () => false,
}

// ── Customer-event bus (standard web-pixel) ─────────────────────────────
// Module-scoped so the injected `window.tqAnalytics.subscribe` and the active
// analytics instance share one stream. Pixels load AFTER the first events fire,
// so a small buffer replays recent events to late subscribers.
const ALL_EVENTS = 'all_events'
const REPLAY_MAX = 50
const busSubscribers = new Map<string, Set<(e: StorefrontEvent) => void>>()
const busReplay: StorefrontEvent[] = []

/**
 * The gate for EVERY pixel path — injection of the merchant's pixel scripts, delivery of every event on
 * the bus, and the purchase. Stricter than `hasConsent`, on purpose: `hasConsent` allows everything when
 * no banner is configured (fail-open) and does not read Global Privacy Control. A purchase carries the
 * order value and a hashed email to every connected ad pixel, so it is delivered only on an explicit
 * decision — GPC on → never; no stored decision → never; else the stored `marketing` flag — whatever
 * the store's banner setting says (kit contract: deny until decided).
 */
export function pixelConsent(): boolean {
  try {
    if ((navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return false
  } catch {
    /* no navigator: fall through to the stored decision */
  }
  return getConsent()?.marketing === true
}

function withoutEmailHash(properties: Record<string, unknown>): Record<string, unknown> {
  const checkout = properties.checkout
  if (!checkout || typeof checkout !== 'object') return properties
  const { emailSha256: _dropped, ...rest } = checkout as Record<string, unknown>
  return { ...properties, checkout: rest }
}

function busPublish(evt: StorefrontEvent): void {
  // Pixels are marketing/tracking — deliver (and retain) only once the shopper
  // allows it. Pre-consent events are never buffered (privacy-safe).
  if (!pixelConsent()) return
  busReplay.push(evt)
  if (busReplay.length > REPLAY_MAX) busReplay.shift()
  const fire = (set?: Set<(e: StorefrontEvent) => void>) => {
    if (!set) return
    for (const cb of set) {
      try {
        cb(evt)
      } catch {
        /* one pixel throwing must never break the others or the page */
      }
    }
  }
  fire(busSubscribers.get(evt.name))
  fire(busSubscribers.get(ALL_EVENTS))
}

/**
 * Subscribe a pixel (or app) to storefront customer events. Pass a contract
 * name (`product_added_to_cart`, `checkout_started`, …) or `all_events` for
 * every event. Recently-fired events replay immediately, so a pixel injected
 * mid-session still receives them. Returns an unsubscribe fn.
 */
export function subscribe(eventName: string, cb: (e: StorefrontEvent) => void): () => void {
  let set = busSubscribers.get(eventName)
  if (!set) {
    set = new Set()
    busSubscribers.set(eventName, set)
  }
  set.add(cb)
  for (const e of busReplay) {
    if (eventName === ALL_EVENTS || e.name === eventName) {
      try {
        cb(e)
      } catch {
        /* ignore */
      }
    }
  }
  return () => {
    set?.delete(cb)
  }
}

// The active instance, so any section can emit via getAnalytics() without the
// theme threading the instance through props/context.
let activeAnalytics: Analytics = NOOP

/** The storefront's active analytics instance (or a no-op before creation). */
export function getAnalytics(): Analytics {
  return activeAnalytics
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // RFC4122-ish fallback for the rare browser without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function persistentId(key: string): string {
  try {
    let v = localStorage.getItem(key)
    if (!v) {
      v = uuid()
      localStorage.setItem(key, v)
    }
    return v
  } catch {
    return uuid()
  }
}

/** Rolling 30-minute session id (the commerce standard/GA-style). Refreshed on each event. */
function sessionId(): string {
  const now = Date.now()
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) {
      const s = JSON.parse(raw) as { id: string; at: number }
      if (s.id && now - s.at < SESSION_TTL_MS) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ id: s.id, at: now }))
        return s.id
      }
    }
    const id = uuid()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }))
    return id
  } catch {
    return uuid()
  }
}

function buildContext(): Record<string, unknown> {
  const params = new URLSearchParams(location.search)
  const utm: Record<string, string> = {}
  for (const [k, dest] of [
    ['utm_source', 'source'],
    ['utm_medium', 'medium'],
    ['utm_campaign', 'campaign'],
    ['utm_term', 'term'],
    ['utm_content', 'content'],
  ] as const) {
    const v = params.get(k)
    if (v) utm[dest] = v
  }
  return {
    userAgent: navigator.userAgent,
    referrer: document.referrer || '',
    ...(Object.keys(utm).length ? { utm } : {}),
    screen: { width: window.screen.width, height: window.screen.height },
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

export function createAnalytics(opts: AnalyticsOptions): Analytics {
  if (typeof window === 'undefined' || !opts.storeId) return NOOP
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT
  const batchSize = opts.batchSize ?? 10
  const consent = opts.consent ?? (() => true)
  const queue: Array<{ eventName: string; eventType: string; timestamp: string; properties: unknown }> = []

  const send = () => {
    if (!queue.length || !consent()) {
      queue.length = 0
      return
    }
    const batch = {
      storeId: opts.storeId,
      sessionId: sessionId(),
      visitorId: persistentId(VISITOR_KEY),
      events: queue.splice(0, 50),
      context: buildContext(),
    }
    const body = JSON.stringify(batch)
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      } else {
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    } catch {
      /* best-effort telemetry — never throw into the storefront */
    }
  }

  const track: Analytics['track'] = (type, properties = {}) => {
    // Publish to the pixel bus FIRST (its own marketing-consent gate), so
    // marketing pixels still fire even when analytics telemetry is declined.
    busPublish({
      id: uuid(),
      name: type.toLowerCase(),
      type,
      timestamp: new Date().toISOString(),
      data: properties,
      context: buildContext(),
    })
    // Internal telemetry POST — gated on analytics consent.
    if (!consent()) return
    queue.push({
      eventName: type.toLowerCase(),
      eventType: type,
      timestamp: new Date().toISOString(),
      // The buyer's hashed email is for the merchant's ad pixels only; it never rides our beacon.
      properties: type === 'CHECKOUT_COMPLETED' ? withoutEmailHash(properties) : properties,
    })
    if (queue.length >= batchSize) send()
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send()
  })
  window.addEventListener('pagehide', send)

  // Expose the subscribe surface for injected pixel scripts (idempotent).
  ;(window as unknown as { tqAnalytics?: { subscribe: typeof subscribe } }).tqAnalytics ??= {
    subscribe,
  }

  const checkoutCompleted: Analytics['checkoutCompleted'] = (data) => {
    const c = data?.checkout
    const orderId = c?.order?.id
    const cur = c?.totalPrice?.currencyCode
    if (!orderId || typeof cur !== 'string' || !/^[A-Z]{3}$/.test(cur) || c.currencyCode !== cur) return false
    const key = `checkout_completed:${orderId}`
    // Only remember an order once the bus was actually allowed to deliver it (consent), otherwise a
    // purchase seen before consent would be lost for good.
    if (!pixelConsent()) return false
    try {
      const sent = JSON.parse(localStorage.getItem(SENT_KEY) || '[]') as string[]
      if (sent.includes(key)) return false
      localStorage.setItem(SENT_KEY, JSON.stringify([...sent, key].slice(-200)))
    } catch {
      /* no storage: publish anyway; dedupe holds for this page load only */
    }
    track('CHECKOUT_COMPLETED', data as unknown as Record<string, unknown>)
    return true
  }

  const api: Analytics = {
    track,
    checkoutCompleted,
    pageViewed: (properties = {}) =>
      track('PAGE_VIEWED', { pageUrl: location.href, pageTitle: document.title, ...properties }),
    flush: send,
    subscribe,
  }
  activeAnalytics = api
  return api
}
