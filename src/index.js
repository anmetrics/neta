import { HTTP_METHODS } from './constants.js';
import { createResponsePromise } from './core.js';
import { RetryMarker } from './types.js';
import { mergeOptions, normalizeOptions } from './utils.js';

/**
 * @param {import('../types/types.js').Options} [defaults]
 * @returns {import('../types/types.js').NetaInstance}
 */
export function createInstance(defaults) {
  const fn = (input, options) => {
    const merged = mergeOptions(defaults, options);
    const normalized = normalizeOptions(merged);
    // Stash user signal before we override it internally
    normalized._userSignal = normalized.signal ?? undefined;
    return createResponsePromise(input, normalized);
  };

  for (const method of HTTP_METHODS) {
    fn[method] = (input, options) => fn(input, { ...options, method });
  }

  fn.create = (newDefaults) => createInstance(mergeOptions(defaults, newDefaults));
  fn.extend = fn.create;

  /**
   * Signal forced retry from an afterResponse hook.
   * @param {{ delay?: number, request?: Request }} [options]
   * @returns {RetryMarker}
   */
  fn.retry = (options) => new RetryMarker(options);

  return fn;
}

const neta = createInstance();

export default neta;
export { neta };
export { HTTPError, TimeoutError, NetworkError, ForceRetryError, SchemaValidationError } from './errors.js';
export { HTTPError as NetaError } from './errors.js';
export { createInstance as NetaClient };
export { stop } from './types.js';
