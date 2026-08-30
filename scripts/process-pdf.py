#!/usr/bin/env python3
"""Extract bounded PDF text and optionally render textless pages for vision models."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--max-chars", type=int, required=True)
    parser.add_argument("--render-dir")
    parser.add_argument("--max-render-pages", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Path(args.pdf)
    if not source.is_file():
        fail("PDF file was not found.")

    try:
        from pypdf import PdfReader
    except ImportError:
        fail("PDF support is not installed. Install the packages listed in requirements.txt.")

    try:
        reader = PdfReader(str(source), strict=False)
        encrypted = bool(reader.is_encrypted)
        if encrypted:
            fail("Encrypted PDFs are not supported.")
        page_count = len(reader.pages)
        processed_pages = min(page_count, args.max_pages)
        chunks: list[str] = []
        length = 0
        text_truncated = False
        for index in range(processed_pages):
            page_text = reader.pages[index].extract_text() or ""
            if not page_text.strip():
                continue
            heading = f"\n\n--- Page {index + 1} ---\n"
            remaining = args.max_chars - length
            if remaining <= 0:
                text_truncated = True
                break
            value = (heading + page_text).strip()
            if len(value) > remaining:
                value = value[:remaining]
                text_truncated = True
            chunks.append(value)
            length += len(value)
            if text_truncated:
                break
    except SystemExit:
        raise
    except Exception as error:
        fail(f"Unable to read PDF: {error}")

    rendered_pages: list[dict[str, object]] = []
    text = "\n\n".join(chunks).strip()
    if not text and args.render_dir and args.max_render_pages > 0:
        try:
            import pypdfium2 as pdfium

            render_dir = Path(args.render_dir)
            render_dir.mkdir(parents=True, exist_ok=True)
            document = pdfium.PdfDocument(str(source))
            render_count = min(page_count, processed_pages, args.max_render_pages)
            for index in range(render_count):
                page = document[index]
                width, height = page.get_size()
                scale = min(1.35, 1_600 / max(width, height, 1))
                bitmap = page.render(scale=max(scale, 0.1))
                image = bitmap.to_pil().convert("RGB")
                target = render_dir / f"page-{index + 1}.jpg"
                image.save(target, format="JPEG", quality=78, optimize=True)
                rendered_pages.append({"page": index + 1, "path": str(target), "mimeType": "image/jpeg"})
                image.close()
                bitmap.close()
                page.close()
            document.close()
        except ImportError:
            fail("Scanned PDF rendering support is not installed. Install the packages listed in requirements.txt.")
        except Exception as error:
            fail(f"Unable to render scanned PDF: {error}")

    print(json.dumps({
        "pageLimit": args.max_pages,
        "characterLimit": args.max_chars,
        "pageCount": page_count,
        "processedPages": processed_pages,
        "text": text,
        "truncated": page_count > processed_pages or text_truncated,
        "encrypted": False,
        "renderedPages": rendered_pages,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
