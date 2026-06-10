
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    status === 429 ||
    status >= 500 ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("network") ||
    message.includes("temporarily") ||
    message.includes("fetch failed")
  );
}

export async function withRetry(fn, {
  retries = 2,
  baseDelayMs = 450,
  maxDelayMs = 2500,
  shouldRetry = isRetryableError,
  onRetry = null
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      if (onRetry) {
        try { onRetry({ attempt: attempt + 1, delay, error }); } catch {}
      }
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function fetchJsonWithRetry(url, options = {}, {
  retries = 2,
  timeoutMs = 15000,
  label = "external_request",
  trace = null,
  traceStep = null
} = {}) {
  return withRetry(async ({ attempt }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (traceStep) traceStep(trace, `${label.toUpperCase()}_ATTEMPT`, { attempt: attempt + 1, url });
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(data?.error?.message || data?.message || `${label} failed`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return { response, data };
    } finally {
      clearTimeout(timer);
    }
  }, {
    retries,
    onRetry: ({ attempt, delay, error }) => {
      if (traceStep) traceStep(trace, `${label.toUpperCase()}_RETRY`, { attempt, delay, error: error?.message || error });
    }
  });
}
