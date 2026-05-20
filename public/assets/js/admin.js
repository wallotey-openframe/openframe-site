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
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const contentForm = document.querySelector("#content-form");
const uploadForm = document.querySelector("#upload-form");
const contentStatus = document.querySelector("#content-status");
const uploadStatus = document.querySelector("#upload-status");

let currentUser = null;

function setStatus(node, message) {
  node.textContent = message;
}

function formatDate(value) {
  if (!value?.toDate) return "No date";
  return value.toDate().toLocaleString();
}

function itemTemplate(docSnap) {
  const data = docSnap.data();
  const title = data.title || data.name || data.email || docSnap.id;
  return `
    <article class="item" data-id="${docSnap.id}">
      <strong>${title}</strong>
      <small>${docSnap.id} / ${data.status || formatDate(data.createdAt)}</small>
      <p>${data.summary || data.message || data.body || ""}</p>
    </article>
  `;
}

async function loadContacts() {
  const list = document.querySelector("#contacts-list");
  list.innerHTML = "Loading...";
  const snapshot = await getDocs(
    query(collection(db, "contacts"), orderBy("createdAt", "desc")),
  );
  list.innerHTML = snapshot.empty
    ? '<article class="item">No submissions yet.</article>'
    : snapshot.docs.map(itemTemplate).join("");
}

async function loadCollection(name, selector) {
  const list = document.querySelector(selector);
  list.innerHTML = "Loading...";
  const snapshot = await getDocs(query(collection(db, name), orderBy("updatedAt", "desc")));
  list.innerHTML = snapshot.empty
    ? '<article class="item">No entries yet.</article>'
    : snapshot.docs.map(itemTemplate).join("");

  list.querySelectorAll(".item[data-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const docSnap = snapshot.docs.find((entry) => entry.id === item.dataset.id);
      const data = docSnap.data();
      contentForm.collection.value = name;
      contentForm.id.value = docSnap.id;
      contentForm.title.value = data.title || "";
      contentForm.status.value = data.status || "draft";
      contentForm.summary.value = data.summary || "";
      contentForm.body.value = data.body || "";
      contentForm.imageUrl.value = data.imageUrl || "";
      contentForm.sortOrder.value = data.sortOrder || 0;
      window.scrollTo({ top: contentForm.offsetTop - 40, behavior: "smooth" });
    });
  });
}

async function loadContent() {
  await Promise.all([
    loadCollection("pages", "#pages-list"),
    loadCollection("posts", "#posts-list"),
    loadCollection("work", "#work-list"),
  ]);
}

async function loadMedia() {
  const list = document.querySelector("#media-list");
  list.innerHTML = "Loading...";
  const snapshot = await getDocs(query(collection(db, "media"), orderBy("createdAt", "desc")));
  list.innerHTML = snapshot.empty
    ? '<article class="item">No uploads yet.</article>'
    : snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const preview = data.type?.startsWith("image/")
            ? `<img src="${data.url}" alt="${data.name}" />`
            : "<div></div>";
          return `
            <article class="item">
              ${preview}
              <div>
                <strong>${data.name}</strong>
                <small>${formatDate(data.createdAt)}</small>
                <p><a href="${data.url}" target="_blank" rel="noreferrer">Open file</a></p>
              </div>
            </article>
          `;
        })
        .join("");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginStatus, "Signing in...");
  const formData = Object.fromEntries(new FormData(loginForm));

  try {
    await signInWithEmailAndPassword(auth, formData.email, formData.password);
    setStatus(loginStatus, "");
  } catch (error) {
    setStatus(loginStatus, "Sign in failed. Check the email and password.");
  }
});

document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));
document.querySelector("#refresh-contacts").addEventListener("click", loadContacts);
document.querySelector("#refresh-content").addEventListener("click", loadContent);
document.querySelector("#refresh-media").addEventListener("click", loadMedia);

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#tab-${button.dataset.tab}`).classList.add("active");
  });
});

contentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(contentStatus, "Saving...");
  const data = Object.fromEntries(new FormData(contentForm));
  const collectionName = data.collection;
  const id = data.id.trim();

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
        updatedBy: currentUser.uid,
      },
      { merge: true },
    );
    setStatus(contentStatus, "Saved.");
    await loadContent();
  } catch (error) {
    setStatus(contentStatus, "Could not save this entry.");
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = uploadForm.file.files[0];
  if (!file) return;

  setStatus(uploadStatus, "Uploading...");
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
  const path = `cms/uploads/${currentUser.uid}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);

  try {
    await uploadBytes(fileRef, file, { contentType: file.type });
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
    setStatus(uploadStatus, "Uploaded.");
    await loadMedia();
  } catch (error) {
    setStatus(uploadStatus, "Upload failed.");
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    dashboard.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    return;
  }

  const token = await getIdTokenResult(user, true);
  if (!token.claims.admin) {
    setStatus(loginStatus, "Signed in, but this account is not an admin.");
    await signOut(auth);
    return;
  }

  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  await Promise.all([loadContacts(), loadContent(), loadMedia()]);
});
