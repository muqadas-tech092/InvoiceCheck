"""Batch processing: duplicates, summaries and CSV export."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from decimal import Decimal

import pandas as pd

from .extract import Invoice, extract_invoice
from .validate import Issue, status, validate


@dataclass
class Result:
    invoice: Invoice
    issues: list[Issue]

    @property
    def status(self) -> str:
        return status(self.issues)


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def process(documents: list[tuple[str, str]]) -> list[Result]:
    """documents: list of (source name, text). Adds cross-document duplicate checks."""
    results = [Result(inv := extract_invoice(text, name), validate(inv)) for name, text in documents]
    seen_number: dict[tuple[str, str], str] = {}
    seen_fingerprint: dict[tuple, str] = {}
    for r in results:
        inv = r.invoice
        if inv.invoice_number and inv.vendor:
            k = (_key(inv.vendor), _key(inv.invoice_number))
            if k in seen_number:
                r.issues.append(Issue("error", f"Duplicate invoice number {inv.invoice_number} from {inv.vendor} (also in {seen_number[k]})."))
            else:
                seen_number[k] = inv.source
        if inv.vendor and inv.total is not None and inv.invoice_date:
            f = (_key(inv.vendor), inv.total, inv.invoice_date)
            if f in seen_fingerprint and seen_number.get((_key(inv.vendor), _key(inv.invoice_number))) != seen_fingerprint[f]:
                r.issues.append(Issue("warning", f"Same vendor, date and total as {seen_fingerprint[f]}: possible duplicate with a different number."))
            else:
                seen_fingerprint.setdefault(f, inv.source)
    return results


def _num(d: Decimal | None):
    return float(d) if d is not None else None


def summary_frame(results: list[Result]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "status": r.status,
                "source": r.invoice.source,
                "vendor": r.invoice.vendor,
                "invoice_number": r.invoice.invoice_number,
                "invoice_date": r.invoice.invoice_date,
                "due_date": r.invoice.due_date,
                "currency": r.invoice.currency,
                "subtotal": _num(r.invoice.subtotal),
                "tax": _num(r.invoice.tax),
                "total": _num(r.invoice.total),
                "issues": len(r.issues),
            }
            for r in results
        ]
    )


def lines_frame(results: list[Result]) -> pd.DataFrame:
    rows = []
    for r in results:
        for it in r.invoice.items:
            rows.append(
                {
                    "invoice_number": r.invoice.invoice_number,
                    "vendor": r.invoice.vendor,
                    "description": it.description,
                    "quantity": float(it.quantity),
                    "unit_price": float(it.unit_price),
                    "amount": float(it.amount),
                }
            )
    return pd.DataFrame(rows, columns=["invoice_number", "vendor", "description", "quantity", "unit_price", "amount"])


def issues_frame(results: list[Result]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"source": r.invoice.source, "severity": i.severity, "message": i.message} for r in results for i in r.issues],
        columns=["source", "severity", "message"],
    )


def csv_bytes(df: pd.DataFrame) -> bytes:
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue().encode("utf-8")
