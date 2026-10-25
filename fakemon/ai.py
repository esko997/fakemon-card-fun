"""OpenAI calls: transcribe the story, invent card stats, paint the art."""

from __future__ import annotations

import base64
import hashlib
import io
import json
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

CARD_SCHEMA: dict[str, Any] = {
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
        "species": {"type": "string", "description": "Short category, e.g. 'Bubble Dragon'."},
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

CARD_INSTRUCTIONS = """\
You turn a child's invented creature into a trading card for a home card-making game.
The child drew the creature (the image) and described it out loud (the transcript, which
may contain speech-recognition mistakes; interpret it generously).

Rules:
- The child's ideas win. If they say the creature's name, type, HP, attacks, energy costs,
  weakness, resistance, powers, size, or where it lives, use exactly that (fix only obvious
  transcription errors). Invent only what they didn't say, in the spirit of what they said and drew.
- Types are the card game's energy types. Map other words: electric -> lightning, dark -> darkness,
  steel -> metal, normal -> colorless, ice -> water, ghost/fairy -> psychic, rock/ground -> fighting,
  bug/plant -> grass.
- Attack cost is a list of energy symbols: usually the creature's own type plus some colorless.
  If the child says how many energies an attack needs, use that many (max 4).
- kind: "mega_ex" if the child says Mega (put "Mega " at the start of the name), "ex" if they say
  ex or describe it as legendary or super strong, otherwise "regular". Never put "ex" in the name.
- Short and readable for a young child: name <= 18 characters, attack names <= 20,
  attack/ability text <= 90 characters, flavor text <= 120 characters.
- An original creature: never use names of real Pokémon or other existing characters.
- Fun and a bit over-the-top. Use the child's HP and damage numbers exactly, however big. When you
  invent them, damage is a multiple of 10 (10-200, ex up to 300), optionally ending in '+' or '×',
  and HP is 30-300.
- Give 1 or 2 attacks. Include an ability only if the child described a special power that isn't an attack.
- Kid-friendly content only.
- art_prompt: 2-4 sentences describing how the creature looks in the drawing (body shape,
  colors, number of limbs/eyes, horns, wings, tail, markings), a lively pose, and a simple
  background that fits where it lives. If the drawing is uncolored, pick colors from the
  description or the creature's type.
"""

ATTACK_INSTRUCTIONS = """\
You are helping a child improve a trading card for a creature they invented. Replace one
attack with a brand new, different attack that fits the creature. Keep it short and fun:
name <= 20 characters, text <= 90 characters, damage a multiple of 10 (10-200), optionally
ending in '+' or '×'. Cost is 1-4 energy symbols, usually the creature's type plus some
colorless. Never use names of real Pokémon moves or existing characters.
"""

ART_PROMPT = """\
Redraw the creature in this child's drawing as polished artwork for a collectible monster trading card.
Stay faithful to the child's design: keep the same body shape, number of limbs and eyes, horns, wings,
tail, markings and colors as drawn. It is their creature, illustrated by a professional artist.
Style: vibrant cel-shaded anime monster illustration, bold clean outlines, friendly dynamic pose,
whole creature visible and centered.
Background: simple and uncluttered, matching its habitat, with {type}-themed colors.
Creature details: {details}
No text, letters, numbers, logos, borders or card frame anywhere in the image.
"""

# ex cards are full-art: portrait, the creature bursting with energy, filling the frame.
EX_ART_PROMPT = """\
Redraw the creature in this child's drawing as a dramatic full-art illustration for a rare collectible
monster trading card, portrait orientation.
Stay faithful to the child's design: keep the same body shape, number of limbs and eyes, horns, wings,
tail, markings and colors as drawn. It is their creature, illustrated by a professional artist.
Style: vibrant cel-shaded anime monster illustration, bold clean outlines, powerful dynamic pose seen
slightly from below, the creature large in the upper half of the image, swirling {type}-themed energy
ribbons and sparkles bursting around it and flowing to the edges.
Creature details: {details}
No text, letters, numbers, logos, borders or card frame anywhere in the image.
"""

ART_SIZE = {"regular": "1536x1024", "ex": "1024x1536", "mega_ex": "1024x1536"}

# Appended after a moderation block; resending the identical request would only be blocked again.
SAFER_ART = """\
Keep it gentle and cute, like a picture book for young children: no weapons, blood, injuries,
scary faces or violence. Show powers as harmless sparkles, glows or splashes.
"""

TRANSCRIBE_PROMPT = (
    "A young child describes a monster they invented for a trading card: its name, "
    "what it looks like, its powers, attacks and where it lives."
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


def tidy_card(stats: dict[str, Any]) -> dict[str, Any]:
    """Structured output guarantees shape, not ranges; enforce what the card layout relies on."""
    attacks = [tidy_attack(a) for a in stats["attacks"][:2]]
    if not attacks:
        raise ValueError("card came back with no attacks")
    return {
        **stats,
        "hp": _clamp(round(int(stats["hp"]) / 10) * 10, 10, 990),   # 3 digits fit the header
        "retreat": _clamp(int(stats["retreat"]), 0, 4),
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
        kind = stats["kind"]
        template = ART_PROMPT if kind == "regular" else EX_ART_PROMPT
        prompt = template.format(type=stats["type"], details=stats["art_prompt"])
        if safer:
            prompt += SAFER_ART
        try:
            result = await self.client.images.edit(
                model=self.s.image_model,
                image=("drawing.jpg", drawing_jpeg, "image/jpeg"),
                prompt=prompt,
                size=ART_SIZE[kind],
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
             "size": ART_SIZE[kind], "usage": usage.model_dump() if usage else None},
        )
        return base64.b64decode(result.data[0].b64_json), spend
