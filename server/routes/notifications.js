'use strict';
const express = require('express');
const { db } = require('../db');
const { now } = require('../lib/util');
const { requireAuth, attachUser } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({
    notifications: rows.map((n) => ({
      ...n, data: safeJson(n.data_json), read: !!n.read_at,
    })),
  });
});

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

router.post('/read', requireAuth, (req, res) => {
  const t = now();
  if (req.body?.id) db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(t, Number(req.body.id), req.user.id);
  else db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(t, req.user.id);
  res.json({ ok: true });
});

// Polled badge counts (chat + notifications + admin queue)
router.get('/badge', attachUser, (req, res) => {
  if (!req.user) return res.json({ notifications: 0, messages: 0, pending: 0 });
  const uid = req.user.id;
  const notifications = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid).n;
  const messages = db.prepare(`SELECT COUNT(*) n FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    WHERE (c.buyer_id=? OR c.seller_id=?) AND m.sender_id<>? AND m.read_at IS NULL`).get(uid, uid, uid).n;
  const pending = req.user.role === 'admin'
    ? db.prepare("SELECT COUNT(*) n FROM listings WHERE status='pending'").get().n : 0;
  res.json({ notifications, messages, pending });
});

module.exports = router;
