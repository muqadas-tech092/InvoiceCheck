"""Headless end-to-end run of the InvoiceCheck UI."""
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "app.py")


def run() -> AppTest:
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    return at


def test_sample_invoices_load_and_metrics_match():
    at = run()
    assert not at.exception
    m = {x.label: x.value for x in at.metric}
    assert m["Invoices read"] == "4"
    assert m["✅ OK"] == "1" and m["⚠️ Review"] == "1" and m["❌ Needs fixing"] == "2"


def test_errors_are_shown_to_the_user():
    at = run()
    texts = " ".join(e.value for e in at.error)
    assert "Duplicate invoice number" in texts and "total says 330.00" in texts


def test_pasted_text_is_processed():
    at = run()
    at.toggle[0].set_value(False)
    at.text_area[0].set_value("Shop One\nInvoice No: S-1\nDate: 2026-10-01\nWidget  2  $5.00  $10.00\nSubtotal: $10.00\nTotal: $10.00")
    at.run()
    assert not at.exception
    m = {x.label: x.value for x in at.metric}
    assert m["Invoices read"] == "1" and m["✅ OK"] == "1"


def test_nothing_selected_shows_guidance():
    at = run()
    at.toggle[0].set_value(False)
    at.run()
    assert any("Upload invoices" in i.value for i in at.info)
