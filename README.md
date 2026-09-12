# Lanka Lens — Buy & Sell Cameras in Sri Lanka

**Lanka Lens** is a dedicated Sri Lankan camera marketplace — buy and sell
cameras, lenses, drones, action cameras and accessories, priced in rupees.

## Stack

- **Backend** — Python + Flask + SQLite (`server/app.py`). A real, database-driven
  API (categories, listings, users, favorites, offers, chat, notifications, shops,
  blog, locations). No static demo data — everything is seeded into SQLite on first run.
- **Frontend** — a framework-free single-page app (hash router) that reuses the
  template's look & feel: `css/style.css` (re-themed), `css/framework7.bundle.min.css`
  (UI styling) and a locally self-hosted ionicons SVG sprite (`icons/icons.svg`).
  No CDN dependencies.

## Run it

```bash
pip install -r server/requirements.txt
python3 server/app.py        # serves on http://localhost:8000
```

Open **http://localhost:8000** — Flask serves both the SPA and the JSON API from
the same origin, which is what the frontend expects.

### Serving the frontend separately (optional)

If you serve `index.html` from something else (a static dev server, a preview
host, or by opening the file directly), the API is on a different origin. Two
ways to point the SPA at it:

- **Automatic (local dev only)** — when the page is on `localhost` / `127.0.0.1`
  / `file://` and no API answers on that origin, the client probes
  `http://localhost:8000/api` and switches to it for the session.
- **Explicit** — set the base before the app boots:

  ```html
  <meta name="ll-api-base" content="https://api.example.com/api">
  <!-- or -->
  <script>window.LL_API_BASE = 'https://api.example.com/api';</script>
  ```

  An explicit base is never overridden. The API sends CORS headers
  (`Access-Control-Allow-Origin`, `Authorization`/`Content-Type`, preflight
  `OPTIONS`); restrict them with `LL_CORS_ORIGINS=https://your.site` if you want
  a closed list instead of the permissive default.

Either way, sign-in failures report the real cause inline on the form (HTTP
status, unreachable API, non-JSON response) instead of a generic message.

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Buyer (demo) | demo@lankalens.lk | demo1234 |
| Seller | nimalka@lankalens.lk | password123 |
| Seller | kasun@lankalens.lk | password123 |
| Shop owner | ishara@lankalens.lk | password123 |
| Admin | admin@lankalens.lk | admin1234 |

## What works

**Part 1 — marketplace base**

- **Home** — header/logo, search, main categories, featured & latest listings,
  popular brands, camera shops, buying guides, safety, footer.
- **Categories** — database-driven (Cameras, Lenses, Action Cameras, Drones,
  Accessories + subcategories), manageable via the admin API.
- **Search / browse** — keyword, category, condition, province, price and sort
  filters.
- **Listing details** — gallery, price (LKR), condition, location, description,
  category-specific specifications, seller info, and Call / WhatsApp / Chat /
  Make Offer / Favorite / Share / Report actions.
- **Post a listing** — dynamic, category-specific fields (shutter count, mount,
  aperture, flight time…), photo upload, Sri Lankan Province → District → City.
- **Accounts** — sign up / sign in, profile, settings, password change.
- **My Ads** (mark sold / delete), **Favorites**, **Chat**, **Offers**, **Notifications**.
- **Info pages** — About, Safety, Buying Guide, Sell Your Camera, Shops, Privacy,
  Terms, FAQ, Help, Contact, Blog.

**Part 2 — seller & buyer experience**

- **Authentication** — sign up / login / logout, forgot & reset password, email
  verification and phone verification (OTP, dev-mode codes surfaced for local
  testing). PBKDF2 password hashing.
- **Seller types** — Individual sellers and Business sellers (business name,
  logo, description, location, phone, WhatsApp, opening hours) with a public
  shop page at `#/shop/<slug>`.
- **My Listings** — statuses Active / Pending / Draft / Sold / Expired / Paused,
  with actions Edit, Delete, Pause, Resume, Renew, Mark Sold and Promote (feature).
- **Post an Ad wizard** — a 10-step flow (category → brand/model → details →
  condition → price → description → photos → location → contact options →
  preview/publish) plus Save as Draft.
- **Image upload** — up to 15 images with preview, delete, reorder, cover
  selection, server-side JPEG re-compression, thumbnail generation, file-size
  and image-type validation.
- **Search & filters** — keyword, category, brand, model, condition, price,
  location, plus category-specific filters (shutter count, mount, focal length,
  aperture, resolution, battery count, flight time). Sorts: Recommended,
  Newest, Price ↑/↓, Most viewed.
- **Favorites**, **Chat** (read/unread, listing attachment, block, report user),
  **Make Offer** (accept / decline / counter-offer, linked to listing).
- **Contact tracking** — Call / WhatsApp / Chat clicks recorded for analytics.
- **Notifications** — message, offer, listing status, expiring-soon, favorite,
  promotion and rating events.
- **Reports** — scam, fake product, wrong information, duplicate, wrong category,
  prohibited item, other.
- **Seller analytics** — views, favorites, messages, calls, WhatsApp clicks and
  offers, per listing and aggregate.
- **Seller profiles** — photo, rating (stars + reviews), member since, verified
  badge, active listings.

**Part 3 — platform management, monetisation & SEO**

- **Admin panel** (`#/admin`, admin-only) — a professional dashboard with live
  totals (users, active/pending/sold listings, shops, open reports, revenue,
  payments, messages), plus full management screens:
  - **Users** — search, view profile + activity, verify, suspend, ban (blocks
    re-registration), activate, delete. Every action is written to an audit log.
  - **Listings** — approve, reject (with a reason the seller sees and can
    resubmit), suspend, feature/unfeature, mark sold, view.
  - **Reports** — investigate and resolve (optionally remove the listing or
    suspend the seller), with a resolution note.
  - **Categories** — add/rename/delete categories & subcategories and edit each
    category's dynamic listing fields (name, label, type, required, options).
  - **Brands & models**, **Locations** (Province → District → City) — full CRUD.
  - **Promotions & payments** — view purchased packages and payment records.
  - **Blog posts** — create/edit/delete the camera buying guides.
  - **Settings** — site name, tagline, logo, contact info, listing/image limits,
    expiry period, approval toggle, homepage banners, social links, payment
    webhook secret, and per-package promotion prices/durations.
- **Moderation workflow** — Submitted → Pending → Approved → Active, or
  Pending → Rejected (seller notified with the reason and can resubmit).
- **Camera shops** — business sellers get a public `#/shop/<slug>` page (logo,
  name, description, location, phone, WhatsApp, opening hours, verified badge,
  listings) and a dedicated Camera Shops directory page.
- **Promotions** — Featured Listing, Boost, Homepage Featured and Urgent Badge.
  Prices and durations are configurable from Admin (no hard-coded prices).
- **Payments** — a provider-agnostic abstraction: `Pending → Processing →
  Successful → Failed → Cancelled → Refunded`, storing transaction id, user,
  amount, currency, package and dates. A Sri Lankan gateway plugs in via
  `/api/payments/webhook` (HMAC-secret verified, secret lives in the backend).
  A dev-only `simulate` endpoint lets you complete a payment locally. No payment
  secrets are ever exposed to the frontend.
- **Listing expiry** — configurable (default 30 days), with seller notifications
  before expiry and one-tap renewal.
- **SEO** — clean URLs (`/listing/<slug>-<id>`, `/guide/<slug>`, `/shop/<slug>`)
  with server-injected dynamic titles, meta descriptions, canonical URLs, Open
  Graph/Twitter tags, Product JSON-LD, plus `sitemap.xml` and `robots.txt`.
  Landing on an SEO URL deep-links into the SPA.
- **Camera buying guides** — 11 blog posts covering used DSLR & mirrorless
  checks, shutter count, used lenses, GoPro, DJI Action, drone inspection and
  buying tips for Sri Lanka (editable from Admin).
- **Safety page** — meet safely, test before paying, check shutter count/serial/
  accessories, no advance payments, never share OTP/passwords.
- **Security & performance** — PBKDF2 password hashing, bearer-token auth (CSRF
  is not applicable to token-based APIs), input validation, output escaping
  (XSS), parameterised SQL, per-IP rate limiting on auth endpoints, validated +
  re-compressed image uploads, admin authorization on every admin route,
  lazy-loaded images, pagination, database indexes, and long-lived caching of
  static assets.

> No email/SMS gateway is configured, so verification codes and reset links are
> surfaced in the API responses under a `dev` field for local testing (the same
> flow works unchanged once a real provider is plugged in).

## Project layout

```
server/app.py          Flask app: schema, seed data and JSON API
server/requirements.txt
index.html             SPA shell
js/app.js              router + views + API client
js/ionicons.js         local ionicons loader
css/style.css          template base styles (re-themed)
css/lankalens.css      Lanka Lens theme + components
icons/icons.svg        icon sprite (self-hosted)
images/products/       seeded product photos
images/shops/          shop photos
uploads/               user uploads (gitignored)
```

Prices are in **LKR (Rs.)**. Sri Lankan phone numbers and WhatsApp links are
supported throughout.
