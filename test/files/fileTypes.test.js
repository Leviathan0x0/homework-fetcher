const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyDownloadHeaders,
  resolveUploadType,
} = require("../../server/files/fileTypes");

test("accepts DOCX uploads while keeping legacy Word files blocked", () => {
  assert.deepEqual(resolveUploadType("class-notes.DOCX"), {
    ext: ".docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  assert.equal(resolveUploadType("legacy-notes.doc"), null);
});

test("serves DOCX as a download-only document for client-side preview", () => {
  const headers = new Map();
  applyDownloadHeaders(
    { setHeader: (name, value) => headers.set(name, value) },
    {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "class notes.docx",
      head: Buffer.from("PK\u0003\u0004"),
    }
  );

  assert.equal(headers.get("Content-Type"), "application/octet-stream");
  assert.match(headers.get("Content-Disposition"), /^attachment;/);
});
