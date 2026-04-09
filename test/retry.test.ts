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
      res.writeHead(200);
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
        retry: { limit: 3, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10 },
      })
      .json<{ attempt: number }>();

    expect(data.attempt).toBe(3);
  });

  it('should exhaust retries and throw', async () => {
    requestCounts = {};
    await expect(
      neta.get(`${server.url}/always-500`, {
        retry: { limit: 2, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10 },
      }),
    ).rejects.toThrow(HTTPError);
  });

  it('should not retry POST by default', async () => {
    requestCounts = {};
    await expect(
      neta.post(`${server.url}/always-500`, {
        retry: { limit: 2, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10 },
      }),
    ).rejects.toThrow(HTTPError);
    expect(requestCounts['/always-500']).toBe(1);
  });

  it('should stop retry when hook returns stop symbol', async () => {
    requestCounts = {};
    await expect(
      neta.get(`${server.url}/always-500`, {
        retry: { limit: 5, statusCodes: [500], methods: ['get'], afterStatusCodes: [], backoffLimit: Infinity, delay: () => 10 },
        hooks: {
          beforeRetry: [
            ({ retryCount }) => {
              if (retryCount >= 2) return stop;
            },
          ],
        },
        throwHttpErrors: false,
      }),
    ).resolves.toBeDefined();
    expect(requestCounts['/always-500']).toBe(2);
  });

  it('should honor Retry-After header', async () => {
    requestCounts = {};
    const data = await neta
      .get(`${server.url}/retry-after`, {
        retry: { limit: 2, statusCodes: [429], methods: ['get'], afterStatusCodes: [429], backoffLimit: Infinity, delay: () => 10 },
      })
      .json<{ ok: boolean }>();

    expect(data.ok).toBe(true);
    expect(requestCounts['/retry-after']).toBe(2);
  });
});
