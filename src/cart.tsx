import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useData, type Money } from './data'

/**
 * Client-side shopping cart for storefront themes.
 *
 * Backed by the Tanqory Storefront GraphQL cart API (Shopify-compatible:
 * `cartCreate` / `cartLinesAdd` / `cartLinesUpdate` / `cartLinesRemove`,
 * merchandise = Variant). The cart id is persisted in localStorage so the
 * cart survives reloads; line data is always sourced from the backend (the
 * single source of truth) and reconciled after every mutation.
 *
 * Two drivers, picked automatically:
 *   - LIVE  — when `useData().graphql` exists (createLiveData). Real mutations.
 *   - MOCK  — when it doesn't (createMockData: editor preview / offline dev).
 *             An in-memory cart so +/- / remove still demonstrate correctly.
 *
 * SSR/SSG-safe: the provider renders an empty cart on the server AND on the
 * first client render (`ready === false`), then hydrates from localStorage +
 * backend in a post-mount effect — so there's never a hydration mismatch.
 */

const STORAGE_KEY = 'tq-cart-id'
const DEFAULT_CURRENCY = 'USD'
// Shopify-ism: single-variant products name their lone variant "Default Title".
// Hide it so single-variant lines don't show a meaningless variant subtitle.
const DEFAULT_VARIANT_TITLE = 'Default Title'

export interface CartLine {
  /** Cart line id — the handle used for update/remove. */
  id: string
  /** The purchasable variant (merchandise) id. */
  variantId: string
  quantity: number
  /** Product title shown in the cart. */
  title: string
  /** Variant title (e.g. "Black / M"); empty for single-variant products. */
  variantTitle?: string
  image?: { url: string; altText?: string } | null
  /** Per-unit price. */
  price: Money
  /** Line subtotal (price × quantity). */
  lineSubtotal: Money
  /** Product handle for linking back to the PDP. */
  productHandle?: string
}

/** A discount code applied to the cart (`applicable=false` when it didn't qualify). */
export interface AppliedDiscountCode {
  code: string
  applicable: boolean
}
/** A gift card applied to the cart — masked (only last 4 chars ever leave the API). */
export interface AppliedGiftCard {
  id: string
  lastCharacters: string
  amountUsed: Money
  balance: Money
}

export interface CartState {
  id: string | null
  lines: CartLine[]
  subtotal: Money
  /** Final amount after discounts + gift cards (cost.totalAmount). */
  total: Money
  /** Estimated tax (cost.totalTaxAmount) — null until known (usually at checkout). */
  tax?: Money | null
  /** Estimated duties (cost.totalDutyAmount) — null unless cross-border. */
  duty?: Money | null
  /** Cart-level order note (Shopify `cart.note`). */
  note?: string | null
  /** Cart-level custom attributes (Shopify `cart.attributes`). */
  attributes?: { key: string; value: string | null }[]
  totalQuantity: number
  checkoutUrl: string | null
  /** Discount codes applied to the cart. */
  discountCodes: AppliedDiscountCode[]
  /** Total savings across all discount allocations — null when nothing's discounted. */
  discountAmount: Money | null
  /** Gift cards applied to the cart. */
  appliedGiftCards: AppliedGiftCard[]
  /** True while a mutation/bootstrap is in flight. */
  loading: boolean
  /** True once the client has hydrated cart state post-mount. */
  ready: boolean
  error: string | null
}

export interface AddToCartInput {
  variantId: string
  quantity?: number
  /** Display data — used only by the in-memory MOCK driver (editor/offline). */
  product?: {
    title: string
    price: Money
    image?: { url: string; altText?: string } | null
    handle?: string
    variantTitle?: string
  }
}

export interface CartApi extends CartState {
  add: (input: AddToCartInput) => Promise<void>
  updateQuantity: (lineId: string, quantity: number) => Promise<void>
  remove: (lineId: string) => Promise<void>
  clear: () => Promise<void>
  /** Apply discount codes (replaces the current set; [] clears them). LIVE only. */
  applyDiscountCodes: (codes: string[]) => Promise<void>
  /** Apply gift card codes to the cart. LIVE only. */
  applyGiftCardCodes: (codes: string[]) => Promise<void>
  /** Remove applied gift cards by id. LIVE only. */
  removeGiftCards: (ids: string[]) => Promise<void>
  /** Set the cart-level order note (Shopify `cart.note`). LIVE only. */
  updateNote: (note: string) => Promise<void>
  /** Replace the cart-level custom attributes (Shopify `cart.attributes`). LIVE only. */
  updateAttributes: (attributes: { key: string; value: string }[]) => Promise<void>
}

// ─── Money helpers (amounts are decimal strings) ──────────────────

function money(amount: number, currencyCode: string): Money {
  return { amount: amount.toFixed(2), currencyCode }
}
function multiply(price: Money, qty: number): Money {
  return money(Number(price.amount) * qty, price.currencyCode)
}
function sumLines(lines: CartLine[]): Money {
  const currencyCode = lines[0]?.lineSubtotal.currencyCode ?? DEFAULT_CURRENCY
  const total = lines.reduce((acc, l) => acc + Number(l.lineSubtotal.amount), 0)
  return money(total, currencyCode)
}
function countQty(lines: CartLine[]): number {
  return lines.reduce((acc, l) => acc + l.quantity, 0)
}

// ─── GraphQL (LIVE driver) ────────────────────────────────────────

const CART_FRAGMENT = /* GraphQL */ `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    note
    attributes { key value }
    cost {
      subtotalAmount { amount currencyCode }
      totalAmount { amount currencyCode }
      totalTaxAmount { amount currencyCode }
      totalDutyAmount { amount currencyCode }
    }
    discountCodes { code applicable }
    discountAllocations {
      ... on CartCodeDiscountAllocation { code discountedAmount { amount currencyCode } }
      ... on CartAutomaticDiscountAllocation { title discountedAmount { amount currencyCode } }
      ... on CartCustomDiscountAllocation { title discountedAmount { amount currencyCode } }
    }
    appliedGiftCards {
      id
      lastCharacters
      amountUsed { amount currencyCode }
      balance { amount currencyCode }
    }
    lines(first: 100) {
      nodes {
        id
        quantity
        cost {
          subtotalAmount { amount currencyCode }
          amountPerQuantity { amount currencyCode }
        }
        merchandise {
          ... on Variant {
            id
            title
            image { url altText }
            price { amount currencyCode }
            product { handle title featuredImage { url altText } }
          }
        }
      }
    }
  }
`
const CART_QUERY = /* GraphQL */ `
  query Cart($id: ID!) { cart(id: $id) { ...CartFields } }
  ${CART_FRAGMENT}
`
const CART_CREATE = /* GraphQL */ `
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) { cart { ...CartFields } userErrors { message } }
  }
  ${CART_FRAGMENT}
`
const CART_LINES_ADD = /* GraphQL */ `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { message } }
  }
  ${CART_FRAGMENT}
`
const CART_LINES_UPDATE = /* GraphQL */ `
  mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { message } }
  }
  ${CART_FRAGMENT}
`
const CART_LINES_REMOVE = /* GraphQL */ `
  mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ...CartFields } userErrors { message } }
  }
  ${CART_FRAGMENT}
`
const CART_DISCOUNT_CODES = /* GraphQL */ `
  mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart { ...CartFields } userErrors { message }
    }
  }
  ${CART_FRAGMENT}
`
const CART_GIFTCARD_UPDATE = /* GraphQL */ `
  mutation CartGiftCardCodesUpdate($cartId: ID!, $giftCardCodes: [String!]!) {
    cartGiftCardCodesUpdate(cartId: $cartId, giftCardCodes: $giftCardCodes) {
      cart { ...CartFields } userErrors { message }
    }
  }
  ${CART_FRAGMENT}
`
const CART_GIFTCARD_REMOVE = /* GraphQL */ `
  mutation CartGiftCardCodesRemove($cartId: ID!, $appliedGiftCardIds: [ID!]!) {
    cartGiftCardCodesRemove(cartId: $cartId, appliedGiftCardIds: $appliedGiftCardIds) {
      cart { ...CartFields } userErrors { message }
    }
  }
  ${CART_FRAGMENT}
`
const CART_NOTE_UPDATE = /* GraphQL */ `
  mutation CartNoteUpdate($cartId: ID!, $note: String) {
    cartNoteUpdate(cartId: $cartId, note: $note) {
      cart { ...CartFields } userErrors { message }
    }
  }
  ${CART_FRAGMENT}
`
const CART_ATTRIBUTES_UPDATE = /* GraphQL */ `
  mutation CartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
    cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
      cart { ...CartFields } userErrors { message }
    }
  }
  ${CART_FRAGMENT}
`

interface GqlCart {
  id: string
  checkoutUrl: string
  totalQuantity: number
  note?: string | null
  attributes?: Array<{ key: string; value: string | null }>
  cost: {
    subtotalAmount: Money
    totalAmount: Money
    totalTaxAmount?: Money | null
    totalDutyAmount?: Money | null
  }
  discountCodes?: Array<{ code: string; applicable: boolean }>
  discountAllocations?: Array<{ discountedAmount: Money; code?: string; title?: string }>
  appliedGiftCards?: Array<{
    id: string
    lastCharacters: string
    amountUsed: Money
    balance: Money
  }>
  lines: {
    nodes: Array<{
      id: string
      quantity: number
      cost: { subtotalAmount: Money; amountPerQuantity: Money }
      merchandise: {
        id: string
        title?: string
        image?: { url: string; altText?: string | null } | null
        price: Money
        product?: {
          handle: string
          title: string
          featuredImage?: { url: string; altText?: string | null } | null
        } | null
      }
    }>
  }
}
interface CartMutationPayload {
  cart: GqlCart | null
  userErrors: Array<{ message: string }>
}

function normalizeImage(
  img: { url: string; altText?: string | null } | null | undefined,
): { url: string; altText?: string } | null {
  if (!img || !img.url) return null
  return { url: img.url, ...(img.altText ? { altText: img.altText } : {}) }
}

/** GqlCart → the cart fields we keep in state (loading/ready/error added by caller). */
function normalizeCart(c: GqlCart): Omit<CartState, 'loading' | 'ready' | 'error'> {
  const lines: CartLine[] = c.lines.nodes.map((n) => {
    const m = n.merchandise
    const variantTitle =
      m.title && m.title !== DEFAULT_VARIANT_TITLE ? m.title : undefined
    return {
      id: n.id,
      variantId: m.id,
      quantity: n.quantity,
      title: m.product?.title ?? m.title ?? 'Item',
      ...(variantTitle ? { variantTitle } : {}),
      image: normalizeImage(m.image) ?? normalizeImage(m.product?.featuredImage),
      price: n.cost.amountPerQuantity ?? m.price,
      lineSubtotal: n.cost.subtotalAmount ?? multiply(m.price, n.quantity),
      ...(m.product?.handle ? { productHandle: m.product.handle } : {}),
    }
  })
  const subtotal = c.cost?.subtotalAmount ?? sumLines(lines)
  // Sum every discount allocation (code + automatic) into one "you saved" figure.
  const allocations = c.discountAllocations ?? []
  const discountAmount =
    allocations.length > 0
      ? money(
          allocations.reduce((acc, a) => acc + Number(a.discountedAmount.amount), 0),
          allocations[0].discountedAmount.currencyCode,
        )
      : null
  return {
    id: c.id,
    lines,
    subtotal,
    total: c.cost?.totalAmount ?? subtotal,
    tax: c.cost?.totalTaxAmount ?? null,
    duty: c.cost?.totalDutyAmount ?? null,
    note: c.note ?? null,
    attributes: (c.attributes ?? []).map((a) => ({ key: a.key, value: a.value ?? null })),
    totalQuantity: c.totalQuantity ?? countQty(lines),
    checkoutUrl: c.checkoutUrl ?? null,
    discountCodes: (c.discountCodes ?? []).map((d) => ({ code: d.code, applicable: d.applicable })),
    discountAmount,
    appliedGiftCards: (c.appliedGiftCards ?? []).map((g) => ({
      id: g.id,
      lastCharacters: g.lastCharacters,
      amountUsed: g.amountUsed,
      balance: g.balance,
    })),
  }
}

// ─── Context ──────────────────────────────────────────────────────

const EMPTY: CartState = {
  id: null,
  lines: [],
  subtotal: { amount: '0.00', currencyCode: DEFAULT_CURRENCY },
  total: { amount: '0.00', currencyCode: DEFAULT_CURRENCY },
  totalQuantity: 0,
  checkoutUrl: null,
  discountCodes: [],
  discountAmount: null,
  appliedGiftCards: [],
  loading: false,
  ready: false,
  error: null,
}

const CartContext = createContext<CartApi | null>(null)

function readStoredCartId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function writeStoredCartId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode etc. */
  }
}

export function CartProvider({ children }: { children: ReactNode }): JSX.Element {
  const data = useData()
  const gql = data.graphql
  const isLive = typeof gql === 'function'

  const [state, setState] = useState<CartState>(EMPTY)
  // Mirror state in a ref so async callbacks read the current cart id / lines
  // without re-creating the callbacks on every change.
  const ref = useRef(state)
  ref.current = state

  const applyCart = useCallback((c: GqlCart) => {
    const next = normalizeCart(c)
    writeStoredCartId(next.id)
    setState((s) => ({ ...s, ...next, loading: false, error: null }))
  }, [])

  const setLocal = useCallback((lines: CartLine[]) => {
    setState((s) => ({
      ...s,
      lines,
      subtotal: sumLines(lines),
      total: sumLines(lines),
      totalQuantity: countQty(lines),
      loading: false,
      error: null,
    }))
  }, [])

  // Hydrate after mount (client-only): restore the saved cart from the backend.
  useEffect(() => {
    let cancelled = false
    async function hydrate(): Promise<void> {
      const id = readStoredCartId()
      if (isLive && gql && id) {
        try {
          const res = await gql<{ cart: GqlCart | null }>(CART_QUERY, { id })
          if (cancelled) return
          if (res.cart) {
            const next = normalizeCart(res.cart)
            setState((s) => ({ ...s, ...next, ready: true }))
            return
          }
          // Cart expired / not found — drop the stale id.
          writeStoredCartId(null)
        } catch {
          // Leave the cart empty but mark ready so the UI stops loading.
        }
      }
      if (!cancelled) setState((s) => ({ ...s, ready: true }))
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [isLive, gql])

  const add = useCallback<CartApi['add']>(
    async (input) => {
      const quantity = input.quantity ?? 1
      if (quantity < 1) return
      if (isLive && gql) {
        setState((s) => ({ ...s, loading: true }))
        try {
          const lines = [{ merchandiseId: input.variantId, quantity }]
          if (!ref.current.id) {
            const res = await gql<{ cartCreate: CartMutationPayload }>(CART_CREATE, { lines })
            const payload = res.cartCreate
            if (payload.cart) applyCart(payload.cart)
            else throw new Error(payload.userErrors[0]?.message ?? 'Could not create cart')
          } else {
            const res = await gql<{ cartLinesAdd: CartMutationPayload }>(CART_LINES_ADD, {
              cartId: ref.current.id,
              lines,
            })
            const payload = res.cartLinesAdd
            if (payload.cart) applyCart(payload.cart)
            else throw new Error(payload.userErrors[0]?.message ?? 'Could not add to cart')
          }
        } catch (e) {
          setState((s) => ({ ...s, loading: false, error: (e as Error).message }))
        }
        return
      }
      // MOCK driver — merge by variant id using the supplied display data.
      const p = input.product
      if (!p) return
      const existing = ref.current.lines.find((l) => l.variantId === input.variantId)
      let lines: CartLine[]
      if (existing) {
        lines = ref.current.lines.map((l) =>
          l.variantId === input.variantId
            ? { ...l, quantity: l.quantity + quantity, lineSubtotal: multiply(l.price, l.quantity + quantity) }
            : l,
        )
      } else {
        lines = [
          ...ref.current.lines,
          {
            id: `mock-${input.variantId}`,
            variantId: input.variantId,
            quantity,
            title: p.title,
            ...(p.variantTitle ? { variantTitle: p.variantTitle } : {}),
            image: p.image ?? null,
            price: p.price,
            lineSubtotal: multiply(p.price, quantity),
            ...(p.handle ? { productHandle: p.handle } : {}),
          },
        ]
      }
      setLocal(lines)
    },
    [isLive, gql, applyCart, setLocal],
  )

  const remove = useCallback<CartApi['remove']>(
    async (lineId) => {
      const optimistic = ref.current.lines.filter((l) => l.id !== lineId)
      setLocal(optimistic)
      if (isLive && gql && ref.current.id) {
        try {
          const res = await gql<{ cartLinesRemove: CartMutationPayload }>(CART_LINES_REMOVE, {
            cartId: ref.current.id,
            lineIds: [lineId],
          })
          if (res.cartLinesRemove.cart) applyCart(res.cartLinesRemove.cart)
        } catch (e) {
          setState((s) => ({ ...s, error: (e as Error).message }))
        }
      }
    },
    [isLive, gql, applyCart, setLocal],
  )

  const updateQuantity = useCallback<CartApi['updateQuantity']>(
    async (lineId, quantity) => {
      if (quantity <= 0) {
        await remove(lineId)
        return
      }
      // Optimistic local update for a snappy stepper, reconciled below (live).
      const optimistic = ref.current.lines.map((l) =>
        l.id === lineId ? { ...l, quantity, lineSubtotal: multiply(l.price, quantity) } : l,
      )
      setLocal(optimistic)
      if (isLive && gql && ref.current.id) {
        try {
          const res = await gql<{ cartLinesUpdate: CartMutationPayload }>(CART_LINES_UPDATE, {
            cartId: ref.current.id,
            lines: [{ id: lineId, quantity }],
          })
          if (res.cartLinesUpdate.cart) applyCart(res.cartLinesUpdate.cart)
        } catch (e) {
          setState((s) => ({ ...s, error: (e as Error).message }))
        }
      }
    },
    [isLive, gql, applyCart, setLocal, remove],
  )

  const clear = useCallback<CartApi['clear']>(async () => {
    const ids = ref.current.lines.map((l) => l.id)
    setLocal([])
    if (isLive && gql && ref.current.id && ids.length > 0) {
      try {
        const res = await gql<{ cartLinesRemove: CartMutationPayload }>(CART_LINES_REMOVE, {
          cartId: ref.current.id,
          lineIds: ids,
        })
        if (res.cartLinesRemove.cart) applyCart(res.cartLinesRemove.cart)
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }))
      }
    }
  }, [isLive, gql, applyCart, setLocal])

  // Shared runner for the discount/gift-card mutations — all return the updated
  // cart + userErrors, all reconcile via applyCart. LIVE-only (cart-level
  // promotions need the backend; the MOCK driver has no concept of them).
  const runCartMutation = useCallback(
    async (query: string, field: string, variables: Record<string, unknown>) => {
      if (!isLive || !gql || !ref.current.id) return
      setState((s) => ({ ...s, loading: true }))
      try {
        const res = await gql<Record<string, CartMutationPayload>>(query, {
          cartId: ref.current.id,
          ...variables,
        })
        const payload = res[field]
        if (payload?.cart) applyCart(payload.cart)
        else throw new Error(payload?.userErrors[0]?.message ?? 'Cart update failed')
      } catch (e) {
        setState((s) => ({ ...s, loading: false, error: (e as Error).message }))
      }
    },
    [isLive, gql, applyCart],
  )

  const applyDiscountCodes = useCallback<CartApi['applyDiscountCodes']>(
    (codes) => runCartMutation(CART_DISCOUNT_CODES, 'cartDiscountCodesUpdate', { discountCodes: codes }),
    [runCartMutation],
  )
  const applyGiftCardCodes = useCallback<CartApi['applyGiftCardCodes']>(
    (codes) => runCartMutation(CART_GIFTCARD_UPDATE, 'cartGiftCardCodesUpdate', { giftCardCodes: codes }),
    [runCartMutation],
  )
  const removeGiftCards = useCallback<CartApi['removeGiftCards']>(
    (ids) => runCartMutation(CART_GIFTCARD_REMOVE, 'cartGiftCardCodesRemove', { appliedGiftCardIds: ids }),
    [runCartMutation],
  )
  const updateNote = useCallback<CartApi['updateNote']>(
    (note) => runCartMutation(CART_NOTE_UPDATE, 'cartNoteUpdate', { note }),
    [runCartMutation],
  )
  const updateAttributes = useCallback<CartApi['updateAttributes']>(
    (attributes) => runCartMutation(CART_ATTRIBUTES_UPDATE, 'cartAttributesUpdate', { attributes }),
    [runCartMutation],
  )

  const value: CartApi = {
    ...state,
    add,
    updateQuantity,
    remove,
    clear,
    applyDiscountCodes,
    applyGiftCardCodes,
    removeGiftCards,
    updateNote,
    updateAttributes,
  }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within <CartProvider>')
  return ctx
}
