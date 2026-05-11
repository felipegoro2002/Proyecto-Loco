"""
Tests del compresor. Cada transform tiene un test enfocado + un end-to-end
sobre una sesión sintética que reproduce los problemas reales detectados:
- reading_pause con scroll_pct bajo (nav noise)
- element_read sobre breadcrumbs y paginación
- network con paths de tracking
- scrolls de movimiento nulo
- page_summary de redirects cortos
"""
import os
import sys
import unittest

# Permite correr el archivo desde tests/ o desde recorder/
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from compressor import (
    cap_reading_pause_elements,
    compress,
    compress_scroll,
    drop_noise_types,
    drop_redirect_pages,
    drop_short_page_summary,
    filter_element_read,
    filter_hover,
    filter_network,
    filter_reading_pause,
)


def ev(time, source, type_, **data):
    return {"time": time, "source": source, "type": type_, "data": data}


class TestDropNoiseTypes(unittest.TestCase):
    def test_drops_focus_blur_keydown(self):
        events = [
            ev(0, "browser", "focus"),
            ev(1, "browser", "click", x=10, y=10),
            ev(2, "browser", "keydown"),
            ev(3, "browser", "blur"),
        ]
        out = drop_noise_types(events)
        self.assertEqual([_["type"] for _ in out], ["click"])


class TestDropRedirectPages(unittest.TestCase):
    def test_drops_google_redirect_pageload(self):
        events = [
            ev(0, "browser", "page_load", url="https://google.com/url?q=foo"),
            ev(1, "browser", "page_load", url="https://amazon.com.mx/dp/X"),
        ]
        out = drop_redirect_pages(events)
        self.assertEqual(len(out), 1)
        self.assertIn("amazon", out[0]["data"]["url"])


class TestDropShortPageSummary(unittest.TestCase):
    def test_drops_summary_under_500ms(self):
        events = [
            ev(0, "browser", "page_summary", url="x", duration_ms=200),
            ev(1, "browser", "page_summary", url="y", duration_ms=5000),
        ]
        out = drop_short_page_summary(events)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["data"]["duration_ms"], 5000)


class TestFilterNetwork(unittest.TestCase):
    def test_drops_tracking_paths(self):
        events = [
            ev(0, "browser", "network", url="https://amazon.com/melidata/track"),
            ev(1, "browser", "network", url="https://amazon.com/api/product/123"),
            ev(2, "browser", "network", url="https://amazon.com/icons/logo.png"),
        ]
        out = filter_network(events)
        self.assertEqual(len(out), 1)
        self.assertIn("/api/product", out[0]["data"]["url"])


class TestFilterElementRead(unittest.TestCase):
    def test_drops_pagination_link(self):
        events = [
            ev(0, "browser", "element_read",
               tag="A", text="2", selectors={"xpath": "/a[1]"}, url="x"),
            ev(1, "browser", "element_read",
               tag="A", text="iPhone 15 Pro $1200", selectors={"xpath": "/a[2]"}, url="x"),
        ]
        out = filter_element_read(events)
        self.assertEqual(len(out), 1)
        self.assertIn("iPhone", out[0]["data"]["text"])

    def test_drops_breadcrumb(self):
        events = [
            ev(0, "browser", "element_read",
               tag="A", text="cocina y hogar", selectors={"xpath": "/a[3]"}, url="x"),
        ]
        self.assertEqual(filter_element_read(events), [])

    def test_dedupes_by_xpath_url(self):
        events = [
            ev(0, "browser", "element_read",
               tag="H1", text="Producto A", selectors={"xpath": "//*[@id=\"title\"]"}, url="u"),
            ev(1, "browser", "element_read",
               tag="H1", text="Producto A", selectors={"xpath": "//*[@id=\"title\"]"}, url="u"),
        ]
        self.assertEqual(len(filter_element_read(events)), 1)

    def test_supports_legacy_xpath_field(self):
        """Sesiones viejas tenían xpath como campo top-level, no en selectors."""
        events = [
            ev(0, "browser", "element_read",
               tag="H1", text="Producto A", xpath="//*[@id=\"title\"]", url="u"),
            ev(1, "browser", "element_read",
               tag="H1", text="Producto A", xpath="//*[@id=\"title\"]", url="u"),
        ]
        self.assertEqual(len(filter_element_read(events)), 1)


class TestFilterHover(unittest.TestCase):
    def test_drops_short_hover(self):
        events = [
            ev(0, "browser", "hover", tag="A", text="link", duration_ms=300),
        ]
        self.assertEqual(filter_hover(events), [])

    def test_drops_non_semantic_tag(self):
        events = [
            ev(0, "browser", "hover", tag="DIV", text="contenido", duration_ms=2000),
        ]
        self.assertEqual(filter_hover(events), [])

    def test_keeps_real_hover(self):
        events = [
            ev(0, "browser", "hover", tag="BUTTON", text="Comprar", duration_ms=1500),
        ]
        self.assertEqual(len(filter_hover(events)), 1)


class TestFilterReadingPause(unittest.TestCase):
    def test_drops_top_of_page_pause(self):
        events = [
            ev(0, "browser", "reading_pause", scroll_pct=2, url="u", elements=[]),
            ev(1, "browser", "reading_pause", scroll_pct=40, url="u", elements=[]),
        ]
        out = filter_reading_pause(events)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["data"]["scroll_pct"], 40)


class TestCapReadingPauseElements(unittest.TestCase):
    def test_truncates_huge_elements_array(self):
        elements = [{"tag": "A", "text": f"link {i}", "aria": ""} for i in range(500)]
        events = [
            ev(1, "browser", "reading_pause", scroll_pct=40, url="x", elements=elements),
        ]
        out = cap_reading_pause_elements(events)
        self.assertEqual(len(out[0]["data"]["elements"]), 25)
        self.assertEqual(out[0]["data"]["elements_truncated_from"], 500)

    def test_does_not_modify_small_array(self):
        elements = [{"tag": "A", "text": "ok", "aria": ""}] * 5
        events = [
            ev(1, "browser", "reading_pause", scroll_pct=40, url="x", elements=elements),
        ]
        out = cap_reading_pause_elements(events)
        self.assertEqual(len(out[0]["data"]["elements"]), 5)
        self.assertNotIn("elements_truncated_from", out[0]["data"])


class TestCompressScroll(unittest.TestCase):
    def test_groups_contiguous_system_scrolls(self):
        events = [
            ev(0.0, "system", "scroll", delta_y=-5, delta_x=0, app="chrome.exe"),
            ev(0.5, "system", "scroll", delta_y=-3, delta_x=0, app="chrome.exe"),
            ev(1.0, "system", "scroll", delta_y=-2, delta_x=0, app="chrome.exe"),
        ]
        out = compress_scroll(events)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["type"], "scroll_summary")
        self.assertEqual(out[0]["data"]["scroll_count"], 3)
        self.assertEqual(out[0]["data"]["delta_y"], -10)

    def test_drops_zero_movement_scroll(self):
        events = [
            ev(0, "system", "scroll", delta_y=0, delta_x=0),
        ]
        self.assertEqual(compress_scroll(events), [])

    def test_browser_scroll_uses_from_to(self):
        events = [
            ev(0, "browser", "scroll", from_y=100, to_y=900, viewport_pct=50, url="u"),
        ]
        out = compress_scroll(events)
        self.assertEqual(out[0]["data"]["delta_y"], 800)


class TestPipelineEndToEnd(unittest.TestCase):
    """Sesión sintética que reproduce los problemas reales para asegurar
    que la pipeline completa los limpia."""

    def test_real_world_session(self):
        session = [
            # Ruido puro — debe desaparecer
            ev(0, "browser", "focus"),
            ev(0.1, "browser", "blur"),
            ev(0.2, "browser", "keydown"),

            # Redirect google.com/url — debe desaparecer
            ev(0.5, "browser", "page_load", url="https://google.com/url?q=foo"),
            ev(0.6, "browser", "page_summary", url="https://google.com/url?q=foo",
               duration_ms=100, title="Redirecting"),

            # Page real — debe quedar
            ev(1, "browser", "page_load", url="https://amazon.com/dp/X", title="Product"),

            # Network: una de tracking (descartar) y una real (mantener)
            ev(1.2, "browser", "network", url="https://amazon.com/melidata/track"),
            ev(1.3, "browser", "network", url="https://amazon.com/api/product/x"),

            # element_read: paginación + breadcrumb + uno real, mismo xpath repetido
            ev(2, "browser", "element_read", tag="A", text="3",
               selectors={"xpath": "/p[1]"}, url="https://amazon.com/dp/X"),
            ev(2.1, "browser", "element_read", tag="A", text="hogar y cocina",
               selectors={"xpath": "/p[2]"}, url="https://amazon.com/dp/X"),
            ev(2.2, "browser", "element_read", tag="H1", text="Producto A",
               selectors={"xpath": "//*[@id=\"title\"]"}, url="https://amazon.com/dp/X"),
            ev(2.3, "browser", "element_read", tag="H1", text="Producto A",
               selectors={"xpath": "//*[@id=\"title\"]"}, url="https://amazon.com/dp/X"),

            # hover: uno corto (descartar) y uno real
            ev(3, "browser", "hover", tag="A", text="link", duration_ms=200),
            ev(3.1, "browser", "hover", tag="BUTTON", text="Agregar", duration_ms=1500),

            # reading_pause cerca del tope — descartar
            ev(4, "browser", "reading_pause", scroll_pct=2, url="x", elements=[]),

            # Ráfaga de scrolls — debe agruparse en uno
            ev(5.0, "system", "scroll", delta_y=-5, delta_x=0, app="chrome.exe"),
            ev(5.3, "system", "scroll", delta_y=-3, delta_x=0, app="chrome.exe"),
            ev(5.6, "system", "scroll", delta_y=-2, delta_x=0, app="chrome.exe"),

            # page_summary real
            ev(10, "browser", "page_summary", url="https://amazon.com/dp/X",
               duration_ms=8000, title="Product", h1="Producto A", price="$1200"),
        ]

        out = compress(session)
        types = [e["type"] for e in out]

        # Verificaciones por tipo
        self.assertNotIn("focus", types)
        self.assertNotIn("blur", types)
        self.assertNotIn("keydown", types)

        # El page_load real queda; el del redirect no
        page_loads = [e for e in out if e["type"] == "page_load"]
        self.assertEqual(len(page_loads), 1)
        self.assertIn("amazon", page_loads[0]["data"]["url"])

        # El network de tracking se cae, el de API queda
        networks = [e for e in out if e["type"] == "network"]
        self.assertEqual(len(networks), 1)
        self.assertIn("/api/", networks[0]["data"]["url"])

        # element_read: paginación y breadcrumb fuera; H1 deduplicado
        element_reads = [e for e in out if e["type"] == "element_read"]
        self.assertEqual(len(element_reads), 1)
        self.assertIn("Producto A", element_reads[0]["data"]["text"])

        # hover real queda, corto no
        hovers = [e for e in out if e["type"] == "hover"]
        self.assertEqual(len(hovers), 1)
        self.assertEqual(hovers[0]["data"]["text"], "Agregar")

        # reading_pause cerca del tope se descartó
        self.assertEqual([e for e in out if e["type"] == "reading_pause"], [])

        # Los 3 scrolls se agruparon en un scroll_summary
        scrolls = [e for e in out if e["type"] == "scroll"]
        summaries = [e for e in out if e["type"] == "scroll_summary"]
        self.assertEqual(scrolls, [])
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["data"]["scroll_count"], 3)

        # Compresión total
        self.assertLess(len(out), len(session))


if __name__ == "__main__":
    unittest.main()
