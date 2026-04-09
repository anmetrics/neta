import type { NormalizedOptions } from './types.js';

export declare function executeWithRetry(
  makeFetch: () => Promise<Response>,
  request: Request,
  options: NormalizedOptions,
): Promise<Response>;
