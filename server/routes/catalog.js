'use strict';
const express = require('express');
const { db } = require('../db');
const repo = require('../lib/repo');
const { FILTERS, ATTRS } = require('../data/catalog');

const router = express.Router();

const GROUP_BY_TOP = {
  cameras: 'camera', lenses: 'lens', 'action-cameras': 'action', drones: 'drone', accessories: 'accessory',
};

router.get('/categories', (_req, res) => {
  const tree = repo.categoryTree();
  for (const top of tree) {
    const ids = repo.leafIdsOf(top.id);
    top.listings_count = db.prepare(
      `SELECT COUNT(*) n FROM listings WHERE status='active' AND category_id IN (${ids.map(() => '?').join(',')})`
    ).get(...ids).n;
    for (const sub of top.children) {
      sub.listings_count = db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active' AND category_id=?").get(sub.id).n;
    }
  }
  res.json({ categories: tree });
});

router.get('/categories/:slug', (req, res) => {
  const cat = repo.categoryBySlug(req.params.slug);
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  const top = cat.parent_id ? repo.topCategoryFor(cat.id) : cat;
  const leaf = cat.parent_id ? cat : null;
  const brands = repo.brandsForCategory(cat.id);
  const products = leaf ? repo.productsFor(leaf.id) : [];
  const subs = leaf ? [] : db.prepare('SELECT id,name,slug,icon,color,sort_order FROM categories WHERE parent_id=? ORDER BY sort_order').all(cat.id);
  for (const s of subs) {
    s.listings_count = db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active' AND category_id=?").get(s.id).n;
  }
  const group = GROUP_BY_TOP[top.slug];
  res.json({
    category: { id: cat.id, name: cat.name, slug: cat.slug, icon: cat.icon, color: cat.color, is_leaf: !!leaf },
    parent: leaf ? { id: top.id, name: top.name, slug: top.slug } : null,
    subcategories: subs, brands, products,
    filters: FILTERS[group] || null, attrs: ATTRS[group] || null, group,
  });
});

router.get('/brands', (req, res) => {
  let sql = 'SELECT * FROM brands';
  const params = [];
  if (req.query.scope) { sql += ' WHERE scope=?'; params.push(req.query.scope); }
  sql += ' ORDER BY sort_order,name';
  res.json({ brands: db.prepare(sql).all(...params) });
});

router.get('/products', (req, res) => {
  const { category, brand } = req.query;
  let rows = [];
  if (category) {
    const cat = repo.categoryBySlug(category);
    if (cat) {
      const brandRow = brand ? db.prepare('SELECT id FROM brands WHERE slug=?').get(String(brand).toLowerCase()) : null;
      const leafIds = cat.parent_id ? [cat.id] : repo.leafIdsOf(cat.id);
      let sql = `SELECT DISTINCT p.* FROM products p WHERE p.category_id IN (${leafIds.map(() => '?').join(',')})`;
      const params = [...leafIds];
      if (brandRow) { sql += ' AND p.brand_id=?'; params.push(brandRow.id); }
      sql += ' ORDER BY p.name LIMIT 800';
      rows = db.prepare(sql).all(...params);
    }
  }
  res.json({ products: rows });
});

router.get('/locations', (_req, res) => {
  res.json({ locations: repo.locationTree() });
});

router.get('/settings', (_req, res) => {
  res.json({ settings: repo.publicSettings() });
});

router.get('/packages', (_req, res) => {
  res.json({ packages: db.prepare('SELECT * FROM promotion_packages WHERE active=1 ORDER BY sort_order').all() });
});

module.exports = router;
