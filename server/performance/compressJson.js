const crypto = require("crypto");
const zlib = require("zlib");

/**
 * Gzips JSON responses that are large enough to be worth it.
 *
 * Only res.json is wrapped, so file downloads and streamed responses keep their
 * existing handling. Compression is asynchronous so a large payload never
 * blocks the event loop for every other request, and a weak ETag lets a client
 * that already holds the same payload get a bodyless 304.
 */
function compressJsonResponses({ threshold = 1024 } = {}) {
  return function compressJson(req, res, next) {
    const acceptsGzip = /\bgzip\b/i.test(req.headers["accept-encoding"] || "");
    if (!acceptsGzip || req.method === "HEAD") return next();

    const sendJson = res.json.bind(res);
    res.json = (body) => {
      let payload;
      try {
        payload = Buffer.from(JSON.stringify(body === undefined ? null : body));
      } catch {
        return sendJson(body);
      }

      if (payload.length < threshold || res.getHeader("Content-Encoding")) {
        return sendJson(body);
      }

      res.setHeader("Vary", res.getHeader("Vary") ? `${res.getHeader("Vary")}, Accept-Encoding` : "Accept-Encoding");

      if (req.method === "GET" && res.statusCode === 200 && !res.getHeader("ETag")) {
        const digest = crypto.createHash("sha1").update(payload).digest("base64");
        res.setHeader("ETag", `W/"${payload.length.toString(16)}-${digest}"`);
        if (req.fresh) {
          res.statusCode = 304;
          return res.end();
        }
      }

      zlib.gzip(payload, { level: 4 }, (err, compressed) => {
        if (err) {
          console.error("Response compression failed:", err.message);
          return sendJson(body);
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", String(compressed.length));
        res.end(compressed);
      });
      return res;
    };

    next();
  };
}

module.exports = { compressJsonResponses };
