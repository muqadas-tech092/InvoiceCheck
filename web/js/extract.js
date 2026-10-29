// Pull structured fields out of invoice text. Port of invoicecheck/extract.py.
// Money is held as integer cents so totals never suffer floating-point drift. Dates are ISO strings (YYYY-MM-DD).

const MONEY = String.raw`(?:[$€£₹]|Rs\.?|USD|EUR|GBP|PKR|INR|CAD|AUD|AED)?\s*-?\d[\d,]*(?:\.\d{1,2})?`;
const DATE_WORDS = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9} \d{4})`;
const CURRENCY_SYMBOLS = [["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["Rs", "PKR"], ["₹", "INR"]];
const CURRENCY_CODES = ["USD", "EUR", "GBP", "PKR", "INR", "CAD", "AUD", "AED"];
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const re = (src, flags = "im") => new RegExp(src, flags);

/** First number in the text, in cents. "Rs. 2,000" -> 200000. Returns null if there is no number. */
export function toCents(text) {
  const m = String(text).match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  return Math.round(parseFloat(m[0].replace(/,/g, "")) * 100);
}
export const fmt = (cents) => (cents / 100).toFixed(2);

function mkDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseDate(text, notes) {
  text = String(text).trim().replace(/\.$/, "");
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return mkDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = text.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return mkDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], year = +m[3];
    if (a > 12 && b <= 12) return mkDate(year, b, a);
    if (b > 12 && a <= 12) return mkDate(year, a, b);
    if (a <= 12 && b <= 12) {
      if (a !== b) notes.push(`Date '${text}' is ambiguous (day/month or month/day); read as day/month.`);
      return mkDate(year, b, a);
    }
  }
  return null;
}

function moneyAfter(label, text) {
  const m = text.match(re(String.raw`^\s*(?:${label})\b[^\n\d$€£₹-]*(${MONEY})\s*$`));
  return m ? toCents(m[1]) : null;
}

export function detectCurrency(text) {
  for (const code of CURRENCY_CODES) if (re(String.raw`\b${code}\b`, "").test(text)) return code;
  for (const [sym, code] of CURRENCY_SYMBOLS) if (text.includes(sym)) return code;
  return "";
}

export function extractInvoice(text, source = "") {
  text = String(text).replace(/\r/g, "");
  const inv = {
    source, vendor: "", invoiceNumber: "", invoiceDate: null, dueDate: null, currency: "",
    items: [], subtotal: null, tax: null, taxRate: null, total: null, notes: [],
  };
  const lines = text.split("\n").map((l) => l.trim());

  let m = text.match(re(String.raw`invoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-_/]{1,})`));
  if (!m) m = text.match(re(String.raw`\binvoice\s*[:#]\s*([A-Z0-9][A-Z0-9\-_/]{1,})`));
  inv.invoiceNumber = m ? m[1].trim() : "";

  m = text.match(re(String.raw`(?:invoice\s*date|date\s*of\s*issue|issued|date)\s*[:\-]?\s*${DATE_WORDS}`));
  if (m) inv.invoiceDate = parseDate(m[1], inv.notes);
  m = text.match(re(String.raw`(?:due\s*date|payment\s*due|due)\s*[:\-]?\s*${DATE_WORDS}`));
  if (m) inv.dueDate = parseDate(m[1], inv.notes);

  m = text.match(re(String.raw`^(?:from|vendor|supplier|billed\s*by)\s*[:\-]\s*(.+)$`));
  if (m) inv.vendor = m[1].trim();
  else {
    const skip = /invoice|bill\s*to|date|^\W+$/i;
    inv.vendor = lines.find((ln) => ln && !skip.test(ln)) || "";
  }

  inv.currency = detectCurrency(text);

  const itemRe = new RegExp(
    String.raw`^(?<desc>[A-Za-z][^\n]*?)\s+(?<qty>\d+(?:\.\d+)?)\s*[x×@]?\s*(?<unit>${MONEY})\s+(?<amt>${MONEY})\s*$`
  );
  for (const ln of lines) {
    const mm = ln.match(itemRe);
    if (mm && !/^(sub\s*total|total|tax|vat|amount|balance)/i.test(mm.groups.desc)) {
      const unit = toCents(mm.groups.unit), amt = toCents(mm.groups.amt), qty = parseFloat(mm.groups.qty);
      if (unit !== null && amt !== null && !Number.isNaN(qty)) {
        inv.items.push({ description: mm.groups.desc.replace(/^[ .:\-]+|[ .:\-]+$/g, ""), quantity: qty, unit, amount: amt });
      }
    }
  }

  inv.subtotal = moneyAfter(String.raw`sub\s*-?\s*total`, text);
  const tm = text.match(re(String.raw`^\s*(?:tax|vat|gst|sales\s*tax)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?[^\n\d$€£₹-]*(${MONEY})\s*$`));
  if (tm) {
    inv.tax = toCents(tm[2]);
    if (tm[1]) inv.taxRate = parseFloat(tm[1]);
  }
  inv.total = moneyAfter(String.raw`grand\s*total|total\s*due|amount\s*due|balance\s*due|total`, text);
  return inv;
}
