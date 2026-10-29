import { toCSV } from "./csv.js";
import { processDocuments, summaryRows, lineRows, issueRows, SUMMARY_COLUMNS, LINE_COLUMNS, ISSUE_COLUMNS } from "./batch.js";
import { fmt } from "./extract.js";
import { pdfToText, UnreadablePdf } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const SAMPLES = ["inv_clean.txt", "inv_wrong.txt", "inv_duplicate.txt", "inv_date.txt"];
const ICON = { OK: "✅", Review: "⚠️", "Needs fixing": "❌" };
const CLASS = { OK: "s-OK", Review: "s-Review", "Needs fixing": "s-Fix" };

// Safe DOM builder: every string becomes a text node, so invoice text can never inject HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let uploaded = []; // [{name, text}] from files the visitor chose
let problems = [];

async function readFiles(fileList) {
  uploaded = [];
  problems = [];
  for (const f of fileList) {
    try {
      if (/\.pdf$/i.test(f.name)) uploaded.push({ name: f.name, text: await pdfToText(await f.arrayBuffer()) });
      else uploaded.push({ name: f.name, text: await f.text() });
    } catch (err) {
      problems.push(`${f.name}: ${err instanceof UnreadablePdf ? err.message : "Could not read this file."}`);
    }
  }
}

async function collect() {
  const docs = [...uploaded];
  const pasted = $("paste").value.trim();
  if (pasted) docs.push({ name: "pasted text", text: pasted });
  if ($("useSample").checked) {
    for (const name of SAMPLES) docs.push({ name, text: await (await fetch(`data/samples/${name}`)).text() });
  }
  return docs;
}

async function refresh() {
  $("problems").replaceChildren(...problems.map((p) => h("div", { class: "err" }, p)));
  const docs = await collect();
  for (const id of ["metrics", "summary", "details", "exports"]) $(id).replaceChildren();
  if (!docs.length) {
    $("summary").append(h("p", { class: "note" }, "Upload invoices, paste text, or switch on the sample invoices."));
    return;
  }
  const results = processDocuments(docs);
  const count = (s) => results.filter((r) => r.status === s).length;
  $("metrics").append(
    ...[["Invoices read", results.length], ["✅ OK", count("OK")], ["⚠️ Review", count("Review")], ["❌ Needs fixing", count("Needs fixing")]].map(([l, v]) =>
      h("div", { class: "metric" }, h("small", {}, l), h("b", {}, v)))
  );

  const rows = summaryRows(results);
  $("summary").append(
    h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, SUMMARY_COLUMNS.map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, SUMMARY_COLUMNS.map((c) =>
        h("td", c === "status" ? { class: CLASS[r.status] } : {}, r[c])))))))
  );

  $("details").append(
    h("h2", {}, "Details"),
    ...results.map((r) => {
      const inv = r.invoice;
      const card = h("details", { class: "card" },
        h("summary", {}, `${ICON[r.status]} ${inv.source}: ${inv.vendor || "unknown vendor"} · ${inv.invoiceNumber || "no number"} · ${r.status}`),
        h("div", { class: "body" },
          r.issues.length
            ? r.issues.map((i) => h("div", { class: i.severity === "error" ? "err" : "warn" }, i.message))
            : h("div", { class: "good" }, "All checks passed: line items, subtotal, tax and total agree."),
          inv.items.length
            ? h("div", { class: "tablewrap" }, h("table", {},
                h("thead", {}, h("tr", {}, ["Description", "Qty", "Unit", "Amount"].map((c) => h("th", {}, c)))),
                h("tbody", {}, inv.items.map((it) => h("tr", {}, h("td", {}, it.description), h("td", {}, it.quantity), h("td", {}, fmt(it.unit)), h("td", {}, fmt(it.amount)))))))
            : null)
      );
      if (r.status !== "OK") card.open = true;
      return card;
    })
  );

  $("exports").append(
    h("h2", {}, "Export"),
    h("button", { class: "btn", onclick: () => download("invoices.csv", toCSV(rows, SUMMARY_COLUMNS)) }, "Invoices (CSV)"),
    h("button", { class: "btn", onclick: () => download("line_items.csv", toCSV(lineRows(results), LINE_COLUMNS)) }, "Line items (CSV)"),
    h("button", { class: "btn", onclick: () => download("issues.csv", toCSV(issueRows(results), ISSUE_COLUMNS)) }, "Issues (CSV)")
  );
}

$("files").addEventListener("change", async (e) => {
  await readFiles(e.target.files);
  if (uploaded.length) $("useSample").checked = false;
  refresh();
});
$("paste").addEventListener("input", () => { if ($("paste").value.trim()) $("useSample").checked = false; refresh(); });
$("useSample").addEventListener("change", refresh);
refresh();
