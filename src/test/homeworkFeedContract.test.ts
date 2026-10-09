/**
 * The homework mapper in `src/services/api.ts`, against the exact JSON the Rust backend
 * sends.
 *
 * This is the seam where the two halves of MMSS64 meet, and R10 found a real data-loss bug
 * on it: the backend keeps `homework` and `classwork` as two separate fields, the mapper
 * read only `homework`, and the dedupe key was `date:homework`. Two classwork-only entries
 * on the same day therefore had an *identical* key, so one of them was silently dropped --
 * a class's homework disappearing with no error anywhere.
 *
 * The response fixtures below are copied from real `cargo test` output of
 * `GET /api/homework`, not hand-written from what the mapper expects.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// The mapper reads the module-level in-flight GET cache and the browser's localStorage,
// both of which `homeworkService.getHomework` touches.
vi.mock("../services/viewCache", () => ({
  clearViewCache: vi.fn(),
  readViewCache: vi.fn(() => null),
  writeViewCache: vi.fn(),
}));

import { homeworkService } from "../services/api";

/** A verbatim `GET /api/homework` body: one full entry, one classwork-only entry. */
const FEED = {
  count: 2,
  homework: [
    {
      id: 1,
      date: "2026-10-13",
      displayDate: "Oct 13, 2026",
      subject: "Mathematics",
      subjectId: 4,
      classId: 12,
      homework: "Complete exercises 1-10.",
      classwork: "Chapter 4 examples.",
      author: { id: 2, displayName: "Test Teacher" },
      attachments: [],
      attachment: null,
      completed: false,
      note: null,
      updatedAt: "2026-10-13T00:00:00.000Z",
    },
    {
      id: 2,
      date: "2026-10-14",
      displayDate: "Oct 14, 2026",
      subject: "Mathematics",
      subjectId: 4,
      classId: 12,
      homework: null,
      classwork: "Diagram one",
      author: { id: 2, displayName: "Test Teacher" },
      attachments: [],
      attachment: null,
      completed: false,
      note: null,
      updatedAt: "2026-10-14T00:00:00.000Z",
    },
  ],
  schoolSessionExpired: false,
  isStale: false,
};

function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("homeworkService.getHomework against the Rust feed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps every entry, including several classwork-only ones on the same day", async () => {
    // The exact regression: three entries sharing one date, two of them classwork-only.
    const sameDay = {
      ...FEED,
      count: 3,
      homework: [
        FEED.homework[0],
        { ...FEED.homework[1], id: 2, classwork: "Diagram one" },
        { ...FEED.homework[1], id: 3, classwork: "Diagram two" },
      ],
    };
    vi.stubGlobal("fetch", stubFetch(sameDay));

    const result = await homeworkService.getHomework("1");

    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.classwork)).toEqual([
      "Chapter 4 examples.",
      "Diagram one",
      "Diagram two",
    ]);
  });

  it("carries the classwork half through instead of dropping it", async () => {
    vi.stubGlobal("fetch", stubFetch(FEED));

    const result = await homeworkService.getHomework("1");

    const classworkOnly = result.items.find((i) => i.id === 2)!;
    expect(classworkOnly.classwork).toBe("Diagram one");
    // The card prints `homework`, so a null becomes the empty string the card already
    // handled -- but the second field must survive for the card to fall back to.
    expect(classworkOnly.homework).toBe("");
    expect(classworkOnly.subject).toBe("Mathematics");
    expect(classworkOnly.date).toBe("2026-10-14");
  });

  it("still dedupes a genuine duplicate rather than showing it twice", async () => {
    const duplicated = {
      ...FEED,
      count: 3,
      homework: [...FEED.homework, { ...FEED.homework[1] }],
    };
    vi.stubGlobal("fetch", stubFetch(duplicated));

    const result = await homeworkService.getHomework("1");

    expect(result.items).toHaveLength(2);
  });

  it("reads the envelope flags the loader branches on", async () => {
    vi.stubGlobal("fetch", stubFetch(FEED));
    const result = await homeworkService.getHomework("1");

    expect(result.schoolSessionExpired).toBe(false);
    expect(result.isStale).toBe(false);
    // `aiPending` is absent from the Rust envelope, which is correct: there is no AI pass.
    expect(result.aiPending).toBeFalsy();
  });

  it("surfaces a 401 with the code the session layer looks for", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ error: "Not authenticated.", code: "UNAUTHENTICATED" }, 401),
    );

    await expect(homeworkService.getHomework("1")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});