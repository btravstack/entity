# entity branding

The mark belongs to the shared btravstack family. Its editable source is
[`scripts/generate-brand.mjs`](https://github.com/btravstack/btravstack.github.io/blob/main/scripts/generate-brand.mjs)
in the website repository. Regenerate there, then copy the project assets from
`apps/website/public/logos/` into this repository's `docs/public/`:

- `entity-light.svg` → `logo-light.svg` and `logo.svg` (the default).
- `entity-dark.svg` → `logo-dark.svg`.
- `entity-mono.svg` → `logo-mono.svg`.
- `entity-favicon.svg` → `favicon.svg`.

The README and documentation navigation and hero use the light/dark pair.
The favicon has a solid background for legibility at small sizes.
The social preview is `og-entity.png`, a 1200 × 630 PNG using the same mark.
Its editable source is the website's
[`branding/social-card.html`](https://github.com/btravstack/btravstack.github.io/blob/main/branding/social-card.html),
rendered with `?project=entity`.
Keep its dimensions in the VitePress metadata in sync when replacing it.
Assets are committed locally; rendering never fetches branding from another site.
