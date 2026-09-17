# LankaLens Android App

This folder contains the Google Play Android wrapper for **https://lankalens.lk**.

It is a Trusted Web Activity (TWA), so the Android app uses the live LankaLens PWA while keeping the Android package separate from the Flask/PostgreSQL website.

## Identity

- App name: `LankaLens`
- Application ID: `lk.lankalens.app`
- Launch URL: `https://lankalens.lk/`
- minSdk: 23
- targetSdk / compileSdk: 36
- Android Browser Helper: 2.7.3
- Version: 1.0.0 (versionCode 1)

## Build

Open the `android/` folder in Android Studio with JDK 17, or run with Gradle 8.13:

```bash
gradle :app:assembleDebug
gradle :app:bundleRelease
```

The release bundle is created under `app/build/outputs/bundle/release/`.

## Signing

Do **not** commit `.jks`, `.keystore`, passwords, or `keystore.properties` to GitHub.

For Google Play, create an upload key locally and enable Play App Signing. After the real SHA-256 signing certificate fingerprint is known, replace the placeholder in `assetlinks.template.json` and publish it at:

`https://lankalens.lk/.well-known/assetlinks.json`

Until Digital Asset Links are configured with the real signing certificate, the app can fall back to a Custom Tab instead of a verified full-screen TWA.

## Live-site safety

Nothing under `android/` is imported by the production Flask app. Building or editing this folder does not change the LankaLens database, storage, listings, payments, or live website.
