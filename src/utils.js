import { DEFAULT_RETRY, DEFAULT_TIMEOUT } from './constants.js';

/**
 * @param {import('../types/types.js').Options['retry']} retry
 * @returns {import('../types/types.js').RetryOptions}
 */
export function normalizeRetry(retry) {
  if (typeof retry === 'number') {
    return { ...DEFAULT_RETRY, limit: retry };
  }
  return { ...DEFAULT_RETRY, ...retry };
}

/**
 * @param {import('../types/types.js').Hooks} [hooks]
 * @returns {import('../types/types.js').NormalizedHooks}
 */
export function normalizeHooks(hooks) {
  return {
    init: [...(hooks?.init ?? [])],
    beforeRequest: [...(hooks?.beforeRequest ?? [])],
    afterResponse: [...(hooks?.afterResponse ?? [])],
    beforeError: [...(hooks?.beforeError ?? [])],
    beforeRetry: [...(hooks?.beforeRetry ?? [])],
  };
}

/**
 * @param {HeadersInit} [target]
 * @param {HeadersInit} [source]
 * @returns {Headers}
 */
export function mergeHeaders(target, source) {
  const result = new Headers(target);
  if (source) {
    const sourceHeaders = new Headers(source);
    sourceHeaders.forEach((value, key) => {
      result.set(key, value);
    });
  }
  return result;
}

/**
 * Merge hooks by concatenating arrays.
 * @param {import('../types/types.js').Hooks} [base]
 * @param {import('../types/types.js').Hooks} [override]
 * @returns {import('../types/types.js').Hooks}
 */
export function mergeHooks(base, override) {
  return {
    init: [...(base?.init ?? []), ...(override?.init ?? [])],
    beforeRequest: [...(base?.beforeRequest ?? []), ...(override?.beforeRequest ?? [])],
    afterResponse: [...(base?.afterResponse ?? []), ...(override?.afterResponse ?? [])],
    beforeError: [...(base?.beforeError ?? []), ...(override?.beforeError ?? [])],
    beforeRetry: [...(base?.beforeRetry ?? []), ...(override?.beforeRetry ?? [])],
  };
}

/**
 * @param {import('../types/types.js').Options} [defaults]
 * @param {import('../types/types.js').Options} [overrides]
 * @returns {import('../types/types.js').Options}
 */
export function mergeOptions(defaults, overrides) {
  if (!defaults) return overrides ?? {};
  if (!overrides) return defaults;

  const merged = { ...defaults, ...overrides };

  if (defaults.headers || overrides.headers) {
    merged.headers = mergeHeaders(defaults.headers, overrides.headers);
  }

  if (defaults.hooks || overrides.hooks) {
    merged.hooks = mergeHooks(defaults.hooks, overrides.hooks);
  }

  return merged;
}

/**
 * @param {string | URL | Request} input
 * @param {{ prefix?: string, baseUrl?: string | URL }} [options]
 * @returns {string}
 */
export function resolveInput(input, options) {
  let inputStr = input instanceof Request ? input.url : String(input);

  if (options?.prefix) {
    const prefix = String(options.prefix).replace(/\/+$/, '');
    const path = inputStr.replace(/^\/+/, '');
    inputStr = `${prefix}/${path}`;
  }

  if (options?.baseUrl) {
    try {
      // If already absolute, keep as-is
      new URL(inputStr);
    } catch {
      // Relative — resolve against baseUrl
      inputStr = new URL(inputStr, new Request(String(options.baseUrl)).url).href;
    }
  }

  return inputStr;
}

/**
 * @param {URL} url
 * @param {import('../types/types.js').SearchParamsInit} [searchParams]
 * @returns {URL}
 */
export function appendSearchParams(url, searchParams) {
  if (!searchParams) return url;

  if (typeof searchParams === 'string') {
    const cleaned = searchParams.replace(/^\?/, '');
    if (cleaned) {
      url.search = url.search ? `${url.search}&${cleaned}` : `?${cleaned}`;
    }
    return url;
  }

  /** @type {URLSearchParams} */
  let params;

  if (searchParams instanceof URLSearchParams) {
    params = searchParams;
  } else if (Array.isArray(searchParams)) {
    params = new URLSearchParams(searchParams);
  } else {
    params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
  }

  params.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  return url;
}

/**
 * @param {import('../types/types.js').Options} options
 * @returns {import('../types/types.js').InternalOptions}
 */
export function normalizeOptions(options) {
  const normalized = {
    ...options,
    method: normalizeRequestMethod(options.method ?? 'get'),
    retry: normalizeRetry(options.retry),
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    totalTimeout: options.totalTimeout ?? false,
    hooks: normalizeHooks(options.hooks),
    throwHttpErrors: options.throwHttpErrors ?? true,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    context: options.context ?? {},
    prefix: options.prefix ? String(options.prefix) : '',
  };

  if (options.bearerToken !== undefined) {
    const headers = new Headers(normalized.headers);
    if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${options.bearerToken}`);
    }
    normalized.headers = headers;
  }

  if (options.json !== undefined) {
    normalized.body = normalized.stringifyJson
      ? normalized.stringifyJson(options.json)
      : JSON.stringify(options.json);
    const headers = new Headers(normalized.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    normalized.headers = headers;
  }

  return normalized;
}

/**
 * @param {string} [method]
 * @returns {string}
 */
export function normalizeRequestMethod(method) {
  return (method ?? 'get').toLowerCase();
}

/**
 * @param {number} ms
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
export function delay(ms, options) {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;

    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
  });
}

/**
 * Parse Retry-After from multiple common header formats.
 * @param {Response} response
 * @returns {number | undefined}
 */
export function parseRetryAfter(response) {
  const header =
    response.headers.get('retry-after') ??
    response.headers.get('ratelimit-reset') ??
    response.headers.get('x-ratelimit-retry-after') ??
    response.headers.get('x-ratelimit-reset') ??
    response.headers.get('x-rate-limit-reset');

  if (!header) return undefined;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    // Large numbers are treated as timestamps (threshold: 2024-01-01 epoch)
    if (seconds >= Date.parse('2024-01-01') / 1000) {
      return Math.max(0, seconds * 1000 - Date.now());
    }
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

/**
 * Apply jitter to a delay value.
 * @param {number} delayMs
 * @param {boolean | ((delay: number) => number)} jitter
 * @returns {number}
 */
export function applyJitter(delayMs, jitter) {
  if (jitter === true) {
    return Math.random() * delayMs;
  }
  if (typeof jitter === 'function') {
    const result = jitter(delayMs);
    return Number.isFinite(result) && result >= 0 ? result : delayMs;
  }
  return delayMs;
}

/**
 * Check if error is a raw network error (TypeError from fetch).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNetworkError(error) {
  return (
    error instanceof TypeError &&
    (error.message === 'Failed to fetch' ||
      error.message === 'fetch failed' ||
      error.message === 'NetworkError when attempting to fetch resource.' ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNRESET'))
  );
}
