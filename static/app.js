import { renderCard, fitCard, attachShine, cardSpeech, h } from "./card.js";

const $ = (id) => document.getElementById(id);

const STEP_TEXT = {
  listening: "👂 Listening to your story…",
  inventing: "💡 Inventing its powers…",
  painting: "🎨 Painting your Fakemon…",
  done: "✨ Almost there…",
};
const MAX_RECORD_SECONDS = 120;

let status = { kid_name: "Trainer", cards_left_today: 0, daily_limit: 0, budget_ok: true };
let current = null;          // card JSON shown in making/view
let screen = "home";
let watcher = null;          // polling timer for a working card

// ---------------------------------------------------------------- helpers

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.detail || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function ask(text, { yes = "Yes!", no = "No" } = {}) {
  const dlg = $("ask");
  $("ask-text").textContent = text;
  $("ask-yes").textContent = yes;
  $("ask-no").textContent = no;
  $("ask-no").hidden = no == null;
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    $("ask-yes").onclick = () => done(true);
    $("ask-no").onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}
const tell = (text) => ask(text, { yes: "OK", no: null });

function say(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

const OUT_OF_CARDS = "Ask Mom and Dad for more cards! 🙏";
const TOP_UP_COUNT = 5;

/** At 0 cards left. With a PARENT_PIN configured, a grown-up can add more right on the tablet. */
async function outOfCards() {
  if (!status.pin_required) return tell(OUT_OF_CARDS);
  if (await ask(OUT_OF_CARDS, { yes: "OK", no: "🔑" })) return;
  const pin = await askPin();
  if (pin == null) return;
  try {
    await api("/api/top-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: TOP_UP_COUNT, pin }),
    });
    await refreshStatus();
    tell(`⭐ ${TOP_UP_COUNT} more cards! Have fun!`);
  } catch (err) {
    tell(err.status === 403 ? "That's not the right PIN 🔒" : "Oops! Try again?");
  }
}

function askPin() {
  const dlg = $("pin-dlg");
  const input = $("pin-input");
  input.value = "";
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    $("pin-ok").onclick = () => done(input.value);
    $("pin-cancel").onclick = () => done(null);
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
    input.focus();
  });
}

/** Tell the kid why a request failed. */
function explain(err, fallback) {
  if (err.status === 429) return outOfCards();
  if (err.status === 402) return tell("The card machine needs a grown-up 🔧");
  if (err.status == null) return tell("📡 I couldn't reach the card machine. Try again!");
  return tell(fallback);
}

// Failures the server never saw (e.g. an upload that died on the way) are reported back so they
// show up on the grown-ups page. Kept in localStorage until the server accepts them.
const ERR_KEY = "fakemon-client-errors";

function reportError(where, err, extra = {}) {
  const entry = {
    at: new Date().toISOString(), where, name: err?.name, message: String(err?.message || err),
    status: err?.status ?? null, online: navigator.onLine, ua: navigator.userAgent, ...extra,
  };
  const queue = JSON.parse(localStorage.getItem(ERR_KEY) || "[]").concat(entry).slice(-20);
  localStorage.setItem(ERR_KEY, JSON.stringify(queue));
  flushErrors();
}

async function flushErrors() {
  const queue = JSON.parse(localStorage.getItem(ERR_KEY) || "[]");
  if (!queue.length) return;
  try {
    const res = await fetch("/api/client-errors", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(queue),
    });
    if (res.ok) localStorage.removeItem(ERR_KEY);
  } catch { /* still offline; next page load retries */ }
}

const blobInfo = (b) => b && { type: b.type, size: b.size };

async function refreshStatus() {
  try {
    status = await api("/api/status");
  } catch {
    $("stars").textContent = "📡 …";
    return;
  }
  $("stars").textContent = `⭐ ${status.cards_left_today} left today`;
}

function stopWatching() {
  clearTimeout(watcher);
  watcher = null;
}

/** Poll a card until it stops working; onChange gets every update. */
function watch(cardId, onChange) {
  stopWatching();
  const tick = async () => {
    try {
      const card = await api(`/api/cards/${cardId}`);
      current = card;
      onChange(card);
      if (card.status === "working") watcher = setTimeout(tick, 2000);
    } catch {
      watcher = setTimeout(tick, 4000);
    }
  };
  watcher = setTimeout(tick, 1500);
}

// ---------------------------------------------------------------- navigation

const enter = {
  home: () => { $("home-msg").textContent = status.budget_ok ? "" : "The card machine needs a grown-up 🔧"; },
  snap: startSnap,
  talk: startTalk,
  binder: loadBinder,
};
const leave = {
  snap: stopCamera,
  talk: stopRecording,
};

/**
 * Switch screens. Every switch is a history entry so Android's back button/gesture moves back a
 * screen instead of leaving the app. `history`: "push" (default), "replace", or "none".
 */
function show(name, { history: mode = "push" } = {}) {
  if (screen !== name) leave[screen]?.();
  if (name !== "making" && name !== "view") stopWatching();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  screen = name;
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === name);
  if (mode === "push" && history.state?.screen !== name) history.pushState({ screen: name }, "", `#${name}`);
  else if (mode === "replace") history.replaceState({ screen: name }, "", `#${name}`);
  enter[name]?.();
  refreshStatus();
}

let draft = false;   // true from "Make a new card" until the card is submitted

window.addEventListener("popstate", (e) => {
  const target = e.state?.screen || "home";
  const none = { history: "none" };
  if (target === "view" && current?.status === "ready") return showCard(current, none);
  if (target === "binder") return show("binder", none);
  if (target === "snap" && draft) return show("snap", none);
  if (target === "talk" && draft && drawingBlob) return show("talk", none);
  // A finished draft or a card being made isn't somewhere to go back to; the binder shows it.
  show("home", { history: target === "home" ? "none" : "replace" });
});

document.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]")?.dataset.go;
  if (!go) return;
  if (go === "snap") {
    await refreshStatus();
    if (!status.budget_ok) return tell("The card machine needs a grown-up 🔧");
    if (status.cards_left_today <= 0) return outOfCards();
    draft = true;
  }
  show(go);
});

function failureMessage(kind) {
  if (kind === "out_of_credits") return "The card machine needs a grown-up 🔧";
  if (kind === "art_blocked") return "The painter got confused! Try again for a different picture 🎨";
  return "Oops! The card machine got confused.";
}

// ---------------------------------------------------------------- 1. snap the drawing

let camStream = null;
let facing = "environment";
let drawingBlob = null;

async function startSnap() {
  drawingBlob = null;
  $("snap-preview").hidden = true;
  $("snap-live").hidden = false;
  $("snap-done").hidden = true;
  await startCamera();
}

async function startCamera() {
  stopCamera();
  const msg = $("cam-msg");
  msg.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    msg.textContent = "Tap 🖼️ to take a photo of your drawing.";
    msg.hidden = false;
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    const video = $("video");
    video.srcObject = camStream;
    // Mirror only the selfie camera preview; the captured picture is never mirrored.
    video.style.transform = facing === "user" ? "scaleX(-1)" : "";
    await video.play().catch(() => {});
  } catch {
    msg.textContent = "I can't see! Tap 🖼️ to take a photo instead.";
    msg.hidden = false;
  }
}

function stopCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
}

function showSnapped(blob) {
  drawingBlob = blob;
  const img = $("snap-preview");
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  img.hidden = false;
  $("snap-live").hidden = true;
  $("snap-done").hidden = false;
  stopCamera();
}

$("shutter").onclick = () => {
  const video = $("video");
  if (!camStream || !video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => blob && showSnapped(blob), "image/jpeg", 0.92);
};
/**
 * A picked or camera-app photo is a reference to a file that Android can change or revoke before
 * upload (Chrome then fails the request outright). Decode it now and keep a downscaled copy.
 */
async function photoCopy(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9));
  } catch (err) {
    // Not decodable here (unusual format): keep the original bytes and let the server convert them.
    reportError("photo-decode", err, { file: blobInfo(file) });
    return new Blob([await file.arrayBuffer()], { type: file.type });
  }
}

$("pick-photo").onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    showSnapped(await photoCopy(file));
  } catch (err) {
    reportError("photo-read", err, { file: blobInfo(file) });
    tell("I couldn't open that picture. Try taking it again! 📷");
  }
};
$("flip-cam").onclick = () => {
  facing = facing === "environment" ? "user" : "environment";
  startCamera();
};
$("snap-again").onclick = startSnap;
$("snap-ok").onclick = () => drawingBlob && show("talk");

// ---------------------------------------------------------------- 2. tell the story

let recorder = null;
let micStream = null;
let chunks = [];
let recStart = 0;
let recTimer = null;
let audioBlob = null;
let audioSeconds = 0;
let discardRecording = false;

function startTalk() {
  const img = $("talk-drawing");
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(drawingBlob);
  audioBlob = null;
  $("talk-done").hidden = true;
  $("rec-time").textContent = "Tap the microphone and talk!";
  $("mic").textContent = "🎤";
}

/** Leaving the talk screen mid-recording throws the half-finished recording away. */
function stopRecording() {
  if (recorder?.state !== "recording") return;
  discardRecording = true;
  recorder.stop();
}

$("say-hint").onclick = () =>
  say("Tell me about your Fakemon! What's its name? What does it look like? What are its powers and attacks? " +
      "Where does it live? If it's an Item card or a Supporter card, just say so!");

let micStarting = false;   // a second tap while the permission prompt is open must not start two recorders

$("mic").onclick = async () => {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  if (micStarting) return;
  micStarting = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    tell("I can't hear you! Ask a grown-up to turn on the microphone 🎤");
    return;
  } finally {
    micStarting = false;
  }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((m) => window.MediaRecorder?.isTypeSupported(m));
  recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : {});
  chunks = [];
  discardRecording = false;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    clearInterval(recTimer);
    micStream.getTracks().forEach((t) => t.stop());
    $("mic").classList.remove("recording");
    $("mic").textContent = "🎤";
    if (discardRecording) return;
    audioSeconds = (Date.now() - recStart) / 1000;
    if (audioSeconds < 1.5) {
      $("rec-time").textContent = "Tap the microphone and tell me more!";
      return;
    }
    audioBlob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
    $("rec-time").textContent = "Great story! 🎉  (Tap 🎤 to say it again)";
    $("talk-done").hidden = false;
  };
  recorder.start();
  recStart = Date.now();
  $("mic").classList.add("recording");
  $("mic").textContent = "⏹️";
  $("talk-done").hidden = true;
  const tick = () => {
    const secs = Math.floor((Date.now() - recStart) / 1000);
    $("rec-time").textContent = `🔴 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}  (tap ⏹️ when done)`;
    if (secs >= MAX_RECORD_SECONDS) recorder.stop();
  };
  tick();
  recTimer = setInterval(tick, 500);
};

$("play-story").onclick = () => {
  if (!audioBlob) return;
  const audio = new Audio(URL.createObjectURL(audioBlob));
  audio.onended = () => URL.revokeObjectURL(audio.src);
  audio.play();
};

$("make").onclick = async () => {
  if (!drawingBlob || !audioBlob) return;
  const form = new FormData();
  form.append("drawing", drawingBlob, "drawing.jpg");
  const ext = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", audioBlob, `story.${ext}`);
  form.append("audio_seconds", String(audioSeconds));
  $("make").disabled = true;
  try {
    const card = await api("/api/cards", { method: "POST", body: form });
    draft = false;
    showMaking(card);
  } catch (err) {
    reportError("make-card", err, { drawing: blobInfo(drawingBlob), audio: blobInfo(audioBlob), audioSeconds });
    await explain(err, "Oops! Something went wrong. Try again?");
  } finally {
    $("make").disabled = false;
  }
};

// ---------------------------------------------------------------- 3. making

function showMaking(card) {
  current = card;
  show("making");
  $("making-drawing").src = card.drawing_url;
  updateMaking(card);
  if (card.status === "working") watch(card.id, updateMaking);
}

function updateMaking(card) {
  if (screen !== "making") return;
  const failed = card.status === "failed";
  $("making-failed").hidden = !failed;
  $("making-msg").textContent = failureMessage(card.error_kind);
  $("making-step").textContent = failed ? "😵" : STEP_TEXT[card.step] || STEP_TEXT.done;
  if (card.status === "ready") showCard(card, { reveal: true });
}

$("retry").onclick = async () => {
  try {
    showMaking(await api(`/api/cards/${current.id}/retry`, { method: "POST" }));
  } catch (err) {
    explain(err, "Still stuck! Ask a grown-up to check the card machine 🔧");
  }
};

// ---------------------------------------------------------------- 4. the card

function showCard(card, { reveal = false, history: mode } = {}) {
  current = card;
  // Coming from the making screen, replace it: going back shouldn't land on a finished "making".
  if (screen !== "view") show("view", { history: mode ?? (screen === "making" ? "replace" : "push") });
  const el = renderCard(card, { kidName: status.kid_name, onAttack: newAttack, flipped: reveal });
  el.addEventListener("click", () => el.classList.toggle("flipped"));
  attachShine(el);
  const slot = $("card-slot");
  slot.replaceChildren(el);
  requestAnimationFrame(() => fitCard(el));
  const busy = card.status === "working";
  $("new-art").disabled = busy;
  const tip = card.stats.card_type === "pokemon"
    ? "Tap the card to flip it • Tap an attack to change it"
    : "Tap the card to flip it";
  $("view-tip").textContent = busy ? "🎨 Painting a new picture…" : tip;
  if (reveal) {
    slot.classList.remove("reveal");
    void slot.offsetWidth; // restart the animation
    slot.classList.add("reveal");
    setTimeout(() => el.classList.remove("flipped"), 900);
  }
  if (busy) {
    watch(card.id, (c) => {
      if (screen !== "view" || c.status === "working") return;
      showCard(c, { reveal: !c.error });
      if (c.error) tell(c.error_kind === "out_of_credits" ? failureMessage(c.error_kind) : "The new picture didn't work. Try again later!");
    });
  }
}

async function openCard(card) {
  if (card.status === "ready") showCard(card);
  else showMaking(card);
}

async function newAttack(index) {
  if (current.status !== "ready") return;
  const attack = current.stats.attacks[index];
  if (!(await ask(`Make a new attack instead of “${attack.name}”?`))) return;
  $("view-tip").textContent = "🎲 Thinking of a new attack…";
  try {
    showCard(await api(`/api/cards/${current.id}/attacks/${index}/new`, { method: "POST" }));
  } catch (err) {
    $("view-tip").textContent = "";
    explain(err, "Oops! Try again?");
  }
}

$("read-card").onclick = () => current?.stats && say(cardSpeech(current));

$("new-art").onclick = async () => {
  if (!(await ask("Paint a brand new picture? It uses one of today's ⭐"))) return;
  try {
    showCard(await api(`/api/cards/${current.id}/new-art`, { method: "POST" }));
  } catch (err) {
    explain(err, "Oops! Try again?");
  }
};

$("put-away").onclick = async () => {
  if (!(await ask("Put this card away?"))) return;
  await api(`/api/cards/${current.id}/hide`, { method: "POST" });
  show("binder");
};

// ---------------------------------------------------------------- binder + printing

let selecting = false;
const selected = new Set();

function updatePrintBar() {
  $("binder").classList.toggle("selecting", selecting);
  $("print-bar").hidden = !selecting;
  $("print-mode").textContent = selecting ? "✖️ Cancel" : "🖨️ Print";
  $("print-count").textContent = selected.size ? `${selected.size} card${selected.size > 1 ? "s" : ""}` : "Tap cards to print";
  $("print-go").disabled = selected.size === 0;
}

async function loadBinder() {
  selecting = false;
  selected.clear();
  updatePrintBar();
  const grid = $("grid");
  let cards;
  try {
    cards = await api("/api/cards");
  } catch {
    grid.replaceChildren(h("p", { class: "msg" }, "📡 Can't reach the card machine."));
    return;
  }
  if (!cards.length) {
    grid.replaceChildren(h("p", { class: "msg" }, "No cards yet! Tap 🏠 and make one ✏️"));
    return;
  }
  grid.replaceChildren(...cards.map(tile));
  requestAnimationFrame(() => grid.querySelectorAll(".card").forEach(fitCard));
}

function tile(card) {
  const ready = card.status === "ready" && card.stats;
  const el = ready
    ? h("div", { class: "tile" }, renderCard(card, { kidName: status.kid_name }))
    : h("div", { class: "tile placeholder" },
        h("img", { src: card.drawing_url, alt: "" }),
        h("span", {}, card.status === "working" ? "🎨 Making…" : "😵 Oops! Tap to fix"));
  el.onclick = () => {
    if (!selecting) return openCard(card);
    if (!ready) return;
    if (selected.has(card.id)) selected.delete(card.id);
    else selected.add(card.id);
    el.classList.toggle("selected", selected.has(card.id));
    el.querySelector(".check")?.remove();
    if (selected.has(card.id)) el.append(h("span", { class: "check" }, "✓"));
    updatePrintBar();
  };
  return el;
}

$("print-mode").onclick = () => {
  selecting = !selecting;
  selected.clear();
  document.querySelectorAll(".tile.selected").forEach((t) => { t.classList.remove("selected"); t.querySelector(".check")?.remove(); });
  updatePrintBar();
};
$("print-go").onclick = () => {
  location.href = `print.html?ids=${[...selected].join(",")}`;
};

// ---------------------------------------------------------------- boot

refreshStatus().then(() => show(location.hash === "#binder" ? "binder" : "home", { history: "replace" }));
flushErrors();
