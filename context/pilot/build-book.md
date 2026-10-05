# Offline Build Book

The iOS Build Book tab bundles the original **Supreme Product Cut Produce Build Book — 5.21.2026** PDF. No upload or vision provider is involved. Search matches product headings and extracted ingredient/instruction text. Category filters narrow results; opening a result starts at its original physical PDF page. The full book remains available, including diagram-only pages. Page text is a searchable convenience; the original pages retain the tables, quantities and illustrations.

The index covers 326 physical pages in 195 entries. Consecutive pages are paired only when their headings match. Physical and printed page numbers differ in places. Source heading inconsistencies are preserved; product prices and packaging are not automatically matched to the stocking catalog. Ten pages have no extractable text, so use the full-book reader for them. The import receipt records the source SHA-256 and these limitations.

To replace the approved source, run `python scripts/index-build-book.py /absolute/path/to/book.pdf` with `pypdf` and `pdfplumber` installed, then inspect titles, category boundaries and page coverage before rebuilding. The current importer contains boundaries for this edition; another edition requires reviewing them.

Prep defaults to Fruit (starting $5 bowls), then Vegetables and Salads. Filters allow group, category, type, quantity/name sorting and completed items. Remaining is beside the product name; Made, Record and Done share a row at standard text sizes, with a stacked layout at accessibility sizes. Location abbreviations remain inside the disclosure. Stock and preparation calculations are unchanged.
