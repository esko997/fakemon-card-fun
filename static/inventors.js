// Inventor's Workshop: pick a reviewed challenge, make a guess, build it for
// real away from the screen, then show and tell what happened. Every guess and
// every try is kept exactly as the child made it (their words, original photo,
// original recording). Nothing is scored and nothing is ever overwritten.
//
// Book kind "invention", data:
//   challenge_id      id from challenges.json
//   prediction        entry | null            the first guess
//   attempts[]        {id, change: entry|null, result: entry, saved_at}
//   next_change       entry | null            "one change" idea not built yet
//   conversations[]   {id, question, question_photo, question_audio,
//                      question_seconds, answer, prompt, challenge_id, asked_at}
//   finished_for_now  boolean
// entry = {id, label, text, photo: Asset|null, audio: Asset|null, seconds, saved_at}
import { loadShell, say } from "./shell.js";
import {
  api, createBook, listBooks, getBook, saveBook, assist,
  showError, button, node, renderEntry, capture,
} from "./play.js";

const app = document.getElementById("app");
const leaveDialog = document.getElementById("leave-dialog");

const WRITING_HINT = "You could start with \"I think...\", or draw it and label two parts. Or just record your voice.";
const SAFETY_ALWAYS = "Build on the floor or a steady table. Ask a grown-up before using anything that is not on the list.";
const HELPER_NOTE = "The helper is an AI. It can be wrong, so check with a grown-up. Only build with the things on this challenge's list.";
const NEED_SOMETHING = "Add some words, a drawing, a photo or a recording first.";

let challenges = [];
const captures = new Set();   // every live capture controller on the page
let pendingTurn = null;       // helper answer that is not in the notebook yet
let currentUrl = location.href;
let view = null;              // notebook page state

// ---------- small helpers ----------

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const now = () => new Date().toISOString();

/** Element with children (strings become text nodes, never HTML). */
function el(tag, className, ...children) {
  const e = node(tag, className);
  e.append(...children);
  return e;
}

function statusLine() {
  const p = node("p", "muted inv-status");
  p.setAttribute("role", "status");
  return p;
}

function dateText(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function sentence(text) {
  const t = String(text || "").trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

function tryCount(n) {
  return n === 0 ? "No tries yet" : n === 1 ? "1 try" : `${n} tries`;
}

function findChallenge(id) {
  return challenges.find((c) => c.id === id) || null;
}

function freshData(challengeId, prediction) {
  return { challenge_id: challengeId, prediction, attempts: [], next_change: null, conversations: [], finished_for_now: false };
}

/** Saved data with every field this page relies on; unknown keys are kept. */
function notebookData(book) {
  const d = book.data || {};
  return {
    ...d,
    challenge_id: d.challenge_id ?? null,
    prediction: d.prediction || null,
    attempts: Array.isArray(d.attempts) ? d.attempts : [],
    next_change: d.next_change || null,
    conversations: Array.isArray(d.conversations) ? d.conversations : [],
    finished_for_now: Boolean(d.finished_for_now),
  };
}

/** Reads a capture into a notebook entry; null when it is empty. */
async function entryFrom(cap, label) {
  const r = await cap.read();
  if (!r.text.trim() && !r.photo && !r.audio) return null;
  return { id: uid(), label, text: r.text, photo: r.photo, audio: r.audio, seconds: r.seconds || 0, saved_at: now() };
}

function describe(entry) {
  if (!entry) return "";
  if (entry.text && entry.text.trim()) return sentence(entry.text);
  if (entry.photo && entry.audio) return "A picture and a recording.";
  if (entry.photo) return "A picture.";
  if (entry.audio) return "A recording.";
  return "";
}

// ---------- leaving with unsaved work ----------

function addCapture(container, options) {
  const c = capture(container, options);
  captures.add(c);
  return c;
}

function dropCapture(c) {
  c.destroy();
  captures.delete(c);
}

function unsaved() {
  return pendingTurn !== null || [...captures].some((c) => c.hasContent());
}

function confirmLeave() {
  if (!unsaved()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stay = document.getElementById("leave-stay");
    const go = document.getElementById("leave-go");
    const done = (leave) => {
      stay.onclick = go.onclick = leaveDialog.oncancel = null;
      leaveDialog.close();
      resolve(leave);
    };
    stay.onclick = () => done(false);
    go.onclick = () => done(true);
    leaveDialog.oncancel = (e) => { e.preventDefault(); done(false); };
    leaveDialog.showModal();
  });
}

// ---------- routing: ?challenge=ID, ?book=ID, or the library ----------

async function navigate(params, { replace = false, force = false } = {}) {
  if (!force && !(await confirmLeave())) return;
  const url = params ? `${location.pathname}?${new URLSearchParams(params)}` : location.pathname;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  await route();
}

async function route() {
  for (const c of captures) c.destroy();
  captures.clear();
  pendingTurn = null;
  view = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  currentUrl = location.href;
  app.replaceChildren();
  window.scrollTo(0, 0);
  const q = new URLSearchParams(location.search);
  try {
    if (q.get("book")) await showNotebook(q.get("book"));
    else if (q.get("challenge")) showChallenge(q.get("challenge"));
    else await showLibrary();
  } catch (error) {
    app.replaceChildren(el("div", "inv-wrap", el("section", "panel",
      node("p", "notice", "Something went wrong opening this page."),
      el("div", "actions", button("Back to the workshop", () => navigate(null, { force: true }))))));
    showError(error);
  }
}

addEventListener("popstate", async () => {
  if (!unsaved()) { await route(); return; }
  const target = location.href;
  history.pushState(null, "", currentUrl);
  if (await confirmLeave()) {
    history.replaceState(null, "", target);
    await route();
  }
});

addEventListener("beforeunload", (e) => {
  if (unsaved()) { e.preventDefault(); e.returnValue = ""; }
});

// Printing shows the whole notebook, including folded-away challenge details.
addEventListener("beforeprint", () => {
  for (const d of document.querySelectorAll("details")) d.open = true;
});

// ---------- challenge card ----------

function challengeSpeech(ch) {
  return [ch.title, ch.question, "Safety first.", ch.safety, "You will need:",
    ...ch.materials, "Ways to play:", ...ch.steps].map(sentence).join(" ");
}

function safetyNote(ch) {
  const box = el("div", "notice inv-safety",
    node("h3", "", "Safety first"), node("p", "", ch.safety), node("p", "", SAFETY_ALWAYS));
  box.setAttribute("role", "note");
  return box;
}

/** Full card on the challenge page; compact (details fold) inside a notebook. */
function challengeCard(ch, { heading, compact = false, open = true }) {
  const panel = el("section", "panel inv-challenge",
    node(compact ? "h2" : "h1", "", heading),
    node("p", "inv-question", ch.question),
    safetyNote(ch));
  const body = [
    node("h3", "", "You will need"),
    el("ul", "inv-materials", ...ch.materials.map((m) => node("li", "", m))),
    node("h3", "", "Ways to play"),
    el("ol", "inv-steps", ...ch.steps.map((s) => node("li", "", s))),
  ];
  if (compact) {
    const fold = el("details", "inv-details", node("summary", "", "What you need and ways to play"), ...body);
    fold.open = open;
    panel.append(fold);
  } else {
    panel.append(...body);
  }
  panel.append(el("div", "actions", button("Read it to me", async () => say(challengeSpeech(ch)))));
  return panel;
}

// ---------- library ----------

async function showLibrary() {
  const wrap = el("div", "inv-wrap",
    node("h1", "inv-title", "Inventor's Workshop"),
    node("p", "inv-lead", "Pick a challenge, make a guess, then build it for real. Your notebook keeps every try."));
  app.replaceChildren(wrap);

  const books = await listBooks("invention");
  const mine = el("section", "panel inv-library", node("h2", "", "My invention notebooks"));
  mine.append(books.length
    ? el("div", "book-grid", ...books.map(bookTile))
    : node("p", "muted", "No notebooks yet. Pick a challenge to start one."));

  const pick = el("section", "panel inv-library", node("h2", "", "Pick a challenge"));
  pick.append(challenges.length
    ? el("div", "book-grid", ...challenges.map(challengeTile))
    : node("p", "notice", "The challenges did not load. Try again in a little while."));

  wrap.append(mine, pick);
}

function tile(onClick, ...children) {
  const t = el("button", "book-tile inv-tile", ...children);
  t.type = "button";
  t.addEventListener("click", () => onClick().catch(showError));
  return t;
}

function bookTile(book) {
  const d = notebookData(book);
  const ch = findChallenge(d.challenge_id);
  return tile(() => navigate({ book: book.id }),
    node("strong", "", book.title || ch?.title || "My invention"),
    node("span", "muted", d.finished_for_now ? "Finished for now" : "Still building"),
    node("span", "muted", tryCount(d.attempts.length)),
    node("span", "muted", dateText(book.updated_at)));
}

function challengeTile(ch) {
  return tile(() => navigate({ challenge: ch.id }),
    node("strong", "", ch.title),
    node("span", "", ch.question));
}

// ---------- challenge page: read it, guess, start a notebook ----------

function showChallenge(id) {
  const ch = findChallenge(id);
  const wrap = node("div", "inv-wrap");
  app.replaceChildren(wrap);
  if (!ch) {
    wrap.append(el("section", "panel",
      node("p", "notice", "That challenge is not in the workshop."),
      el("div", "actions", button("Back to the workshop", () => navigate(null)))));
    return;
  }
  wrap.append(challengeCard(ch, { heading: ch.title }));

  const box = node("div", "inv-capture");
  const status = statusLine();
  const panel = el("section", "panel inv-step",
    node("h2", "", "Before you build"),
    node("p", "inv-ask", "What do you think will happen?"),
    node("p", "muted", WRITING_HINT),
    box, status);
  wrap.append(panel);
  const cap = addCapture(box, { label: "My guess", writing: true });

  panel.append(el("div", "actions",
    button("Save my guess", async () => {
      const entry = await entryFrom(cap, "My guess");
      if (!entry) { status.textContent = `${NEED_SOMETHING} Or start building without a guess.`; return; }
      const book = await createBook("invention", ch.title, freshData(ch.id, entry));
      cap.clear();
      await navigate({ book: book.id }, { replace: true, force: true });
    }, "mid primary"),
    button("Start building without a guess", async () => {
      if (!(await confirmLeave())) return;
      const book = await createBook("invention", ch.title, freshData(ch.id, null));
      await navigate({ book: book.id }, { replace: true, force: true });
    })));
}

// ---------- notebook page ----------

function startingStep(d) {
  if (d.finished_for_now) return "finished";
  if (!d.prediction && !d.attempts.length && !d.next_change) return "predict";
  if (d.next_change || !d.attempts.length) return "build";
  return "choose";
}

async function showNotebook(id) {
  const book = await getBook(id);
  if (book.kind !== "invention") throw new Error("This notebook belongs to a different game.");
  const d = notebookData(book);
  view = {
    book,
    challenge: findChallenge(d.challenge_id),
    step: null,
    stepCaptures: [],
    stale: node("div", "inv-stale"),
    stepBox: node("section", "panel inv-step"),
    pages: node("section", "panel inv-notebook"),
    helper: node("section", "panel inv-helper"),
  };
  view.stale.hidden = true;

  const wrap = el("div", "inv-wrap", node("h1", "inv-title", book.title || "My invention"));
  wrap.append(view.challenge
    ? challengeCard(view.challenge, { heading: "The challenge", compact: true, open: d.attempts.length === 0 })
    : el("section", "panel", node("p", "notice", "This challenge is not in the workshop any more, but your notebook is still here.")));
  wrap.append(view.stale, view.stepBox, view.pages, view.helper, notebookActions());
  app.replaceChildren(wrap);

  renderPages();
  setStep(startingStep(d), { scroll: false });
  renderHelper();
}

/** Save one explicit change on a copy; the shown book only changes on success. */
async function commit(mutate) {
  const draft = structuredClone(view.book);
  draft.data = notebookData(draft);
  mutate(draft.data);
  try {
    view.book = await saveBook(draft);
  } catch (error) {
    if (error.status === 409) showStale();
    throw error;
  }
  view.stale.hidden = true;
  renderPages();
}

function showStale() {
  view.stale.hidden = false;
  view.stale.replaceChildren(el("div", "notice",
    node("p", "", "This notebook was changed somewhere else, so nothing was saved. Your new work is still here. Get the latest notebook, then press save again."),
    el("div", "actions", button("Get the latest notebook", async () => {
      view.book = await getBook(view.book.id);
      view.stale.hidden = true;
      renderPages();
    }))));
}

function notebookSpeech() {
  const d = notebookData(view.book);
  const parts = [sentence(view.book.title)];
  if (view.challenge) parts.push(sentence(view.challenge.question));
  parts.push("My guess:", describe(d.prediction) || "No guess saved.");
  d.attempts.forEach((a, i) => {
    parts.push(`Try ${i + 1}.`);
    if (a.change) parts.push("My one change:", describe(a.change));
    if (a.result) parts.push("What happened:", describe(a.result));
  });
  if (d.next_change) parts.push("My next change:", describe(d.next_change));
  for (const t of d.conversations) {
    parts.push("I asked:", sentence(t.question), "The helper said:", sentence(t.answer));
  }
  return parts.join(" ");
}

function notebookActions() {
  return el("section", "panel inv-actions", el("div", "actions",
    button("Read my notebook to me", async () => say(notebookSpeech())),
    button("Print my notebook", async () => window.print()),
    button("Back to the workshop", () => navigate(null))));
}

function conversationView(turn) {
  const box = el("div", "conversation",
    renderEntry({ label: "I asked", text: turn.question || "", photo: turn.question_photo || null, audio: turn.question_audio || null }),
    node("p", "muted inv-helper-note", "AI helper (it can be wrong)"),
    node("p", "inv-answer", turn.answer || ""));
  if (turn.prompt) box.append(node("p", "inv-wonder", `Something to wonder about, only if you want: ${turn.prompt}`));
  box.append(el("div", "actions", button("Read it to me", async () => say(`${sentence(turn.answer)} ${turn.prompt || ""}`))));
  return box;
}

function renderPages() {
  const d = notebookData(view.book);
  const p = view.pages;
  p.replaceChildren(node("h2", "", "My notebook"), node("h3", "", "My guess"));
  p.append(d.prediction ? renderEntry({ ...d.prediction, label: "My guess" }) : node("p", "muted", "No guess saved."));

  d.attempts.forEach((a, i) => {
    const sec = el("div", "inv-try", node("h3", "", `Try ${i + 1}`));
    if (a.change) sec.append(renderEntry({ ...a.change, label: "My one change" }));
    if (a.result) sec.append(renderEntry({ ...a.result, label: "What happened" }));
    const when = dateText(a.saved_at);
    if (when) sec.append(node("p", "muted inv-date", when));
    p.append(sec);
  });

  if (d.next_change) {
    p.append(el("div", "inv-try",
      node("h3", "", `Try ${d.attempts.length + 1} (not built yet)`),
      renderEntry({ ...d.next_change, label: "My one change" })));
  }

  if (d.conversations.length) {
    p.append(node("h3", "", "Questions I asked"));
    for (const turn of d.conversations) p.append(conversationView(turn));
  }
}

// ---------- the step panel: one question at a time ----------

const STEPS = {
  predict: stepPredict,
  build: stepBuild,
  result: stepResult,
  change: stepChange,
  choose: stepChoose,
  finished: stepFinished,
};

function setStep(step, { scroll = true } = {}) {
  for (const c of view.stepCaptures) dropCapture(c);
  view.stepCaptures = [];
  view.step = step;
  view.stepBox.replaceChildren();
  STEPS[step](view.stepBox);
  if (scroll) view.stepBox.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stepCapture(container, label) {
  const c = addCapture(container, { label, writing: true });
  view.stepCaptures.push(c);
  return c;
}

/** Moves to another step; asks first if this step has unsaved work. */
async function leaveStep(next) {
  if (view.stepCaptures.some((c) => c.hasContent()) && !(await confirmLeave())) return;
  setStep(next);
}

async function finishForNow() {
  await commit((d) => { d.finished_for_now = true; });
  setStep("finished");
}

function stepPredict(box) {
  const cbox = node("div", "inv-capture");
  const status = statusLine();
  box.append(node("h2", "", "Before you build"));
  if (view.challenge) box.append(node("p", "inv-question", view.challenge.question));
  box.append(node("p", "inv-ask", "What do you think will happen?"), node("p", "muted", WRITING_HINT), cbox, status);
  const cap = stepCapture(cbox, "My guess");
  box.append(el("div", "actions",
    button("Save my guess", async () => {
      const entry = await entryFrom(cap, "My guess");
      if (!entry) { status.textContent = NEED_SOMETHING; return; }
      await commit((d) => {
        if (d.prediction) throw new Error("A guess is already saved in this notebook, so this one was not saved. Your work is still here.");
        d.prediction = entry;
      });
      cap.clear();
      setStep("build");
    }, "mid primary"),
    button("Start building without a guess", () => leaveStep("build"))));
}

function stepBuild(box) {
  const d = notebookData(view.book);
  box.append(
    node("h2", "", d.next_change ? "Time to try your change" : "Time to build"),
    node("p", "", "Go and build it for real, away from the screen. Come back whenever you want to show and tell what happened."));
  if (view.challenge) box.append(node("p", "inv-reminder", `Remember: ${view.challenge.safety}`));
  const actions = el("div", "actions",
    button("I'm back: show what happened", async () => setStep("result"), "mid primary"));
  if (view.challenge) {
    actions.append(button("Read the ways to play", async () => say(view.challenge.steps.map(sentence).join(" "))));
  }
  actions.append(button("Finished for now", finishForNow));
  box.append(actions);
}

function stepResult(box) {
  const d = notebookData(view.book);
  const cbox = node("div", "inv-capture");
  const status = statusLine();
  box.append(
    node("h2", "", `What happened? (Try ${d.attempts.length + 1})`),
    node("p", "inv-ask", view.challenge?.writing_prompt || "Tell or show what happened."),
    node("p", "muted", "A photo of what you built, a drawing with two labels, some words or your voice all work."),
    cbox, status);
  const cap = stepCapture(cbox, "What happened");
  box.append(el("div", "actions",
    button("Save this try", async () => {
      const entry = await entryFrom(cap, "What happened");
      if (!entry) { status.textContent = NEED_SOMETHING; return; }
      await commit((data) => {
        data.attempts.push({ id: uid(), change: data.next_change, result: entry, saved_at: now() });
        data.next_change = null;
      });
      cap.clear();
      setStep("choose");
    }, "mid primary"),
    button("Back to building", () => leaveStep("build"))));
}

function stepChange(box) {
  const cbox = node("div", "inv-capture");
  const status = statusLine();
  box.append(
    node("h2", "", "One change, then try again"),
    node("p", "inv-ask", view.challenge?.followup || "What one thing will you change?"),
    node("p", "muted", "You could start with \"I will change...\" or \"I think...\", or draw it and label two parts. Or just record your voice."),
    cbox, status);
  const cap = stepCapture(cbox, "My one change");
  box.append(el("div", "actions",
    button("Save my change idea", async () => {
      const entry = await entryFrom(cap, "My one change");
      if (!entry) { status.textContent = NEED_SOMETHING; return; }
      await commit((d) => {
        if (d.next_change) throw new Error("A change idea is already waiting in this notebook, so this one was not saved. Your work is still here.");
        d.next_change = entry;
      });
      cap.clear();
      setStep("build");
    }, "mid primary"),
    button("Just build it", () => leaveStep("build")),
    button("Back", () => leaveStep("choose"))));
}

function stepChoose(box) {
  const d = notebookData(view.book);
  box.append(node("h2", "", `Try ${d.attempts.length} is in your notebook`));
  if (view.challenge) box.append(node("p", "inv-ask", view.challenge.followup));
  box.append(el("div", "actions",
    button("Try one change", async () => setStep("change"), "mid primary"),
    button("Finished for now", finishForNow)));
}

function stepFinished(box) {
  box.append(
    node("h2", "", "Finished for now"),
    node("p", "", "Everything is saved in your notebook. You can come back and keep building any time."),
    el("div", "actions",
      button("Keep building", async () => {
        await commit((d) => { d.finished_for_now = false; });
        setStep(startingStep(notebookData(view.book)));
      }, "mid primary"),
      button("Read my notebook to me", async () => say(notebookSpeech())),
      button("Print my notebook", async () => window.print())));
}

// ---------- optional helper: one question at a time ----------

function renderHelper() {
  const h = view.helper;
  h.replaceChildren(node("h2", "", "Ask the helper (only if you want)"), node("p", "muted", HELPER_NOTE));
  const form = node("div", "inv-helper-form");
  form.hidden = true;
  const open = button("Ask a question", async () => {
    open.hidden = true;
    form.hidden = false;
    buildForm();
  });
  h.append(open, form);

  function buildForm() {
    const cbox = node("div", "inv-capture");
    const status = statusLine();
    const pending = node("div", "inv-pending");
    form.append(cbox, status, pending);
    const cap = addCapture(cbox, { label: "My question", writing: false });

    async function savePending() {
      const turn = pendingTurn;
      await commit((d) => { d.conversations.push(turn); });
      pendingTurn = null;
      pending.replaceChildren();
      cap.clear();
      status.textContent = "The helper's answer is in your notebook now.";
    }

    form.append(el("div", "actions", button("Ask", async () => {
      if (pendingTurn) { status.textContent = "Save the helper's answer to your notebook first."; return; }
      const r = await cap.read();
      const question = r.text.trim();
      if (!question) {
        status.textContent = r.audio
          ? "Tap \"Turn my recording into words\" first, so the helper can read your question."
          : "Type or say your question first.";
        return;
      }
      status.textContent = "The helper is thinking...";
      let reply;
      try {
        reply = await assist(view.book, question);
      } catch (error) {
        status.textContent = "The helper could not answer just now. Your question is still here.";
        throw error;
      }
      status.textContent = "";
      pendingTurn = {
        id: uid(),
        question: r.text,
        question_photo: r.photo,
        question_audio: r.audio,
        question_seconds: r.seconds || 0,
        answer: reply.answer,
        prompt: reply.prompt || "",
        challenge_id: notebookData(view.book).challenge_id,
        asked_at: now(),
      };
      pending.replaceChildren(conversationView(pendingTurn),
        el("div", "actions", button("Save it to my notebook", savePending, "mid primary")));
      await savePending();
    }, "mid primary")));
  }
}

// ---------- start ----------

document.querySelector(".inv-workshop-link").addEventListener("click", (e) => {
  e.preventDefault();
  navigate(null).catch(showError);
});

await loadShell("Inventor's Workshop");
try {
  challenges = await api("/api/play/catalog/challenges");
} catch (error) {
  challenges = [];
  showError(error);
}
await route();
