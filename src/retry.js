import { HTTPError, TimeoutError, ForceRetryError, NetworkError } from './errors.js';
import { stop } from './types.js';
import { applyJitter, delay, isNetworkError, parseRetryAfter } from './utils.js';

/**
 * Calculate retry delay with jitter and backoff.
 * @param {import('../types/types.js').RetryOptions} retry
 * @param {number} retryCount
 * @returns {number}
 */
function calculateDelay(retry, retryCount) {
  const base = retry.delay(retryCount);
  const jittered = applyJitter(base, retry.jitter);
  return Math.min(retry.backoffLimit, jittered);
}

/**
 * Determine if and how long to wait before retrying.
 * Returns delay in ms, or throws if retry should not happen.
 *
 * @param {unknown} error
 * @param {import('../types/types.js').RetryOptions} retry
 * @param {number} retryCount
 * @param {string} method
 * @returns {Promise<number>}
 */
async function calculateRetryDelay(error, retry, retryCount, method) {
  if (retryCount >= retry.limit) {
    throw error;
  }

  // ForceRetryError always retries (from afterResponse hook)
  if (error instanceof ForceRetryError) {
    return error.customDelay ?? calculateDelay(retry, retryCount + 1);
  }

  // Check if method is retriable
  if (!retry.methods.includes(method)) {
    throw error;
  }

  // User-provided shouldRetry takes precedence
  if (retry.shouldRetry !== undefined) {
    const result = await retry.shouldRetry({
      error: error instanceof Error ? error : new Error(String(error)),
      retryCount: retryCount + 1,
    });

    if (result === false) throw error;
    if (result === true) return calculateDelay(retry, retryCount + 1);
    // undefined => fall through to defaults
  }

  // Timeout errors
  if (error instanceof TimeoutError) {
    if (!retry.retryOnTimeout) throw error;
    return calculateDelay(retry, retryCount + 1);
  }

  // HTTP errors
  if (error instanceof HTTPError) {
    if (!retry.statusCodes.includes(error.response.status)) {
      throw error;
    }

    // Handle Retry-After headers
    if (retry.afterStatusCodes.includes(error.response.status)) {
      const retryAfter = parseRetryAfter(error.response);
      if (retryAfter !== undefined) {
        // Don't apply jitter when server provides explicit timing
        return Math.min(retry.maxRetryAfter, Math.max(0, retryAfter));
      }
    }

    if (error.response.status === 413) throw error;

    return calculateDelay(retry, retryCount + 1);
  }

  // Network errors
  if (error instanceof NetworkError || isNetworkError(error)) {
    return calculateDelay(retry, retryCount + 1);
  }

  // Unknown errors - don't retry
  throw error;
}

/**
 * @param {() => Promise<Response>} makeFetch
 * @param {Request} request
 * @param {import('../types/types.js').InternalOptions} options
 * @param {{ getRetryCount: () => number, setRetryCount: (n: number) => void, getStartTime: () => number | undefined }} state
 * @returns {Promise<Response>}
 */
export async function executeWithRetry(makeFetch, request, options, state) {
  const { retry } = options;

  try {
    return await makeFetch();
  } catch (error) {
    return retryFromError(error, makeFetch, request, options, state);
  }
}

/**
 * @param {unknown} error
 * @param {() => Promise<Response>} makeFetch
 * @param {Request} request
 * @param {import('../types/types.js').InternalOptions} options
 * @param {{ getRetryCount: () => number, setRetryCount: (n: number) => void, getStartTime: () => number | undefined, consumeBeforeRetryResponse: () => boolean }} state
 * @returns {Promise<Response | void>}
 */
export async function retryFromError(error, makeFetch, request, options, state) {
  const { retry } = options;
  const retryCount = state.getRetryCount();

  const retryDelay = await calculateRetryDelay(error, retry, retryCount, options.method);

  const delayOptions = { signal: options._userSignal };

  // Check totalTimeout budget
  const startTime = state.getStartTime();
  if (startTime !== undefined && typeof options.totalTimeout === 'number') {
    const elapsed = performance.now() - startTime;
    const remaining = options.totalTimeout - elapsed;

    if (remaining <= 0) throw new TimeoutError(request);
    if (retryDelay >= remaining) {
      await delay(remaining, delayOptions);
      throw new TimeoutError(request);
    }
  }

  await delay(retryDelay, delayOptions);

  // Apply custom request from ForceRetryError
  if (error instanceof ForceRetryError && error.customRequest) {
    request = error.customRequest;
  }

  // Run beforeRetry hooks
  for (const hook of options.hooks.beforeRetry) {
    const result = await hook({
      request,
      options: getNormalizedOptions(options),
      error: error instanceof Error ? error : new Error(String(error)),
      retryCount: retryCount + 1,
    });

    if (result instanceof Request) {
      request = result;
      break;
    }

    if (result instanceof Response) {
      state.setRetryCount(retryCount + 1);
      return result;
    }

    if (result === stop) return undefined;
  }

  state.setRetryCount(retryCount + 1);

  try {
    return await makeFetch();
  } catch (retryError) {
    return retryFromError(retryError, makeFetch, request, options, state);
  }
}

/**
 * Strip internal options to produce NormalizedOptions for hooks.
 * @param {import('../types/types.js').InternalOptions} options
 * @returns {import('../types/types.js').NormalizedOptions}
 */
function getNormalizedOptions(options) {
  const {
    hooks, json, parseJson, stringifyJson, searchParams,
    timeout, totalTimeout, throwHttpErrors, fetch,
    context, _userSignal, ...rest
  } = options;
  return Object.freeze(rest);
}
