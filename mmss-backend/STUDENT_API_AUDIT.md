# Phase 4 — student API audit (reference: current Next.js frontend + old Express API)

Sources: `src/services/api.ts`, `src/services/homeworkLoader.ts`, `src/hooks/useHomework.ts`,
`src/components/{HomeworkCard,TodayView,RecentView,AllHomeworkView,CalendarView,CompletedView,AttachmentsView}.tsx`,
`src/utils/{dateUtils,subjectDetector}.ts`, `src/types/homework.ts`,
`server/routes/{homeworkRoutes,classworkRoutes}.js`, `vercel.json`.
The frontend and the old backend were **not modified**.

## The single most important finding

**The current student app fetches one unfiltered list and filters everything in the browser.**

| View | How it filters | Server involvement |
| --- | --- | --- |
| `TodayView` | `isTodayDate(item.date)` | none |
| `RecentView` | "last 7 days" via `parseHomeworkDate` | none |
| `AllHomeworkView` | subject match, free text over `homework`/`subject`, `formatToISODate(item.date) === selected`, `typeFilter === 'attachment'` → `Boolean(item.attachment)` | none |
| `CalendarView` | `e.date.startsWith("YYYY-MM")`, `.sort(localeCompare)` | none |
| `CompletedView` | `item.completed` | none |
| `AttachmentsView` | `Boolean(item.attachment)` | none |
| pagination | `usePagination` slices the array client-side (25/page) | none |

Subjects are also client-side: `CANONICAL_SUBJECT_NAMES` is a hardcoded array in
`src/utils/subjectDetector.ts` and `detectSubject()` re-derives a subject from the text on
every render. **There is no `/api/subjects` endpoint today.**

Consequence for this phase: `GET /api/homework` must keep returning the student's **whole**
class feed. Server-side filters are an addition for other clients, not a replacement — turning
the default response into a paginated page would silently break every view above.

## Endpoint map

```
Old endpoint                     Frontend use                       New Rust endpoint                     Layer
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
GET  /api/homework                getHomework → full class feed      GET  /api/homework                   HomeworkService → homework/attachments/
                                  (filters everything client-side)        ?subjectId&date&from&to&limit     subjects/classes/users/progress/notes
PATCH /api/homework/:id/status    toggleCompleted {completed}       PATCH /api/progress/:homeworkId      ProgressService → progress
PATCH /api/homework/:id/note      updateNote {note}                 PATCH /api/notes/homework/:hwId      NotesService → notes
                                                                 PATCH /api/homework/:id/note  (alias)
—                                 (no endpoint; hardcoded array)     GET  /api/subjects                  subjects::list
—                                 (no endpoint)                      GET  /api/homework/:id/attachments  HomeworkService → attachments
POST /api/homework/refresh        forceRefresh                      — deferred (EduSecure)
GET  /api/classwork               ClassworkView                     — deferred (needs storage + approval)
GET  /api/auth/me|login|logout    authService                        R3, now also at /api/auth/*        AuthService
```

## Response contract the frontend actually reads

`homeworkService.getHomework` maps each row through this, and nothing else survives:

| Field | Read as | Notes |
| --- | --- | --- |
| `id` | string, used as React key and in `?`/`encodeURIComponent` | old value was a 64-char SHA-256 hex |
| `date` | **parsed** for sort/filter/`isTodayDate`, **and rendered raw** by `HomeworkCard:231` | old value `"Jul 23, 2026"`; `parseHomeworkDate` already accepts `YYYY-MM-DD` |
| `subject` | plain string | compared against `homeworkSubjectName(item)` |
| `homework` | `.trim()`, dedup key, free-text search | |
| `attachment` | truthiness only (`Boolean(item.attachment)`) | old value a remote EduSecure URL |
| `completed` | `!!doc.completed` | |
| `note` | `doc.note \|\| null` | |
| `updatedAt` | passed through | |
| `type` | `doc.type \|\| "School Diary"` | **dead**: `type` was `"School Diary"` on all 522 live rows |

Response envelope: `{ count, homework: [...], isStale, isRefreshing, schoolSessionExpired, aiPending }`.
Error envelope for data routes: `{ error }` or `{ message }`; a 401 is mapped to code `UNAUTHENTICATED`.

## Compatibility decisions

| Decision | Why |
| --- | --- |
| `GET /api/homework` returns the student's **entire** class feed, no default limit | every view above filters client-side from one list |
| `date` is ISO `YYYY-MM-DD`, **plus** `displayDate` `"Oct 5, 2026"` | `parseHomeworkDate` and `formatToISODate` already handle ISO; the card renders the raw string, so `displayDate` preserves today's visible output without the server owning locale formatting |
| camelCase JSON throughout | the existing client is camelCase |
| `subject` stays a **string**, with `subjectId` added | the client compares subject names; the id is for filtering and future teacher work |
| `homework` and `classwork` returned separately | R2 split them and the brief requires it; the old single `content` blob is gone |
| `attachment` legacy slot is present but `null` | no storage layer exists yet. Emitting a URL that returns JSON would make the frontend's attachment views fail confusingly; `null` makes them correctly empty |
| No `url` field on attachment metadata | same reason. Metadata only, bytes deferred to the storage phase |
| `type` dropped | dead scraper artifact; nothing in the client branches on a real value |
| `PATCH /api/homework/:id/status` and `PATCH /api/homework/:id/note` kept as aliases | they are the exact URLs the shipped client calls. They are thin shims over the new REST routes, documented as aliases, not a second implementation |
| Student routes mounted at `/api/*`; R3's `/auth/*` also mounted at `/api/auth/*` | `vercel.json` rewrites `/api/:path*` through unchanged, so the backend really does own `/api/*`. R3 is frozen at `/auth/*`; one extra mount is cheaper than editing a frozen phase |
| 404 for an id outside the student's class | and 404 for an id that does not exist. Distinguishing them would let a student probe for the existence of other classes' homework |
| 400 for malformed filters, never a silently-widened query | |
| `completed`/`note` are read from the authenticated student only | no client-supplied user id is ever honoured |

## Role behaviour

Today a teacher logs in through the same `/api/homework` and gets their own section's diary.
In the new model a teacher has `class_id = NULL` and their feeds come from the teacher API
(Phase 5+). So every route in this phase takes the R3 `StudentUser` extractor and answers
**403** to a teacher or admin. This is the deliberate "student endpoints mean student"
boundary the brief asks for; it is not a gap, it is the contract.

## Not in scope for this phase

`POST /api/homework/refresh`, `/api/classwork` (needs storage + approval), `/api/calendar`,
`/api/school-updates`, `/api/requests`, `/api/conversations` + messages, `/api/notifications`,
`/api/section/members`, `/api/users/*`, all `/api/teacher/*`, all `/api/admin/*`,
`/api/alerts/active`, `/api/auth/profile*`, `/api/auth/reconnect`.