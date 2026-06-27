#!/usr/bin/env node
/**
 * Seed the Firestore `work` collection with the 4 hardcoded films plus a placeholder.
 *
 * Auth: uses Application Default Credentials. Sign in once with
 *   gcloud auth application-default login
 * or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.
 *
 * Run from the repo root:
 *   node functions/scripts/seed-work.js
 *
 * Optional flag:
 *   --without-placeholder   Skip the "Sample Film 05" placeholder.
 */
const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "openframe-media";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const FILMS = [
  {
    id: "maternal-mental-health",
    title: "Maternal Mental Health",
    summary: "WHO",
    body: "Corporate Event / 02:18 / 2026",
    imageUrl:
      "https://ik.imagekit.io/teiii/WHO-%20Maternal%20Mental%20Health%20.mp4",
    sortOrder: 1,
  },
  {
    id: "dr-pascoal-mocumbi-prize",
    title: "Dr Pascoal Mocumbi Prize",
    summary: "Global Health EDCTP3",
    body: "Documentary / 02:21 / 2025",
    imageUrl:
      "https://ik.imagekit.io/teiii/EDCTP%20prize%202025%20Dr%20Pascoal%20Mocumbi%20Prize_%20Professor%20Alexander%20Debrah.mp4",
    sortOrder: 2,
  },
  {
    id: "impact-generation-gstep",
    title: "Impact Generation with GSTEP",
    summary: "Botnar Foundation",
    body: "Documentary / 04:22 / 2025",
    imageUrl: "https://ik.imagekit.io/teiii/Impact%20Generation%20with%20GSTEP.mp4",
    sortOrder: 3,
  },
  {
    id: "profiles-of-promise",
    title: "Profiles of Promise",
    summary: "Stanford Seed",
    body: "Documentary Short / 07:44 / 2024",
    imageUrl:
      "https://ik.imagekit.io/teiii/Profiles%20of%20Promise_%20Back%20to%20My%20Roots.mp4",
    sortOrder: 4,
  },
];

const PLACEHOLDER = {
  id: "sample-film-05",
  title: "Sample Film 05",
  summary: "Placeholder — edit in admin",
  body: "Replace this entry / 00:00 / 2024",
  imageUrl:
    "https://ik.imagekit.io/teiii/WHO-%20Maternal%20Mental%20Health%20.mp4",
  sortOrder: 5,
};

async function main() {
  const includePlaceholder = !process.argv.includes("--without-placeholder");
  const entries = includePlaceholder ? [...FILMS, PLACEHOLDER] : FILMS;

  console.log(`Seeding ${entries.length} entries into work/ (project: ${PROJECT_ID})`);
  const batch = db.batch();
  for (const { id, ...fields } of entries) {
    batch.set(db.collection("work").doc(id), {
      ...fields,
      status: "published",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: "scripts/seed-work.js",
    });
    console.log(`  ✓ work/${id}`);
  }
  await batch.commit();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
