import { useCallback, useEffect, useState } from 'react'
import { useData } from '../../data'
import { customerTokenStore, type Customer, type Order } from '../../storefront'

export type CustomerAccountStatus = 'loading' | 'signed-out' | 'signed-in' | 'error'

export interface CustomerAccountState {
  status: CustomerAccountStatus
  /** True until the first resolution settles. */
  loading: boolean
  signedIn: boolean
  customer: Customer | null
  orders: Order[]
  /** Set only for `status === 'error'` (the request itself failed). */
  error: string | null
  /** Sign-in href that returns the customer to the page they were on. */
  loginHref: string
  /** Drop the stored token and re-resolve as signed-out. */
  signOut: () => void
  /** Re-read the token and refetch. */
  refresh: () => void
}

export interface CustomerSession {
  /** null until the probe settles — render the merchant's preview default. */
  signedIn: boolean | null
  email?: string
  firstName?: string
  /** `firstName || email` — what the header greets the customer by. */
  displayName: string
  /** Sign-in href carrying `?return_to=<current page>`. */
  loginHref: string
}

interface SessionPayload {
  signedIn: boolean
  email?: string
  firstName?: string
}

/**
 * Is there a signed-in customer RIGHT NOW — the cheap question the header
 * account menu asks on every page.
 *
 * The customer cookie is HttpOnly, so this probes the same-origin account
 * portal at `/account/session` (the storefront router mounts it on every
 * storefront domain). Distinct from `useCustomerAccount`, which loads the
 * customer RECORD with the storefront access token; the header only needs
 * yes/no + a name and must not pay for a GraphQL round trip.
 *
 * `signedIn` stays null while the probe is in flight and in surfaces that have
 * no portal (editor canvas, dev server), so the caller can fall back to the
 * merchant's preview toggle instead of flashing a wrong state.
 */
export function useCustomerSession(): CustomerSession {
  const [session, setSession] = useState<SessionPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/account/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SessionPayload | null) => {
        if (!cancelled && j && typeof j.signedIn === 'boolean') setSession(j)
      })
      .catch(() => {
        // Editor preview / dev server has no account portal — leave null.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    signedIn: session ? session.signedIn : null,
    email: session?.email,
    firstName: session?.firstName,
    displayName: session?.firstName || session?.email || '',
    loginHref: loginHrefForHere(),
  }
}

/** Sign-in href carrying `?return_to=<current page>` for the OTP round trip. */
function loginHrefForHere(): string {
  const here =
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
  return `/account/login?return_to=${encodeURIComponent(here)}`
}

/**
 * The signed-in customer + their orders, headless.
 *
 * The storefront customer API is TOKEN-scoped: `customer.get(token)` and
 * `customer.orders(token)` put that token into the GraphQL request as
 * `customer(customerAccessToken: …)`. Calling them with no argument returns
 * null for a customer who IS signed in — which is what every theme did, so no
 * account page has ever shown an order. The token lives in
 * `customerTokenStore` (localStorage, written by the login flow); this hook is
 * the single place that reads it.
 *
 * "No token" is a STATE, not a failure: it resolves straight to `signed-out`
 * without a network call and without an error, so the signed-out UI paints
 * immediately (and the editor canvas / mock mode behave exactly as before).
 */
export function useCustomerAccount(options: { orderLimit?: number } = {}): CustomerAccountState {
  const { orderLimit } = options
  const { customer: customerApi } = useData()
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{
    status: CustomerAccountStatus
    customer: Customer | null
    orders: Order[]
    error: string | null
  }>({ status: 'loading', customer: null, orders: [], error: null })

  useEffect(() => {
    let alive = true
    const token = customerTokenStore.get()

    // Signed out — no token to send, so there is nothing to ask the backend.
    if (!token || !customerApi?.get) {
      setState({ status: 'signed-out', customer: null, orders: [], error: null })
      return
    }

    setState((s) => (s.status === 'loading' ? s : { ...s, status: 'loading' }))
    void (async () => {
      try {
        const me = await customerApi.get(token)
        if (!alive) return
        if (!me) {
          // Token present but rejected (expired / revoked). Clear it so the
          // next paint — and every other surface reading the store — agrees.
          customerTokenStore.clear()
          setState({ status: 'signed-out', customer: null, orders: [], error: null })
          return
        }
        let orders: Order[] = []
        try {
          orders = customerApi.orders
            ? await customerApi.orders(token, orderLimit ? { first: orderLimit } : undefined)
            : []
        } catch {
          // A customer with an unreadable order list is still signed in.
          orders = []
        }
        if (!alive) return
        setState({
          status: 'signed-in',
          customer: me,
          orders: Array.isArray(orders) ? orders : [],
          error: null,
        })
      } catch (err) {
        if (!alive) return
        setState({
          status: 'error',
          customer: null,
          orders: [],
          error: (err as Error)?.message ?? 'Could not load your account.',
        })
      }
    })()

    return () => {
      alive = false
    }
  }, [customerApi, orderLimit, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  const signOut = useCallback(() => {
    customerTokenStore.clear()
    setNonce((n) => n + 1)
  }, [])

  return {
    status: state.status,
    loading: state.status === 'loading',
    signedIn: state.status === 'signed-in',
    customer: state.customer,
    orders: state.orders,
    error: state.error,
    loginHref: loginHrefForHere(),
    signOut,
    refresh,
  }
}
