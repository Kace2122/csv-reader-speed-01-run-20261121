// csv-reader-speed-01 round 2: a faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same input {text, header}: {columns, rows, errors}. The reading policy is
// csv-reader's own (see the kit's baseline vendor/csv-reader/index.js):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote and each CRLF or lone CR inside it
//     read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character, and the text after
//     it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row,
//     with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's
//     short_row or long_row when it ends: line the 1-based line its record
//     starts on, counting every LF, CRLF and lone CR inside quotes, and row
//     its record's index in rows, null for the header.
//
// Speed: round 1 slices fields and finds a quoted field's closing quote with
// indexOf, but it builds every unquoted field with `value += slice` (a
// string-concatenation per field even when the field is one plain span) and
// it pays two unbounded indexOf scans to test a quoted field for line
// breaks. Round 2 keeps round 1's reader but tightens the hot paths: an
// unquoted field with no stray CR is pushed as its slice directly (no `+=`),
// a quoted field's content is built once and tested for breaks on itself
// (no scans past its end), and a quoted field that spans lines is
// normalised by segments joined once instead of one character at a time.
// Nothing is cached from one call to the next: pure, no clock, no
// randomness, no locale.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Skip blank lines (LF, or CRLF). A line left with no characters is no
    // record, and a line left with only a lone CR is not blank either: the
    // CR is stray, dropped inside the field scan, so the field is still
    // read (the reference keeps it as a one-field record).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = 0; // 0 comma, 1 line break, 2 end of text

    do {
      let init = '';
      let isJunk = false;
      let useUnquoted = false;

      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let segStart = pos + 1;
        let parts = null;
        let closePos = -1;
        let q = text.indexOf('"', segStart);
        while (q !== -1) {
          if (text.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, q + 1));
            segStart = q + 2;
            q = text.indexOf('"', segStart);
            continue;
          }
          closePos = q;
          break;
        }
        if (closePos === -1) {
          // No closing quote: the quote is a literal, the text after it is
          // read again as unquoted from just after the quote.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          init = '"';
          useUnquoted = true;
        } else {
          // Build the content once (doubled quotes already resolved), then
          // test it for line breaks on itself: no scan past its end.
          const content =
            parts === null
              ? text.slice(segStart, closePos)
              : parts.join('') + text.slice(segStart, closePos);
          let raw = content;
          if (content.indexOf('\n') !== -1 || content.indexOf('\r') !== -1) {
            // Normalise by segments: each CRLF or lone CR becomes LF.
            const segs = [];
            let j = 0;
            const m = content.length;
            let breaks = 0;
            let seg = 0;
            while (j < m) {
              const cc = content.charCodeAt(j);
              if (cc === 13) {
                segs.push(content.slice(seg, j));
                segs.push('\n');
                breaks += 1;
                j += content.charCodeAt(j + 1) === 10 ? 2 : 1;
                seg = j;
              } else if (cc === 10) {
                segs.push(content.slice(seg, j));
                segs.push('\n');
                breaks += 1;
                j += 1;
                seg = j;
              } else {
                j += 1;
              }
            }
            segs.push(content.slice(seg, m));
            line += breaks;
            raw = segs.join('');
          }
          pos = closePos + 1;
          if (pos >= n) {
            fields.push(raw);
            ended = 2;
            continue;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            fields.push(raw);
            ended = 0;
            continue;
          }
          if (c === 10) {
            pos += 1;
            line += 1;
            fields.push(raw);
            ended = 1;
            continue;
          }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            fields.push(raw);
            ended = 1;
            continue;
          }
          // Junk follows the closing quote: it is appended as it stands,
          // so the rest of the field is read as unquoted onto the raw text.
          init = raw;
          isJunk = true;
          useUnquoted = true;
        }
      } else {
        lastQuoted = false;
        useUnquoted = true;
      }

      if (useUnquoted) {
        // Unquoted field: find the next comma or line break. A field with
        // no stray CR is its slice pushed directly (no `value +=`); only a
        // stray CR forces accumulation, and then only for that field.
        let segPos = pos;
        let acc = null; // accumulated value once a stray CR splits the field
        let added = 0; // characters kept by this scan (for quote_junk)
        for (;;) {
          // Find the next comma or line break. (An unrolled four-at-a-time
          // scan was tried here and measured SLOWER in this parser: a field
          // is only ~8 characters, so the unrolled loop's per-step branches
          // cost more than the one-char loop it replaces. Keep it simple.)
          let i = segPos;
          while (i < n) {
            const cc = text.charCodeAt(i);
            if (cc === 44 || cc === 10 || cc === 13) break;
            i += 1;
          }
          if (i > segPos) added += i - segPos;
          if (i >= n) {
            const v =
              acc === null
                ? init === ''
                  ? text.slice(segPos, n)
                  : init + text.slice(segPos, n)
                : acc + text.slice(segPos, n);
            if (isJunk && added > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
            fields.push(v);
            pos = n;
            ended = 2;
            break;
          }
          const cc = text.charCodeAt(i);
          if (cc === 44) {
            const v =
              acc === null
                ? init === ''
                  ? text.slice(segPos, i)
                  : init + text.slice(segPos, i)
                : acc + text.slice(segPos, i);
            if (isJunk && added > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
            fields.push(v);
            pos = i + 1;
            ended = 0;
            break;
          }
          if (cc === 10) {
            const v =
              acc === null
                ? init === ''
                  ? text.slice(segPos, i)
                  : init + text.slice(segPos, i)
                : acc + text.slice(segPos, i);
            if (isJunk && added > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
            fields.push(v);
            pos = i + 1;
            line += 1;
            ended = 1;
            break;
          }
          if (text.charCodeAt(i + 1) === 10) {
            const v =
              acc === null
                ? init === ''
                  ? text.slice(segPos, i)
                  : init + text.slice(segPos, i)
                : acc + text.slice(segPos, i);
            if (isJunk && added > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
            fields.push(v);
            pos = i + 2;
            line += 1;
            ended = 1;
            break;
          }
          // Lone CR: stray_cr, drop it, keep this segment and scan on.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          const seg = text.slice(segPos, i);
          acc = acc === null ? (init === '' ? seg : init + seg) : acc + seg;
          i += 1;
          segPos = i;
        }
      }
    } while (ended === 0);

    // A record that is one empty unquoted field is not a record at all.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
