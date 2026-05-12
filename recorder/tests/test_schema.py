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


class TestRedactionAndFormContext(unittest.TestCase):
    """Verifica que los nuevos campos (redacted, value_length, form_*, label,
    placeholder) sobreviven al passthrough del schema."""

    def test_input_redacted_passthrough(self):
        data = {
            "tag": "INPUT",
            "input_type": "password",
            "value": "[REDACTED]",
            "value_length": 16,
            "redacted": True,
            "selectors": {"id": "pw", "name": "password"},
        }
        out = clean_event_data("input", data)
        self.assertEqual(out["value"], "[REDACTED]")
        self.assertEqual(out["value_length"], 16)
        self.assertTrue(out["redacted"])

    def test_input_normal_value_passthrough(self):
        """Un input no sensible mantiene el value sin tocar."""
        data = {
            "tag": "INPUT",
            "input_type": "email",
            "value": "fede@example.com",
            "label": "Email",
            "placeholder": "you@example.com",
        }
        out = clean_event_data("input", data)
        self.assertEqual(out["value"], "fede@example.com")
        self.assertEqual(out["label"], "Email")
        self.assertEqual(out["placeholder"], "you@example.com")
        self.assertNotIn("redacted", out)
        self.assertNotIn("value_length", out)

    def test_input_form_context_passthrough(self):
        data = {
            "tag": "INPUT",
            "value": "x",
            "form_id": "checkout-form",
            "form_name": "checkout",
            "form_action": "/api/checkout",
        }
        out = clean_event_data("input", data)
        self.assertEqual(out["form_id"], "checkout-form")
        self.assertEqual(out["form_name"], "checkout")
        self.assertEqual(out["form_action"], "/api/checkout")

    def test_paste_redacted_passthrough(self):
        data = {
            "tag": "INPUT",
            "text": "[REDACTED]",
            "text_length": 24,
            "redacted": True,
        }
        out = clean_event_data("paste", data)
        self.assertEqual(out["text"], "[REDACTED]")
        self.assertEqual(out["text_length"], 24)
        self.assertTrue(out["redacted"])

    def test_paste_normal_text_passthrough(self):
        data = {"tag": "INPUT", "text": "hola"}
        out = clean_event_data("paste", data)
        self.assertEqual(out["text"], "hola")
        self.assertNotIn("redacted", out)

    def test_form_fields_apply_to_click(self):
        """click hereda _ELEMENT_FIELDS, asi que form_id deberia pasar."""
        data = {
            "x": 10, "y": 20, "button": "left",
            "tag": "BUTTON", "text": "Pagar",
            "form_id": "checkout-form",
        }
        out = clean_event_data("click", data)
        self.assertEqual(out["form_id"], "checkout-form")

    def test_zero_value_length_preserved(self):
        """Un value vacío redactado debe conservar value_length=0."""
        data = {
            "tag": "INPUT", "input_type": "password",
            "value": "[REDACTED]", "value_length": 0, "redacted": True,
        }
        out = clean_event_data("input", data)
        self.assertIn("value_length", out)
        self.assertEqual(out["value_length"], 0)


if __name__ == "__main__":
    unittest.main()
