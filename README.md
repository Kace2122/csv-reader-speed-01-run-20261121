# csv-reader-speed-01 — Round 2

A faster drop-in for make.fun's `csv-reader` 1.0.0, built for the
`csv-reader-speed-01-run-20261121` code-speed competition.

## What it does

`run(input)` returns exactly what `csv-reader` 1.0.0's `readCsv` returns for
the same `{text, header}`: `{columns, rows, errors}`. Same reading policy —
BOM dropped, LF/CRLF record ends, blank lines skipped, stray CR dropped
outside quotes, quoted fields with doubled quotes and LF-normalised breaks,
junk after a closing quote appended as-is, unterminated quotes read as
literals, short/long rows padded or cut to the first record's width, errors
in the order met.

## Why it is faster than round 1

Round 1 already slices fields and finds a quoted field's closing quote with
`indexOf`, but it builds every unquoted field with `value += slice` (a
string-concatenation per field even when the field is one plain span) and it
pays two unbounded `indexOf` scans to test a quoted field for line breaks.
Round 2 tightens the hot paths:

- an unquoted field with no stray CR is pushed as its slice directly (no
  `+=`); only a stray CR forces accumulation, and then only for that field;
- a quoted field's content is built once and tested for breaks on itself (no
  scans past its end);
- a quoted field that spans lines is normalised by segments joined once
  instead of one character at a time.

Nothing is cached from one call to the next: pure, no clock, no randomness,
no locale. No WebAssembly, no native addon, no prebuilt binary.

## Files

- `solve.js` — the parser (`run(input)`).
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case alone, writes `/output/answers.json`.
- `package.json`, `LICENSE` — module type and licence.

## Verification (local, node 22, `--no-incremental-marking`)

- Practice set: 6/6 identical to the reference.
- Differential fuzz vs the reference: 20,000 seeded cases (quoted-heavy,
  CRLF, stray CR, junk, unterminated quotes, short/long rows), 0 mismatches.
- Timing (interleaved medians + 1 s-block throughput, practice set, this
  VM is noisy so the range is the honest figure): round 2 ≈ 0.8–0.97x
  round 1 (about 1.1–1.25x faster); round 2 ≈ 0.27–0.32x the reference.
  The win is largest on quoted/break-heavy input (the practice case with
  the most quoted fields runs ~2x faster); clean-plain and note-heavy
  shapes are faster too, mixed-realistic and stray-CR+junk are roughly
  even. The split-based fast path and the unrolled four-at-a-time scan
  were both tried and measured slower here, and reverted.
- `makefun check` 5/5 via the competition kit's CLI (`grade-local`,
  process driver).
