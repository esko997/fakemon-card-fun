# Learning Box: setup and details

How it works, setting up the server and tablet, costs and limits, and where data lives.
For the short version, see the [README](../README.md).

| Page | What |
|---|---|
| `/` | Learning Box home: one tile per game |
| `/cards.html` | Fakemon card maker (`/print.html` prints cards, `/parent.html` is the grown-ups page) |
| `/number-race.html` | Number Race; runs entirely in the browser, no server data |
| `/facts.html` | Sourced facts, ten-discovery sessions, optional follow-ups and reflection |
| `/creatures.html` | Original drawings and descriptions in a creature field guide |
| `/stories.html` | Photographed writing, narration, sound effects and printable stories |
| `/inventors.html` | Reviewed building challenges and a notebook of each attempt |

A second, separate instance for trying changes can run beside the kid's: its own checkout (a git
worktree on another branch), its own copy of `data/`, `PORT=8444 ./run.sh`, and
`FAKEMON_ENV=dev` in its `.env`, which shows a striped DEV badge so the two can't be confused.
Both share the OpenAI key; give the dev `.env` a small `MONTHLY_BUDGET_USD`, since each
instance's budget guard only counts its own spending.

## Fakemon Cards

```
tablet (browser) ──HTTPS──▶ this server ──▶ OpenAI
  camera + mic                 │  1. transcribe the story       (gpt-transcribe)
  card rendering               │  2. drawing + story → stats    (gpt-6-luna, structured JSON)
  binder / print               │  3. drawing + stats → art      (gpt-image-2.5-sunburst, image edit)
                               └─ SQLite + image files in data/
```

The AI only paints the creature; the card frame, text, and icons are drawn by the app in HTML/CSS,
styled after the trading card game's Mega Evolution era (silver border, type-colored body, energy
symbols, weakness/resistance/retreat bar, set line). That way the text is always crisp, the kid's
words show up exactly, and attacks or art can be re-rolled separately.

Types follow the card game's ten energy types (grass, fire, water, lightning, psychic, fighting,
darkness, metal, dragon, colorless); other words a kid uses are mapped onto them (electric →
lightning, ice → water, …). Saying "ex" or "Mega" makes a full-art ex / Mega Evolution ex card
with portrait art and the rule box.

Like real packs, some cards come out special. These are rolled once when a card is made (odds in
`fakemon/ai.py`), or the kid can ask for them by name:

| Special | Ask with | Odds | Looks like |
|---|---|---|---|
| Illustration | "full art", "illustration" | 1 in 6 creature cards | full-art storybook scene, gold ★ |
| Vintage | "old school", "classic", "yellow border" | 1 in 8 creature cards | 1990s yellow-border layout |
| Gold | "gold card" | 3% | full art, gold frame, gold-etched art, gold ★★★ |
| Rainbow | "rainbow card" | 4% | full art under a pastel rainbow foil, rainbow ★★★ |
| Holo foils | "holo", "foil" | cosmos 7%, sparkle 6%, reverse 10%; rare cards get classic holo | ring pattern on the art / glitter over the card / foil card body |
| Shiny | "shiny" | 1 in 15 creature cards | painted in alternate colors, ✦ by the name |

In the full-size view, pointer movement gently tilts the card under a fixed upper-left light.
Foil reflection responds to orientation rather than following the pointer as a spotlight.
Tablet orientation is used where the browser exposes it; touch taps still flip the card.
Reduced-motion preferences disable tilt. Print output is flat, front-only; gold and rainbow
tints print, but moving shine does not.

Each painting rolls an art style, the way real sets mix illustrators: anime cel-shading (most
often), watercolor, painterly, 3D CG, papercraft, pastel, woodblock print, clay, or 90s retro.
🎨 New picture rolls again. The styles and their weights are `ART_STYLES` in `fakemon/ai.py`; the
style used for each painting is recorded with its cost.

Saying "item" or "supporter" (or "trainer card") makes a Trainer card instead: silver body,
"TRAINER" banner, blue (Item) or orange (Supporter) accents, an effect written like real rules
text, and the matching rule line. The text model decides from the whole description, so "it's an
item card" counts but "he's holding an item" doesn't. Anything else is a creature card.

`ART_FREEDOM` in `.env` sets how literally the art follows the drawing: `reimagined` (default)
treats it as a concept sketch, keeping the colors, eye count and body idea while adding anatomy,
texture and a few new features; `faithful` redraws it as drawn. `IMAGE_QUALITY` only changes
rendering detail, not how closely the drawing is followed.

When something fails, the kid's message comes with "Ask Dad to look at this error:" and the literal
error (what failed, HTTP status, message). Failed uploads are also listed under "Errors on the
tablet" on `/parent.html`.

## Play notebooks

The four creative activities share `fakemon/play.py` and `static/play.js`: original photo/audio
uploads, editable recognition proposals, saved notebooks, read-aloud and optional AI help.
They are separate from the card binder; creating or editing a notebook never changes card rows.
Saved notebooks have revisions, so an older browser window cannot overwrite a newer save.

- `static/facts.json` contains 28 sourced starting facts. Each has a source link, explanation,
  specific follow-up questions and a low-risk activity. The server enforces ten new facts per
  session, even after a reload. After ten, the child can reflect, revisit, ask questions or stop
  without completing an assignment. AI answers are labelled and can still be wrong.
- Creature pages accept grounded or magical descriptions. Optional illustrations are separate
  companions to the original drawing, not replacements. Existing entries remain available.
- Story pages retain the photographed writing and original recording. Recognition is never
  silently applied: the child can hear, edit and accept its proposed words. Sound-effect pages
  stay distinct from narration, and the story helper asks rather than authors.
- `static/challenges.json` contains ten reviewed material lists, safety notes and building ideas.
  The workshop records a prediction, successive attempts and optional changes without grading.
  The AI helper is limited by the selected challenge's materials and safety guidance; an adult
  should supervise the real activity.

Browsing, typing, recording, uploading, saving and printing do not need an AI call. Paid helpers
reuse the configured text, transcription and image models. Their usage appears as `play_*` in
the spend summary and counts toward `MONTHLY_BUDGET_USD`; creature illustrations also consume
the shared daily picture allowance. Exhausting the budget does not prevent saving original work.
Photo and audio originals are stored locally unchanged; recognition and helper requests send
the relevant material to OpenAI only when requested. This remains a trusted-home-network app,
not a public, authenticated hosting service.

## Setup (server)

Requires Python 3.11+ and `openssl`.

```sh
cp .env.example .env      # set OPENAI_API_KEY_FILE (or OPENAI_API_KEY), KID_NAME, limits
./run.sh                  # creates .venv, HTTPS certs, starts on https://<this-machine>:8443
```

OpenAI account needs prepaid credits, and GPT Image models may require
[organization verification](https://help.openai.com/en/articles/10910291-api-organization-verification).

## Setup (tablet)

Browsers only allow camera and microphone on HTTPS, so the server uses a small local certificate
authority created in `data/certs/`.

1. Open `https://<server-ip>:8443/ca.crt` on the tablet (accept the one-time warning) and install it:
   Settings → Security → Encryption & credentials → Install a certificate → **CA certificate**.
2. Open `https://<server-ip>:8443/` in Chrome → ⋮ → **Add to Home screen**.
3. Optional: Settings → Security → **App pinning** to keep the kid in the app.
4. Best ergonomics: a tablet stand pointing the rear camera down at the table; the 🔄 button
   switches cameras, 🖼️ uses the system camera app instead.

The grown-ups page is at `/parent.html`: cards left today and top-ups, spend this month, cost per
card, cards with errors, and restoring cards the kid "put away" (🗑️ hides, never deletes).

## Kid flow

1. ✏️ **Make a new card** → 📷 snap the drawing → 👍
2. 🎤 tap, talk (up to 2 minutes), tap ⏹️ → ▶️ listen back or 🎤 again → ✨ **Make my card!**
3. Watch it get made, then the drawing flips over into the finished card.
4. On a card: tap to flip (the back is the original drawing and their words), tap an attack to
   get a new one, 🎨 for a new picture, 🔊 to hear it read aloud.
5. 📒 **My cards** → 🖨️ Print → tap cards → print (letter paper, cut along the silver borders).
6. Out of cards for today → "Ask Mom and Dad for more cards!". With `PARENT_PIN` set, a grown-up
   taps 🔑 on that message and enters the PIN to add 5 more for today.

## Costs and limits

Per card ≈ one transcription (~$0.0045/min) + one small text call (< $0.01) + one image edit.
The image dominates: GPT Image 2.5 is billed by tokens ($8/M image input, $30/M image output),
so the exact per-image price depends on quality and the input drawing; OpenAI doesn't publish a
fixed per-image figure for 2.5. The app records `usage` from every response and shows real
per-card cost on `/parent.html`. Check it after the first few cards and adjust `IMAGE_QUALITY`.

Guards, all in `.env`:

- `DAILY_CARD_LIMIT` (15) — new cards + new pictures + creature-guide illustrations per day (failed API attempts are refunded).
  Grown-ups can add more for the current day from `/parent.html` or the tablet's 🔑 button.
- `PARENT_PIN` — required for top-ups when set. Without it, the tablet shows no 🔑 and anyone who
  opens `/parent.html` can add cards.
- `MONTHLY_BUDGET_USD` — generation stops when this month's estimated spend reaches it.
- Also set a hard limit on the OpenAI project (platform.openai.com → Settings → Limits).

Changing a model in `.env` requires its rate in `fakemon/pricing.py`; the server refuses to start
otherwise rather than under-count spend.

## Keep it running

As a systemd user service:

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/fakemon.service <<EOF
[Unit]
Description=Learning Box
After=network-online.target

[Service]
ExecStart=$PWD/run.sh
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now fakemon
loginctl enable-linger "$USER"   # keep running when logged out
```

## Data

Everything lives in `data/` (git-ignored): `cards.sqlite`, `media/<card>/` (drawing, voice
recording, art), `play.sqlite` (discovery sessions and notebooks), `play-media/` (original
uploads and companion illustrations), and `certs/`. Back up all of `data/` using a SQLite-aware
backup or while the server is stopped; copying a live SQLite file alone can omit WAL changes.
Keep `certs/ca.key` private.
The CA is name-constrained to this machine's hostname, `*.local`, and private-network IPs, so even
a leaked key can't impersonate real websites to the tablet.

If the server restarts mid-card, that card shows "Oops" in the binder; tapping it retries only the
missing steps.
