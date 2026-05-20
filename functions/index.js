const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

let mailTransporter = null;
function getMailer() {
  if (mailTransporter) return mailTransporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(SMTP_SECURE).toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return mailTransporter;
}

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

async function sendAdminEmail(contact) {
  const mailer = getMailer();
  const to = process.env.CONTACT_EMAIL || "hello@openframe.media";
  const from = process.env.FROM_EMAIL || `Open Frame Media <${process.env.SMTP_USER}>`;

  if (!mailer) {
    logger.info("SMTP not configured; admin email skipped.");
    return { skipped: true };
  }

  return mailer.sendMail({
    from,
    to,
    replyTo: contact.email,
    subject: `New project brief from ${contact.name}`,
    text: [
      `Name: ${contact.name}`,
      `Email: ${contact.email}`,
      `Company: ${contact.company || "Not provided"}`,
      `Budget: ${contact.budget || "Not provided"}`,
      "",
      contact.message,
    ].join("\n"),
  });
}

async function sendAcknowledgementEmail(contact) {
  const mailer = getMailer();
  const from = process.env.FROM_EMAIL || `Open Frame Media <${process.env.SMTP_USER}>`;

  if (!mailer) {
    logger.info("SMTP not configured; acknowledgement email skipped.");
    return { skipped: true };
  }

  return mailer.sendMail({
    from,
    to: contact.email,
    subject: "We received your brief — Open Frame Media",
    text: [
      `Hi ${contact.name},`,
      "",
      "Thanks for sending your brief to Open Frame Media. We've received it and will get back to you shortly.",
      "",
      "For reference, here is what you sent:",
      "",
      contact.message,
      "",
      "— Open Frame Media",
      "Accra, Ghana",
    ].join("\n"),
  });
}

async function sendAdminSms(contact) {
  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID || "OpenFrame";
  const to = process.env.CONTACT_PHONE;

  if (!apiKey || !to) {
    logger.info("Arkesel not configured; admin SMS skipped.");
    return { skipped: true };
  }

  const message = `New brief from ${contact.name} (${contact.email})${
    contact.company ? ` @ ${contact.company}` : ""
  }: ${contact.message.slice(0, 200)}`;

  const params = new URLSearchParams({
    action: "send-sms",
    api_key: apiKey,
    to,
    from: sender,
    sms: message,
  });

  const response = await fetch(`https://sms.arkesel.com/sms/api?${params.toString()}`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Arkesel SMS failed: ${detail}`);
  }
  return response.json().catch(() => ({ ok: true }));
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

  const [adminEmail, adminSms, ack] = await Promise.allSettled([
    sendAdminEmail(contact),
    sendAdminSms(contact),
    sendAcknowledgementEmail(contact),
  ]);

  const errors = {};
  if (adminEmail.status === "rejected") {
    logger.error("Admin email failed", adminEmail.reason);
    errors.adminEmailError = adminEmail.reason?.message || String(adminEmail.reason);
  }
  if (adminSms.status === "rejected") {
    logger.error("Admin SMS failed", adminSms.reason);
    errors.adminSmsError = adminSms.reason?.message || String(adminSms.reason);
  }
  if (ack.status === "rejected") {
    logger.error("Acknowledgement email failed", ack.reason);
    errors.acknowledgementError = ack.reason?.message || String(ack.reason);
  }
  if (Object.keys(errors).length) {
    await docRef.update(errors);
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
