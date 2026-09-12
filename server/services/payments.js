'use strict';
// Payment-provider abstraction (sections 61-62). No gateway credentials live
// here. v1 keeps paid promotions dormant; a Sri Lankan gateway (PayHere/ eZCash)
// can implement `createCharge`/`handleCallback` later without touching routes.
const { db } = require('../db');
const { now } = require('../lib/util');

const STATUSES = ['pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded'];

/**
 * Provider interface each future gateway must implement:
 *   createCharge(payment) -> { redirectUrl | providerRef }
 *   verifyCallback(req)   -> { providerRef, status }
 */
const providers = {
  none: {
    async createCharge(/* payment */) {
      // No gateway configured — promotions cannot be purchased yet.
      const e = new Error('Payment gateway not configured');
      e.statusCode = 503;
      throw e;
    },
  },
};

function createPayment({ user, packageRow }) {
  const t = now();
  const info = db.prepare(
    `INSERT INTO payments (user_id, package_id, amount, currency, provider, status, created_at, updated_at)
     VALUES (?,?, 'LKR', 'none', 'pending', ?, ?)`
  ).run(user.id, packageRow.id, packageRow.price_lkr, t, t);
  return db.prepare('SELECT * FROM payments WHERE id=?').get(Number(info.lastInsertRowid));
}

function setStatus(paymentId, status, providerRef = null) {
  if (!STATUSES.includes(status)) throw new Error('bad status');
  db.prepare('UPDATE payments SET status=?, provider_ref=COALESCE(?, provider_ref), updated_at=? WHERE id=?')
    .run(status, providerRef, now(), paymentId);
  db.prepare('INSERT INTO transactions (payment_id, user_id, amount, currency, kind, status, meta_json, created_at) SELECT id, user_id, amount, currency, ?, ?, ?, ? FROM payments WHERE id=?')
    .run('charge', status, '{}', now(), paymentId);
}

module.exports = { providers, createPayment, setStatus, STATUSES };
