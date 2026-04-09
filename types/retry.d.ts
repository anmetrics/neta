import type { InternalOptions } from './types.js';

interface RetryState {
  getRetryCount: () => number;
  setRetryCount: (n: number) => void;
  getStartTime: () => number | undefined;
}

export declare function executeWithRetry(
  makeFetch: () => Promise<Response>,
  request: Request,
  options: InternalOptions,
  state: RetryState,
): Promise<Response>;

export declare function retryFromError(
  error: unknown,
  makeFetch: () => Promise<Response>,
  request: Request,
  options: InternalOptions,
  state: RetryState,
): Promise<Response | void>;
