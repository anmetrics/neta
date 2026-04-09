import { HTTPError } from './errors.js';
import { stop } from './types.js';
import { parseRetryAfter, sleep } from './utils.js';

/**
 * @param {() => Promise<Response>} makeFetch
 * @param {Request} request
 * @param {import('./types.js').NormalizedOptions} options
 * @returns {Promise<Response>}
 */
export async function executeWithRetry(makeFetch, request, options) {
  const { retry } = options;
  let retryCount = 0;
  /** @type {Error | undefined} */
  let lastError;

  while (true) {
    /** @type {Response} */
    let response;

    try {
      response = await makeFetch();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (retryCount >= retry.limit || !retry.methods.includes(options.method)) {
        throw lastError;
      }

      retryCount++;

      for (const hook of options.hooks.beforeRetry) {
        const result = await hook({ request, options, error: lastError, retryCount });
        if (result === stop) throw lastError;
      }

      const delay = Math.min(retry.delay(retryCount), retry.backoffLimit);
      await sleep(delay);
      continue;
    }

    if (
      retry.statusCodes.includes(response.status) &&
      retry.methods.includes(options.method) &&
      retryCount < retry.limit
    ) {
      const retryAfterDelay = parseRetryAfter(response);
      if (retryAfterDelay && retry.maxRetryAfter && retryAfterDelay > retry.maxRetryAfter) {
        return response;
      }

      retryCount++;

      const httpError = new HTTPError(response, request, options);
      for (const hook of options.hooks.beforeRetry) {
        const result = await hook({ request, options, error: httpError, retryCount });
        if (result === stop) return response;
      }

      const delay = retryAfterDelay ?? Math.min(retry.delay(retryCount), retry.backoffLimit);
      await sleep(delay);
      continue;
    }

    return response;
  }
}
