# Lanka Lens — Buy & Sell Cameras in Sri Lanka

A Sri Lankan camera marketplace built by transforming the Buzzle classified-ads
mobile template into an original **Lanka Lens** app.

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

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Buyer (demo) | demo@lankalens.lk | demo1234 |
| Seller | nimalka@lankalens.lk | password123 |
| Seller | kasun@lankalens.lk | password123 |
| Shop owner | ishara@lankalens.lk | password123 |
| Admin | admin@lankalens.lk | admin1234 |

## What works (Part 1)

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
