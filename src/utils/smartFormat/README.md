# Smart Homework Formatter

Turns messy EduSecure homework text into clean, structured tasks — deterministically,
with no AI involved. The feature sits **on top of** the existing homework fetching,
parsing, authentication, caching and database logic; none of that was changed.

```
Raw Homework
    |
    v
Normalizer          normalizer.ts      whitespace, CRLF, HW/CW abbreviations, punctuation
    |
    v
Tokenizer           tokenizer.ts       subjects, markers, verbs, chapters, pages, dates...
    |
    v
Rule Engine         ruleEngine.ts      clauses -> { action, target, metadata }
    |
    v
Semantic Structure  types.ts           SmartHomework (structured objects, not strings)
    |
    v
Formatter           formatter.ts       render model: merged actions, expanded abbreviations
    |
    v
UI                  ../../components/SmartHomeworkContent.tsx
```

`index.ts` wires the stages together and is the only module the UI imports:

```ts
const { formatted, confidence, isConfident, raw } = smartFormatHomework(item.homework, subject);
```

## Example

```
MATHEMATICS:
CW: Worksheet discussed.
HW: Read Ch-8, Complete Pg-42, Bring notebook.
```

becomes

```
📘 Mathematics

Classwork
• Worksheet discussed

Homework
☐ Read Chapter 8
☐ Complete Page 42
☐ Bring notebook
```

## Confidence and safety

* Every result carries a confidence score (0-100) — see `confidence.ts`.
* At or above `SMART_FORMAT_CONFIDENCE_THRESHOLD` the UI renders the smart format;
  below it the original wording is rendered instead.
* Scoring penalises long unparsed blobs, negations ("do not bring"), non-Latin
  text, lost digits and any drop in wording coverage, so a bad parse can never
  silently replace the real homework.
* Nothing is ever removed: unrecognised text is copied through verbatim, each task
  keeps its original clause in `raw`, and `SmartFormatResult.raw` holds the
  untouched entry so the user can always toggle back to **Original**.

## Extending

* **New action verb** — add a rule to `rules/actions.ts`.
* **New entity** (e.g. "Project 2") — add a pattern to `rules/patterns.ts`, then map
  it into `TaskMetadata` in `ruleEngine.ts` if it should be structured data.
* **New subject icon** — `rules/subjects.ts`.
* Patterns are small and independent on purpose; avoid growing one giant regex.
  Matchers are tried in array order, and the first match wins any overlap.

## Future AI integration

The low-confidence branch is the extension point. An AI pass can be attached where
`isConfident` is `false` (in `index.ts` or in the card) to produce a structure of
the same shape; Stages 1-5 and the UI stay untouched.
