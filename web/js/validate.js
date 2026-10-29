// Arithmetic and completeness checks. Port of invoicecheck/validate.py. All amounts are integer cents.
import { fmt } from "./extract.js";

const TOL = 1; // one cent
const close = (a, b) => Math.abs(a - b) <= TOL;

export function validate(inv) {
  const issues = [];
  const err = (message) => issues.push({ severity: "error", message });
  const warn = (message) => issues.push({ severity: "warning", message });

  if (!inv.invoiceNumber) err("Invoice number not found.");
  if (!inv.vendor) err("Vendor name not found.");
  if (inv.invoiceDate === null) err("Invoice date not found or unreadable.");
  if (inv.total === null) err("Total not found.");
  if (!inv.currency) warn("Currency not detected.");
  inv.notes.forEach(warn);

  if (inv.invoiceDate && inv.dueDate && inv.dueDate < inv.invoiceDate) {
    err(`Due date (${inv.dueDate}) is before the invoice date (${inv.invoiceDate}).`);
  }

  for (const it of inv.items) {
    const expected = Math.round(it.quantity * it.unit);
    if (!close(expected, it.amount)) {
      warn(`Line '${it.description}': ${it.quantity} x ${fmt(it.unit)} = ${fmt(expected)}, but the invoice says ${fmt(it.amount)}.`);
    }
  }

  const lineSum = inv.items.reduce((s, it) => s + it.amount, 0);
  if (inv.items.length) {
    if (inv.subtotal !== null && !close(lineSum, inv.subtotal)) {
      err(`Line items add up to ${fmt(lineSum)}, but the subtotal says ${fmt(inv.subtotal)}.`);
    } else if (inv.subtotal === null && inv.total !== null && inv.tax === null && !close(lineSum, inv.total)) {
      err(`Line items add up to ${fmt(lineSum)}, but the total says ${fmt(inv.total)}.`);
    }
  } else warn("No line items could be read.");

  const base = inv.subtotal !== null ? inv.subtotal : inv.items.length ? lineSum : null;
  if (base !== null && inv.total !== null) {
    const expectedTotal = base + (inv.tax || 0);
    if (!close(expectedTotal, inv.total)) {
      err(`Subtotal ${fmt(base)} + tax ${inv.tax ? fmt(inv.tax) : 0} = ${fmt(expectedTotal)}, but the total says ${fmt(inv.total)}.`);
    }
  }

  if (inv.taxRate !== null && base !== null && base !== 0 && inv.tax !== null) {
    const expectedTax = Math.round((base * inv.taxRate) / 100);
    if (!close(expectedTax, inv.tax)) {
      warn(`Tax rate ${inv.taxRate}% of ${fmt(base)} is ${fmt(expectedTax)}, but the invoice says ${fmt(inv.tax)}.`);
    }
  }

  if (inv.total !== null && inv.total < 0) warn("Negative total (credit note?). Confirm before booking.");
  return issues;
}

export function status(issues) {
  if (issues.some((i) => i.severity === "error")) return "Needs fixing";
  return issues.length ? "Review" : "OK";
}
