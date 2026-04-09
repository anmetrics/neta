import { HTTPError, TimeoutError, NetworkError, ForceRetryError, SchemaValidationError } from './errors.js';
import { RetryMarker } from './types.js';
import { stop } from './types.js';
import { streamResponse, streamRequest } from './stream.js';
import {
  appendSearchParams,
  resolveInput,
  delay,
  isNetworkError,
  applyJitter,
  parseRetryAfter,
} from './utils.js';
import {
  maxSafeTimeout,
  responseTypes,
  supportsResponseStreams,
  supportsRequestStreams,
} from './constants.js';

const invalidSchemaMessage = 'The `schema` argument must follow the Standard Schema specification';

/**
 * @param {unknown} jsonValue
 * @param {any} schema
 * @returns {Promise<unknown>}
 */
async function validateJsonWithSchema(jsonValue, schema) {
  if ((typeof schema !== 'object' && typeof schema !== 'function') || schema === null) {
    throw new TypeError(invalidSchemaMessage);
  }

  const standardSchema = schema['~standard'];
  if (
    typeof standardSchema !== 'object' ||
    standardSchema === null ||
    typeof standardSchema.validate !== 'function'
  ) {
    throw new TypeError(invalidSchemaMessage);
  }

  const result = await standardSchema.validate(jsonValue);
  if (result.issues) {
    throw new SchemaValidationError(result.issues);
  }

  return result.value;
}

/**
 * @param {number | false} timeout
 * @param {AbortSignal} [userSignal]
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
function createManagedSignal(timeout, userSignal) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  if (timeout !== false && typeof timeout === 'number') {
    timer = setTimeout(() => controller.abort('timeout'), timeout);
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Read response text with timeout and size limit.
 * @param {Response} response
 * @param {number} timeoutMs
 * @returns {Promise<string | undefined>}
 */
async function readResponseText(response, timeoutMs) {
  const { body } = response;
  if (!body) {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }

  /** @type {ReadableStreamDefaultReader<Uint8Array>} */
  let reader;
  try {
    reader = body.getReader();
  } catch {
    return undefined;
  }

  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;
  const maxSize = 10 * 1024 * 1024;

  const readAll = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxSize) {
          void reader.cancel().catch(() => {});
          return undefined;
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      return undefined;
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  })();

  const timeoutPromise = new Promise((resolve) => {
    const id = setTimeout(() => resolve(undefined), timeoutMs);
    void readAll.finally(() => clearTimeout(id));
  });

  const result = await Promise.race([readAll, timeoutPromise]);
  if (result === undefined) void reader.cancel().catch(() => {});
  return result;
}

/**
 * @param {Response} response
 * @param {number} timeoutMs
 * @param {any} options
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
async function getResponseData(response, timeoutMs, options, request) {
  const text = await readResponseText(response, timeoutMs);
  if (!text) return undefined;

  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  const isJson = /\/(?:.*[.+-])?json$/.test(contentType);
  if (!isJson) return text;

  try {
    return options.parseJson
      ? await options.parseJson(text, { request, response })
      : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Strip internal-only options.
 * @param {any} options
 * @returns {any}
 */
function getNormalizedOptions(options) {
  const {
    hooks, json, parseJson, stringifyJson, searchParams,
    timeout, totalTimeout, throwHttpErrors, fetch,
    context, _userSignal, prefix, baseUrl,
    onDownloadProgress, onUploadProgress,
    ...rest
  } = options;
  return Object.freeze(rest);
}

/**
 * Calculate retry delay.
 * @param {any} retry
 * @param {number} retryCount
 * @returns {number}
 */
function calculateDelay(retry, retryCount) {
  const base = retry.delay(retryCount);
  const jittered = applyJitter(base, retry.jitter);
  return Math.min(retry.backoffLimit, jittered);
}

/**
 * @param {string | URL | Request} input
 * @param {any} options
 * @returns {any}
 */
export function createResponsePromise(input, options) {
  // Run init hooks (synchronous, mutate options clone)
  for (const hook of options.hooks.init) {
    hook(options);
  }

  let retryCount = 0;
  const startTime = typeof options.totalTimeout === 'number' ? performance.now() : undefined;
  /** @type {Request} */
  let currentRequest;

  const getRemainingTotalTimeout = () => {
    if (startTime === undefined) return undefined;
    const elapsed = performance.now() - startTime;
    return Math.max(0, options.totalTimeout - elapsed);
  };

  const getEffectiveTimeout = () => {
    const remaining = getRemainingTotalTimeout();
    if (options.timeout === false) return remaining;
    if (remaining === undefined) return options.timeout;
    return Math.min(options.timeout, remaining);
  };

  const throwIfTotalTimeoutExhausted = () => {
    const remaining = getRemainingTotalTimeout();
    if (remaining !== undefined && remaining <= 0) {
      throw new TimeoutError(currentRequest);
    }
  };

  const innerPromise = (async () => {
    if (typeof options.timeout === 'number' && options.timeout > maxSafeTimeout) {
      throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
    }
    if (typeof options.totalTimeout === 'number' && options.totalTimeout > maxSafeTimeout) {
      throw new RangeError(`The \`totalTimeout\` option cannot be greater than ${maxSafeTimeout}`);
    }

    // Resolve URL
    const inputStr = resolveInput(input, { prefix: options.prefix, baseUrl: options.baseUrl });
    let url = new URL(inputStr);
    url = appendSearchParams(url, options.searchParams);

    // Build request init (strip neta-specific options)
    const {
      prefix: _prefix, baseUrl: _baseUrl, retry, timeout, totalTimeout,
      hooks, searchParams, json, throwHttpErrors, fetch: fetchFn,
      parseJson, stringifyJson, context, _userSignal,
      onDownloadProgress, onUploadProgress,
      ...requestInit
    } = options;

    currentRequest = new Request(url.href, {
      ...requestInit,
      method: options.method.toUpperCase(),
    });

    // Defer so body shortcuts can set Accept header
    await Promise.resolve();

    // beforeRequest hooks
    for (const hook of hooks.beforeRequest) {
      const result = await hook({
        request: currentRequest,
        options: getNormalizedOptions(options),
        retryCount: 0,
      });

      if (result instanceof Response) return result;
      if (result instanceof Request) currentRequest = result;
    }

    const userSignal = options._userSignal;

    /**
     * Perform a single fetch attempt with timeout.
     * @returns {Promise<Response>}
     */
    const doFetch = async () => {
      const effectiveTimeout = getEffectiveTimeout();
      const remaining = getRemainingTotalTimeout();
      if (remaining !== undefined && remaining <= 0) throw new TimeoutError(currentRequest);

      const managed = createManagedSignal(effectiveTimeout, userSignal);

      let fetchRequest = currentRequest.clone();
      if (onUploadProgress && fetchRequest.body && supportsRequestStreams) {
        fetchRequest = streamRequest(fetchRequest, onUploadProgress, options.body);
      }

      try {
        const response = await fetchFn(fetchRequest, { signal: managed.signal });
        managed.cleanup();
        return response;
      } catch (error) {
        managed.cleanup();
        if (managed.signal.aborted && managed.signal.reason === 'timeout') {
          throw new TimeoutError(currentRequest);
        }
        if (isNetworkError(error)) {
          throw new NetworkError(currentRequest, { cause: error });
        }
        throw error;
      }
    };

    /**
     * Attempt retry: wait, run beforeRetry hooks, then fetch again.
     * @param {Error} error
     * @param {number} delayMs
     * @returns {Promise<Response | typeof stop>}
     */
    const attemptRetry = async (error, delayMs) => {
      const safeDelay = Math.min(delayMs, maxSafeTimeout);
      const delayOptions = { signal: userSignal };

      const remaining = getRemainingTotalTimeout();
      if (remaining !== undefined) {
        if (remaining <= 0) throw new TimeoutError(currentRequest);
        if (safeDelay >= remaining) {
          await delay(remaining, delayOptions);
          throw new TimeoutError(currentRequest);
        }
      }

      await delay(safeDelay, delayOptions);
      throwIfTotalTimeoutExhausted();

      // Run beforeRetry hooks
      for (const hook of hooks.beforeRetry) {
        const result = await hook({
          request: currentRequest,
          options: getNormalizedOptions(options),
          error,
          retryCount: retryCount + 1,
        });

        if (result instanceof Request) { currentRequest = result; break; }
        if (result instanceof Response) { retryCount++; return result; }
        if (result === stop) return stop;
      }

      throwIfTotalTimeoutExhausted();
      retryCount++;
      return doFetch();
    };

    /**
     * Check if we should retry a fetch-level error (timeout, network).
     * @param {Error} error
     * @returns {Promise<number>} delay in ms, or throws if no retry
     */
    const getRetryDelayForFetchError = async (error) => {
      if (retryCount >= retry.limit) throw error;
      if (!retry.methods.includes(options.method)) throw error;

      if (retry.shouldRetry !== undefined) {
        const result = await retry.shouldRetry({ error, retryCount: retryCount + 1 });
        if (result === false) throw error;
        if (result === true) return calculateDelay(retry, retryCount + 1);
      }

      if (error instanceof TimeoutError) {
        if (!retry.retryOnTimeout) throw error;
        return calculateDelay(retry, retryCount + 1);
      }

      if (error instanceof NetworkError) {
        return calculateDelay(retry, retryCount + 1);
      }

      throw error;
    };

    /**
     * Check if we should retry an HTTP error.
     * @param {HTTPError} error
     * @returns {Promise<number>} delay in ms, or throws if no retry
     */
    const getRetryDelayForHttpError = async (error) => {
      if (retryCount >= retry.limit) throw error;
      if (!retry.methods.includes(options.method)) throw error;

      if (retry.shouldRetry !== undefined) {
        const result = await retry.shouldRetry({ error, retryCount: retryCount + 1 });
        if (result === false) throw error;
        if (result === true) return calculateDelay(retry, retryCount + 1);
      }

      if (!retry.statusCodes.includes(error.response.status)) throw error;

      // Handle Retry-After
      if (retry.afterStatusCodes.includes(error.response.status)) {
        const retryAfter = parseRetryAfter(error.response);
        if (retryAfter !== undefined) {
          return Math.min(retry.maxRetryAfter, Math.max(0, retryAfter));
        }
      }

      if (error.response.status === 413) throw error;

      return calculateDelay(retry, retryCount + 1);
    };

    // === Main request loop ===
    /** @type {Response} */
    let response;

    // Initial fetch with fetch-error retry loop
    for (;;) {
      try {
        response = await doFetch();
        break;
      } catch (error) {
        const retryDelay = await getRetryDelayForFetchError(error);
        const retryResult = await attemptRetry(error, retryDelay);
        if (retryResult === stop) return undefined;
        if (retryResult instanceof Response) { response = retryResult; break; }
      }
    }

    // afterResponse hooks + HTTP error retry loop
    let responseFromHook = false;

    for (;;) {
      // Run afterResponse hooks
      try {
        for (const hook of hooks.afterResponse) {
          const clonedResponse = response.clone();
          const hookResult = await hook({
            request: currentRequest,
            options: getNormalizedOptions(options),
            response: clonedResponse,
            retryCount,
          });

          if (hookResult instanceof RetryMarker) {
            throw new ForceRetryError(hookResult.options);
          }

          if (hookResult instanceof Response) {
            response = hookResult;
          }
        }
      } catch (error) {
        if (!(error instanceof ForceRetryError)) throw error;

        // Forced retry from afterResponse hook
        const retryDelay = error.customDelay ?? calculateDelay(retry, retryCount + 1);
        if (error.customRequest) currentRequest = error.customRequest;
        const retryResult = await attemptRetry(error, retryDelay);
        if (retryResult === stop) return undefined;
        if (retryResult instanceof Response) {
          response = retryResult;
          responseFromHook = true;
          continue;
        }
        continue;
      }

      // Check HTTP errors
      const shouldThrow = typeof throwHttpErrors === 'function'
        ? throwHttpErrors(response.status)
        : throwHttpErrors;

      if (!response.ok && response.type !== 'opaque' && shouldThrow) {
        const error = new HTTPError(response, currentRequest, getNormalizedOptions(options));
        error.data = await getResponseData(
          response,
          options.timeout === false ? 10_000 : options.timeout,
          options,
          currentRequest,
        );

        if (responseFromHook) throw error;

        // Try to retry
        let retryDelay;
        try {
          retryDelay = await getRetryDelayForHttpError(error);
        } catch {
          // Run beforeError hooks, then throw
          let processedError = error;
          for (const hook of hooks.beforeError) {
            const hookResult = await hook({
              request: currentRequest,
              options: getNormalizedOptions(options),
              error: processedError,
              retryCount,
            });
            if (hookResult instanceof Error) processedError = hookResult;
          }
          throw processedError;
        }

        const retryResult = await attemptRetry(error, retryDelay);
        if (retryResult === stop) return undefined;
        if (retryResult instanceof Response) {
          response = retryResult;
          responseFromHook = false; // Allow further retries
          continue;
        }
        continue;
      }

      break;
    }

    // Decorate response with custom parseJson
    if (options.parseJson) {
      response.json = async () => {
        const text = await response.clone().text();
        if (text === '') return JSON.parse(text);
        return options.parseJson(text, { request: currentRequest, response });
      };
    }

    // Handle download progress
    if (onDownloadProgress) {
      if (typeof onDownloadProgress !== 'function') {
        throw new TypeError('The `onDownloadProgress` option must be a function');
      }
      if (!supportsResponseStreams) {
        throw new Error('Streams are not supported. `ReadableStream` is missing.');
      }
      return streamResponse(response, onDownloadProgress);
    }

    return response;
  })();

  // Build ResponsePromise thenable
  /** @type {any} */
  const responsePromise = {
    then: innerPromise.then.bind(innerPromise),
    catch: innerPromise.catch.bind(innerPromise),
    finally: innerPromise.finally.bind(innerPromise),
    [Symbol.toStringTag]: 'ResponsePromise',
  };

  for (const [type, mimeType] of Object.entries(responseTypes)) {
    responsePromise[type] = async (schema) => {
      if (currentRequest) {
        currentRequest.headers.set('accept', currentRequest.headers.get('accept') || mimeType);
      }

      const response = await innerPromise;
      if (type !== 'json') return response[type]();

      const text = await response.text();
      if (text === '') {
        if (schema !== undefined) return validateJsonWithSchema(undefined, schema);
        return JSON.parse(text);
      }

      const jsonValue = options.parseJson
        ? await options.parseJson(text, { request: currentRequest, response })
        : JSON.parse(text);

      return schema === undefined ? jsonValue : validateJsonWithSchema(jsonValue, schema);
    };
  }

  return responsePromise;
}
