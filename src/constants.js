/** @type {import('./types.js').HttpMethod[]} */
export const HTTP_METHODS = [
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
];

/** @type {import('./types.js').RetryOptions} */
export const DEFAULT_RETRY = {
  limit: 2,
  methods: ['get', 'put', 'head', 'delete', 'options'],
  statusCodes: [408, 413, 429, 500, 502, 503, 504],
  afterStatusCodes: [413, 429, 503],
  maxRetryAfter: undefined,
  backoffLimit: Infinity,
  delay: (attemptCount) => 300 * 2 ** (attemptCount - 1),
};

export const DEFAULT_TIMEOUT = 10_000;
