"""Tests del schema cleaner."""
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from schema import clean_event_data, is_known_type


class TestCleanEventData(unittest.TestCase):

    def test_drops_redundant_meta_fields(self):
        # browser_server.py ya los filtra, pero el schema reforzaría si pasara algo
        data = {"url": "x", "title": "y", "source": "browser", "type": "page_load", "time": 12345}
        out = clean_event_data("page_load", data)
        self.assertEqual(set(out.keys()), {"url", "title"})

    def test_keeps_only_declared_fields(self):
        data = {"url": "x", "title": "y", "junk": "ignore", "another": "drop"}
        out = clean_event_data("page_load", data)
        self.assertEqual(set(out.keys()), {"url", "title"})

    def test_drops_empty_values(self):
        data = {"url": "x", "title": "y", "referrer": "", "description": None}
        out = clean_event_data("page_load", data)
        self.assertEqual(set(out.keys()), {"url", "title"})

    def test_unknown_type_passes_through(self):
        data = {"weird": "field"}
        out = clean_event_data("never_seen_type", data)
        self.assertEqual(out, data)

    def test_click_with_element_fields(self):
        data = {
            "x": 100, "y": 200, "button": "left",
            "tag": "BUTTON", "text": "Comprar",
            "selectors": {"xpath": "/a[1]", "id": "buy", "css": "#buy"},
        }
        out = clean_event_data("click", data)
        self.assertIn("tag", out)
        self.assertIn("selectors", out)
        self.assertEqual(out["selectors"]["id"], "buy")

    def test_is_known_type(self):
        self.assertTrue(is_known_type("click"))
        self.assertTrue(is_known_type("scroll_summary"))
        self.assertFalse(is_known_type("not_real"))


if __name__ == "__main__":
    unittest.main()
