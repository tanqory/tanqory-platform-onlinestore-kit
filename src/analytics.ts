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
 * CUSTOMER EVENTS (Shopify Web Pixels-style): every `track()` also publishes to
 * a client-side bus so the merchant's CONNECTED pixels (Settings → Customer
 * events, injected by the theme's TrackingPixels) can react to live shopper
 * actions. A pixel subscribes with `window.tqAnalytics.subscribe(name, cb)`.
 * Bus delivery is gated on MARKETING consent (pixels are tracking); the internal
 * telemetry POST is gated separately on ANALYTICS consent.
 */

import { hasConsent } from './consent'

const VISITOR_KEY = 'tq-visitor-id'
const SESSION_KEY = 'tq-session'
const SESSION_TTL_MS = 30 * 60 * 1000
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
  | 'SEARCH_SUBMITTED'

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
}

export interface AnalyticsOptions {
  storeId: string
  endpoint?: string
  batchSize?: number
  /** Optional consent gate — return false to drop events (GDPR). Defaults to on. */
  consent?: () => boolean
}

const NOOP: Analytics = { track() {}, pageViewed() {}, flush() {}, subscribe: () => () => {} }

// ── Customer-event bus (Shopify Web Pixels-style) ─────────────────────────────
// Module-scoped so the injected `window.tqAnalytics.subscribe` and the active
// analytics instance share one stream. Pixels load AFTER the first events fire,
// so a small buffer replays recent events to late subscribers.
const ALL_EVENTS = 'all_events'
const REPLAY_MAX = 50
const busSubscribers = new Map<string, Set<(e: StorefrontEvent) => void>>()
const busReplay: StorefrontEvent[] = []

function busPublish(evt: StorefrontEvent): void {
  // Pixels are marketing/tracking — deliver (and retain) only once the shopper
  // allows it. Pre-consent events are never buffered (privacy-safe).
  if (!hasConsent('marketing')) return
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

/** Rolling 30-minute session id (Shopify/GA-style). Refreshed on each event. */
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
      properties,
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

  const api: Analytics = {
    track,
    pageViewed: (properties = {}) =>
      track('PAGE_VIEWED', { pageUrl: location.href, pageTitle: document.title, ...properties }),
    flush: send,
    subscribe,
  }
  activeAnalytics = api
  return api
}
