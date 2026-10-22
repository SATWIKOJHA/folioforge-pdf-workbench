# FolioForge

**A focused PDF workbench for everyday document tasks.**

FolioForge is an original full-stack PDF utility built with Node.js and PyMuPDF. It gives users a clean browser interface for combining documents, separating pages, reducing file size, changing orientation, and extracting the pages that matter.

> This is an independent implementation with original branding and interface design. It does not use, copy, or connect to third-party PDF-service code or APIs.

## Features

- Merge up to eight PDFs into one document
- Split a PDF into a ZIP of page-by-page PDFs
- Compress a PDF using document-stream optimization
- Rotate every page by 90°, 180°, or 270°
- Extract selected page ranges such as `1-3, 5, 8-10`
- Drag-and-drop browser interface with clear processing feedback
- Automated cleanup of generated job data when the server exits

## Tech stack

- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **Server:** Node.js HTTP server with zero npm runtime dependencies
- **PDF engine:** [PyMuPDF](https://pymupdf.readthedocs.io/) (`pymupdf`)
- **Tests:** Node.js built-in test runner

## Quick start

### Prerequisites

- Node.js 20 or newer
- Python 3.10 or newer
- PyMuPDF

Install PyMuPDF if it is not already available:

```bash
python3 -m pip install pymupdf
```

Start the app:

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in your browser.

## Test

```bash
npm test
```

The automated suite verifies the health endpoint plus merge, split, compress, rotate, extract, and generated-download flows.

## Project structure

```text
.
├── public/               # Browser interface
├── scripts/pdf_worker.py # PyMuPDF transformations
├── test/                 # End-to-end HTTP and PDF operation tests
└── server.mjs            # Upload, job, and download server
```

## Deployment note

FolioForge currently runs as a Node.js server that invokes a Python PDF worker. A production deployment needs a host that supports both Node.js and Python processes; a static-only host cannot execute the PDF operations.

## Roadmap

- [ ] Password protection and unlock flows
- [ ] Watermarks and page numbering
- [ ] Image and Office document conversion
- [ ] OCR for scanned documents
- [ ] Authentication, quotas, and secure object storage
- [ ] Background job queue for large document batches

## Contributing

Issues and pull requests are welcome. Please include a focused description and run `npm test` before opening a pull request.

## License

No license has been selected yet. All rights are reserved until a license is added.
