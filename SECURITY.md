# Production security configuration

The application keeps PostgreSQL and Backblaze B2 configuration unchanged. Security
changes in this branch require no schema migration and preserve existing users,
listings, sessions (migrated to hashed storage on use), and B2 object keys.

## Required production variables

Set these in Railway before enabling password reset or email verification:

- `LL_PUBLIC_URL=https://your-domain.example`
- `SMTP_HOST=smtp.example.com`
- `SMTP_PORT=587`
- `SMTP_USERNAME=your-smtp-login`
- `SMTP_PASSWORD=your-smtp-password`
- `SMTP_FROM_EMAIL=support@your-domain.example`
- `SMTP_STARTTLS=true`

For implicit TLS on port 465, set `SMTP_USE_SSL=true`. Never commit real values.
When SMTP is incomplete or delivery fails, password-reset and verification
endpoints return a generic response and expose no token.

Optional:

- `LL_CORS_ORIGINS=https://your-domain.example` only when the browser frontend
  is intentionally served from a different origin. Leave unset for same-origin.
- `LL_ALLOW_DEV_TOKENS=1` enables local-only phone OTP display. Production
  ignores it.
- `LL_ALLOW_PAYMENT_SIMULATION=1` enables payment simulation only outside
  production. Production ignores it.

## Payment activation

Production promotions activate only after the signed payment webhook confirms
success. Configure a long random `payment_webhook_secret` in Admin Settings.
The admin API masks an existing value and never returns it to the browser.

## Operational recommendations

- Keep Railway PostgreSQL private networking enabled.
- Keep the B2 bucket private and issue the application key only the permissions it needs.
- Protect `main` with pull-request reviews and required security checks.
- Rotate SMTP, database, B2 and webhook credentials if they are ever exposed.
- Use a shared rate-limit store before scaling beyond one application process.
