import { createContext, useContext, type ReactNode } from 'react'

export interface Money {
  amount: string
  currencyCode: string
}
export interface Product {
  handle: string
  title: string
  price: Money
  featuredImage?: { url: string; altText?: string } | null
}
export interface Collection {
  handle: string
  title: string
  products: Product[]
}

/** The data interface every block consumes. Themes provide an implementation. */
export interface DataApi {
  collectionByHandle: (handle: string) => Collection | null
}

const DataContext = createContext<DataApi | null>(null)

/** Wraps the app with a theme-provided data source (mock or live). */
export function DataProvider({ value, children }: { value: DataApi; children: ReactNode }): JSX.Element {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataApi {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within <DataProvider>')
  return ctx
}

/** Build an offline data source from fixture collections (theme passes its JSON). */
export function createMockData(collections: Collection[]): DataApi {
  return {
    collectionByHandle: (handle) => collections.find((c) => c.handle === handle) ?? null,
  }
}

export function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: money.currencyCode }).format(
      Number(money.amount),
    )
  } catch {
    return `${money.amount} ${money.currencyCode}`
  }
}
