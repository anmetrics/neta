import type { NormalizedOptions } from './types.js';

export declare class HTTPError extends Error {
  response: Response;
  request: Request;
  options: NormalizedOptions;
  data: unknown;
  constructor(response: Response, request: Request, options: NormalizedOptions);
}

export declare class TimeoutError extends Error {
  request: Request;
  constructor(request: Request);
}

export declare class NetworkError extends Error {
  request: Request;
  constructor(request: Request, options?: { cause?: Error });
}

export declare class ForceRetryError extends Error {
  customDelay?: number;
  customRequest?: Request;
  constructor(options?: { delay?: number; request?: Request });
}

export declare class SchemaValidationError extends Error {
  issues: Array<{ message?: string; path?: Array<string | number | symbol> }>;
  constructor(issues: Array<{ message?: string; path?: Array<string | number | symbol> }>);
}
