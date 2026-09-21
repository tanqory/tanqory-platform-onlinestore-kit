# Tanqory Theme Contract — authoring rules for AI

Contract `1.0.0` · theme-kit `0.1.3`–`0.2.0`

**Generated from the contract — do not hand-edit, and do not copy these
names into a prompt.** Read this file (or `theme-contract.json`) at author
time instead: a memorised list is how the generator ended up teaching
`image_picker`, which the CMS silently rewrites to a plain text box.

## Rules that are not negotiable

1. **Every node carries an explicit `id`.** Format:
   ``<type>_<8 chars>`` matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
   A node without an id is given one derived from its POSITION, so any
   reorder silently reassigns that id to different content — and a later
   targeted edit then hits the wrong node.
2. **Only declared settings.** A key the section does not declare is
   dropped at render and gets no editor control.
3. **Only `allowedBlocks` may nest.** A section with no `allowedBlocks` is a leaf.
4. **`area` is one of:** `header`, `template`, `footer`.
5. **Validate before you finish.** `validatePage(template, groups, catalog, { template })` returns
   `{nodeId, path, code, message}` — fix what it reports rather than guessing.
6. **Header and footer are SHARED.** `groups/header.json` and `groups/footer.json` are the
   single source of truth; a template binds them with `"groups": { "header": "header", "footer": "footer" }`.
   Editing a group changes EVERY page that binds it — read the impact list before writing.
   A page that must differ says so explicitly: `"header": { "override": [ …sections ] }`.
   Never copy the header into a template body; never edit a group to change one page.
7. **Respect `role`, `placement` and `requiresContext`.** A `block` only nests inside a
   parent that lists it; a `layout` unit lives in its `area`; a section that `requiresContext`
   (e.g. `product`) is REJECTED on a template that does not provide it — the validator says which.
8. **Edit by stable id with a revision.** Read the page (`GET /tq/v2/page`), change nodes by
   `id`, write back with the revisions you read. A `409 revision_conflict` means someone
   else saved first: re-read and re-apply, never retry the stale write.

## Field types

| type | control | value | bindable | AI may emit | notes |
| --- | --- | --- | :-: | :-: | --- |
| `text` | text-input | string | ✅ | ✅ |  |
| `textarea` | textarea | string | ✅ | ✅ |  |
| `richtext` | rich-text | string | ✅ | ✅ |  |
| `html` | textarea | string | — | — |  |
| `number` | number-input | number | ✅ | ✅ | requires/uses: min, max, step |
| `range` | slider | number | — | ✅ | requires/uses: min, max, step, unit |
| `boolean` | switch | boolean | — | ✅ |  |
| `color` | color | string | — | ✅ |  |
| `select` | select | string | — | ✅ | requires/uses: options |
| `radio` | segmented | string | — | ✅ | requires/uses: options |
| `text_alignment` | segmented | string | — | ✅ |  |
| `url` | link-picker | string | ✅ | ✅ |  |
| `image` | media-picker | string | ✅ | ✅ | media: image |
| `video` | media-picker | string | — | ✅ | media: video |
| `collection` | resource-picker | string | — | ✅ | value = collection handle |
| `product` | resource-picker | string | — | ✅ | value = product handle |
| `page` | resource-picker | string | — | ✅ | value = page handle |
| `blog` | resource-picker | string | — | ✅ | value = blog handle |
| `article` | resource-picker | string | — | ✅ | value = article handle |
| `menu` | resource-picker | string | — | ✅ | value = menu handle |

### Accepted aliases (normalised — prefer the canonical name)

- `image_picker` → `image`
- `link_list` → `menu`
- `checkbox` → `boolean`
- `color_background` → `color`

### Rendered by the editor but NOT declarable by a theme

`inline_richtext` · `color_scheme` · `color_scheme_group` · `font_picker` · `product_list` · `collection_list` · `metaobject` · `video_url` · `header` · `paragraph`

Declaring one of these is an error, not a downgrade — the theme cannot
reach these controls until the contract promotes them.

## Per-type detail

- **`text`** — Single-line text.
- **`textarea`** — Multi-line plain text. No markup.
- **`richtext`** — Formatted text. Value is sanitised HTML.
- **`html`** — Raw HTML. Author-trusted; never bind to shopper input.
- **`number`** — Numeric input.
- **`range`** — Slider. Declare min/max/step or it sits on the 0–100 default.
- **`boolean`** — On/off toggle.
- **`color`** — Colour value (hex).
- **`select`** — Dropdown. REQUIRES `options: [{value,label}]`.
- **`radio`** — Segmented choice. REQUIRES `options: [{value,label}]`.
- **`text_alignment`** — Left/center/right. The editor supplies the three choices.
- **`url`** — A link. The editor offers a link picker, not a raw text box.
- **`image`** — Media-library picker. Value is a plain URL string, consumed exactly like `url`. NOTE: the legacy spelling `image_picker` is an alias — declaring it downgrades the control to a free-text box.
- **`video`** — Media-library picker for a hosted video. For an EXTERNAL video URL use `url` — the editor renders this as a library browser, not a URL input.
- **`collection`** — Collection picker. Value is the collection HANDLE.
- **`product`** — Product picker. Value is the product HANDLE.
- **`page`** — Page picker. Value is the page HANDLE.
- **`blog`** — Blog picker. Value is the blog HANDLE.
- **`article`** — Article picker. Value is the article HANDLE.
- **`menu`** — Store menu picker (Dashboard → Navigation). Value is the menu HANDLE. `link_list` is an accepted alias.

