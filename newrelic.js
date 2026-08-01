"use strict";

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || "homework-fetcher"],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: {
    enabled: true,
  },
  application_logging: {
    forwarding: {
      enabled: true,
    },
    metrics: {
      enabled: true,
    },
    local_decorating: {
      enabled: true,
    },
  },
  attributes: {
    exclude: [
      "request.headers.*",
      "request.parameters.*",
      "request.body.*",
      "response.headers.set-cookie",
    ],
  },
};
