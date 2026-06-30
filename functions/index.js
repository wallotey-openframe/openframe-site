const crypto = require("crypto");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

/* =========================================================================
   RATE LIMITER — per-IP sliding window for /api/contact
   ========================================================================= */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function getClientIp(req) {
  const forwarded = req.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0].trim();
  return first || req.ip || "";
}

function hashIp(ip) {
  // Truncated SHA-256 — we never store raw IPs.
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function checkRateLimit(ip) {
  if (!ip) return { allowed: true }; // unknowable IP → don't block
  const docRef = db.collection("rate_limits").doc(`contact_${hashIp(ip)}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    let data = snap.exists ? snap.data() : { count: 0, windowStart: 0 };
    if (now - (data.windowStart || 0) > RATE_LIMIT_WINDOW_MS) {
      data = { count: 1, windowStart: now };
    } else {
      data.count = (data.count || 0) + 1;
    }
    // Always persist — even when blocked — so floods don't reset the counter.
    tx.set(docRef, {
      count: data.count,
      windowStart: data.windowStart,
      // ttl field — enable Firestore TTL on this field in the console to auto-purge.
      ttl: new Date(now + 24 * 60 * 60 * 1000),
    });
    if (data.count > RATE_LIMIT_MAX) {
      const retryAfterMs = data.windowStart + RATE_LIMIT_WINDOW_MS - now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    return { allowed: true };
  });
}

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

const MIN_FORM_FILL_MS = 2500; // submissions faster than this are almost certainly bots

async function handleContact(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = parseBody(req);

  // ----- Honeypot: silently drop bot submissions -----
  // 1. The `website` field is invisible to humans. Any non-empty value = bot.
  // 2. If the form was submitted within MIN_FORM_FILL_MS, it's almost certainly a bot.
  const honeypot = typeof body.website === "string" ? body.website.trim() : "";
  const formLoadedAt = Number(body.ts) || 0;
  const elapsed = formLoadedAt > 0 ? Date.now() - formLoadedAt : Number.POSITIVE_INFINITY;
  const tooFast = elapsed < MIN_FORM_FILL_MS;

  const ip = getClientIp(req);

  if (honeypot || tooFast) {
    logger.info("Honeypot triggered", {
      honeypotFilled: Boolean(honeypot),
      tooFast,
      elapsedMs: Number.isFinite(elapsed) ? elapsed : null,
      userAgent: req.get("user-agent") || "",
      ip,
    });
    // Pretend everything is fine — bots shouldn't learn they were caught.
    return sendJson(res, 201, { ok: true, id: "filtered" });
  }

  // ----- Rate limit: 5 submissions / hour / IP -----
  const rate = await checkRateLimit(ip);
  if (!rate.allowed) {
    logger.info("Rate limit hit", { ip, retryAfter: rate.retryAfter });
    res.set("Retry-After", String(rate.retryAfter));
    const mins = Math.ceil(rate.retryAfter / 60);
    return sendJson(res, 429, {
      error: `Too many submissions. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    });
  }

  const contact = {
    name: cleanText(body.name, 120),
    email: cleanText(body.email, 160).toLowerCase(),
    company: cleanText(body.company, 160),
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

async function verifyAdminCaller(req) {
  const authz = req.get("authorization") || "";
  const match = authz.match(/^Bearer (.+)$/i);
  if (!match) return null;
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    return decoded.admin === true ? decoded : null;
  } catch (err) {
    logger.warn("Token verification failed", err.message);
    return null;
  }
}

async function handleAdminUsers(req, res, parts) {
  const caller = await verifyAdminCaller(req);
  if (!caller) {
    return sendJson(res, 401, { error: "Admin authentication required" });
  }

  // GET /api/admin/users  → list users
  if (req.method === "GET" && !parts[2]) {
    const result = await auth.listUsers(1000);
    const users = result.users.map((u) => ({
      uid: u.uid,
      email: u.email || "",
      displayName: u.displayName || "",
      disabled: u.disabled,
      admin: u.customClaims?.admin === true,
      emailVerified: u.emailVerified,
      createdAt: u.metadata.creationTime,
      lastSignInAt: u.metadata.lastSignInTime || null,
    }));
    return sendJson(res, 200, { users });
  }

  const targetUid = parts[2];
  if (!targetUid) {
    return sendJson(res, 404, { error: "Not found" });
  }

  // POST /api/admin/users/:uid/admin  → toggle admin claim
  if (req.method === "POST" && parts[3] === "admin") {
    const body = parseBody(req);
    const grant = body.admin === true;
    if (!grant && caller.uid === targetUid) {
      return sendJson(res, 400, { error: "You cannot revoke admin from yourself." });
    }
    const target = await auth.getUser(targetUid);
    const claims = { ...(target.customClaims || {}), admin: grant };
    if (!grant) delete claims.admin;
    await auth.setCustomUserClaims(targetUid, claims);
    return sendJson(res, 200, { ok: true, uid: targetUid, admin: grant });
  }

  // POST /api/admin/users/:uid/reset  → generate password reset link
  if (req.method === "POST" && parts[3] === "reset") {
    const target = await auth.getUser(targetUid);
    if (!target.email) {
      return sendJson(res, 400, { error: "User has no email." });
    }
    const link = await auth.generatePasswordResetLink(target.email);
    // Email it via the existing SMTP mailer
    const mailer = getMailer();
    if (mailer) {
      try {
        await mailer.sendMail({
          from: process.env.FROM_EMAIL || `Open Frame Media <${process.env.SMTP_USER}>`,
          to: target.email,
          subject: "Open Frame Admin — Password reset",
          text: [
            `Hi ${target.displayName || target.email},`,
            "",
            "An administrator triggered a password reset for your account.",
            "Click the link below to choose a new password:",
            "",
            link,
            "",
            "If you didn't expect this, you can ignore this email.",
          ].join("\n"),
        });
      } catch (err) {
        logger.error("Password reset email failed", err);
      }
    }
    return sendJson(res, 200, { ok: true, link });
  }

  // POST /api/admin/users/:uid/disable  → toggle disabled
  if (req.method === "POST" && parts[3] === "disable") {
    const body = parseBody(req);
    if (caller.uid === targetUid) {
      return sendJson(res, 400, { error: "You cannot disable your own account." });
    }
    await auth.updateUser(targetUid, { disabled: body.disabled === true });
    return sendJson(res, 200, { ok: true, uid: targetUid, disabled: body.disabled === true });
  }

  // POST /api/admin/users/:uid/create  → create new admin user
  if (req.method === "POST" && targetUid === "create") {
    const body = parseBody(req);
    const email = cleanText(body.email, 160).toLowerCase();
    if (!isEmail(email)) {
      return sendJson(res, 400, { error: "Valid email required" });
    }
    // Reuse the GET path UID position: parts[2] is "create"
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      user = await auth.createUser({ email });
    }
    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      admin: true,
    });
    const link = await auth.generatePasswordResetLink(email);
    const mailer = getMailer();
    if (mailer) {
      try {
        await mailer.sendMail({
          from: process.env.FROM_EMAIL || `Open Frame Media <${process.env.SMTP_USER}>`,
          to: email,
          subject: "Open Frame Admin — You've been added as an admin",
          text: [
            `Hi,`,
            "",
            `${caller.email || "An administrator"} added you as an admin on Open Frame Media's CMS.`,
            "Set your password to sign in:",
            "",
            link,
          ].join("\n"),
        });
      } catch (err) {
        logger.error("Invite email failed", err);
      }
    }
    return sendJson(res, 201, { ok: true, uid: user.uid, email, link });
  }

  return sendJson(res, 404, { error: "Admin sub-route not found" });
}

async function bootstrapAlreadyUsed() {
  // Fast path: persisted flag.
  const flag = await db.collection("bootstrap").doc("used").get();
  if (flag.exists) return true;

  // Migration path: project may already have admins from before this lockdown.
  // Sweep auth — if any user has the admin claim, set the flag and refuse.
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    if (result.users.some((u) => u.customClaims?.admin === true)) {
      await db.collection("bootstrap").doc("used").set({
        at: admin.firestore.FieldValue.serverTimestamp(),
        by: "migration",
        note: "Auto-set because admin users already existed at first lockdown check.",
      });
      return true;
    }
    pageToken = result.pageToken;
  } while (pageToken);

  return false;
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

  if (await bootstrapAlreadyUsed()) {
    return sendJson(res, 403, {
      error:
        "Bootstrap is closed. An admin already exists — sign in and invite new admins from the dashboard.",
    });
  }

  const body = parseBody(req);
  const email = cleanText(body.email, 160).toLowerCase();

  if (!isEmail(email)) {
    return sendJson(res, 400, { error: "Valid email required" });
  }

  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });

  // Mark bootstrap closed so this endpoint refuses every future call.
  await db.collection("bootstrap").doc("used").set({
    at: admin.firestore.FieldValue.serverTimestamp(),
    by: email,
    uid: user.uid,
  });

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
    if (route === "admin" && parts[1] === "users") return handleAdminUsers(req, res, parts);

    return sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    logger.error("API error", error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});
