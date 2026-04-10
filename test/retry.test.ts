import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { HTTPError, stop } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let requestCounts: Record<string, number>;

beforeAll(async () => {
  requestCounts = {};

  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const key = url.pathname;
    requestCounts[key] = (requestCounts[key] ?? 0) + 1;

    if (url.pathname === '/retry-500') {
      if (requestCounts[key]! <= 2) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ attempt: requestCounts[key] }));
      return;
    }

    if (url.pathname === '/always-500') {
      res.writeHead(500);
      res.end();
      return;
    }

    if (url.pathname === '/retry-after') {
      if (requestCounts[key]! <= 1) {
        res.writeHead(429, { 'Retry-After': '0' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/slow-then-ok') {
      if (requestCounts[key]! <= 1) {
        // Don't respond (timeout)
        setTimeout(() => {
          res.writeHead(200);
          res.end('late');
        }, 10000);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('retry', () => {
  it('should retry on 500 and succeed', async () => {
    requestCounts = {};
    const data = await neta
      .get(`${server.url}/retry-500`, {
        retry: { limit: 3, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      })
      .json<{ attempt: number }>();

    expect(data.attempt).toBe(3);
  });

  it('should exhaust retries and throw', async () => {
    requestCounts = {};
    await expect(
      neta.get(`${server.url}/always-500`, {
        retry: { limit: 2, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      }),
    ).rejects.toThrow(HTTPError);
  });

  it('should not retry POST by default', async () => {
    requestCounts = {};
    await expect(
      neta.post(`${server.url}/always-500`, {
        retry: { limit: 2, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      }),
    ).rejects.toThrow(HTTPError);
    expect(requestCounts['/always-500']).toBe(1);
  });

  it('should stop retry when hook returns stop symbol', async () => {
    requestCounts = {};
    try {
      await neta.get(`${server.url}/always-500`, {
        retry: { limit: 5, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
        hooks: {
          beforeRetry: [
            ({ retryCount }: any) => {
              if (retryCount >= 2) return stop;
            },
          ],
        },
      });
    } catch {
      // Expected to throw since stop returns undefined
    }
    // 1 initial + 1 retry (stop fires on retryCount=2, preventing 2nd retry)
    expect(requestCounts['/always-500']).toBe(2);
  });

  it('should honor Retry-After header', async () => {
    requestCounts = {};
    const data = await neta
      .get(`${server.url}/retry-after`, {
        retry: { limit: 2, statusCodes: [429], methods: ['get'], afterStatusCodes: [429], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      })
      .json<{ ok: boolean }>();

    expect(data.ok).toBe(true);
    expect(requestCounts['/retry-after']).toBe(2);
  });

  it('should support shouldRetry function', async () => {
    requestCounts = {};
    await expect(
      neta.get(`${server.url}/always-500`, {
        retry: {
          limit: 5,
          statusCodes: [500],
          methods: ['get'],
          afterStatusCodes: [],
          backoffLimit: Infinity,
          delay: () => 10,
          maxRetryAfter: Infinity,
          jitter: false,
          retryOnTimeout: false,
          shouldRetry: ({ retryCount }: any) => retryCount <= 1,
        },
      }),
    ).rejects.toThrow(HTTPError);
    // shouldRetry returns true for retryCount 1, false for retryCount 2
    expect(requestCounts['/always-500']).toBe(2);
  });

  it('should support jitter', async () => {
    requestCounts = {};
    await expect(
      neta.get(`${server.url}/always-500`, {
        retry: {
          limit: 2,
          statusCodes: [500],
          methods: ['get'],
          afterStatusCodes: [],
          backoffLimit: Infinity,
          delay: () => 100,
          maxRetryAfter: Infinity,
          jitter: (d: number) => d * 0.01, // Very small jitter
          retryOnTimeout: false,
        },
      }),
    ).rejects.toThrow(HTTPError);
    expect(requestCounts['/always-500']).toBe(3);
  });

  it('should retry on timeout when retryOnTimeout is true', async () => {
    requestCounts = {};
    const data = await neta
      .get(`${server.url}/slow-then-ok`, {
        timeout: 50,
        retry: {
          limit: 2,
          statusCodes: [500],
          methods: ['get'],
          afterStatusCodes: [],
          backoffLimit: Infinity,
          delay: () => 10,
          maxRetryAfter: Infinity,
          jitter: false,
          retryOnTimeout: true,
        },
      })
      .json<{ ok: boolean }>();

    expect(data.ok).toBe(true);
    expect(requestCounts['/slow-then-ok']).toBe(2);
  });

  it('should not retry status codes not in statusCodes list', async () => {
    requestCounts = {};
    try {
      await neta.get(`${server.url}/always-500`, {
        retry: { limit: 5, statusCodes: [429], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      });
    } catch {}
    expect(requestCounts['/always-500']).toBe(1);
  });

  it('should cap delay with backoffLimit', async () => {
    requestCounts = {};
    const start = Date.now();
    try {
      await neta.get(`${server.url}/always-500`, {
        retry: { limit: 1, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: 50, delay: () => 10000, maxRetryAfter: Infinity, jitter: false, retryOnTimeout: false },
      });
    } catch {}
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('retry limit 0 should not retry', async () => {
    requestCounts = {};
    try {
      await neta.get(`${server.url}/always-500`, { retry: 0 });
    } catch {}
    expect(requestCounts['/always-500']).toBe(1);
  });
});

describe('Retry-After header variations', () => {
  let rServer: TestServer;
  let rCounts: Record<string, number>;

  beforeAll(async () => {
    rCounts = {};
    rServer = await createTestServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const key = url.pathname;
      rCounts[key] = (rCounts[key] ?? 0) + 1;

      if (rCounts[key]! <= 1) {
        const header = url.searchParams.get('header') ?? 'retry-after';
        const value = url.searchParams.get('value') ?? '0';
        res.writeHead(429, { [header]: value });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, attempt: rCounts[key] }));
    });
  });

  afterAll(async () => {
    await rServer.close();
  });

  const makeRetry = (maxAfter = Infinity) => ({
    limit: 2,
    statusCodes: [429],
    methods: ['get'],
    afterStatusCodes: [429],
    backoffLimit: Infinity,
    delay: () => 10,
    maxRetryAfter: maxAfter,
    jitter: false,
    retryOnTimeout: false,
  });

  const headers = [
    'retry-after',
    'ratelimit-reset',
    'x-ratelimit-retry-after',
    'x-ratelimit-reset',
    'x-rate-limit-reset',
  ];

  for (const header of headers) {
    it(`should honor ${header} header`, async () => {
      rCounts = {};
      const data = await neta
        .get(`${rServer.url}/h-${header}?header=${header}&value=0`, { retry: makeRetry() })
        .json<{ ok: boolean }>();
      expect(data.ok).toBe(true);
    });
  }

  it('should parse HTTP date format in Retry-After', async () => {
    rCounts = {};
    const futureDate = new Date(Date.now() + 100).toUTCString();
    const data = await neta
      .get(`${rServer.url}/date?header=retry-after&value=${encodeURIComponent(futureDate)}`, { retry: makeRetry() })
      .json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
  });

  it('should cap Retry-After with maxRetryAfter', async () => {
    rCounts = {};
    const start = Date.now();
    const data = await neta
      .get(`${rServer.url}/cap?header=retry-after&value=60`, { retry: makeRetry(100) })
      .json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
    // Should wait <= maxRetryAfter (100ms) + some overhead, not 60s
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
