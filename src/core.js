import { HTTPError, TimeoutError, NetworkError, ForceRetryError, SchemaValidationError } from './errors.js';
import { executeWithRetry, retryFromError } from './retry.js';
import { RetryMarker } from './types.js';
import { streamResponse, streamRequest } from './stream.js';
import {
  appendSearchParams,
  resolveInput,
  delay,
  isNetworkError,
} from './utils.js';
import {
  maxSafeTimeout,
  responseTypes,
  supportsAbortController,
  supportsAbortSignal,
  supportsResponseStreams,
  supportsRequestStreams,
  supportsFormData,
} from './constants.js';

const invalidSchemaMessage = 'The `schema` argument must follow the Standard Schema specification';

/**
 * @param {unknown} jsonValue
 * @param {import('../types/types.js').StandardSchema} schema
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
 * @returns {{ signal: AbortSignal, cleanup: () => void, controller: AbortController }}
 */
function createManagedSignal(timeout, userSignal) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  if (timeout !== false && typeof timeout === 'number') {
    timer = setTimeout(() => controller.abort('timeout'), timeout);
  }

  // Combine with user signal
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true });
    }
  }

  return {
    signal: controller.signal,
    controller,
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
  const maxSize = 10 * 1024 * 1024; // 10MB

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
  if (result === undefined) {
    void reader.cancel().catch(() => {});
  }

  return result;
}

/**
 * Get response data (for HTTPError.data).
 * @param {Response} response
 * @param {number} timeoutMs
 * @param {import('../types/types.js').InternalOptions} options
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
 * Strip internal-only options to produce NormalizedOptions for hooks.
 * @param {import('../types/types.js').InternalOptions} options
 * @returns {import('../types/types.js').NormalizedOptions}
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
 * @param {string | URL | Request} input
 * @param {import('../types/types.js').InternalOptions} options
 * @returns {import('../types/types.js').ResponsePromise}
 */
export function createResponsePromise(input, options) {
  // Run init hooks (synchronous, mutate options clone)
  for (const hook of options.hooks.init) {
    hook(options);
  }

  let retryCount = 0;
  const startTime = typeof options.totalTimeout === 'number' ? performance.now() : undefined;
  let currentRequest;
  let abortController;
  const beforeRetryHookErrors = new WeakSet();

  const state = {
    getRetryCount: () => retryCount,
    setRetryCount: (n) => { retryCount = n; },
    getStartTime: () => startTime,
  };

  const innerPromise = (async () => {
    // Validate timeouts
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

    // Build request init
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

    // beforeRequest hooks
    await Promise.resolve(); // Defer so body shortcuts can set Accept header
    for (const hook of hooks.beforeRequest) {
      const result = await hook({
        request: currentRequest,
        options: getNormalizedOptions(options),
        retryCount: 0,
      });

      if (result instanceof Response) {
        return result;
      }

      if (result instanceof Request) {
        currentRequest = result;
      }
    }

    // Setup abort/timeout
    const userSignal = options._userSignal;

    const getEffectiveTimeout = () => {
      const remaining = getRemainingTotalTimeout();
      if (options.timeout === false) return remaining;
      if (remaining === undefined) return options.timeout;
      return Math.min(options.timeout, remaining);
    };

    const getRemainingTotalTimeout = () => {
      if (startTime === undefined) return undefined;
      const elapsed = performance.now() - startTime;
      return Math.max(0, /** @type {number} */ (options.totalTimeout) - elapsed);
    };

    const makeFetch = async () => {
      // Reset abort controller for retries
      const effectiveTimeout = getEffectiveTimeout();
      const remaining = getRemainingTotalTimeout();

      if (remaining !== undefined && remaining <= 0) {
        throw new TimeoutError(currentRequest);
      }

      const managed = createManagedSignal(effectiveTimeout, userSignal);
      abortController = managed.controller;

      // Handle upload progress
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

    // Execute with retry
    let response = await executeWithRetry(makeFetch, currentRequest, options, state);

    if (!(response instanceof Response)) return response;

    let responseFromHook = false;

    // afterResponse hooks (with ForceRetry support)
    for (;;) {
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

        const retriedResponse = await retryFromError(error, makeFetch, currentRequest, options, state);
        if (!(retriedResponse instanceof Response)) return retriedResponse;
        response = retriedResponse;
        responseFromHook = true;
        continue;
      }

      // Throw on HTTP errors
      const shouldThrow = typeof throwHttpErrors === 'function'
        ? throwHttpErrors(response.status)
        : throwHttpErrors;

      if (!response.ok && response.type !== 'opaque' && shouldThrow) {
        const error = new HTTPError(response, currentRequest, getNormalizedOptions(options));
        error.data = await getResponseData(
          response,
          options.timeout === false ? 10_000 : /** @type {number} */ (options.timeout),
          options,
          currentRequest,
        );

        if (responseFromHook) throw error;

        const retriedResponse = await retryFromError(error, makeFetch, currentRequest, options, state).catch((e) => { throw e; });
        if (!(retriedResponse instanceof Response)) return retriedResponse;
        response = retriedResponse;
        responseFromHook = true;
        continue;
      }

      break;
    }

    // Decorate response with custom parseJson
    if (options.parseJson) {
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const text = await response.text();
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
        throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
      }

      return streamResponse(response, onDownloadProgress);
    }

    return response;
  })();

  // Build ResponsePromise thenable with body shortcuts
  const responsePromise = {
    then: innerPromise.then.bind(innerPromise),
    catch: innerPromise.catch.bind(innerPromise),
    finally: innerPromise.finally.bind(innerPromise),
    [Symbol.toStringTag]: 'ResponsePromise',
  };

  // Add body method shortcuts
  for (const [type, mimeType] of Object.entries(responseTypes)) {
    responsePromise[type] = async (schema) => {
      // Set Accept header
      if (currentRequest) {
        currentRequest.headers.set('accept', currentRequest.headers.get('accept') || mimeType);
      }

      const response = await innerPromise;

      if (type !== 'json') {
        return response[type]();
      }

      // JSON with optional schema validation
      const text = await response.text();
      if (text === '') {
        if (schema !== undefined) {
          return validateJsonWithSchema(undefined, schema);
        }
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
