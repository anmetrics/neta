import type { NormalizedOptions, ResponsePromise } from './types.js';

export declare function createResponsePromise(
  input: string | URL | Request,
  options: NormalizedOptions,
): ResponsePromise;
