// Headless commerce hooks — the state machines a storefront needs to sell,
// with no markup attached.
//
// This is the layer that lets 13 themes look genuinely different without 13
// copies of the money path: a theme writes its own PDP, cart drawer, search
// overlay and account page as MARKUP, and reads product/variant/price,
// analytics events, search and session state from here. Fix a commerce bug
// once in the kit and every theme has it — no re-submit, no version bump, no
// re-install.

export { useProductPage } from './use-product-page'
export type { ProductPageAttributes } from './use-product-page'

export { useCartDrawerState } from './use-cart-drawer-state'
export type { CartDrawerState } from './use-cart-drawer-state'

export { useStorefrontSearch } from './use-storefront-search'
export type { StorefrontSearchOptions, StorefrontSearchState } from './use-storefront-search'

export { useCustomerAccount, useCustomerSession } from './use-customer-account'
export type {
  CustomerAccountState,
  CustomerAccountStatus,
  CustomerSession,
} from './use-customer-account'
