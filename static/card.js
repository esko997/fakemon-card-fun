// Builds card DOM from the server's card JSON, styled after the trading card game's Mega Evolution era.
// All model-written text goes through textContent.

const SVG_NS = "http://www.w3.org/2000/svg";

// disc: energy symbol colors (main, light, dark). frame: card body colors. ink: text color on the frame.
export const TYPES = {
  grass:     { disc: ["#5fb33a", "#c8f08a", "#2f7a1b"], frame: ["#a9d94e", "#dcf294"], ink: "#111" },
  fire:      { disc: ["#e8492e", "#ffb08a", "#a5200f"], frame: ["#f29a5c", "#fcd5ad"], ink: "#111" },
  water:     { disc: ["#2d9ee3", "#a6dcff", "#11619a"], frame: ["#7cc3ee", "#d2ecfb"], ink: "#111" },
  lightning: { disc: ["#f5cf1d", "#fff3a0", "#b38f00"], frame: ["#f2d447", "#fbf1ac"], ink: "#111" },
  psychic:   { disc: ["#9c56b8", "#e1b8ef", "#5f2a78"], frame: ["#c897d6", "#eed7f4"], ink: "#111" },
  fighting:  { disc: ["#c46a2c", "#f2b47c", "#7b3b11"], frame: ["#d9925c", "#f3d1ae"], ink: "#111" },
  darkness:  { disc: ["#2f5560", "#7aa6b0", "#10262c"], frame: ["#3d5961", "#6d8990"], ink: "#fff" },
  metal:     { disc: ["#a7b1b6", "#eef3f5", "#5d676c"], frame: ["#b9c3c8", "#e8eef1"], ink: "#111" },
  dragon:    { disc: ["#b39b2c", "#ecdc86", "#6e5c0c"], frame: ["#cdb95a", "#efe4a6"], ink: "#111" },
  colorless: { disc: ["#e4e4e4", "#ffffff", "#9a9a9a"], frame: ["#d6d6d6", "#f7f7f7"], ink: "#111" },
};

// Black glyphs on a 100x100 canvas; class "hole" is filled with the disc color to cut details out.
function star(points, outer, inner) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}

const GLYPHS = {
  grass: `<path d="M50 8C76 22 88 48 74 72C66 86 52 92 50 92C48 92 34 86 26 72C12 48 24 22 50 8Z"/>
    <path class="hole" d="M48.5 30h3v58h-3zM50 44l16-10 1.6 2.4-16 10zM50 58l18-11 1.6 2.4-18 11zM50 44L34 34l-1.6 2.4 16 10zM50 58L32 47l-1.6 2.4 18 11z"/>`,
  fire: `<path d="M50 6C58 26 80 34 78 60C77 80 64 93 50 93C35 93 22 82 22 64C22 47 33 40 37 26C42 38 46 43 50 45C55 35 55 21 50 6Z"/>
    <path class="hole" d="M50 58C57 66 62 73 60 80C58 86 54 88 50 88C45 88 41 85 41 79C41 72 47 67 50 58Z"/>`,
  water: `<path d="M50 6C63 30 81 47 81 64C81 81 67 93 50 93C33 93 19 81 19 64C19 47 37 30 50 6Z"/>
    <path class="hole" d="M33 64C33 54 39 46 43 41C40 50 39 58 41 66C42 72 46 76 50 78C41 78 33 73 33 64Z"/>`,
  lightning: `<polygon points="60,4 20,56 46,56 36,96 80,40 54,40 68,4"/>`,
  psychic: `<path d="M4 50C24 22 76 22 96 50C76 78 24 78 4 50Z"/>
    <path class="hole" d="M17 50C33 33 67 33 83 50C67 67 33 67 17 50Z"/>
    <circle cx="50" cy="50" r="14"/><circle class="hole" cx="55" cy="45" r="4.5"/>`,
  fighting: `<rect x="22" y="40" width="58" height="46" rx="12"/>
    <rect x="24" y="20" width="13" height="26" rx="6.5"/><rect x="38" y="16" width="13" height="30" rx="6.5"/>
    <rect x="52" y="17" width="13" height="29" rx="6.5"/><rect x="66" y="22" width="13" height="26" rx="6.5"/>
    <path class="hole" d="M37 47h3v12h-3zM51 47h3v12h-3zM65 47h3v12h-3z"/>
    <path d="M14 62c2-8 10-10 16-6l10 8-6 8-12-6c-5-1-8 0-8-4z"/>`,
  darkness: `<path d="M62 8C36 10 16 30 16 55C16 77 33 93 55 93C70 93 82 86 89 74C80 79 72 80 64 78C46 74 36 58 38 40C40 26 49 15 62 8Z"/>
    <circle cx="66" cy="44" r="7"/>`,
  metal: `<polygon points="50,8 94,86 6,86"/><polygon class="hole" points="50,34 74,76 26,76"/><polygon points="50,50 61,70 39,70"/>`,
  dragon: `<path d="M24 90C12 62 26 26 66 8C52 28 50 44 58 56C66 68 80 68 90 58C86 82 60 96 24 90Z"/>
    <path class="hole" d="M38 74C34 60 40 44 52 36C48 48 48 58 54 66C46 68 42 70 38 74Z"/>`,
  colorless: star(6, 42, 20),
};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function energy(type, extra = "") {
  const t = TYPES[type] || TYPES.colorless;
  const [main, light, dark] = t.disc;
  const el = h("span", {
    class: `energy ${extra}`,
    style: `--c:${main};--cl:${light};--cd:${dark}`,
    title: type,
    "aria-label": `${type} energy`,
  });
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.innerHTML = GLYPHS[type] || GLYPHS.colorless;   // static, trusted markup
  el.append(svg);
  return el;
}

const RARITY = { common: "●", uncommon: "◆", rare: "★" };
const STAGE = { "Basic": "BASIC", "Stage 1": "STAGE1", "Stage 2": "STAGE2" };

function setNumber(id) {
  // "/151" for the original set; past 151 it reads like a secret rare (152/151).
  return `${String(id).padStart(3, "0")}/151`;
}

function front(card, { kidName, onAttack }) {
  const s = card.stats;
  const t = TYPES[s.type] || TYPES.colorless;
  const ex = s.kind === "ex" || s.kind === "mega_ex";
  const mega = s.kind === "mega_ex";
  const holo = ex || s.rarity === "rare";

  const art = h("div", { class: "art" },
    card.art_url ? h("img", { src: card.art_url, alt: s.name }) : null,
    holo && !ex ? h("div", { class: "holo" }) : null,
  );
  if (card.status === "working") {
    art.append(h("div", { class: "pending" }, h("img", { src: card.drawing_url, alt: "" }), h("span", {}, "🎨 Painting…")));
  }

  const moves = h("div", { class: "moves" },
    s.ability && h("div", { class: "ability" },
      h("div", { class: "ability-head" }, h("span", { class: "label" }, "Ability"), h("span", { class: "title" }, s.ability.name)),
      h("div", { class: "move-text" }, s.ability.text),
    ),
    s.attacks.map((a, i) =>
      h("div", {
        class: `attack ${onAttack ? "tappable" : ""}`,
        onclick: onAttack ? (e) => { e.stopPropagation(); onAttack(i); } : null,
      },
        h("div", { class: "atk-head" },
          h("span", { class: "cost" }, a.cost.map((c) => energy(c))),
          h("span", { class: "title" }, a.name),
          h("span", { class: "dmg" }, a.damage),
        ),
        a.text && h("div", { class: "move-text" }, a.text),
      )),
  );

  const baseName = mega ? s.name.replace(/^Mega\s+/i, "") : s.name;

  return h("div", {
    class: `face front ${ex ? "ex" : ""} ${mega ? "mega" : ""}`,
    style: `--frame:${t.frame[0]};--frame-light:${t.frame[1]};--ink:${t.ink}`,
  },
    h("div", { class: "inner" },
      ex ? art : null,
      h("div", { class: "top" },
        h("span", { class: "stage" }, STAGE[s.stage] || "BASIC"),
        h("span", { class: "name" }, s.name, ex ? h("span", { class: "ex-mark" }, "ex") : null),
        h("span", { class: "hp" }, h("small", {}, "HP"), h("b", {}, s.hp)),
        energy(s.type, "type-badge"),
      ),
      (s.evolves_from || mega) && h("div", { class: "evolves" },
        s.evolves_from && h("span", { class: "from" }, `Evolves from ${s.evolves_from}`),
        mega && h("span", { class: "mega-tag" }, `The Mega-Evolved form of ${baseName}`),
      ),
      ex ? h("div", { class: "art-spacer" }) : art,
      ex ? null : h("div", { class: "dex" },
        `NO. ${String(card.id).padStart(4, "0")}  ${s.species} Fakemon  HT: ${s.height}  WT: ${s.weight}`),
      moves,
      h("div", { class: "wrr" },
        h("span", { class: "seg" }, h("i", {}, "weakness"), s.weakness ? [energy(s.weakness), h("b", {}, "×2")] : null),
        h("span", { class: "divider" }),
        h("span", { class: "seg" }, h("i", {}, "resistance"), s.resistance ? [energy(s.resistance), h("b", {}, "-30")] : null),
        h("span", { class: "slash" }),
        h("span", { class: "seg" }, h("i", {}, "retreat"), Array.from({ length: s.retreat }, () => energy("colorless"))),
      ),
      h("div", { class: "bottom" },
        h("div", { class: "credit" },
          h("span", { class: "illus" }, `Illus. ${kidName}`),
          h("span", { class: "setline" },
            h("span", { class: "reg" }, kidName.charAt(0).toUpperCase()),
            h("span", { class: "setcode" }, "FKM", h("small", {}, "EN")),
            setNumber(card.id),
            h("span", { class: "rarity" }, ex ? "★★" : RARITY[s.rarity] || "●"),
          ),
        ),
        ex
          ? h("div", { class: "rule" },
              h("span", { class: "rule-name" }, mega ? "Mega Evolution ex rule" : "Fakemon ex rule"),
              h("span", { class: "rule-text" },
                mega
                  ? "When your Mega Evolution Fakemon ex is Knocked Out, your opponent takes 3 Prize cards."
                  : "When your Fakemon ex is Knocked Out, your opponent takes 2 Prize cards."))
          : h("div", { class: "flavor" }, s.flavor),
      ),
      h("div", { class: "copyright" }, `©${new Date(card.created_at).getFullYear()} ${kidName} / Fakemon Card Maker`),
      ex ? h("div", { class: "holo" }) : null,
    ),
  );
}

function back(card, { kidName }) {
  return h("div", { class: "face back" },
    h("div", { class: "paper" },
      h("div", { class: "drawing" }, h("img", { src: card.drawing_url, alt: "Original drawing" })),
      h("div", { class: "by" }, `Drawn by ${kidName}`),
      card.transcript && h("div", { class: "story" }, `“${card.transcript}”`),
    ),
  );
}

/** A flippable card. Starts showing the front unless `flipped` is set. */
export function renderCard(card, { kidName, onAttack = null, flipped = false } = {}) {
  return h("div", { class: `card ${flipped ? "flipped" : ""}` },
    h("div", { class: "flipper" }, front(card, { kidName, onAttack }), back(card, { kidName })),
  );
}

/** Shrink the move text until it fits; call once the card is in the DOM and visible. */
export function fitCard(cardEl) {
  const moves = cardEl.querySelector(".moves");
  if (!moves || !moves.clientHeight) return;
  let fit = 1;
  moves.style.setProperty("--fit", fit);
  while (moves.scrollHeight > moves.clientHeight + 1 && fit > 0.55) {
    fit -= 0.05;
    moves.style.setProperty("--fit", fit.toFixed(2));
  }
}

const clamp = (v) => Math.max(0, Math.min(100, v));

/** Holo shine follows the finger / mouse / tablet tilt. */
export function attachShine(cardEl) {
  const set = (x, y) => {
    for (const holo of cardEl.querySelectorAll(".holo")) {
      holo.style.setProperty("--mx", `${clamp(x)}%`);
      holo.style.setProperty("--my", `${clamp(y)}%`);
    }
  };
  cardEl.addEventListener("pointermove", (e) => {
    const r = cardEl.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  const tilt = (e) => {
    if (!cardEl.isConnected) return window.removeEventListener("deviceorientation", tilt);
    if (e.gamma == null) return;
    set(50 + e.gamma * 2, 50 + (e.beta - 45) * 2);
  };
  window.addEventListener("deviceorientation", tilt);
}

/** Words for speechSynthesis. */
export function cardSpeech(card) {
  const s = card.stats;
  const ex = s.kind === "ex" || s.kind === "mega_ex";
  const parts = [`${s.name}${ex ? " ex" : ""}! ${s.hp} HP. ${s.type} type.`];
  if (s.ability) parts.push(`Ability: ${s.ability.name}. ${s.ability.text}`);
  for (const a of s.attacks) {
    parts.push(`Attack: ${a.name}${a.damage ? `, ${a.damage.replace("×", " times").replace("+", " plus")} damage` : ""}. ${a.text}`);
  }
  if (!ex) parts.push(s.flavor);
  return parts.join(" ");
}
