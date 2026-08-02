import { formatMoney } from '../../data'
import type { Money } from '../../data'

/**
 * Reusable presentation component (= a commerce-standard "snippet"). No schema, not an
 * editor block — just shared markup that blocks import.
 */
export function Price({ money, className = 'tq-card-price' }: { money: Money; className?: string }): JSX.Element {
  return <span className={className}>{formatMoney(money)}</span>
}
