import type { Hooks, InternalOptions, NormalizedHooks, Options, RetryOptions, SearchParamsInit } from './types.js';

export declare function normalizeRetry(retry: Options['retry']): RetryOptions;
export declare function normalizeHooks(hooks?: Options['hooks']): NormalizedHooks;
export declare function mergeHeaders(target?: HeadersInit, source?: HeadersInit): Headers;
export declare function mergeHooks(base?: Hooks, override?: Hooks): Hooks;
export declare function mergeOptions(defaults?: Options, overrides?: Options): Options;
export declare function resolveInput(input: string | URL | Request, options?: { prefix?: string; baseUrl?: string | URL }): string;
export declare function appendSearchParams(url: URL, searchParams?: SearchParamsInit): URL;
export declare function normalizeOptions(options: Options): InternalOptions;
export declare function normalizeRequestMethod(method?: string): string;
export declare function delay(ms: number, options?: { signal?: AbortSignal }): Promise<void>;
export declare function parseRetryAfter(response: Response): number | undefined;
export declare function applyJitter(delayMs: number, jitter: boolean | ((delay: number) => number)): number;
export declare function isNetworkError(error: unknown): boolean;
