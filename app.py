"""InvoiceCheck: read invoices, check the maths and catch duplicates before they reach the books."""
from __future__ import annotations

from pathlib import Path

import streamlit as st

from invoicecheck.batch import csv_bytes, issues_frame, lines_frame, process, summary_frame
from invoicecheck.pdf import UnreadablePdf, pdf_to_text

ROOT = Path(__file__).parent
ICON = {"OK": "✅", "Review": "⚠️", "Needs fixing": "❌"}

st.set_page_config(page_title="InvoiceCheck", page_icon="🧾", layout="wide")


def collect_documents() -> tuple[list[tuple[str, str]], list[str]]:
    docs: list[tuple[str, str]] = []
    problems: list[str] = []
    files = st.file_uploader("Upload invoices (PDF or TXT)", type=["pdf", "txt"], accept_multiple_files=True)
    pasted = st.text_area("...or paste one invoice's text", height=140, placeholder="Paste the text of an invoice here")
    use_sample = st.toggle("Use the sample invoices (fictional)", value=not files and not pasted.strip())
    for f in files or []:
        if f.name.lower().endswith(".pdf"):
            try:
                docs.append((f.name, pdf_to_text(f.getvalue())))
            except UnreadablePdf as exc:
                problems.append(f"{f.name}: {exc}")
        else:
            docs.append((f.name, f.getvalue().decode("utf-8", errors="replace")))
    if pasted.strip():
        docs.append(("pasted text", pasted))
    if use_sample:
        docs += [(p.name, p.read_text(encoding="utf-8")) for p in sorted((ROOT / "data" / "samples").glob("*.txt"))]
    return docs, problems


def main() -> None:
    st.title("🧾 InvoiceCheck")
    st.caption("Catch wrong totals, duplicate invoices and missing details before they reach your books. Works offline: nothing is sent anywhere.")
    docs, problems = collect_documents()
    for p in problems:
        st.error(p)
    if not docs:
        st.info("Upload invoices, paste text, or switch on the sample invoices.")
        return

    results = process(docs)
    summary = summary_frame(results)
    counts = summary["status"].value_counts()
    c = st.columns(4)
    c[0].metric("Invoices read", len(results))
    c[1].metric("✅ OK", int(counts.get("OK", 0)))
    c[2].metric("⚠️ Review", int(counts.get("Review", 0)))
    c[3].metric("❌ Needs fixing", int(counts.get("Needs fixing", 0)))

    st.dataframe(summary, use_container_width=True, hide_index=True)

    st.subheader("Details")
    for r in results:
        inv = r.invoice
        title = f"{ICON[r.status]} {inv.source}: {inv.vendor or 'unknown vendor'} · {inv.invoice_number or 'no number'} · {r.status}"
        with st.expander(title, expanded=r.status != "OK"):
            if not r.issues:
                st.success("All checks passed: line items, subtotal, tax and total agree.")
            for issue in r.issues:
                (st.error if issue.severity == "error" else st.warning)(issue.message)
            if inv.items:
                st.table(
                    [
                        {
                            "Description": it.description,
                            "Qty": f"{it.quantity:,.2f}".rstrip("0").rstrip("."),
                            "Unit": f"{it.unit_price:,.2f}",
                            "Amount": f"{it.amount:,.2f}",
                        }
                        for it in inv.items
                    ]
                )

    st.subheader("Export")
    d = st.columns(3)
    d[0].download_button("Invoices (CSV)", csv_bytes(summary), "invoices.csv", "text/csv")
    d[1].download_button("Line items (CSV)", csv_bytes(lines_frame(results)), "line_items.csv", "text/csv")
    d[2].download_button("Issues (CSV)", csv_bytes(issues_frame(results)), "issues.csv", "text/csv")
    st.caption(
        "Pattern-based extraction: it handles common invoice layouts, flags anything it is unsure about, and never guesses silently. "
        "Always review flagged invoices. Scanned (image-only) PDFs need OCR, which this tool does not do. This is not accounting advice."
    )


main()
