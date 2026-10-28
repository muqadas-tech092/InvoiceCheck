"""Arithmetic and completeness checks on extracted invoices."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .extract import Invoice

TOL = Decimal("0.01")


@dataclass
class Issue:
    severity: str  # "error" blocks approval, "warning" needs a human look
    message: str


def _close(a: Decimal, b: Decimal) -> bool:
    return abs(a - b) <= TOL


def validate(inv: Invoice) -> list[Issue]:
    issues: list[Issue] = []

    def err(msg):
        issues.append(Issue("error", msg))

    def warn(msg):
        issues.append(Issue("warning", msg))

    if not inv.invoice_number:
        err("Invoice number not found.")
    if not inv.vendor:
        err("Vendor name not found.")
    if inv.invoice_date is None:
        err("Invoice date not found or unreadable.")
    if inv.total is None:
        err("Total not found.")
    if not inv.currency:
        warn("Currency not detected.")
    for note in inv.notes:
        warn(note)

    if inv.invoice_date and inv.due_date and inv.due_date < inv.invoice_date:
        err(f"Due date ({inv.due_date}) is before the invoice date ({inv.invoice_date}).")

    for it in inv.items:
        expected = (it.quantity * it.unit_price).quantize(Decimal("0.01"))
        if not _close(expected, it.amount):
            warn(f"Line '{it.description}': {it.quantity} x {it.unit_price} = {expected}, but the invoice says {it.amount}.")

    if inv.items:
        line_sum = sum((it.amount for it in inv.items), Decimal("0"))
        if inv.subtotal is not None and not _close(line_sum, inv.subtotal):
            err(f"Line items add up to {line_sum}, but the subtotal says {inv.subtotal}.")
        elif inv.subtotal is None and inv.total is not None and inv.tax is None and not _close(line_sum, inv.total):
            err(f"Line items add up to {line_sum}, but the total says {inv.total}.")
    else:
        warn("No line items could be read.")

    base = inv.subtotal if inv.subtotal is not None else (
        sum((it.amount for it in inv.items), Decimal("0")) if inv.items else None
    )
    if base is not None and inv.total is not None:
        expected_total = base + (inv.tax or Decimal("0"))
        if not _close(expected_total, inv.total):
            err(f"Subtotal {base} + tax {inv.tax or 0} = {expected_total}, but the total says {inv.total}.")

    if inv.tax_rate is not None and base not in (None, Decimal("0")) and inv.tax is not None:
        expected_tax = (base * inv.tax_rate / 100).quantize(Decimal("0.01"))
        if not _close(expected_tax, inv.tax):
            warn(f"Tax rate {inv.tax_rate}% of {base} is {expected_tax}, but the invoice says {inv.tax}.")

    if inv.total is not None and inv.total < 0:
        warn("Negative total (credit note?). Confirm before booking.")
    return issues


def status(issues: list[Issue]) -> str:
    if any(i.severity == "error" for i in issues):
        return "Needs fixing"
    if issues:
        return "Review"
    return "OK"
