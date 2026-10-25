// Number Race (a.k.a. Race to the Top): roll two dice, add them, fill a box in that number's
// column. The first column to reach the top wins. Players each cheer for a number.
import { loadShell, say } from "./shell.js";

const $ = (id) => document.getElementById(id);
const NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const SETTINGS_KEY = "number-race-settings";

const status = await loadShell("Number Race");
const PLAYERS = [
  { id: "kid", name: status.kid_name, emoji: "🦖", color: "#ff7a45" },
  { id: "mom", name: "Mom", emoji: "👩", color: "#c46bff" },
  { id: "dad", name: "Dad", emoji: "👨", color: "#2fa8ff" },
];

const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const settings = { playing: saved.playing || ["kid"], auto: saved.auto ?? false, rows: saved.rows || 8 };
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

// ---------------------------------------------------------------- 1. setup

function renderSetup() {
  $("who").replaceChildren(...PLAYERS.map((p) =>
    chip(`${p.emoji} ${p.name}`, settings.playing.includes(p.id), () => {
      const on = settings.playing.includes(p.id);
      if (on && settings.playing.length === 1) return;   // someone has to play
      settings.playing = on ? settings.playing.filter((id) => id !== p.id) : [...settings.playing, p.id];
      renderSetup();
    }, p.color)));
  for (const b of document.querySelectorAll("#adder .chip")) {
    b.classList.toggle("on", String(settings.auto) === b.dataset.auto);
    b.onclick = () => { settings.auto = b.dataset.auto === "true"; renderSetup(); };
  }
  for (const b of document.querySelectorAll("#length .chip")) {
    b.classList.toggle("on", String(settings.rows) === b.dataset.rows);
    b.onclick = () => { settings.rows = Number(b.dataset.rows); renderSetup(); };
  }
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
    counts: Object.fromEntries(NUMBERS.map((n) => [n, 0])),
    turn: 0,
    phase: "pick",
    dice: [1, 1],
    misses: 0,
  };
  show("pick");
  nextPick();
}

function nextPick() {
  const picker = game.players.find((p) => p.pick == null);
  if (!picker) return startRace();
  $("pick-title").textContent = `${picker.emoji} ${picker.name}, pick your number!`;
  say(`${picker.name}, pick your number!`);
  $("pick-grid").replaceChildren(...NUMBERS.map((n) => {
    const taken = game.players.find((p) => p.pick === n);
    const b = document.createElement("button");
    b.className = "pick-num";
    b.style.setProperty("--c", hue(n));
    b.textContent = taken ? `${taken.emoji}` : n;
    b.disabled = Boolean(taken);
    b.onclick = () => { picker.pick = n; say(`${n}!`); nextPick(); };
    return b;
  }));
}

// ---------------------------------------------------------------- 3. race

function startRace() {
  game.phase = "roll";
  $("board").style.setProperty("--rows", game.rows);
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
  for (const die of document.querySelectorAll("#dice .die")) drawDie(die, 1);
  $("dice").classList.add("idle");
  show("race");
  updateTurn();
  setPrompt("Tap Roll!");
}

function updateTurn() {
  const p = game.players[game.turn % game.players.length];
  $("turn").textContent = game.players.length > 1 ? `${p.emoji} ${p.name}'s turn` : `${p.emoji} ${p.name}`;
  $("turn").style.setProperty("--pc", p.color);
}

function setPrompt(text) { $("prompt").textContent = text; }

$("roll").onclick = async () => {
  if (game.phase !== "roll") return;
  game.phase = "rolling";
  $("roll").disabled = true;
  const dice = [...document.querySelectorAll("#dice .die")];
  $("dice").classList.remove("idle");
  $("dice").classList.add("tumble");
  setPrompt("");
  for (let t = 0; t < 10; t++) {
    dice.forEach((d) => drawDie(d, d6()));
    await new Promise((r) => setTimeout(r, 70));
  }
  game.dice = [d6(), d6()];
  dice.forEach((d, i) => drawDie(d, game.dice[i]));
  $("dice").classList.remove("tumble");
  game.misses = 0;
  if (game.auto) {
    game.phase = "filling";
    const sum = game.dice[0] + game.dice[1];
    setPrompt(`${game.dice[0]} + ${game.dice[1]} = ${sum}`);
    setTimeout(() => fill(sum), 700);
  } else {
    game.phase = "answer";
    $("board").classList.add("asking");
    setPrompt("How many dots altogether? Tap that number!");
    say("How many dots altogether?");
  }
};

function answer(n) {
  if (game.phase !== "answer") return;
  const sum = game.dice[0] + game.dice[1];
  const col = document.querySelector(`.col[data-n="${n}"]`);
  if (n !== sum) {
    game.misses += 1;
    col.classList.remove("nope");
    void col.offsetWidth;   // restart the shake
    col.classList.add("nope");
    if (game.misses >= 2) {
      setPrompt(`${game.dice[0]} + ${game.dice[1]} = ${sum}. Tap ${sum}!`);
      document.querySelector(`.col[data-n="${sum}"]`).classList.add("hint");
      say(`${game.dice[0]} plus ${game.dice[1]} is ${sum}. Tap ${sum}!`);
    } else {
      setPrompt("Not quite! Count all the dots.");
      say("Not quite! Count all the dots.");
    }
    return;
  }
  $("board").classList.remove("asking");
  setPrompt(`${game.dice[0]} + ${game.dice[1]} = ${sum} ✔️`);
  fill(sum);
}

function fill(n) {
  const col = document.querySelector(`.col[data-n="${n}"]`);
  col.classList.remove("hint");
  const cell = col.querySelectorAll(".cell")[game.counts[n]];
  game.counts[n] += 1;
  cell.textContent = n;
  cell.classList.add("filled");
  say(`${game.dice[0]} plus ${game.dice[1]} is ${n}!`);
  if (game.counts[n] === game.rows) return win(n);
  game.turn += 1;
  game.phase = "roll";
  $("roll").disabled = false;
  updateTurn();
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
  } else {
    // Nobody picked it: the closest pick to the winner gets a cheer.
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
