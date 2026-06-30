# Maintenance Scripts

One-off Node.js helpers that talk to Firestore using the [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup).

No secrets are stored in these files. Auth is resolved by the Admin SDK in this order:

1. `GOOGLE_APPLICATION_CREDENTIALS` env var pointing at a service-account JSON key, or
2. Application Default Credentials from `gcloud auth application-default login`.

## One-time setup

```bash
cd functions && npm install
gcloud auth application-default login   # sign in with an account that has Firebase Admin / Owner on openframe-media
```

## Seed the work collection

Writes 4 real films + 1 placeholder as published `work/` entries. The public site immediately starts pulling from the CMS.

```bash
node functions/scripts/seed-work.js
node functions/scripts/seed-work.js --without-placeholder   # 4 films only
```

## Unseed (delete everything in work/)

```bash
node functions/scripts/unseed-work.js          # dry run — lists what would be deleted
node functions/scripts/unseed-work.js --yes    # actually delete
```

After unseeding, the public site falls back to the 4 hardcoded films in `public/index.html`.

## Targeting a different project

```bash
GCLOUD_PROJECT=other-project node functions/scripts/seed-work.js
```
