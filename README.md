# Learning Box

A home tablet app with a few creative and learning games for a young kid. It started as a single
game (the Fakemon card maker, hence the repo's original name) and grew into a small game box.

| Game | What it is |
|---|---|
| 🃏 **Fakemon Cards** | Draw a monster, describe it out loud, get a real-looking trading card back |
| 🎲 **Number Race** | The classroom dice game: roll two dice, add them up, race the numbers to the top |

## 🃏 Fakemon Cards

A kid draws a monster, holds it up to a tablet, and tells it all about the creature: its name, its
type, its attacks, where it lives. A few seconds later a real-looking trading card comes back,
with professional art based on *their* drawing and *their* words on the card. It lets a young
artist make cards without waiting for a grown-up to type everything into a chatbot, so they spend
more time drawing, inventing and telling stories.

- 📷 Snap a drawing, 🎤 describe it out loud, ✨ get a card.
- Cards follow the style of the trading card game's Mega Evolution era: silver border, energy
  symbols, HP, attacks, weakness/resistance/retreat. Say "ex" or "Mega" for a full-art card, or
  "item" / "supporter" for a Trainer card. Some cards come out special (vintage, gold, rainbow,
  holo foils, shiny), like pulls from a real pack.
- The kid's ideas win: names, numbers, and attacks go on the card exactly as they were said.
- Flip a card to see the original drawing and the kid's words. Tap an attack for a new one, 🎨 for new
  art, 🔊 to hear the card read aloud.
- A binder of every card, and printing 9 to a page at real card size.
- Guardrails for grown-ups: a daily card limit with PIN top-ups ("Ask Mom and Dad for more
  cards!"), a monthly budget, and a page showing what each card cost (about 3¢).

A small Python server on the home network asks OpenAI to transcribe the story, turn the drawing
and story into card stats, and repaint the drawing as card art. The app draws the card itself, so
the text is always crisp.

## 🎲 Number Race

The "Race to the Top" game many kindergarten and first-grade classes play on paper:

1. Everyone picks a number from 2 to 12 to cheer for. Players are the kid, Mom, Dad, and
   optionally 🤖 **Robo**, a computer player: *Smart* Robo picks the numbers that come up most
   (like 7), *Silly* Robo picks anything.
2. Roll two dice: tap 🎲 for the tablet's dice, or choose **"our own dice"**, roll real dice at the
   table, and tap a face under **First die** and **Second die**, in either order. Both selectors
   have touch-sized buttons in portrait and landscape. Robo always rolls on the tablet.
3. The kid adds up the dots and taps that number (or picks "add for me"); on Robo's turn the kid
   helps Robo add. Two misses show the answer as a hint.
4. A box fills in above that number. The first column to reach the top wins.

It practices counting, adding, and number recognition, and the end screen points out why the
middle numbers (like 7) win so often. No AI and no cost: it runs entirely on the tablet.

## Getting started

```sh
cp .env.example .env    # add your OpenAI key file, the kid's name, a parent PIN
./run.sh                # then open https://<this-computer>:8443 on the tablet
```

Full setup, tablet tips, costs and settings: [docs/SETUP.md](docs/SETUP.md).

---

A personal, non-commercial project made for one kid. Pokémon and its trading card game are
trademarks of Nintendo, Creatures and GAME FREAK; this project isn't affiliated with them.
