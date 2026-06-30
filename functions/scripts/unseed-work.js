#!/usr/bin/env node
/**
 * Delete every document in the Firestore `work` collection.
 * Used to revert seed-work.js and fall back to the hardcoded films in index.html.
 *
 * Auth: same as seed-work.js — ADC or GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Run:
 *   node functions/scripts/unseed-work.js [--yes]
 *
 * Without --yes, prints what would be deleted but does nothing.
 */
const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "openframe-media";
const CONFIRM = process.argv.includes("--yes");

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  const snap = await db.collection("work").get();
  if (snap.empty) {
    console.log("work/ is already empty.");
    return;
  }
  console.log(`Found ${snap.size} doc${snap.size === 1 ? "" : "s"} in work/ (project: ${PROJECT_ID}):`);
  snap.docs.forEach((d) => console.log(`  - ${d.id}`));

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --yes to delete.");
    return;
  }

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`Deleted ${snap.size} doc${snap.size === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error("Unseed failed:", err.message);
  process.exit(1);
});
