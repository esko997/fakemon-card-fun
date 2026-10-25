"""Consumer-visible notebook boundaries; no paid API calls or live data."""
import io
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from fakemon.play import register_play


class PlayBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = SimpleNamespace(s=SimpleNamespace(data_dir=Path(self.temp.name)))
        @asynccontextmanager
        async def lifespan(api):
            yield
            if hasattr(self.state, "play"):
                self.state.play.db.close()
        api = FastAPI(lifespan=lifespan)
        register_play(api, lambda: self.state)
        self.client = TestClient(api)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def create(self, kind="facts", data=None):
        response = self.client.post("/api/play/books", json={"kind": kind, "title": "My discoveries", "data": data or {}})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def save(self, book):
        return self.client.put(f"/api/play/books/{book['id']}", json={
            "title": book["title"], "data": book["data"], "revision": book["revision"],
        })

    def test_ten_facts_survive_reload_and_cannot_be_reset_by_save(self):
        book = self.create(data={"fact_ids": ["invented"], "paused": True})
        self.assertEqual(book["data"]["fact_ids"], [])
        ids = []
        for _ in range(10):
            response = self.client.post(f"/api/play/books/{book['id']}/next", json={"topic": "all"})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            ids.append(result["fact"]["id"])
            book = result["book"]
        self.assertEqual(len(set(ids)), 10)
        self.assertTrue(book["data"]["paused"])
        book["data"] = {"fact_ids": [], "paused": False, "reflection": "I wondered about the ocean."}
        book = self.save(book).json()
        reloaded = self.client.get(f"/api/play/books/{book['id']}").json()
        self.assertEqual(reloaded["data"]["fact_ids"], ids)
        self.assertTrue(reloaded["data"]["paused"])
        self.assertEqual(reloaded["data"]["reflection"], "I wondered about the ocean.")
        response = self.client.post(f"/api/play/books/{book['id']}/next", json={"topic": "space"})
        self.assertEqual(response.status_code, 409)
        # Reflection remains editable without unlocking another fact.
        book["data"]["reflection"] = "I want to draw it."
        self.assertEqual(self.save(book).status_code, 200)

    def test_stale_window_cannot_overwrite_saved_story(self):
        book = self.create("story", {"pages": [{"text": "The cat went to the moon."}]})
        stale = dict(book, data={"pages": [{"text": "Old window"}]})
        book["data"]["pages"].append({"text": "It found a star."})
        saved = self.save(book).json()
        self.assertEqual(self.save(stale).status_code, 409)
        reloaded = self.client.get(f"/api/play/books/{book['id']}").json()
        self.assertEqual(reloaded["data"]["pages"], saved["data"]["pages"])

    def test_corrected_words_do_not_replace_original_photo(self):
        original = io.BytesIO()
        Image.new("RGB", (12, 12), (12, 45, 78)).save(original, "PNG")
        raw = original.getvalue()
        response = self.client.post("/api/play/upload", files={"file": ("writing.png", raw, "image/png")})
        self.assertEqual(response.status_code, 200)
        asset = response.json()
        book = self.create("story", {"pages": [{"text": "mi cat", "photo": asset}]})
        book["data"]["pages"][0]["text"] = "My cat"
        self.assertEqual(self.save(book).status_code, 200)
        self.assertEqual(self.client.get(asset["url"]).content, raw)
        self.assertEqual(self.client.get(f"/api/play/books/{book['id']}").json()["data"]["pages"][0]["photo"]["id"], asset["id"])


if __name__ == "__main__":
    unittest.main()
