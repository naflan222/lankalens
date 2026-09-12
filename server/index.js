'use strict';
require('dotenv').config();
const express = require('express');
const path = require('node:path');
const cookieParser = require('cookie-parser');

const { applySchema } = require('./db');
const repo = require('./lib/repo');
const { attachUser } = require('./middleware/auth');
const { errorHandler, rateLimit } = require('./middleware/util');

const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const listingRoutes = require('./routes/listings');
const accountRoutes = require('./routes/account');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const contentRoutes = require('./routes/content');
const adminRoutes = require('./routes/admin');
const { db } = require('./db');

applySchema();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ---- baseline security headers (no secrets ever reach the client) ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "connect-src 'self'",
    "frame-src 'self' https://www.google.com https://maps.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

const ROOT = path.join(__dirname, '..');

// ---- static assets ----
app.use('/uploads/images', express.static(path.join(ROOT, 'uploads', 'images')));
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), { maxAge: '7d' }));
app.use('/css', express.static(path.join(ROOT, 'css'), { maxAge: '7d' }));
app.use('/js', express.static(path.join(ROOT, 'js'), { maxAge: '1h' }));
app.use('/fonts', express.static(path.join(ROOT, 'fonts'), { maxAge: '30d' }));
app.use('/images', express.static(path.join(ROOT, 'images'), { maxAge: '7d' }));
app.use('/pages', express.static(path.join(ROOT, 'pages'), { maxAge: '1h' }));

// ---- API ----
app.use('/api/auth', rateLimit('api', 240), authRoutes.router);
app.use('/api', rateLimit('api', 300), catalogRoutes);
app.use('/api/listings', attachUser, rateLimit('api', 300), listingRoutes.router);
app.use('/api/account', attachUser, rateLimit('api', 300), accountRoutes);
app.use('/api/chat', attachUser, rateLimit('api', 300), chatRoutes);
app.use('/api/notifications', attachUser, rateLimit('api', 300), notificationRoutes);
app.use('/api', rateLimit('api', 300), contentRoutes);
app.use('/api/admin', attachUser, rateLimit('api', 300), adminRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lankalens', time: Date.now() }));

// ---- SEO ----
const SITE = process.env.LL_SITE_URL || 'http://localhost:3000';
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  const urls = ['', 'cameras', 'lenses', 'action-cameras', 'drones', 'accessories', 'shops', 'sell', 'buying-guide', 'safety', 'blog', 'about', 'contact', 'faq'];
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const u of urls) lines.push(`<url><loc>${SITE}/${u}</loc><changefreq>${u ? 'weekly' : 'daily'}</changefreq></url>`);
  const tree = repo.categoryTree();
  for (const top of tree) {
    lines.push(`<url><loc>${SITE}/${top.slug}</loc><changefreq>daily</changefreq></url>`);
    for (const sub of top.children) lines.push(`<url><loc>${SITE}/${top.slug}/${sub.slug}</loc><changefreq>daily</changefreq></url>`);
  }
  const ls = db.prepare("SELECT slug,updated_at FROM listings WHERE status='active' ORDER BY updated_at DESC LIMIT 5000").all();
  for (const l of ls) lines.push(`<url><loc>${SITE}/listing/${l.slug}</loc><lastmod>${new Date(l.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq></url>`);
  for (const b of db.prepare("SELECT slug FROM blog_posts WHERE published=1").all()) lines.push(`<url><loc>${SITE}/blog/${b.slug}</loc></url>`);
  for (const s of db.prepare("SELECT slug FROM business_profiles WHERE status='approved'").all()) lines.push(`<url><loc>${SITE}/shop/${s.slug}</loc></url>`);
  lines.push('</urlset>');
  res.type('application/xml').send(lines.join('\n'));
});

// ---- SPA: F7 page fragments for the router + shell fallback ----
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get(/^\/[a-z0-9-]+\/?$/i, (req, res, next) => {
  // clean single-segment URLs (e.g. /cameras, /safety, /admin) all render the shell
  res.sendFile(path.join(ROOT, 'index.html'), (err) => err && next(err));
});
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(ROOT, 'index.html'));
  res.status(404).sendFile(path.join(ROOT, 'index.html'));
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Lanka Lens running on http://localhost:${PORT}`);
});
