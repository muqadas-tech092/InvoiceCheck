// Batch processing: duplicates, summaries and CSV export data. Port of invoicecheck/batch.py.
import { extractInvoice, fmt } from "./extract.js";
import { validate, status } from "./validate.js";

const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** documents: [{name, text}]. Returns [{invoice, issues, status}] with cross-document duplicate checks. */
export function processDocuments(documents) {
  const results = documents.map(({ name, text }) => {
    const invoice = extractInvoice(text, name);
    return { invoice, issues: validate(invoice) };
  });
  const seenNumber = new Map();
  const seenFingerprint = new Map();
  for (const r of results) {
    const inv = r.invoice;
    const numberKey = `${key(inv.vendor)}|${key(inv.invoiceNumber)}`;
    if (inv.invoiceNumber && inv.vendor) {
      if (seenNumber.has(numberKey)) {
        r.issues.push({ severity: "error", message: `Duplicate invoice number ${inv.invoiceNumber} from ${inv.vendor} (also in ${seenNumber.get(numberKey)}).` });
      } else seenNumber.set(numberKey, inv.source);
    }
    if (inv.vendor && inv.total !== null && inv.invoiceDate) {
      const fp = `${key(inv.vendor)}|${inv.total}|${inv.invoiceDate}`;
      if (seenFingerprint.has(fp) && seenNumber.get(numberKey) !== seenFingerprint.get(fp)) {
        r.issues.push({ severity: "warning", message: `Same vendor, date and total as ${seenFingerprint.get(fp)}: possible duplicate with a different number.` });
      } else if (!seenFingerprint.has(fp)) seenFingerprint.set(fp, inv.source);
    }
  }
  results.forEach((r) => { r.status = status(r.issues); });
  return results;
}

const money = (c) => (c === null ? "" : fmt(c));

export function summaryRows(results) {
  return results.map((r) => ({
    status: r.status, source: r.invoice.source, vendor: r.invoice.vendor, invoice_number: r.invoice.invoiceNumber,
    invoice_date: r.invoice.invoiceDate || "", due_date: r.invoice.dueDate || "", currency: r.invoice.currency,
    subtotal: money(r.invoice.subtotal), tax: money(r.invoice.tax), total: money(r.invoice.total), issues: r.issues.length,
  }));
}
export const SUMMARY_COLUMNS = ["status", "source", "vendor", "invoice_number", "invoice_date", "due_date", "currency", "subtotal", "tax", "total", "issues"];

export function lineRows(results) {
  return results.flatMap((r) =>
    r.invoice.items.map((it) => ({
      invoice_number: r.invoice.invoiceNumber, vendor: r.invoice.vendor, description: it.description,
      quantity: it.quantity, unit_price: fmt(it.unit), amount: fmt(it.amount),
    }))
  );
}
export const LINE_COLUMNS = ["invoice_number", "vendor", "description", "quantity", "unit_price", "amount"];

export function issueRows(results) {
  return results.flatMap((r) => r.issues.map((i) => ({ source: r.invoice.source, severity: i.severity, message: i.message })));
}
export const ISSUE_COLUMNS = ["source", "severity", "message"];
