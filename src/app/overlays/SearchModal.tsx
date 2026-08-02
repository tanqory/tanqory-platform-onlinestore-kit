import { useEffect, useRef } from 'react'
import { Modal } from '../components/Modal'
import { ImageResponsive } from '../components/ImageResponsive'
import { Money } from '../components/Money'
import { useOverlay } from '../components/useOverlayChannel'
import { useStorefrontSearch } from '../hooks/use-storefront-search'

export interface SearchModalProps {
  placeholder: string
  ctaLabel: string
  maxWidth: string
  debounceMs: number
  maxResults: number
}

/**
 * Predictive search overlay — replaces a full page navigation to `/search`
 * with an instant, debounced search-as-you-type experience.
 *
 * MARKUP ONLY. `useStorefrontSearch()` owns the debounce, the real
 * `predictiveSearch` GraphQL query (ranking, synonyms, description/tag hits —
 * not just a client-side title `includes()` over the bootstrap list), the
 * out-of-order-response guard, and the offline title-filter fallback that
 * keeps the editor canvas working.
 */
export function SearchModal(props: SearchModalProps): JSX.Element {
  const open = useOverlay('search')
  const { placeholder, ctaLabel, maxWidth, debounceMs, maxResults } = props
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useStorefrontSearch({ active: open, debounceMs, maxResults })

  // Focus the input when the overlay OPENS — not via the autoFocus
  // attribute, which fires at mount while the modal is still hidden
  // (Modal stays mounted with aria-hidden). That mount-time focus both
  // tripped Chrome's cross-origin-iframe autofocus block (red console
  // error on every page load inside the editor canvas) and parked focus
  // inside an aria-hidden subtree (WAI-ARIA violation warning).
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const { term, query, products } = search

  return (
    <Modal open={open} maxWidth={maxWidth} ariaLabel="Search">
      <div className="search-modal">
        <label className="search-modal__field">
          <span className="visually-hidden">Search</span>
          <input
            ref={inputRef}
            type="search"
            className="search-modal__input"
            placeholder={placeholder}
            value={term}
            onChange={(e) => search.setTerm(e.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {term && (
            <button
              type="button"
              className="search-modal__clear"
              aria-label="Clear search"
              onClick={() => search.clear()}
            >
              ✕
            </button>
          )}
        </label>

        {query && (
          <div className="search-modal__results" role="listbox" aria-label="Search results">
            {products.length === 0 ? (
              <p className="search-modal__empty u-text-muted">No matches for “{query}”.</p>
            ) : (
              <>
                <ul>
                  {products.map((p) => (
                    <li key={p.handle} role="option" aria-selected="false">
                      <a className="search-modal__hit" href={`/products/${p.handle}`}>
                        <div className="search-modal__thumb">
                          <ImageResponsive
                            src={p.featuredImage?.url}
                            alt={p.featuredImage?.altText ?? p.title}
                          />
                        </div>
                        <div className="search-modal__hit-body">
                          <strong className="search-modal__hit-title">{p.title}</strong>
                          <Money value={p.price} />
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
                <a href={`/search?q=${encodeURIComponent(query)}`} className="search-modal__cta">
                  {ctaLabel}
                </a>
              </>
            )}
          </div>
        )}

        {!query && (
          <p className="search-modal__hint u-text-muted">
            Type to search products, collections, and pages. <kbd>Esc</kbd> to close.
          </p>
        )}
      </div>
    </Modal>
  )
}

export default SearchModal
