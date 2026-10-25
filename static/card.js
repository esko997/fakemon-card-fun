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

// Gold cards swap the type colors for gold (frame, body tint, overlays).
const GOLD = { frame: ["#d9b44a", "#f6e7ad"], ink: "#2b1d00" };

/** Foil on the art window. */
function artFoil(finish) {
  if (finish === "holo") return h("div", { class: "holo" });
  if (finish === "cosmos") return h("div", { class: "holo cosmos" });
  return null;
}

/** Foils over (or, for reverse holo, under) the whole card body. */
function cardFoils(finish, fullArt) {
  const out = [];
  if (finish === "gold") out.push(h("div", { class: "foil gold" }));
  if (finish === "rainbow") out.push(h("div", { class: "foil rainbow" }));
  if (finish === "sparkle") out.push(h("div", { class: "holo sparkle" }));
  if (finish === "reverse") out.push(h("div", { class: `holo ${fullArt ? "sparkle" : "reverse"}` }));
  if (fullArt || finish === "gold" || finish === "rainbow") out.push(h("div", { class: "holo" }));
  return out;
}

/** Set-line rarity symbol: rarer treatments outrank the printed rarity. */
function rarityMark(s) {
  const mark = s.finish === "gold" ? h("span", { class: "gold" }, "★★★")
    : s.finish === "rainbow" ? h("span", { class: "rainbow" }, "★★★")
    : s.kind === "ex" || s.kind === "mega_ex" ? "★★"
    : s.layout === "illustration" ? h("span", { class: "gold" }, "★")
    : RARITY[s.rarity] || "●";
  return s.shiny ? [h("span", { class: "shiny-star" }, "✦"), mark] : mark;
}

const shinyMark = (s) => (s.shiny ? h("span", { class: "shiny-mark", title: "Shiny" }, "✦") : null);

function faceClasses(s, ...extra) {
  return ["face", "front", `finish-${s.finish}`, s.shiny ? "shiny" : "", ...extra].filter(Boolean).join(" ");
}

function setNumber(id) {
  // "/151" for the original set; past 151 it reads like a secret rare (152/151).
  return `${String(id).padStart(3, "0")}/151`;
}

function artBox(card, foil) {
  const art = h("div", { class: "art" },
    card.art_url ? h("img", { src: card.art_url, alt: card.stats.name }) : null,
    foil,
  );
  if (card.status === "working") {
    art.append(h("div", { class: "pending" }, h("img", { src: card.drawing_url, alt: "" }), h("span", {}, "🎨 Painting…")));
  }
  return art;
}

function credit(card, kidName, rarityMark) {
  return h("div", { class: "credit" },
    h("span", { class: "illus" }, `Illus. ${kidName}`),
    h("span", { class: "setline" },
      h("span", { class: "reg" }, kidName.charAt(0).toUpperCase()),
      h("span", { class: "setcode" }, "FKM", h("small", {}, "EN")),
      setNumber(card.id),
      h("span", { class: "rarity" }, rarityMark),
    ),
  );
}

const copyright = (card, kidName) =>
  h("div", { class: "copyright" }, `©${new Date(card.created_at).getFullYear()} ${kidName} / Fakemon Card Maker`);

const TRAINER_LABEL = { item: "Item", supporter: "Supporter", stadium: "Stadium" };

const TRAINER_RULE = {
  item: "You may play any number of Item cards during your turn.",
  supporter: "You may play only 1 Supporter card during your turn.",
  stadium: "You may play only 1 Stadium card during your turn. It stays in play until another Stadium replaces it. You can't play a Stadium with the same name as the one in play.",
};

/** Trainer cards: silver body, subtype banner, effect text, rule pill. */
function trainerFront(card, { kidName }) {
  const s = card.stats;
  const label = TRAINER_LABEL[s.card_type];
  return h("div", { class: faceClasses(s, "trainer", s.card_type) },
    h("div", { class: "inner" },
      h("div", { class: "trainer-top" },
        h("span", { class: "subtype" }, label),
        h("span", { class: "trainer-word" }, "TRAINER"),
      ),
      h("div", { class: "trainer-name" }, s.name),
      artBox(card, artFoil(s.finish)),
      h("div", { class: "moves" }, h("div", { class: "effect" }, s.effect)),
      h("div", { class: "bottom" },
        credit(card, kidName, rarityMark(s)),
        h("div", { class: "trainer-rule" }, TRAINER_RULE[s.card_type]),
      ),
      copyright(card, kidName),
      cardFoils(s.finish, false),
    ),
  );
}

function front(card, opts) {
  const s = card.stats;
  if (s.card_type !== "pokemon") return trainerFront(card, opts);
  return s.layout === "vintage" ? vintageFront(card, opts) : pokemonFront(card, opts);
}

function attackRow(a, i, onAttack, ...children) {
  return h("div", {
    class: `attack ${onAttack ? "tappable" : ""}`,
    onclick: onAttack ? (e) => { e.stopPropagation(); onAttack(i); } : null,
  }, ...children);
}

/** The 1990s yellow-border layout: name and red "HP", gold art frame, italic info ribbon,
 *  ruled attack rows, weakness/resistance/retreat columns, boxed flavor text. */
function vintageFront(card, { kidName, onAttack }) {
  const s = card.stats;
  const t = TYPES[s.type] || TYPES.colorless;
  const stageLine = s.stage === "Basic" ? "Basic Fakemon" : `${s.stage} Fakemon`;
  const moves = h("div", { class: "moves" },
    s.ability && h("div", { class: "v-power" },
      h("span", { class: "v-power-name" }, `Fakemon Power: ${s.ability.name}`), " ", s.ability.text),
    s.attacks.map((a, i) => attackRow(a, i, onAttack,
      h("div", { class: "v-atk" },
        h("span", { class: "cost" }, a.cost.map((c) => energy(c))),
        h("span", { class: "v-atk-body" }, h("b", {}, a.name), a.text ? ` ${a.text}` : ""),
        h("span", { class: "dmg" }, a.damage),
      ))),
  );
  const col = (label, ...content) => h("div", { class: "v-col" }, h("span", {}, label), h("div", {}, ...content));
  return h("div", {
    class: faceClasses(s, "vintage"),
    style: `--frame:${t.frame[0]};--frame-light:${t.frame[1]};--ink:${t.ink}`,
  },
    h("div", { class: "inner" },
      h("div", { class: "v-stage" }, stageLine,
        s.evolves_from && h("i", {}, ` · Evolves from ${s.evolves_from}`)),
      h("div", { class: "v-top" },
        h("span", { class: "v-name" }, s.name, shinyMark(s)),
        h("span", { class: "v-hp" }, `${s.hp} HP`),
        energy(s.type, "type-badge"),
      ),
      artBox(card, artFoil(s.finish)),
      h("div", { class: "v-dex" }, `${s.species} Fakemon. Length: ${s.height}, Weight: ${s.weight}`),
      moves,
      h("div", { class: "v-wrr" },
        col("weakness", s.weakness ? energy(s.weakness) : null),
        col("resistance", s.resistance ? [energy(s.resistance), h("b", {}, "-30")] : null),
        col("retreat cost", Array.from({ length: s.retreat }, () => energy("colorless"))),
      ),
      h("div", { class: "v-flavor" }, s.flavor, h("b", {}, `  LV. ${Math.max(5, Math.round(s.hp / 4))}  #${card.id}`)),
      h("div", { class: "v-foot" },
        h("span", {}, `Illus. ${kidName}`),
        h("span", {}, `©${new Date(card.created_at).getFullYear()} ${kidName}`),
        h("span", {}, setNumber(card.id), " ", h("span", { class: "rarity" }, rarityMark(s))),
      ),
      cardFoils(s.finish, false),
    ),
  );
}

function pokemonFront(card, { kidName, onAttack }) {
  const s = card.stats;
  const gold = s.finish === "gold";
  const t = gold ? GOLD : TYPES[s.type] || TYPES.colorless;
  const ex = s.kind === "ex" || s.kind === "mega_ex";
  const mega = s.kind === "mega_ex";
  const fullArt = ex || s.layout === "illustration" || gold || s.finish === "rainbow";   // art behind the whole card
  const art = artBox(card, fullArt ? null : artFoil(s.finish));

  const moves = h("div", { class: "moves" },
    s.ability && h("div", { class: "ability" },
      h("div", { class: "ability-head" }, h("span", { class: "label" }, "Ability"), h("span", { class: "title" }, s.ability.name)),
      h("div", { class: "move-text" }, s.ability.text),
    ),
    s.attacks.map((a, i) => attackRow(a, i, onAttack,
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
    class: faceClasses(s, fullArt ? "fullart" : "", ex ? "ex" : "", mega ? "mega" : ""),
    style: `--frame:${t.frame[0]};--frame-light:${t.frame[1]};--ink:${t.ink}`,
  },
    h("div", { class: "inner" },
      fullArt ? art : null,
      h("div", { class: "top" },
        h("span", { class: "stage" }, STAGE[s.stage] || "BASIC"),
        h("span", { class: "name" }, s.name, ex ? h("span", { class: "ex-mark" }, "ex") : null, shinyMark(s)),
        h("span", { class: "hp" }, h("small", {}, "HP"), h("b", {}, s.hp)),
        energy(s.type, "type-badge"),
      ),
      (s.evolves_from || mega) && h("div", { class: "evolves" },
        s.evolves_from && h("span", { class: "from" }, `Evolves from ${s.evolves_from}`),
        mega && h("span", { class: "mega-tag" }, `The Mega-Evolved form of ${baseName}`),
      ),
      fullArt ? h("div", { class: "art-spacer" }) : art,
      fullArt ? null : h("div", { class: "dex" },
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
        credit(card, kidName, rarityMark(s)),
        ex
          ? h("div", { class: "rule" },
              h("span", { class: "rule-name" }, mega ? "Mega Evolution ex rule" : "Fakemon ex rule"),
              h("span", { class: "rule-text" },
                mega
                  ? "When your Mega Evolution Fakemon ex is Knocked Out, your opponent takes 3 Prize cards."
                  : "When your Fakemon ex is Knocked Out, your opponent takes 2 Prize cards."))
          : h("div", { class: "flavor" }, s.flavor),
      ),
      copyright(card, kidName),
      cardFoils(s.finish, fullArt),
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

/** Shrink long names and move text until they fit; call once the card is in the DOM and visible. */
export function fitCard(cardEl) {
  for (const name of cardEl.querySelectorAll(".front .name, .front .trainer-name, .front .v-name")) {
    // No slack here: even 1px of overflow turns the end of the name into "…".
    shrink(name, "--name-fit", () => name.scrollWidth > name.clientWidth, 0.5);
  }
  const moves = cardEl.querySelector(".front .moves");
  if (moves) shrink(moves, "--fit", () => moves.scrollHeight > moves.clientHeight + 1, 0.55);
}

function shrink(el, prop, overflowing, min) {
  if (!el.clientWidth) return;   // not laid out (hidden)
  let fit = 1;
  el.style.setProperty(prop, fit);
  while (overflowing() && fit > min) {
    fit -= 0.05;
    el.style.setProperty(prop, fit.toFixed(2));
  }
}

/** A gently held card under a fixed upper-left light. Returns listener cleanup. */
export function attachCardTilt(cardEl) {
  const controller = new AbortController();
  const options = { signal: controller.signal, passive: true };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const bound = (value, limit) => Math.max(-limit, Math.min(limit, value));
  const surface = cardEl.parentElement;
  let pitch = 0, yaw = 0, targetPitch = 0, targetYaw = 0;
  let frame = 0, lastTime = 0;
  let reference = null;
  cardEl.classList.add("tilt-enabled");

  const pose = (pitch, yaw) => {
    if (reduced.matches) pitch = yaw = 0;
    const rx = pitch * Math.PI / 180, ry = yaw * Math.PI / 180;
    // Fixed light/view half-vector, transformed into the card's local coordinates.
    // The reflection moves because the card rotates, not because a light follows the pointer.
    const hx = -0.18, hy = -0.22, hz = 0.959;
    const y = hy * Math.cos(rx) + hz * Math.sin(rx);
    const z = -hy * Math.sin(rx) + hz * Math.cos(rx);
    const x = hx * Math.cos(ry) - z * Math.sin(ry);
    const depth = hx * Math.sin(ry) + z * Math.cos(ry);
    cardEl.style.setProperty("--pitch", `${pitch}deg`);
    cardEl.style.setProperty("--yaw", `${yaw}deg`);
    cardEl.style.setProperty("--foil-x", `${50 + x / depth * 110}%`);
    cardEl.style.setProperty("--foil-y", `${50 + y / depth * 110}%`);
    cardEl.style.setProperty("--glint", `${Math.pow(Math.max(0, depth), 16) * 0.35}`);
  };
  // One clock for both the card and its reflection. Event frequency must not restart
  // separate CSS transitions or expose sensor noise directly.
  const animate = (time) => {
    const blend = 1 - Math.exp(-(time - lastTime) / 80);
    lastTime = time;
    pitch += (targetPitch - pitch) * blend;
    yaw += (targetYaw - yaw) * blend;
    const settled = Math.abs(targetPitch - pitch) < 0.01 && Math.abs(targetYaw - yaw) < 0.01;
    if (settled) { pitch = targetPitch; yaw = targetYaw; }
    pose(pitch, yaw);
    frame = settled ? 0 : requestAnimationFrame(animate);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    pitch = yaw = targetPitch = targetYaw = 0;
    reference = null;
    pose(0, 0);
  };
  const aim = (nextPitch, nextYaw) => {
    if (reduced.matches) { stop(); return; }
    targetPitch = nextPitch;
    targetYaw = nextYaw;
    if (!frame) {
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  };
  const reset = () => { reference = null; aim(0, 0); };
  // Listen on the stationary slot, not the card whose moving edges can repeatedly
  // trigger leave/enter underneath a stationary pointer.
  surface.addEventListener("pointerenter", () => {
    reference = surface.getBoundingClientRect();
  }, options);
  surface.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || reduced.matches) return;
    const rect = reference || surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = bound((event.clientX - rect.left) / rect.width * 2 - 1, 1);
    const y = bound((event.clientY - rect.top) / rect.height * 2 - 1, 1);
    aim(-y * 7, x * 7);
  }, options);
  surface.addEventListener("pointerleave", reset, options);
  surface.addEventListener("pointercancel", reset, options);
  window.addEventListener("resize", reset, options);
  window.addEventListener("blur", stop, options);
  window.addEventListener("deviceorientation", (event) => {
    if (event.gamma == null || event.beta == null || reduced.matches || !cardEl.isConnected) return;
    aim(bound((45 - event.beta) * 0.2, 7), bound(event.gamma * 0.25, 7));
  }, options);
  reduced.addEventListener("change", stop, options);
  pose(0, 0);
  return () => {
    controller.abort();
    stop();
    cardEl.classList.remove("tilt-enabled");
  };
}

/** Words for speechSynthesis. */
export function cardSpeech(card) {
  const s = card.stats;
  if (s.card_type !== "pokemon") {
    return `${s.name}! ${TRAINER_LABEL[s.card_type]} card. ${s.effect}`;
  }
  const ex = s.kind === "ex" || s.kind === "mega_ex";
  const parts = [`${s.shiny ? "Shiny " : ""}${s.name}${ex ? " ex" : ""}! ${s.hp} HP. ${s.type} type.`];
  if (s.ability) parts.push(`Ability: ${s.ability.name}. ${s.ability.text}`);
  for (const a of s.attacks) {
    parts.push(`Attack: ${a.name}${a.damage ? `, ${a.damage.replace("×", " times").replace("+", " plus")} damage` : ""}. ${a.text}`);
  }
  if (!ex) parts.push(s.flavor);
  return parts.join(" ");
}
