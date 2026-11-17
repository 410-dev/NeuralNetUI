"""Unit tests for the subtitle logic. Run with: python -m unittest -v"""

import json
import unittest

from subtitles import SubtitleError, choose_track, page, parse_subtitles, transcript_text, video_url

FMT = [{"ext": "vtt", "url": "https://example/vtt"}, {"ext": "json3", "url": "https://example/json3"}]


class VideoUrlTest(unittest.TestCase):
    def test_accepts_youtube_forms(self):
        expected = ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ")
        for value in ["dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=x", "youtube.com/watch?v=dQw4w9WgXcQ&t=10",
                      "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ",
                      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]:
            self.assertEqual(video_url(value), expected, value)

    def test_rejects_other_hosts_and_non_videos(self):
        for value in ["https://example.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
                      "file:///etc/passwd", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/@channel", ""]:
            with self.assertRaises(SubtitleError, msg=value):
                video_url(value)


class ChooseTrackTest(unittest.TestCase):
    def test_uploaded_subtitles_in_the_spoken_language_win(self):
        info = {"language": "ko", "subtitles": {"en": FMT, "ko": FMT}, "automatic_captions": {"ko-orig": FMT}}
        track = choose_track(info, "", ["en"])
        self.assertEqual((track.language, track.kind), ("ko", "manual"))

    def test_spoken_language_captions_are_found_among_several_originals(self):
        info = {"language": "ko", "subtitles": {}, "automatic_captions": {"en-orig": FMT, "ko-orig": FMT, "ko": FMT, "fr": FMT}}
        track = choose_track(info, "", ["en"])
        self.assertEqual((track.language, track.kind, track.translated), ("ko", "auto", False))

    def test_requested_language_falls_back_to_a_marked_translation(self):
        info = {"language": "en", "subtitles": {}, "automatic_captions": {"en-orig": FMT, "ko": FMT}}
        track = choose_track(info, "ko", [])
        self.assertEqual((track.language, track.translated), ("ko", True))
        with self.assertRaises(SubtitleError):
            choose_track(info, "xx", [])

    def test_regional_codes_match_their_base_language(self):
        info = {"language": "en", "subtitles": {"en-US": FMT, "live_chat": FMT}, "automatic_captions": {}}
        self.assertEqual(choose_track(info, "en", []).language, "en-US")

    def test_videos_without_any_track_are_reported(self):
        with self.assertRaises(SubtitleError):
            choose_track({"subtitles": {}, "automatic_captions": {}}, "", ["en"])


class ParseTest(unittest.TestCase):
    def test_json3_events_are_joined_and_repeats_removed(self):
        raw = json.dumps({"events": [
            {"tStartMs": 0, "segs": [{"utf8": "Hello "}, {"utf8": "there"}]},
            {"tStartMs": 900, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 1000, "segs": [{"utf8": "Hello there"}]},
            {"tStartMs": 5000, "segs": [{"utf8": "Next &amp; last"}]},
        ]})
        self.assertEqual(parse_subtitles(raw, "json3"), [(0, "Hello there"), (5000, "Next & last")])

    def test_rolling_vtt_lines_are_kept_once(self):
        raw = ("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nfirst line\n\n"
               "00:00:02.000 --> 00:00:03.000\nfirst line\n<c>second</c> line\n\n"
               "01:00:03.500 --> 01:00:04.000\nsecond line\nthird line\n")
        self.assertEqual(parse_subtitles(raw, "vtt"), [(1000, "first line"), (2000, "second line"), (3603500, "third line")])

    def test_srv_xml(self):
        raw = '<timedtext><body><p t="1500" d="900">Hi &#39;you&#39;</p><p t="4000">Bye</p></body></timedtext>'
        self.assertEqual(parse_subtitles(raw, "srv3"), [(1500, "Hi 'you'"), (4000, "Bye")])


class TextTest(unittest.TestCase):
    def test_paragraphs_break_on_pauses_and_carry_timestamps(self):
        cues = [(0, "a"), (1000, "b"), (5000, "c"), (3_725_000, "d")]
        self.assertEqual(transcript_text(cues), "a b\n\nc\n\nd")
        self.assertEqual(transcript_text(cues, True), "[0:00] a b\n\n[0:05] c\n\n[1:02:05] d")

    def test_pages_cut_at_spaces_and_point_to_the_rest(self):
        text = "one two three four five six"
        first, following = page(text, 0, 10)
        self.assertEqual((first, following), ("one two", 7))
        rest, end = page(text, following, 100)
        self.assertEqual((rest, end), (" three four five six", None))


if __name__ == "__main__":
    unittest.main()
