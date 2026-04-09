import type { NetaInstance, Options } from './types.js';

export declare function createInstance(defaults?: Options): NetaInstance;

declare const neta: NetaInstance;
export default neta;
export { neta };

export { HTTPError, TimeoutError } from './errors.js';
export { stop } from './types.js';
export type {
  AfterResponseHook,
  BeforeErrorHook,
  BeforeRequestHook,
  BeforeRetryHook,
  Hooks,
  HttpMethod,
  NetaInstance,
  NetaResponse,
  NormalizedHooks,
  NormalizedOptions,
  Options,
  ResponsePromise,
  RetryOptions,
  SearchParamsInit,
} from './types.js';
