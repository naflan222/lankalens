# Lanka Lens — Part 3 QA, Security & Production Audit

**Branch:** `arena/01a09417-lankalens`
**Commits:** `212218c` (audit fixes) → `9b8a4a0` (notification cascade) → `011f6be` (headings & alt text)
**Scope:** full frontend, routing, API, database, listing, image, responsive, auth, form-security, performance, console/network, demo-cleanup, SEO and end-to-end journey audit.
**Result:** **14 defects found and fixed. 673 automated assertions pass. Status: READY** (with 6 production-deployment caveats listed in §17 — none are application defects).

---

## 1. Bugs found, root causes and fixes

| # | Defect | Sev | Root cause | Fix | Verified by |
|---|--------|-----|-----------|-----|-------------|
| A | Chat thread kept polling the API forever after you navigated away | High | `views.chatThread` called a bare `setInterval(load, 6000)`. `render()` replaces the page DOM but never cleared the timer, so the interval kept firing against a detached node for the rest of the session — one wasted `/api/chat/<id>` request every 6 s per abandoned thread, accumulating. | Added a poller registry: `addPoller(fn, ms)` records every interval and self-cancels when its anchor element leaves the DOM; `clearPollers()` runs on every route change inside `render()`. The chat thread now uses `addPoller()`. | part3-audit §B: polls while open, stops on navigate-away, and a re-open/leave cycle leaves zero pollers |
| B | A broken or missing photo broke the card layout | Med | No `<img>` in the app had any error handling, so a 404 or corrupt file rendered the browser's broken-image icon and collapsed the surrounding grid cell. | Global capture-phase `error` listener (`bindImageFallbacks()`) swaps any failed image to an inline SVG placeholder, adds `.img-fallback`, preserves alt text and guards against loops with a `data-img-fallback` attribute. Because it is a document-level capture listener it also covers images injected later by async renders. | part3-audit §A: single image, a whole grid of 404s, no loop, layout intact |
| C | **Sessions never expired** — a stolen token was valid forever | High | The `sessions` table had no expiry column and `current_user()` accepted any token that existed in the table. | Added `expires_at` with a 30-day TTL. Migration backfilled the 171 existing sessions from `created_at + TTL` so the upgrade does not sign everybody out at once. `current_user()` now requires a live `expires_at`, renews on a 7-day sliding window, and `expire_overdue()` purges dead rows. | Fresh token → 200; expired token → 401; sliding renewal extends; security §D |
| D | Non-image files were written to disk and served back as images | Med | The upload handlers trusted the file extension and, when PIL could not decode the payload, fell back to writing the **raw bytes** to `/uploads/<name>.jpg`. An HTML file or a script renamed to `.jpg` was stored and then served from the app's own origin. | Added `decode_image()` (PIL `verify()` + `load()`); `process_image()` returns `(None, error)` instead of falling back; both the listing-upload and avatar endpoints reject with 400. | HTML-as-.jpg → 400, forged PNG header → 400, truncated JPEG → 400, real JPEG → 200 with thumbnail |
| E | Missing indexes on the hottest query paths | Low | `messages(receiver_id, read)` (the unread-badge query, run on every boot), `sessions(user_id)`, `favorites(listing_id)`, `categories(parent_id)` and `listings(created_at)` (the default sort) were all unindexed full scans. | 5 `CREATE INDEX` statements added to the schema; DB now carries 22 indexes. | `PRAGMA index_list` on each table |
| F | 545 KB of unused Framework7 CSS shipped on every page load | High | `index.html` linked `css/framework7.bundle.min.css`, but the SPA never instantiates Framework7. Every rule that could have matched required an F7-only ancestor (`.ios`, `.md`, `.modal-in`, `.navbar-transitioning`) that the app never renders, and no `--f7-*` custom property was referenced anywhere. | Removed the `<link>`, `git rm`'d the file, and ported the only things it actually contributed — the bare-element resets (tap-highlight, touch-callout, `a{cursor}`, `p{margin}`, button `appearance`/`width`) — into `lankalens.css` so nothing visual changed. | Bundle URL → 404, theme CSS → 200, no stylesheet 404s, homepage renders identically, layout-guard passes, resets still present |
| G | No Open Graph or Twitter Card metadata — every share looked the same | Med | `index.html` had only `<title>`; `setMeta()` wrote title and description and nothing else, so a listing shared to WhatsApp or Facebook produced a generic card with no photo and no price. | Static OG/Twitter/canonical/geo/robots/author tags in the shell, plus `setMeta()` gained an `image` argument and new `absUrl()` / `setMetaTag()` helpers. It now writes `og:title/description/url/image/type` and `twitter:card/title/description/image`. Listing detail shares the first photo with `og:type=product`; blog posts share `p.image`; shop pages share `b.logo`. | part3-audit §C: 12 assertions across listing and non-listing routes |
| H | **N+1 query: 77 SQL statements to render one page of 24 listings** | High | `serialize_listing()` ran three queries per row — `has_urgent_badge()`, a seller lookup and a business lookup. | Added `listing_ctx(rows)`, which pre-loads all three for the whole page in 3 batched queries, and `serialize_listings(rows)`, now used by the seven list endpoints (browse, related, favorites, my listings, seller page, business page, admin user view). | `/api/listings` **77 → 6** statements; `/api/listings/<id>` 25 → 13; `/api/seller/<id>` 32 → 9; `/api/business/<slug>` → 7. Batched payloads verified **byte-identical** to the per-row output for a 24-card page and a 4-card related list, plus the empty-page case |
| I | **The listing API accepted invalid data — validation existed only in the browser** | High | `create_listing`/`update_listing` checked only that a title was non-empty and that price was not negative. The wizard's `maxlength` and required-field rules were client-side only, so a hand-built request could store a 5 000-character title, a 200 KB description, or an *active* listing with no price and no location at all. | Added `validate_listing_fields(body, require_complete)`, shared by create and update: title required and ≤ 120 chars; description ≤ 4 000; price a positive integer ≤ 1e9 for anything published (drafts may omit it); province/district required and checked against the `provinces`/`districts` tables; condition checked against the allowed list; specs restricted to scalar values with per-value and per-key caps. | security §A: 11 rejection cases including `"1 OR 1=1"` as `category_id`, negative/zero/string price, unknown category, missing location, empty body, and a 200 KB oversized payload |
| J | Deleting a listing left its notifications behind, pointing at a page that no longer exists | Med | `notifications.link` stores a hash-route string (`#/ads/12`), not a foreign key, so the `ON DELETE CASCADE` on the listing never reached it. The audit found **22 such dead links** in the working database. | `delete_listing()` now also deletes `notifications WHERE link = '#/ads/<id>'`. The 22 existing dead rows were purged. | Create + renew produce 2 notifications → delete removes both → unrelated notifications untouched → 0 dead `#/ads` links in the table |
| K | Orphaned `shops` table plus two dead API endpoints | Low | `businesses` superseded `shops`: `views.shops` calls `/api/businesses`, and the admin dashboard counts shops from `businesses`. Nothing read the 6 seeded `shops` rows — three duplicated a business by name, three (Galle Lens Center, Negombo Camera Mart, Colombo Lens Exchange) described shops that exist nowhere else in the product. | Removed both `/api/shops` endpoints, the `CREATE TABLE shops` block and its seed block; added a guarded `DROP TABLE shops` to `migrate()` for existing databases. No foreign key referenced the table, so the drop is safe. | `/api/shops` → 404, `/api/businesses` → 200, `#/shops` and `#/shop/<slug>` still render (56 shop assertions pass) |
| L | **20 of 40 routes rendered no `<h1>` at all** | Med | The app's top bar rendered its title as `<div class="title">`. 19 of the 20 affected routes get their only heading from that bar; `categories` reaches it through a `fullHeader()` wrapper. Screen readers had nothing to announce and crawlers had no page subject. | `header()` now renders `<h1 class="title">`. Views that already render their own heading **in the same code path** (seller, sign-in, sign-up, contact, blog, post, shops, the static-page factory, forgot, reset-password, shop page) pass `{ heading: false }`, so no page ends up with two. Error/empty paths keep the h1 because they render no heading of their own. | 40/40 routes: exactly one `<h1>`, zero with none, zero with two |
| M | 59 content images carried an empty `alt=""` | Med | `alt=""` means "decorative — skip this". It was applied to product photos, guide thumbnails and shop logos, i.e. precisely the images that carry the page's meaning. | Descriptive alt at 20 image sites, taken from data already in scope: listing photos get the listing title (gallery slides and thumbnails are numbered), guides get the post title, shops get `<name> logo`, the chat header gets the listing title, wizard previews get `Photo N preview`. Avatars deliberately keep `alt=""` — they always sit next to the person's name, so naming them twice is noise. | 0 images missing an alt attribute, 0 content images with an empty alt, across all 40 routes |
| N | Wizard photo preview interpolated an unescaped URL into `src` | Low | The local object-URL preview used `'<img src="' + src + '"'` while every other image site went through `esc()`. The value is app-generated (`URL.createObjectURL`) rather than user HTML, so it was not exploitable — but it was the one inconsistent site. | Routed through `esc()` like every other image. | security §B: no element on any audited route carries an `on*` attribute or a `javascript:` URL |

---

## 2. Full frontend audit (requirement 1)

Every route in the SPA's route table was booted in three states — signed out, signed in as a normal user, signed in as admin — and asserted to render real content.

- **40 routes audited** (26 public, 9 auth-protected, 5 admin), covering every entry in the `routes` array plus the unknown-route fallback.
- **No stuck spinners:** every route asserts zero `.spinner` elements remaining after the async work settles.
- **No console errors / unhandled rejections** on any route in any state.
- **API-error and empty-data handling:** each list surface goes through the shared `renderAsync()` state machine (loading → empty → error → retry). Failure injection (`500`, network failure, empty array, malformed JSON) is exercised by `test-async-states.mjs` (48 assertions) — every surface shows a message plus a working Retry button, never a permanent "Loading…".
- **Refresh and back/forward:** deep links booted cold render correctly; `history.back()`/`forward()` restore the right view; an unknown hash renders the not-found page with a way home.

## 3. Routing audit (requirement 2)

`test-route-audit.mjs` — **359 assertions, all passing**:

- Direct URL navigation to every route, cold (no prior in-app state).
- Refresh on a deep link (`#/ads/<id>`, `#/shop/<slug>`, `#/blog/<slug>`, `#/category/<slug>`, `#/admin/<section>`).
- Back/forward across a multi-hop history.
- Unknown routes → not-found page, not a blank screen or a console error.
- Auth-protected routes while signed out → redirected to `#/sign-in` **with the intended destination preserved**, and returned there after signing in (`test-redirect.mjs`: ALL REDIRECTS OK).
- Admin routes as a normal user → refused in the UI *and* by the API (403).

## 4. API contract audit (requirement 3)

Every `api.get/post/patch/del` call site in the frontend was extracted and matched against the Flask route table: **110 calls, 0 mismatches** on path, method, auth requirement or response shape. The reverse direction was checked too — no backend route is unreachable from the SPA except the two intentionally-internal ones, and the two genuinely dead ones (`/api/shops`, `/api/shops/<id>`) were removed under bug K.

## 5. Database audit (requirement 4)

Final delivered state of `server/lankalens.db`:

| Check | Result |
|-------|--------|
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` | 0 violations |
| Tables | 29 (`shops` removed) |
| Indexes | 22 (5 added under bug E) |
| Orphaned listings (bad `category_id` / `user_id`) | 0 |
| Duplicate user emails | 0 |
| Duplicate titles per seller | 0 |
| Listings with price ≤ 0 or no province/district | 0 |
| Listings with title > 120 chars | 0 |
| Notifications pointing at a deleted listing | 0 |
| Seed data | 8 users, 35 listings, 3 businesses, 37 categories (5 parents + 32 children), 11 guides |

Relationships are all declared with `ON DELETE CASCADE` where a parent disappears, and the cascade was verified live: deleting a listing removes its favorites, offers and reports with no orphans. The one gap the cascade could not cover — `notifications.link`, a string rather than an FK — is bug J.

Migrations are additive and idempotent; no user data was destroyed. The `expires_at` backfill and the `shops` drop are both guarded so re-running `migrate()` is a no-op.

## 6. Listing system (requirement 5)

- **Create / edit / delete:** full seller journey passes (`test-postad.mjs`, 61 assertions) — category picker → wizard → publish → appears in My Ads → edit → delete → gone.
- **Permission checks (no cross-user mutation):** user B patching user A's listing → **403**; deleting → **403**; the listing is byte-for-byte unchanged afterwards; the owner can delete it. All four `/admin/*` endpoints → 403 for a normal user, 200 for an admin.
- **Favorites, search, filter, contact, report:** all exercised; search matching was fixed in Part 2 and re-verified here (45 assertions).
- **Delete integrity:** `DELETE` hard-deletes the row, cascades children, returns 200, and a second `DELETE` correctly returns 404.

## 7. Image system (requirement 6)

- Upload, multi-image ordering, cover selection and preview all pass in the post-ad journey.
- **Validation:** non-images are rejected (bug D) rather than stored.
- **Failure resilience — "the UI must never break on image failure":** now enforced globally by bug B. Tested with a single 404ing image, a listing whose every photo 404s, and a full grid of broken thumbnails: the placeholder appears, the grid geometry survives, alt text is retained, and the fallback never re-triggers itself.
- **Missing images:** cards, galleries, avatars, shop logos and guide thumbnails all have designed placeholders (`<span class="ph">` with an icon) rather than empty boxes.
- Large images are thumbnailed server-side on upload.

## 8. Mobile responsiveness (requirements 7 & 8)

Static cascade analysis of both stylesheets (no fixed-width overflow risks found):

- **No fixed widths ≥ 320 px** anywhere; every inline `width` in the JS is a `max-width`.
- **No `100vw`** (the classic cause of horizontal scroll from scrollbar width).
- Wide content is wrapped: tables sit in `.a-table-wrap { overflow-x: auto }`.
- The shell is centred with `--shell: 560px` max-width, so 320 px → 1920 px all lay out without overflow.
- **Bottom navigation never covers content:** the tabbar is 64 px tall and every scrollable page carries `padding-bottom: calc(70px + env(safe-area-inset-bottom))`. Verified per-route in part3-audit §F, including the detail page (tabbar hidden, action bar shown instead) and the post-ad wizard (body padded above its own nav).
- **Safe areas:** 8 uses of `env(safe-area-inset-bottom)` across all fixed-bottom elements.
- No fixed heights that block natural scrolling; the layout uses `min-height` and `100dvh`/`100svh`, and the tabbar is hidden on the auth pages.

> **Caveat:** no real browser could be installed in this sandbox (see §17.1), so this is a cascade/DOM analysis plus jsdom geometry, not observed paint at each breakpoint.

## 9. Auth security (requirement 9)

- Passwords hashed with PBKDF2-HMAC-SHA256 at 120,000 iterations and a per-user salt, compared with a constant-time `hmac.compare_digest`-style check (no plaintext, no reversible encoding, no timing oracle).
- Token expiry now enforced (bug C): 30-day TTL, 7-day sliding renewal, dead sessions purged.
- Logout invalidates the token server-side — a replay of the same token afterwards returns 401.
- Invalid, forged (64 random chars) and malformed (`Bearer` with no token) credentials all return **401, never 500**.
- Failed login returns a useful message **without** revealing whether the account exists.
- No secret, key, hash or token is present in any frontend file; `/admin/users` was asserted not to leak `password_hash`.
- Weak passwords and duplicate emails are rejected at signup.

## 10. Form & input security (requirement 10)

- **Backend validation** is now the real gate (bug I) — 11 hostile payloads rejected with 4xx.
- **SQL injection:** every query is parameterized. `category_id: "1 OR 1=1"` is rejected as an invalid category; a static scan found no string-concatenated SQL.
- **Stored XSS:** a listing was created with `<img onerror>`, `<script>`, `<svg/onload>`, `<iframe src=javascript:>` and `<b>` across title, description, model, city and a spec value, then rendered on the detail page, the browse grid, the homepage and the seller page. On every route: no script executed, no live `<script>` tag, **no element carrying an `on*` attribute**, no `javascript:` URL, no JS errors. The renderer escapes consistently and `esc()` is used at every interpolation site (bug N closed the last inconsistent one).
- **File uploads:** validated by decoding (bug D); extension is not trusted.
- **Oversized requests:** a 200 KB description / 5 000-char title is rejected with a 4xx, not a 500; field caps are enforced server-side.
- **Unauthorized modification:** 403 across the board (see §6).

## 11. Performance (requirement 11)

- **N+1 eliminated** (bug H): 77 → 6 statements for a listing page; 32 → 9 for a seller page.
- **Missing indexes added** (bug E), including the unread-badge query that runs on every boot.
- **545 KB removed from every page load** (bug F).
- **No duplicate API calls per route:** the route audit records every request per route and asserts no redundant repeats; `/api/meta` and `/api/locations` are memoized through `ensureMeta()`.
- **No leaking listeners or timers** (bug A): the poller registry cancels on navigation, and image fallback binding is a single document-level listener rather than one per image.
- **No infinite loading:** every async surface resolves to content, empty or error state.

## 12. Console & network audit (requirement 12)

The full suite was run against the live server and every non-2xx response accounted for:

| Status | Source | Verdict |
|--------|--------|---------|
| 404 `/css/framework7.bundle.min.css` | test deliberately requests the removed bundle | expected |
| 404 `/api/shops` | test asserts the dead endpoint is gone | expected |
| 401 `/api/me` | expired-token test | expected |
| 401 `/api/auth/login` ×2 | wrong-password tests | expected |
| 409 `/api/auth/signup` | duplicate-email test | expected |
| 403 `/api/admin/*`, 403 cross-user PATCH/DELETE | permission tests | expected |
| 400 upload/validation rejections | hostile-payload tests | expected |

**No unexplained 404, 401, 403, 422, 429, 500, 502 or 503.** The route audit additionally asserts *zero 5xx from the API* on all 40 routes in all three auth states.

## 13. Demo / template cleanup (requirement 13)

- **Framework7 bundle removed** (bug F) — the only third-party template leftover, 545 KB.
- **Orphaned `shops` table and its 6 seeded rows removed** (bug K), including 3 phantom shops that existed nowhere else in the product.
- No "Buzzle" or other template branding anywhere in the source.
- **QA artifacts purged from the delivered database:** the 6 `@example.com` accounts created by the signup tests, their sessions/tokens, the test listings, and 22 notifications with dead links. Final DB holds exactly the 8 seeded users and 35 seeded listings.
- Remaining seed content is genuinely Lanka Lens material (Sri Lankan sellers, districts, LKR prices, camera-specific guides).

## 14. SEO (requirement 14)

| Element | Before | After |
|---------|--------|-------|
| `<title>` per route | yes (all 40) | yes (all 40) |
| meta description per route | yes (all 40) | yes (all 40) |
| Open Graph / Twitter Card | **none** | static shell tags + dynamic per-route title/description/url/image/type (bug G) |
| canonical URL | **none** | present, and updated to the shareable `/listing/<slug>` form on detail pages |
| exactly one `<h1>` per page | **20 of 40 had none** | 40/40 (bug L) |
| pages with two `<h1>`s | 0 | 0 |
| alt text on content images | **59 empty** | 0 empty, 0 missing (bug M) |
| readable URLs | hash routes + `/listing/<slug>` share URLs | unchanged |
| geo/robots/author meta | none | added |

## 15. End-to-end user journeys (requirement 15)

- **Buyer:** home → category → browse with filters → search → listing detail → gallery → favourite → contact seller (call / WhatsApp / chat) → send a message → make an offer → view the shop page → read a guide. All steps pass.
- **Seller:** register → verify the wizard → publish a listing → see it live → edit it → renew it → check analytics → delete it (with notifications cleaned up, bug J). All steps pass.
- **Business:** sign up as a business → create the shop profile with a validated logo upload → publish listings → the public `#/shop/<slug>` page renders with its own OG image. All steps pass.

## 16. Files changed

| File | Change |
|------|--------|
| `js/app.js` | +poller registry (`addPoller`/`clearPollers`), +`bindImageFallbacks()` and the inline SVG placeholder, +`absUrl()`/`setMetaTag()` and an extended `setMeta(…, image)`, `header()` renders `<h1>` with a `{ heading: false }` opt-out at 11 call sites, descriptive alt at 20 image sites, one unescaped `src` fixed |
| `server/app.py` | +`SESSION_TTL_DAYS`/`SESSION_RENEW_WINDOW` and expiry enforcement, +`decode_image()` and rejection of invalid uploads, +`validate_listing_fields()` wired into create and update, +`listing_ctx()`/`serialize_listings()` batching across 7 endpoints, +5 indexes, +`expires_at` migration and backfill, +guarded `DROP TABLE shops`, notification cleanup on delete, −2 dead `/api/shops` endpoints, −`shops` schema and seed |
| `css/lankalens.css` | +the bare-element resets ported from the removed bundle, +`.img-fallback`, +`font-family`/`letter-spacing`/`line-height`/`margin` pins on `.app-header .title` so the promoted `<h1>` renders identically to the old `<div>` |
| `index.html` | −Framework7 `<link>`, +static OG/Twitter/canonical/geo/robots/author tags |
| `css/framework7.bundle.min.css` | **deleted** (545 KB) |

**API changes:** `/api/shops` and `/api/shops/<id>` removed (dead). Listing create/update now return 400 for payloads that were previously accepted. No response shape changed — batched serialization was verified byte-identical.

**Database changes:** `sessions.expires_at` added and backfilled; 5 indexes added; `shops` table dropped. All additive or dead-code removal; no user data destroyed; all steps idempotent.

---

## 17. Remaining issues and caveats

None of these are application defects found by the audit; they are environment and deployment items.

1. **No real browser was available.** Chromium/Firefox could not be installed in this sandbox (every CDN and the apt mirrors are unreachable), so all UI verification is jsdom plus static CSS cascade analysis. DOM structure, class names, inline styles, computed padding and listener/timer behaviour are genuinely verified; **actual painted pixels at 320–1920 px, real `env(safe-area-inset-bottom)` values, on-device keyboard behaviour and paint timing are reasoned about, not observed.** A pass on real hardware is the one thing this audit cannot substitute for.
2. **Development server.** Flask's built-in server is what runs here (`WARNING: This is a development server`). Production needs gunicorn/waitress behind a reverse proxy.
3. **No rate limiting.** There is no throttle on `/api/auth/login` or on uploads, so credential stuffing and upload abuse are possible. Recommend `flask-limiter` (e.g. 5 logins/min/IP).
4. **Token storage.** Session tokens are returned in JSON and kept in `localStorage`, which is readable by any script on the origin. The XSS audit found no injection vector, but `httpOnly` + `SameSite` cookies would remove the class of risk entirely.
5. **No Content-Security-Policy header.** `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` are set; a CSP would add defence in depth (note: the app uses inline styles heavily, so a CSP would need `style-src 'unsafe-inline'` or a refactor).
6. **Password-reset email is not wired.** The flow issues and stores a reset token correctly, but there is no SMTP provider configured, so no mail is actually delivered.

## 18. Tests performed

| Suite | Assertions | Result |
|-------|-----------|--------|
| `test-route-audit.mjs` — all 40 routes × 3 auth states, deep links, refresh, back/forward, unknown routes, auth redirects | 359 | **0 failed** |
| `test-security.mjs` — input validation, stored XSS, permissions, auth edge cases, headers | 59 | **0 failed** |
| `test-part3-audit.mjs` — image fallbacks, poller lifecycle, OG metadata, bundle removal, dead sessions, nav clearance | 45 | **0 failed** |
| `test-postad.mjs` — full seller journey | 61 | **0 failed** |
| `test-shops.mjs` — shop directory and shop pages | 56 | **0 failed** |
| `test-async-states.mjs` — loading/empty/error/retry under injected failures | 48 | **0 failed** |
| `test-search.mjs` — search and filter matching | 45 | **0 failed** |
| `test-layout-guard.mjs` — auth-page structure, tabbar visibility, CSS cascade | all checks | **PASSED** |
| `test-smoke.mjs` — every route renders cleanly, signed out and in | all routes | **PASSED** |
| `test-seo-semantics.mjs` — h1 count, alt coverage, title/description per route | 40 routes | **0 gaps** |
| `test-authflow`, `test-redirect`, `test-response-matrix`, `test-signin`, `test-signup-matrix`, `test-split-origin`, `test-part2-diagnose` | — | **exit 0** |
| Backend probes | session expiry/renewal, upload validation, N+1 measurement, payload identity, delete cascade, notification cleanup, DB integrity | **all as expected** |

**Total: 673 named assertions, 0 failures.**

## 19. Overall status

# READY

All 14 defects found by this audit are fixed and verified. The three highest-risk items — sessions that never expired, image uploads that were not validated, and input validation that lived only in the browser — are closed. The performance work cut the listing page from 77 SQL statements to 6 and removed 545 KB from every page load. Every route renders correctly in all three auth states with no console errors, no unexplained network failures, no stuck loading states and exactly one semantic heading.

The application is ready to ship **once the six deployment items in §17 are addressed** — those are production-environment concerns (WSGI server, rate limiting, CSP, email delivery, token storage) rather than defects in the code audited here, and the one thing that genuinely still needs human eyes is a visual pass on real devices, which this sandbox could not perform.
