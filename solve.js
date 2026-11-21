// csv-reader-speed-01: a faster drop-in for make.fun's csv-reader 1.0.0.
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
// Speed: the reference builds every field one character at a time
// (value += c per character). This reader instead slices each field out of
// the input in one go (String.slice shares the input's storage, so no
// copying), scans with charCodeAt, and finds a quoted field's closing quote
// with indexOf. A quoted field's content is taken as one slice when it holds
// no line break (the common case); doubled quotes are collected as segments
// and joined once; only a quoted field that spans lines takes the slow
// normalising path. Nothing is cached from one call to the next: pure,
// no clock, no randomness, no locale.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Lines with no characters are no records.
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

    // The record being read: the line it starts on and the index in rows it
    // takes (null: the header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let lastQuoted = false;
    let ended = 0; // how the last field ended: 0 comma, 1 line break, 2 end
    do {
      let init = ''; // the unquoted scan's starting value ('' normally)
      let isJunk = false; // this scan is the tail after a closing quote
      let useUnquoted = false;
      if (text.charCodeAt(pos) === 34) {
        // A quoted field: find its closing quote, the next quote that is
        // not doubled.
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let segStart = pos + 1;
        let parts = null; // segments, once a doubled quote is met
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
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          init = '"';
          useUnquoted = true;
        } else {
          // The field's value: one slice when it holds no line break,
          // segments joined when doubled quotes were met, and a normalising
          // pass only when a CRLF or lone CR sits inside it (each one LF,
          // and the line count moves by the breaks inside).
          let raw;
          const nl = text.indexOf('\n', open + 1);
          let hasBreak = nl !== -1 && nl < closePos;
          if (!hasBreak) {
            const cr = text.indexOf('\r', open + 1);
            hasBreak = cr !== -1 && cr < closePos;
          }
          if (!hasBreak) {
            raw = parts === null ? text.slice(segStart, closePos) : parts.join('') + text.slice(segStart, closePos);
          } else {
            const joined = parts === null ? text.slice(segStart, closePos) : parts.join('') + text.slice(segStart, closePos);
            let out = '';
            let j = 0;
            const m = joined.length;
            let breaks = 0;
            while (j < m) {
              const cc = joined.charCodeAt(j);
              if (cc === 13) {
                out += '\n';
                breaks += 1;
                j += joined.charCodeAt(j + 1) === 10 ? 2 : 1;
              } else {
                if (cc === 10) breaks += 1;
                out += joined[j];
                j += 1;
              }
            }
            line += breaks;
            raw = out;
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
          // What follows the closing quote is appended as it stands, up
          // to the next comma or line break.
          init = raw;
          isJunk = true;
          useUnquoted = true;
        }
      } else {
        lastQuoted = false;
        useUnquoted = true;
      }
      if (useUnquoted) {
        // Reads unquoted characters onto `init` up to the next comma or
        // line break: a CR not followed by LF is dropped (stray_cr). The
        // field is sliced out in stretches, never built a character at a
        // time; `added` counts the characters kept.
        let value = init;
        let added = 0;
        for (;;) {
          let i = pos;
          while (i < n) {
            const cc = text.charCodeAt(i);
            if (cc === 44 || cc === 10 || cc === 13) break;
            i += 1;
          }
          if (i > pos) {
            value += text.slice(pos, i);
            added += i - pos;
          }
          if (i >= n) {
            pos = n;
            ended = 2;
            break;
          }
          const cc = text.charCodeAt(i);
          if (cc === 44) {
            pos = i + 1;
            ended = 0;
            break;
          }
          if (cc === 10) {
            pos = i + 1;
            line += 1;
            ended = 1;
            break;
          }
          if (text.charCodeAt(i + 1) === 10) {
            pos = i + 2;
            line += 1;
            ended = 1;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = i + 1;
        }
        if (isJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(value);
      }
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
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
