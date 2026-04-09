import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { HTTPError } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/echo-headers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ headers: req.headers }));
      return;
    }

    if (req.url === '/error') {
      res.writeHead(500);
      res.end('Internal Server Error');
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
  it('beforeRequest hook can modify request', async () => {
    const data = await neta
      .get(`${server.url}/echo-headers`, {
        hooks: {
          beforeRequest: [
            (request) => {
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
          (_req, _opts, response) => {
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

  it('beforeError hook can modify error', async () => {
    try {
      await neta.get(`${server.url}/error`, {
        retry: 0,
        hooks: {
          beforeError: [
            (error) => {
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
});
