import { test, assert, assertEq, assertThrows } from "./harness.js";
import { extractInvoice, parseDate, toCents, fmt } from "../js/extract.js";
import { validate, status } from "../js/validate.js";
import { processDocuments, summaryRows, lineRows, issueRows, SUMMARY_COLUMNS } from "../js/batch.js";
import { pdfToText, UnreadablePdf } from "../js/pdf.js";
import { toCSV } from "../js/csv.js";

const fx = await (await fetch("./python_expected.json")).json();
const docs = fx.docs;
const SAMPLES = ["inv_clean.txt", "inv_date.txt", "inv_duplicate.txt", "inv_wrong.txt"];
const check = (name) => { const i = extractInvoice(docs[name], name); return { i, issues: validate(i) }; };

// ---- money and dates ----
test("money parsing handles symbols, commas and Rs. prefix", () => {
  assertEq(toCents("$1,234.50"), 123450);
  assertEq(toCents("Rs. 2,000"), 200000);
  assertEq(toCents("abc"), null);
});
test("unambiguous dates in several formats", () => {
  assertEq(parseDate("25/12/2026", []), "2026-12-25");
  assertEq(parseDate("12/25/2026", []), "2026-12-25");
  assertEq(parseDate("March 5, 2026", []), "2026-03-05");
  assertEq(parseDate("5 March 2026", []), "2026-03-05");
  assertEq(parseDate("2026-02-30", []), null); // not a real date
});
test("ambiguous date is flagged, not hidden", () => {
  const notes = [];
  assertEq(parseDate("03/04/2026", notes), "2026-04-03");
  assert(notes[0].includes("ambiguous"));
});

// ---- extraction and validation ----
test("clean invoice is extracted fully", () => {
  const { i, issues } = check("inv_clean.txt");
  assertEq([i.vendor, i.invoiceNumber, i.invoiceDate, i.dueDate, i.currency], ["Brightline Print Studio", "BP-2026-0412", "2026-10-05", "2026-11-04", "USD"]);
  assertEq([i.items.length, i.subtotal, i.tax, i.taxRate, i.total], [3, 22500, 2250, 10, 24750]);
  assertEq(issues, []);
});
test("wrong invoice is caught on every error", () => {
  const { i, issues } = check("inv_wrong.txt");
  const msgs = issues.map((x) => x.message).join(" | ");
  assertEq(i.currency, "GBP");
  assert(msgs.includes("Line 'Backup add-on'"), msgs);
  assert(msgs.includes("Line items add up to 277.00"), msgs);
  assert(msgs.includes("total says 330.00"), msgs);
  assert(msgs.includes("Due date"), msgs);
  assertEq(status(issues), "Needs fixing");
});
test("missing fields are errors", () => {
  const msgs = validate(extractInvoice("random text with no invoice data at all")).map((x) => x.message).join(" ");
  assert(msgs.includes("Invoice number not found") && msgs.includes("Total not found"), msgs);
});
test("PKR invoice with Rs. prefix", () => {
  const { i, issues } = check("pkr");
  assertEq([i.currency, i.total, i.items.length, status(issues)], ["PKR", 292500, 2, "OK"]);
});
test("euro invoice with VAT", () => {
  const { i, issues } = check("eur");
  assertEq([i.currency, i.taxRate, status(issues)], ["EUR", 19, "OK"]);
});
test("invoice without line items needs review, not failure", () => {
  const { i, issues } = check("nolines");
  assertEq([i.total, status(issues)], [125000, "Review"]);
});
test("wrong tax rate is warned", () => {
  const msgs = check("badtax").issues.map((x) => x.message).join(" ");
  assert(msgs.includes("Tax rate 19%"), msgs);
});
test("no floating-point drift: 0.1 + 0.2 style totals", () => {
  const t = "Shop\nInvoice No: X-1\nDate: 2026-10-01\nA  3  $0.10  $0.30\nB  1  $0.20  $0.20\nSubtotal: $0.50\nTotal: $0.50";
  assertEq(status(validate(extractInvoice(t))), "OK");
});

// ---- parity with the Python version ----
for (const exp of fx.expected) {
  test(`PARITY ${exp.name}: fields, status and issue messages equal the Python version's`, () => {
    const { i, issues } = check(exp.name);
    const cents = (s) => (s === null ? null : Math.round(parseFloat(s) * 100));
    assertEq(
      { vendor: i.vendor, number: i.invoiceNumber, date: i.invoiceDate, due: i.dueDate, currency: i.currency, items: i.items.length,
        subtotal: i.subtotal, tax: i.tax, taxRate: i.taxRate, total: i.total, status: status(issues), issues: issues.map((x) => x.message) },
      { vendor: exp.vendor, number: exp.number, date: exp.date, due: exp.due, currency: exp.currency, items: exp.items,
        subtotal: cents(exp.subtotal), tax: cents(exp.tax), taxRate: exp.taxRate === null ? null : parseFloat(exp.taxRate), total: cents(exp.total),
        status: exp.status, issues: exp.issues }
    );
  });
}

// ---- batches ----
const batchDocs = () => SAMPLES.map((name) => ({ name, text: docs[name] }));
test("duplicate invoice across files is detected", () => {
  const r = processDocuments([{ name: "a.txt", text: docs["inv_clean.txt"] }, { name: "b.txt", text: docs["inv_duplicate.txt"] }]);
  assertEq([r[0].status, r[1].status], ["OK", "Needs fixing"]);
  assert(r[1].issues.some((x) => x.message.includes("Duplicate invoice number")));
});
test("PARITY: batch statuses and issues equal the Python version's", () => {
  const r = processDocuments(batchDocs());
  assertEq(r.map((x) => ({ source: x.invoice.source, status: x.status, issues: x.issues.map((i) => i.message) })), fx.batch);
});
test("exports are consistent", () => {
  const r = processDocuments(batchDocs());
  assertEq(summaryRows(r).length, 4);
  assertEq(new Set(summaryRows(r).map((x) => x.status)), new Set(["OK", "Needs fixing", "Review"]));
  assert(lineRows(r).length > 0 && issueRows(r).length >= 5);
});
test("CSV export neutralises formula injection in vendor names", () => {
  const evil = "=cmd|' /C calc'!A0\nInvoice No: E-1\nDate: 2026-10-01\nTotal: $5.00";
  const r = processDocuments([{ name: "evil.txt", text: evil }]);
  const csv = toCSV(summaryRows(r), SUMMARY_COLUMNS);
  assert(!/(^|,|\n)=cmd/.test(csv) && csv.includes("'=cmd"), csv);
});

// ---- real PDFs (PDF.js runs in the browser) ----
test("PDF text is extracted and parsed", async () => {
  const data = await (await fetch("../data/samples/inv_clean.pdf")).arrayBuffer();
  const i = extractInvoice(await pdfToText(data));
  assertEq([i.invoiceNumber, i.total, i.items.length], ["BP-2026-0412", 24750, 3]);
});
test("scanned (text-less) PDF gives a clear error", async () => {
  const data = await (await fetch("./blank_scanned.pdf")).arrayBuffer();
  await assertThrows(() => pdfToText(data), "scanned");
});
test("corrupt PDF gives a clear error", async () => {
  await assertThrows(() => pdfToText(new TextEncoder().encode("not a pdf").buffer), "Could not open");
});

// ---- the files the website actually serves ----
for (const name of SAMPLES) {
  test(`the served sample file ${name} exists and matches the reference text`, async () => {
    const res = await fetch(`../data/samples/${name}`);
    assert(res.ok, `HTTP ${res.status} for ${name}`);
    const text = await res.text();
    assert(!text.includes("<!DOCTYPE"), `${name} returned an HTML error page`);
    assertEq(text.replace(/\r/g, ""), docs[name].replace(/\r/g, ""));
  });
}

// ---- the real page, loaded in a frame ----
async function loadApp() {
  const f = document.createElement("iframe");
  f.src = "../index.html";
  f.style.cssText = "width:1200px;height:800px;border:1px solid #ccc";
  document.body.append(f);
  await new Promise((r) => f.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 1200));
  return f;
}
test("UI: sample invoices render summary, details and exports with no '[object' artefacts", async () => {
  const f = await loadApp();
  const d = f.contentDocument;
  assert(!d.body.textContent.includes("[object"), "found '[object ...]' text in the page");
  assertEq(d.querySelectorAll("#summary tbody tr").length, 4);
  assertEq(d.querySelectorAll("#details details.card").length, 4);
  assertEq(d.querySelectorAll("#exports button").length, 3);
  assert(d.getElementById("metrics").textContent.includes("Needs fixing"));
  assert(!d.body.textContent.includes("<!DOCTYPE"), "a sample file failed to load");
});
test("UI: uploading a real PDF and a corrupt PDF", async () => {
  const f = await loadApp();
  const w = f.contentWindow;
  const pdf = await (await fetch("../data/samples/inv_clean.pdf")).blob();
  const dt = new w.DataTransfer();
  dt.items.add(new w.File([pdf], "upload.pdf", { type: "application/pdf" }));
  dt.items.add(new w.File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));
  const input = f.contentDocument.getElementById("files");
  input.files = dt.files;
  input.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 3500));
  const d = f.contentDocument;
  assert(d.getElementById("problems").textContent.includes("broken.pdf: Could not open"));
  assertEq(d.querySelectorAll("#summary tbody tr").length, 1);
  assert(d.getElementById("summary").textContent.includes("247.50"));
});
test("UI: a hostile invoice cannot inject HTML or run script", async () => {
  const f = await loadApp();
  const w = f.contentWindow;
  w.__pwned = false;
  const evil = '<img src=x onerror=window.__pwned=true>\nInvoice No: E-1\nDate: 2026-10-01\nTotal: $5.00';
  const ta = f.contentDocument.getElementById("paste");
  ta.value = evil;
  ta.dispatchEvent(new w.Event("input"));
  await new Promise((r) => setTimeout(r, 600));
  const d = f.contentDocument;
  assertEq(w.__pwned, false);
  assertEq(d.querySelectorAll("main img").length, 0);
  assert(d.getElementById("summary").textContent.includes("<img src=x"));
});
