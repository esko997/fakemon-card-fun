// Creature Field Guide: the child invents creatures and keeps an encyclopedia page for each.
// Book kind "creature"; data = {name, entries[], conversations[], illustration, illustration_source_id}.
// Nothing is saved without an explicit tap, the child's own pictures/words/recordings are never
// changed, and the AI helper and illustration are optional extras.
import { loadShell, say } from "./shell.js";
import {
  createBook, listBooks, getBook, saveBook, assist, makeArt,
  showError, button, node, renderEntry, capture,
} from "./play.js";

const KIND = "creature";
const UNNAMED = "Unnamed creature";
const DEFAULT_QUESTION = "What do you notice about my creature?";

// Optional ideas, shown one at a time only when the child asks for one. Magic and real-world both welcome.
const IDEAS = [
  "Where does your creature live?",
  "What does it like to eat?",
  "How does it get around? Walking, swimming, flying, or something else?",
  "What is the most amazing thing about it?",
  "Does it have any magic or special powers?",
  "What sound does it make?",
  "How big is it? What is it about the same size as?",
  "What does it do when it gets sleepy?",
  "Who are its friends?",
  "How does it keep itself safe?",
  "What does it do when it is happy?",
  "Can you draw its home, or draw it from another side?",
];

const $ = (id) => document.getElementById(id);

const state = {
  view: null,           // "library" | "new" | "guide"
  book: null,           // the open Book, exactly as last returned by the server
  newCapture: null,
  addCapture: null,
  // AI results the child asked for that are not on the server yet; every save retries them.
  pending: { conversations: [], illustration: null },
  idea: null,           // {text, source: "idea" | "helper", conversation_id?}
  answering: false,     // child chose to answer the shown idea; it becomes the entry label
  busy: false,
};

// ---------- small helpers ----------

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => new Date().toISOString();
const titleFor = (name) => (name || "").trim() || UNNAMED;
const hasAnything = (r) => Boolean(r.text.trim() || r.photo || r.audio);

function normalize(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    ...d,
    name: typeof d.name === "string" ? d.name : "",
    entries: Array.isArray(d.entries) ? d.entries : [],
    conversations: Array.isArray(d.conversations) ? d.conversations : [],
    illustration: d.illustration || null,
    illustration_source_id: d.illustration_source_id || null,
  };
}

function setNotice(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function actions(...buttons) {
  const row = node("div", "actions");
  row.append(...buttons);
  return row;
}

/** Wrap a handler so two saves/AI calls never overlap. Errors still reach button()'s showError. */
function run(fn) {
  return async (...args) => {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn(...args);
    } finally {
      state.busy = false;
    }
  };
}

function spoken(entry) {
  const text = (entry.text || "").trim();
  if (!text) return "";
  return entry.label ? `${entry.label} ${text}` : text;
}

function sentence(part) {
  return /[.!?]\s*$/.test(part) ? part : `${part}.`;
}

function findPhoto(d, id) {
  return d.entries.find((e) => e.photo && e.photo.id === id)?.photo || null;
}

function firstPhoto(d) {
  return d.entries.find((e) => e.photo && e.photo.url)?.photo || null;
}

function setUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("book", id);
  else url.searchParams.delete("book");
  history.replaceState(null, "", url);
}

function show(view) {
  for (const v of ["library", "new", "guide"]) $(`${v}-view`).hidden = v !== view;
  state.view = view;
  window.scrollTo(0, 0);
}

// ---------- leaving with unsaved work ----------

const hasPending = () => state.pending.conversations.length > 0 || Boolean(state.pending.illustration);
const renameDirty = () => Boolean(state.book) && $("rename-text").value.trim() !== normalize(state.book.data).name;

function isDirty() {
  if (state.view === "new") return Boolean($("new-name").value.trim() || state.newCapture?.hasContent());
  if (state.view === "guide") return Boolean(state.addCapture?.hasContent() || renameDirty() || hasPending());
  return false;
}

function askConfirm(text, yesLabel) {
  const dlg = $("confirm-dialog");
  const yes = $("confirm-yes");
  const no = $("confirm-no");
  $("confirm-text").textContent = text;
  yes.textContent = yesLabel;
  return new Promise((resolve) => {
    const finish = (value) => {
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      dlg.removeEventListener("cancel", onCancel);
      dlg.close();
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onCancel = (e) => { e.preventDefault(); finish(false); };
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    dlg.addEventListener("cancel", onCancel);
    dlg.showModal();
    no.focus();
  });
}

async function okToLeave() {
  if (!isDirty()) return true;
  return askConfirm(
    "Some words, pictures, or helper ideas are not saved yet. Leave them behind?",
    "Leave without saving",
  );
}

function dropCaptures() {
  state.newCapture?.destroy();
  state.addCapture?.destroy();
  state.newCapture = null;
  state.addCapture = null;
  $("new-capture").replaceChildren();
  $("add-capture").replaceChildren();
}

function resetGuideState() {
  state.pending = { conversations: [], illustration: null };
  state.idea = null;
  state.answering = false;
  hideConflict();
  for (const id of ["page-notice", "guide-notice", "ask-notice"]) setNotice($(id), "");
}

// ---------- library ----------

async function showLibrary() {
  if (!(await okToLeave())) return;
  dropCaptures();
  resetGuideState();
  state.book = null;
  setUrl(null);
  show("library");
  const grid = $("library-grid");
  $("library-empty").hidden = true;
  grid.replaceChildren(node("p", "muted", "Opening your field guide..."));
  let books;
  try {
    books = await listBooks(KIND);
  } catch (error) {
    grid.replaceChildren();
    showError(error);
    return;
  }
  $("library-empty").hidden = books.length > 0;
  grid.replaceChildren(...books.map(tile));
}

function tile(book) {
  const d = normalize(book.data);
  const t = document.createElement("button");
  t.type = "button";
  t.className = "book-tile creature-tile";
  const pic = firstPhoto(d) || d.illustration;
  if (pic && pic.url) {
    const img = document.createElement("img");
    img.src = pic.url;
    img.alt = "";
    img.loading = "lazy";
    t.append(img);
  } else {
    t.append(node("span", "tile-blank", "No picture yet"));
  }
  t.append(node("strong", "", book.title || titleFor(d.name)));
  const n = d.entries.length;
  t.append(node("span", "muted", `${n} ${n === 1 ? "note" : "notes"}`));
  t.addEventListener("click", () => openBook(book.id));
  return t;
}

// ---------- a new creature ----------

async function startNew() {
  if (!(await okToLeave())) return;
  dropCaptures();
  resetGuideState();
  state.book = null;
  setUrl(null);
  show("new");
  $("new-name").value = "";
  setNotice($("new-notice"), "");
  state.newCapture = capture($("new-capture"), {
    label: "Draw it or take a photo, and tell one amazing thing about it",
    writing: true,
  });
}

function makeEntry(r, idea) {
  const entry = { id: uid(), text: r.text, photo: r.photo || null, audio: r.audio || null, created_at: now() };
  if (r.audio) entry.seconds = r.seconds;
  if (idea) {
    entry.label = idea.text;
    entry.prompt_source = idea.source;
    if (idea.conversation_id) entry.conversation_id = idea.conversation_id;
  }
  return entry;
}

async function saveNew() {
  const name = $("new-name").value.trim();
  const r = await state.newCapture.read();
  if (!name && !hasAnything(r)) {
    setNotice($("new-notice"), "Give your creature a name, or add a picture or some words first.");
    return;
  }
  const data = {
    name,
    entries: hasAnything(r) ? [makeEntry(r, null)] : [],
    conversations: [],
    illustration: null,
    illustration_source_id: null,
  };
  const book = await createBook(KIND, titleFor(name), data);
  state.newCapture.clear();
  $("new-name").value = "";
  enterGuide(book);
  setNotice($("guide-notice"), "Your creature is in your field guide. Add more, ask the helper, or finish any time.");
}

// ---------- one creature's page ----------

async function openBook(id) {
  let book;
  try {
    book = await getBook(id);
    if (book.kind !== KIND) throw new Error("That book is not a creature page.");
  } catch (error) {
    showError(error);
    if (state.view !== "library") await showLibrary();
    return;
  }
  enterGuide(book);
}

function enterGuide(book) {
  dropCaptures();
  resetGuideState();
  state.book = book;
  setUrl(book.id);
  show("guide");
  state.addCapture = capture($("add-capture"), {
    label: "Draw, write, or say something about your creature",
    writing: true,
  });
  $("rename-text").value = normalize(book.data).name;
  $("ask-text").value = "";
  renderGuide();
  renderIdea();
}

/** Save data built from the server copy + pending AI results + this change. Local state only moves on success. */
async function commit(mutate) {
  const data = normalize(structuredClone(state.book.data || {}));
  const known = new Set(data.conversations.map((c) => c.id));
  for (const c of state.pending.conversations) if (!known.has(c.id)) data.conversations.push(c);
  if (state.pending.illustration) {
    data.illustration = state.pending.illustration.asset;
    data.illustration_source_id = state.pending.illustration.source_id;
  }
  mutate(data);
  let saved;
  try {
    saved = await saveBook({ ...state.book, title: titleFor(data.name), data });
  } catch (error) {
    if (error.status === 409) showConflict();
    throw error;
  }
  state.book = saved;
  state.pending = { conversations: [], illustration: null };
  hideConflict();
  renderGuide();
  return saved;
}

function showConflict() {
  const box = $("guide-conflict");
  box.replaceChildren(
    node("p", "", "This page was changed somewhere else, maybe on another tablet. Your unsaved work is still here. Load the newest page, then save again."),
    actions(button("Load the newest page", run(reloadLatest), "mid primary")),
  );
  box.hidden = false;
}

function hideConflict() {
  const box = $("guide-conflict");
  box.hidden = true;
  box.replaceChildren();
}

async function reloadLatest() {
  const keepName = renameDirty();
  const latest = await getBook(state.book.id);
  state.book = latest;
  if (!keepName) $("rename-text").value = normalize(latest.data).name;
  hideConflict();
  renderGuide();
  setNotice($("page-notice"), "Loaded the newest page. Your unsaved work is still here, so you can save it now.");
}

function renderGuide() {
  const d = normalize(state.book.data);
  const known = new Set(d.conversations.map((c) => c.id));
  const pendingConvs = state.pending.conversations.filter((c) => !known.has(c.id));
  $("guide-name").textContent = titleFor(d.name);
  renderPictures(d);
  renderEntries(d);
  renderConversations(d.conversations, pendingConvs);
  renderPending();
}

function figure(asset, caption, className) {
  const fig = node("figure", `creature-figure ${className}`);
  const link = document.createElement("a");
  link.href = asset.url;
  link.target = "_blank";
  link.rel = "noopener";
  const img = document.createElement("img");
  img.src = asset.url;
  img.alt = caption;
  link.append(img);
  fig.append(link, node("figcaption", "", caption));
  return fig;
}

/** Original picture and AI illustration side by side, each clearly labelled. Only once an illustration exists. */
function renderPictures(d) {
  const box = $("guide-pictures");
  const pending = state.pending.illustration;
  const art = pending ? pending.asset : d.illustration;
  if (!art) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const source = findPhoto(d, pending ? pending.source_id : d.illustration_source_id);
  const figures = [];
  if (source) figures.push(figure(source, "My original picture", "original"));
  figures.push(figure(
    art,
    pending ? "Illustration made by AI from my picture (not saved yet)" : "Illustration made by AI from my picture",
    "illustration",
  ));
  box.replaceChildren(...figures);
  box.hidden = false;
}

function renderEntries(d) {
  const list = $("guide-entries");
  if (!d.entries.length) {
    list.replaceChildren(node("p", "muted", "Nothing on this page yet. Add a drawing, some words, or a recording below."));
    return;
  }
  const hasArt = Boolean(d.illustration || state.pending.illustration);
  list.replaceChildren(...d.entries.map((entry) => {
    const wrap = node("div", "creature-entry");
    wrap.append(renderEntry(entry));
    const row = node("div", "actions no-print");
    const words = spoken(entry);
    if (words) row.append(button("Read this", () => say(words)));
    if (entry.photo && entry.photo.id) {
      row.append(button(
        hasArt ? "Make a new illustration from this picture" : "Make an illustration from this picture",
        run(() => illustrate(entry.photo)),
      ));
    }
    if (row.childElementCount) wrap.append(row);
    return wrap;
  }));
}

function conversationNode(c, unsaved) {
  const el = node("div", "conversation");
  el.append(node("p", "conv-question", `Question: ${c.question}`));
  el.append(node("p", "conv-label", unsaved ? "AI helper (not saved yet)" : "AI helper"));
  el.append(node("p", "conv-answer", c.answer));
  if (c.prompt) el.append(node("p", "conv-prompt", `A question you could answer, if you like: ${c.prompt}`));
  const row = actions(button("Read this", () => say([c.answer, c.prompt].filter(Boolean).map(sentence).join(" "))));
  if (c.prompt) row.append(button("Answer this question", () => setIdea({ text: c.prompt, source: "helper", conversation_id: c.id }, true)));
  el.append(row);
  return el;
}

function renderConversations(saved, pending) {
  const box = $("guide-conversations");
  if (!saved.length && !pending.length) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    node("h2", "", "Chats with the helper"),
    ...saved.map((c) => conversationNode(c, false)),
    ...pending.map((c) => conversationNode(c, true)),
  );
}

function renderPending() {
  const box = $("guide-pending");
  if (!hasPending()) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    node("p", "", "Something the helper made is not saved yet."),
    actions(button("Try saving again", run(async () => {
      await commit(() => {});
      setNotice($("page-notice"), "Saved.");
    }), "mid primary")),
  );
  box.hidden = false;
}

// ---------- optional ideas, one at a time ----------

function nextIdea() {
  const used = new Set(normalize(state.book.data).entries.map((e) => e.label).filter(Boolean));
  const current = state.idea && state.idea.text;
  const fresh = IDEAS.filter((t) => !used.has(t) && t !== current);
  const pool = fresh.length ? fresh : IDEAS.filter((t) => t !== current);
  return pool[Math.floor(Math.random() * pool.length)];
}

function setIdea(idea, answering) {
  state.idea = idea;
  state.answering = Boolean(idea && answering);
  renderIdea();
  if (state.answering) $("idea-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderIdea() {
  const box = $("idea-panel");
  const idea = state.idea;
  if (!idea) {
    box.replaceChildren(
      node("p", "muted", "Write, draw, or say anything you like. Want an idea? Ask for one."),
      actions(button("Give me an idea", () => setIdea({ text: nextIdea(), source: "idea" }, false))),
    );
    return;
  }
  let head = "An idea, if you want it:";
  if (state.answering) head = "You are answering:";
  else if (idea.source === "helper") head = "The helper wondered (you do not have to answer):";
  box.replaceChildren(
    node("p", "idea-head", head),
    node("p", "idea-text", idea.text),
    actions(
      button("Read it to me", () => say(idea.text)),
      state.answering
        ? button("Stop answering this", () => setIdea(idea, false))
        : button("Answer this", () => setIdea(idea, true), "mid primary"),
      button("A different idea", () => setIdea({ text: nextIdea(), source: "idea" }, false)),
      button("No thanks", () => setIdea(null, false)),
    ),
  );
}

// ---------- saving, asking, illustrating ----------

async function saveEntry() {
  const r = await state.addCapture.read();
  if (!hasAnything(r)) {
    setNotice($("guide-notice"), "Add some words, a picture, or a recording first.");
    return false;
  }
  const entry = makeEntry(r, state.answering ? state.idea : null);
  await commit((d) => { d.entries.push(entry); });
  state.addCapture.clear();
  if (state.answering) setIdea(null, false);
  setNotice($("guide-notice"), "Saved on your creature page. Add more, or finish any time.");
  return true;
}

async function askHelper() {
  setNotice($("ask-notice"), "");
  if (state.addCapture.hasContent() && !(await saveEntry())) return;
  const d = normalize(state.book.data);
  if (!d.entries.length && !d.name.trim()) {
    setNotice($("ask-notice"), "Add something about your creature first, so the helper has something to look at.");
    return;
  }
  const typed = $("ask-text").value.trim();
  const question = typed || DEFAULT_QUESTION;
  setNotice($("ask-notice"), "The helper is thinking...");
  let res;
  try {
    res = await assist(state.book, question);
  } finally {
    setNotice($("ask-notice"), "");
  }
  const conv = {
    id: uid(),
    question,
    child_typed: Boolean(typed),
    answer: res.answer || "",
    prompt: res.prompt || "",
    created_at: now(),
  };
  state.pending.conversations.push(conv);
  $("ask-text").value = "";
  if (conv.prompt) setIdea({ text: conv.prompt, source: "helper", conversation_id: conv.id }, false);
  renderGuide();
  await commit(() => {});
}

async function illustrate(photo) {
  const d = normalize(state.book.data);
  if ((d.illustration || state.pending.illustration) && !(await askConfirm(
    "Make a new illustration? It takes the place of the current illustration. Your own picture always stays.",
    "Make a new one",
  ))) return;
  setNotice($("page-notice"), "Making the illustration. This can take a minute.");
  let asset;
  try {
    asset = await makeArt(state.book, photo.id);
  } finally {
    setNotice($("page-notice"), "");
  }
  state.pending.illustration = { asset, source_id: photo.id };
  renderGuide();
  await commit(() => {});
  setNotice($("page-notice"), "The illustration is saved next to your own picture.");
  $("guide-pictures").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveName() {
  const name = $("rename-text").value.trim();
  await commit((d) => { d.name = name; });
  $("rename-text").value = name;
  setNotice($("page-notice"), "Name saved.");
}

function readPage() {
  const d = normalize(state.book.data);
  const parts = [titleFor(d.name), ...d.entries.map(spoken).filter(Boolean)];
  say(parts.map(sentence).join(" "));
}

// ---------- wiring ----------

loadShell("Creature Field Guide");

$("library-actions").append(button("Invent a new creature", run(startNew), "big primary"));
$("new-actions").append(
  button("Save to my field guide", run(saveNew), "big primary"),
  button("Back to my field guide", run(showLibrary)),
);
$("page-actions").append(
  button("Read my page", readPage),
  button("Print my page", () => window.print()),
  button("I'm finished for now", run(showLibrary)),
);
$("add-actions").append(button("Save on my page", run(saveEntry), "big primary"));
$("ask-actions").append(button("Ask the helper", run(askHelper)));
$("rename-actions").append(button("Save name", run(saveName)));

window.addEventListener("beforeunload", (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});

const startId = new URLSearchParams(location.search).get("book");
if (startId) openBook(startId);
else showLibrary();
