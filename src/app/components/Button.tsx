/**
 * Reusable UI primitive (= a commerce-standard "snippet") — NOT an editor section.
 * Sections import it; merchants configure it via the parent section's settings.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'link'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  label,
  link,
  variant = 'primary',
  size = 'md',
  className,
  fullWidth,
  onClick,
  disabled,
}: {
  label?: string
  link?: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  fullWidth?: boolean
  /** When provided (and no `link`), renders a real <button> that fires this. */
  onClick?: () => void
  disabled?: boolean
}): JSX.Element {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    fullWidth ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const style = fullWidth ? { width: '100%' } : undefined

  // An action button (add to cart, etc.) renders a <button>; a navigation
  // button renders an <a>. With BOTH onClick + link (e.g. checkout: fire an
  // analytics event, then navigate), the handler runs on the anchor before the
  // browser follows the href — analytics uses sendBeacon, so it survives the nav.
  if (onClick && !link) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} disabled={disabled}>
        {label ?? 'Button'}
      </button>
    )
  }

  return (
    <a className={classes} href={link ?? '#'} style={style} onClick={onClick}>
      {label ?? 'Button'}
    </a>
  )
}
