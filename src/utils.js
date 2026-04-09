import { DEFAULT_RETRY, DEFAULT_TIMEOUT } from './constants.js';

/**
 * @param {import('./types.js').Options['retry']} retry
 * @returns {import('./types.js').RetryOptions}
 */
export function normalizeRetry(retry) {
  if (typeof retry === 'number') {
    return { ...DEFAULT_RETRY, limit: retry };
  }
  return { ...DEFAULT_RETRY, ...retry };
}

/**
 * @param {import('./types.js').Hooks} [hooks]
 * @returns {import('./types.js').NormalizedHooks}
 */
export function normalizeHooks(hooks) {
  return {
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
 * @param {import('./types.js').Options} [defaults]
 * @param {import('./types.js').Options} [overrides]
 * @returns {import('./types.js').Options}
 */
export function mergeOptions(defaults, overrides) {
  if (!defaults) return overrides ?? {};
  if (!overrides) return defaults;

  const merged = { ...defaults, ...overrides };

  if (defaults.headers || overrides.headers) {
    merged.headers = mergeHeaders(defaults.headers, overrides.headers);
  }

  if (defaults.hooks || overrides.hooks) {
    merged.hooks = {
      beforeRequest: [
        ...(defaults.hooks?.beforeRequest ?? []),
        ...(overrides.hooks?.beforeRequest ?? []),
      ],
      afterResponse: [
        ...(defaults.hooks?.afterResponse ?? []),
        ...(overrides.hooks?.afterResponse ?? []),
      ],
      beforeError: [
        ...(defaults.hooks?.beforeError ?? []),
        ...(overrides.hooks?.beforeError ?? []),
      ],
      beforeRetry: [
        ...(defaults.hooks?.beforeRetry ?? []),
        ...(overrides.hooks?.beforeRetry ?? []),
      ],
    };
  }

  return merged;
}

/**
 * @param {string | URL | Request} input
 * @param {string | URL} [prefixUrl]
 * @returns {URL}
 */
export function resolveUrl(input, prefixUrl) {
  const inputStr = input instanceof Request ? input.url : String(input);

  if (prefixUrl) {
    const prefix = String(prefixUrl).replace(/\/$/, '');
    const path = inputStr.replace(/^\//, '');
    return new URL(`${prefix}/${path}`);
  }

  return new URL(inputStr);
}

/**
 * @param {URL} url
 * @param {import('./types.js').SearchParamsInit} [searchParams]
 * @returns {URL}
 */
export function appendSearchParams(url, searchParams) {
  if (!searchParams) return url;

  /** @type {URLSearchParams} */
  let params;

  if (typeof searchParams === 'string') {
    params = new URLSearchParams(searchParams);
  } else if (searchParams instanceof URLSearchParams) {
    params = searchParams;
  } else if (Array.isArray(searchParams)) {
    params = new URLSearchParams(searchParams);
  } else {
    params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      params.set(key, String(value));
    }
  }

  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return url;
}

/**
 * @param {import('./types.js').Options} options
 * @returns {import('./types.js').NormalizedOptions}
 */
export function normalizeOptions(options) {
  const normalized = {
    ...options,
    method: options.method ?? 'get',
    retry: normalizeRetry(options.retry),
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    hooks: normalizeHooks(options.hooks),
    throwHttpErrors: options.throwHttpErrors ?? true,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
  };

  if (options.json !== undefined) {
    normalized.body = JSON.stringify(options.json);
    const headers = new Headers(normalized.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (!headers.has('accept')) {
      headers.set('accept', 'application/json');
    }
    normalized.headers = headers;
  }

  return normalized;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Response} response
 * @returns {number | undefined}
 */
export function parseRetryAfter(response) {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return date - Date.now();
  }

  return undefined;
}
