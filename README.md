# Open Frame Site

Static Firebase Hosting site with a Firebase backend for contact submissions, admin CMS editing, file uploads, and public frontend data.

## Backend Pieces

- `public/index.html`: production website with `/api/contact` form submission and `/api/site` CMS work loading.
- `public/admin.html`: Firebase Auth admin dashboard.
- `functions/index.js`: Cloud Functions API.
- `firestore.rules`: Firestore access rules.
- `storage.rules`: Cloud Storage upload rules.
- `firebase.json`: Hosting rewrites, functions, Firestore, Storage, and emulator config.

## Setup

1. In Firebase Console, enable Email/Password sign-in for Firebase Auth.
2. Enable Firestore and Cloud Storage.
3. Copy the Firebase web app config into `public/assets/js/firebase-config.js`.
4. Install Cloud Function dependencies:

```bash
cd functions
npm install
```

5. Optional email notifications: copy `functions/.env.example` to `functions/.env` and set:

```txt
RESEND_API_KEY=your_resend_api_key
CONTACT_EMAIL=hello@openframe.media
FROM_EMAIL=Open Frame Media <notifications@your-domain.com>
ADMIN_BOOTSTRAP_KEY=a-long-random-secret-at-least-24-characters
```

If `RESEND_API_KEY` is missing, contact submissions are still stored in Firestore and email sending is skipped.

## First Admin

Create the admin user in Firebase Auth, deploy functions, then grant the admin claim:

```bash
curl -X POST "https://openframe.media/api/bootstrap-admin" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-key: YOUR_ADMIN_BOOTSTRAP_KEY" \
  -d '{"email":"admin@example.com"}'
```

Then sign in at `/admin.html`.

## Local Development

```bash
firebase emulators:start
```

Open:

```txt
http://localhost:5000
http://localhost:5000/admin.html
```

## Deploy

```bash
firebase deploy
```

## API Routes

```txt
POST /api/contact
GET  /api/site
GET  /api/work
GET  /api/posts
GET  /api/page/:slug
POST /api/bootstrap-admin
```
