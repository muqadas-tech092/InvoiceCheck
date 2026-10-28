# InvoiceCheck

Read invoices, **check the arithmetic and catch duplicates** before they reach the books. Nothing is sent anywhere; it runs entirely on your machine.

## The problem
Small businesses and bookkeepers retype invoice data by hand. Wrong totals, duplicate invoices and missing details slip through, and the errors surface at month-end or in an audit.

## What it does
- **Reads PDF and text invoices** (several at once) and extracts vendor, invoice number, dates, currency, line items, subtotal, tax and total. Handles USD, EUR, GBP, PKR, INR and other common formats.
- **Checks the maths:** quantity x unit price per line, line items vs subtotal, subtotal + tax vs total, stated tax rate vs actual tax, due date before invoice date.
- **Catches duplicates** across files: same vendor and invoice number, or same vendor, date and total under a different number.
- **Never guesses silently:** ambiguous dates (03/04/2026), missing fields and unreadable PDFs are flagged. Scanned image-only PDFs are detected and reported instead of producing nonsense.
- **Three statuses:** OK, Review (warnings) and Needs fixing (errors), plus CSV exports for invoices, line items and issues.

## Run it
```bash
pip install -r requirements.txt
streamlit run app.py
```
Upload PDFs or text, paste an invoice, or switch on the four fictional sample invoices (one clean, one with several errors, one duplicate, one with an ambiguous date).

## Tests
```bash
pip install pytest fpdf2
pytest
```
19 tests cover money parsing, dates, extraction on six invoice layouts, every validation rule, duplicates, real PDF text extraction, scanned or corrupt PDFs and a headless run of the UI.

## Limits (honest list)
- Extraction is pattern-based. It works on common layouts (description, quantity, unit price, amount) but unusual designs may need review; the tool tells you when it could not read something.
- No OCR: scanned invoices must be converted to text first.
- It checks internal consistency, not whether the invoice is genuine or correct for what you ordered.
- Not accounting or tax advice. Sample invoices are fictional. This is a portfolio project and has not been used with paying clients.

Built by [Muqadas Zahoor](https://www.linkedin.com/in/muqadas-zahoor-b2a38b2b3/). Developed with AI assistance.
