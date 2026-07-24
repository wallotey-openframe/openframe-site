import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

/* =========================================================================
   INIT
   ========================================================================= */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const PAGE_SIZE = 25;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_UPLOAD_PREFIX = ["image/", "video/", "application/pdf"];
const TABS = ["overview", "contacts", "cms", "media", "admins", "activity"];
const ACTIVITY_PAGE_SIZE = 40;

/* =========================================================================
   DOM
   ========================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const loginShell = $("#login-shell");
const appShell = $("#app-shell");
const loginForm = $("#login-form");
const loginStatus = $("#login-status");
const togglePassword = $("#toggle-password");
const themeToggle = $("#theme-toggle");

const sidebar = $("#sidebar");
const sidebarNav = $("#sidebar-nav");
const openSidebarBtn = $("#open-sidebar");
const userChip = $("#user-chip");
const signOutBtn = $("#sign-out");

const contactsList = $("#contacts-list");
const contactsBadge = $("#contacts-badge");
const contactsSearch = $("#contacts-search");
const contactsFilter = $("#contacts-filter");
const contactsLoadMore = $("#contacts-load-more");
const contactsExport = $("#contacts-export");

const bulkBar = $("#bulk-bar");
const bulkSelectAll = $("#bulk-select-all");
const bulkCount = $("#bulk-count");
const bulkMarkRead = $("#bulk-mark-read");
const bulkArchive = $("#bulk-archive");
const bulkDelete = $("#bulk-delete");

const overviewContactsList = $("#overview-contacts");
const overviewCmsList = $("#overview-cms");
const statUnread = $("#stat-unread");
const statUnreadMeta = $("#stat-unread-meta");
const statDrafts = $("#stat-drafts");
const statPublished = $("#stat-published");
const statMedia = $("#stat-media");

const contentForm = $("#content-form");
const contentStatus = $("#content-status");
const editorMode = $("#editor-mode");
const clearFormBtn = $("#clear-form");
const newEntryBtn = $("#new-entry");
const pickImageBtn = $("#pick-image");
const cmsSearch = $("#cms-search");
const cmsFilter = $("#cms-filter");
const mediaFilter = $("#media-filter");

const activityList = $("#activity-list");
const activityFilter = $("#activity-filter");
const activityLoadMore = $("#activity-load-more");

const uploadForm = $("#upload-form");
const uploadStatus = $("#upload-status");
const uploadProgress = $("#upload-progress");
const uploadProgressBar = $("#upload-progress-bar");
const uploadProgressLabel = $("#upload-progress-label");
const mediaSearch = $("#media-search");

const adminsList = $("#admins-list");
const inviteAdminBtn = $("#invite-admin");
const inviteModal = $("#invite-modal");
const inviteEmail = $("#invite-email");
const inviteGo = $("#invite-go");
const inviteCancel = $("#invite-cancel");

const imagePicker = $("#image-picker");
const imagePickerList = $("#image-picker-list");
const imagePickerClose = $("#image-picker-close");

const commandPalette = $("#command-palette");
const commandInput = $("#command-input");
const commandList = $("#command-list");
const openCommand = $("#open-command");
const mobileCommand = $("#mobile-command");

const confirmModal = $("#confirm-modal");
const confirmTitle = $("#confirm-title");
const confirmBody = $("#confirm-body");
const confirmGo = $("#confirm-go");
const confirmCancel = $("#confirm-cancel");
const confirmTypeWrap = $("#confirm-type-wrap");
const confirmTypeWord = $("#confirm-type-word");
const confirmTypeInput = $("#confirm-type-input");

const toastStack = $("#toast-stack");

/* =========================================================================
   STATE
   ========================================================================= */
let currentUser = null;
let contactsCache = [];
let contactsCursor = null;
let contactsExhausted = false;
let collectionsCache = { pages: [], posts: [], work: [] };
let mediaCache = [];
let selectedContactIds = new Set();
let commandIndex = 0;
let commandResults = [];
let unsub = { contacts: null, pages: null, posts: null, work: null, media: null, activity: null };

let activityCache = [];
let activityCursor = null;
let activityExhausted = false;

/* =========================================================================
   UTILS
   ========================================================================= */
function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      node.setAttribute(k, v === true ? "" : v);
    });
  }
  if (opts.on) {
    Object.entries(opts.on).forEach(([event, handler]) =>
      node.addEventListener(event, handler),
    );
  }
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  });
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const REL = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const REL_UNITS = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

function relativeTime(value) {
  const date = value?.toDate?.() ?? (value instanceof Date ? value : value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "No date";
  const diff = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, secs] of REL_UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") {
      return REL.format(Math.round(diff / secs), unit);
    }
  }
  return "just now";
}

function absoluteTime(value) {
  const date = value?.toDate?.() ?? (value instanceof Date ? value : value ? new Date(value) : null);
  return date ? date.toLocaleString() : "";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* =========================================================================
   TOASTS (with optional Undo)
   ========================================================================= */
function toast(message, variant = "info", { timeout = 4000, undo = null } = {}) {
  const node = el("div", { class: `toast ${variant}` });
  node.appendChild(document.createTextNode(message));
  let timer;
  if (undo) {
    const btn = el("button", {
      class: "undo",
      text: "Undo",
      attrs: { type: "button" },
      on: {
        click: () => {
          clearTimeout(timer);
          node.remove();
          undo();
        },
      },
    });
    node.appendChild(btn);
  }
  toastStack.appendChild(node);
  timer = setTimeout(() => {
    node.style.transition = "opacity 0.2s ease";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function setStatus(node, message, variant = "") {
  node.textContent = message;
  node.classList.remove("is-success", "is-error");
  if (variant === "success") node.classList.add("is-success");
  if (variant === "error") node.classList.add("is-error");
}

/* =========================================================================
   ACTIVITY LOG — fire-and-forget append
   ========================================================================= */
async function logActivity(action, resourceType, resourceId, details = {}) {
  if (!currentUser) return;
  try {
    await setDoc(doc(collection(db, "activity")), {
      action,               // e.g. "delete", "restore", "publish"
      resourceType,         // "contacts" | "pages" | "posts" | "work" | "media" | "admins"
      resourceId,           // doc id or uid
      details,              // arbitrary context payload
      actorUid: currentUser.uid,
      actorEmail: currentUser.email || null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-critical — never block the primary mutation on a log write.
    console.warn("Activity log failed", err);
  }
}

/* =========================================================================
   SOFT DELETE / RESTORE — used across contacts, cms, media
   ========================================================================= */
function isTrashed(snap) {
  return !!snap.data()?.deletedAt;
}

async function softDelete(collectionName, id, title) {
  await updateDoc(doc(db, collectionName, id), {
    deletedAt: serverTimestamp(),
    deletedBy: currentUser?.uid || null,
  });
  logActivity("delete", collectionName, id, { title: title || null });
}

async function restore(collectionName, id, title) {
  await updateDoc(doc(db, collectionName, id), {
    deletedAt: null,
    deletedBy: null,
  });
  logActivity("restore", collectionName, id, { title: title || null });
}

async function permanentDelete(collectionName, id, title) {
  await deleteDoc(doc(db, collectionName, id));
  logActivity("permanent-delete", collectionName, id, { title: title || null });
}

/* =========================================================================
   CONFIRM MODAL — Promise-based
   ========================================================================= */
function openConfirm({ title, body, confirmText = "Confirm", danger = true, typed = false }) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmBody.textContent = body || "";
    confirmGo.textContent = confirmText;
    confirmGo.classList.toggle("danger", !!danger);
    confirmGo.classList.toggle("ghost", false);
    confirmTypeWrap.hidden = !typed;
    confirmTypeInput.value = "";
    if (typed) {
      confirmTypeWord.textContent = typed;
      confirmGo.disabled = true;
    } else {
      confirmGo.disabled = false;
    }

    confirmModal.hidden = false;

    const cleanup = () => {
      confirmModal.hidden = true;
      confirmGo.removeEventListener("click", onGo);
      confirmCancel.removeEventListener("click", onCancel);
      confirmTypeInput.removeEventListener("input", onType);
      confirmModal.removeEventListener("click", onBackdrop);
    };
    const onGo = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onBackdrop = (e) => {
      if (e.target === confirmModal) onCancel();
    };
    const onType = () => {
      confirmGo.disabled = typed && confirmTypeInput.value !== typed;
    };

    confirmGo.addEventListener("click", onGo);
    confirmCancel.addEventListener("click", onCancel);
    confirmTypeInput.addEventListener("input", onType);
    confirmModal.addEventListener("click", onBackdrop);
    (typed ? confirmTypeInput : confirmGo).focus();
  });
}

/* =========================================================================
   SKELETONS
   ========================================================================= */
function renderSkeleton(container, rows = 3) {
  clear(container);
  for (let i = 0; i < rows; i++) {
    container.appendChild(
      el(
        "div",
        { class: "skeleton" },
        el("div", { class: "skeleton-line" }),
        el("div", { class: "skeleton-line short" }),
      ),
    );
  }
}

function renderEmpty(container, message) {
  clear(container);
  container.appendChild(el("div", { class: "empty", text: message }));
}

/* =========================================================================
   AUTH HELPERS
   ========================================================================= */
async function authFetch(path, opts = {}) {
  const idToken = await currentUser.getIdToken();
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(opts.headers || {}),
    },
  });
}

/* =========================================================================
   THEME (light / dark)
   ========================================================================= */
function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  themeToggle?.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

(function initTheme() {
  let saved;
  try {
    saved = localStorage.getItem("of:admin-theme");
  } catch {}
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
    return;
  }
  // First visit — honour the OS preference.
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
})();

themeToggle?.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("of:admin-theme", next);
  } catch {}
});

/* =========================================================================
   MARKDOWN EDITOR — Edit / Split / Preview tabs + live render
   ========================================================================= */
const bodyTextarea = $("#body-textarea");
const bodyPreview = $("#body-preview");
const mdEditor = $("#md-editor");
const mdPanes = mdEditor?.querySelector(".md-panes");

function renderBodyPreview() {
  if (!bodyTextarea || !bodyPreview) return;
  const value = bodyTextarea.value.trim();
  if (!value) {
    bodyPreview.innerHTML = "";
    bodyPreview.appendChild(
      el("p", { class: "md-preview-empty", text: "Nothing to preview yet." }),
    );
    return;
  }
  if (typeof marked === "undefined") {
    bodyPreview.textContent = value;
    return;
  }
  try {
    const raw = marked.parse(value, { breaks: true, gfm: true });
    // Sanitize before injecting. Falls back to plain text if DOMPurify
    // hasn't loaded yet, so unsanitized HTML is never written.
    if (typeof DOMPurify !== "undefined") {
      bodyPreview.innerHTML = DOMPurify.sanitize(raw);
    } else {
      bodyPreview.textContent = value;
    }
  } catch (err) {
    bodyPreview.textContent = `Preview error: ${err.message}`;
  }
}

function setMdMode(mode) {
  if (!mdPanes) return;
  mdPanes.dataset.mode = mode;
  mdEditor.querySelectorAll(".md-tab").forEach((btn) => {
    const isActive = btn.dataset.md === mode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  try {
    localStorage.setItem("of:admin-md-mode", mode);
  } catch {}
  if (mode !== "edit") renderBodyPreview();
}

if (mdEditor) {
  mdEditor.querySelectorAll(".md-tab").forEach((btn) => {
    btn.addEventListener("click", () => setMdMode(btn.dataset.md));
  });
  bodyTextarea?.addEventListener("input", () => {
    if (mdPanes?.dataset.mode !== "edit") renderBodyPreview();
  });
  // Restore previous mode (default to edit)
  let savedMode = "edit";
  try {
    const saved = localStorage.getItem("of:admin-md-mode");
    if (saved === "split" || saved === "preview") savedMode = saved;
  } catch {}
  setMdMode(savedMode);
}

/* =========================================================================
   LOGIN
   ========================================================================= */
togglePassword.addEventListener("click", () => {
  const input = loginForm.password;
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  togglePassword.textContent = isPassword ? "Hide" : "Show";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginStatus, "Signing in…");
  const data = Object.fromEntries(new FormData(loginForm));
  try {
    await signInWithEmailAndPassword(auth, data.email, data.password);
    setStatus(loginStatus, "");
  } catch (err) {
    setStatus(loginStatus, "Sign in failed. Check the email and password.", "error");
  }
});

signOutBtn.addEventListener("click", () => signOut(auth));

/* =========================================================================
   TABS / NAV
   ========================================================================= */
function activateTab(name, opts = {}) {
  if (!TABS.includes(name)) name = "overview";
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".tab").forEach((sec) => sec.classList.toggle("active", sec.id === `tab-${name}`));
  try {
    localStorage.setItem("of:admin-tab", name);
  } catch {}
  // Mobile: close sidebar when navigating
  sidebar.classList.remove("is-open");

  // Optional filter when jumping from stat cards
  if (opts.filter === "unread") {
    contactsFilter.value = "unread";
    renderContacts();
  }
  if (opts.filter === "drafts" || opts.filter === "published") {
    cmsSearch.value = "";
    Object.keys(collectionsCache).forEach((k) => renderCollection(k, opts.filter));
  }
}

sidebarNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (btn) activateTab(btn.dataset.tab);
});

document.addEventListener("click", (e) => {
  const jumpBtn = e.target.closest("[data-jump]");
  if (!jumpBtn) return;
  const [tab, filter] = jumpBtn.dataset.jump.split(":");
  activateTab(tab, { filter });
});

openSidebarBtn?.addEventListener("click", () => sidebar.classList.toggle("is-open"));

/* =========================================================================
   OVERVIEW
   ========================================================================= */
function renderOverview() {
  const activeContacts = contactsCache.filter((s) => !isTrashed(s));
  const unread = activeContacts.filter((s) => (s.data().status || "unread") === "unread").length;
  statUnread.textContent = unread;
  statUnreadMeta.textContent = unread === 0 ? "All caught up" : `Out of ${activeContacts.length} loaded`;

  const allCms = [
    ...collectionsCache.pages,
    ...collectionsCache.posts,
    ...collectionsCache.work,
  ].filter((s) => !isTrashed(s));
  const drafts = allCms.filter((s) => (s.data().status || "draft") !== "published").length;
  const published = allCms.filter((s) => s.data().status === "published").length;
  statDrafts.textContent = drafts;
  statPublished.textContent = published;
  statMedia.textContent = mediaCache.filter((s) => !isTrashed(s)).length;

  // Recent submissions (excluding trash)
  clear(overviewContactsList);
  const recent = activeContacts.slice(0, 5);
  if (recent.length === 0) {
    renderEmpty(overviewContactsList, "No submissions yet.");
  } else {
    recent.forEach((snap) => {
      const d = snap.data();
      const item = el(
        "article",
        { class: `item status-${d.status || "unread"}` },
        el(
          "div",
          { class: "item-head" },
          el("h3", { class: "item-title", text: d.name || "Anonymous" }),
          el("span", {
            class: "item-meta",
            text: relativeTime(d.createdAt),
            attrs: { title: absoluteTime(d.createdAt) },
          }),
        ),
        el("p", {
          class: "item-body",
          text: (d.message || "").slice(0, 140) + ((d.message || "").length > 140 ? "…" : ""),
        }),
      );
      item.addEventListener("click", () => activateTab("contacts"));
      item.style.cursor = "pointer";
      overviewContactsList.appendChild(item);
    });
  }

  // Recently edited CMS
  clear(overviewCmsList);
  const sorted = allCms
    .slice()
    .sort((a, b) => {
      const ax = a.data().updatedAt?.toMillis?.() || 0;
      const bx = b.data().updatedAt?.toMillis?.() || 0;
      return bx - ax;
    })
    .slice(0, 5);
  if (sorted.length === 0) {
    renderEmpty(overviewCmsList, "No entries yet.");
  } else {
    sorted.forEach((snap) => {
      const d = snap.data();
      const status = d.status === "published" ? "published" : "draft";
      const item = el(
        "article",
        { class: `item status-${status}` },
        el(
          "div",
          { class: "item-head" },
          el("h3", { class: "item-title", text: d.title || snap.id }),
          el("span", {
            class: `pill ${status === "published" ? "success" : "warning"}`,
            text: status === "published" ? "Published" : "Draft",
          }),
        ),
        el("span", {
          class: "item-meta",
          text: `${snap.ref.parent.id} / ${snap.id} · ${relativeTime(d.updatedAt)}`,
          attrs: { title: absoluteTime(d.updatedAt) },
        }),
      );
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        activateTab("cms");
        loadIntoEditor(snap, snap.ref.parent.id);
      });
      overviewCmsList.appendChild(item);
    });
  }
}

/* =========================================================================
   CONTACTS
   ========================================================================= */
function statusPill(status) {
  const map = {
    unread: ["signal", "Unread"],
    read: ["ash", "Read"],
    archived: ["", "Archived"],
  };
  const [variant, label] = map[status] || ["", status || "Unknown"];
  return el("span", { class: `pill ${variant}`, text: label });
}

function renderContactItem(snap) {
  const data = snap.data();
  const status = data.status || "unread";
  const isSelected = selectedContactIds.has(snap.id);
  const item = el("article", {
    class: `item status-${status}${isSelected ? " is-selected" : ""}`,
  });

  const checkbox = el("input", {
    class: "item-checkbox",
    attrs: { type: "checkbox", "aria-label": "Select submission" },
    on: {
      change: (e) => {
        if (e.target.checked) selectedContactIds.add(snap.id);
        else selectedContactIds.delete(snap.id);
        renderBulkBar();
        item.classList.toggle("is-selected", e.target.checked);
      },
    },
  });
  checkbox.checked = isSelected;

  const head = el(
    "div",
    { class: "item-head" },
    el("h3", { class: "item-title", text: data.name || "Anonymous" }),
    statusPill(status),
  );

  const meta = el("div", { class: "item-meta" });
  if (data.email) {
    meta.appendChild(el("a", { attrs: { href: `mailto:${data.email}` }, text: data.email }));
    meta.appendChild(document.createTextNode(" · "));
  }
  if (data.company) {
    meta.appendChild(document.createTextNode(`${data.company} · `));
  }
  meta.appendChild(
    el("span", {
      text: relativeTime(data.createdAt),
      attrs: { title: absoluteTime(data.createdAt) },
    }),
  );

  const body = el("p", { class: "item-body", text: data.message || "" });

  const trashed = isTrashed(snap);
  const actions = el("div", { class: "item-actions" });
  if (trashed) {
    actions.appendChild(
      el("button", {
        class: "ghost",
        text: "Restore",
        attrs: { type: "button" },
        on: {
          click: async () => {
            try {
              await restore("contacts", snap.id, data.name);
              toast("Restored.", "success");
            } catch (err) {
              toast(`Restore failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "danger",
        text: "Delete permanently",
        attrs: { type: "button" },
        on: {
          click: async () => {
            const ok = await openConfirm({
              title: `Permanently delete "${data.name || "Anonymous"}"?`,
              body: "This cannot be undone.",
              confirmText: "Delete permanently",
              typed: "DELETE",
            });
            if (!ok) return;
            try {
              await permanentDelete("contacts", snap.id, data.name);
              toast("Permanently deleted.", "success");
            } catch (err) {
              toast(`Delete failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
  } else {
    if (data.email) {
      actions.appendChild(
        el("a", {
          class: "ghost",
          attrs: {
            href: `mailto:${data.email}?subject=${encodeURIComponent("Re: your brief")}&body=${encodeURIComponent(`Hi ${data.name || ""},\n\n`)}`,
            role: "button",
          },
          text: "Reply",
        }),
      );
    }
    actions.appendChild(
      el("button", {
        class: "ghost",
        text: status === "unread" ? "Mark read" : "Mark unread",
        attrs: { type: "button" },
        on: { click: () => updateContactStatus(snap.id, status === "unread" ? "read" : "unread") },
      }),
    );
    if (status !== "archived") {
      actions.appendChild(
        el("button", {
          class: "ghost",
          text: "Archive",
          attrs: { type: "button" },
          on: { click: () => archiveContactWithUndo(snap) },
        }),
      );
    } else {
      actions.appendChild(
        el("button", {
          class: "ghost",
          text: "Unarchive",
          attrs: { type: "button" },
          on: { click: () => updateContactStatus(snap.id, "read") },
        }),
      );
    }
    actions.appendChild(
      el("button", {
        class: "danger",
        text: "Delete",
        attrs: { type: "button" },
        on: { click: () => deleteContactWithUndo(snap) },
      }),
    );
  }

  item.appendChild(checkbox);
  item.appendChild(head);
  item.appendChild(meta);
  item.appendChild(body);
  item.appendChild(actions);
  return item;
}

async function updateContactStatus(id, status) {
  try {
    await updateDoc(doc(db, "contacts", id), { status });
    logActivity("status", "contacts", id, { status });
  } catch (err) {
    toast(`Could not update: ${err.message}`, "error");
  }
}

async function archiveContactWithUndo(snap) {
  const prevStatus = snap.data().status || "unread";
  try {
    await updateDoc(doc(db, "contacts", snap.id), { status: "archived" });
    logActivity("archive", "contacts", snap.id, { title: snap.data().name });
    toast("Archived.", "success", {
      undo: () => updateDoc(doc(db, "contacts", snap.id), { status: prevStatus }),
    });
  } catch (err) {
    toast(`Archive failed: ${err.message}`, "error");
  }
}

async function deleteContactWithUndo(snap) {
  const data = snap.data();
  try {
    await softDelete("contacts", snap.id, data.name);
    toast(`Moved "${data.name || "Anonymous"}" to trash.`, "success", {
      undo: () => restore("contacts", snap.id, data.name),
      timeout: 6000,
    });
  } catch (err) {
    toast(`Delete failed: ${err.message}`, "error");
  }
}

function renderBulkBar() {
  const count = selectedContactIds.size;
  bulkBar.hidden = count === 0;
  bulkCount.textContent = `${count} selected`;
  const visibleSnaps = filterContacts();
  bulkSelectAll.checked = count > 0 && visibleSnaps.every((s) => selectedContactIds.has(s.id));
}

function filterContacts() {
  const q = contactsSearch.value.trim().toLowerCase();
  const status = contactsFilter.value;
  return contactsCache.filter((snap) => {
    const data = snap.data();
    const trashed = !!data.deletedAt;
    if (status === "trashed") {
      if (!trashed) return false;
    } else {
      if (trashed) return false;
      if (status !== "all" && (data.status || "unread") !== status) return false;
    }
    if (!q) return true;
    return [data.name, data.email, data.company, data.message]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });
}

function renderContacts() {
  const filtered = filterContacts();
  const unread = contactsCache.filter(
    (s) => !isTrashed(s) && (s.data().status || "unread") === "unread",
  ).length;
  if (unread > 0) {
    contactsBadge.textContent = unread;
    contactsBadge.hidden = false;
  } else {
    contactsBadge.hidden = true;
  }

  if (filtered.length === 0) {
    renderEmpty(contactsList, "No submissions match.");
  } else {
    clear(contactsList);
    filtered.forEach((snap) => contactsList.appendChild(renderContactItem(snap)));
  }
  renderBulkBar();
  renderOverview();
}

function subscribeContacts() {
  renderSkeleton(contactsList, 3);
  if (unsub.contacts) unsub.contacts();
  const q = query(collection(db, "contacts"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  unsub.contacts = onSnapshot(
    q,
    (snap) => {
      contactsCache = snap.docs;
      contactsCursor = snap.docs[snap.docs.length - 1] || null;
      contactsExhausted = snap.docs.length < PAGE_SIZE;
      contactsLoadMore.hidden = contactsExhausted;
      renderContacts();
    },
    (err) => {
      renderEmpty(contactsList, `Could not load contacts: ${err.message}`);
      toast(`Contacts error: ${err.message}`, "error");
    },
  );
}

async function loadMoreContacts() {
  if (!contactsCursor || contactsExhausted) return;
  contactsLoadMore.disabled = true;
  try {
    const snap = await getDocs(
      query(
        collection(db, "contacts"),
        orderBy("createdAt", "desc"),
        startAfter(contactsCursor),
        limit(PAGE_SIZE),
      ),
    );
    contactsCache = contactsCache.concat(snap.docs);
    contactsCursor = snap.docs[snap.docs.length - 1] || contactsCursor;
    contactsExhausted = snap.docs.length < PAGE_SIZE;
    contactsLoadMore.hidden = contactsExhausted;
    renderContacts();
  } catch (err) {
    toast(`Could not load more: ${err.message}`, "error");
  } finally {
    contactsLoadMore.disabled = false;
  }
}

contactsSearch.addEventListener("input", renderContacts);
contactsFilter.addEventListener("change", renderContacts);
contactsLoadMore.addEventListener("click", loadMoreContacts);

bulkSelectAll.addEventListener("change", (e) => {
  const visible = filterContacts();
  if (e.target.checked) visible.forEach((s) => selectedContactIds.add(s.id));
  else visible.forEach((s) => selectedContactIds.delete(s.id));
  renderContacts();
});

bulkMarkRead.addEventListener("click", async () => {
  const ids = [...selectedContactIds];
  await Promise.allSettled(
    ids.map((id) => updateDoc(doc(db, "contacts", id), { status: "read" })),
  );
  toast(`${ids.length} marked read.`, "success");
  selectedContactIds.clear();
  renderContacts();
});

bulkArchive.addEventListener("click", async () => {
  const ids = [...selectedContactIds];
  const prev = new Map();
  contactsCache.forEach((s) => {
    if (selectedContactIds.has(s.id)) prev.set(s.id, s.data().status || "unread");
  });
  await Promise.allSettled(
    ids.map((id) => updateDoc(doc(db, "contacts", id), { status: "archived" })),
  );
  toast(`${ids.length} archived.`, "success", {
    undo: () =>
      Promise.allSettled(
        ids.map((id) =>
          updateDoc(doc(db, "contacts", id), { status: prev.get(id) || "read" }),
        ),
      ),
  });
  selectedContactIds.clear();
  renderContacts();
});

bulkDelete.addEventListener("click", async () => {
  const ids = [...selectedContactIds];
  const ok = await openConfirm({
    title: `Move ${ids.length} submission${ids.length === 1 ? "" : "s"} to trash?`,
    body: "You can restore them from the Trashed filter.",
    confirmText: "Move to trash",
  });
  if (!ok) return;
  await Promise.allSettled(ids.map((id) => softDelete("contacts", id)));
  toast(`${ids.length} moved to trash.`, "success", {
    undo: () => Promise.allSettled(ids.map((id) => restore("contacts", id))),
    timeout: 6000,
  });
  selectedContactIds.clear();
  renderContacts();
});

/* CSV export */
contactsExport.addEventListener("click", () => {
  const rows = filterContacts();
  if (rows.length === 0) {
    toast("Nothing to export.", "info");
    return;
  }
  const csv = [
    ["id", "name", "email", "company", "status", "createdAt", "message"],
    ...rows.map((s) => {
      const d = s.data();
      return [
        s.id,
        d.name || "",
        d.email || "",
        d.company || "",
        d.status || "unread",
        d.createdAt?.toDate?.().toISOString() || "",
        (d.message || "").replace(/\r?\n/g, " "),
      ];
    }),
  ]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = el("a", {
    attrs: { href: url, download: `openframe-contacts-${Date.now()}.csv` },
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} rows.`, "success");
});

/* =========================================================================
   CMS COLLECTIONS
   ========================================================================= */
function renderCmsItem(snap, collectionName) {
  const data = snap.data();
  const status = data.status === "published" ? "published" : "draft";
  const item = el("article", { class: `item status-${status}` });

  const head = el(
    "div",
    { class: "item-head" },
    el("h3", { class: "item-title", text: data.title || snap.id }),
    el("span", {
      class: `pill ${status === "published" ? "success" : "warning"}`,
      text: status === "published" ? "Published" : "Draft",
    }),
  );

  const meta = el("div", {
    class: "item-meta",
    text: `#${snap.id} · sort ${data.sortOrder ?? 0} · ${relativeTime(data.updatedAt)}`,
    attrs: { title: absoluteTime(data.updatedAt) },
  });

  const summary = data.summary || data.body || "";
  const body = summary
    ? el("p", {
        class: "item-body",
        text: summary.length > 160 ? summary.slice(0, 160) + "…" : summary,
      })
    : null;

  const trashed = isTrashed(snap);
  const actions = el("div", { class: "item-actions" });
  if (trashed) {
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: "Restore",
        on: {
          click: async () => {
            try {
              await restore(collectionName, snap.id, data.title);
              toast("Restored.", "success");
            } catch (err) {
              toast(`Restore failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "danger",
        attrs: { type: "button" },
        text: "Delete permanently",
        on: {
          click: async () => {
            const ok = await openConfirm({
              title: `Permanently delete "${data.title || snap.id}"?`,
              body: "This cannot be undone.",
              confirmText: "Delete permanently",
              typed: "DELETE",
            });
            if (!ok) return;
            try {
              await permanentDelete(collectionName, snap.id, data.title);
              toast("Permanently deleted.", "success");
            } catch (err) {
              toast(`Delete failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
  } else {
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: "Edit",
        on: { click: () => loadIntoEditor(snap, collectionName) },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: status === "published" ? "Unpublish" : "Publish",
        on: {
          click: () =>
            togglePublish(snap.id, collectionName, status === "published" ? "draft" : "published"),
        },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: "Duplicate",
        on: { click: () => duplicateEntry(snap, collectionName) },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "danger",
        attrs: { type: "button" },
        text: "Delete",
        on: { click: () => deleteCms(snap.id, collectionName, data.title) },
      }),
    );
  }

  item.appendChild(head);
  item.appendChild(meta);
  if (body) item.appendChild(body);
  item.appendChild(actions);
  return item;
}

function renderCollection(name, statusFilter) {
  const list = $(`#${name}-list`);
  const q = cmsSearch.value.trim().toLowerCase();
  const effectiveFilter = statusFilter ?? (cmsFilter?.value || "all");
  const filtered = collectionsCache[name].filter((snap) => {
    const data = snap.data();
    const trashed = !!data.deletedAt;
    if (effectiveFilter === "trashed") {
      if (!trashed) return false;
    } else {
      if (trashed) return false;
      if (effectiveFilter === "drafts" && data.status === "published") return false;
      if (effectiveFilter === "published" && data.status !== "published") return false;
    }
    if (!q) return true;
    return [snap.id, data.title, data.summary]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    renderEmpty(list, q ? "No matches." : "No entries yet.");
  } else {
    clear(list);
    filtered.forEach((snap) => list.appendChild(renderCmsItem(snap, name)));
  }
  renderOverview();
}

function subscribeCollection(name) {
  const list = $(`#${name}-list`);
  renderSkeleton(list, 2);
  if (unsub[name]) unsub[name]();
  const q = query(collection(db, name), orderBy("updatedAt", "desc"), limit(50));
  unsub[name] = onSnapshot(
    q,
    (snap) => {
      collectionsCache[name] = snap.docs;
      renderCollection(name);
    },
    (err) => {
      renderEmpty(list, `Could not load ${name}: ${err.message}`);
      toast(`${name} error: ${err.message}`, "error");
    },
  );
}

function loadIntoEditor(snap, collectionName) {
  const data = snap.data();
  contentForm.collection.value = collectionName;
  contentForm.id.value = snap.id;
  contentForm.title.value = data.title || "";
  contentForm.status.value = data.status || "draft";
  contentForm.summary.value = data.summary || "";
  contentForm.body.value = data.body || "";
  contentForm.imageUrl.value = data.imageUrl || "";
  contentForm.sortOrder.value = data.sortOrder ?? 0;
  editorMode.textContent = `Editing ${collectionName} / ${snap.id}`;
  contentForm.dataset.touchedSlug = "1"; // don't auto-fill slug from title
  renderBodyPreview();
  contentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function togglePublish(id, collectionName, nextStatus) {
  try {
    await updateDoc(doc(db, collectionName, id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null,
    });
    logActivity(nextStatus === "published" ? "publish" : "unpublish", collectionName, id);
    toast(`${nextStatus === "published" ? "Published" : "Unpublished"}.`, "success");
  } catch (err) {
    toast(`Status update failed: ${err.message}`, "error");
  }
}

async function duplicateEntry(snap, collectionName) {
  const data = snap.data();
  const newId = prompt("New slug / ID for the duplicate:", `${snap.id}-copy`);
  if (!newId) return;
  try {
    await setDoc(doc(db, collectionName, newId.trim()), {
      ...data,
      status: "draft",
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null,
    });
    toast("Entry duplicated as draft.", "success");
  } catch (err) {
    toast(`Duplicate failed: ${err.message}`, "error");
  }
}

async function deleteCms(id, collectionName, title) {
  const ok = await openConfirm({
    title: `Move "${title || id}" to trash?`,
    body: `You can restore it from the Trashed filter. Nothing is permanently deleted yet.`,
    confirmText: "Move to trash",
  });
  if (!ok) return;
  try {
    await softDelete(collectionName, id, title);
    toast(`"${title || id}" moved to trash.`, "success", {
      undo: () => restore(collectionName, id, title),
      timeout: 6000,
    });
  } catch (err) {
    toast(`Delete failed: ${err.message}`, "error");
  }
}

function resetEditor() {
  contentForm.reset();
  contentForm.sortOrder.value = 0;
  editorMode.textContent = "New entry";
  delete contentForm.dataset.touchedSlug;
  renderBodyPreview();
}

clearFormBtn.addEventListener("click", resetEditor);
newEntryBtn.addEventListener("click", () => {
  resetEditor();
  contentForm.scrollIntoView({ behavior: "smooth", block: "start" });
});
function renderAllCollections() {
  renderCollection("pages");
  renderCollection("posts");
  renderCollection("work");
}

cmsSearch.addEventListener("input", renderAllCollections);
cmsFilter?.addEventListener("change", renderAllCollections);
mediaFilter?.addEventListener("change", renderMedia);

// Auto-slug from title
contentForm.title.addEventListener("input", () => {
  if (contentForm.dataset.touchedSlug) return;
  contentForm.id.value = slugify(contentForm.title.value);
});
contentForm.id.addEventListener("input", () => {
  contentForm.dataset.touchedSlug = "1";
});

contentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(contentStatus, "Saving…");
  const data = Object.fromEntries(new FormData(contentForm));
  const collectionName = data.collection;
  const id = data.id.trim();
  if (!id) {
    setStatus(contentStatus, "Slug is required.", "error");
    return;
  }
  const existing = collectionsCache[collectionName]?.find((s) => s.id === id);
  const action = existing ? "update" : "create";
  try {
    await setDoc(
      doc(db, collectionName, id),
      {
        title: data.title.trim(),
        status: data.status,
        summary: data.summary.trim(),
        body: data.body.trim(),
        imageUrl: data.imageUrl.trim(),
        sortOrder: Number(data.sortOrder || 0),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      },
      { merge: true },
    );
    logActivity(action, collectionName, id, { title: data.title.trim() });
    setStatus(contentStatus, "Saved.", "success");
    toast("Content saved.", "success");
    editorMode.textContent = `Editing ${collectionName} / ${id}`;
    contentForm.dataset.touchedSlug = "1";
  } catch (err) {
    setStatus(contentStatus, `Save failed: ${err.message}`, "error");
    toast(`Save failed: ${err.message}`, "error");
  }
});

/* =========================================================================
   UPLOADS
   ========================================================================= */
function renderMediaItem(snap, opts = {}) {
  const data = snap.data();
  const item = el("article", { class: "item" });

  if (data.type?.startsWith("image/")) {
    item.appendChild(
      el("img", { attrs: { src: data.url, alt: data.name || "", loading: "lazy" } }),
    );
  } else {
    let label = "File";
    if (data.type?.startsWith("video/")) label = "Video";
    if (data.type === "application/pdf") label = "PDF";
    item.appendChild(el("div", { class: "placeholder", text: label }));
  }

  const info = el("div");
  info.appendChild(el("strong", { class: "item-title", text: data.name || "Untitled" }));
  info.appendChild(
    el("div", {
      class: "item-meta",
      text: `${formatBytes(data.size || 0)} · ${relativeTime(data.createdAt)}`,
    }),
  );
  const actions = el("div", { class: "item-actions" });
  actions.appendChild(
    el("a", {
      class: "ghost",
      attrs: { href: data.url, target: "_blank", rel: "noreferrer", role: "button" },
      text: "Open",
    }),
  );
  actions.appendChild(
    el("button", {
      class: "ghost",
      attrs: { type: "button" },
      text: "Copy URL",
      on: {
        click: () => {
          navigator.clipboard.writeText(data.url);
          toast("URL copied.", "success", { timeout: 1800 });
        },
      },
    }),
  );
  if (opts.pickable) {
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: "Use",
        on: {
          click: () => {
            contentForm.imageUrl.value = data.url;
            imagePicker.hidden = true;
            toast("Image URL set.", "success", { timeout: 1800 });
          },
        },
      }),
    );
  } else if (isTrashed(snap)) {
    actions.appendChild(
      el("button", {
        class: "ghost",
        attrs: { type: "button" },
        text: "Restore",
        on: {
          click: async () => {
            try {
              await restore("media", snap.id, data.name);
              toast("Restored.", "success");
            } catch (err) {
              toast(`Restore failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
    actions.appendChild(
      el("button", {
        class: "danger",
        attrs: { type: "button" },
        text: "Delete permanently",
        on: {
          click: async () => {
            const ok = await openConfirm({
              title: `Permanently delete "${data.name || snap.id}"?`,
              body: "Metadata is removed. The Storage file remains.",
              confirmText: "Delete permanently",
              typed: "DELETE",
            });
            if (!ok) return;
            try {
              await permanentDelete("media", snap.id, data.name);
              toast("Permanently deleted.", "success");
            } catch (err) {
              toast(`Delete failed: ${err.message}`, "error");
            }
          },
        },
      }),
    );
  } else {
    actions.appendChild(
      el("button", {
        class: "danger",
        attrs: { type: "button" },
        text: "Delete",
        on: { click: () => deleteMedia(snap.id, data.name) },
      }),
    );
  }
  info.appendChild(actions);
  item.appendChild(info);
  return item;
}

function renderMedia() {
  const q = mediaSearch.value.trim().toLowerCase();
  const view = mediaFilter?.value || "all";
  const filtered = mediaCache.filter((snap) => {
    const trashed = isTrashed(snap);
    if (view === "trashed" ? !trashed : trashed) return false;
    if (!q) return true;
    return (snap.data().name || "").toLowerCase().includes(q);
  });
  const list = $("#media-list");
  if (filtered.length === 0) {
    renderEmpty(list, q ? "No matches." : view === "trashed" ? "Trash is empty." : "No uploads yet.");
  } else {
    clear(list);
    filtered.forEach((snap) => list.appendChild(renderMediaItem(snap)));
  }
  renderOverview();
}

function subscribeMedia() {
  const list = $("#media-list");
  renderSkeleton(list, 2);
  if (unsub.media) unsub.media();
  const q = query(collection(db, "media"), orderBy("createdAt", "desc"), limit(60));
  unsub.media = onSnapshot(
    q,
    (snap) => {
      mediaCache = snap.docs;
      renderMedia();
    },
    (err) => {
      renderEmpty(list, `Could not load uploads: ${err.message}`);
      toast(`Uploads error: ${err.message}`, "error");
    },
  );
}

async function deleteMedia(id, name) {
  const ok = await openConfirm({
    title: `Move "${name || id}" to trash?`,
    body: "The Storage file is untouched. You can restore from the Trashed filter.",
    confirmText: "Move to trash",
  });
  if (!ok) return;
  try {
    await softDelete("media", id, name);
    toast(`"${name || id}" moved to trash.`, "success", {
      undo: () => restore("media", id, name),
      timeout: 6000,
    });
  } catch (err) {
    toast(`Delete failed: ${err.message}`, "error");
  }
}

mediaSearch.addEventListener("input", renderMedia);

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = uploadForm.file.files[0];
  if (!file) return;
  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(uploadStatus, `Too large (max ${formatBytes(MAX_UPLOAD_BYTES)}).`, "error");
    toast("Upload too large.", "error");
    return;
  }
  if (!ALLOWED_UPLOAD_PREFIX.some((p) => (file.type || "").startsWith(p))) {
    setStatus(uploadStatus, "File type not allowed.", "error");
    toast("File type not allowed.", "error");
    return;
  }
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
  const path = `cms/uploads/${currentUser.uid}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);

  uploadProgress.hidden = false;
  uploadProgressBar.style.width = "0%";
  uploadProgressLabel.textContent = "0%";
  setStatus(uploadStatus, "Uploading…");

  const task = uploadBytesResumable(fileRef, file, { contentType: file.type });
  task.on(
    "state_changed",
    (s) => {
      const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
      uploadProgressBar.style.width = `${pct}%`;
      uploadProgressLabel.textContent = `${pct}%`;
    },
    (err) => {
      setStatus(uploadStatus, `Upload failed: ${err.message}`, "error");
      toast(`Upload failed: ${err.message}`, "error");
      uploadProgress.hidden = true;
    },
    async () => {
      try {
        const url = await getDownloadURL(fileRef);
        await setDoc(doc(collection(db, "media")), {
          name: file.name,
          path,
          url,
          type: file.type,
          size: file.size,
          createdAt: serverTimestamp(),
          uploadedBy: currentUser.uid,
        });
        uploadForm.reset();
        setStatus(uploadStatus, "Uploaded.", "success");
        toast("File uploaded.", "success");
      } catch (err) {
        setStatus(uploadStatus, `Metadata save failed: ${err.message}`, "error");
      } finally {
        setTimeout(() => {
          uploadProgress.hidden = true;
          uploadProgressBar.style.width = "0%";
          uploadProgressLabel.textContent = "0%";
        }, 600);
      }
    },
  );
});

/* =========================================================================
   IMAGE PICKER
   ========================================================================= */
pickImageBtn.addEventListener("click", () => {
  imagePicker.hidden = false;
  clear(imagePickerList);
  const imageOnly = mediaCache.filter((snap) =>
    (snap.data().type || "").startsWith("image/"),
  );
  if (imageOnly.length === 0) {
    renderEmpty(imagePickerList, "Upload images first in the Uploads tab.");
    return;
  }
  imageOnly.forEach((snap) =>
    imagePickerList.appendChild(renderMediaItem(snap, { pickable: true })),
  );
});

imagePickerClose.addEventListener("click", () => (imagePicker.hidden = true));
imagePicker.addEventListener("click", (e) => {
  if (e.target === imagePicker) imagePicker.hidden = true;
});

/* =========================================================================
   ADMINS TAB
   ========================================================================= */
async function loadAdmins() {
  renderSkeleton(adminsList, 2);
  try {
    const res = await authFetch("/api/admin/users");
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `HTTP ${res.status}`);
    }
    const { users } = await res.json();
    if (!users || users.length === 0) {
      renderEmpty(adminsList, "No users found.");
      return;
    }
    clear(adminsList);
    users
      .slice()
      .sort((a, b) => (b.admin ? 1 : 0) - (a.admin ? 1 : 0))
      .forEach((u) => adminsList.appendChild(renderAdminItem(u)));
  } catch (err) {
    renderEmpty(adminsList, `Could not load admins: ${err.message}`);
  }
}

function renderAdminItem(u) {
  const item = el("article", {
    class: `item ${u.disabled ? "status-archived" : u.admin ? "status-published" : "status-draft"}`,
  });
  const head = el(
    "div",
    { class: "item-head" },
    el("h3", { class: "item-title", text: u.email || u.uid }),
    el("span", {
      class: `pill ${u.admin ? "success" : "ash"}`,
      text: u.admin ? "Admin" : "User",
    }),
  );
  const meta = el("div", { class: "item-meta" });
  meta.textContent = [
    u.disabled ? "Disabled" : null,
    u.lastSignInAt ? `Last sign-in ${relativeTime(u.lastSignInAt)}` : "Never signed in",
    `Created ${relativeTime(u.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const actions = el("div", { class: "item-actions" });
  const isSelf = u.uid === currentUser?.uid;

  actions.appendChild(
    el("button", {
      class: "ghost",
      attrs: { type: "button", disabled: isSelf && u.admin ? "" : null },
      text: u.admin ? "Revoke admin" : "Grant admin",
      on: {
        click: async () => {
          if (isSelf && u.admin) return;
          const ok = await openConfirm({
            title: u.admin ? "Revoke admin?" : "Grant admin?",
            body: u.admin
              ? `${u.email} will lose access to this dashboard.`
              : `${u.email} will gain full access to contacts and CMS.`,
            confirmText: u.admin ? "Revoke" : "Grant",
            danger: u.admin,
          });
          if (!ok) return;
          try {
            const res = await authFetch(`/api/admin/users/${u.uid}/admin`, {
              method: "POST",
              body: JSON.stringify({ admin: !u.admin }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Failed");
            toast(u.admin ? "Admin revoked." : "Admin granted.", "success");
            loadAdmins();
          } catch (err) {
            toast(`Could not update: ${err.message}`, "error");
          }
        },
      },
    }),
  );

  actions.appendChild(
    el("button", {
      class: "ghost",
      attrs: { type: "button" },
      text: "Send password reset",
      on: {
        click: async () => {
          try {
            const res = await authFetch(`/api/admin/users/${u.uid}/reset`, {
              method: "POST",
              body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Failed");
            toast(`Reset email sent to ${u.email}.`, "success");
          } catch (err) {
            toast(`Reset failed: ${err.message}`, "error");
          }
        },
      },
    }),
  );

  actions.appendChild(
    el("button", {
      class: "ghost",
      attrs: { type: "button", disabled: isSelf ? "" : null },
      text: u.disabled ? "Enable" : "Disable",
      on: {
        click: async () => {
          if (isSelf) return;
          const ok = await openConfirm({
            title: u.disabled ? "Enable user?" : "Disable user?",
            body: u.disabled
              ? "They'll be able to sign in again."
              : "They won't be able to sign in.",
            confirmText: u.disabled ? "Enable" : "Disable",
            danger: !u.disabled,
          });
          if (!ok) return;
          try {
            const res = await authFetch(`/api/admin/users/${u.uid}/disable`, {
              method: "POST",
              body: JSON.stringify({ disabled: !u.disabled }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Failed");
            toast("Updated.", "success");
            loadAdmins();
          } catch (err) {
            toast(`Could not update: ${err.message}`, "error");
          }
        },
      },
    }),
  );

  item.appendChild(head);
  item.appendChild(meta);
  item.appendChild(actions);
  return item;
}

/* Invite modal */
inviteAdminBtn.addEventListener("click", () => {
  inviteEmail.value = "";
  inviteModal.hidden = false;
  inviteEmail.focus();
});
inviteCancel.addEventListener("click", () => (inviteModal.hidden = true));
inviteModal.addEventListener("click", (e) => {
  if (e.target === inviteModal) inviteModal.hidden = true;
});
inviteGo.addEventListener("click", async () => {
  const email = inviteEmail.value.trim().toLowerCase();
  if (!email) return;
  inviteGo.disabled = true;
  try {
    const res = await authFetch(`/api/admin/users/create`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed");
    inviteModal.hidden = true;
    toast(`Invite sent to ${email}.`, "success");
    loadAdmins();
  } catch (err) {
    toast(`Invite failed: ${err.message}`, "error");
  } finally {
    inviteGo.disabled = false;
  }
});

/* =========================================================================
   ACTIVITY LOG
   ========================================================================= */
const VERB_CLASS = {
  create: "create",
  update: "update",
  publish: "create",
  unpublish: "update",
  archive: "update",
  status: "update",
  restore: "create",
  delete: "destructive",
  "permanent-delete": "destructive",
  "admin-grant": "create",
  "admin-revoke": "destructive",
  "admin-disable": "destructive",
  "admin-enable": "create",
  "admin-invite": "create",
  "password-reset": "update",
};

function renderActivityItem(snap) {
  const d = snap.data();
  const verb = String(d.action || "action").replace(/-/g, " ");
  const item = el("article", { class: "activity-item" });
  item.appendChild(
    el("span", {
      class: "activity-time",
      text: relativeTime(d.createdAt),
      attrs: { title: absoluteTime(d.createdAt) },
    }),
  );
  const text = el("div", { class: "activity-text" });
  const actor = d.actorEmail || d.actorUid || "someone";
  const target = d.details?.title ? `"${d.details.title}"` : d.resourceId || "";
  text.appendChild(el("strong", { text: actor }));
  text.appendChild(document.createTextNode(` ${verb} ${d.resourceType || ""}${target ? " " + target : ""}`));
  if (d.details?.status) {
    text.appendChild(el("small", { text: `status → ${d.details.status}` }));
  }
  item.appendChild(text);
  const cls = VERB_CLASS[d.action] || "";
  item.appendChild(el("span", { class: `activity-verb ${cls}`, text: verb }));
  return item;
}

function filterActivity() {
  const view = activityFilter?.value || "all";
  if (view === "all") return activityCache;
  return activityCache.filter((s) => {
    const rt = s.data().resourceType;
    if (view === "admins") return rt === "admins" || (rt || "").startsWith("admin");
    return rt === view;
  });
}

function renderActivity() {
  const list = filterActivity();
  if (list.length === 0) {
    renderEmpty(activityList, "No activity yet.");
    return;
  }
  clear(activityList);
  list.forEach((snap) => activityList.appendChild(renderActivityItem(snap)));
}

function subscribeActivity() {
  renderSkeleton(activityList, 3);
  if (unsub.activity) unsub.activity();
  const q = query(
    collection(db, "activity"),
    orderBy("createdAt", "desc"),
    limit(ACTIVITY_PAGE_SIZE),
  );
  unsub.activity = onSnapshot(
    q,
    (snap) => {
      activityCache = snap.docs;
      activityCursor = snap.docs[snap.docs.length - 1] || null;
      activityExhausted = snap.docs.length < ACTIVITY_PAGE_SIZE;
      activityLoadMore.hidden = activityExhausted;
      renderActivity();
    },
    (err) => {
      renderEmpty(activityList, `Could not load activity: ${err.message}`);
    },
  );
}

async function loadMoreActivity() {
  if (!activityCursor || activityExhausted) return;
  activityLoadMore.disabled = true;
  try {
    const snap = await getDocs(
      query(
        collection(db, "activity"),
        orderBy("createdAt", "desc"),
        startAfter(activityCursor),
        limit(ACTIVITY_PAGE_SIZE),
      ),
    );
    activityCache = activityCache.concat(snap.docs);
    activityCursor = snap.docs[snap.docs.length - 1] || activityCursor;
    activityExhausted = snap.docs.length < ACTIVITY_PAGE_SIZE;
    activityLoadMore.hidden = activityExhausted;
    renderActivity();
  } catch (err) {
    toast(`Could not load more: ${err.message}`, "error");
  } finally {
    activityLoadMore.disabled = false;
  }
}

activityFilter?.addEventListener("change", renderActivity);
activityLoadMore?.addEventListener("click", loadMoreActivity);

/* =========================================================================
   COMMAND PALETTE
   ========================================================================= */
function getCommandItems() {
  const tabs = [
    { kind: "Page", label: "Overview", action: () => activateTab("overview") },
    { kind: "Page", label: "Contacts", action: () => activateTab("contacts") },
    { kind: "Page", label: "Contacts — Unread", action: () => activateTab("contacts", { filter: "unread" }) },
    { kind: "Page", label: "CMS", action: () => activateTab("cms") },
    { kind: "Page", label: "CMS — Drafts", action: () => activateTab("cms", { filter: "drafts" }) },
    { kind: "Page", label: "Uploads", action: () => activateTab("media") },
    { kind: "Page", label: "Admins", action: () => activateTab("admins") },
    {
      kind: "Action",
      label: "New CMS entry",
      action: () => {
        activateTab("cms");
        resetEditor();
        contentForm.scrollIntoView({ behavior: "smooth", block: "start" });
        contentForm.title.focus();
      },
    },
    {
      kind: "Action",
      label: "Invite admin",
      action: () => {
        activateTab("admins");
        inviteAdminBtn.click();
      },
    },
    {
      kind: "Action",
      label: "Export contacts to CSV",
      action: () => {
        activateTab("contacts");
        contactsExport.click();
      },
    },
    { kind: "Action", label: "Sign out", action: () => signOut(auth) },
  ];
  const contacts = contactsCache.map((s) => {
    const d = s.data();
    return {
      kind: "Contact",
      label: `${d.name || "Anonymous"} — ${d.email || s.id}`,
      action: () => activateTab("contacts"),
    };
  });
  const cms = ["pages", "posts", "work"].flatMap((name) =>
    collectionsCache[name].map((s) => ({
      kind: name,
      label: s.data().title || s.id,
      action: () => {
        activateTab("cms");
        loadIntoEditor(s, name);
      },
    })),
  );
  return [...tabs, ...contacts, ...cms];
}

function renderCommandResults() {
  const q = commandInput.value.trim().toLowerCase();
  const all = getCommandItems();
  commandResults = q
    ? all.filter((i) => i.label.toLowerCase().includes(q) || i.kind.toLowerCase().includes(q))
    : all;
  commandResults = commandResults.slice(0, 30);
  commandIndex = 0;
  clear(commandList);
  if (commandResults.length === 0) {
    commandList.appendChild(el("div", { class: "empty", text: "No matches." }));
    return;
  }
  commandResults.forEach((item, i) => {
    const node = el(
      "div",
      {
        class: `command-item${i === 0 ? " active" : ""}`,
        attrs: { "data-index": i },
        on: {
          click: () => {
            closeCommandPalette();
            item.action();
          },
        },
      },
      el("span", { text: item.label }),
      el("span", { class: "kind", text: item.kind }),
    );
    commandList.appendChild(node);
  });
}

function setActiveCommand(i) {
  $$(".command-item").forEach((n, idx) => n.classList.toggle("active", idx === i));
  commandIndex = i;
  const active = $$(".command-item")[i];
  active?.scrollIntoView({ block: "nearest" });
}

function openCommandPalette() {
  commandPalette.hidden = false;
  commandInput.value = "";
  renderCommandResults();
  commandInput.focus();
}
function closeCommandPalette() {
  commandPalette.hidden = true;
}

openCommand.addEventListener("click", openCommandPalette);
mobileCommand?.addEventListener("click", openCommandPalette);

commandInput.addEventListener("input", renderCommandResults);
commandInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveCommand(Math.min(commandResults.length - 1, commandIndex + 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveCommand(Math.max(0, commandIndex - 1));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const item = commandResults[commandIndex];
    if (item) {
      closeCommandPalette();
      item.action();
    }
  } else if (e.key === "Escape") {
    closeCommandPalette();
  }
});
commandPalette.addEventListener("click", (e) => {
  if (e.target === commandPalette) closeCommandPalette();
});

/* =========================================================================
   GLOBAL KEYBOARD SHORTCUTS
   ========================================================================= */
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (commandPalette.hidden) openCommandPalette();
    else closeCommandPalette();
  }
  if (event.key === "Escape") {
    if (!imagePicker.hidden) imagePicker.hidden = true;
    if (!commandPalette.hidden) closeCommandPalette();
    if (!inviteModal.hidden) inviteModal.hidden = true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    if (document.activeElement?.closest("#content-form")) {
      event.preventDefault();
      contentForm.requestSubmit();
    }
  }
});

/* =========================================================================
   AUTH LIFECYCLE
   ========================================================================= */
function teardown() {
  Object.keys(unsub).forEach((k) => {
    if (unsub[k]) unsub[k]();
    unsub[k] = null;
  });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    teardown();
    appShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    return;
  }
  let claims;
  try {
    const token = await getIdTokenResult(user, true);
    claims = token.claims;
  } catch (err) {
    setStatus(loginStatus, `Token error: ${err.message}`, "error");
    await signOut(auth);
    return;
  }
  if (!claims.admin) {
    setStatus(loginStatus, "Signed in, but this account is not an admin.", "error");
    await signOut(auth);
    return;
  }

  loginShell.classList.add("hidden");
  appShell.classList.remove("hidden");
  userChip.textContent = user.email || user.uid;
  $("#overview-greeting").textContent = `Welcome, ${(user.email || "").split("@")[0] || "there"}.`;

  let savedTab = "overview";
  try {
    savedTab = localStorage.getItem("of:admin-tab") || "overview";
  } catch {}
  activateTab(savedTab);

  subscribeContacts();
  subscribeCollection("pages");
  subscribeCollection("posts");
  subscribeCollection("work");
  subscribeMedia();
  subscribeActivity();
  loadAdmins();
});
