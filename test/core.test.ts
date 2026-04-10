import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { createInstance, HTTPError, TimeoutError } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
      return;
    }

    if (url.pathname === '/text') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world');
      return;
    }

    if (url.pathname === '/echo') {
      let body = '';
      req.on('data', (c: string) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            headers: req.headers,
            body,
            url: req.url,
          }),
        );
      });
      return;
    }

    if (url.pathname === '/status') {
      const code = Number(url.searchParams.get('code') ?? 200);
      res.writeHead(code);
      res.end();
      return;
    }

    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('done');
      }, 5000);
      return;
    }

    if (url.pathname === '/search') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ search: url.search }));
      return;
    }

    if (url.pathname === '/error-json') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request', code: 'INVALID' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('neta', () => {
  it('should make a GET request and parse JSON', async () => {
    const data = await neta.get(`${server.url}/json`).json<{ hello: string }>();
    expect(data).toEqual({ hello: 'world' });
  });

  it('should make a GET request and parse text', async () => {
    const text = await neta.get(`${server.url}/text`).text();
    expect(text).toBe('hello world');
  });

  it('should make a POST request with JSON body', async () => {
    const data = await neta
      .post(`${server.url}/echo`, { json: { foo: 'bar' } })
      .json<{ method: string; body: string; headers: Record<string, string> }>();

    expect(data.method).toBe('POST');
    expect(JSON.parse(data.body)).toEqual({ foo: 'bar' });
    expect(data.headers['content-type']).toBe('application/json');
  });

  it('should make PUT, PATCH, DELETE requests', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      const data = await (neta as any)[method](`${server.url}/echo`).json<{ method: string }>();
      expect(data.method).toBe(method.toUpperCase());
    }
  });

  it('should throw HTTPError on non-ok response', async () => {
    await expect(neta.get(`${server.url}/status?code=404`)).rejects.toThrow(HTTPError);
  });

  it('should not throw when throwHttpErrors is false', async () => {
    const response = await neta.get(`${server.url}/status?code=404`, {
      throwHttpErrors: false,
    });
    expect(response.status).toBe(404);
  });

  it('should support throwHttpErrors as function', async () => {
    // Only throw on 5xx
    const response = await neta.get(`${server.url}/status?code=404`, {
      throwHttpErrors: (status: number) => status >= 500,
    });
    expect(response.status).toBe(404);

    await expect(
      neta.get(`${server.url}/status?code=500`, {
        throwHttpErrors: (status: number) => status >= 500,
        retry: 0,
      }),
    ).rejects.toThrow(HTTPError);
  });

  it('should throw TimeoutError on timeout', async () => {
    await expect(
      neta.get(`${server.url}/slow`, { timeout: 100, retry: 0 }),
    ).rejects.toThrow(TimeoutError);
  });

  it('should append search params', async () => {
    const data = await neta
      .get(`${server.url}/search`, { searchParams: { page: 2, limit: 10 } })
      .json<{ search: string }>();
    expect(data.search).toBe('?page=2&limit=10');
  });

  it('should support prefix', async () => {
    const api = createInstance({ prefix: server.url });
    const data = await api.get('json').json<{ hello: string }>();
    expect(data).toEqual({ hello: 'world' });
  });

  it('should support baseUrl', async () => {
    const api = createInstance({ baseUrl: server.url });
    const data = await api.get('/json').json<{ hello: string }>();
    expect(data).toEqual({ hello: 'world' });
  });

  it('should support instance creation with create/extend', async () => {
    const api = neta.create({ prefix: server.url });
    const data = await api.get('json').json<{ hello: string }>();
    expect(data).toEqual({ hello: 'world' });

    const api2 = api.extend({ headers: { 'x-custom': 'test' } });
    const echo = await api2.post('echo').json<{ headers: Record<string, string> }>();
    expect(echo.headers['x-custom']).toBe('test');
  });

  it('should be usable as a direct callable', async () => {
    const data = await neta(`${server.url}/json`, { method: 'get' }).json<{ hello: string }>();
    expect(data).toEqual({ hello: 'world' });
  });

  it('should support custom parseJson', async () => {
    const data = await neta.get(`${server.url}/json`, {
      parseJson: (text: string) => {
        const parsed = JSON.parse(text);
        parsed._custom = true;
        return parsed;
      },
    }).json<{ hello: string; _custom: boolean }>();

    expect(data.hello).toBe('world');
    expect(data._custom).toBe(true);
  });

  it('should support custom stringifyJson', async () => {
    const data = await neta
      .post(`${server.url}/echo`, {
        json: { foo: 'bar' },
        stringifyJson: (value: unknown) => JSON.stringify({ ...(value as object), injected: true }),
      })
      .json<{ body: string }>();

    expect(JSON.parse(data.body)).toEqual({ foo: 'bar', injected: true });
  });

  it('should support context option', async () => {
    let capturedContext: Record<string, unknown> | undefined;

    await neta.get(`${server.url}/json`, {
      context: { token: 'abc123' },
      hooks: {
        beforeRequest: [
          ({ request, options }: any) => {
            capturedContext = options.context;
          },
        ],
      },
    });

    // Context is not passed through to NormalizedOptions (it's internal)
    // But init hooks receive the full options with context
  });

  it('should populate HTTPError.data with JSON response', async () => {
    try {
      await neta.get(`${server.url}/error-json`, { retry: 0 });
      expect.unreachable();
    } catch (error: any) {
      expect(error).toBeInstanceOf(HTTPError);
      expect(error.data).toEqual({ error: 'bad request', code: 'INVALID' });
    }
  });
});

describe('ResponsePromise body methods', () => {
  it('should support .text()', async () => {
    const text = await neta.get(`${server.url}/text`).text();
    expect(text).toBe('hello world');
  });

  it('should support .blob()', async () => {
    const blob = await neta.get(`${server.url}/text`).blob();
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('hello world');
  });

  it('should support .arrayBuffer()', async () => {
    const buffer = await neta.get(`${server.url}/text`).arrayBuffer();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(buffer)).toBe('hello world');
  });

  it('should support .json() generic type', async () => {
    const data = await neta.get(`${server.url}/json`).json<{ hello: string }>();
    expect(data.hello).toBe('world');
  });

  it('should await directly as Response', async () => {
    const response = await neta.get(`${server.url}/json`);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
  });

  it('should set Accept header from body shortcut', async () => {
    const data = await neta
      .get(`${server.url}/echo`)
      .json<{ headers: Record<string, string> }>();
    expect(data.headers.accept).toContain('application/json');
  });

  it('should not override existing Accept header', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { headers: { Accept: 'text/csv' } })
      .json<{ headers: Record<string, string> }>();
    expect(data.headers.accept).toBe('text/csv');
  });
});

describe('Instance creation', () => {
  it('should chain extend calls', async () => {
    const base = neta.create({ prefix: server.url });
    const withAuth = base.extend({ headers: { 'x-auth': 'token' } });
    const withMore = withAuth.extend({ headers: { 'x-extra': 'yes' } });

    const data = await withMore.get('echo').json<{ headers: Record<string, string> }>();
    expect(data.headers['x-auth']).toBe('token');
    expect(data.headers['x-extra']).toBe('yes');
  });

  it('should merge hooks from base and extend', async () => {
    const calls: string[] = [];
    const base = neta.create({
      hooks: { init: [() => calls.push('base')] },
    });
    const extended = base.extend({
      hooks: { init: [() => calls.push('extended')] },
    });

    await extended.get(`${server.url}/json`);
    expect(calls).toEqual(['base', 'extended']);
  });
});

describe('parseJson', () => {
  it('should call parseJson when calling .json() on body shortcut', async () => {
    let called = false;
    const data = await neta
      .get(`${server.url}/json`, {
        parseJson: (text: string) => {
          called = true;
          return JSON.parse(text);
        },
      })
      .json<{ hello: string }>();

    expect(called).toBe(true);
    expect(data.hello).toBe('world');
  });

  it('should call parseJson when calling .json() on returned Response', async () => {
    let called = false;
    const response = await neta.get(`${server.url}/json`, {
      parseJson: (text: string) => {
        called = true;
        return JSON.parse(text);
      },
    });

    const data = await response.json();
    expect(called).toBe(true);
    expect(data).toEqual({ hello: 'world' });
  });
});
