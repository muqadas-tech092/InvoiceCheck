from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fpdf import FPDF

from invoicecheck.batch import issues_frame, lines_frame, process, summary_frame
from invoicecheck.extract import extract_invoice, parse_date, to_decimal
from invoicecheck.pdf import UnreadablePdf, pdf_to_text
from invoicecheck.validate import status, validate

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"


def read(name):
    return (SAMPLES / name).read_text(encoding="utf-8")


def test_money_parsing():
    assert to_decimal("$1,234.50") == Decimal("1234.50")
    assert to_decimal("Rs. 2,000") == Decimal("2000")
    assert to_decimal("abc") is None


def test_clean_invoice_is_extracted_fully():
    inv = extract_invoice(read("inv_clean.txt"))
    assert inv.vendor == "Brightline Print Studio"
    assert inv.invoice_number == "BP-2026-0412"
    assert inv.invoice_date == date(2026, 10, 5) and inv.due_date == date(2026, 11, 4)
    assert inv.currency == "USD"
    assert len(inv.items) == 3
    assert (inv.subtotal, inv.tax, inv.tax_rate, inv.total) == (Decimal("225.00"), Decimal("22.50"), Decimal("10"), Decimal("247.50"))


def test_clean_invoice_passes_validation():
    issues = validate(extract_invoice(read("inv_clean.txt")))
    assert issues == [] and status(issues) == "OK"


def test_wrong_invoice_is_caught_on_every_error():
    inv = extract_invoice(read("inv_wrong.txt"))
    msgs = " | ".join(i.message for i in validate(inv))
    assert inv.currency == "GBP"
    assert "Line 'Backup add-on'" in msgs          # 2 x 10 = 20, not 25
    assert "Line items add up to 277.00" in msgs   # 240 + 12 + 25 vs subtotal 270
    assert "total says 330.00" in msgs             # 270 + 54 = 324
    assert "Due date" in msgs                      # due before invoice date
    assert status(validate(inv)) == "Needs fixing"


def test_ambiguous_date_is_flagged_not_hidden():
    inv = extract_invoice(read("inv_date.txt"))
    assert inv.vendor == "Lakeview Office Supplies"
    assert any("ambiguous" in i.message for i in validate(inv))
    assert status(validate(inv)) == "Review"


def test_unambiguous_slash_dates_are_read_correctly():
    assert parse_date("25/12/2026", []) == date(2026, 12, 25)
    assert parse_date("12/25/2026", []) == date(2026, 12, 25)
    assert parse_date("March 5, 2026", []) == date(2026, 3, 5)


def test_missing_fields_are_errors():
    issues = validate(extract_invoice("random text with no invoice data at all"))
    msgs = " ".join(i.message for i in issues)
    assert "Invoice number not found" in msgs and "Total not found" in msgs


def test_duplicate_invoice_across_files_is_detected():
    results = process([("a.txt", read("inv_clean.txt")), ("b.txt", read("inv_duplicate.txt"))])
    assert results[0].status == "OK"
    assert results[1].status == "Needs fixing"
    assert any("Duplicate invoice number" in i.message for i in results[1].issues)


def test_batch_exports_are_consistent():
    results = process([(p.name, p.read_text(encoding="utf-8")) for p in sorted(SAMPLES.glob("*.txt"))])
    summary, lines, issues = summary_frame(results), lines_frame(results), issues_frame(results)
    assert len(summary) == 4
    assert set(summary["status"]) == {"OK", "Needs fixing", "Review"}
    assert lines["amount"].sum() > 0 and len(issues) >= 5


def _make_pdf(text: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    for line in text.split("\n"):
        pdf.cell(0, 6, line.replace("£", "GBP "), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def test_pdf_text_is_extracted_and_parsed():
    data = _make_pdf(read("inv_clean.txt"))
    inv = extract_invoice(pdf_to_text(data))
    assert inv.invoice_number == "BP-2026-0412" and inv.total == Decimal("247.50")


def test_scanned_or_corrupt_pdf_gives_a_clear_error():
    blank = FPDF()
    blank.add_page()
    with pytest.raises(UnreadablePdf, match="scanned"):
        pdf_to_text(bytes(blank.output()))
    with pytest.raises(UnreadablePdf, match="Could not open"):
        pdf_to_text(b"not a pdf")


PKR = """Karachi Stationers
Invoice No. KS-204
Date: 5 March 2026
Notebook (A5)   10   Rs. 150.00   Rs. 1,500.00
Marker set      4    Rs. 250.00   Rs. 1,000.00
Subtotal: Rs. 2,500.00
Tax (17%): Rs. 425.00
Total: Rs. 2,925.00"""

EUR = """Berlin Design GmbH
Rechnung / Invoice Number: BD-77
Date: 2026-09-30
Due date: 2026-10-30
Logo design    1   EUR 400.00   EUR 400.00
Subtotal: EUR 400.00
VAT (19%): EUR 76.00
Total: EUR 476.00"""

NO_LINES = """ACME Consulting
INVOICE # 1234
Invoice date: March 5, 2026
Consulting services - October
Total: $1,250.00"""


def test_pkr_invoice_with_rs_prefix():
    inv = extract_invoice(PKR)
    assert inv.currency == "PKR" and inv.total == Decimal("2925.00") and len(inv.items) == 2
    assert status(validate(inv)) == "OK"


def test_euro_invoice_with_vat():
    inv = extract_invoice(EUR)
    assert inv.currency == "EUR" and inv.tax_rate == Decimal("19") and status(validate(inv)) == "OK"


def test_invoice_without_line_items_needs_review_not_failure():
    inv = extract_invoice(NO_LINES)
    assert inv.total == Decimal("1250.00") and status(validate(inv)) == "Review"


def test_wrong_tax_rate_is_warned():
    bad = EUR.replace("VAT (19%): EUR 76.00", "VAT (19%): EUR 80.00").replace("EUR 476.00", "EUR 480.00")
    msgs = " ".join(i.message for i in validate(extract_invoice(bad)))
    assert "Tax rate 19%" in msgs
