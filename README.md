# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kace2122/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kace2122/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Write a faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case; places go by CPU time, least first, and beating csv-reader, the house baseline, at 95% confidence only qualifies an entry for a place.

## Run it

```sh
node main.ts
```

`main.ts` (Node 22, no dependencies, no network) reads every case from
`/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`), answers each with
`run` from `solve.js`, and writes `/output/answers.json` (or
`$MAKEFUN_OUTPUT_DIR/answers.json`).

## How it is faster

csv-reader 1.0.0 builds every field one character at a time (`value += c`).
`solve.js` returns csv-reader's exact answer — same `{columns, rows, errors}`,
same broken-row policy (stray CRs, unterminated quotes, quote junk, short and
long rows) — but slices each field out of the input in one go, scans with
`charCodeAt`, and finds a quoted field's closing quote with `indexOf`. On the
kit's practice set (6 cases, ~10.2 MB of CSV) it answers in ~80 ms of `run`
time where the reference takes ~1.35 s, about 17x faster, verified identical
on all 6 practice cases and on 5,639 fuzzed inputs (generator-drawn cases,
token-soup edge cases and pathological inputs) against the reference.

---

<sub>Entered on [make.fun](https://make.fun/?ref=makefun-medal-puddle-waffle&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
