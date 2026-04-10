import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { HTTPError, TimeoutError, NetworkError, stop } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let requestCount: Record<string, number>;

beforeAll(async () => {
  requestCount = {};
  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    requestCount[url.pathname] = (requestCount[url.pathname] ?? 0) + 1;

    if (url.pathname === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/echo-headers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ headers: req.headers }));
      return;
    }

    if (url.pathname === '/error') {
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }

    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 3000);
      return;
    }

    if (url.pathname === '/flaky-auth') {
      const auth = req.headers.authorization;
      if (auth === 'Bearer new-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(401);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('hooks', () => {
  it('init hook can mutate options', async () => {
    const data = await neta
      .get(`${server.url}/echo-headers`, {
        hooks: {
          init: [
            (options: any) => {
              options.headers = { ...options.headers, 'x-init': 'from-init-hook' };
            },
          ],
        },
      })
      .json<{ headers: Record<string, string> }>();

    expect(data.headers['x-init']).toBe('from-init-hook');
  });

  it('beforeRequest hook can modify request', async () => {
    const data = await neta
      .get(`${server.url}/echo-headers`, {
        hooks: {
          beforeRequest: [
            ({ request }) => {
              const headers = new Headers(request.headers);
              headers.set('x-injected', 'from-hook');
              return new Request(request, { headers });
            },
          ],
        },
      })
      .json<{ headers: Record<string, string> }>();

    expect(data.headers['x-injected']).toBe('from-hook');
  });

  it('afterResponse hook can modify response', async () => {
    const response = await neta.get(`${server.url}/json`, {
      hooks: {
        afterResponse: [
          ({ response }) => {
            return new Response(JSON.stringify({ modified: true }), {
              status: response.status,
              headers: response.headers,
            });
          },
        ],
      },
    });

    const data = await response.json<{ modified: boolean }>();
    expect(data.modified).toBe(true);
  });

  it('beforeError hook can modify HTTPError', async () => {
    try {
      await neta.get(`${server.url}/error`, {
        retry: 0,
        hooks: {
          beforeError: [
            ({ error }) => {
              (error as HTTPError & { customMessage: string }).customMessage = 'modified';
              return error;
            },
          ],
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPError);
      expect((error as HTTPError & { customMessage: string }).customMessage).toBe('modified');
    }
  });

  it('beforeError hook runs for TimeoutError (regression fix)', async () => {
    let hookRan = false;
    let seenError: Error | undefined;

    try {
      await neta.get(`${server.url}/slow`, {
        timeout: 50,
        retry: 0,
        hooks: {
          beforeError: [
            ({ error }) => {
              hookRan = true;
              seenError = error;
              return error;
            },
          ],
        },
      });
    } catch {
      // expected
    }

    expect(hookRan).toBe(true);
    expect(seenError).toBeInstanceOf(TimeoutError);
  });

  it('beforeError hook runs for NetworkError (regression fix)', async () => {
    let hookRan = false;
    let seenError: Error | undefined;

    try {
      await neta.get('http://127.0.0.1:1/never', {
        retry: 0,
        timeout: 2000,
        hooks: {
          beforeError: [
            ({ error }) => {
              hookRan = true;
              seenError = error;
              return error;
            },
          ],
        },
      });
    } catch {
      // expected
    }

    expect(hookRan).toBe(true);
    expect(seenError).toBeInstanceOf(NetworkError);
  });

  it('beforeError hook can replace error with new Error', async () => {
    try {
      await neta.get(`${server.url}/error`, {
        retry: 0,
        hooks: {
          beforeError: [() => new Error('replaced error')],
        },
      });
      expect.unreachable();
    } catch (error: any) {
      expect(error.message).toBe('replaced error');
    }
  });

  it('multiple beforeError hooks run in order', async () => {
    const calls: string[] = [];

    try {
      await neta.get(`${server.url}/error`, {
        retry: 0,
        hooks: {
          beforeError: [
            ({ error }) => { calls.push('hook1'); return error; },
            ({ error }) => { calls.push('hook2'); return error; },
          ],
        },
      });
    } catch {}

    expect(calls).toEqual(['hook1', 'hook2']);
  });

  it('multiple init hooks run in order', async () => {
    const calls: string[] = [];

    await neta.get(`${server.url}/json`, {
      hooks: {
        init: [
          () => { calls.push('init1'); },
          () => { calls.push('init2'); },
          () => { calls.push('init3'); },
        ],
      },
    });

    expect(calls).toEqual(['init1', 'init2', 'init3']);
  });

  it('beforeRequest can short-circuit with Response', async () => {
    const response = await neta.get(`${server.url}/json`, {
      hooks: {
        beforeRequest: [
          () => new Response(JSON.stringify({ bypass: true }), {
            headers: { 'content-type': 'application/json' },
          }),
        ],
      },
    });

    const data = await response.json() as { bypass: boolean };
    expect(data.bypass).toBe(true);
  });

  it('afterResponse can force retry with neta.retry()', async () => {
    requestCount['/flaky-auth'] = 0;
    let refreshed = false;

    const data = await neta
      .get(`${server.url}/flaky-auth`, {
        hooks: {
          afterResponse: [
            ({ request, response }) => {
              if (response.status === 401 && !refreshed) {
                refreshed = true;
                const newRequest = new Request(request, {
                  headers: {
                    ...Object.fromEntries(request.headers),
                    Authorization: 'Bearer new-token',
                  },
                });
                return neta.retry({ request: newRequest });
              }
            },
          ],
        },
      })
      .json<{ ok: boolean }>();

    expect(data.ok).toBe(true);
    expect(requestCount['/flaky-auth']).toBe(2);
  });

  it('afterResponse force retry respects custom delay', async () => {
    requestCount['/flaky-auth'] = 0;
    const start = Date.now();
    let refreshed = false;

    await neta.get(`${server.url}/flaky-auth`, {
      hooks: {
        afterResponse: [
          ({ request, response }) => {
            if (response.status === 401 && !refreshed) {
              refreshed = true;
              const newRequest = new Request(request, {
                headers: {
                  ...Object.fromEntries(request.headers),
                  Authorization: 'Bearer new-token',
                },
              });
              return neta.retry({ request: newRequest, delay: 200 });
            }
          },
        ],
      },
    });

    expect(Date.now() - start).toBeGreaterThanOrEqual(180);
  });

  it('beforeRetry can stop the retry loop', async () => {
    requestCount['/error'] = 0;
    try {
      await neta.get(`${server.url}/error`, {
        retry: { limit: 5, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
        hooks: {
          beforeRetry: [() => stop],
        },
      });
    } catch {}

    expect(requestCount['/error']).toBe(1);
  });

  it('beforeRetry can replace request', async () => {
    requestCount['/flaky-auth'] = 0;
    try {
      await neta.get(`${server.url}/flaky-auth`, {
        retry: { limit: 2, statusCodes: [401], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
        hooks: {
          beforeRetry: [
            ({ request }) => new Request(request, {
              headers: {
                ...Object.fromEntries(request.headers),
                Authorization: 'Bearer new-token',
              },
            }),
          ],
        },
      });
    } catch {}

    expect(requestCount['/flaky-auth']).toBe(2);
  });

  it('all beforeRequest hooks run even after Request replacement (consistency)', async () => {
    const calls: string[] = [];

    await neta.get(`${server.url}/echo-headers`, {
      hooks: {
        beforeRequest: [
          ({ request }) => {
            calls.push('hook1');
            const h = new Headers(request.headers);
            h.set('x-one', '1');
            return new Request(request, { headers: h });
          },
          ({ request }) => {
            calls.push('hook2');
            const h = new Headers(request.headers);
            h.set('x-two', '2');
            return new Request(request, { headers: h });
          },
        ],
      },
    });

    expect(calls).toEqual(['hook1', 'hook2']);
  });

  it('all beforeRetry hooks run even after Request replacement (consistency)', async () => {
    requestCount['/error'] = 0;
    const calls: string[] = [];

    try {
      await neta.get(`${server.url}/error`, {
        retry: { limit: 1, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
        hooks: {
          beforeRetry: [
            ({ request }) => { calls.push('r1'); return new Request(request); },
            ({ request }) => { calls.push('r2'); return new Request(request); },
          ],
        },
      });
    } catch {}

    expect(calls).toEqual(['r1', 'r2']);
  });
});
