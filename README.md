# Fakemon Card Maker

A kid draws a monster, holds it up to a tablet, and tells it all about the creature: its name, its
type, its attacks, where it lives. A few seconds later a real-looking trading card comes back,
with professional art based on *their* drawing and *their* words on the card.

It's a home project to give a young artist a way to make cards on their own, without waiting for a
grown-up to type everything into a chatbot, so they spend more time drawing, inventing and telling
stories.

## What it does

- 📷 Snap a drawing, 🎤 describe it out loud, ✨ get a card.
- Cards follow the style of the trading card game's Mega Evolution era: silver border, energy
  symbols, HP, attacks, weakness/resistance/retreat. Say "ex" or "Mega" for a full-art card.
- The kid's ideas win: names, numbers, and attacks go on the card exactly as they were said.
- Flip a card to see the original drawing and the kid's words. Tap an attack for a new one, 🎨 for new
  art, 🔊 to hear the card read aloud.
- A binder of every card, and printing 9 to a page at real card size.
- Guardrails for grown-ups: a daily card limit with PIN top-ups ("Ask Mom and Dad for more
  cards!"), a monthly budget, and a page showing what each card cost (about 3¢).

## How it works

A small Python server on the home network serves a web app to the tablet. For each card it
asks OpenAI to transcribe the story, turn the drawing and story into card stats, and repaint the
drawing as card art. The app draws the card itself, so the text is always crisp.

## Getting started

```sh
cp .env.example .env    # add your OpenAI key file, the kid's name, a parent PIN
./run.sh                # then open https://<this-computer>:8443 on the tablet
```

Full setup, tablet tips, costs and settings: [docs/SETUP.md](docs/SETUP.md).

---

A personal, non-commercial project made for one kid. Pokémon and its trading card game are
trademarks of Nintendo, Creatures and GAME FREAK; this project isn't affiliated with them.
