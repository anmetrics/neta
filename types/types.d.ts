export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export type SearchParamsInit =
  | string
  | Record<string, string | number | boolean | undefined>
  | URLSearchParams
  | Array<[string, string]>;

export interface RetryOptions {
  limit: number;
  methods: string[];
  statusCodes: number[];
  afterStatusCodes: number[];
  maxRetryAfter: number;
  backoffLimit: number;
  delay: (attemptCount: number) => number;
  jitter: boolean | ((delay: number) => number);
  retryOnTimeout: boolean;
  shouldRetry?: (info: { error: Error; retryCount: number }) => boolean | undefined | Promise<boolean | undefined>;
}

export interface DownloadProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
}

export interface UploadProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
}

// Standard Schema v1 (https://github.com/standard-schema/standard-schema)
export interface StandardSchema {
  '~standard': {
    validate: (value: unknown) => { value?: unknown; issues?: Array<{ message?: string; path?: Array<string | number | symbol> }> } | Promise<{ value?: unknown; issues?: Array<{ message?: string; path?: Array<string | number | symbol> }> }>;
  };
}

export interface InitHook {
  (options: Options): void;
}

export interface BeforeRequestHook {
  (info: {
    request: Request;
    options: NormalizedOptions;
    retryCount: number;
  }): Request | Response | void | Promise<Request | Response | void>;
}

export interface AfterResponseHook {
  (info: {
    request: Request;
    options: NormalizedOptions;
    response: Response;
    retryCount: number;
  }): Response | import('./types.js').RetryMarker | void | Promise<Response | import('./types.js').RetryMarker | void>;
}

export interface BeforeErrorHook {
  (info: {
    request: Request;
    options: NormalizedOptions;
    error: Error;
    retryCount: number;
  }): Error | void | Promise<Error | void>;
}

export interface BeforeRetryHook {
  (info: {
    request: Request;
    options: NormalizedOptions;
    error: Error;
    retryCount: number;
  }): Request | Response | typeof stop | void | Promise<Request | Response | typeof stop | void>;
}

export interface Hooks {
  init?: InitHook[];
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeError?: BeforeErrorHook[];
  beforeRetry?: BeforeRetryHook[];
}

export interface NormalizedHooks {
  init: InitHook[];
  beforeRequest: BeforeRequestHook[];
  afterResponse: AfterResponseHook[];
  beforeError: BeforeErrorHook[];
  beforeRetry: BeforeRetryHook[];
}

export interface Options extends Omit<RequestInit, 'method'> {
  method?: HttpMethod | string;
  prefix?: string | URL;
  baseUrl?: string | URL;
  retry?: number | Partial<RetryOptions>;
  timeout?: number | false;
  totalTimeout?: number | false;
  hooks?: Hooks;
  searchParams?: SearchParamsInit;
  json?: unknown;
  parseJson?: (text: string, context: { request: Request; response: Response }) => unknown;
  stringifyJson?: (value: unknown) => string;
  throwHttpErrors?: boolean | ((status: number) => boolean);
  fetch?: typeof globalThis.fetch;
  context?: Record<string, unknown>;
  onDownloadProgress?: (progress: DownloadProgress) => void;
  onUploadProgress?: (progress: UploadProgress) => void;
}

export interface InternalOptions extends Omit<Options, 'retry' | 'timeout' | 'totalTimeout' | 'hooks' | 'throwHttpErrors' | 'fetch' | 'context' | 'prefix'> {
  method: string;
  retry: RetryOptions;
  timeout: number | false;
  totalTimeout: number | false;
  hooks: NormalizedHooks;
  throwHttpErrors: boolean | ((status: number) => boolean);
  fetch: typeof globalThis.fetch;
  context: Record<string, unknown>;
  prefix: string;
  _userSignal?: AbortSignal;
}

export interface NormalizedOptions extends Omit<RequestInit, 'method'> {
  method: string;
}

export interface NetaResponse extends Response {
  json<T = unknown>(): Promise<T>;
}

export interface ResponsePromise extends Promise<NetaResponse> {
  json<T = unknown>(schema?: StandardSchema): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
  bytes(): Promise<Uint8Array>;
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
  retry(options?: { delay?: number; request?: Request }): import('./types.js').RetryMarker;
}

export declare const stop: unique symbol;

export declare class RetryMarker {
  options?: { delay?: number; request?: Request };
  constructor(options?: { delay?: number; request?: Request });
}
