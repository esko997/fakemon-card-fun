// Fact Explorer: discover curated, sourced facts by topic, ask follow-up questions, and keep
// drawings, recordings, and thoughts in a discovery book. The server allows ten new facts per
// session (data.fact_ids / data.paused are server-owned); revisiting and asking are unlimited.
import { loadShell, say } from './shell.js';
import {
  api, createBook, listBooks, getBook, saveBook, assist, showError, button, node, renderEntry, capture,
} from './play.js';

const $ = (id) => document.getElementById(id);
const MAX_FACTS = 10;
const AI_LABEL = 'AI explanation — ask a grown-up to check anything surprising';
const TOPIC_NAMES = { all: 'Everything', animals: 'Animals', ocean: 'Ocean', space: 'Space', earth: 'Earth' };
const REFLECT_IDEAS = [
  'Which discovery would you like to tell someone about?',
  'What are you still wondering about?',
  'Draw your favorite discovery and take a photo of it.',
];
const SVG_NS = 'http://www.w3.org/2000/svg';

let catalog = [];
const byId = new Map();
let book = null;          // last Book returned by the server; never holds unsaved changes
let sessionId = null;     // book id the captures belong to
let currentFactId = null;
let topic = 'all';
let captures = null;      // { ask, note, reflect }, one persistent capture each per session
let lastURL = location.href;
let queue = Promise.resolve();
const pendingAnswers = new Map();  // turn id -> answer received but not yet saved
const thinking = new Set();        // turn ids waiting on the helper

const topicName = (t) => TOPIC_NAMES[t] || t.charAt(0).toUpperCase() + t.slice(1);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();
const visited = () => book?.data?.fact_ids || [];
const paused = () => !!book?.data?.paused || visited().length >= MAX_FACTS;
const currentFact = () => (currentFactId ? byId.get(currentFactId) : null);
const shortDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };
const hasDraft = (d) => !!(d.text.trim() || d.photo || d.audio);

// ---------------------------------------------------------------- pictures (own simple SVG)

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

function topicArt(name) {
  const parts = {
    space: [
      svg('rect', { width: 120, height: 120, rx: 18, fill: '#1d2366' }),
      svg('circle', { cx: 20, cy: 22, r: 2.5, fill: '#fff' }),
      svg('circle', { cx: 98, cy: 18, r: 2, fill: '#fff' }),
      svg('circle', { cx: 104, cy: 96, r: 2.5, fill: '#fff' }),
      svg('circle', { cx: 16, cy: 98, r: 2, fill: '#fff' }),
      svg('circle', { cx: 60, cy: 60, r: 28, fill: '#f2b25c' }),
      svg('path', { d: 'M38 52 Q60 44 82 52', stroke: '#d98b2b', 'stroke-width': 5, fill: 'none' }),
      svg('path', { d: 'M36 66 Q60 74 84 66', stroke: '#d98b2b', 'stroke-width': 4, fill: 'none' }),
      svg('ellipse', { cx: 60, cy: 60, rx: 50, ry: 12, fill: 'none', stroke: '#fff2c4', 'stroke-width': 5, transform: 'rotate(-18 60 60)' }),
    ],
    ocean: [
      svg('rect', { width: 120, height: 120, rx: 18, fill: '#2f8fd8' }),
      svg('path', { d: 'M0 34 Q15 24 30 34 T60 34 T90 34 T120 34 V0 H0 Z', fill: '#9fd8ff' }),
      svg('ellipse', { cx: 58, cy: 70, rx: 24, ry: 14, fill: '#ff9f43' }),
      svg('path', { d: 'M80 70 L100 56 L100 84 Z', fill: '#ff9f43' }),
      svg('circle', { cx: 46, cy: 66, r: 3.5, fill: '#1a1a1a' }),
      svg('circle', { cx: 30, cy: 98, r: 4, fill: 'none', stroke: '#e6f6ff', 'stroke-width': 2 }),
      svg('circle', { cx: 38, cy: 88, r: 3, fill: 'none', stroke: '#e6f6ff', 'stroke-width': 2 }),
      svg('path', { d: 'M86 120 Q90 100 84 92 M96 120 Q98 104 104 96', stroke: '#2ecc71', 'stroke-width': 4, fill: 'none' }),
    ],
    animals: [
      svg('rect', { width: 120, height: 120, rx: 18, fill: '#ffe7c2' }),
      svg('ellipse', { cx: 60, cy: 76, rx: 24, ry: 20, fill: '#8a5a3c' }),
      svg('ellipse', { cx: 30, cy: 52, rx: 9, ry: 12, fill: '#8a5a3c' }),
      svg('ellipse', { cx: 48, cy: 36, rx: 9, ry: 12, fill: '#8a5a3c' }),
      svg('ellipse', { cx: 72, cy: 36, rx: 9, ry: 12, fill: '#8a5a3c' }),
      svg('ellipse', { cx: 90, cy: 52, rx: 9, ry: 12, fill: '#8a5a3c' }),
    ],
    earth: [
      svg('rect', { width: 120, height: 120, rx: 18, fill: '#bfe6ff' }),
      svg('ellipse', { cx: 30, cy: 28, rx: 16, ry: 8, fill: '#fff' }),
      svg('ellipse', { cx: 42, cy: 24, rx: 12, ry: 8, fill: '#fff' }),
      svg('polygon', { points: '6,110 46,40 86,110', fill: '#7d8597' }),
      svg('polygon', { points: '46,40 36,58 56,58', fill: '#fff' }),
      svg('polygon', { points: '50,110 82,58 114,110', fill: '#5c946e' }),
      svg('polygon', { points: '82,58 75,70 89,70', fill: '#fff' }),
      svg('rect', { y: 104, width: 120, height: 16, rx: 0, fill: '#3e7c4f' }),
    ],
  };
  return svg('svg', { viewBox: '0 0 120 120', width: 96, height: 96, role: 'img', 'aria-hidden': 'true', focusable: 'false' },
    parts[name] || parts.earth);
}

// ---------------------------------------------------------------- navigation

function urlFor(target) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(target)) if (v) params.set(k, v);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}

/** Captures that would be abandoned by moving from the current URL to `target`. */
function capturesAtRisk(target) {
  if (!captures) return [];
  const here = new URLSearchParams(location.search);
  if ((target.book || null) !== here.get('book')) return ['ask', 'note', 'reflect'];
  if (target.view === 'book' || here.get('view') === 'book') return [];
  if ((target.fact || null) !== currentFactId) return ['ask', 'note'];
  return [];
}

/** Ask before discarding unsaved words, photos, or recordings. Clears them only when the child chooses to leave. */
function confirmLeave(keys) {
  const dirty = keys.filter((k) => captures?.[k]?.hasContent());
  if (!dirty.length) return Promise.resolve(true);
  const dialog = $('leave-dialog');
  return new Promise((resolve) => {
    const done = (leave) => {
      $('leave-stay').onclick = null;
      $('leave-go').onclick = null;
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      if (leave) for (const k of dirty) captures[k].clear();
      resolve(leave);
    };
    $('leave-stay').onclick = () => done(false);
    $('leave-go').onclick = () => done(true);
    dialog.oncancel = (event) => { event.preventDefault(); done(false); };
    dialog.showModal();
  });
}

async function go(target, { push = true } = {}) {
  if (!(await confirmLeave(capturesAtRisk(target)))) return false;
  history[push ? 'pushState' : 'replaceState'](null, '', urlFor(target));
  await route();
  return true;
}

function navLink(label, target, className = 'mid') {
  const link = node('a', className, label);
  link.href = urlFor(target);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    go(target).catch(showError);
  });
  return link;
}

window.addEventListener('popstate', async () => {
  const here = new URLSearchParams(location.search);
  const target = { book: here.get('book'), fact: here.get('fact'), view: here.get('view') };
  // Compare against where we were, not where the browser already moved.
  const arrived = location.href;
  history.replaceState(null, '', lastURL);
  const ok = await confirmLeave(capturesAtRisk(target));
  if (!ok) return;
  history.replaceState(null, '', arrived);
  route().catch(showError);
});

window.addEventListener('beforeunload', (event) => {
  if (captures && Object.values(captures).some((c) => c.hasContent())) event.preventDefault();
});

function showView(id) {
  for (const view of document.querySelectorAll('.facts-view')) view.hidden = view.id !== id;
  window.scrollTo(0, 0);
}

async function route() {
  const params = new URLSearchParams(location.search);
  const id = params.get('book');
  if (!id) {
    destroyCaptures();
    book = null;
    sessionId = null;
    currentFactId = null;
    lastURL = location.href;
    await showLibrary();
    return;
  }
  if (sessionId !== id) {
    let loaded;
    try {
      loaded = book?.id === id ? book : await getBook(id);
      if (loaded.kind !== 'facts') throw new Error('That book is not a discovery book.');
    } catch (error) {
      showError(error);
      history.replaceState(null, '', urlFor({}));
      await route();
      return;
    }
    book = loaded;
    sessionId = id;
    pendingAnswers.clear();
    thinking.clear();
    makeCaptures();
  }
  const factParam = params.get('fact');
  currentFactId = factParam && visited().includes(factParam) ? factParam : (visited().at(-1) || null);
  lastURL = location.href;
  if (params.get('view') === 'book') {
    renderBook();
    showView('book-view');
  } else {
    hideNotice();
    renderSession();
    showView('session-view');
  }
}

// ---------------------------------------------------------------- saving

/** Run book-changing calls one at a time so revisions never race each other. */
function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

/** Apply `mutate` to a copy of the latest saved data and save it. On failure nothing local changes. */
function commit(mutate) {
  return serial(async () => {
    const data = structuredClone(book.data);
    mutate(data);
    try {
      book = await saveBook({ ...book, data });
    } catch (error) {
      if (error.status === 409) showStale();
      throw error;
    }
    return book;
  });
}

function showStale() {
  showNotice('This book was changed somewhere else, so nothing new was saved. Your work is still here. Get the latest book, then save again.',
    button('Get the latest book', async () => {
      const fresh = await serial(() => getBook(book.id));
      book = fresh;
      hideNotice();
      if (!visited().includes(currentFactId)) currentFactId = visited().at(-1) || null;
      renderSession();
    }, 'mid primary'));
}

function showNotice(message, ...extra) {
  const box = $('session-notice');
  box.replaceChildren(node('p', '', message), ...extra);
  box.hidden = false;
}

function hideNotice() {
  $('session-notice').hidden = true;
  $('session-notice').replaceChildren();
}

function makeCaptures() {
  destroyCaptures();
  captures = {
    ask: capture($('ask-capture'), { label: 'Ask your own question', writing: true }),
    note: capture($('note-capture'), { label: 'Show what you made or noticed', writing: true }),
    reflect: capture($('reflect-capture'), { label: 'My thinking about these discoveries', writing: true }),
  };
}

function destroyCaptures() {
  if (!captures) return;
  for (const c of Object.values(captures)) c.destroy();
  captures = null;
}

// ---------------------------------------------------------------- library

async function showLibrary() {
  showView('library-view');
  const list = $('library');
  const status = $('library-status');
  list.replaceChildren();
  status.textContent = 'Loading...';
  let books;
  try {
    books = await listBooks('facts');
  } catch (error) {
    status.textContent = 'The sessions could not load right now.';
    showError(error);
    return;
  }
  status.textContent = books.length ? '' : 'No discovery sessions yet. Start one above.';
  for (const b of books) {
    const count = (b.data?.fact_ids || []).length;
    const tile = node('a', 'book-tile');
    tile.href = urlFor({ book: b.id });
    tile.append(
      node('h3', '', b.title),
      node('p', '', `${count} of ${MAX_FACTS} discoveries${b.data?.paused ? ' - finished' : ''}`),
      node('p', 'muted', shortDate(b.updated_at)),
    );
    tile.addEventListener('click', (event) => { event.preventDefault(); go({ book: b.id }).catch(showError); });
    list.append(tile);
  }
}

async function startSession() {
  const input = $('new-title');
  const title = input.value.trim() || `Discoveries ${new Date().toLocaleDateString()}`;
  const created = await createBook('facts', title, { conversations: [], notes: [], reflections: [] });
  input.value = '';
  book = created;
  topic = 'all';
  await go({ book: created.id });
}

// ---------------------------------------------------------------- one session

function renderSession() {
  $('session-title').textContent = book.title;
  const n = visited().length;
  $('session-count').textContent = paused()
    ? `${n} of ${MAX_FACTS} discoveries. This session is finished, but you can look back and ask more questions.`
    : `${n} of ${MAX_FACTS} new discoveries in this session.`;

  const nav = $('session-nav');
  nav.replaceChildren(
    navLink('My whole book', { book: book.id, fact: currentFactId, view: 'book' }),
    navLink('All sessions', {}),
  );

  $('discover-panel').hidden = paused();
  $('pause-panel').hidden = !paused();
  if (paused()) renderPause(); else renderTopics();
  renderTrail();
  renderFact();
}

function topicsInCatalog() {
  return [...new Set(catalog.map((f) => f.topic))];
}

function remaining(t) {
  const seen = new Set(visited());
  return catalog.filter((f) => !seen.has(f.id) && (t === 'all' || f.topic === t)).length;
}

function renderTopics() {
  const box = $('topics');
  box.replaceChildren();
  for (const t of ['all', ...topicsInCatalog()]) {
    const left = remaining(t);
    const chip = node('button', `mid facts-topic${t === topic ? ' on' : ''}`, left ? topicName(t) : `${topicName(t)} - all explored`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(t === topic));
    chip.disabled = !left;
    chip.addEventListener('click', () => { topic = t; renderTopics(); });
    box.append(chip);
  }
  const exhausted = !remaining(topic);
  $('topic-note').textContent = exhausted
    ? `You have explored every ${topicName(topic)} fact in this session. Choose another topic.`
    : '';
  $('discover-btn').hidden = exhausted;
}

async function discover() {
  if (paused()) { renderSession(); return; }
  if (!(await confirmLeave(['ask', 'note']))) return;
  let result;
  try {
    result = await serial(() => api(`/api/play/books/${encodeURIComponent(book.id)}/next`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic }),
    }));
  } catch (error) {
    if (error.status !== 409) throw error;
    // Ten reached or this topic is used up: learn the real state from the server, keep everything else.
    book = await serial(() => getBook(book.id));
    renderSession();
    showNotice(error.message);
    return;
  }
  book = result.book;
  if (!byId.has(result.fact.id)) byId.set(result.fact.id, result.fact);
  await go({ book: book.id, fact: result.fact.id });
}

function renderTrail() {
  const ids = visited();
  $('trail-panel').hidden = !ids.length;
  const trail = $('trail');
  trail.replaceChildren();
  ids.forEach((id, i) => {
    const fact = byId.get(id);
    const link = navLink(`${i + 1}. ${fact ? fact.title : 'A fact no longer in the collection'}`, { book: book.id, fact: id }, 'mid facts-trail-item');
    if (id === currentFactId) { link.classList.add('on'); link.setAttribute('aria-current', 'true'); }
    trail.append(link);
  });
}

function renderPause() {
  const ideas = $('reflect-ideas');
  ideas.replaceChildren(...REFLECT_IDEAS.map((idea) => {
    const li = node('li', '', idea);
    li.append(' ', button('Read it to me', () => say(idea), 'mid no-print'));
    return li;
  }));
  const saved = book.data.reflections || [];
  const box = $('reflections');
  box.replaceChildren(...saved.map((r) => renderEntry({ ...r, label: `My thinking${shortDate(r.created_at) ? ` - ${shortDate(r.created_at)}` : ''}` })));
  const home = node('a', 'mid primary', 'Finish and go home');
  home.href = './';
  $('reflect-links').replaceChildren(navLink('See my whole book', { book: book.id, fact: currentFactId, view: 'book' }), home);
}

async function saveReflection() {
  const draft = await captures.reflect.read();
  if (!hasDraft(draft)) throw new Error('Write, draw, or record your thinking first.');
  const entry = { id: uid(), text: draft.text, photo: draft.photo, audio: draft.audio, seconds: draft.seconds, created_at: now() };
  await commit((data) => { (data.reflections ||= []).push(entry); });
  captures.reflect.clear();
  renderPause();
}

// ---------------------------------------------------------------- the current fact

function renderFact() {
  const fact = currentFact();
  const panel = $('fact-panel');
  if (!currentFactId) { panel.hidden = true; return; }
  panel.hidden = false;
  if (!fact) {
    $('fact-art').replaceChildren();
    $('fact-topic').textContent = '';
    $('fact-title').textContent = 'This fact is no longer in the collection';
    for (const id of ['fact-text', 'fact-explanation', 'fact-activity']) $(id).textContent = '';
    $('fact-source').removeAttribute('href');
    $('fact-source').textContent = '';
    $('chips').replaceChildren();
  } else {
    $('fact-art').replaceChildren(topicArt(fact.topic));
    $('fact-topic').textContent = topicName(fact.topic);
    $('fact-title').textContent = fact.title;
    $('fact-text').textContent = fact.text;
    $('fact-explanation').textContent = fact.explanation;
    $('fact-activity').textContent = fact.activity;
    const source = $('fact-source');
    source.textContent = fact.source.title;
    if (/^https:\/\//.test(fact.source.url)) source.href = fact.source.url; else source.removeAttribute('href');
    $('chips').replaceChildren(...fact.questions.map((q) => button(q, () => askSuggested(q), 'mid facts-chip')));
  }
  renderNotes();
  renderThread();
}

function renderNotes() {
  const notes = (book.data.notes || []).filter((n) => n.fact_id === currentFactId);
  $('notes').replaceChildren(...notes.map((n) => renderEntry({ ...n, label: 'My discovery page' })));
}

async function saveNote() {
  const factId = currentFactId;
  if (!factId) return;
  const draft = await captures.note.read();
  if (!hasDraft(draft)) throw new Error('Draw, write, or record something first.');
  const entry = { id: uid(), fact_id: factId, text: draft.text, photo: draft.photo, audio: draft.audio, seconds: draft.seconds, created_at: now() };
  await commit((data) => { (data.notes ||= []).push(entry); });
  captures.note.clear();
  renderNotes();
}

// ---------------------------------------------------------------- questions and the helper

function newTurn(factId, draft, suggested = false) {
  return {
    id: uid(),
    fact_id: factId,
    suggested,
    question: { text: draft.text, photo: draft.photo, audio: draft.audio, seconds: draft.seconds || 0 },
    answer: null,
    prompt: null,
    asked_at: now(),
    answered_at: null,
  };
}

const findTurn = (id) => (book.data.conversations || []).find((t) => t.id === id);

/** Save the question first, so a helper failure never loses it. */
async function askOwn(withHelper) {
  const factId = currentFactId;
  if (!factId) return;
  const draft = await captures.ask.read();
  if (!hasDraft(draft)) throw new Error('Type, write, or record a question first.');
  const turn = newTurn(factId, draft);
  await commit((data) => { (data.conversations ||= []).push(turn); });
  captures.ask.clear();
  renderThread();
  if (withHelper) await answerTurn(turn.id);
}

async function askSuggested(question) {
  const factId = currentFactId;
  if (!factId) return;
  const turn = newTurn(factId, { text: question, photo: null, audio: null, seconds: 0 }, true);
  await commit((data) => { (data.conversations ||= []).push(turn); });
  renderThread();
  await answerTurn(turn.id);
}

async function answerTurn(turnId) {
  const turn = findTurn(turnId);
  if (!turn || turn.answer) return;
  if (pendingAnswers.has(turnId)) { await saveAnswer(turnId); return; }
  const question = (turn.question.text || '').trim();
  if (!question) return;  // recordings and photos are kept for a grown-up; the helper only reads words
  const bookId = book.id;
  thinking.add(turnId);
  renderThread();
  let result;
  try {
    result = await assist(book, question, turn.fact_id);
  } finally {
    thinking.delete(turnId);
    if (book?.id === bookId) renderThread();
  }
  if (book?.id !== bookId) return;  // the child left this session while the helper was thinking
  pendingAnswers.set(turnId, { answer: result.answer, prompt: result.prompt || '', answered_at: now() });
  renderThread();
  await saveAnswer(turnId);
}

async function saveAnswer(turnId) {
  const answer = pendingAnswers.get(turnId);
  if (!answer) return;
  await commit((data) => {
    const turn = (data.conversations || []).find((t) => t.id === turnId);
    if (!turn) throw new Error('That question is not in this book any more.');
    Object.assign(turn, answer);
  });
  pendingAnswers.delete(turnId);
  renderThread();
}

function answerBlock(answer, prompt) {
  const box = node('div', 'facts-answer');
  box.append(node('h4', '', AI_LABEL), node('p', '', answer), button('Read it to me', () => say(answer), 'mid no-print'));
  if (prompt) {
    box.append(
      node('p', 'facts-prompt', `Something you could wonder about next, only if you want: ${prompt}`),
      button('Read the wondering', () => say(prompt), 'mid no-print'),
    );
  }
  return box;
}

function renderTurn(turn, { live = true } = {}) {
  const box = node('div', 'facts-turn');
  box.append(renderEntry({ ...turn.question, label: turn.suggested ? 'I wondered' : 'My question' }));
  const pending = live ? pendingAnswers.get(turn.id) : null;
  if (turn.answer) {
    box.append(answerBlock(turn.answer, turn.prompt));
  } else if (pending) {
    box.append(answerBlock(pending.answer, pending.prompt),
      node('p', 'notice no-print', 'This answer is not saved in your book yet.'),
      button('Save this answer', () => saveAnswer(turn.id), 'mid primary no-print'));
  } else if (live && thinking.has(turn.id)) {
    box.append(node('p', 'muted', 'The helper is thinking...'));
  } else if ((turn.question.text || '').trim()) {
    box.append(node('p', 'muted', 'Not answered yet. Your question is saved.'));
    if (live) box.append(button('Ask the helper', () => answerTurn(turn.id), 'mid no-print'));
  } else {
    box.append(node('p', 'muted', 'Saved for a grown-up to look at or listen to with you. The helper can only answer words.'));
  }
  return box;
}

function renderThread() {
  const turns = (book?.data?.conversations || []).filter((t) => t.fact_id === currentFactId);
  $('thread').replaceChildren(...turns.map((t) => renderTurn(t)));
}

// ---------------------------------------------------------------- whole book (read and print)

function renderBook() {
  $('book-title').textContent = book.title;
  $('book-nav').replaceChildren(
    navLink('Back to exploring', { book: book.id, fact: currentFactId }, 'mid primary'),
    button('Print my book', () => window.print()),
    navLink('All sessions', {}),
  );
  const out = $('book');
  out.replaceChildren();
  const ids = visited();
  if (!ids.length) out.append(node('p', 'muted', 'No discoveries yet.'));
  const notes = book.data.notes || [];
  const turns = book.data.conversations || [];
  ids.forEach((id, i) => {
    const fact = byId.get(id);
    const section = node('section', 'panel facts-book-fact');
    if (!fact) {
      section.append(node('h2', '', `${i + 1}. A fact no longer in the collection`));
    } else {
      const head = node('div', 'facts-head');
      const art = node('div', 'facts-art');
      art.setAttribute('aria-hidden', 'true');
      art.append(topicArt(fact.topic));
      const titles = node('div');
      titles.append(node('p', 'facts-topic-label', topicName(fact.topic)), node('h2', '', `${i + 1}. ${fact.title}`));
      head.append(art, titles);
      const source = node('p', 'facts-source', 'Where this fact comes from: ');
      const link = node('a', '', fact.source.title);
      if (/^https:\/\//.test(fact.source.url)) link.href = fact.source.url;
      link.target = '_blank';
      link.rel = 'noopener';
      source.append(link, node('span', 'facts-url', ` (${fact.source.url})`));
      section.append(head, node('p', 'facts-text', fact.text), node('p', '', fact.explanation), source,
        node('p', 'muted facts-source-note', 'This source backs up the fact. It is not proof for the helper\'s answers.'));
    }
    const myNotes = notes.filter((n) => n.fact_id === id);
    if (myNotes.length) {
      section.append(node('h3', '', 'My discovery pages'), ...myNotes.map((n) => renderEntry({ ...n, label: shortDate(n.created_at) })));
    }
    const myTurns = turns.filter((t) => t.fact_id === id);
    if (myTurns.length) {
      const conversation = node('div', 'conversation');
      conversation.append(...myTurns.map((t) => renderTurn(t, { live: false })));
      section.append(node('h3', '', 'My questions'), conversation);
    }
    out.append(section);
  });
  const reflections = book.data.reflections || [];
  if (reflections.length) {
    const section = node('section', 'panel');
    section.append(node('h2', '', 'My thinking'), ...reflections.map((r) => renderEntry({ ...r, label: shortDate(r.created_at) })));
    out.append(section);
  }
}

// ---------------------------------------------------------------- start up

function setup() {
  $('new-actions').append(button('Start a new session', startSession, 'big primary'));
  const discoverBtn = button('Discover a fact', discover, 'big primary');
  discoverBtn.id = 'discover-btn';
  $('discover-actions').append(discoverBtn);
  $('fact-read').append(button('Read it to me', () => { const f = currentFact(); if (f) say(`${f.title}. ${f.text}`); }));
  $('explain-read').append(button('Read how it works', () => { const f = currentFact(); if (f) say(f.explanation); }));
  $('activity-read').append(button('Read the idea', () => { const f = currentFact(); if (f) say(f.activity); }));
  $('note-actions').append(button('Save to my book', saveNote, 'mid primary'));
  $('ask-actions').append(
    button('Ask the helper', () => askOwn(true), 'mid primary'),
    button('Save my question for later', () => askOwn(false)),
  );
  $('reflect-actions').append(button('Save my thinking', saveReflection, 'mid primary'));
}

await loadShell('Fact Explorer');
setup();
try {
  catalog = await api('/api/play/catalog/facts');
  for (const fact of catalog) byId.set(fact.id, fact);
} catch (error) {
  showError(error);
}
await route();
