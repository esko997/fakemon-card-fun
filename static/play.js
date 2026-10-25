// Shared play notebook transport and capture. Originals are uploaded once, never rewritten.
import { say } from './shell.js';

export async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || response.statusText));
    error.status = response.status;
    throw error;
  }
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const createBook = (kind, title, data = {}) => api('/api/play/books', json('POST', { kind, title, data }));
export const listBooks = (kind) => api(`/api/play/books?kind=${encodeURIComponent(kind)}`);
export const getBook = (id) => api(`/api/play/books/${encodeURIComponent(id)}`);
export const saveBook = (book) => api(`/api/play/books/${encodeURIComponent(book.id)}`, json('PUT', { title: book.title, data: book.data, revision: book.revision }));
export const assist = (book, question, factId = null) => api('/api/play/assist', json('POST', { book_id: book.id, question, fact_id: factId }));
export const makeArt = (book, assetId) => api('/api/play/art', json('POST', { book_id: book.id, asset_id: assetId }));

export function node(tag, className = '', text = '') {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function showError(error) {
  const dialog = node('dialog', 'play-error');
  const title = node('h2', '', error.status === 402 ? 'The helper needs a grown-up' : 'That did not finish');
  const message = node('p', '', error.status === 402
    ? 'The monthly AI budget is used up. You can still draw, write, record, and save without the helper.'
    : 'Your work is still here. You can try again, or ask a grown-up to look.');
  const details = node('details');
  details.append(node('summary', '', 'Ask a grown-up to look at this error'), node('pre', '', error.message || String(error)));
  dialog.append(title, message, details, button('Keep playing', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

export function button(label, handler, className = 'mid') {
  const b = node('button', className, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    try { await handler(); } catch (error) { showError(error); }
    finally { b.disabled = false; b.removeAttribute('aria-busy'); }
  });
  return b;
}

function mediaURL(asset) {
  return asset && /^\/api\/play\/media\/[a-f0-9]{32}$/.test(asset.url) ? asset.url : '';
}

export function renderEntry(entry) {
  const box = node('article', 'entry');
  if (entry.label) box.append(node('h3', '', entry.label));
  if (entry.text) {
    box.append(node('p', 'child-words', entry.text));
    box.append(button('Read my words', () => say(entry.text), 'mid no-print'));
  }
  const photoURL = mediaURL(entry.photo);
  if (photoURL) {
    const image = node('img', 'original');
    image.src = photoURL;
    image.alt = entry.label ? `Original picture: ${entry.label}` : 'My original picture or writing';
    image.loading = 'lazy';
    const link = node('a');
    link.href = photoURL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.append(image);
    box.append(link);
  }
  const audioURL = mediaURL(entry.audio);
  if (audioURL) {
    const audio = node('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = audioURL;
    audio.setAttribute('aria-label', entry.label || 'My original recording');
    box.append(audio);
  }
  return box;
}

let captureNumber = 0;
export function capture(container, { label = 'Tell or show me', writing = false } = {}) {
  const id = `capture-${++captureNumber}`;
  const box = node('fieldset', 'capture no-print');
  box.append(node('legend', '', label));
  const textLabel = node('label', '', 'My words');
  textLabel.htmlFor = `${id}-text`;
  const text = node('textarea');
  text.id = textLabel.htmlFor;
  text.rows = 3;
  text.maxLength = 12000;
  text.placeholder = writing ? 'Write on paper and take a photo, type here, or tell it aloud.' : 'Type here, add a picture, or record your voice.';
  const actions = node('div', 'actions');
  const photoInput = node('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/jpeg,image/png,image/webp';
  photoInput.setAttribute('capture', 'environment');
  photoInput.id = `${id}-photo`;
  const photoLabel = node('label', 'mid file-button', 'Take / add photo');
  photoLabel.htmlFor = photoInput.id;
  photoLabel.append(photoInput);
  const audioInput = node('input');
  audioInput.type = 'file';
  audioInput.accept = 'audio/*';
  audioInput.id = `${id}-audio`;
  const audioLabel = node('label', 'mid file-button', 'Add a recording');
  audioLabel.htmlFor = audioInput.id;
  audioLabel.append(audioInput);
  const photoPreview = node('img', 'capture-photo');
  photoPreview.alt = 'My original photo';
  photoPreview.hidden = true;
  const audioPreview = node('audio');
  audioPreview.controls = true;
  audioPreview.hidden = true;
  const status = node('p', 'muted');
  status.setAttribute('role', 'status');
  const proposal = node('div', 'transcript-proposal');
  proposal.hidden = true;
  const proposalLabel = node('label', '', 'Words the helper heard or read — you can change them');
  const candidate = node('textarea');
  candidate.id = `${id}-candidate`;
  candidate.rows = 3;
  proposalLabel.htmlFor = candidate.id;
  const uncertainty = node('p', 'notice');
  proposal.append(uncertainty, proposalLabel, candidate,
    button('Hear these words', () => say(candidate.value)),
    button('Use these words', () => {
      text.value = candidate.value;
      proposal.hidden = true;
      status.textContent = 'These words are yours to change. Your original is kept too.';
    }),
    button('Keep my words instead', () => { proposal.hidden = true; }));
  let photo = null, audio = null, seconds = 0, stream = null, recorder = null, timer = null;
  let starting = false, dead = false, generation = 0, copying = null, copyingAudio = null;
  let photoVersion = 0, audioVersion = 0, finishing = false;
  let lastRead = null;

  function release(item) { if (item?.url) URL.revokeObjectURL(item.url); }
  function item(file) { return { file, url: URL.createObjectURL(file), asset: null, pending: null }; }
  async function upload(media) {
    if (!media) return null;
    if (media.asset) return media.asset;
    if (!media.pending) {
      const form = new FormData();
      const name = media.file.name || (media.file.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
      form.append('file', media.file, name);
      media.pending = api('/api/play/upload', { method: 'POST', body: form })
        .then(result => { media.asset = result; return result; })
        .finally(() => { media.pending = null; });
    }
    return media.pending;
  }
  function stopTracks() { stream?.getTracks().forEach(t => t.stop()); stream = null; clearInterval(timer); timer = null; }
  function stopRecording() {
    if (recorder?.state === 'recording') { finishing = true; recorder.stop(); }
  }
  function chooseProposal(result, message, token) {
    if (dead || token !== generation) return;
    candidate.value = result.text || '';
    uncertainty.textContent = message;
    proposal.hidden = false;
    candidate.focus();
  }
  const record = button('Record my voice', async () => {
    if (recorder?.state === 'recording') { stopRecording(); return; }
    if (starting || finishing) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record here. Add a recording or type your words instead.');
    starting = true;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const token = generation;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (dead || token !== generation) { stopTracks(); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      const chunks = [];
      const started = performance.now();
      const activeRecorder = recorder;
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { stopTracks(); record.textContent = 'Record my voice'; status.textContent = 'Recording stopped. Try again or add a recording.'; };
      recorder.onstop = () => {
        finishing = false;
        stopTracks();
        record.textContent = 'Record my voice';
        if (dead || token !== generation) return;
        release(audio);
        seconds = Math.min(180, (performance.now() - started) / 1000);
        audio = item(new Blob(chunks, { type: activeRecorder.mimeType || mime || 'audio/webm' }));
        audioPreview.src = audio.url;
        audioPreview.hidden = false;
        status.textContent = 'Your recording is ready. Listen, save it, or turn it into words.';
      };
      recorder.start();
      record.textContent = 'Stop recording';
      timer = setInterval(() => {
        const elapsed = Math.floor((performance.now() - started) / 1000);
        status.textContent = `Recording: ${elapsed} seconds. Tap Stop when you are ready.`;
        if (elapsed >= 180) stopRecording();
      }, 500);
    } catch (error) { stopTracks(); throw error; }
    finally { starting = false; }
  });
  const transcribe = button('Turn my recording into words', async () => {
    if (recorder?.state === 'recording' || starting || finishing) throw new Error('Stop recording first so we can keep the whole recording.');
    await copyingAudio;
    if (!audio) throw new Error('Record your voice or add a recording first.');
    const token = generation;
    const selected = audio;
    const asset = await upload(selected);
    status.textContent = 'Listening to your recording…';
    const result = await api('/api/play/transcribe', json('POST', { asset_id: asset.id, seconds: seconds || 180 }));
    if (selected === audio) chooseProposal(result, 'Is this what you said? Fix anything you want before using these words.', token);
    status.textContent = 'Your original recording is kept.';
  });
  const recognize = button('Read my writing', async () => {
    await copying;
    if (!photo) throw new Error('Take a photo of your writing first.');
    const token = generation;
    const selected = photo;
    const asset = await upload(selected);
    status.textContent = 'Looking at your writing…';
    const result = await api('/api/play/recognize', json('POST', { asset_id: asset.id }));
    if (selected === photo) chooseProposal(result, result.uncertain
      ? "I couldn't read every word. You can say it, type it, or keep just your photo. Your writing is not being graded."
      : 'Did I read your words right? Change anything before using them. Your photo stays exactly as it is.', token);
    status.textContent = 'Your original writing is kept.';
  });
  actions.append(photoLabel, record, audioLabel, button('Read my words', () => say(text.value)));
  const helpers = node('div', 'actions');
  if (writing) helpers.append(recognize);
  helpers.append(transcribe);
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    const token = generation, version = ++photoVersion;
    // Copy file bytes immediately: Android camera file references can be revoked later.
    copying = (async () => {
      if (file.size > 25 * 1024 * 1024) throw new Error('That picture is over 25 MB. Take a smaller photo.');
      const copied = new File([await file.arrayBuffer()], file.name, { type: file.type });
      if (dead || token !== generation || version !== photoVersion) return;
      release(photo);
      photo = item(copied);
      photoPreview.src = photo.url;
      photoPreview.hidden = false;
      proposal.hidden = true;
      status.textContent = 'Original photo ready. It will not be painted over or corrected.';
    })();
    copying.catch(showError);
  });
  audioInput.addEventListener('change', () => {
    const file = audioInput.files?.[0];
    audioInput.value = '';
    if (!file) return;
    if (recorder?.state === 'recording' || starting || finishing) { showError(new Error('Stop your recording before adding another one.')); return; }
    const token = generation, version = ++audioVersion;
    copyingAudio = (async () => {
      if (file.size > 25 * 1024 * 1024) throw new Error('That recording is over 25 MB. Choose a shorter recording.');
      const copied = new File([await file.arrayBuffer()], file.name, { type: file.type });
      if (dead || token !== generation || version !== audioVersion) return;
      release(audio);
      audio = item(copied);
      seconds = 0;
      audioPreview.src = audio.url;
      audioPreview.hidden = false;
      proposal.hidden = true;
      status.textContent = 'Original recording ready.';
    })();
    copyingAudio.catch(showError);
  });
  audioPreview.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audioPreview.duration) && audioPreview.duration > 0) seconds = Math.min(300, audioPreview.duration);
  });
  box.append(textLabel, text, actions, photoPreview, audioPreview, helpers, status, proposal);
  container.append(box);
  function clear(force = false) {
    if (!force && lastRead && (lastRead.text !== text.value || lastRead.photo !== photo || lastRead.audio !== audio ||
        lastRead.photoVersion !== photoVersion || lastRead.audioVersion !== audioVersion || starting || finishing || recorder?.state === 'recording')) {
      status.textContent = 'Your saved page is safe. New changes are still here to save next.';
      return;
    }
    lastRead = null;
    generation++;
    stopRecording(); stopTracks();
    release(photo); release(audio);
    photo = null; audio = null; seconds = 0; copying = null; copyingAudio = null;
    text.value = ''; candidate.value = '';
    photoPreview.removeAttribute('src'); photoPreview.hidden = true;
    audioPreview.pause(); audioPreview.removeAttribute('src'); audioPreview.hidden = true;
    proposal.hidden = true; status.textContent = ''; record.textContent = 'Record my voice';
  }
  function leave() { generation++; stopRecording(); stopTracks(); }
  window.addEventListener('pagehide', leave);
  return {
    async read() {
      if (starting || finishing || recorder?.state === 'recording') throw new Error('Finish recording before saving so the whole recording is kept.');
      box.disabled = true;
      try {
        await Promise.all([copying, copyingAudio]);
        const selectedPhoto = photo, selectedAudio = audio, words = text.value;
        const result = { text: words, photo: await upload(selectedPhoto), audio: await upload(selectedAudio), seconds };
        lastRead = { text: words, photo: selectedPhoto, audio: selectedAudio, photoVersion, audioVersion };
        return result;
      } finally { box.disabled = false; }
    },
    setText(value) { text.value = value; },
    hasContent() { return !!(text.value.trim() || photo || audio || copying || copyingAudio || starting || finishing || recorder?.state === 'recording'); },
    clear,
    destroy() { dead = true; clear(true); window.removeEventListener('pagehide', leave); box.remove(); },
  };
}
