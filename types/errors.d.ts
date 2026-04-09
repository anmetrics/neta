import type { NormalizedOptions } from './types.js';

export declare class HTTPError extends Error {
  response: Response;
  request: Request;
  options: NormalizedOptions;
  constructor(response: Response, request: Request, options: NormalizedOptions);
}

export declare class TimeoutError extends Error {
  request: Request;
  constructor(request: Request);
}
