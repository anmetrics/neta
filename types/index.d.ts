import type { NetaInstance, Options } from './types.js';

export declare function createInstance(defaults?: Options): NetaInstance;

declare const neta: NetaInstance;
export default neta;
export { neta };

export { HTTPError, TimeoutError, NetworkError, ForceRetryError, SchemaValidationError } from './errors.js';
export { HTTPError as NetaError } from './errors.js';
export declare const NetaClient: new (defaults?: Options) => NetaInstance;
export type NetaClient = NetaInstance;
export { stop } from './types.js';
export type {
  AfterResponseHook,
  BeforeErrorHook,
  BeforeRequestHook,
  BeforeRetryHook,
  DownloadProgress,
  Hooks,
  HttpMethod,
  InitHook,
  InternalOptions,
  NetaInstance,
  NetaResponse,
  NormalizedHooks,
  NormalizedOptions,
  Options,
  ResponsePromise,
  RetryMarker,
  RetryOptions,
  SchemaValidationError as SchemaValidationErrorType,
  SearchParamsInit,
  StandardSchema,
  UploadProgress,
} from './types.js';
