"""OpenAI calls: transcribe the story, invent card stats, paint the art."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import random
import re
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI, BadRequestError
from PIL import Image, ImageOps

from . import pricing
from .config import Settings

# The trading card game's energy types. Kids' types map onto these (see CARD_INSTRUCTIONS).
TYPES = [
    "grass", "fire", "water", "lightning", "psychic", "fighting",
    "darkness", "metal", "dragon", "colorless",
]
KINDS = ["regular", "ex", "mega_ex"]

ATTACK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "cost", "damage", "text"],
    "properties": {
        "name": {"type": "string"},
        "cost": {
            "type": "array",
            "items": {"type": "string", "enum": TYPES},
            "description": "1-4 energy symbols, e.g. ['fire', 'colorless', 'colorless'].",
        },
        "damage": {"type": "string", "description": "Like '30', '60+', '20×', or '' for no damage."},
        "text": {"type": "string", "description": "What the attack does; '' when damage says it all."},
    },
}

POKEMON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "name", "kind", "stage", "evolves_from", "hp", "type", "species", "height", "weight", "ability",
        "attacks", "weakness", "resistance", "retreat", "rarity", "flavor", "art_prompt",
    ],
    "properties": {
        "name": {"type": "string", "description": "Without 'ex'; include 'Mega ' for mega_ex."},
        "kind": {"type": "string", "enum": KINDS},
        "stage": {"type": "string", "enum": ["Basic", "Stage 1", "Stage 2"]},
        "evolves_from": {"type": ["string", "null"], "description": "Invented pre-evolution name; null for Basic."},
        "hp": {"type": "integer", "description": "Multiple of 10; the child's number if they said one, else 30-300."},
        "type": {"type": "string", "enum": TYPES},
        "species": {"type": "string", "description": "Short category without the word Fakemon, e.g. 'Bubble Dragon'."},
        "height": {"type": "string", "description": "e.g. 3'2\""},
        "weight": {"type": "string", "description": "e.g. 41.5 lbs."},
        "ability": {
            "anyOf": [
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "text"],
                    "properties": {"name": {"type": "string"}, "text": {"type": "string"}},
                },
                {"type": "null"},
            ]
        },
        "attacks": {"type": "array", "items": ATTACK_SCHEMA, "description": "1 or 2 attacks."},
        "weakness": {"type": ["string", "null"], "enum": [*TYPES, None]},
        "resistance": {"type": ["string", "null"], "enum": [*TYPES, None]},
        "retreat": {"type": "integer", "description": "0-4"},
        "rarity": {"type": "string", "enum": ["common", "uncommon", "rare"]},
        "flavor": {"type": "string"},
        "art_prompt": {"type": "string"},
    },
}

TRAINER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "effect", "rarity", "art_prompt"],
    "properties": {
        "name": {"type": "string", "description": "Item: e.g. 'Zap Potion'. Supporter: e.g. 'Coach Rae's Pep Talk'. Stadium: e.g. 'Moonlit Garden'."},
        "effect": {"type": "string", "description": "What playing the card does, in rules-text style."},
        "rarity": {"type": "string", "enum": ["common", "uncommon", "rare"]},
        "art_prompt": {"type": "string"},
    },
}

CARD_TYPES = ["pokemon", "item", "supporter", "stadium"]

# Special versions a kid can ask for; otherwise they are rolled at random (see roll_extras).
REQUESTS = ["full_art", "vintage", "gold", "rainbow", "shiny", "holo"]

CARD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["card_type", "requests", "pokemon", "trainer"],
    "properties": {
        "card_type": {"type": "string", "enum": CARD_TYPES},
        "requests": {"type": "array", "items": {"type": "string", "enum": REQUESTS},
                     "description": "Special versions the child explicitly asked for; usually empty."},
        "pokemon": {"anyOf": [POKEMON_SCHEMA, {"type": "null"}], "description": "Only for card_type pokemon."},
        "trainer": {"anyOf": [TRAINER_SCHEMA, {"type": "null"}], "description": "Only for item, supporter and stadium."},
    },
}

CARD_INSTRUCTIONS = """\
You turn a child's invention into a trading card for a home card-making game. The child drew it
(the image) and described it out loud (the transcript, which may contain speech-recognition
mistakes; interpret it generously).

Card type:
- card_type "item" if the child says it is an item card; "supporter" if they say it is a
  supporter or support card; "stadium" if they say it is a stadium card.
  If they say "trainer card" without saying which: a person or character is a supporter,
  an object is an item, a place or environment is a stadium.
- Otherwise card_type "pokemon": a creature card. This includes when they say nothing about the
  card type, even if the drawing looks like an object, person or place. A creature living or
  fighting in a stadium is still a creature card, not a request for a Stadium card.
- Fill `pokemon` for creature cards and `trainer` for item, supporter and stadium cards;
  set the other to null.

Rules for every card:
- The child's ideas win. Whatever they say about the name, numbers, powers, effects, looks or
  where it lives goes on the card exactly as said (fix only obvious transcription errors). Invent
  only what they didn't say, in the spirit of what they said and drew.
- Original inventions only: never use names of real Pokémon, real trainer cards, or other existing
  characters. Creatures are called "Fakemon" in card text.
- Kid-friendly content only.
- requests: special versions the child explicitly asks for, else empty: "full_art" (full art or
  illustration card), "vintage" (old-school, classic, retro or yellow-border card), "gold" (gold
  card), "rainbow" (rainbow card), "shiny" (a shiny, different-colored version), "holo" (holo or
  holographic or foil card). Words like "shiny" describing its skin or "gold" as its color are not
  requests; only asks about the card itself.

Creature (pokemon) cards:
- Types are the card game's energy types. Map other words: electric -> lightning, dark -> darkness,
  steel -> metal, normal -> colorless, ice -> water, ghost/fairy -> psychic, rock/ground -> fighting,
  bug/plant -> grass.
- Attack cost is a list of energy symbols: usually the creature's own type plus some colorless.
  If the child says how many energies an attack needs, use that many (max 4).
- kind: "mega_ex" if the child says Mega (put "Mega " at the start of the name), "ex" if they say
  ex or describe it as legendary or super strong, otherwise "regular". Never put "ex" in the name.
- Short and readable for a young child: name <= 18 characters, attack names <= 20,
  attack/ability text <= 90 characters, flavor text <= 120 characters.
- Fun and a bit over-the-top. Use the child's HP and damage numbers exactly, however big. When you
  invent them, damage is a multiple of 10 (10-200, ex up to 300), optionally ending in '+' or '×',
  and HP is 30-300.
- Give 1 or 2 attacks. Include an ability only if the child described a special power that isn't an attack.
- art_prompt: 2-4 sentences describing how the creature looks in the drawing (body shape,
  colors, number of limbs/eyes, horns, wings, tail, markings), a lively pose, and a simple
  background that fits where it lives. If the drawing is uncolored, pick colors from the
  description or the creature's type.

Item, supporter and stadium cards:
- An item is a thing a trainer uses (potion, ball, gadget, snack, tool). A supporter is a person
  who helps (coach, scientist, friend, family member); supporter names usually look like
  "<Person>'s <Thing>", e.g. "Coach Rae's Pep Talk".
- A stadium is a place or environment (garden, cave, arena, forest, imaginary landscape),
  not necessarily a sports stadium. Its effect stays active while it is in play, usually
  applying to both players. Preserve the child's stated effect and numbers; if inventing an
  effect, make it ongoing or usable once during each player's turn, not a one-time item action.
- effect: what playing the card does, written like real card rules text and using game actions:
  draw cards, search your deck, heal damage from a Fakemon, switch your Active Fakemon, attach
  Energy, look at the top cards of your deck, shuffle. Use the child's effect if they gave one.
  Fun and a bit generous. Name <= 22 characters, effect <= 160 characters.
- art_prompt: 2-4 sentences. Item: the object from the drawing (shape, colors, materials, glow)
  presented on a simple bright background. Supporter: the person from the drawing (hair, face,
  clothes, colors, pose, expression) and a simple scenic background that fits them.
  Stadium: the place from the drawing (landmarks, terrain, buildings, colors, atmosphere);
  make the environment itself the subject, not a centered creature, person or handheld object.
"""

ATTACK_INSTRUCTIONS = """\
You are helping a child improve a trading card for a creature they invented. Replace one
attack with a brand new, different attack that fits the creature. Keep it short and fun:
name <= 20 characters, text <= 90 characters, damage a multiple of 10 (10-200), optionally
ending in '+' or '×'. Cost is 1-4 energy symbols, usually the creature's type plus some
colorless. Never use names of real Pokémon moves or existing characters.
"""

# How closely the art follows the drawing (ART_FREEDOM in .env), per thing being drawn.
ART_FREEDOM = {
    # Redraws the drawing as-is, down to boxy shapes and crayon texture.
    "faithful": {
        "creature": """\
Stay faithful to the child's design: keep the same body shape, number of limbs and eyes, horns, wings,
tail, markings and colors as drawn. It is their creature, illustrated by a professional artist.""",
        "item": """\
Stay faithful to the child's design: keep the same shape, parts and colors as drawn. It is their
invention, illustrated by a professional artist.""",
        "supporter": """\
Stay faithful to the child's design: keep the same hair, clothes, colors and features as drawn. It is
their character, illustrated by a professional artist.""",
        "stadium": """\
Stay faithful to the child's place: keep the same landmarks, arrangement, shapes and colors as drawn.
It is their environment, illustrated by a professional artist.""",
    },
    # Treats the drawing as a concept sketch: recognizable at a glance, but properly designed.
    "reimagined": {
        "creature": """\
Treat the drawing as the child's concept sketch and develop it the way a professional creature designer
would turn a kid's concept into an official monster design. Keep the child's core idea so they can
recognize their monster at a glance: the basic body shape idea, the main colors, and the number of eyes.
Everything else is yours to design: real anatomy and a confident stance, a characterful face,
interesting texture, patterns and markings, and two or three memorable new features (crests, fins,
horns, tail, glowing parts, armor) that fit its type and personality. Simple shapes in the sketch should
become a living creature, not a shape with a face. Do not copy the crayon or marker strokes or the paper.""",
        "item": """\
Treat the drawing as the child's concept sketch and develop it the way a professional prop designer
would. Keep the basic shape idea and main colors so the child recognizes it at a glance, then design it
as a real, finely made object: materials, shine, and two or three clever details. Do not copy the crayon
or marker strokes or the paper.""",
        "supporter": """\
Treat the drawing as the child's concept sketch and develop it the way a professional character
designer would. Keep the hair, clothing colors and any signature features so the child recognizes the
character at a glance, then design them as a real anime character with an expressive face, natural
proportions and a detailed outfit. Do not copy the crayon or marker strokes or the paper.""",
        "stadium": """\
Treat the drawing as the child's concept sketch and develop it as a professional environment designer
would. Keep the main landmarks, layout idea and colors recognizable, then add depth, lighting,
textures and inviting scenic details. Do not copy the crayon or marker strokes or the paper.""",
    },
}

_NO_TEXT = "No text, letters, numbers, logos, borders or card frame anywhere in the image."

# Real sets mix many illustrators' styles; each painting rolls one (weight, description).
ART_STYLES: dict[str, tuple[int, str]] = {
    "anime": (4, "vibrant cel-shaded anime illustration with bold clean outlines"),
    "watercolor": (1, "soft watercolor painting on textured paper, gentle color bleeds and delicate ink linework"),
    "painterly": (1, "rich painterly digital painting with visible brush strokes and dramatic lighting, like a fantasy book cover"),
    "cg": (1, "glossy 3D-rendered look with soft studio lighting, like a modern animated movie"),
    "papercraft": (1, "cut-paper collage of layered textured paper with soft drop shadows, like a handmade diorama"),
    "pastel": (1, "dreamy colored-pencil and pastel drawing with soft grainy shading"),
    "woodblock": (1, "Japanese woodblock print style with flat colors, strong ink outlines and patterned backgrounds"),
    "clay": (1, "handmade clay figure in a tiny clay diorama, softly lit, like stop-motion animation"),
    "retro": (1, "1990s trading card painting with airbrushed gradients and a nostalgic vintage feel"),
}


def pick_style() -> str:
    names = list(ART_STYLES)
    return random.choices(names, weights=[ART_STYLES[n][0] for n in names])[0]


ART_PROMPT = """\
Turn the creature in this child's drawing into polished artwork for a collectible monster trading card.
{freedom}
Art style: {style}.
Composition: friendly dynamic pose, whole creature visible and centered.
Background: simple and uncluttered, matching its habitat, with {type}-themed colors.
Creature details: {details}
""" + _NO_TEXT

# ex cards are full-art: portrait, the creature bursting with energy, filling the frame.
EX_ART_PROMPT = """\
Turn the creature in this child's drawing into a dramatic full-art illustration for a rare collectible
monster trading card, portrait orientation.
{freedom}
Art style: {style}.
Composition: powerful dynamic pose seen slightly from below, the creature large in the upper half of the
image, swirling {type}-themed energy ribbons and sparkles bursting around it and flowing to the edges.
Creature details: {details}
""" + _NO_TEXT

# "Illustration rare": a full-art storybook scene of the creature's everyday life.
ILLUSTRATION_ART_PROMPT = """\
Turn the creature in this child's drawing into a full-art "illustration rare" painting for a collectible
monster trading card, portrait orientation.
{freedom}
Art style: {style}.
Composition: a storybook moment from the creature's everyday life in its habitat (what it likes to do,
where it lives), the creature medium-sized in the upper half, the scene filling the whole frame edge to
edge, the bottom third calmer and less detailed. {type}-themed colors.
Creature details: {details}
""" + _NO_TEXT

ITEM_ART_PROMPT = """\
Turn the object in this child's drawing into polished artwork for an Item card in a collectible trading
card game.
{freedom}
Art style: {style}.
Composition: the object large and centered, seen slightly from above with shine and highlights, on a
simple bright background with soft radiating rays.
Item details: {details}
""" + _NO_TEXT

SUPPORTER_ART_PROMPT = """\
Turn the person in this child's drawing into polished artwork for a Supporter card in a collectible
trading card game: a character illustration.
{freedom}
Art style: {style}.
Composition: friendly confident pose, shown from the waist up and centered, with a simple scenic
background.
Character details: {details}
""" + _NO_TEXT

STADIUM_ART_PROMPT = """\
Turn the place in this child's drawing into polished artwork for a Stadium card in a collectible
trading card game: an environment illustration.
{freedom}
Art style: {style}.
Composition: a wide scenic view of the location, with recognizable landmarks and depth from
foreground to background. The place itself is the subject, not a character or an object.
Location details: {details}
""" + _NO_TEXT

LANDSCAPE, PORTRAIT = "1536x1024", "1024x1536"

# Surprise "pulls", rolled once when a card is invented and stored with it. Odds are per card.
VINTAGE_CHANCE = 1 / 8         # 1990s yellow-border layout (regular creatures)
ILLUSTRATION_CHANCE = 1 / 6    # full-art storybook scene, gold ★ (regular creatures)
SHINY_CHANCE = 1 / 15          # alternate colors
FINISH_ODDS = {                # foil treatments, any card type; the rest get none (or holo if rare)
    "gold": 0.03,              # gold secret rare: full art, gold frame and tint
    "rainbow": 0.04,           # rainbow rare: full art under a rainbow foil
    "cosmos": 0.07,            # cosmos-pattern holo on the art
    "sparkle": 0.06,           # glitter across the whole card
    "reverse": 0.10,           # reverse holo: foil card body, plain art
}
HOLO_FINISHES = ["holo", "cosmos", "sparkle", "reverse"]


def roll_extras(card_type: str, kind: str | None, rarity: str, requests: list[str]) -> dict[str, Any]:
    """Layout/finish/shiny for a new card: what the child asked for, else a random roll."""
    asked = set(requests)
    if "gold" in asked or "rainbow" in asked:
        finish = "gold" if "gold" in asked else "rainbow"
    elif "holo" in asked:
        finish = random.choice(HOLO_FINISHES)
    else:
        roll, finish = random.random(), None
        for name, odds in FINISH_ODDS.items():
            if roll < odds:
                finish = name
                break
            roll -= odds
        finish = finish or ("holo" if rarity == "rare" else "none")
    if card_type != "pokemon":
        return {"finish": finish}

    if kind != "regular":
        layout = "standard"   # ex / Mega ex have their own full-art layout
    elif "vintage" in asked:
        layout = "vintage"
    elif "full_art" in asked:
        layout = "illustration"
    elif finish in ("gold", "rainbow"):
        layout = "standard"   # already full art
    else:
        roll = random.random()
        layout = "vintage" if roll < VINTAGE_CHANCE else (
            "illustration" if roll < VINTAGE_CHANCE + ILLUSTRATION_CHANCE else "standard")
    if layout == "vintage" and finish in ("gold", "rainbow"):
        finish = "holo"       # 90s cards had plain holo, not gold/rainbow foils
    shiny = "shiny" in asked or random.random() < SHINY_CHANCE
    return {"layout": layout, "finish": finish, "shiny": shiny}


def is_full_art(stats: dict[str, Any]) -> bool:
    """Creature cards whose art fills the whole card (portrait art)."""
    return stats["card_type"] == "pokemon" and (
        stats["kind"] != "regular" or stats["layout"] == "illustration" or stats["finish"] in ("gold", "rainbow")
    )


def art_spec(stats: dict[str, Any]) -> tuple[str, str, str]:
    """(prompt template, ART_FREEDOM subject, image size) for a card."""
    if stats["card_type"] == "item":
        return ITEM_ART_PROMPT, "item", LANDSCAPE
    if stats["card_type"] == "supporter":
        return SUPPORTER_ART_PROMPT, "supporter", LANDSCAPE
    if stats["card_type"] == "stadium":
        return STADIUM_ART_PROMPT, "stadium", LANDSCAPE
    if stats["layout"] == "illustration":
        return ILLUSTRATION_ART_PROMPT, "creature", PORTRAIT
    if is_full_art(stats):
        return EX_ART_PROMPT, "creature", PORTRAIT
    return ART_PROMPT, "creature", LANDSCAPE


SHINY_ART = """\
This is the creature's rare shiny form: give it a striking alternate color scheme that is clearly
different from its usual colors (a new main color and accent colors), keeping its shape and features.
"""


# Appended after a moderation block; resending the identical request would only be blocked again.
SAFER_ART = """\
Keep it gentle and cute, like a picture book for young children: no weapons, blood, injuries,
scary faces or violence. Show powers as harmless sparkles, glows or splashes.
"""

TRANSCRIBE_PROMPT = (
    "A young child describes something they invented for a trading card: a monster (its name, "
    "looks, powers, attacks and where it lives), an item card, a supporter card, or a stadium card."
)


class ArtBlocked(Exception):
    """The image model refused the request (moderation)."""


@dataclass
class Spend:
    kind: str
    model: str
    cost_usd: float
    detail: dict[str, Any]


def normalize_drawing(raw: bytes) -> bytes:
    """Upright, RGB, <= 1536px JPEG. Phone photos carry EXIF rotation; models ignore it."""
    with Image.open(io.BytesIO(raw)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((1536, 1536))
        out = io.BytesIO()
        img.save(out, "JPEG", quality=90)
        return out.getvalue()


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def tidy_attack(attack: dict[str, Any]) -> dict[str, Any]:
    cost = attack["cost"][:4] or ["colorless"]
    return {**attack, "cost": cost}


def tidy_card(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten the model's reply into stored stats and enforce what the card layout relies on.
    Structured output guarantees shape, not ranges or which branch got filled."""
    card_type = raw["card_type"]
    if card_type != "pokemon":
        if raw["trainer"] is None:
            raise ValueError(f"{card_type} card came back without trainer details")
        trainer = raw["trainer"]
        return {"card_type": card_type, **trainer, **roll_extras(card_type, None, trainer["rarity"], raw["requests"])}
    stats = raw["pokemon"]
    if stats is None:
        raise ValueError("creature card came back without creature details")
    attacks = [tidy_attack(a) for a in stats["attacks"][:2]]
    if not attacks:
        raise ValueError("card came back with no attacks")
    return {
        "card_type": "pokemon",
        **stats,
        **roll_extras("pokemon", stats["kind"], stats["rarity"], raw["requests"]),
        "hp": _clamp(round(int(stats["hp"]) / 10) * 10, 10, 990),   # 3 digits fit the header
        "retreat": _clamp(int(stats["retreat"]), 0, 4),
        # the card prints "<species> Fakemon"
        "species": re.sub(r"\s*(Fakemon|Pok[eé]mon)$", "", stats["species"].strip(), flags=re.I),
        "attacks": attacks,
    }


class CardAI:
    def __init__(self, settings: Settings):
        self.s = settings
        self.client = AsyncOpenAI(api_key=settings.api_key)
        # Stable, non-identifying end-user id, as the image API recommends.
        self.safety_id = hashlib.sha256(f"fakemon:{settings.kid_name}".encode()).hexdigest()[:32]

    async def transcribe(self, audio: bytes, filename: str, mime: str, client_seconds: float) -> tuple[str, Spend]:
        result = await self.client.audio.transcriptions.create(
            model=self.s.transcribe_model,
            file=(filename, audio, mime),
            prompt=TRANSCRIBE_PROMPT,
        )
        usage = getattr(result, "usage", None)
        seconds = getattr(usage, "seconds", None) or client_seconds
        spend = Spend(
            "transcribe",
            self.s.transcribe_model,
            pricing.transcribe_cost(self.s.transcribe_model, seconds),
            {"seconds": seconds},
        )
        return result.text.strip(), spend

    async def _structured(self, *, instructions: str, content: list[dict], name: str, schema: dict) -> tuple[dict, Spend]:
        response = await self.client.responses.create(
            model=self.s.text_model,
            instructions=instructions,
            input=[{"role": "user", "content": content}],
            text={"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
            reasoning={"effort": "low"},
            safety_identifier=self.safety_id,
        )
        usage = response.usage
        spend = Spend(
            "text",
            self.s.text_model,
            pricing.text_cost(self.s.text_model, usage.input_tokens, usage.output_tokens),
            {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens},
        )
        return json.loads(response.output_text), spend

    async def invent_card(self, drawing_jpeg: bytes, transcript: str) -> tuple[dict[str, Any], Spend]:
        data_url = "data:image/jpeg;base64," + base64.b64encode(drawing_jpeg).decode()
        story = transcript or "(The child didn't say anything. Invent everything from the drawing.)"
        stats, spend = await self._structured(
            instructions=CARD_INSTRUCTIONS,
            content=[
                {"type": "input_text", "text": f"Transcript of what the child said:\n{story}"},
                {"type": "input_image", "image_url": data_url},
            ],
            name="fakemon_card",
            schema=CARD_SCHEMA,
        )
        return tidy_card(stats), spend

    async def new_attack(self, stats: dict[str, Any], transcript: str, index: int) -> tuple[dict[str, Any], Spend]:
        card = {k: v for k, v in stats.items() if k != "art_prompt"}
        attack, spend = await self._structured(
            instructions=ATTACK_INSTRUCTIONS,
            content=[
                {
                    "type": "input_text",
                    "text": (
                        f"The child's description:\n{transcript or '(none)'}\n\n"
                        f"Current card:\n{json.dumps(card, ensure_ascii=False)}\n\n"
                        f"Replace attack number {index + 1} ({stats['attacks'][index]['name']!r})."
                    ),
                }
            ],
            name="fakemon_attack",
            schema=ATTACK_SCHEMA,
        )
        return tidy_attack(attack), spend

    async def paint(self, drawing_jpeg: bytes, stats: dict[str, Any], *, safer: bool = False) -> tuple[bytes, Spend]:
        template, subject, size = art_spec(stats)
        style = pick_style()
        prompt = template.format(
            freedom=ART_FREEDOM[self.s.art_freedom][subject],
            style=ART_STYLES[style][1],
            type=stats.get("type", ""),
            details=stats["art_prompt"],
        )
        if stats.get("shiny"):
            prompt += "\n" + SHINY_ART
        if safer:
            prompt += SAFER_ART
        try:
            result = await self.client.images.edit(
                model=self.s.image_model,
                image=("drawing.jpg", drawing_jpeg, "image/jpeg"),
                prompt=prompt,
                size=size,
                quality=self.s.image_quality,
                output_format="png",
                safety_identifier=self.safety_id,
            )
        except BadRequestError as exc:
            if getattr(exc, "code", None) == "moderation_blocked":
                raise ArtBlocked(str(exc)) from exc
            raise
        usage = result.usage
        details = usage.input_tokens_details if usage else None
        text_in = details.text_tokens if details else 0
        image_in = details.image_tokens if details else 0
        out = usage.output_tokens if usage else 0
        spend = Spend(
            "art",
            self.s.image_model,
            pricing.image_cost(self.s.image_model, text_in, image_in, out),
            {"text_in": text_in, "image_in": image_in, "output": out, "quality": self.s.image_quality,
             "size": size, "style": style, "usage": usage.model_dump() if usage else None},
        )
        return base64.b64decode(result.data[0].b64_json), spend
