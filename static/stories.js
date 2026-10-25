// Story Director: the child makes up a story one page at a time. Each page keeps the child's
// own drawing/writing photo, typed words and spoken telling exactly as saved; typed words can
// be changed later on purpose, but the first typed words stay in original_text. Sound effects
// are their own pages (kind "sound") so they never get mixed into the telling. The story
// helper is optional and only ever asks one question; it never writes the story.
import { loadShell, say } from "./shell.js";
import {
  assist, button, capture, createBook, getBook, listBooks, node, renderEntry, saveBook, showError,
} from "./play.js";

const $ = (id) => document.getElementById(id);
const KIND = "story";
const SHOWN_IDEAS = 4;
const DEFAULT_TITLE = "My story";
const DEFAULT_QUESTION = "Can you ask me one question that might help me think about my story?";

// Small, original story ingredients. The child can pick any, none, or use their own idea.
const IDEAS = {
  character: [
    "a sleepy dragon who is scared of the dark",
    "a robot who wants to learn to whistle",
    "a snail who is in a big hurry",
    "a cloud that rains lemonade",
    "a cat who flies a rocket",
    "a tiny giant",
    "a grumpy pirate parrot",
    "a mouse who builds machines",
    "a shy monster under the stairs",
    "a friendly ghost who loves pancakes",
    "a turtle with a jet pack",
    "a penguin who got lost",
  ],
  place: [
    "under the sea",
    "on the moon",
    "in a library at night",
    "in a castle made of ice",
    "in a forest where the trees whisper",
    "on a pirate ship in the sky",
    "inside a giant's pocket",
    "in a busy city of bugs",
    "at the top of a volcano",
    "in a bakery that never closes",
    "on a train that goes everywhere",
    "in a backyard jungle",
  ],
  spark: [
    "something important goes missing",
    "a door appears that was never there before",
    "it starts snowing inside",
    "a map arrives in the mail",
    "the moon will not come up",
    "an egg starts to wiggle",
    "everyone forgets how to laugh",
    "a storm turns everything upside down",
    "a new friend needs help getting home",
    "the colors start running away",
    "a strange sound comes from the basement",
    "a wish comes true in the wrong way",
  ],
};
const IDEA_GROUPS = [
  ["character", "pick-character", "Who is it about?"],
  ["place", "pick-place", "Where does it happen?"],
  ["spark", "pick-spark", "What surprise starts it?"],
];

await loadShell("Story Director");

const state = {
  book: null,          // the open Book, always as last returned by the server
  view: null,
  readIndex: 0,        // 0 = cover, 1..n = pages
  editDrafts: new Map(), // page id -> typed words being changed (not saved yet)
  shownAnswerId: null, // conversation id currently shown in the helper answer box
};
const setup = { picks: {}, shown: {} };
// Persistent captures for the open book: kept until a save succeeds or the book is closed.
let session = null;
// Saves run one after another so each starts from the newest revision.
let saveChain = Promise.resolve();
let readerAudio = null;

// ---------------------------------------------------------------- helpers

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeData(data) {
  const d = data && typeof data === "object" ? data : {};
  if (!Array.isArray(d.pages)) d.pages = [];
  if (!Array.isArray(d.conversations)) d.conversations = [];
  return d;
}

const pages = (book = state.book) => (Array.isArray(book?.data?.pages) ? book.data.pages : []);
const isSound = (page) => page.kind === "sound";
const bookTitle = (book) => (book.title || "").trim() || DEFAULT_TITLE;

function ideasText(ingredients) {
  const picked = IDEA_GROUPS.map(([key]) => ingredients?.[key]).filter(Boolean);
  return picked.length ? `Story ideas: ${picked.join(", ")}` : "";
}

function countText(list) {
  const sounds = list.filter(isSound).length;
  const scenes = list.length - sounds;
  const parts = [`${scenes} ${scenes === 1 ? "page" : "pages"}`];
  if (sounds) parts.push(`${sounds} ${sounds === 1 ? "sound" : "sounds"}`);
  return parts.join(", ");
}

function dateText(iso) {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "" : `Last changed ${when.toLocaleDateString()}`;
}

/** button() from play.js plus a data-action hook for tests and styling. */
function act(action, label, handler, className = "mid") {
  const b = button(label, handler, className);
  b.dataset.action = action;
  return b;
}

function show(view) {
  for (const s of document.querySelectorAll(".story-view")) s.hidden = s.id !== `${view}-view`;
  state.view = view;
  stopPlayback();
  window.scrollTo(0, 0);
}

function setRoute(bookId, mode = null) {
  const url = new URL(location.href);
  url.search = "";
  if (bookId) {
    url.searchParams.set("book", bookId);
    if (mode === "edit") url.searchParams.set("view", "edit");
  }
  history.replaceState(null, "", url);
}

function sample(list, n) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function notice(id, text) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
}

/**
 * Apply a change to a copy of the open book and save it. state.book only changes when the
 * server accepts the save, so a failed save never loses what is on screen.
 */
function commit(change, bookId = state.book?.id) {
  const run = saveChain.then(async () => {
    if (!state.book || state.book.id !== bookId) {
      throw new Error("This story was closed before it could be saved.");
    }
    const next = structuredClone(state.book);
    next.data = normalizeData(next.data);
    change(next.data, next);
    try {
      const saved = await saveBook(next);
      saved.data = normalizeData(saved.data);
      if (state.book?.id === bookId) state.book = saved;
    } catch (err) {
      if (err.status === 409) $("conflict-notice").hidden = false;
      throw err;
    }
    $("conflict-notice").hidden = true;
    return state.book;
  });
  saveChain = run.catch(() => {});
  return run;
}

function hasDraft() {
  if (state.editDrafts.size) return true;
  return Boolean(session && (session.scene.hasContent() || session.sound.hasContent()));
}

function confirmLeave() {
  const dlg = $("leave-dialog");
  return new Promise((resolve) => {
    const done = (answer) => {
      $("leave-stay").onclick = null;
      $("leave-go").onclick = null;
      dlg.oncancel = null;
      dlg.close();
      resolve(answer);
    };
    $("leave-stay").onclick = () => done(false);
    $("leave-go").onclick = () => done(true);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

/** Typed-word notes shown under a page: hard-to-read words, and the first typed words. */
function pageNotes(page, { hint = false, original = true } = {}) {
  const notes = [];
  if (hint && (page.text || "").includes("[unclear]")) {
    notes.push(node("p", "muted", "Some words were hard to read. You can change the typed words if you want."));
  }
  if (original && page.original_text && page.original_text !== page.text) {
    const box = node("div", "original");
    box.append(node("p", "muted", "First typed words:"), node("p", "", page.original_text));
    notes.push(box);
  }
  return notes;
}

function kindTag(page) {
  return isSound(page) ? [node("p", "story-kind", "Sound effect")] : [];
}

// ---------------------------------------------------------------- library

async function showLibrary() {
  show("library");
  setRoute(null);
  const list = $("library-list");
  $("library-empty").hidden = true;
  list.replaceChildren(node("p", "muted", "Getting your stories..."));
  let books;
  try {
    books = await listBooks(KIND);
  } catch (err) {
    list.replaceChildren(act("retry-library", "Try again", showLibrary));
    showError(err);
    return;
  }
  if (state.view !== "library") return;
  list.replaceChildren(...books.map(bookTile));
  $("library-empty").hidden = books.length > 0;
}

function bookTile(book) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "book-tile story-tile";
  tile.dataset.bookId = book.id;
  tile.append(node("strong", "", bookTitle(book)), node("span", "muted", countText(pages(book))));
  const when = dateText(book.updated_at);
  if (when) tile.append(node("span", "muted", when));
  tile.addEventListener("click", () => openBook(book.id));
  return tile;
}

async function goLibrary() {
  if (await closeBook()) await showLibrary();
}

/** Close the open book, asking first if there is unsaved work. */
async function closeBook() {
  if (hasDraft() && !(await confirmLeave())) return false;
  endSession();
  state.book = null;
  return true;
}

// ---------------------------------------------------------------- new story

function startSetup() {
  setup.picks = { character: null, place: null, spark: null };
  $("new-title").value = "";
  shuffleIdeas();
  show("setup");
}

function shuffleIdeas() {
  for (const [key] of IDEA_GROUPS) {
    const keep = setup.picks[key];
    const others = IDEAS[key].filter((idea) => idea !== keep);
    setup.shown[key] = keep ? [keep, ...sample(others, SHOWN_IDEAS - 1)] : sample(others, SHOWN_IDEAS);
  }
  renderIdeas();
}

function renderIdeas() {
  for (const [key, id] of IDEA_GROUPS) {
    $(id).replaceChildren(...setup.shown[key].map((idea) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mid story-chip";
      chip.dataset.idea = key;
      chip.textContent = idea;
      chip.setAttribute("aria-pressed", String(setup.picks[key] === idea));
      chip.addEventListener("click", () => {
        setup.picks[key] = setup.picks[key] === idea ? null : idea;
        renderIdeas();
      });
      return chip;
    }));
  }
}

async function hearIdeas() {
  say(IDEA_GROUPS.map(([key, , question]) => `${question} ${setup.shown[key].join(". ")}.`).join(" "));
}

async function startStory(useIdeas) {
  const ingredients = { character: null, place: null, spark: null };
  if (useIdeas) Object.assign(ingredients, setup.picks);
  const ownIdea = !Object.values(ingredients).some(Boolean);
  const title = $("new-title").value.trim() || DEFAULT_TITLE;
  const book = await createBook(KIND, title, { ingredients, own_idea: ownIdea, pages: [], conversations: [] });
  enterBook(book, "edit");
}

// ---------------------------------------------------------------- open a story

async function openBook(id, mode = null) {
  let book;
  try {
    book = await getBook(id);
  } catch (err) {
    showError(err);
    if (!state.book) await showLibrary();
    return;
  }
  if (state.book && state.book.id !== book.id && !(await closeBook())) return;
  enterBook(book, mode);
}

function enterBook(book, mode) {
  if (session && session.bookId !== book.id) endSession();
  book.data = normalizeData(book.data);
  state.book = book;
  if (mode === "edit" || pages(book).length === 0) showEditor();
  else showReader(0);
}

// ---------------------------------------------------------------- editor

function ensureSession() {
  if (session && session.bookId === state.book.id) return;
  endSession();
  session = {
    bookId: state.book.id,
    scene: capture($("scene-capture"), { label: "My page: words, drawing and telling", writing: true }),
    sound: capture($("sound-capture"), { label: "My sound effect" }),
  };
  state.editDrafts.clear();
  state.shownAnswerId = null;
  $("title-input").value = state.book.title || "";
  $("scene-label").value = "";
  $("sound-label").value = "";
  $("helper-question").value = "";
  $("helper-answer").replaceChildren();
  $("helper-answer").hidden = true;
  $("conflict-notice").hidden = true;
  notice("scene-notice", "");
  notice("sound-notice", "");
}

function endSession() {
  if (session) {
    session.scene.destroy();
    session.sound.destroy();
    session = null;
  }
  state.editDrafts.clear();
  $("scene-capture").replaceChildren();
  $("sound-capture").replaceChildren();
}

function showEditor() {
  ensureSession();
  renderEditor();
  show("editor");
  setRoute(state.book.id, "edit");
}

function renderEditor() {
  $("editor-title").textContent = bookTitle(state.book);
  $("editor-ideas").textContent = ideasText(state.book.data.ingredients) || "My own idea";
  renderPages();
  renderScenePrompt();
  renderHelperHistory();
}

function scenePrompt() {
  return pages().some((p) => !isSound(p))
    ? "What happens next? Draw it, write a sentence, and tell the rest."
    : "Draw your main character and write your first sentence on paper. Then take one photo of both.";
}

function renderScenePrompt() {
  const first = !pages().some((p) => !isSound(p));
  $("scene-heading").textContent = first ? "The first page" : "Add the next page";
  $("scene-prompt").textContent = scenePrompt();
}

function renderPages() {
  const all = pages();
  $("pages-empty").hidden = all.length > 0;
  $("page-list").replaceChildren(...all.map(pageItem));
}

function pageItem(page) {
  const li = node("li", `story-page ${isSound(page) ? "story-sound" : "story-scene"}`);
  li.dataset.pageId = page.id;
  li.append(...kindTag(page), renderEntry(page), ...pageNotes(page, { hint: true }));
  const actions = node("div", "actions");
  if (state.editDrafts.has(page.id)) {
    const box = document.createElement("textarea");
    box.className = "story-edit";
    box.rows = 4;
    box.value = state.editDrafts.get(page.id);
    box.setAttribute("aria-label", `Typed words for ${page.label || "this page"}`);
    box.addEventListener("input", () => state.editDrafts.set(page.id, box.value));
    li.append(box);
    actions.append(
      act("save-text", "Save these words", () => saveEdit(page.id), "mid primary"),
      act("cancel-text", "Stop changing", async () => {
        state.editDrafts.delete(page.id);
        renderPages();
      }),
    );
  } else {
    actions.append(act("edit-text", "Change typed words", async () => {
      state.editDrafts.set(page.id, page.text || "");
      renderPages();
      $("page-list").querySelector(`[data-page-id="${CSS.escape(page.id)}"] textarea`)?.focus();
    }));
  }
  li.append(actions);
  return li;
}

async function saveEdit(pageId) {
  const text = state.editDrafts.get(pageId) ?? "";
  await commit((data) => {
    const page = data.pages.find((p) => p.id === pageId);
    if (!page) throw new Error("That page could not be found.");
    if (page.original_text === undefined) page.original_text = page.text ?? "";
    page.text = text;
    page.edited_at = new Date().toISOString();
  });
  state.editDrafts.delete(pageId);
  renderPages();
}

function makePage(kind, label, got) {
  return {
    id: newId(),
    kind,
    label,
    text: got.text || "",
    original_text: got.text || "",
    photo: got.photo || null,
    audio: got.audio || null,
    seconds: got.seconds || 0,
    created_at: new Date().toISOString(),
  };
}

async function saveScene() {
  notice("scene-notice", "");
  const { bookId, scene } = session;
  if (!scene.hasContent()) {
    notice("scene-notice", "Add some words, a photo or a recording first.");
    return;
  }
  const got = await scene.read();
  const typedLabel = $("scene-label").value.trim();
  await commit((data) => {
    const number = data.pages.filter((p) => !isSound(p)).length + 1;
    data.pages.push(makePage("scene", typedLabel || `Page ${number}`, got));
  }, bookId);
  if (session?.bookId !== bookId) return;
  scene.clear();
  $("scene-label").value = "";
  renderEditor();
  notice("scene-notice", "Page saved.");
}

async function saveSound() {
  notice("sound-notice", "");
  const { bookId, sound } = session;
  if (!sound.hasContent()) {
    notice("sound-notice", "Record a sound or add a sound file first.");
    return;
  }
  const got = await sound.read();
  if (!got.audio) {
    notice("sound-notice", "Record a sound or add a sound file first. Words and a picture can go with it.");
    return;
  }
  const label = $("sound-label").value.trim() || "Sound effect";
  await commit((data) => data.pages.push(makePage("sound", label, got)), bookId);
  if (session?.bookId !== bookId) return;
  sound.clear();
  $("sound-label").value = "";
  renderEditor();
  notice("sound-notice", "Sound saved.");
}

async function saveTitle() {
  const title = $("title-input").value.trim() || DEFAULT_TITLE;
  await commit((_data, book) => { book.title = title; });
  $("title-input").value = state.book.title || "";
  $("editor-title").textContent = bookTitle(state.book);
}

/** After a 409: load the newest saved copy. Captures and word changes in progress stay. */
async function refreshBook() {
  const book = await getBook(state.book.id);
  book.data = normalizeData(book.data);
  state.book = book;
  $("conflict-notice").hidden = true;
  renderEditor();
}

async function finishForNow() {
  if (hasDraft()) {
    if (!(await confirmLeave())) return;
    session?.scene.clear();
    session?.sound.clear();
    state.editDrafts.clear();
    renderPages();
  }
  if (pages().length) showReader(0);
  else await goLibrary();
}

// ---------------------------------------------------------------- story helper (optional AI)

async function askHelper() {
  const typed = $("helper-question").value.trim();
  const bookId = state.book.id;
  const reply = await assist(state.book, typed || DEFAULT_QUESTION);
  if (state.book?.id !== bookId) return;
  const turn = {
    id: newId(),
    question: typed || DEFAULT_QUESTION,
    answer: reply.answer || "",
    prompt: reply.prompt || "",
    at: new Date().toISOString(),
  };
  state.shownAnswerId = turn.id;
  showAnswer(turn);
  await commit((data) => data.conversations.push(turn), bookId);
  $("helper-question").value = "";
  renderHelperHistory();
}

function conversationTurn(turn) {
  const box = node("div", "story-turn");
  box.append(node("p", "muted", `You asked: ${turn.question}`), node("p", "", turn.answer));
  if (turn.prompt) box.append(node("p", "story-helper-prompt", turn.prompt));
  return box;
}

function showAnswer(turn) {
  const box = $("helper-answer");
  const actions = node("div", "actions");
  actions.append(
    act("read-answer", "Read aloud", async () => say([turn.answer, turn.prompt].filter(Boolean).join(" "))),
    act("hide-answer", "Put it away", async () => {
      box.hidden = true;
      state.shownAnswerId = null;
      renderHelperHistory();
    }),
  );
  box.replaceChildren(
    node("p", "muted", "Story helper (AI). These are only ideas. Your story is yours."),
    conversationTurn(turn),
    actions,
  );
  box.hidden = false;
}

function renderHelperHistory() {
  const earlier = state.book.data.conversations.filter((t) => t.id !== state.shownAnswerId);
  $("helper-history").hidden = earlier.length === 0;
  $("helper-history-list").replaceChildren(...earlier.map(conversationTurn));
}

// ---------------------------------------------------------------- reader

function stopPlayback() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  for (const a of $("reader-slide").querySelectorAll("audio")) a.pause();
  readerAudio?.pause();
  readerAudio = null;
}

function showReader(index = 0) {
  show("reader");
  setRoute(state.book.id);
  state.readIndex = Math.max(0, Math.min(index, pages().length));
  renderSlide();
}

function renderSlide() {
  stopPlayback();
  const all = pages();
  const i = state.readIndex;
  const page = i > 0 ? all[i - 1] : null;
  const slide = $("reader-slide");
  let words;
  if (!page) {
    const ideas = ideasText(state.book.data.ingredients);
    slide.replaceChildren(node("h1", "story-cover-title", bookTitle(state.book)));
    if (ideas) slide.append(node("p", "muted", ideas));
    slide.append(node("p", "muted", all.length ? countText(all) : "No pages yet."));
    $("reader-count").textContent = "Cover";
    words = bookTitle(state.book);
  } else {
    slide.replaceChildren(...kindTag(page), renderEntry(page));
    $("reader-count").textContent = `Page ${i} of ${all.length}`;
    words = page.text || "";
  }

  const prev = act("prev-page", "Previous page", async () => { state.readIndex -= 1; renderSlide(); }, "big");
  const next = act("next-page", "Next page", async () => { state.readIndex += 1; renderSlide(); }, "big primary");
  prev.disabled = i === 0;
  next.disabled = i >= all.length;
  $("reader-nav").replaceChildren(prev, next);

  const play = [];
  const read = act("read-words", "Read the words", async () => say(words));
  read.disabled = !words.trim();
  play.push(read);
  if (page?.audio) {
    play.push(act("play-audio", isSound(page) ? "Play sound effect" : "Play my telling", async () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      const audio = slide.querySelector("audio") || (readerAudio ??= new Audio(page.audio.url));
      audio.currentTime = 0;
      await audio.play();
    }));
  }
  play.push(act("stop-playback", "Stop", async () => stopPlayback()));
  $("reader-play").replaceChildren(...play);
}

// ---------------------------------------------------------------- print

function imagesReady(root) {
  const waits = [...root.querySelectorAll("img")]
    .filter((img) => !img.complete)
    .map((img) => new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }));
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  return Promise.race([Promise.all(waits), timeout]);
}

async function printStory() {
  const book = state.book;
  const view = $("print-view");
  const parts = [node("h1", "", bookTitle(book))];
  const ideas = ideasText(book.data.ingredients);
  if (ideas) parts.push(node("p", "muted", ideas));
  for (const page of pages(book)) {
    const article = node("article", "story-print-page");
    article.append(...kindTag(page), renderEntry(page), ...pageNotes(page));
    parts.push(article);
  }
  view.replaceChildren(...parts);
  // renderEntry images are lazy; the print copy is hidden on screen, so load them now.
  for (const img of view.querySelectorAll("img")) img.loading = "eager";
  await imagesReady(view);
  document.body.classList.add("printing-story");
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-story"), { once: true });
  window.print();
}

// ---------------------------------------------------------------- wiring

$("library-actions").replaceChildren(act("new-story", "Start a new story", startSetup, "big primary"));

$("setup-idea-actions").replaceChildren(
  act("shuffle-ideas", "Show other ideas", async () => shuffleIdeas()),
  act("hear-ideas", "Hear the ideas", hearIdeas),
);
$("setup-actions").replaceChildren(
  act("start-story", "Start my story", () => startStory(true), "big primary"),
  act("own-idea", "Use my own idea", () => startStory(false), "big"),
  act("setup-back", "Back to my stories", showLibrary),
);

$("editor-actions").replaceChildren(
  act("save-title", "Save story name", saveTitle),
  act("read-story", "Read my story", async () => showReader(0)),
  act("print-story", "Print my story", printStory),
  act("finish-for-now", "Finish for now", finishForNow, "mid primary"),
  act("to-library", "All my stories", goLibrary),
);
$("conflict-actions").replaceChildren(act("refresh-book", "Get the newest saved story", refreshBook, "mid primary"));
$("scene-actions").replaceChildren(
  act("save-scene", "Save this page", saveScene, "big primary"),
  act("hear-prompt", "Hear what to do", async () => say(`${scenePrompt()} Write one sentence, tell the rest.`)),
);
$("sound-actions").replaceChildren(act("save-sound", "Save this sound", saveSound, "mid primary"));
$("helper-actions").replaceChildren(act("ask-helper", "Ask for one question", askHelper));

$("reader-actions").replaceChildren(
  act("keep-writing", "Keep writing", async () => showEditor(), "mid primary"),
  act("reader-print", "Print my story", printStory),
  act("reader-library", "All my stories", goLibrary),
);

window.addEventListener("beforeunload", (e) => {
  if (!hasDraft()) return;
  e.preventDefault();
  e.returnValue = "";
});

const params = new URLSearchParams(location.search);
const startId = params.get("book");
if (startId) await openBook(startId, params.get("view") === "edit" ? "edit" : null);
else await showLibrary();
