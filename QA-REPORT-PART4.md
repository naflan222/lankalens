# Lanka Lens — Part 4: Logo, Mobile Search, Locations, User Types & Shop Verification

**Branch:** `arena/01a0988a-lankalens`
**Scope:** the 7 requested product changes — (1) website logo, (2) mobile search focus/keyboard, (3) dropdown repeated-symbol fix, (4) Sri Lanka location data, (5) user types (individual vs business), (6) admin-controlled shop verification, (7) UI/UX consistency — plus full regression testing of everything pre-existing.
**Result:** **5 implementation defects found and fixed. 105 automated assertions pass (56 API E2E + 49 frontend jsdom) + the in-place migration test. Status: READY** — the only open item is the user's logo *file*, which has not been uploaded yet (pipeline is complete; §2).

---

## 1. Bugs found, root causes and fixes

| # | Defect | Sev | Root cause | Fix | Verified by |
|---|--------|-----|-----------|-----|-------------|
| O1 | First boot after upgrade crashed with `sqlite3.OperationalError: 1 values for 2 columns` inside `sync_locations()` | High | The "add missing location additively" step used a malformed `INSERT OR IGNORE … SELECT ? WHERE NOT EXISTS (…)` — a `SELECT` with a bare `?` value but no `FROM`, which SQLite parses as a two-column row. | Replaced the one-liner with a Python-side existence check (`SELECT 1 … LIMIT 1`) followed by a plain `INSERT` when the row is absent. Same behaviour (additive, never touches existing rows), no SQL parse ambiguity. | e2e §1 (9 provinces / 25 districts / no dupes / ≥150 cities after boot); migration test (additive sync on an old DB) |
| O2 | Migration backfill silently never ran: on an upgraded production DB every pre-existing business came up as `not_submitted` even when it had the legacy `verified = 1` flag | High | `ALTER TABLE ADD COLUMN verification_status TEXT DEFAULT 'not_submitted'` assigns that default to **every existing row** at ALTER time, so the subsequent backfill `WHERE verification_status IS NULL OR verification_status = ''` matched zero rows. | Backfill keyed off the **old flag column** instead: `UPDATE businesses SET verification_status='approved' WHERE verified = 1 AND verification_status != 'approved'` (idempotent), plus a `submitted_at`/`reviewed_at` stamp for rows that end up approved. Legacy `verified=0` rows correctly land in `not_submitted`. | migration test: old-schema DB with 1 verified + 1 unverified business → `approved` / `not_submitted` after upgrade; re-boot idempotency (state unchanged, counts stable) |
| F1 | **`#/my-shop` crashed for business users** — the page showed "Cannot read properties of undefined (reading 'map')" and no form rendered | High | When `views.myShop` was rebuilt, the `return { html, mount }` was left at the top of the function, before the `var BIZ_CATEGORIES = […]` and `var DAYS = […]` declarations. Those assignments are dead code after a `return`, and `var` hoisting leaves the names as `undefined` — so `DAYS.map(…)` threw on every render of the shop form. The API-only E2E suite could not see this; the jsdom frontend smoke test caught it immediately. | Moved both `var` declarations above the `return` (three lines, no behaviour change). | frontend smoke: my-shop renders status card + full form + document preview for a pending business; no console errors |
| F2 | **The admin "Businesses" section never rendered** — `#/admin/businesses` silently fell back to the dashboard | High | `loadAdminSection()`'s section→view map (`{ dashboard, users, listings, reports, … }`) was never given the `businesses: ADMIN_VIEWS.businesses` entry, so `fn` was `undefined` and the existing fallback (`if (!fn) section = 'dashboard'`) masked it. | Added the missing map entry. | frontend smoke: `#/admin/businesses` renders the list with status chips; UI-level Approve click → dialog → POST → row becomes Verified + Revoke; public directory picks the shop up |
| F3 | Admin Businesses filter "All" returned an **empty list** | Med | `GET /api/admin/businesses?status=all` bound the literal string `'all'` into `WHERE b.verification_status = ?`, which matches no row — so selecting "All" showed "No shops in this state yet" while every other filter worked. | Treat `all` (and empty) as *no filter*: `if status and status != "all"`. | frontend smoke: after approving a shop, switching the filter to "all" shows the approved row with Verified chip; e2e suite (specific-status filters) still 56/56 |

O1/O2 were found while wiring the first clean boot; F1–F3 were found by the **new jsdom frontend smoke test** (a browser-level harness that boots the real `index.html` + `js/app.js` against the live server and drives real navigation, clicks and cascades) — proof that API-only testing was not sufficient for the rebuilt SPA views.

---

## 2. Item 1 — Website logo

**Code: complete. File: awaiting the user's upload.**

- `logoMark()` (`js/app.js`) now renders `<span class="brand-mark"><img src="…" alt="Lanka Lens logo" draggable="false"></span>` when `state.meta.settings.logo` (or `window.LL_LOGO_URL`) is set, and falls back to the original inline SVG when it is not. It is the **single** source of the mark, used in all six places the logo appears:
  - top header (`.brand`),
  - footer,
  - mobile drawer menu head,
  - sign-in page,
  - sign-up page,
  - reset-password page.
  There is no other hand-rolled logo markup anywhere in the app.
- The image is used **exactly as provided**: `.brand-mark img { width:100%; height:100%; object-fit: contain }` — no crop, recolor, filter or aspect change; only the containing box scales responsively (38 px nav / 44 px drawer / 62 px auth hero / 48 px on short viewports).
- Backend: `settings.logo` exists (`DEFAULT_SETTINGS`, `app.py`), is exposed through `GET /api/meta` (`settings.logo`), and `migrate()` back-fills the value for existing databases whose row is empty.
- **To finish:** drop the logo file in `images/` and set `DEFAULT_SETTINGS["logo"]` (one line) — or set it via the existing admin settings flow. Everything else (all six render sites, responsive sizing, fallback) is already live and tested (smoke asserts `.brand .brand-mark` renders on home with zero console errors).

## 3. Item 2 — Mobile search: focus + keyboard

- All three hero search forms (`#search-form`, home search, browse search) carry `inputmode="search"` and `enterkeyhint="search"` so Android/iOS open the search keyboard variant, plus `autocomplete="off"` to stop autofill popups stealing focus.
- The dedicated Search route explicitly focuses its input in a `requestAnimationFrame` after mount (`focus({ preventScroll: true })`) — the keyboard opens the moment the route lands, and the input sits inside a container with `max-width:100%`, `min-width:0` flex rules and a non-shrinking button, so the bar can never grow past the viewport or get pushed behind the keyboard (the hero is at the top of a normal scroll, not fixed).
- On coarse pointers (phones/tablets) the search input font size is 16 px — below 16 px iOS Safari zooms the page on focus, which was the classic "search feels broken on iPhone" cause.
- **Verified:** smoke test asserts the Search route's input is `document.activeElement` on arrival (focus = keyboard trigger), the attributes are present, typing + submit navigates to `#/browse?q=…` and renders results — with zero console errors. Desktop search is the same code path (attributes are inert on desktop) and is covered by the same submit assertion.

## 4. Item 3 — Repeated dropdown symbols (root cause)

- **Root cause (not cosmetic):** the chevron was a CSS `background-image` with `background-repeat` defaulting to `repeat`. Two `!important` background **shorthands** (`background: #fff !important`) in `style.css` reset `background-repeat` to `repeat` *as important*, tiling the 16 px chevron across the entire width of every `.select` field — the "many repeated arrows" seen in Province/District/City and elsewhere.
- **Fix at the root:** every background declaration that touched selects now sets only `background-color`; and `.select` itself asserts `background-repeat: no-repeat !important; background-position: right 12px center !important` (confirmed present in the served CSS by the e2e suite). One chevron, right-aligned, on every dropdown — none hidden by hiding text.
- Verified by e2e (`select no-repeat important in css` against the served stylesheet) and by the wizard location step rendering in the smoke test (real `<select>`s with the cascade below).

## 5. Item 4 — Sri Lanka location data (9 provinces → districts → cities)

- The dataset (`PROVINCES` in `server/app.py`) now carries **all 9 provinces, all 25 districts, 172 cities/towns**, each city under exactly one district (dupe-checked programmatically; three cross-district dupes found and removed during authoring). Correct official names (e.g. Vavuniya district with Nediyanthurai, Kankesanthurai; Kandy district with Peradeniya).
- **Cascading UI:** `bindLocationSelects()` — province change resets district *and* city; district change resets city. Every call site (ad wizard step 7, My Shop location, search/browse filters, user settings) uses the same helper, so behaviour is identical everywhere.
- **Structure:** one plain `PROVINCES` dict (`province → {districts: [ {cities: […] } ]}`) with a docstring — adding a town is a one-line append. `sync_locations()` runs on every boot and is strictly **additive**: it inserts missing rows, removes only the one known legacy dupe (Negombo under Colombo Province), and never deletes or rewrites admin-added rows.
- **API/DB format preserved:** `GET /api/locations` returns the same shape as before (`provinces[] → districts[] → cities[]`), so no frontend or third-party consumer changes were needed.
- **Verified (smoke, real DOM):** wizard reaches the location step; province select holds exactly 9; choosing *Northern Province* yields exactly its 5 districts and clears the city; choosing *Vavuniya* yields Nediyanthurai + Kankesanthurai; switching to *Sabaragamuwa Province* resets the district to exactly Ratnapura + Kegalle. E2E: 9/25/no-duplicate-cities/≥150-city assertions pass after a cold boot.

## 6. Items 5 + 6 — User types and admin-controlled shop verification

**User types.** `users.seller_type ∈ {individual, business}`; admins are distinguished by `users.role`. An **individual** account is a normal account: it can buy and sell personal items through the existing wizard, and no shop UI is shown (My Shop shows only the "Become a business seller" upgrade card, verified by smoke). A **business** account is an explicit opt-in (sign-up type or the My Shop upgrade button) and still has **nothing** until verification.

**Verification state machine** (`businesses.verification_status`, extensible — new levels only need a new value + one dashboard row):

```
not_submitted ──submit (owner)──► pending ──approve (admin, needs document)──► approved (badge + public shop)
        ▲                            │
        └─────resubmit (owner)────── rejected (admin, reason required)
        └─────revoke (admin, reason required)──── approved
```

- **Badge only on `approved`.** `verified` (the flag every badge site reads) is set *only* by `POST /api/admin/businesses/<id>/moderate` — selecting "Shop" at sign-up, saving shop details, or even submitting never grants it. The shop directory, seller pages and listing badges all key off it.
- **Owner flow:** `PUT /api/me/business` (details incl. name, owner, phone, address, province/district/city, category, registration no., logo, **document**, opening hours) → `POST /api/me/business/submit` (validated server-side: every required field + document present, else 400 with the specific reason; double-submit 400). Rejected owners see the reason in My Shop and can resubmit. While pending/approved the owner sees a private "Preview your shop page" card; unapproved shops 404 for everyone except the owner (`preview:true` renders the "private preview" banner).
- **Admin flow:** dashboard "Shop verification" card (pending shops with Approve/Reject) + full **Businesses** section (filter by status incl. All — see F3 — document preview link, Approve / Reject-with-reason / Revoke-with-reason, owner shortcut, status chips) + business panel on the admin user-detail page. Approve requires a document on file; reject/revoke require a reason (owner notified, in-app notification). Every action is audit-logged.
- **Individual sellers are not burdened:** none of the above is reachable or required for them; the individual sign-up/login/post-ad journey is byte-for-byte the old journey (smoke: individual account sees the upgrade prompt, no status card, no verification UI).

**Verified end-to-end (56 API assertions + 6 UI assertions):** individual signup/login + post-ad (with a brand-new city accepted) and invalid-location rejection; business create → `not_submitted`, hidden from the directory, private 404 for strangers, 200 preview for owner; incomplete submit 400; document upload; 1 MB upload limit enforced; submit → pending; double-submit 400; non-admin 403; approve → badge + directory + public 200; revoke → private again; reject-without-reason 400; reject-with-reason → owner notified with reason; resubmit → re-approve; seeded verified shops listed, seeded unverified shop hidden; seller page hides unapproved businesses. Frontend: My Shop full form for all four statuses, admin Businesses list + **real Approve click through the dialog**, post-approval state, individual upgrade prompt, shops directory contents, public shop page badge.

## 7. Item 7 — UI/UX

- All new surfaces reuse the existing design system (`.form-card`, `.status-chip`, `.a-row`/`.a-side`/`.a-actions`, dialogs, toasts, Ionicons) — no new visual language, no added animations (the only motion is the existing spinner→content swap).
- Touch-friendly: existing 40 px control heights and the 16 px mobile input rule apply to all new forms; admin rows use full-width wrap-friendly action buttons.
- Accessible: one `<h1>` per route (Part 3 rule kept), real `<label>`s on all new fields, status conveyed in text (chips), not colour alone.

## 8. Regression protection (pre-existing features)

- **Backblaze B2 untouched:** `b2_client_config()` (`app.py`, incl. `request/response_checksum_calculation="when_required"`) and all B2 helpers are byte-identical to `main`; local-disk fallback verified in the server log on every upload during testing.
- **Upload limits intact:** 1 MB per image (enforced — e2e asserts 400 on a 1.5 MB file) and 3-photo cap (unchanged code path, exercised by the wizard + upload tests).
- **Listings, favourites, chat, posts, blog, settings, admin users/listings/reports/categories/brands/locations/promotions/payments/audit** all render in the smoke/E2E runs with zero console errors; the Part 3 assertion suite's routes were re-exercised as part of the 40-route boot set.
- **Seed data & demo accounts** unchanged; DB seeding still only happens when no DB file exists.

## 9. Test evidence

| Suite | What it does | Result |
|-------|-------------|--------|
| `/tmp/e2e_test.py` | 56 API assertions against a live cold-booted server: locations, auth, individual flow, business + verification lifecycle, admin moderation, privacy, directory, SPA/CSS serving | **56/56 pass** |
| `/tmp/smoke.mjs` | 49 jsdom assertions: boots the real SPA (real `index.html` + `js/app.js` + live API) in 6 identities/routes and drives real user actions — search focus/submit, 9-step ad wizard with the location cascade, My Shop in 4 statuses, admin dashboard + Businesses list + Approve-button click through the confirmation dialog, individual upgrade prompt, shops directory, public shop page; asserts zero console errors/unhandled rejections on every page | **49/49 pass** |
| `/tmp/migration_test.py` | Builds a *legacy* schema DB (old business columns, 3-province locations, the legacy Negombo-dupe, a verified + an unverified business, an admin-added city) and boots the app against it — asserts in-place upgrade: columns added, statuses backfilled off the old `verified` flag, locations synced additively, legacy dupe removed, admin rows preserved; then re-boots to prove idempotency | **ALL PASS** |
| Syntax | `node --check js/app.js`; `python -c "import ast; ast.parse(app.py)"` | clean |

## 10. Open item

1. **The logo file itself** — the user's uploaded logo has not arrived in the workspace. Pipeline (all six render sites, responsive contain-fit, `settings.logo`, migration back-fill, SVG fallback) is complete and tested; saving the file to `images/` and setting the one `DEFAULT_SETTINGS["logo"]` line is all that remains.

## 11. Production (Railway) caveats

- **No DB wipe on deploy:** the app seeds only when the DB file is absent; `migrate()` + `sync_locations()` are additive and idempotent (proven by the migration test), so the existing production database upgrades in place — legacy verified shops keep their badge, everything else starts at `not_submitted`, and no location row is ever deleted (except the single known Negombo dupe).
- B2 env vars, 1 MB / 3-photo limits, and the existing deploy config are unchanged.
- After the logo file lands, set `settings.logo` once (admin settings or the default) — no restart-dependent seeding involved.
