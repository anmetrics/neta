import { HTTP_METHODS } from './constants.js';
import { createResponsePromise } from './core.js';
import { mergeOptions, normalizeOptions } from './utils.js';

/**
 * @param {import('./types.js').Options} [defaults]
 * @returns {import('./types.js').NetaInstance}
 */
export function createInstance(defaults) {
  const fn = (input, options) => {
    const merged = mergeOptions(defaults, options);
    const normalized = normalizeOptions(merged);
    return createResponsePromise(input, normalized);
  };

  for (const method of HTTP_METHODS) {
    fn[method] = (input, options) => fn(input, { ...options, method });
  }

  fn.create = (newDefaults) => createInstance(mergeOptions(defaults, newDefaults));
  fn.extend = fn.create;

  return fn;
}

const neta = createInstance();

export default neta;
export { neta };
export { HTTPError, TimeoutError } from './errors.js';
export { stop } from './types.js';
