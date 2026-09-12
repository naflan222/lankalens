'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const SECRET = process.env.LL_JWT_SECRET || 'dev-only-change-me';
const EXPIRES_DAYS = Number(process.env.JWT_EXPIRES_DAYS || 30);

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: `${EXPIRES_DAYS}d` });
}

function setAuthCookie(res, token) {
  res.cookie('ll_token', token, {
    httpOnly: true, sameSite: 'lax',
    maxAge: EXPIRES_DAYS * 24 * 3600 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

function getUserFromRequest(req) {
  let token = null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) token = h.slice(7);
  else if (req.cookies && req.cookies.ll_token) token = req.cookies.ll_token;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, name, email, phone, role, avatar_url, email_verified_at, phone_verified_at, status FROM users WHERE id=?').get(payload.uid);
    if (!user || user.status === 'suspended') return null;
    return user;
  } catch {
    return null;
  }
}

function attachUser(req, _res, next) {
  req.user = getUserFromRequest(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

module.exports = { signToken, setAuthCookie, attachUser, requireAuth, requireAdmin, SECRET };
