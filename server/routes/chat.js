'use strict';
const express = require('express');
const path = require('node:path');
const multer = require('multer');
const { db } = require('../db');
const { now } = require('../lib/util');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError, str, int, notify, logEvent } = require('../middleware/util');
const { saveImage } = require('../services/image');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

function listingCard(id) {
  const r = db.prepare(`SELECT l.id,l.slug,l.title,l.price,l.status,
     (SELECT url FROM listing_images WHERE listing_id=l.id ORDER BY sort_order LIMIT 1) cover
     FROM listings l WHERE l.id=?`).get(id);
  if (!r) return null;
  r.price_formatted = 'Rs. ' + Number(r.price).toLocaleString('en-US');
  return r;
}

function conversationRow(c, userId) {
  const otherId = c.buyer_id === userId ? c.seller_id : c.buyer_id;
  const other = db.prepare('SELECT id,name,avatar_url FROM users WHERE id=?').get(otherId);
  const last = db.prepare('SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE conversation_id=? ORDER BY m.id DESC LIMIT 1').get(c.id);
  const unread = db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL').get(c.id, userId).n;
  return {
    id: c.id, listing_id: c.listing_id, listing: listingCard(c.listing_id),
    other: other ? { id: other.id, name: other.name, avatar: other.avatar_url } : null,
    last_message: last ? { body: last.body, image_url: last.image_url, created_at: last.created_at, offer_id: last.offer_id, sender_name: last.sender_name } : null,
    unread, updated_at: c.updated_at,
  };
}

// ---------- conversations list ----------
router.get('/conversations', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM conversations WHERE buyer_id=? OR seller_id=? ORDER BY updated_at DESC').all(req.user.id, req.user.id);
  res.json({ conversations: rows.map((c) => conversationRow(c, req.user.id)) });
});

// ---------- start conversation ----------
router.post('/conversations', requireAuth, (req, res) => {
  const listingId = int(req.body?.listing_id);
  const listing = db.prepare("SELECT * FROM listings WHERE id=? AND status='active'").get(listingId);
  if (!listing) throw new ApiError(404, 'Listing not found.');
  if (listing.seller_id === req.user.id) throw new ApiError(400, 'You cannot message yourself.');
  const t = now();
  let conv = db.prepare('SELECT * FROM conversations WHERE listing_id=? AND buyer_id=?').get(listingId, req.user.id);
  if (!conv) {
    const info = db.prepare('INSERT INTO conversations (listing_id,buyer_id,seller_id,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(listingId, req.user.id, listing.seller_id, t, t);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(Number(info.lastInsertRowid));
  }
  const body = str(req.body?.body, 2000);
  if (body) {
    db.prepare('INSERT INTO messages (conversation_id,sender_id,body,created_at) VALUES (?,?,?,?)').run(conv.id, req.user.id, body, t);
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(t, conv.id);
    logEvent(req.user.id, 'message', listingId);
    notify(listing.seller_id, 'message', `New message from ${req.user.name}`, body, `/chat/?c=${conv.id}`, { conversationId: conv.id, listingId });
  }
  res.status(201).json({ conversation: conversationRow(conv, req.user.id) });
});

function canAccess(conv, userId) {
  return conv && (conv.buyer_id === userId || conv.seller_id === userId);
}

// ---------- thread ----------
router.get('/conversations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
  if (!canAccess(conv, req.user.id)) throw new ApiError(403, 'Not your conversation.');
  const t = now();
  db.prepare('UPDATE messages SET read_at=? WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL').run(t, id, req.user.id);
  const msgs = db.prepare(`SELECT m.*, o.amount AS offer_amount, o.status AS offer_status, o.counter_amount AS offer_counter
      FROM messages m LEFT JOIN offers o ON o.id=m.offer_id
      WHERE m.conversation_id=? ORDER BY m.id`).all(id);
  const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
  const other = db.prepare('SELECT id,name,avatar_url FROM users WHERE id=?').get(otherId);
  const blocked = !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(req.user.id, otherId);
  const offers = db.prepare('SELECT * FROM offers WHERE conversation_id=? ORDER BY id').all(id);
  res.json({
    conversation: {
      id: conv.id, listing_id: conv.listing_id, listing: listingCard(conv.listing_id),
      other: other ? { id: other.id, name: other.name, avatar: other.avatar_url } : null,
      i_am_seller: conv.seller_id === req.user.id, buyer_id: conv.buyer_id, seller_id: conv.seller_id,
      blocked_by_me: blocked, offers,
    },
    messages: msgs,
  });
});

// ---------- post message (text or image) ----------
router.post('/conversations/:id/messages', requireAuth, upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
  if (!canAccess(conv, req.user.id)) throw new ApiError(403, 'Not your conversation.');
  const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
  if (db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(otherId, req.user.id)) {
    throw new ApiError(403, 'You cannot message this user right now.');
  }
  const t = now();
  let imageUrl = null;
  if (req.file) imageUrl = saveImage(req.file.buffer, { root: UPLOAD_ROOT, kind: 'messages' });
  const body = str(req.body?.body, 2000);
  if (!body && !imageUrl) throw new ApiError(400, 'Message is empty.');
  const info = db.prepare('INSERT INTO messages (conversation_id,sender_id,body,image_url,created_at) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, body, imageUrl, t);
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(t, id);
  const listing = db.prepare('SELECT title FROM listings WHERE id=?').get(conv.listing_id);
  notify(otherId, 'message', `New message from ${req.user.name}`, body || (imageUrl ? 'Sent a photo' : ''), `/chat/?c=${id}`, { conversationId: id, listingId: conv.listing_id });
  logEvent(req.user.id, 'message', conv.listing_id);
  res.status(201).json({ message: db.prepare('SELECT * FROM messages WHERE id=?').get(Number(info.lastInsertRowid)) });
});

// ---------- block / unblock / report user ----------
router.post('/conversations/:id/block', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
  if (!canAccess(conv, req.user.id)) throw new ApiError(403);
  const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
  if (req.body?.unblock) {
    db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, otherId);
  } else {
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)').run(req.user.id, otherId, now());
    db.prepare('INSERT INTO reports (reporter_id,target_type,target_id,reason,details,status,created_at) VALUES (?, \'user\', ?, \'other\', ?, \'open\', ?)')
      .run(req.user.id, otherId, 'Blocked from conversation #' + id, now());
  }
  res.json({ ok: true });
});

// ---------- offer respond (seller) / counter ----------
router.post('/offers/:id/respond', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const offer = db.prepare('SELECT * FROM offers WHERE id=?').get(id);
  if (!offer) throw new ApiError(404, 'Offer not found.');
  if (offer.seller_id !== req.user.id) throw new ApiError(403, 'Only the seller can respond.');
  const action = req.body?.action;
  const t = now();
  let newStatus; let message;
  if (action === 'accept') { newStatus = 'accepted'; message = `Accepted your offer of Rs. ${offer.amount.toLocaleString('en-US')}`; }
  else if (action === 'reject') { newStatus = 'rejected'; message = `Declined your offer of Rs. ${offer.amount.toLocaleString('en-US')}`; }
  else if (action === 'counter') {
    const amount = int(req.body.amount, 100, offer.listing_id && 10 ** 9);
    if (!amount) throw new ApiError(400, 'Enter a counter amount.');
    newStatus = 'countered';
    db.prepare('UPDATE offers SET status=\'countered\', counter_amount=?, updated_at=? WHERE id=?').run(amount, t, id);
    message = `Counter offer: Rs. ${amount.toLocaleString('en-US')}`;
  } else throw new ApiError(400, 'Unknown response.');
  if (action !== 'counter') db.prepare('UPDATE offers SET status=?, updated_at=? WHERE id=?').run(newStatus, t, id);
  db.prepare('INSERT INTO messages (conversation_id,sender_id,body,offer_id,created_at) VALUES (?,?,?,?,?)')
    .run(offer.conversation_id, req.user.id, message, id, t);
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(t, offer.conversation_id);
  notify(offer.buyer_id, 'offer', message, '', `/chat/?c=${offer.conversation_id}`, { offerId: id });
  res.json({ ok: true, status: newStatus || 'countered' });
});

module.exports = router;
