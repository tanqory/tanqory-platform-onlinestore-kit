/**
 * Money — formats a `Money` value using the locale/currency the storefront is
 * running in. Wraps theme-kit's `formatMoney`, so sections can drop a `<Money>`
 * anywhere instead of pulling the helper themselves.
 */
import { formatMoney } from '../../data'
import type { Money as MoneyValue } from '../../data'

export function Money({
  value,
  className = 'tq-money',
}: {
  value?: MoneyValue | null
  className?: string
}): JSX.Element | null {
  if (!value) return null
  return <span className={className}>{formatMoney(value)}</span>
}
