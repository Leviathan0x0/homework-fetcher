const test = require("node:test");
const assert = require("node:assert/strict");

const columnsByTable = {
  users: [
    "id",
    "student_id",
    "display_name",
    "section",
    "created_at",
    "updated_at",
  ],
  messages: [
    "id",
    "conversation_id",
    "sender_id",
    "reply_to_id",
    "content",
    "attachment_url",
    "original_filename",
    "mime_type",
    "file_path",
    "created_at",
  ],
  conversations: [
    "id",
    "type",
    "section",
    "last_message_preview",
    "last_message_at",
    "pinned_homework_id",
    "created_at",
    "updated_at",
  ],
  conversation_participants: [
    "id",
    "conversation_id",
    "user_id",
    "last_read_at",
    "muted",
    "created_at",
  ],
};

function executeResult(sql) {
  const tableMatch = sql.match(/pragma_table_info\('([^']+)'\)/);
  const values = tableMatch ? columnsByTable[tableMatch[1]] || [] : [];
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: tableMatch ? [{ name: "name" }] : [],
        rows: values.map((value) => [{ type: "text", value }]),
        affected_row_count: /^\s*insert\b/i.test(sql) ? 1 : 0,
      },
    },
  };
}

test("remote startup batches schema and migration checks", async () => {
  process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
  process.env.TURSO_AUTH_TOKEN = "token";
  const calls = [];
  global.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload.requests);
    return {
      ok: true,
      json: async () => ({
        results: payload.requests.map((request) =>
          request.type === "execute"
            ? executeResult(request.stmt.sql)
            : { type: "ok", response: { type: "close" } },
        ),
      }),
      text: async () => "",
    };
  };

  const { db, ready, schema } = require("../server/db/client");
  await ready;

  assert.equal(calls.length, 3);
  assert.ok(
    calls[0].filter((request) => request.type === "execute").length > 30,
  );
  assert.equal(
    calls[1].filter((request) => request.type === "execute").length,
    4,
  );
  assert.equal(
    calls[2].filter((request) => request.type === "execute").length,
    5,
  );

  const insertResult = await db
    .insert(schema.users)
    .values({
      id: "user-1",
      studentId: "student-1",
      section: "10-A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  assert.equal(insertResult.rowsAffected, 1);
});
