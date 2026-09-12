# LANKA LENS — Phase 1 Inspection & Foundation Plan

## A. Existing page inventory (Buzzle template as delivered)

The project is a **Framework7 v6 (iOS theme) single-window mobile template**. Only `index.html` is a full HTML document; every other `.html` file is a **Framework7 page fragment** (`<div class="page">…</div>`) fetched over XHR by the F7 router (`js/routes.js`) and injected into the single view.

| File | Lines | Current purpose |
|---|---|---|
| `index.html` | 1166 | App shell + 5 bottom tabs (Home, Favorites, Post, Search, Profile), left drawer menu, home sections, favorites list, choose-category, search+sort/filter UI |
| `ads.html` | ~250 | Generic listing results grid + search bar + sort sheet + filter panel |
| `ads-details.html` | ~250 | Listing detail: Swiper gallery, price/title, spec list, map iframe, seller card, contact icons, related grid |
| `add-ads.html` | ~140 | "Choose category" list (first step of posting) |
| `add-ads-product-details.html` | ~200 | Static product-detail form (title, brand, select, year, color swatches, image upload, map) |
| `my-ads.html` | ~290 | User's ads grid + edit/delete/view buttons + filter panel |
| `categories.html` | 160 | Grid of all generic categories |
| `category-details.html` | 259 | Single category listing grid |
| `favorites.html` | 137 | Saved listings (horizontal card list) |
| `chat.html` | 199 | Conversation thread + fixed message composer (+file) |
| `notifications.html` | 148 | Notification rows with unread dots |
| `profile.html` | 139 | Profile header, fake follower stats, menu list |
| `settings.html` | 136 | Settings form rows + avatar upload |
| `search.html` | 303 | Dedicated search tab: sort sheet, filter panel, category suggestions, popular tags |
| `sign-in.html` | 71 | Static email/password form (non-functional) |
| `sign-up.html` | 77 | Static registration form (non-functional) |
| `contact.html` | 76 | Contact form + illustration |
| `blog.html` | 143 | Blog card list |
| `blog-details.html` | 152 | Article view + share |
| `pages.html` | 200 | Demo index/sitemap linking every template screen |
| `blank-page.html` | 24 | Empty placeholder screen |

**Assets**

- `css/framework7.bundle.min.css` (545 KB) + unminified copy — keep minified only.
- `css/style.css` (25 KB, ~1670 lines) — template design system (tokens, cards, lists, sheets, panels, chat, blog…). Reusable class vocabulary; re-themed for Lanka Lens.
- `js/framework7.bundle.min.js` (711 KB; bundles Dom7 + Swiper) — keep.
- `js/app.js` (13 lines) — F7 app init; rewritten.
- `js/routes.js` (1.3 KB) — route table; rewritten with clean Lanka Lens routes.
- `fonts/ionicons.*` (Ionicons 5, also hot-loaded from unpkg) — keep local, drop the unpkg hot-load.
- `images/` — 36 files, almost all 2 KB placeholder JPGs (cars, bikes, properties, generic avatars, blog) + 2 PNG illustrations + favicon. All generic demo imagery removed/replaced.

**Current behaviour**

- 100% static: no backend, no database, no build step, no working forms, buttons are dead (`href="#"` or empty).
- Navigation: F7 router (`pushState: false`), iOS transitions, bottom tabbar, left/right slide panels, swipe-to-close sheet modals, Swiper carousels, F7 searchbar component.
- Design tokens: primary blue `#698aff`, teal accent `#01cfb0`, ink `#383e50`, page bg `#f5f5f9`; fonts Heebo (headings) + Montserrat (body).

## B. Pages to KEEP (re-skin + make data-driven)

`index` (shell/tabs), `ads` (→ search results), `ads-details` (→ listing detail), `categories`, `category-details`, `add-ads` + `add-ads-product-details` (→ Post Ad wizard), `my-ads` (→ My Listings), `favorites`, `chat`, `notifications`, `profile`, `settings`, `sign-in`, `sign-up`, `contact`, `blog`, `blog-details`, `search`.

Reusable **components/patterns**: F7 view/router/tabs, navbar + back links, bottom tabbar + raised center button, panels (drawers), sheet modals (sort), Swiper galleries/carousels, list/form components, searchbar, cards (`.content-item`), favorite/featured floating symbols, seller-info dark card, chat bubbles + composer, notification rows, block titles, separators, grid (`row`/`col-*`), empty-illustration pattern.

## C. Pages to REMOVE

- `blank-page.html` (delete).
- `pages.html` demo screen index (delete; replaced by a real footer sitemap).
- Generic demo content everywhere (cars/properties/phones, "Philips Ramsey", $ prices, NEW YORK, lorem ipsum, fake ratings/followers).
- Unused duplicate: `framework7.bundle.css` / `.js` unminified (keep minified only).
- Generic placeholder images (`cars*`, `bike*`, `properties*`, `computer*`, demo `avatar*`, `blog*`, `ads-details*`, template illustrations).

## D. Pages to MODIFY

All kept pages (see B): re-branded, camera-specific, and wired to the API with real persistence. The 5 home tabs become Home / Search / **Post Ad** (center, raised) / Favorites / Profile per spec §79.

## E. NEW pages required

`about`, `safety`, `buying-guide`, `sell`, `shops` (index), `shop` (storefront `/shop/:slug`), `privacy`, `terms`, `faq`, `help`, `report`, plus `forgot-password`, `reset-password`, `verify-email`, seller `dashboard`, and the **admin** area (`admin` dashboard/moderation/users/reports/catalog/locations/settings/audit), and friendly `404 / 403 / 500 / network-error` states.

## F. Existing components that can be reused

Framework7: router (clean HTML5 routes), tabs, navbar/subnavbar, panels, sheet-modal, swiper (gallery + carousels), searchbar, list/inputs/selects, messages? (we use custom chat bubbles from template), toast/dialog/preloader, skeleton classes. CSS vocabulary from `style.css` (cards, separators, radius scale, item lists, category tiles, seller card). Ionicons set. The raised center "Post Ad" tab button pattern.

## G. Existing dependencies

Framework7 v6 bundle (Dom7, Swiper, template7), Ionicons 5, Google Fonts (Heebo/Montserrat). **No package.json / Node / build system existed.** Added server deps listed in root `package.json` (express, better-sqlite3, bcryptjs, jsonwebtoken, multer, sharp, nodemailer, cookie-parser, dotenv).

## H. Recommended backend / database architecture

- **Node.js + Express** REST API (same origin, mounted at `/api`), serving the static frontend.
- **SQLite via better-sqlite3** for v1 (zero-ops, transactional, parameterized queries). The data-access layer is SQL-only and can be ported to PostgreSQL later without touching route handlers.
- **Auth**: email+password, bcrypt hashing, JWT in httpOnly cookie (+ Bearer fallback), role (`user|admin`), email/phone/business verification flags, rate-limited auth endpoints.
- **Images**: multer upload, sharp → WebP/AVIF + responsive thumbnails, MIME/size validation; first image = cover.
- **Abstractions**: mailer provider (nodemailer; console transport unless env configured) and payment provider (interface with Pending/Processing/Successful/Failed/Cancelled/Refunded; no gateway credentials in v1). Both config-driven via `site_settings`/env.
- Full relational schema (~30 tables) in `server/schema.sql`: users, user_profiles, seller_profiles, business_profiles, categories (self-tree), brands, products (catalog models), product_attributes, locations (province/district/city), listings, listing_attributes, listing_images, favorites, conversations, messages, offers, notifications, reports, reviews, promotions, promotion_packages, payments, transactions, blog_posts, pages, site_settings, audit_logs, plus analytics_events and email/phone verification/password-reset tables.
- Clean URLs (section 55) implemented in F7 routes with Express SPA fallback; SEO metadata/JSON-LD/sitemap generated server-side.

## I. Project structure

```
server/            Express API, DB, schema, seed, middleware, routes, services
  schema.sql       Full relational schema (section 72)
  seed.js          Categories/brands/models, SL locations, demo data (marked)
  routes/          auth listings catalog favorites conversations
                   notifications users shops blog uploads admin content stats
  services/        mailer.js payments.js image.js
  middleware/      auth.js admin.js validate.js rateLimit.js error.js
data/              SQLite DB (gitignored)
uploads/           User images: originals/webp/thumbs (gitignored)
pages/             F7 page fragments (kept + new)
js/lankalens/      api client, auth, catalog, listings render, controllers, wizard
css/lankalens.css  Lanka Lens design system + desktop responsive layer
images/            Brand SVG logo, OG image, icon set (license-clean)
```

## J. Migration plan (phased, each phase tested before next)

1. **P1 Foundation** ✅: rebrand shell + design tokens + desktop frame; Express/SQLite/JWT; schema; seed catalog (camera categories, brands, models, SL provinces/districts/cities); register/login/me; listing/catalog read APIs; API client + session state. *(this changeset)*
2. **P2 Marketplace**: search/filter/sort/pagination, category & brand pages, dynamic category filters, listing detail, Post Ad wizard + image pipeline.
3. **P3 Users**: profiles, seller profiles, favorites, My Listings lifecycle, notifications.
4. **P4 Communication**: chat conversations/messages, offers (accept/reject/counter), call/WhatsApp link generation + tracking, reports, safety/guide content.
5. **P5 Admin**: dashboard, moderation queue w/ reasons, user mgmt, reports, catalog/location/settings editors, audit log.
6. **P6 Shops**: business profiles, verification, storefronts, shop dashboards.
7. **P7 Monetization**: featured/boost packages + payments abstraction (dormant until gateway configured).
8. **P8 SEO/perf**: sitemap/robots/canonical/OG/JSON-LD/breadcrumbs, pagination/indexes, lazy loading, caching.
9. **P9 Testing**: end-to-end flows across mobile/desktop.

### Demo credentials (seeded, clearly labelled DEMO)

- Admin: `admin@lankalens.lk` / `admin12345`
- Seller: `seller@lankalens.lk` / `seller12345` · Buyer: `buyer@lankalens.lk` / `buyer12345`
