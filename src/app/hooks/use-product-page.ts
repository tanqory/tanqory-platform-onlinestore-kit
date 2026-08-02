import { useEffect, useMemo, useState } from 'react'
import { getAnalytics } from '../../analytics'
import { useCart } from '../../cart'
import { useData, type Product } from '../../data'
import { handleFromPath } from '../lib/handle'
import { openOverlay } from '../components/useOverlayChannel'
import type { ProductContextValue } from '../components/product-context'

/** A variant with no real options is titled this by the backend — not shown. */
const DEFAULT_VARIANT_TITLE = 'Default Title'

const PRODUCT_ROUTE = /\/products\/([^/]+)/

/** The subset of a PDP section's resolved attributes this hook reads. */
export interface ProductPageAttributes {
  /**
   * Editor-only override — the `product` picker on the section. The URL
   * `:handle` is canonical on a live storefront; this exists so the merchant
   * can preview a specific product while composing the template.
   */
  product?: unknown
  [key: string]: unknown
}

/**
 * The whole product-detail state machine, headless.
 *
 * A theme that wants its OWN product page writes markup only and reads
 * everything about money, variants and analytics from here — so no theme can
 * ship a PDP that adds the wrong merchandise id, forgets to fire
 * `PRODUCT_ADDED_TO_CART`, or shows a price that doesn't match the variant the
 * customer actually selected. Those are exactly the bugs that used to be
 * copy-pasted into 13 themes at once.
 *
 * What it owns:
 *   - the handle: `attributes.product` (editor override) → `/products/:handle`
 *     from `location.pathname`, decoded (Unicode handles arrive percent-encoded)
 *   - the product: `productByHandle` from the bootstrap, then a lazy
 *     `fetchProduct` upgrade for the full option/variant set (the bootstrap
 *     only carries a default variant id — keeps the homepage payload cheap)
 *   - option → variant matching, seeded from the first available variant
 *   - quantity, `adding`, `soldOut`, `displayPrice`, `variantImage`
 *   - `add()`: cart mutation → `PRODUCT_ADDED_TO_CART` → open the cart overlay,
 *     in that order (the event must describe a line that exists)
 *
 * Returns `null` when no product resolves — the section renders its own
 * not-found markup. All hooks run before that, so the null is safe to branch on.
 */
export function useProductPage(attributes?: ProductPageAttributes): ProductContextValue | null {
  const { productByHandle, collectionByHandle, fetchProduct, graphql } = useData()
  const cart = useCart()
  const isLive = typeof graphql === 'function'

  const handleFromUrl = handleFromPath(PRODUCT_ROUTE)
  const handle = (attributes?.product as string | undefined) || handleFromUrl
  const baseProduct =
    (handle ? productByHandle(handle) : null) ??
    collectionByHandle('all')?.products?.[0] ??
    null

  // Lazily upgrade to the full product (options + variants) for the picker.
  const [detail, setDetail] = useState<Product | null>(null)
  useEffect(() => {
    let cancelled = false
    const h = baseProduct?.handle
    if (!h || !fetchProduct) return
    void fetchProduct(h).then((p) => {
      if (!cancelled && p) setDetail(p)
    })
    return () => {
      cancelled = true
    }
  }, [baseProduct?.handle, fetchProduct])

  const product = detail ?? baseProduct
  const options = product?.options ?? []
  const variants = product?.variants ?? []

  // Selected option values (Size → "M", Color → "Black"). Seeded from the
  // first available variant once the full product loads.
  const [selected, setSelected] = useState<Record<string, string>>({})
  useEffect(() => {
    const seed = variants.find((v) => v.availableForSale) ?? variants[0]
    if (seed?.selectedOptions?.length) {
      setSelected(Object.fromEntries(seed.selectedOptions.map((o) => [o.name, o.value])))
    }
  }, [variants])

  const selectedVariant = useMemo(() => {
    if (!variants.length) return undefined
    if (!options.length) return variants[0]
    return variants.find((v) =>
      (v.selectedOptions ?? []).every((o) => selected[o.name] === o.value),
    )
  }, [variants, options, selected])

  const [adding, setAdding] = useState(false)
  const [quantity, setQuantity] = useState(1)

  const displayPrice = selectedVariant?.price ?? product?.price
  const variantImage = selectedVariant?.image ?? product?.featuredImage

  // Resolve the merchandise id to add. Live: a real variant id (selected →
  // default). Mock (editor/offline): a stable pseudo id keyed by handle so the
  // in-memory cart still works without a backend.
  const variantId =
    selectedVariant?.id ??
    product?.variantId ??
    (!isLive && product ? `mock:${product.handle}` : undefined)

  const variantTitle =
    selectedVariant?.title && selectedVariant.title !== DEFAULT_VARIANT_TITLE
      ? selectedVariant.title
      : undefined

  const soldOut =
    selectedVariant != null
      ? !selectedVariant.availableForSale
      : product?.availableForSale === false

  async function add(): Promise<void> {
    if (!product || !displayPrice || !variantId || adding) return
    setAdding(true)
    try {
      await cart.add({
        variantId,
        quantity,
        product: {
          title: product.title,
          price: displayPrice,
          image: variantImage ?? null,
          handle: product.handle,
          ...(variantTitle ? { variantTitle } : {}),
        },
      })
      getAnalytics().track('PRODUCT_ADDED_TO_CART', {
        productId: product.id,
        variantId,
        title: product.title,
        handle: product.handle,
        price: displayPrice,
        quantity,
        ...(variantTitle ? { variantTitle } : {}),
      })
      openOverlay('cart')
    } finally {
      setAdding(false)
    }
  }

  if (!product || !displayPrice) return null

  return {
    product,
    options,
    variants,
    selected,
    setOption: (name, value) => setSelected((s) => ({ ...s, [name]: value })),
    selectedVariant,
    displayPrice,
    variantImage,
    soldOut,
    quantity,
    setQuantity,
    adding,
    add,
    variantId,
  }
}
