const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

function sendJson(res, status, payload) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,Authorization,x-bootstrap-key");
  res.status(status).json(payload);
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (!req.rawBody) return {};

  try {
    return JSON.parse(req.rawBody.toString("utf8"));
  } catch (error) {
    return {};
  }
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicData(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    title: data.title || "",
    summary: data.summary || "",
    body: data.body || "",
    imageUrl: data.imageUrl || "",
    sortOrder: data.sortOrder || 0,
    updatedAt: data.updatedAt?.toDate?.().toISOString?.() || null,
  };
}

async function getPublishedCollection(name) {
  const snapshot = await db
    .collection(name)
    .where("status", "==", "published")
    .orderBy("sortOrder", "asc")
    .get();

  return snapshot.docs.map(publicData);
}

async function sendContactEmail(contact) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_EMAIL || "hello@openframe.media";
  const from = process.env.FROM_EMAIL || "Open Frame Media <notifications@openframe.media>";

  if (!apiKey) {
    logger.info("RESEND_API_KEY not configured; contact email skipped.");
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `New project brief from ${contact.name}`,
      reply_to: contact.email,
      text: [
        `Name: ${contact.name}`,
        `Email: ${contact.email}`,
        `Company: ${contact.company || "Not provided"}`,
        `Budget: ${contact.budget || "Not provided"}`,
        "",
        contact.message,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider failed: ${detail}`);
  }

  return response.json();
}

async function handleContact(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = parseBody(req);
  const contact = {
    name: cleanText(body.name, 120),
    email: cleanText(body.email, 160).toLowerCase(),
    company: cleanText(body.company, 160),
    budget: cleanText(body.budget, 80),
    message: cleanText(body.message, 4000),
    status: "unread",
    source: "website",
    userAgent: req.get("user-agent") || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!contact.name || !isEmail(contact.email) || contact.message.length < 10) {
    return sendJson(res, 400, { error: "Please provide a name, email, and project brief." });
  }

  const docRef = await db.collection("contacts").add(contact);

  try {
    await sendContactEmail(contact);
  } catch (error) {
    logger.error("Contact email failed", error);
    await docRef.update({ emailError: error.message });
  }

  return sendJson(res, 201, { ok: true, id: docRef.id });
}

async function handlePage(req, res, slug) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const snapshot = await db.collection("pages").doc(slug).get();
  if (!snapshot.exists || snapshot.data().status !== "published") {
    return sendJson(res, 404, { error: "Not found" });
  }

  return sendJson(res, 200, publicData(snapshot));
}

async function handleCollection(req, res, name) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 200, { items: await getPublishedCollection(name) });
}

async function handleSite(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const [work, posts] = await Promise.all([
    getPublishedCollection("work"),
    getPublishedCollection("posts"),
  ]);

  return sendJson(res, 200, { work, posts });
}

async function handleBootstrapAdmin(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const configuredKey = process.env.ADMIN_BOOTSTRAP_KEY;
  const requestKey = req.get("x-bootstrap-key");

  if (!configuredKey || configuredKey.length < 24 || requestKey !== configuredKey) {
    return sendJson(res, 403, { error: "Bootstrap key rejected" });
  }

  const body = parseBody(req);
  const email = cleanText(body.email, 160).toLowerCase();

  if (!isEmail(email)) {
    return sendJson(res, 400, { error: "Valid email required" });
  }

  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });

  return sendJson(res, 200, { ok: true, uid: user.uid, email });
}

exports.api = onRequest({ region: "us-central1" }, async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url, "https://openframe.local");
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = parts[0] || "site";

  try {
    if (route === "contact") return handleContact(req, res);
    if (route === "page" && parts[1]) return handlePage(req, res, parts[1]);
    if (route === "posts") return handleCollection(req, res, "posts");
    if (route === "work") return handleCollection(req, res, "work");
    if (route === "site") return handleSite(req, res);
    if (route === "bootstrap-admin") return handleBootstrapAdmin(req, res);

    return sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    logger.error("API error", error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});
