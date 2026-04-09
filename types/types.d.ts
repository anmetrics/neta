export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export type SearchParamsInit =
  | string
  | Record<string, string | number | boolean>
  | URLSearchParams
  | Array<[string, string]>;

export interface RetryOptions {
  limit: number;
  methods: HttpMethod[];
  statusCodes: number[];
  afterStatusCodes: number[];
  maxRetryAfter?: number;
  backoffLimit: number;
  delay: (attemptCount: number) => number;
}

export interface BeforeRequestHook {
  (request: Request, options: NormalizedOptions): Request | void | Promise<Request | void>;
}

export interface AfterResponseHook {
  (
    request: Request,
    options: NormalizedOptions,
    response: Response,
  ): Response | void | Promise<Response | void>;
}

export interface BeforeErrorHook {
  (error: import('./errors.js').HTTPError): import('./errors.js').HTTPError | Promise<import('./errors.js').HTTPError>;
}

export interface BeforeRetryHook {
  (info: {
    request: Request;
    options: NormalizedOptions;
    error: Error;
    retryCount: number;
  }): typeof stop | void | Promise<typeof stop | void>;
}

export interface Hooks {
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeError?: BeforeErrorHook[];
  beforeRetry?: BeforeRetryHook[];
}

export interface NormalizedHooks {
  beforeRequest: BeforeRequestHook[];
  afterResponse: AfterResponseHook[];
  beforeError: BeforeErrorHook[];
  beforeRetry: BeforeRetryHook[];
}

export interface Options extends Omit<RequestInit, 'method'> {
  prefixUrl?: string | URL;
  retry?: number | RetryOptions;
  timeout?: number | false;
  hooks?: Hooks;
  searchParams?: SearchParamsInit;
  json?: unknown;
  method?: HttpMethod;
  throwHttpErrors?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface NormalizedOptions extends Options {
  method: HttpMethod;
  retry: RetryOptions;
  timeout: number | false;
  hooks: NormalizedHooks;
  throwHttpErrors: boolean;
  fetch: typeof globalThis.fetch;
}

export interface NetaResponse extends Response {
  json<T = unknown>(): Promise<T>;
}

export interface ResponsePromise extends Promise<NetaResponse> {
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
}

export interface NetaInstance {
  (input: string | URL | Request, options?: Options): ResponsePromise;
  get(input: string | URL | Request, options?: Options): ResponsePromise;
  post(input: string | URL | Request, options?: Options): ResponsePromise;
  put(input: string | URL | Request, options?: Options): ResponsePromise;
  patch(input: string | URL | Request, options?: Options): ResponsePromise;
  delete(input: string | URL | Request, options?: Options): ResponsePromise;
  head(input: string | URL | Request, options?: Options): ResponsePromise;
  options(input: string | URL | Request, options?: Options): ResponsePromise;
  create(defaults?: Options): NetaInstance;
  extend(defaults?: Options): NetaInstance;
}

export declare const stop: unique symbol;
