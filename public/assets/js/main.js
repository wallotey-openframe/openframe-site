const heroImages = [
  "https://ik.imagekit.io/teiii/UC.png",
  "https://ik.imagekit.io/teiii/SAAC%20TAMALE-3%202.png",
  "https://ik.imagekit.io/teiii/KAD.png",
  "https://ik.imagekit.io/teiii/27-20%202.png",
  "https://ik.imagekit.io/teiii/KPC-44%20Large.png",
  "https://ik.imagekit.io/teiii/KPC-49%202%20Large.png",
];

const heroCaptions = [
  "Commuters on motorcycles weave through midday traffic at a busy urban intersection.",
  "Exhibition attendees view large-format historical photographs on display inside SAAC Tamale.",
  "Sea defence extends into the ocean to protect the coastline from incoming waves.",
  "Malaika performs on stage during the listening party for her album \u201c27.\u201d",
  "A laborer uses a stencil to ink export tracking codes onto a burlap sack designated as \u201cProduce of Ghana.\u201d",
  "Workers manually shovel dried cocoa beans into sacks on the floor of a processing warehouse.",
];

const heroCaption = document.getElementById("hero-caption");

const heroFrames = document.querySelectorAll(".hero-bg-frame");
let heroImageIndex = 0;
let activeHeroFrame = 0;

heroImages.slice(1).forEach((src) => {
  const image = new Image();
  image.src = src;
});

if (heroFrames.length === 2) {
  heroFrames[0].style.backgroundImage = `url("${heroImages[0]}")`;

  window.setInterval(() => {
    heroImageIndex = (heroImageIndex + 1) % heroImages.length;
    const nextFrame = activeHeroFrame === 0 ? 1 : 0;

    heroFrames[nextFrame].style.backgroundImage =
      `url("${heroImages[heroImageIndex]}")`;
    heroFrames[nextFrame].classList.add("is-active");
    heroFrames[activeHeroFrame].classList.remove("is-active");

    activeHeroFrame = nextFrame;

    if (heroCaption) {
      heroCaption.classList.add("is-fading");
      setTimeout(() => {
        heroCaption.textContent = heroCaptions[heroImageIndex];
        heroCaption.classList.remove("is-fading");
      }, 500);
    }
  }, 6500);
}

// Nav background on scroll
const nav = document.querySelector(".site-nav");
if (nav) {
  window.addEventListener(
    "scroll",
    () => {
      nav.classList.toggle("scrolled", window.scrollY > 40);
    },
    { passive: true },
  );
}

// Smooth scroll already handled by CSS, but make sure
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    if (href.length > 1 && document.querySelector(href)) {
      e.preventDefault();
      document.querySelector(href).scrollIntoView({ behavior: "smooth" });
    }
  });
});

const contactForm = document.getElementById("contact-form");
const contactStatus = document.getElementById("contact-status");
const contactTs = document.getElementById("contact-ts");

// Stamp the form-load time so the function can reject ultra-fast submissions.
if (contactTs) {
  contactTs.value = String(Date.now());
}

const FEATURED_WORK_COUNT = 4;

function buildWorkItem(item, displayNum, totalCount) {
  const link = document.createElement("a");
  const num = document.createElement("span");
  const title = document.createElement("h3");
  const client = document.createElement("div");
  const meta = document.createElement("div");
  const arrow = document.createElement("div");

  link.href = item.imageUrl?.startsWith("http") ? item.imageUrl : "#";
  link.className = "work-item";
  num.className = "work-num";
  title.className = "work-title";
  client.className = "work-client";
  meta.className = "work-meta";
  arrow.className = "work-arrow";

  num.textContent = `— ${String(displayNum).padStart(2, "0")}`;
  title.textContent = item.title || "Untitled";
  client.textContent = item.summary || "Open Frame Media";
  meta.textContent = item.body || "Published work";
  arrow.textContent = "View →";

  // If the entry has a video URL stored on imageUrl, treat it as a modal trigger
  // so it slots into the existing video player.
  if (item.imageUrl?.match(/\.(mp4|mov|webm)$/i)) {
    link.setAttribute("data-video-trigger", "");
    link.setAttribute("data-video-title", item.title || "");
    link.setAttribute("data-video-kicker", item.summary || "");
    link.setAttribute("data-video-meta-left", item.title || "");
    link.setAttribute("data-video-meta-right", item.body || "");
    link.setAttribute("data-video-desc", item.body || "");
  }

  link.append(num, title, client, meta, arrow);
  return link;
}

function updateWorkMoreToggle() {
  const extra = document.getElementById("work-list-extra");
  const wrap = document.getElementById("work-more-wrap");
  if (!extra || !wrap) return;
  const hasExtras = extra.children.length > 0;
  wrap.hidden = !hasExtras;
}

async function loadSiteContent() {
  try {
    const response = await fetch("/api/site");
    if (!response.ok) {
      updateWorkMoreToggle();
      return;
    }

    const data = await response.json();
    if (!Array.isArray(data.work) || data.work.length === 0) {
      updateWorkMoreToggle();
      return;
    }

    const workList = document.getElementById("work-list");
    const workListExtra = document.getElementById("work-list-extra");
    if (!workList) return;
    workList.innerHTML = "";
    if (workListExtra) workListExtra.innerHTML = "";

    const total = data.work.length;
    data.work.forEach((item, index) => {
      const displayNum = total - index;
      const link = buildWorkItem(item, displayNum, total);
      if (index < FEATURED_WORK_COUNT || !workListExtra) {
        workList.appendChild(link);
      } else {
        workListExtra.appendChild(link);
      }
    });

    updateWorkMoreToggle();
  } catch (error) {
    // Keep the static work list visible if the API is unavailable.
    updateWorkMoreToggle();
  }
}

// ===== More films toggle =====
const workMoreButton = document.getElementById("work-more");
const workMoreLabel = workMoreButton?.querySelector(".work-more-label");
const workListExtraEl = document.getElementById("work-list-extra");

if (workMoreButton && workListExtraEl) {
  // Initial collapsed state — inline styles win over any CSS cascade quirk.
  workListExtraEl.style.maxHeight = "0px";
  workListExtraEl.style.overflow = "hidden";

  workMoreButton.addEventListener("click", () => {
    const isOpen = workListExtraEl.classList.toggle("is-open");
    workMoreButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      // Expand to actual content height (including any margin/padding).
      workListExtraEl.style.maxHeight = workListExtraEl.scrollHeight + "px";
    } else {
      workListExtraEl.style.maxHeight = "0px";
    }
    if (workMoreLabel) {
      workMoreLabel.textContent = isOpen ? "Show less" : "More films";
    }
  });

  // Re-measure on viewport resize while open (responsive layouts).
  window.addEventListener("resize", () => {
    if (workListExtraEl.classList.contains("is-open")) {
      workListExtraEl.style.maxHeight = workListExtraEl.scrollHeight + "px";
    }
  });
}

// Update toggle visibility on initial load (in case the user has hardcoded extras).
updateWorkMoreToggle();

if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = contactForm.querySelector("button");
    const formData = Object.fromEntries(new FormData(contactForm));

    submitButton.disabled = true;
    contactStatus.classList.remove("is-success", "is-error");
    contactStatus.textContent = "Sending...";

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("The message could not be sent.");
      }

      contactForm.reset();
      contactStatus.classList.add("is-success");
      contactStatus.textContent =
        "Received. A confirmation is on its way to your inbox.";
    } catch (error) {
      contactStatus.classList.add("is-error");
      contactStatus.textContent =
        "Something went wrong. Please email hello@openframe.media.";
    } finally {
      submitButton.disabled = false;
    }
  });
}

// Case study video player
const videoModal = document.getElementById("video-modal");
const videoClose = document.querySelector(".video-modal-close");
const caseVideo = document.getElementById("case-video");
const videoKicker = document.querySelector(".video-player-kicker");
const videoTitle = document.querySelector(".video-player-title");
const videoMetaLeft = document.querySelector(".video-player-meta-left");
const videoMetaRight = document.querySelector(".video-player-meta-right");
const videoFrame = document.getElementById("video-frame");
const videoOverlayText = document.getElementById(
  "video-frame-overlay-text",
);
const videoDescMobile = document.getElementById("video-desc-mobile");

function openVideo(trigger) {
  if (!videoModal || !caseVideo) return;
  const videoSrc = trigger.getAttribute("href");
  if (videoKicker) videoKicker.textContent = trigger.dataset.videoKicker;
  if (videoTitle) videoTitle.textContent = trigger.dataset.videoTitle;
  if (videoMetaLeft) videoMetaLeft.textContent = trigger.dataset.videoMetaLeft;
  if (videoMetaRight) videoMetaRight.textContent = trigger.dataset.videoMetaRight;
  const desc = trigger.dataset.videoDesc || "";
  if (videoOverlayText) videoOverlayText.textContent = desc;
  if (videoDescMobile) videoDescMobile.textContent = desc;
  videoFrame?.classList.remove("desc-visible");

  if (caseVideo.getAttribute("src") !== videoSrc) {
    caseVideo.setAttribute("src", videoSrc);
    caseVideo.load();
  }

  videoModal.classList.add("open");
  document.body.style.overflow = "hidden";
  caseVideo.currentTime = 0;
  caseVideo.play().catch(() => {});
}

function closeVideo() {
  videoModal?.classList.remove("open");
  videoFrame?.classList.remove("desc-visible");
  caseVideo?.pause();
  document.body.style.overflow = "";
}

// Tap-to-toggle overlay on touch devices
const videoFrameOverlay = document.getElementById("video-frame-overlay");
if (videoFrameOverlay && videoFrame) {
  videoFrameOverlay.addEventListener("click", (e) => {
    e.stopPropagation();
    videoFrame.classList.toggle("desc-visible");
  });
}

// Delegated so dynamically-added items (CMS, "More films" reveal) work too.
if (videoModal) {
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-video-trigger]");
    if (!trigger) return;
    e.preventDefault();
    openVideo(trigger);
  });

  videoModal.addEventListener("click", (e) => {
    if (e.target === videoModal) closeVideo();
  });
}

videoClose?.addEventListener("click", closeVideo);

// Mobile menu toggle
const navToggle = document.querySelector(".nav-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileClose = document.querySelector(".mobile-menu-close");

function openMenu() {
  mobileMenu?.classList.add("open");
  navToggle?.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

function closeMenu() {
  mobileMenu?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

if (navToggle && mobileMenu) {
  navToggle.addEventListener("click", () => {
    mobileMenu.classList.contains("open") ? closeMenu() : openMenu();
  });

  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

mobileClose?.addEventListener("click", closeMenu);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (videoModal?.classList.contains("open")) closeVideo();
  if (mobileMenu?.classList.contains("open")) closeMenu();
});

loadSiteContent();
