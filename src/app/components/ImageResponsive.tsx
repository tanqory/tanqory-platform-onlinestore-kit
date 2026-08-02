/**
 * Responsive image — wraps `<img>` with sensible storefront defaults:
 * lazy loading, async decoding, intrinsic width/height to reserve layout
 * space (no CLS), and an optional `sizes` hint for srcset-aware backends.
 *
 * Today the URL is passed through unchanged; the CDN asset pipeline will
 * later attach `srcset` here (see [tanqory-studio/apps/examples/react/README.md]).
 */
export function ImageResponsive({
  src,
  alt,
  width,
  height,
  sizes,
  loading = 'lazy',
  className,
}: {
  src?: string | null
  alt?: string | null
  width?: number
  height?: number
  sizes?: string
  loading?: 'lazy' | 'eager'
  className?: string
}): JSX.Element | null {
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt ?? ''}
      width={width}
      height={height}
      sizes={sizes}
      loading={loading}
      decoding="async"
      className={className}
    />
  )
}
