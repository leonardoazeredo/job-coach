# Verifier test data

`sample-cv.pdf` is a full two-page CV printed from `sample-cv.json`. To reprint it when the layout
changes, run from the repo root (without the last argument the exporter names the file after the CV
and writes it to the current directory), then update the line and glyph-size expectations in
`verify/__tests__/extractors.test.ts`:

```
node scripts/cv-pdf/export-pdf.ts --data scripts/cv-pdf/verify/testdata/sample-cv.json scripts/cv-pdf/verify/testdata/sample-cv.pdf
```

`bad/` holds one small CV per failure class the verifier exists to catch, as the HTML
source and the PDF Chrome printed from it. The PDFs are committed so
`verify/badPdfs.test.ts` runs without Chrome. Every file starts from the same CV
content and differs from `control` only as the table below says. `bad/cv.json` holds only
the CV fields the checks read (bullets are left empty). The two fixtures that add jobs or a section have their own superset,
`bad/<name>.json`. The tests derive each file's expectations from its data file, the
same way `--data` does.

| File | Change from `control` | Fails |
| --- | --- | --- |
| `control` | none; the functional rules of `src/cv/cv.css` at the 11pt level | nothing |
| `ligatures` | `font-family: Helvetica`, ligatures back on | [1] and [4] in pdf.js and MuPDF |
| `letter-spacing` | `h2 { letter-spacing: 1.5px }`, the original CV's rule | [3] in poppler, poppler -layout, pdf.js |
| `letter-spacing-wide` | `h2 { letter-spacing: 4px }` | [3] in poppler -raw, pdf.js, MuPDF |
| `system-ui` | `font-family: system-ui` | [3] in poppler -raw, by gap ratio |
| `invisible-chars` | `&nbsp;` in two skills, `&shy;` in one; the skills line is reordered (React after Node.js) | [2] (soft hyphen: poppler; nbsp: MuPDF), [4] |
| `small-body` | body at 12px (9pt) | [8] |
| `stranded-heading` | four more jobs (Initech, Umbrella Systems, Hooli, Vandelay Industries); a 560px spacer and a forced break leave WORK EXPERIENCE as page 1's last line. Data: `stranded-heading.json` | [9] |
| `stub-last-page` | two more jobs (Initech, Umbrella Systems) and a LANGUAGES section, forced onto page 2. Data: `stub-last-page.json` | [9] |
| `doubled-text` | a second copy of the CV in white on its own page | [10] |

Engine coverage the fixtures pin down:

- **pdf.js** cannot see U+00A0 or U+00AD: pdf.js 6.3 folds the first to a space and
  drops the second, with no option to keep them.
- **MuPDF** sees U+00A0 but not Chrome's soft hyphen. Chrome writes it as the space glyph
  inside `/Span << /ActualText <FEFF00AD> >>`. The `ignore-actualtext` option, which keeps
  ActualText-wrapped ligatures visible to check [1], makes MuPDF report that space.
  poppler honours ActualText and reports U+00AD.
- **MuPDF** reads 1.5px letter-spacing as letter gaps, so it passes
  `letter-spacing`. `letter-spacing-wide` shows it does flag wider spacing.
- **system-ui**: only `poppler -raw` loses the word gaps
  (`React,ReactNative,TypeScript`), and checks [3] and [4] skip gapless stream-order
  output by design. The positional engines read the visible spacing, so the phrase
  checks pass. Check [3] also compares `poppler -raw`'s spaces per character with the
  least spaced positional engine and fails below 0.5x. Measured ratios: 0.19 on
  `system-ui`; 1.14 to 1.38 on every other PDF (the nine other fixtures and `sample-cv.pdf`).
- **doubled-text**: check [10] fails because the poppler text contains the email twice:
  `FAIL "alex.example@example.com" occurs 2 times; expected once`.

## Coverage gaps vs the spec's per-engine requirement

The spec asks every engine to catch every failure class on its own. The matrix below
shows, per fixture, the checks each engine FAILS on Chrome 156 output with the current
options. "pass" means that engine's own lines in checks 1-4 are all ok. "skip" marks
gapless stream-order output that checks [3] and [4] skip by design. Check [2] is listed
under an engine when its FAIL line names that engine. A script generated the matrix from
`node verify/cli.ts --data verify/testdata/bad/cv.json verify/testdata/bad/<name>.pdf`.

| Fixture | poppler | poppler -layout | poppler -raw | pdf.js | mupdf |
| --- | --- | --- | --- | --- | --- |
| `ligatures` | pass | pass | pass | [1], [4] | [1], [4] |
| `letter-spacing` | [3] | [3] | pass | [3] | pass |
| `letter-spacing-wide` | pass | pass | [3] | [3] | [3] |
| `system-ui` | pass | pass | [3] gap ratio, [3] skip, [4] skip | pass | pass |
| `invisible-chars` | [2] soft hyphen, [4] | [2] soft hyphen, [4] | [2] soft hyphen, [4] | pass | [2] nbsp, [4] |

Engine/class pairs that do not fail:

- **ligatures: poppler, poppler -layout, poppler -raw.** All three pass [1] and [4],
  because poppler decomposes the ligature glyphs. Only pdf.js and MuPDF fail.
- **letter-spacing at 1.5px: poppler -raw and MuPDF.** Both pass [3]. MuPDF reads the
  heading whole. poppler, poppler -layout and pdf.js fail.
- **letter-spacing at 4px: poppler and poppler -layout.** Both pass [3]. poppler -raw,
  pdf.js and MuPDF fail.
- **system-ui space loss: the four phrase-matching engines.** Only poppler -raw loses
  the spaces; the positional engines read the visible spacing and pass. poppler -raw
  fails [3] through the gap-ratio sub-check, not through phrase matching, which skips
  gapless stream-order output by design.
- **nbsp and soft hyphen: pdf.js.** pdf.js 6.3 folds U+00A0 to a space and drops U+00AD,
  and has no option to keep them.
- **nbsp: the three poppler engines.** None of them report U+00A0 here. Only MuPDF does.
- **soft hyphen: MuPDF.** Chrome writes U+00AD as a space glyph tagged
  `/ActualText <FEFF00AD>`. The `ignore-actualtext` option that check [1] needs makes MuPDF
  report the space. Only poppler flags Chrome's soft hyphen.

## How the PDFs were printed

Google Chrome 156.0.8078.48 on macOS. The shell loop below is a manual equivalent of
the `printToPdf()` step in `scripts/cv-pdf/export-pdf.ts`. It passes the same flags, but prints
from each HTML file's `file://` URL, where the export prints the app from its served
`http://localhost` URL. The page size and margins come from each file's `@page { size: A4; margin: 48px 0 }`, as they do for the real CV.

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in verify/testdata/bad/*.html; do
  rm -f "${f%.html}.pdf"
  profile=$(mktemp -d)
  "$CHROME" --headless=new --disable-gpu --no-sandbox --disable-breakpad \
    --disable-crash-reporter --no-first-run --no-default-browser-check \
    --no-pdf-header-footer --virtual-time-budget=6000 --user-data-dir="$profile" \
    --print-to-pdf="${f%.html}.pdf" "file://$PWD/$f" &
  pid=$!
  until [ -s "${f%.html}.pdf" ]; do sleep 0.25; done
  sleep 0.5; kill -9 "$pid"; rm -rf "$profile"
done
```

The export script removes its output before printing. Chrome does not exit after
`--print-to-pdf`, so the script then polls until the file is non-empty and kills Chrome.
The loop follows the same steps: delete the target, launch Chrome, wait for a non-empty
file, kill. Without the delete, the wait would pass at once on the previous PDF.

After reprinting, run both verifiers on the result (`node verify/cli.ts --data
verify/testdata/bad/<data>.json verify/testdata/bad/<name>.pdf`, where `<data>` is the
fixture's own data file or `cv`) and confirm each file still
fails exactly the checks in the table. The 560px spacer in `stranded-heading.html` was
tuned for this Chrome build; if the heading moves to page 2, adjust it until WORK
EXPERIENCE is the last line of page 1.
