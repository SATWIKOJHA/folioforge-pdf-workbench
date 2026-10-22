#!/usr/bin/env python3
"""PDF transformations backed by PyMuPDF."""

import argparse
import json
import sys
import zipfile
from pathlib import Path

import pymupdf as fitz


def parse_pages(value, page_count):
    selected = []
    for item in value.split(","):
        item = item.strip()
        if "-" in item:
            first, last = (int(piece.strip()) for piece in item.split("-", 1))
            if first < 1 or last < first or last > page_count:
                raise ValueError("Choose page numbers inside the source document.")
            selected.extend(range(first - 1, last))
        else:
            number = int(item)
            if number < 1 or number > page_count:
                raise ValueError("Choose page numbers inside the source document.")
            selected.append(number - 1)
    return selected


def save_optimized(document, output):
    document.save(output, garbage=4, deflate=True, clean=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tool", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--rotation", default="90")
    parser.add_argument("--pages", default="")
    parser.add_argument("inputs", nargs="+")
    args = parser.parse_args()

    output_directory = Path(args.output)
    output_directory.mkdir(parents=True, exist_ok=True)
    sources = [Path(item) for item in args.inputs]

    if args.tool == "merge":
        merged = fitz.open()
        for source_path in sources:
            source = fitz.open(source_path)
            merged.insert_pdf(source)
            source.close()
        output_name = "folioforge-merged.pdf"
        save_optimized(merged, output_directory / output_name)
        page_count = merged.page_count
        merged.close()
        response = {"output": output_name, "filename": output_name, "mime": "application/pdf", "pageCount": page_count}

    elif args.tool == "split":
        source = fitz.open(sources[0])
        output_name = "folioforge-split-pages.zip"
        with zipfile.ZipFile(output_directory / output_name, "w", zipfile.ZIP_DEFLATED) as archive:
            for index in range(source.page_count):
                page_document = fitz.open()
                page_document.insert_pdf(source, from_page=index, to_page=index)
                page_name = f"page-{index + 1:03d}.pdf"
                page_path = output_directory / page_name
                save_optimized(page_document, page_path)
                page_document.close()
                archive.write(page_path, page_name)
                page_path.unlink()
        page_count = source.page_count
        source.close()
        response = {"output": output_name, "filename": output_name, "mime": "application/zip", "pageCount": page_count}

    elif args.tool == "compress":
        source = fitz.open(sources[0])
        output_name = "folioforge-compressed.pdf"
        save_optimized(source, output_directory / output_name)
        page_count = source.page_count
        source.close()
        response = {"output": output_name, "filename": output_name, "mime": "application/pdf", "pageCount": page_count}

    elif args.tool == "rotate":
        source = fitz.open(sources[0])
        angle = int(args.rotation)
        for page in source:
            page.set_rotation((page.rotation + angle) % 360)
        output_name = f"folioforge-rotated-{angle}.pdf"
        save_optimized(source, output_directory / output_name)
        page_count = source.page_count
        source.close()
        response = {"output": output_name, "filename": output_name, "mime": "application/pdf", "pageCount": page_count}

    elif args.tool == "extract":
        source = fitz.open(sources[0])
        selected = parse_pages(args.pages, source.page_count)
        extracted = fitz.open()
        for page_number in selected:
            extracted.insert_pdf(source, from_page=page_number, to_page=page_number)
        output_name = "folioforge-extracted-pages.pdf"
        save_optimized(extracted, output_directory / output_name)
        page_count = extracted.page_count
        source.close()
        extracted.close()
        response = {"output": output_name, "filename": output_name, "mime": "application/pdf", "pageCount": page_count}

    else:
        raise ValueError("Unsupported PDF tool.")

    print(json.dumps(response))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
