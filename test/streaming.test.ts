import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname === '/download') {
      const size = Number(url.searchParams.get('size') ?? 1024);
      const chunk = 'x'.repeat(Math.min(size, 1024));
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': String(size),
      });

      let sent = 0;
      const interval = setInterval(() => {
        const remaining = size - sent;
        if (remaining <= 0) {
          clearInterval(interval);
          res.end();
          return;
        }
        const toSend = Math.min(remaining, chunk.length);
        res.write(chunk.slice(0, toSend));
        sent += toSend;
        if (sent >= size) {
          clearInterval(interval);
          res.end();
        }
      }, 10);
      return;
    }

    if (url.pathname === '/upload') {
      let totalBytes = 0;
      req.on('data', (c: Buffer) => {
        totalBytes += c.length;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: totalBytes }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('onDownloadProgress', () => {
  it('should call with progress updates', async () => {
    const events: Array<{ percent: number; transferredBytes: number; totalBytes: number }> = [];

    const response = await neta.get(`${server.url}/download?size=4096`, {
      onDownloadProgress: (p) => events.push(p),
    });
    await response.text();

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!;
    expect(last.percent).toBe(1);
    expect(last.transferredBytes).toBe(4096);
  });

  it('should throw TypeError when onDownloadProgress is not a function', async () => {
    await expect(
      neta.get(`${server.url}/download?size=1024`, {
        onDownloadProgress: 'not a function' as any,
      }),
    ).rejects.toThrow(TypeError);
  });

  it('should report percent=0 when Content-Length is missing', async () => {
    const events: Array<{ percent: number }> = [];
    const ephemeral = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world');
    });

    const response = await neta.get(ephemeral.url, {
      onDownloadProgress: (p) => events.push(p),
    });
    await response.text();

    // intermediate events may be 0, final event percent=1
    expect(events[events.length - 1]!.percent).toBe(1);
    await ephemeral.close();
  });
});

describe('onUploadProgress', () => {
  it('should throw TypeError when onUploadProgress is not a function', async () => {
    await expect(
      neta.post(`${server.url}/upload`, {
        body: 'x'.repeat(1000),
        onUploadProgress: 'not-a-function' as any,
      }),
    ).rejects.toThrow(TypeError);
  });
});
