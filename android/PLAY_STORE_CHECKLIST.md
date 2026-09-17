# LankaLens Google Play Release Checklist

## App build
- [x] Package name is `lk.lankalens.app`
- [x] Launch URL is `https://lankalens.lk/`
- [x] Target / compile SDK is API 36
- [x] HTTPS-only Android configuration
- [x] Trusted Web Activity wrapper configured
- [x] LankaLens logo reused for the launcher icon
- [ ] Generate local upload signing key (never commit it)
- [ ] Build signed Android App Bundle (`.aab`)

## Digital Asset Links
- [ ] Create the app in Google Play Console
- [ ] Enable Play App Signing
- [ ] Copy the **App signing key certificate SHA-256** fingerprint
- [ ] Replace the placeholder in `assetlinks.template.json`
- [ ] Publish it as `https://lankalens.lk/.well-known/assetlinks.json`
- [ ] Verify the file is reachable over HTTPS with no redirect/error

## Play Console listing
- [ ] App name: LankaLens
- [ ] Short description
- [ ] Full description
- [ ] 512x512 Play Store icon
- [ ] Phone screenshots
- [ ] Feature graphic (1024x500)
- [ ] Privacy policy URL
- [ ] Data Safety form
- [ ] Content rating questionnaire
- [ ] App access instructions for reviewer if login is required

## Testing and release
- [ ] Upload the `.aab` to Internal testing first
- [ ] Test login, listings, shop pages, images, upload flow, messaging and external links
- [ ] Confirm the TWA opens without browser address bar after Digital Asset Links verification
- [ ] Complete any Google Play account testing requirements
- [ ] Submit the production release
