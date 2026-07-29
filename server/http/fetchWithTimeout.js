const DEFAULT_HTTP_TIMEOUT_MS = 10000;

function resolveTimeout(value, fallback = DEFAULT_HTTP_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.code = "REQUEST_TIMEOUT";
  return error;
}

function withBodyDeadline(response, cleanup, didTimeOut, timeoutMs) {
  const bodyMethods = new Set([
    "arrayBuffer",
    "blob",
    "formData",
    "json",
    "text",
  ]);
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (!bodyMethods.has(property) || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (err) {
          if (didTimeOut()) throw timeoutError(timeoutMs);
          throw err;
        } finally {
          cleanup();
        }
      };
    },
  });
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
) {
  const resolvedTimeout = resolveTimeout(timeoutMs);
  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort(callerSignal.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }, resolvedTimeout);
  timeout.unref?.();
  const cleanup = () => {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  };

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return withBodyDeadline(response, cleanup, () => timedOut, resolvedTimeout);
  } catch (err) {
    cleanup();
    if (timedOut) {
      throw timeoutError(resolvedTimeout);
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_HTTP_TIMEOUT_MS,
  fetchWithTimeout,
  resolveTimeout,
};
