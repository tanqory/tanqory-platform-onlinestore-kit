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
 */

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

export interface Analytics {
  /** Queue an event; flushes automatically at batchSize / on page hide. */
  track(type: StorefrontEventType, properties?: Record<string, unknown>): void
  /** Convenience for the current page. */
  pageViewed(properties?: Record<string, unknown>): void
  /** Force-send the queued events now. */
  flush(): void
}

export interface AnalyticsOptions {
  storeId: string
  endpoint?: string
  batchSize?: number
  /** Optional consent gate — return false to drop events (GDPR). Defaults to on. */
  consent?: () => boolean
}

const NOOP: Analytics = { track() {}, pageViewed() {}, flush() {} }

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

  return {
    track,
    pageViewed: (properties = {}) =>
      track('PAGE_VIEWED', { pageUrl: location.href, pageTitle: document.title, ...properties }),
    flush: send,
  }
}
