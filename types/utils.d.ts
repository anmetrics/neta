import type { NormalizedHooks, NormalizedOptions, Options, RetryOptions, SearchParamsInit } from './types.js';

export declare function normalizeRetry(retry: Options['retry']): RetryOptions;
export declare function normalizeHooks(hooks?: Options['hooks']): NormalizedHooks;
export declare function mergeHeaders(target?: HeadersInit, source?: HeadersInit): Headers;
export declare function mergeOptions(defaults?: Options, overrides?: Options): Options;
export declare function resolveUrl(input: string | URL | Request, prefixUrl?: string | URL): URL;
export declare function appendSearchParams(url: URL, searchParams?: SearchParamsInit): URL;
export declare function normalizeOptions(options: Options): NormalizedOptions;
export declare function sleep(ms: number): Promise<void>;
export declare function parseRetryAfter(response: Response): number | undefined;
