"""Pull structured fields out of invoice text. Pattern-based, with confidence notes instead of guesses."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "Rs": "PKR", "₹": "INR"}
CURRENCY_CODES = ("USD", "EUR", "GBP", "PKR", "INR", "CAD", "AUD", "AED")

MONEY = r"(?:[$€£₹]|Rs\.?|USD|EUR|GBP|PKR|INR|CAD|AUD|AED)?\s*-?\d[\d,]*(?:\.\d{1,2})?"


@dataclass
class LineItem:
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


@dataclass
class Invoice:
    source: str = ""
    vendor: str = ""
    invoice_number: str = ""
    invoice_date: date | None = None
    due_date: date | None = None
    currency: str = ""
    items: list[LineItem] = field(default_factory=list)
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    tax_rate: Decimal | None = None
    total: Decimal | None = None
    notes: list[str] = field(default_factory=list)  # extraction caveats, e.g. ambiguous date


def to_decimal(text: str) -> Decimal | None:
    # Take the first number in the text so currency prefixes like "Rs." or "USD " cannot leak a stray dot in.
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not m:
        return None
    try:
        return Decimal(m.group(0).replace(",", ""))
    except InvalidOperation:
        return None


def parse_date(text: str, notes: list[str]) -> date | None:
    text = text.strip().rstrip(".")
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", text)
    if m:
        a, b, year = int(m[1]), int(m[2]), int(m[3])
        if a > 12 and b <= 12:
            return date(year, b, a)
        if b > 12 and a <= 12:
            return date(year, a, b)
        if a <= 12 and b <= 12:
            if a != b:
                notes.append(f"Date '{text}' is ambiguous (day/month or month/day); read as day/month.")
            try:
                return date(year, b, a)
            except ValueError:
                return None
    return None


DATE_WORDS = r"(\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9} \d{4})"


def _find(pattern: str, text: str, flags=re.IGNORECASE | re.MULTILINE):
    m = re.search(pattern, text, flags)
    return m


def _money_after(label_pattern: str, text: str) -> Decimal | None:
    m = _find(rf"^\s*(?:{label_pattern})\b[^\n\d$€£₹-]*({MONEY})\s*$", text)
    return to_decimal(m.group(1)) if m else None


def detect_currency(text: str) -> str:
    for code in CURRENCY_CODES:
        if re.search(rf"\b{code}\b", text):
            return code
    for sym, code in CURRENCY_SYMBOLS.items():
        if sym in text:
            return code
    return ""


def extract_invoice(text: str, source: str = "") -> Invoice:
    inv = Invoice(source=source)
    text = text.replace("\r", "")
    lines = [ln.strip() for ln in text.split("\n")]

    m = _find(r"invoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-_/]{1,})", text)
    if not m:
        m = _find(r"\binvoice\s*[:#]\s*([A-Z0-9][A-Z0-9\-_/]{1,})", text)
    inv.invoice_number = m.group(1).strip() if m else ""

    m = _find(rf"(?:invoice\s*date|date\s*of\s*issue|issued|date)\s*[:\-]?\s*{DATE_WORDS}", text)
    if m:
        inv.invoice_date = parse_date(m.group(1), inv.notes)
    m = _find(rf"(?:due\s*date|payment\s*due|due)\s*[:\-]?\s*{DATE_WORDS}", text)
    if m:
        inv.due_date = parse_date(m.group(1), inv.notes)

    m = _find(r"^(?:from|vendor|supplier|billed\s*by)\s*[:\-]\s*(.+)$", text)
    if m:
        inv.vendor = m.group(1).strip()
    else:
        for ln in lines:
            if ln and not re.search(r"invoice|bill\s*to|date|^\W+$", ln, re.IGNORECASE):
                inv.vendor = ln
                break

    inv.currency = detect_currency(text)

    item_re = re.compile(
        rf"^(?P<desc>[A-Za-z][^\n]*?)\s+(?P<qty>\d+(?:\.\d+)?)\s*[x×@]?\s*(?P<unit>{MONEY})\s+(?P<amt>{MONEY})\s*$"
    )
    for ln in lines:
        mm = item_re.match(ln)
        if mm and not re.match(r"(sub\s*total|total|tax|vat|amount|balance)", mm["desc"], re.IGNORECASE):
            qty, unit, amt = to_decimal(mm["qty"]), to_decimal(mm["unit"]), to_decimal(mm["amt"])
            if None not in (qty, unit, amt):
                inv.items.append(LineItem(mm["desc"].strip(" .:-"), qty, unit, amt))

    inv.subtotal = _money_after(r"sub\s*-?\s*total", text)
    tm = _find(rf"^\s*(?:tax|vat|gst|sales\s*tax)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?[^\n\d$€£₹-]*({MONEY})\s*$", text)
    if tm:
        inv.tax = to_decimal(tm.group(2))
        if tm.group(1):
            inv.tax_rate = Decimal(tm.group(1))
    inv.total = _money_after(r"grand\s*total|total\s*due|amount\s*due|balance\s*due|total", text)
    return inv
