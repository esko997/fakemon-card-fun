"""Runtime settings, read once from the environment (and `.env` in the repo root)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


def _str(name: str, default: str) -> str:
    return os.environ.get(name, "").strip() or default


def _api_key() -> str:
    """OPENAI_API_KEY wins; otherwise read OPENAI_API_KEY_FILE so the key can live outside the repo."""
    key = _str("OPENAI_API_KEY", "")
    if key:
        return key
    path = _str("OPENAI_API_KEY_FILE", "")
    return Path(path).expanduser().read_text().strip() if path else ""


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    api_key: str = field(repr=False)
    kid_name: str
    daily_card_limit: int
    parent_pin: str = field(repr=False)   # "" = top-ups need no PIN
    monthly_budget_usd: float
    image_model: str
    image_quality: str
    art_freedom: str                      # faithful | reimagined (see ai.ART_FREEDOM)
    text_model: str
    transcribe_model: str

    @property
    def db_path(self) -> Path:
        return self.data_dir / "cards.sqlite"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"


def load() -> Settings:
    return Settings(
        data_dir=Path(_str("FAKEMON_DATA_DIR", str(ROOT / "data"))),
        api_key=_api_key(),
        kid_name=_str("KID_NAME", "Trainer"),
        daily_card_limit=_int("DAILY_CARD_LIMIT", 15),
        parent_pin=_str("PARENT_PIN", ""),
        monthly_budget_usd=_float("MONTHLY_BUDGET_USD", 20.0),
        image_model=_str("IMAGE_MODEL", "gpt-image-2.5-sunburst"),
        image_quality=_str("IMAGE_QUALITY", "medium"),
        art_freedom=_str("ART_FREEDOM", "reimagined"),
        text_model=_str("TEXT_MODEL", "gpt-6-luna"),
        transcribe_model=_str("TRANSCRIBE_MODEL", "gpt-transcribe"),
    )
