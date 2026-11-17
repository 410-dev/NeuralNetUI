"""Unit tests for the download store. Run with: python -m unittest -v"""

import os
import tempfile
import time
import unittest
from pathlib import Path

from downloads import DownloadStore, estimated_size, format_selector, mime_type


class DownloadStoreTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.store = DownloadStore(self.root.name, ttl_minutes=1)

    def tearDown(self):
        self.root.cleanup()

    def test_files_are_found_only_by_their_token(self):
        token, folder = self.store.new_folder()
        file = folder / "clip [abc].webm"
        file.write_bytes(b"x" * 10)
        meta = self.store.remember(token, file, "f" * 64)
        self.assertEqual((meta["size"], meta["mimeType"]), (10, "video/webm"))
        found = self.store.find(token)
        self.assertEqual(found[0], file)
        for bad in ["", "short", "../" + token, token + "/..", "a/b" * 10]:
            self.assertIsNone(self.store.find(bad), bad)

    def test_discard_and_expiry(self):
        token, folder = self.store.new_folder()
        self.assertTrue(self.store.discard(token))
        self.assertFalse(folder.exists())
        old, old_folder = self.store.new_folder()
        fresh, _ = self.store.new_folder()
        past = time.time() - 3600
        os.utime(old_folder, (past, past))
        self.assertEqual(self.store.cleanup(), 1)
        self.assertIsNone(self.store.find(old))
        self.assertTrue((Path(self.root.name) / fresh).is_dir())

    def test_a_name_cannot_escape_its_folder(self):
        token, folder = self.store.new_folder()
        (folder / "meta.json").write_text('{"name": "../../etc/passwd"}', "utf-8")
        self.assertIsNone(self.store.find(token))


class HelpersTest(unittest.TestCase):
    def test_format_selection_prefers_best_video_and_audio(self):
        self.assertEqual(format_selector(None), "bv*+ba/b")
        self.assertTrue(format_selector(1080).startswith("bv*[height<=1080]+ba/b[height<=1080]"))

    def test_size_estimate_needs_every_part(self):
        self.assertEqual(estimated_size({"requested_formats": [{"filesize": 100}, {"filesize_approx": 50}]}), 150)
        self.assertIsNone(estimated_size({"requested_formats": [{"filesize": 100}, {}]}))
        self.assertEqual(estimated_size({"filesize": 7}), 7)

    def test_media_types(self):
        self.assertEqual(mime_type("a.mkv"), "video/x-matroska")
        self.assertEqual(mime_type("a.unknownext"), "application/octet-stream")


if __name__ == "__main__":
    unittest.main()
