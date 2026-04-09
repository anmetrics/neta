# neta

> Tiny, elegant HTTP client built on [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) for browser and Node.js

- **Zero dependencies** — uses native `globalThis.fetch`
- **~12 KB** minified, ESM + CJS
- **TypeScript ready** — full `.d.ts` type definitions
- **Works everywhere** — browser, Node.js 18+, Deno, Bun

## Install

```sh
npm install neta
```

## Quick Start

```js
import neta from 'neta';

// GET with JSON parsing
const data = await neta.get('https://api.example.com/users').json();

// POST with JSON body
const user = await neta.post('https://api.example.com/users', {
  json: { name: 'John', email: 'john@example.com' },
}).json();

// Direct callable
const res = await neta('https://api.example.com/users', { method: 'get' });
```

## API

### `neta(input, options?)`

Returns a [`ResponsePromise`](#responsepromise).

#### input

Type: `string | URL | Request`

#### options

Type: `object`

All [`fetch` options](https://developer.mozilla.org/en-US/docs/Web/API/fetch#parameters) plus:

##### json

Type: `unknown`

JSON body. Automatically stringified and sets `Content-Type: application/json`.

```js
const data = await neta.post('https://api.example.com/items', {
  json: { title: 'New Item' },
}).json();
```

##### searchParams

Type: `string | object | URLSearchParams | Array<[string, string]>`

Query parameters appended to the URL.

```js
const data = await neta.get('https://api.example.com/search', {
  searchParams: { q: 'hello', page: 2 },
}).json();
// => GET https://api.example.com/search?q=hello&page=2
```

Values set to `undefined` are filtered out.

##### prefix

Type: `string | URL`

Prefix prepended to the input URL. Useful for API base paths.

```js
const api = neta.create({ prefix: 'https://api.example.com/v2' });

await api.get('users').json();
// => GET https://api.example.com/v2/users
```

##### baseUrl

Type: `string | URL`

Base URL for resolving relative inputs using standard [URL resolution](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL).

```js
const api = neta.create({ baseUrl: 'https://api.example.com/v2/' });

await api.get('users').json();
// => GET https://api.example.com/v2/users

await api.get('../v1/legacy').json();
// => GET https://api.example.com/v1/legacy
```

##### timeout

Type: `number | false`\
Default: `10000` (10 seconds)

Request timeout in milliseconds. Set to `false` to disable.

##### totalTimeout

Type: `number | false`\
Default: `false`

Total timeout across all retries in milliseconds.

```js
await neta.get('https://api.example.com/slow', {
  timeout: 5000,
  totalTimeout: 30000,
  retry: 5,
});
```

##### retry

Type: `number | object`\
Default: `{ limit: 2 }`

Retry configuration. Pass a number for simple retry limit, or an object for full control.

```js
// Simple
await neta.get(url, { retry: 3 });

// Full control
await neta.get(url, {
  retry: {
    limit: 3,
    methods: ['get', 'put', 'head', 'delete', 'options'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
    afterStatusCodes: [413, 429, 503],
    maxRetryAfter: Infinity,
    backoffLimit: Infinity,
    delay: (attemptCount) => 300 * 2 ** (attemptCount - 1),
    jitter: false,
    retryOnTimeout: false,
    shouldRetry: undefined,
  },
});
```

###### retry.limit

Type: `number`\
Default: `2`

Maximum number of retries.

###### retry.methods

Type: `string[]`\
Default: `['get', 'put', 'head', 'delete', 'options']`

HTTP methods eligible for retry.

###### retry.statusCodes

Type: `number[]`\
Default: `[408, 413, 429, 500, 502, 503, 504]`

HTTP status codes that trigger a retry.

###### retry.afterStatusCodes

Type: `number[]`\
Default: `[413, 429, 503]`

Status codes where the `Retry-After` header is honored.

###### retry.maxRetryAfter

Type: `number`\
Default: `Infinity`

Maximum `Retry-After` delay (ms) to accept.

###### retry.backoffLimit

Type: `number`\
Default: `Infinity`

Maximum backoff delay (ms).

###### retry.delay

Type: `(attemptCount: number) => number`\
Default: `(n) => 300 * 2 ** (n - 1)`

Function returning delay in ms for each attempt.

###### retry.jitter

Type: `boolean | ((delay: number) => number)`\
Default: `false`

Add randomness to retry delay to prevent thundering herd.

- `true` — random value between 0 and computed delay
- `function` — custom jitter function

```js
await neta.get(url, {
  retry: {
    limit: 5,
    delay: (n) => 1000 * 2 ** (n - 1),
    jitter: true,
  },
});
```

###### retry.retryOnTimeout

Type: `boolean`\
Default: `false`

Whether to retry when a request times out.

###### retry.shouldRetry

Type: `({ error, retryCount }) => boolean | undefined | Promise<boolean | undefined>`

Custom function to decide whether to retry. Takes precedence over default checks.

- Return `true` to force retry
- Return `false` to prevent retry
- Return `undefined` to fall through to default behavior

```js
await neta.get(url, {
  retry: {
    limit: 3,
    shouldRetry: ({ error, retryCount }) => {
      if (error.response?.status === 401) return false; // Don't retry auth errors
      return undefined; // Default behavior for others
    },
  },
});
```

##### throwHttpErrors

Type: `boolean | ((status: number) => boolean)`\
Default: `true`

Throw `HTTPError` for non-2xx responses. Pass a function for custom logic.

```js
// Never throw
const response = await neta.get(url, { throwHttpErrors: false });

// Only throw on 5xx
const response = await neta.get(url, {
  throwHttpErrors: (status) => status >= 500,
});
```

##### parseJson

Type: `(text: string, context: { request, response }) => unknown`

Custom JSON parser. Useful for reviving dates, BigInts, etc.

```js
import LosslessJSON from 'lossless-json';

const data = await neta.get(url, {
  parseJson: (text) => LosslessJSON.parse(text),
}).json();
```

##### stringifyJson

Type: `(value: unknown) => string`

Custom JSON serializer for the `json` option.

```js
import LosslessJSON from 'lossless-json';

await neta.post(url, {
  json: data,
  stringifyJson: (value) => LosslessJSON.stringify(value),
});
```

##### context

Type: `Record<string, unknown>`\
Default: `{}`

Arbitrary data passed through to hooks. Not sent with the request.

```js
await neta.get(url, {
  context: { token: 'abc123' },
  hooks: {
    init: [(options) => {
      options.headers = { ...options.headers, Authorization: `Bearer ${options.context.token}` };
    }],
  },
});
```

##### fetch

Type: `typeof globalThis.fetch`

Custom fetch implementation.

```js
import { fetch } from 'undici';

const api = neta.create({ fetch });
```

##### onDownloadProgress

Type: `(progress: { percent, transferredBytes, totalBytes }) => void`

Download progress callback. Requires `ReadableStream` support.

```js
await neta.get('https://example.com/large-file', {
  onDownloadProgress: ({ percent, transferredBytes, totalBytes }) => {
    console.log(`${Math.round(percent * 100)}% (${transferredBytes}/${totalBytes})`);
  },
});
```

##### onUploadProgress

Type: `(progress: { percent, transferredBytes, totalBytes }) => void`

Upload progress callback. Requires request streams support (`duplex: 'half'`).

### HTTP Method Shortcuts

```js
neta.get(input, options?)
neta.post(input, options?)
neta.put(input, options?)
neta.patch(input, options?)
neta.delete(input, options?)
neta.head(input, options?)
neta.options(input, options?)
```

### ResponsePromise

`neta` methods return a `ResponsePromise` — a `Promise<Response>` with body parsing shortcuts:

```js
const json = await neta.get(url).json();
const text = await neta.get(url).text();
const blob = await neta.get(url).blob();
const buffer = await neta.get(url).arrayBuffer();
const form = await neta.get(url).formData();
```

#### .json(schema?)

Parse response as JSON. Optionally validate against a [Standard Schema](https://github.com/standard-schema/standard-schema):

```js
import { z } from 'zod';

const user = await neta.get('/user/1').json(z.object({
  id: z.number(),
  name: z.string(),
}));
// Throws SchemaValidationError if validation fails
```

### Instance Creation

#### neta.create(defaults?)

Create a new instance with default options:

```js
const api = neta.create({
  prefix: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  timeout: 30000,
  retry: 3,
});

const data = await api.get('users').json();
```

#### neta.extend(defaults?)

Alias for `neta.create()`. Creates a new instance by extending existing defaults:

```js
const api = neta.create({ prefix: 'https://api.example.com' });
const authApi = api.extend({ headers: { Authorization: 'Bearer token' } });
```

## Hooks

Five hook points for intercepting the request lifecycle.

### hooks.init

Type: `Array<(options) => void>`

Called synchronously before anything else. Can mutate options directly.

```js
neta.create({
  hooks: {
    init: [(options) => {
      options.headers = { ...options.headers, 'X-Request-Id': crypto.randomUUID() };
    }],
  },
});
```

### hooks.beforeRequest

Type: `Array<({ request, options, retryCount }) => Request | Response | void>`

Called before each request. Return a `Request` to replace it, a `Response` to short-circuit, or nothing.

```js
neta.create({
  hooks: {
    beforeRequest: [({ request }) => {
      console.log(`${request.method} ${request.url}`);
    }],
  },
});
```

### hooks.afterResponse

Type: `Array<({ request, options, response, retryCount }) => Response | RetryMarker | void>`

Called after a successful response. Return a `Response` to replace it, or `neta.retry()` to force a retry.

```js
const api = neta.create({
  hooks: {
    afterResponse: [async ({ request, response }) => {
      if (response.status === 401) {
        const token = await refreshToken();
        return neta.retry({
          request: new Request(request, {
            headers: { ...Object.fromEntries(request.headers), Authorization: `Bearer ${token}` },
          }),
        });
      }
    }],
  },
});
```

### hooks.beforeError

Type: `Array<({ request, options, error, retryCount }) => Error | void>`

Called before an error is thrown. Return an `Error` to replace it.

```js
neta.create({
  hooks: {
    beforeError: [({ error }) => {
      if (error instanceof HTTPError) {
        error.message = `API Error: ${error.response.status}`;
      }
      return error;
    }],
  },
});
```

### hooks.beforeRetry

Type: `Array<({ request, options, error, retryCount }) => Request | Response | symbol | void>`

Called before each retry attempt. Return:

- `Request` — use this request for the retry
- `Response` — skip the retry and use this response
- `stop` — abort the retry loop
- nothing — proceed normally

```js
import { stop } from 'neta';

neta.create({
  hooks: {
    beforeRetry: [({ error, retryCount }) => {
      console.log(`Retry #${retryCount}: ${error.message}`);
      if (retryCount > 3) return stop;
    }],
  },
});
```

## Error Handling

### HTTPError

Thrown for non-2xx responses (when `throwHttpErrors` is true).

```js
import { HTTPError } from 'neta';

try {
  await neta.get('https://api.example.com/missing');
} catch (error) {
  if (error instanceof HTTPError) {
    console.log(error.response.status); // 404
    console.log(error.data);            // Auto-parsed response body
    console.log(error.request);         // The Request object
  }
}
```

### TimeoutError

Thrown when a request exceeds the `timeout` or `totalTimeout`.

```js
import { TimeoutError } from 'neta';

try {
  await neta.get(url, { timeout: 1000 });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Request timed out:', error.request.url);
  }
}
```

### NetworkError

Thrown on network failures (DNS, connection refused, etc.).

```js
import { NetworkError } from 'neta';

try {
  await neta.get('https://nonexistent.invalid');
} catch (error) {
  if (error instanceof NetworkError) {
    console.log('Network error:', error.message);
    console.log('Cause:', error.cause);
  }
}
```

### SchemaValidationError

Thrown when JSON response fails schema validation.

```js
import { SchemaValidationError } from 'neta';

try {
  await neta.get(url).json(mySchema);
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log('Validation issues:', error.issues);
  }
}
```

## TypeScript

neta ships with full TypeScript definitions. Generic type parameters work on `.json()`:

```ts
interface User {
  id: number;
  name: string;
}

const user = await neta.get('https://api.example.com/user/1').json<User>();
// user is typed as User
```

## Retry-After Header Support

neta automatically parses these headers during retry:

- `Retry-After`
- `RateLimit-Reset`
- `X-RateLimit-Retry-After`
- `X-RateLimit-Reset`
- `X-Rate-Limit-Reset`

Supports seconds, timestamps, and HTTP dates.

## Browser + Node.js

neta uses `globalThis.fetch` which is available natively in:

- All modern browsers
- Node.js 18+
- Deno
- Bun

No polyfills needed.

## License

MIT
