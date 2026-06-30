# Open Frame Site

Static Firebase Hosting site with a Firebase backend for contact submissions, admin CMS editing, file uploads, and public frontend data.

## Backend Pieces

- `public/index.html`: production website with `/api/contact` form submission and `/api/site` CMS work loading.
- `public/admin.html`: Firebase Auth admin dashboard (sidebar layout, command palette, bulk actions, admin management).
- `functions/index.js`: Cloud Functions API.
- `functions/scripts/`: one-off maintenance scripts (see `functions/scripts/README.md`).
- `firestore.rules`: Firestore access rules.
- `storage.rules`: Cloud Storage upload rules.
- `firebase.json`: Hosting rewrites, functions, Firestore, Storage, and emulator config.
- `.github/workflows/`: CI/CD — auto-deploy on push to `main`, hosting preview on PRs.

## Setup

1. In Firebase Console, enable Email/Password sign-in for Firebase Auth.
2. Enable Firestore and Cloud Storage.
3. Copy the Firebase web app config into `public/assets/js/firebase-config.js`.
4. Install Cloud Function dependencies:

```bash
cd functions
npm install
```

5. Copy `functions/.env.example` to `functions/.env` and fill in real values for SMTP (Google Workspace App Password), Arkesel SMS, and the admin bootstrap key.

If `SMTP_*` is missing, contact submissions are still stored in Firestore and email sending is skipped. If `ARKESEL_API_KEY` is missing, SMS is skipped.

## First Admin

Create the admin user in Firebase Auth, deploy functions, then grant the admin claim:

```bash
curl -X POST "https://openframe.media/api/bootstrap-admin" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-key: YOUR_ADMIN_BOOTSTRAP_KEY" \
  -d '{"email":"admin@example.com"}'
```

Then sign in at `/admin.html`. Subsequent admins can be added through the **Admins** tab in the dashboard (no curl required).

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

Pushing to `main` triggers a deploy automatically via GitHub Actions (see below). To deploy manually:

```bash
firebase deploy
```

## Continuous Deployment

Two workflows live in `.github/workflows/`:

| File          | Trigger                  | What it does                                                                  |
| ------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `deploy.yml`  | push to `main` (or manual) | Full deploy: hosting + functions + Firestore rules/indexes + storage rules |
| `preview.yml` | PR opened against `main` | Deploys a Hosting preview channel and posts the URL on the PR (expires 7d)   |

### One-time setup

#### 1. Create a deploy service account

In the GCP console for `openframe-media`:

1. **IAM & Admin → Service Accounts → Create service account.** Name it `github-actions-deploy`.
2. Grant these roles:
   - `Firebase Admin`
   - `Cloud Functions Developer`
   - `Service Account User`
   - `Cloud Build Editor`
   - `Artifact Registry Writer`
3. Open the new account → **Keys → Add key → JSON.** Download the file. (You can delete the key later from the same screen; it stays valid until you do.)

#### 2. Add GitHub repository secrets

In the repo, **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name                       | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | **Entire contents** of the JSON key file (paste as one blob)            |
| `CONTACT_EMAIL`            | `hello@openframe.media` (or your inbox)                                 |
| `CONTACT_PHONE`            | E.164 phone number for SMS alerts (e.g. `233500075493`)                 |
| `SMTP_HOST`                | `smtp.gmail.com`                                                        |
| `SMTP_PORT`                | `465`                                                                   |
| `SMTP_SECURE`              | `true`                                                                  |
| `SMTP_USER`                | The Workspace mailbox used to send                                      |
| `SMTP_PASS`                | App Password (not your account password — generate one in Google admin) |
| `FROM_EMAIL`               | `Open Frame Media <hello@openframe.media>`                              |
| `ARKESEL_API_KEY`          | Arkesel SMS API key                                                     |
| `ARKESEL_SENDER_ID`        | Sender name, e.g. `OpenFrame` (max 11 chars)                            |
| `ADMIN_BOOTSTRAP_KEY`      | Long random string used by `/api/bootstrap-admin`                       |

> **Why per-secret?** Firebase doesn't read GitHub secrets directly. The `deploy.yml` workflow writes a fresh `functions/.env` from these values before `firebase deploy` so the same env vars that work locally also work in CI. Nothing is committed.

#### 3. Push to `main`

That's it. The next push to `main` deploys automatically. The first run will take ~3 minutes; cached runs are ~90 seconds.

To deploy on demand (no commit), trigger the workflow from **Actions → Deploy to Firebase → Run workflow**.

## API Routes

```txt
POST /api/contact
GET  /api/site
GET  /api/work
GET  /api/posts
GET  /api/page/:slug
POST /api/bootstrap-admin
GET  /api/admin/users               (Bearer ID-token of admin)
POST /api/admin/users/create        (Bearer ID-token of admin)
POST /api/admin/users/:uid/admin    (Bearer ID-token of admin)
POST /api/admin/users/:uid/disable  (Bearer ID-token of admin)
POST /api/admin/users/:uid/reset    (Bearer ID-token of admin)
```

## Seed / Unseed CMS Content

See [`functions/scripts/README.md`](functions/scripts/README.md) for the Node-based seed and unseed helpers that populate the Firestore `work` collection.
