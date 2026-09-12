'use strict';
// Transactional email abstraction (section 63).
// Uses SMTP when SMTP_URL is configured; otherwise records the message in
// email_outbox (and logs it) so flows remain fully testable in development.
const nodemailer = require('nodemailer');
const { db } = require('../db');
const { now } = require('../lib/util');

let transport = null;
if (process.env.SMTP_URL) {
  transport = nodemailer.createTransport(process.env.SMTP_URL);
}

const FROM = process.env.MAIL_FROM || 'Lanka Lens <no-reply@lankalens.lk>';

async function sendMail(to, subject, html) {
  db.prepare(
    'INSERT INTO email_outbox (to_email, subject, html, sent_at, created_at) VALUES (?,?,?,?,?)'
  ).run(to, subject, html, transport ? null : now(), now());

  if (transport) {
    try {
      await transport.sendMail({ from: FROM, to, subject, html });
    } catch (e) {
      console.error('[mailer] SMTP send failed:', e.message);
    }
  } else {
    console.log(`[mailer:dev] To: ${to} | Subject: ${subject}`);
  }
}

function layout(title, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1b2530">
  <div style="background:#11202f;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0">
    <strong style="font-size:18px">LANKA LENS</strong><br>
    <span style="font-size:12px;color:#9fb6c9">Buy &amp; Sell Cameras in Sri Lanka</span>
  </div>
  <div style="border:1px solid #e3e8ee;border-top:0;padding:24px;border-radius:0 0 10px 10px">
    <h2 style="margin-top:0;color:#11202f">${title}</h2>
    ${bodyHtml}
    <hr style="border:0;border-top:1px solid #e3e8ee;margin:24px 0">
    <p style="font-size:12px;color:#7a8794">© Lanka Lens, Sri Lanka. You received this email because an account action used this address.</p>
  </div></div>`;
}

module.exports = { sendMail, layout };
