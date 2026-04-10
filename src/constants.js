/** @type {import('../types/types.js').HttpMethod[]} */
export const HTTP_METHODS = [
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
];

/** @type {import('../types/types.js').RetryOptions} */
export const DEFAULT_RETRY = {
  limit: 2,
  methods: ['get', 'put', 'head', 'delete', 'options'],
  statusCodes: [408, 413, 429, 500, 502, 503, 504],
  afterStatusCodes: [413, 429, 503],
  maxRetryAfter: Infinity,
  backoffLimit: Infinity,
  delay: (attemptCount) => 300 * 2 ** (attemptCount - 1),
  jitter: false,
  retryOnTimeout: false,
  shouldRetry: undefined,
};

export const DEFAULT_TIMEOUT = 10_000;

export const maxSafeTimeout = 2_147_483_647; // 2^31 - 1

/** @type {Record<string, string>} */
export const responseTypes = {
  json: 'application/json',
  text: 'text/*',
  formData: 'multipart/form-data',
  arrayBuffer: '*/*',
  blob: '*/*',
  bytes: '*/*',
};

export const supportsAbortController = typeof globalThis.AbortController === 'function';
export const supportsAbortSignal = typeof globalThis.AbortSignal !== 'undefined';
export const supportsFormData = typeof globalThis.FormData === 'function';

export const supportsResponseStreams = (() => {
  try {
    return typeof globalThis.ReadableStream === 'function';
  } catch {
    return false;
  }
})();

export const supportsRequestStreams = (() => {
  try {
    let duplexAccessed = false;
    const hasContentType = new Request(
      new URL('https://empty.invalid'),
      /** @type {RequestInit} */({
        body: new ReadableStream(),
        method: 'POST',
        get duplex() {
          duplexAccessed = true;
          return 'half';
        },
      }),
    ).headers.has('Content-Type');
    return duplexAccessed && !hasContentType;
  } catch {
    return false;
  }
})();
