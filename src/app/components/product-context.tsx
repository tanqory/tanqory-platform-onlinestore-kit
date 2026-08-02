import { createContext, useContext, type ReactNode } from 'react'
import type { Product, ProductOption, ProductVariant, Money, ImageRef } from '../../data'

/**
 * Shared product + selected-variant state for PDP BLOCKS. The ProductDetails
 * section resolves the product, owns the option/quantity state, and exposes it
 * here so each block (title, price, variant-picker, add-to-cart…) reads/writes
 * the SAME state — how the theme composes a product page from
 * blocks instead of one monolithic section.
 */
export interface ProductContextValue {
  product: Product
  options: ProductOption[]
  variants: ProductVariant[]
  selected: Record<string, string>
  setOption: (name: string, value: string) => void
  selectedVariant?: ProductVariant
  displayPrice: Money
  variantImage?: ImageRef | null
  soldOut: boolean
  quantity: number
  setQuantity: (n: number) => void
  adding: boolean
  add: () => Promise<void>
  /**
   * The merchandise id `add()` would send — a real variant id live, a
   * `mock:<handle>` pseudo id offline. Undefined means there is nothing
   * addable (live product with no resolvable variant), so an add-to-cart
   * control should be disabled rather than silently no-op.
   *
   * Optional so this stays backward-compatible with any hand-built context.
   * `useProductPage()` always sets it.
   */
  variantId?: string
}

const ProductContext = createContext<ProductContextValue | null>(null)

export function ProductProvider({
  value,
  children,
}: {
  value: ProductContextValue
  children: ReactNode
}): JSX.Element {
  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>
}

/** PDP blocks call this to read the shared product state. Returns null outside a PDP. */
export function useProductContext(): ProductContextValue | null {
  return useContext(ProductContext)
}
