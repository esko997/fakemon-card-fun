"""SQLite persistence. All access happens on the event-loop thread (async endpoints only)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL,          -- working | ready | failed
    step          TEXT NOT NULL,          -- listening | inventing | painting | done
    error         TEXT,
    drawing_file  TEXT NOT NULL,
    audio_file    TEXT NOT NULL,
    audio_mime    TEXT NOT NULL,
    audio_seconds REAL NOT NULL,
    transcript    TEXT,
    stats         TEXT,                   -- JSON, see ai.CARD_SCHEMA
    art_file      TEXT,
    hidden        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS spend (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    month      TEXT NOT NULL,             -- YYYY-MM, local time
    card_id    INTEGER,
    kind       TEXT NOT NULL,             -- transcribe | text | art
    model      TEXT NOT NULL,
    cost_usd   REAL NOT NULL,
    detail     TEXT NOT NULL              -- JSON usage payload
);
-- One row per art generation in flight or finished; failed attempts are removed (refunded).
CREATE TABLE IF NOT EXISTS art_slots (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    day     TEXT NOT NULL,                -- YYYY-MM-DD, local time
    card_id INTEGER NOT NULL
);
-- Extra cards a grown-up granted for one day, on top of DAILY_CARD_LIMIT.
CREATE TABLE IF NOT EXISTS top_ups (
    day   TEXT PRIMARY KEY,               -- YYYY-MM-DD, local time
    extra INTEGER NOT NULL
);
"""


@dataclass
class Card:
    id: int
    created_at: str
    status: str
    step: str
    error: str | None
    drawing_file: str
    audio_file: str
    audio_mime: str
    audio_seconds: float
    transcript: str | None
    stats: dict[str, Any] | None
    art_file: str | None
    hidden: bool

    @property
    def kind(self) -> str | None:
        """Failure category from the stored error prefix: art_blocked | out_of_credits | error."""
        return self.error.split(":", 1)[0] if self.error else None

    def public(self) -> dict[str, Any]:
        base = f"/media/{self.id}"
        return {
            "id": self.id,
            "created_at": self.created_at,
            "status": self.status,
            "step": self.step,
            "error_kind": self.kind,
            "transcript": self.transcript,
            "stats": self.stats,
            "drawing_url": f"{base}/{self.drawing_file}",
            "audio_url": f"{base}/{self.audio_file}",
            "art_url": f"{base}/{self.art_file}" if self.art_file else None,
            "hidden": self.hidden,
        }


def _now() -> datetime:
    return datetime.now().astimezone()


def today() -> str:
    return _now().strftime("%Y-%m-%d")


def this_month() -> str:
    return _now().strftime("%Y-%m")


class Store:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)

    # --- cards -------------------------------------------------------------

    def _card(self, row: sqlite3.Row) -> Card:
        data = dict(row)
        data["stats"] = json.loads(data["stats"]) if data["stats"] else None
        data["hidden"] = bool(data["hidden"])
        return Card(**data)

    def create_card(self, *, drawing_file: str, audio_file: str, audio_mime: str, audio_seconds: float) -> int:
        cur = self.db.execute(
            "INSERT INTO cards (created_at, status, step, drawing_file, audio_file, audio_mime, audio_seconds)"
            " VALUES (?, 'working', 'listening', ?, ?, ?, ?)",
            (_now().isoformat(timespec="seconds"), drawing_file, audio_file, audio_mime, audio_seconds),
        )
        return int(cur.lastrowid)

    def get(self, card_id: int) -> Card | None:
        row = self.db.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return self._card(row) if row else None

    def list(self, *, hidden: bool) -> list[Card]:
        rows = self.db.execute("SELECT * FROM cards WHERE hidden = ? ORDER BY id DESC", (int(hidden),)).fetchall()
        return [self._card(r) for r in rows]

    def update(self, card_id: int, **fields: Any) -> None:
        if "stats" in fields and fields["stats"] is not None:
            fields["stats"] = json.dumps(fields["stats"])
        if "hidden" in fields:
            fields["hidden"] = int(fields["hidden"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.db.execute(f"UPDATE cards SET {cols} WHERE id = ?", (*fields.values(), card_id))

    def fail_interrupted(self) -> int:
        """Cards left 'working' by a server restart can never finish; mark them retryable."""
        cur = self.db.execute(
            "UPDATE cards SET status = 'failed', error = 'error: Server restarted mid-way' WHERE status = 'working'"
        )
        return cur.rowcount

    # --- daily art allowance --------------------------------------------------

    def art_used_today(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM art_slots WHERE day = ?", (today(),)).fetchone()[0]

    def take_art_slot(self, card_id: int, limit: int) -> int | None:
        """Reserve one art generation for today; None when the daily allowance is spent."""
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.art_used_today() >= limit:
                self.db.execute("ROLLBACK")
                return None
            cur = self.db.execute("INSERT INTO art_slots (day, card_id) VALUES (?, ?)", (today(), card_id))
            self.db.execute("COMMIT")
            return int(cur.lastrowid)
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def refund_art_slot(self, slot_id: int) -> None:
        self.db.execute("DELETE FROM art_slots WHERE id = ?", (slot_id,))

    def top_up_today(self) -> int:
        row = self.db.execute("SELECT extra FROM top_ups WHERE day = ?", (today(),)).fetchone()
        return int(row[0]) if row else 0

    def add_top_up(self, count: int) -> None:
        self.db.execute(
            "INSERT INTO top_ups (day, extra) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET extra = extra + excluded.extra",
            (today(), count),
        )

    # --- spend ----------------------------------------------------------------

    def record_spend(self, *, card_id: int | None, kind: str, model: str, cost_usd: float, detail: dict) -> None:
        self.db.execute(
            "INSERT INTO spend (created_at, month, card_id, kind, model, cost_usd, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (_now().isoformat(timespec="seconds"), this_month(), card_id, kind, model, cost_usd, json.dumps(detail)),
        )

    def month_spend(self) -> float:
        row = self.db.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM spend WHERE month = ?", (this_month(),)).fetchone()
        return float(row[0])

    def spend_summary(self) -> dict[str, Any]:
        by_kind = self.db.execute(
            "SELECT kind, model, COUNT(*) AS calls, SUM(cost_usd) AS usd FROM spend WHERE month = ? GROUP BY kind, model",
            (this_month(),),
        ).fetchall()
        recent = self.db.execute(
            "SELECT card_id, SUM(cost_usd) AS usd, MIN(created_at) AS at FROM spend"
            " WHERE card_id IS NOT NULL GROUP BY card_id ORDER BY card_id DESC LIMIT 20"
        ).fetchall()
        return {
            "month": this_month(),
            "month_usd": self.month_spend(),
            "by_kind": [dict(r) for r in by_kind],
            "per_card": [dict(r) for r in recent],
        }
