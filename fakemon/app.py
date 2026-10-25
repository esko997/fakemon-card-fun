"""HTTP API + static kid-facing app."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import APIStatusError
from pydantic import BaseModel

from . import pricing
from .ai import ART_FREEDOM, ArtBlocked, CardAI, Spend, normalize_drawing
from .config import ROOT, load
from .store import Card, Store

log = logging.getLogger("fakemon")

AUDIO_EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav"}
MAX_UPLOAD = 25 * 1024 * 1024


class TopUp(BaseModel):
    count: int
    pin: str = ""


class App:
    def __init__(self) -> None:
        self.s = load()
        pricing.check_known(
            image_model=self.s.image_model, text_model=self.s.text_model, transcribe_model=self.s.transcribe_model
        )
        if not self.s.api_key:
            raise SystemExit("No OpenAI key: set OPENAI_API_KEY or OPENAI_API_KEY_FILE in .env (see .env.example).")
        if self.s.art_freedom not in ART_FREEDOM:
            raise SystemExit(f"ART_FREEDOM must be one of: {', '.join(ART_FREEDOM)} (got {self.s.art_freedom!r}).")
        self.s.media_dir.mkdir(parents=True, exist_ok=True)
        self.store = Store(self.s.db_path)
        self.ai = CardAI(self.s)
        self.tasks: set[asyncio.Task] = set()
        interrupted = self.store.fail_interrupted()
        if interrupted:
            log.warning("marked %d interrupted card(s) as failed", interrupted)

    # --- helpers ----------------------------------------------------------------

    @property
    def client_log(self) -> Path:
        return self.s.data_dir / "client-errors.log"

    def client_errors(self, limit: int) -> list[dict[str, Any]]:
        """Newest first."""
        if not self.client_log.is_file():
            return []
        out = []
        for line in reversed(self.client_log.read_text().splitlines()[-limit:]):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out

    def card_dir(self, card_id: int) -> Path:
        return self.s.media_dir / str(card_id)

    def require_card(self, card_id: int) -> Card:
        card = self.store.get(card_id)
        if card is None:
            raise HTTPException(404, "No such card")
        return card

    def require_budget(self) -> None:
        if self.store.month_spend() >= self.s.monthly_budget_usd:
            raise HTTPException(402, "budget")

    def limit_today(self) -> int:
        return self.s.daily_card_limit + self.store.top_up_today()

    def take_slot(self, card_id: int) -> int:
        slot = self.store.take_art_slot(card_id, self.limit_today())
        if slot is None:
            raise HTTPException(429, "daily_limit")
        return slot

    def record(self, card_id: int, spend: Spend) -> None:
        self.store.record_spend(
            card_id=card_id, kind=spend.kind, model=spend.model, cost_usd=spend.cost_usd, detail=spend.detail
        )

    def spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def status(self) -> dict:
        limit = self.limit_today()
        return {
            "kid_name": self.s.kid_name,
            "env": self.s.env,
            "daily_limit": limit,
            "cards_left_today": max(0, limit - self.store.art_used_today()),
            "budget_ok": self.store.month_spend() < self.s.monthly_budget_usd,
            "pin_required": bool(self.s.parent_pin),
        }

    # --- pipeline ---------------------------------------------------------------

    async def run(self, card_id: int, slot_id: int | None, *, repaint: bool = False, safer: bool = False) -> None:
        """Fill in whatever the card is missing: transcript, stats, art. Safe to re-run after failure."""
        painted = False
        try:
            card = self.require_card(card_id)
            folder = self.card_dir(card_id)
            drawing = (folder / card.drawing_file).read_bytes()

            transcript = card.transcript
            if transcript is None:
                self.store.update(card_id, step="listening")
                audio = (folder / card.audio_file).read_bytes()
                transcript, spend = await self.ai.transcribe(audio, card.audio_file, card.audio_mime, card.audio_seconds)
                self.record(card_id, spend)
                self.store.update(card_id, transcript=transcript)

            stats = card.stats
            if stats is None:
                self.store.update(card_id, step="inventing")
                stats, spend = await self.ai.invent_card(drawing, transcript)
                self.record(card_id, spend)
                self.store.update(card_id, stats=stats)

            if card.art_file is None or repaint:
                self.store.update(card_id, step="painting")
                png, spend = await self.ai.paint(drawing, stats, safer=safer)
                self.record(card_id, spend)
                painted = True
                art_file = f"art-{int(time.time() * 1000)}.png"
                (folder / art_file).write_bytes(png)
                if card.art_file:
                    (folder / card.art_file).unlink(missing_ok=True)
                self.store.update(card_id, art_file=art_file)

            self.store.update(card_id, status="ready", step="done", error=None)
        except Exception as exc:  # noqa: BLE001 - every failure must leave the card retryable
            log.exception("card %d failed", card_id)
            if slot_id is not None and not painted:
                self.store.refund_art_slot(slot_id)
            message = f"{error_kind(exc)}: {type(exc).__name__}: {exc}"
            # A failed repaint leaves the existing card intact.
            card = self.store.get(card_id)
            status = "ready" if repaint and card and card.art_file else "failed"
            self.store.update(card_id, status=status, step="done", error=message[:2000])


OUT_OF_CREDITS = {"insufficient_quota", "credit_balance_exhausted"}


def error_kind(exc: Exception) -> str:
    """Stable prefix stored on the card; the UI and retry logic key off it."""
    if isinstance(exc, ArtBlocked):
        return "art_blocked"
    if isinstance(exc, APIStatusError) and (exc.code in OUT_OF_CREDITS or exc.type in OUT_OF_CREDITS):
        return "out_of_credits"
    return "error"


def create_app() -> FastAPI:
    state: dict[str, App] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        state["app"] = App()
        yield
        for task in list(state["app"].tasks):
            task.cancel()

    api = FastAPI(title="Fakemon Card Maker", lifespan=lifespan)

    def app() -> App:
        return state["app"]

    @api.middleware("http")
    async def no_stale_shell(request: Request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/media/"):
            # Old tablets cache aggressively; always revalidate the app shell and API.
            response.headers["Cache-Control"] = "no-cache"
        return response

    @api.get("/api/status")
    async def get_status():
        return app().status()

    @api.post("/api/cards")
    async def create_card(
        drawing: UploadFile = File(...),
        audio: UploadFile = File(...),
        audio_seconds: float = Form(...),
    ):
        a = app()
        a.require_budget()
        raw_drawing = await drawing.read(MAX_UPLOAD + 1)
        raw_audio = await audio.read(MAX_UPLOAD + 1)
        if len(raw_drawing) > MAX_UPLOAD or len(raw_audio) > MAX_UPLOAD:
            raise HTTPException(413, "Upload too large")
        mime = (audio.content_type or "audio/webm").split(";")[0].strip()
        ext = AUDIO_EXT.get(mime)
        if ext is None:
            raise HTTPException(415, f"Unsupported audio type {mime}")
        try:
            jpeg = normalize_drawing(raw_drawing)
        except Exception as exc:
            raise HTTPException(400, f"Not a readable picture: {exc}") from exc

        # No awaits from here to take_slot, so the check and the reservation are atomic on the event loop.
        if a.store.art_used_today() >= a.limit_today():
            raise HTTPException(429, "daily_limit")
        audio_file = f"story.{ext}"
        card_id = a.store.create_card(
            drawing_file="drawing.jpg", audio_file=audio_file, audio_mime=mime, audio_seconds=max(audio_seconds, 0.1)
        )
        slot = a.take_slot(card_id)
        folder = a.card_dir(card_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "drawing.jpg").write_bytes(jpeg)
        (folder / audio_file).write_bytes(raw_audio)
        a.spawn(a.run(card_id, slot))
        return a.require_card(card_id).public()

    @api.get("/api/cards")
    async def list_cards(hidden: bool = False):
        return [c.public() for c in app().store.list(hidden=hidden)]

    @api.get("/api/cards/{card_id}")
    async def get_card(card_id: int):
        return app().require_card(card_id).public()

    @api.post("/api/cards/{card_id}/retry")
    async def retry(card_id: int):
        a = app()
        card = a.require_card(card_id)
        if card.status != "failed":
            raise HTTPException(409, "Card is not failed")
        a.require_budget()
        slot = a.take_slot(card_id) if card.art_file is None else None
        blocked = card.kind == "art_blocked"
        # The same request would just be blocked again: paint with the gentler prompt, and if the
        # card was never revealed, also re-invent it (new art description). A revealed card keeps
        # its name and attacks.
        fields = {"stats": None} if blocked and card.art_file is None else {}
        a.store.update(card_id, status="working", error=None, **fields)
        a.spawn(a.run(card_id, slot, safer=blocked))
        return a.require_card(card_id).public()

    @api.post("/api/cards/{card_id}/new-art")
    async def new_art(card_id: int):
        a = app()
        card = a.require_card(card_id)
        if card.status != "ready":
            raise HTTPException(409, "Card is busy")
        a.require_budget()
        slot = a.take_slot(card_id)
        blocked = card.kind == "art_blocked"
        a.store.update(card_id, status="working", step="painting", error=None)
        a.spawn(a.run(card_id, slot, repaint=True, safer=blocked))
        return a.require_card(card_id).public()

    @api.post("/api/cards/{card_id}/attacks/{index}/new")
    async def new_attack(card_id: int, index: int):
        a = app()
        card = a.require_card(card_id)
        if card.status != "ready" or card.stats is None:
            raise HTTPException(409, "Card is busy")
        if card.stats["card_type"] != "pokemon" or not 0 <= index < len(card.stats["attacks"]):
            raise HTTPException(404, "No such attack")
        a.require_budget()
        try:
            attack, spend = await a.ai.new_attack(card.stats, card.transcript or "", index)
        except APIStatusError as exc:
            if error_kind(exc) == "out_of_credits":
                raise HTTPException(402, "out_of_credits") from exc
            raise HTTPException(502, f"OpenAI error: {exc}") from exc
        a.record(card_id, spend)
        stats = a.require_card(card_id).stats
        stats["attacks"][index] = attack
        a.store.update(card_id, stats=stats)
        return a.require_card(card_id).public()

    @api.post("/api/cards/{card_id}/hide")
    async def hide(card_id: int):
        app().require_card(card_id)
        app().store.update(card_id, hidden=True)
        return {"ok": True}

    @api.post("/api/cards/{card_id}/unhide")
    async def unhide(card_id: int):
        app().require_card(card_id)
        app().store.update(card_id, hidden=False)
        return {"ok": True}

    @api.post("/api/top-up")
    async def top_up(body: TopUp):
        a = app()
        if a.s.parent_pin and not hmac.compare_digest(body.pin.encode(), a.s.parent_pin.encode()):
            raise HTTPException(403, "wrong_pin")
        if not 1 <= body.count <= 20:
            raise HTTPException(400, "count must be 1-20")
        a.store.add_top_up(body.count)
        return a.status()

    @api.get("/api/spend")
    async def spend():
        a = app()
        failed = [
            {"id": c.id, "error": c.error}
            for c in a.store.list(hidden=False) + a.store.list(hidden=True)
            if c.error
        ]
        return {
            **a.store.spend_summary(),
            "budget_usd": a.s.monthly_budget_usd,
            "models": {"image": a.s.image_model, "quality": a.s.image_quality, "text": a.s.text_model,
                       "transcribe": a.s.transcribe_model},
            "errors": failed[:20],
            "client_errors": a.client_errors(10),
        }

    @api.post("/api/client-errors")
    async def client_errors(entries: list[dict[str, Any]]):
        """Failures the tablet saw but the server never did (e.g. an upload lost on the way)."""
        a = app()
        with a.client_log.open("a") as f:
            for entry in entries[-20:]:
                # Cap values, not the serialized line, so every line stays valid JSON.
                line = json.dumps({k: str(v)[:500] if isinstance(v, str) else v for k, v in entry.items()},
                                  ensure_ascii=False)
                log.warning("tablet error: %s", line)
                f.write(line + "\n")
        return {"ok": True}

    @api.get("/media/{card_id}/{name}")
    async def media(card_id: int, name: str):
        card = app().require_card(card_id)
        if name not in {card.drawing_file, card.audio_file, card.art_file}:
            raise HTTPException(404, "No such file")
        path = app().card_dir(card_id) / name
        if not path.is_file():
            raise HTTPException(404, "No such file")
        return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @api.get("/ca.crt")
    async def ca_cert():
        path = app().s.data_dir / "certs" / "ca.crt"
        if not path.is_file():
            raise HTTPException(404, "No local CA generated; run ./run.sh")
        return FileResponse(path, media_type="application/x-x509-ca-cert", filename="fakemon-ca.crt")

    api.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
    return api
