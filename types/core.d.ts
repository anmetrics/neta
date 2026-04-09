import type { InternalOptions, ResponsePromise } from './types.js';

export declare function createResponsePromise(
  input: string | URL | Request,
  options: InternalOptions,
): ResponsePromise;
