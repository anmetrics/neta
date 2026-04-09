import { HTTPError, TimeoutError } from './errors.js';
import { executeWithRetry } from './retry.js';
import { appendSearchParams, resolveUrl } from './utils.js';

/**
 * @param {number | false} timeout
 * @param {AbortSignal | null} [userSignal]
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
function createAbortSignal(timeout, userSignal) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  if (timeout !== false) {
    timer = setTimeout(() => controller.abort('timeout'), timeout);
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), {
        once: true,
      });
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
 * @param {string | URL | Request} input
 * @param {import('./types.js').NormalizedOptions} options
 * @returns {import('./types.js').ResponsePromise}
 */
export function createResponsePromise(input, options) {
  const innerPromise = (async () => {
    let url = resolveUrl(input, options.prefixUrl);
    url = appendSearchParams(url, options.searchParams);

    const {
      prefixUrl, retry, timeout, hooks, searchParams, json,
      throwHttpErrors, fetch, ...requestInit
    } = options;

    let request = new Request(url.href, {
      ...requestInit,
      method: options.method.toUpperCase(),
    });

    // Run beforeRequest hooks
    for (const hook of hooks.beforeRequest) {
      const result = await hook(request, options);
      if (result instanceof Request) {
        request = result;
      }
    }

    // Setup abort/timeout
    const { signal, cleanup } = createAbortSignal(timeout, options.signal);

    const makeFetch = async () => {
      try {
        return await fetch(request.clone(), { signal });
      } catch (error) {
        cleanup();
        if (signal.aborted && signal.reason === 'timeout') {
          throw new TimeoutError(request);
        }
        throw error;
      }
    };

    /** @type {Response} */
    let response;
    try {
      response = await executeWithRetry(makeFetch, request, options);
    } finally {
      cleanup();
    }

    // Run afterResponse hooks
    for (const hook of hooks.afterResponse) {
      const result = await hook(request, options, response);
      if (result instanceof Response) {
        response = result;
      }
    }

    // Throw on HTTP errors
    if (throwHttpErrors && !response.ok) {
      let error = new HTTPError(response, request, options);
      for (const hook of hooks.beforeError) {
        error = await hook(error);
      }
      throw error;
    }

    return response;
  })();

  const responsePromise = {
    then: innerPromise.then.bind(innerPromise),
    catch: innerPromise.catch.bind(innerPromise),
    finally: innerPromise.finally.bind(innerPromise),
    json: () => innerPromise.then((r) => r.json()),
    text: () => innerPromise.then((r) => r.text()),
    blob: () => innerPromise.then((r) => r.blob()),
    arrayBuffer: () => innerPromise.then((r) => r.arrayBuffer()),
    formData: () => innerPromise.then((r) => r.formData()),
    [Symbol.toStringTag]: 'ResponsePromise',
  };

  return responsePromise;
}
