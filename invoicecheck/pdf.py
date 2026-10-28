"""PDF text extraction. Scanned (image-only) PDFs are detected and reported, not guessed at."""
from __future__ import annotations

import io

from pypdf import PdfReader


class UnreadablePdf(Exception):
    pass


def pdf_to_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # corrupt or encrypted file
        raise UnreadablePdf(f"Could not open this PDF ({type(exc).__name__}).") from exc
    if len(text.strip()) < 20:
        raise UnreadablePdf("No text found. This looks like a scanned image; it needs OCR, which this tool does not do.")
    return text
