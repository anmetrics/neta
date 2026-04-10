import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { TimeoutError } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let requestCount: Record<string, number>;

beforeAll(async () => {
  requestCount = {};

  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    requestCount[url.pathname] = (requestCount[url.pathname] ?? 0) + 1;

    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('done');
      }, 5000);
      return;
    }

    if (url.pathname === '/slow-then-ok') {
      if (requestCount[url.pathname]! <= 2) {
        setTimeout(() => {
          res.writeHead(200);
          res.end('late');
        }, 3000);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/ok') {
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

describe('timeout', () => {
  it('should throw TimeoutError when timeout exceeded', async () => {
    await expect(
      neta.get(`${server.url}/slow`, { timeout: 100, retry: 0 }),
    ).rejects.toThrow(TimeoutError);
  });

  it('should not timeout when timeout is false', async () => {
    requestCount['/ok'] = 0;
    const data = await neta.get(`${server.url}/ok`, { timeout: false }).json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
  });

  it('should throw RangeError for timeout > max safe', async () => {
    await expect(
      neta.get(`${server.url}/ok`, { timeout: 2147483648 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('totalTimeout', () => {
  it('should cap total time across retries', async () => {
    requestCount['/slow-then-ok'] = 0;
    const start = Date.now();
    try {
      await neta.get(`${server.url}/slow-then-ok`, {
        timeout: 100,
        totalTimeout: 500,
        retry: {
          limit: 5,
          methods: ['get'],
          statusCodes: [500],
          afterStatusCodes: [],
          backoffLimit: Infinity,
          delay: () => 50,
          maxRetryAfter: Infinity,
          jitter: false,
          retryOnTimeout: true,
        },
      });
      expect.unreachable();
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(error).toBeInstanceOf(TimeoutError);
      // Should not exceed totalTimeout by much
      expect(elapsed).toBeLessThan(1500);
    }
  });

  it('should throw RangeError for totalTimeout > max safe', async () => {
    await expect(
      neta.get(`${server.url}/ok`, { totalTimeout: 2147483648 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('signal', () => {
  it('should abort when user signal fires', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(
      neta.get(`${server.url}/slow`, { signal: controller.signal, retry: 0 }),
    ).rejects.toThrow();
  });

  it('should abort immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      neta.get(`${server.url}/ok`, { signal: controller.signal, retry: 0 }),
    ).rejects.toThrow();
  });

  it('should not leak listeners on userSignal across many requests', async () => {
    // Regression test for listener cleanup fix
    const controller = new AbortController();
    let addCount = 0;
    let removeCount = 0;

    const originalAdd = controller.signal.addEventListener.bind(controller.signal);
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal);

    controller.signal.addEventListener = (type: string, ...args: any[]) => {
      if (type === 'abort') addCount++;
      return (originalAdd as any)(type, ...args);
    };
    controller.signal.removeEventListener = (type: string, ...args: any[]) => {
      if (type === 'abort') removeCount++;
      return (originalRemove as any)(type, ...args);
    };

    for (let i = 0; i < 20; i++) {
      await neta.get(`${server.url}/ok`, { signal: controller.signal, retry: 0 });
    }

    // Every add should be paired with a remove
    expect(removeCount).toBeGreaterThanOrEqual(addCount - 2);
  });
});
