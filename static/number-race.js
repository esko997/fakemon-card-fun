// Number Race (a.k.a. Race to the Top): roll two dice, add them, fill a box in that number's
// column. The first column to reach the top wins. Players each cheer for a number; Robo, the
// computer player, can join. Dice can be rolled on the tablet or with real dice at the table.
import { loadShell, say } from "./shell.js";

const $ = (id) => document.getElementById(id);
const NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const SETTINGS_KEY = "number-race-settings";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const status = await loadShell("Number Race");
// Robo goes last so humans pick their numbers first.
const PLAYERS = [
  { id: "kid", name: status.kid_name, emoji: "🦖", color: "#ff7a45" },
  { id: "mom", name: "Mom", emoji: "👩", color: "#c46bff" },
  { id: "dad", name: "Dad", emoji: "👨", color: "#2fa8ff" },
  { id: "robot", name: "Robo", emoji: "🤖", color: "#9fb3c8", robot: true },
];

const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const settings = {
  playing: saved.playing || ["kid"],
  auto: saved.auto ?? false,
  rows: saved.rows || 8,
  robotLevel: saved.robotLevel || "smart",
  dice: saved.dice || "tablet",
};
let game = null;

// ---------------------------------------------------------------- helpers

function show(name) {
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === name);
}

/** A fair die roll, 1-6. */
function d6() {
  const buf = new Uint8Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= 252);   // 252 = 6 * 42, no modulo bias
  return (buf[0] % 6) + 1;
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

/** Each number 2..12 gets its own hue so columns are easy to tell apart. */
const hue = (n) => `hsl(${Math.round(((n - 2) / 11) * 300)}deg 75% 55%)`;
const ways = (n) => 6 - Math.abs(7 - n);   // how many dice combinations make n

function drawDie(el, value) {
  el.replaceChildren(...Array.from({ length: 9 }, (_, i) => {
    const pip = document.createElement("span");
    if (PIPS[value]?.includes(i)) pip.className = "on";
    return pip;
  }));
}

function chip(label, on, onClick, color) {
  const b = document.createElement("button");
  b.className = `chip ${on ? "on" : ""}`;
  b.textContent = label;
  if (color) b.style.setProperty("--pc", color);
  b.onclick = onClick;
  return b;
}

/** Wire a row of preset chips (data-<key>) to a setting. */
function bindChips(rowId, key, parse) {
  for (const b of document.querySelectorAll(`#${rowId} .chip`)) {
    const value = parse(Object.values(b.dataset)[0]);
    b.classList.toggle("on", settings[key] === value);
    b.onclick = () => { settings[key] = value; renderSetup(); };
  }
}

// ---------------------------------------------------------------- 1. setup

function renderSetup() {
  $("who").replaceChildren(...PLAYERS.map((p) =>
    chip(`${p.emoji} ${p.name}`, settings.playing.includes(p.id), () => {
      const on = settings.playing.includes(p.id);
      const next = on ? settings.playing.filter((id) => id !== p.id) : [...settings.playing, p.id];
      if (!next.some((id) => id !== "robot")) return;   // at least one person has to play
      settings.playing = next;
      renderSetup();
    }, p.color)));
  $("robot-row").hidden = !settings.playing.includes("robot");
  bindChips("robot-level", "robotLevel", String);
  bindChips("dice-mode", "dice", String);
  bindChips("adder", "auto", (v) => v === "true");
  bindChips("length", "rows", Number);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

$("go").onclick = () => startPicking();
$("rules-btn").onclick = () => say(
  "Number Race! Roll two dice and add up the dots. Find that number and fill in a box above it. " +
  "Everybody picks a number to cheer for. The first number to reach the top wins!");

// ---------------------------------------------------------------- 2. pick numbers

function startPicking() {
  game = {
    players: PLAYERS.filter((p) => settings.playing.includes(p.id)).map((p) => ({ ...p, pick: null })),
    rows: settings.rows,
    auto: settings.auto,
    realDice: settings.dice === "real",
    robotLevel: settings.robotLevel,
    counts: Object.fromEntries(NUMBERS.map((n) => [n, 0])),
    turn: 0,
    phase: "pick",
    dice: [1, 1],
    entered: [null, null],
    misses: 0,
  };
  show("pick");
  nextPick();
}

function renderPickGrid(onPick) {
  $("pick-grid").replaceChildren(...NUMBERS.map((n) => {
    const taken = game.players.find((p) => p.pick === n);
    const b = document.createElement("button");
    b.className = "pick-num";
    b.style.setProperty("--c", hue(n));
    b.textContent = taken ? `${taken.emoji}` : n;
    b.disabled = Boolean(taken) || !onPick;
    if (onPick) b.onclick = () => onPick(n);
    return b;
  }));
}

async function nextPick() {
  const picker = game.players.find((p) => p.pick == null);
  if (!picker) return startRace();
  if (picker.robot) {
    $("pick-title").textContent = "🤖 Robo is thinking…";
    renderPickGrid(null);
    await wait(1200);
    const free = NUMBERS.filter((n) => !game.players.some((p) => p.pick === n));
    // Smart Robo knows the middle numbers are easiest to roll; silly Robo picks anything.
    const best = Math.max(...free.map(ways));
    picker.pick = game.robotLevel === "smart" ? pickRandom(free.filter((n) => ways(n) === best)) : pickRandom(free);
    $("pick-title").textContent = `🤖 Robo picks ${picker.pick}!`;
    say(`Robo picks ${picker.pick}!`);
    renderPickGrid(null);
    await wait(1300);
    return nextPick();
  }
  $("pick-title").textContent = `${picker.emoji} ${picker.name}, pick your number!`;
  say(`${picker.name}, pick your number!`);
  renderPickGrid((n) => { picker.pick = n; say(`${n}!`); nextPick(); });
}

// ---------------------------------------------------------------- 3. race

function startRace() {
  $("board").replaceChildren(...NUMBERS.map((n) => {
    const col = document.createElement("div");
    col.className = "col";
    col.dataset.n = n;
    col.style.setProperty("--c", hue(n));
    const cells = document.createElement("div");
    cells.className = "cells";
    for (let i = 0; i < game.rows; i++) cells.append(Object.assign(document.createElement("div"), { className: "cell" }));
    const label = Object.assign(document.createElement("div"), { className: "label", textContent: n });
    const fans = Object.assign(document.createElement("div"), { className: "fans" });
    fans.textContent = game.players.filter((p) => p.pick === n).map((p) => p.emoji).join("");
    col.append(cells, label, fans);
    col.onclick = () => answer(n);
    return col;
  }));
  buildFaceButtons();
  show("race");
  startTurn();
}

const current = () => game.players[game.turn % game.players.length];
function setPrompt(text) { $("prompt").textContent = text; }

function startTurn() {
  const p = current();
  $("turn").textContent = game.players.length > 1 ? `${p.emoji} ${p.name}'s turn` : `${p.emoji} ${p.name}`;
  $("turn").style.setProperty("--pc", p.color);
  for (const die of document.querySelectorAll("#dice .die")) drawDie(die, 0);
  $("dice").classList.add("idle");
  $("real-dice").hidden = true;
  $("roll").hidden = false;
  if (p.robot) {
    // Robo always rolls the tablet's dice, even when the people use real ones.
    game.phase = "robot";
    $("roll").disabled = true;
    setPrompt("🤖 Robo is rolling…");
    wait(900).then(rollTablet);
  } else if (game.realDice) {
    game.phase = "enter";
    game.entered = [null, null];
    renderFaceButtons();
    $("real-dice").hidden = false;
    $("roll").textContent = "✅ That's what I rolled!";
    $("roll").disabled = true;
    setPrompt("Roll your dice! Then tap what you got.");
  } else {
    game.phase = "roll";
    $("roll").textContent = "🎲 Roll!";
    $("roll").disabled = false;
    setPrompt("Tap Roll!");
  }
}

$("roll").onclick = () => {
  if (game.phase === "roll") rollTablet();
  else if (game.phase === "enter" && game.entered.every(Boolean)) {
    game.dice = [...game.entered];
    $("real-dice").hidden = true;
    afterRoll();
  }
};

async function rollTablet() {
  game.phase = "rolling";
  $("roll").disabled = true;
  const dice = [...document.querySelectorAll("#dice .die")];
  $("dice").classList.remove("idle");
  $("dice").classList.add("tumble");
  if (!current().robot) setPrompt("");
  for (let t = 0; t < 10; t++) {
    dice.forEach((d) => drawDie(d, d6()));
    await wait(70);
  }
  game.dice = [d6(), d6()];
  dice.forEach((d, i) => drawDie(d, game.dice[i]));
  $("dice").classList.remove("tumble");
  afterRoll();
}

// Real dice: tap the face each die landed on. ---------------------------------

function buildFaceButtons() {
  for (const row of document.querySelectorAll("#real-dice .face-row")) {
    row.replaceChildren(...[1, 2, 3, 4, 5, 6].map((v) => {
      const b = document.createElement("button");
      b.className = "face";
      b.dataset.v = v;
      b.setAttribute("aria-label", `${Number(row.dataset.die) === 0 ? "First" : "Second"} die: ${v}`);
      const die = Object.assign(document.createElement("div"), { className: "die mini" });
      drawDie(die, v);
      b.append(die);
      b.onclick = () => enterFace(Number(row.dataset.die), v);
      return b;
    }));
  }
}

function renderFaceButtons() {
  for (const row of document.querySelectorAll("#real-dice .face-row")) {
    const chosen = game.entered[Number(row.dataset.die)];
    for (const b of row.children) {
      const selected = Number(b.dataset.v) === chosen;
      b.classList.toggle("on", selected);
      b.setAttribute("aria-pressed", String(selected));
    }
  }
}

function enterFace(die, value) {
  if (game.phase !== "enter") return;
  game.entered[die] = value;
  drawDie(document.querySelectorAll("#dice .die")[die], value);
  $("dice").classList.toggle("idle", !game.entered.every(Boolean));
  renderFaceButtons();
  $("roll").disabled = !game.entered.every(Boolean);
}

// Adding -------------------------------------------------------------------------

function afterRoll() {
  game.misses = 0;
  $("roll").disabled = true;
  const [a, b] = game.dice;
  const sum = a + b;
  $("dice").classList.remove("idle");
  if (game.auto) {
    game.phase = "filling";
    setPrompt(`${a} + ${b} = ${sum}`);
    setTimeout(() => fill(sum), 700);
    return;
  }
  game.phase = "answer";
  $("board").classList.add("asking");
  $("roll").hidden = true;
  if (current().robot) {
    setPrompt("🤖 Can you help Robo add? Tap the number!");
    say("Can you help me add?");
  } else {
    setPrompt("How many dots altogether? Tap that number!");
    say("How many dots altogether?");
  }
}

function answer(n) {
  if (game.phase !== "answer") return;
  const [a, b] = game.dice;
  const sum = a + b;
  const col = document.querySelector(`.col[data-n="${n}"]`);
  if (n !== sum) {
    game.misses += 1;
    col.classList.remove("nope");
    void col.offsetWidth;   // restart the shake
    col.classList.add("nope");
    if (game.misses >= 2) {
      setPrompt(`${a} + ${b} = ${sum}. Tap ${sum}!`);
      document.querySelector(`.col[data-n="${sum}"]`).classList.add("hint");
      say(`${a} plus ${b} is ${sum}. Tap ${sum}!`);
    } else {
      setPrompt("Not quite! Count all the dots.");
      say("Not quite! Count all the dots.");
    }
    return;
  }
  $("board").classList.remove("asking");
  setPrompt(`${a} + ${b} = ${sum} ✔️${current().robot ? " Thanks!" : ""}`);
  fill(sum);
}

function fill(n) {
  game.phase = "filling";
  const col = document.querySelector(`.col[data-n="${n}"]`);
  col.classList.remove("hint");
  const cell = col.querySelectorAll(".cell")[game.counts[n]];
  game.counts[n] += 1;
  cell.textContent = n;
  cell.classList.add("filled");
  say(`${game.dice[0]} plus ${game.dice[1]} is ${n}!`);
  if (game.counts[n] === game.rows) return win(n);
  game.turn += 1;
  // A beat before the next turn, so the filled box and the sum can be seen.
  setTimeout(startTurn, current().robot ? 1100 : 400);
}

// ---------------------------------------------------------------- 4. winner

function win(n) {
  game.phase = "done";
  document.querySelector(`.col[data-n="${n}"]`).classList.add("winner");
  const fans = game.players.filter((p) => p.pick === n);
  $("win-title").textContent = `🏆 ${n} reached the top!`;
  let who;
  if (fans.length) {
    who = `${fans.map((p) => `${p.emoji} ${p.name}`).join(" & ")} ${fans.length > 1 ? "win" : "wins"}! 🎉`;
    if (fans.every((p) => p.robot) && game.players.length > 1) who += " Good game!";
  } else {
    // Nobody picked it: the pick that got furthest gets a cheer.
    const close = [...game.players].sort((a, b) => game.counts[b.pick] - game.counts[a.pick])[0];
    who = `Nobody picked ${n}! ${close.emoji} ${close.name}'s ${close.pick} got closest.`;
  }
  $("win-who").textContent = who;
  $("win-fact").textContent = ways(n) >= 5
    ? `Did you know? There are ${ways(n)} ways to make ${n} with two dice, so middle numbers win a lot!`
    : `Wow! There are only ${ways(n)} ${ways(n) === 1 ? "way" : "ways"} to make ${n} with two dice. That's a rare winner!`;
  setTimeout(() => {
    $("win").showModal();
    say(`${n} reached the top! ${who.replace(/[^\p{L}\p{N}!&.' ]/gu, "")}`);
  }, 600);
}

$("win-again").onclick = () => { $("win").close(); startPicking(); };
$("win-home").onclick = () => { location.href = "./"; };

// ---------------------------------------------------------------- boot

renderSetup();
show("setup");
