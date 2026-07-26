// @tanqory/theme-kit — public API. Themes import only from here.
export { defineSection } from './defineSection'
export {
  createAnalytics,
  getAnalytics,
  subscribe,
  type Analytics,
  type AnalyticsOptions,
  type StorefrontEventType,
  type StorefrontEvent,
} from './analytics'
export {
  getConsent,
  setConsent,
  hasConsent,
  hasDecided,
  setBannerRequired,
  isBannerRequired,
  onConsentChange,
  type Consent,
} from './consent'
export { defineTheme, defineSettings, type ThemeConfig, type SettingsSchema } from './config'
export { ThemeProvider, useSettings, useT } from './theme-context'
export { mount, type MountOptions } from './mount'
export { renderStorefrontHTML, renderSectionPreviewHTML } from './ssg'
export { SectionTree } from './SectionTree'
export { Editor } from './editor'
export { registerSections, getSection, allSections } from './registry'
export {
  DataProvider,
  useData,
  createMockData,
  createLiveData,
  createLiveDataFromSnapshot,
  formatMoney,
  formatMoneyWithCurrency,
  formatMoneyWithoutCurrency,
  formatMoneyWithoutTrailingZeros,
  imageUrl,
  formatDate,
  formatWeight,
} from './data'
export { CartProvider, useCart } from './cart'
export {
  DynamicSourceProvider,
  useResourceContext,
  useBound,
  useBoundText,
  isBoundSource,
  resolveBoundSource,
  collectBoundIdentifiers,
} from './dynamic-source'
export type { Bound, BoundSource, ResourceContextValue } from './dynamic-source'
export type {
  CartApi,
  CartLine,
  CartState,
  AddToCartInput,
  AppliedDiscountCode,
  AppliedGiftCard,
} from './cart'
export type {
  LiveDataOptions,
  Localization,
  LocalizedCountry,
  LocalizedMarket,
  LocalizedCurrency,
  ProductOption,
  ProductVariant,
  ImageRef,
  QuantityRule,
  UnitPriceMeasurement,
  StoreAvailability,
  SellingPlan,
  SellingPlanOption,
  SellingPlanGroup,
  Measurement,
  Rating,
  FocalPoint,
  ImagePresentation,
  ModelSource,
  VideoSource,
  GenericFile,
  Recommendations,
} from './data'
export { toRecommendations } from './data'
export { jsxToJSON } from './jsx-to-json'
export { tag, type Tag } from './composition'
export type { Money, Product, Collection, DataApi } from './data'
export type { SectionDef, SectionProps, ContentNode, PageDoc, AttrSpec } from './types'

// Shopify-compatible storefront extensions (live data layer): navigation menus,
// blog/articles, search, recommendations, metaobjects, shop/policies, and the
// full customer account flow. See storefront.ts.
export { customerTokenStore } from './storefront'
export type {
  StorefrontExtensions,
  Menu,
  MenuItem,
  MenuItemType,
  Blog,
  Article,
  SearchResults,
  CollectionProductsPage,
  PredictiveSearchResults,
  PageInfo,
  Filter,
  Metaobject,
  MetaobjectField,
  Shop,
  ShopPolicy,
  Image as StorefrontImage,
  Seo,
  CustomerApi,
  Customer,
  CustomerAddress,
  CustomerAddressInput,
  Order,
  OrderLineItem,
  AuthResult,
  MutationResult,
} from './storefront'
