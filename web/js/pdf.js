// PDF text extraction with the bundled PDF.js (vendor/, Apache-2.0). Runs fully in the browser.
// Scanned (image-only) PDFs are detected and reported, not guessed at.

export class UnreadablePdf extends Error {}

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

export async function pdfToText(arrayBuffer) {
  const pdf = await lib();
  let doc;
  try {
    doc = await pdf.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  } catch (err) {
    throw new UnreadablePdf(`Could not open this PDF (${(err && err.name) || "error"}).`);
  }
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // Group text fragments into lines by their vertical position, then order them left to right.
    const rows = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str === "") continue;
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x: item.transform[4], w: item.width, s: item.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd = null;
      for (const it of row.items) {
        if (prevEnd !== null) {
          const gap = it.x - prevEnd;
          line += gap > 12 ? "   " : gap > 1.5 ? " " : "";
        }
        line += it.s;
        prevEnd = it.x + it.w;
      }
      out.push(line.trimEnd());
    }
  }
  const text = out.join("\n");
  if (text.trim().length < 20) {
    throw new UnreadablePdf("No text found. This looks like a scanned image; it needs OCR, which this tool does not do.");
  }
  return text;
}
