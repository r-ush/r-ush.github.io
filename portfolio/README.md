# Directly shared portfolio

Share: https://r-ush.github.io/portfolio/hardware-first/

The alternate research order is https://r-ush.github.io/portfolio/.
KR / EN changes the current document without a separate English route.
Both original CVs are downloadable from either order.

Page text is selectable directly over the unchanged PDF artwork in both languages.
`text-layer.js` uses HTML text with PDF character positions and rectangular hit
areas. Mouse dragging retains its initial anchor and maps gaps to the nearest
character, including after zooming. Copying resolves both text and element
boundaries without defaulting to the page start, and preserves line breaks.
Selection highlights use PDF bounds. Dragging a selection does not open source
previews or trigger touch page navigation. Video controls remain above the text.
The authoring build generates `text_runs` automatically. To refresh only the text
metadata from the unchanged PDFs here, use `python scripts/portfolio_text.py --dist portfolio`.

These pages are intentionally absent from the homepage menu and sitemap.
Every HTML route has `noindex,nofollow`. This is unlisted sharing, not authentication;
anyone with the address can open the page and assets, and this repository is public.

The authoring source is maintained in the existing local CV portfolio workspace.
Run its `export_static.py --base-url https://r-ush.github.io/portfolio --noindex`,
then from this repository run `python scripts/sync-portfolio.py --source EXPORT/dist`.
This keeps the homepage-specific tracker and notice and refreshes the static assets.
The export regenerates PDF links and QR codes for this homepage, without depending
on the older Sites host. Do not copy authoring backups, credentials or `.openai` here.

Portfolio records: https://rush-analytics.r-ush.workers.dev/portfolio.html
Use the existing administrator key; the API never returns records without it.
See `../analytics/README.md` for deployment, retention and administrator-key access.
The portfolio's own `privacy.html` discloses the fields and opt-out mechanism.
