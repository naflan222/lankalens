'use strict';
// Shared middleware: async wrapper, friendly errors, simple in-memory
// rate limiting, input validation helpers, audit logging.
const { db } = require('../db');
const { now } = require('../lib/util');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 400;
  if (status >= 500) console.error('[error]', err);
  // Never leak stack traces to clients (section 68)
  res.status(status).json({ error: err.publicMessage || err.message || 'Something went wrong. Please try again.' });
}

// Very small fixed-window rate limiter (per IP + bucket)
const buckets = new Map();
function rateLimit(bucket, max, windowMs = 60000) {
  return (req, res, next) => {
    if (process.env.LL_DISABLE_RATELIMIT === '1') return next();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${bucket}:${ip}`;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || t > b.reset) {
      b = { count: 0, reset: t + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    next();
  };
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) throw new ApiError(400, `Missing: ${missing.join(', ')}`);
}

function str(v, max = 2000) {
  return String(v == null ? '' : v).slice(0, max).trim();
}
function int(v, min = 0, max = 10 ** 11) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

function audit(admin, action, targetType, targetId = null, meta = {}) {
  db.prepare('INSERT INTO audit_logs (admin_id,action,target_type,target_id,meta_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(admin.id, action, targetType, targetId, JSON.stringify(meta), now());
}

function logEvent(userId, type, listingId, meta = {}, session = null) {
  db.prepare('INSERT INTO analytics_events (user_id,session,type,listing_id,meta_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId || null, session, type, listingId || null, JSON.stringify(meta), now());
}

function notify(userId, type, title, body, href, data = {}) {
  db.prepare('INSERT INTO notifications (user_id,type,title,body,href,data_json,read_at,created_at) VALUES (?,?,?,?,?,?,NULL,?)')
    .run(userId, type, title, body || null, href || null, JSON.stringify(data), now());
}

module.exports = {
  asyncHandler, ApiError, errorHandler, rateLimit,
  requireFields, str, int, audit, logEvent, notify,
};
