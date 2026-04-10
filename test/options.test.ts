import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { createInstance } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname === '/echo') {
      let body = '';
      req.on('data', (c: string) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          headers: req.headers,
          body,
          url: req.url,
          path: url.pathname,
          search: url.search,
        }));
      });
      return;
    }

    if (url.pathname === '/v1/users' || url.pathname === '/v2/users' || url.pathname === '/users') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: url.pathname }));
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('bearerToken', () => {
  it('should set Authorization header', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { bearerToken: 'abc123' })
      .json<{ headers: Record<string, string> }>();

    expect(data.headers.authorization).toBe('Bearer abc123');
  });

  it('should not override existing Authorization header', async () => {
    const data = await neta
      .get(`${server.url}/echo`, {
        bearerToken: 'abc123',
        headers: { Authorization: 'Basic xyz' },
      })
      .json<{ headers: Record<string, string> }>();

    expect(data.headers.authorization).toBe('Basic xyz');
  });

  it('should work with create/extend', async () => {
    const api = neta.create({ prefix: server.url, bearerToken: 'inherited' });
    const data = await api.get('echo').json<{ headers: Record<string, string> }>();
    expect(data.headers.authorization).toBe('Bearer inherited');
  });

  it('should allow extend to override bearerToken', async () => {
    const base = neta.create({ prefix: server.url, bearerToken: 'first' });
    const extended = base.extend({ bearerToken: 'second' });
    const data = await extended.get('echo').json<{ headers: Record<string, string> }>();
    expect(data.headers.authorization).toBe('Bearer second');
  });
});

describe('searchParams', () => {
  it('should accept plain object', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: { q: 'hello', page: 2 } })
      .json<{ search: string }>();
    expect(data.search).toBe('?q=hello&page=2');
  });

  it('should accept URLSearchParams instance', async () => {
    const params = new URLSearchParams({ a: '1', b: '2' });
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: params })
      .json<{ search: string }>();
    expect(data.search).toContain('a=1');
    expect(data.search).toContain('b=2');
  });

  it('should accept array of [key, value] pairs', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: [['a', '1'], ['a', '2']] })
      .json<{ search: string }>();
    expect(data.search).toContain('a=1');
    expect(data.search).toContain('a=2');
  });

  it('should accept string', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: 'foo=bar&baz=qux' })
      .json<{ search: string }>();
    expect(data.search).toBe('?foo=bar&baz=qux');
  });

  it('should accept string with leading ?', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: '?foo=bar' })
      .json<{ search: string }>();
    expect(data.search).toBe('?foo=bar');
  });

  it('should filter out undefined values', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: { a: 'present', b: undefined } })
      .json<{ search: string }>();
    expect(data.search).toContain('a=present');
    expect(data.search).not.toContain('b=');
  });

  it('should coerce non-string values', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { searchParams: { num: 42, bool: true } })
      .json<{ search: string }>();
    expect(data.search).toContain('num=42');
    expect(data.search).toContain('bool=true');
  });

  it('should append to existing URL search params', async () => {
    const data = await neta
      .get(`${server.url}/echo?existing=1`, { searchParams: { added: '2' } })
      .json<{ search: string }>();
    expect(data.search).toContain('existing=1');
    expect(data.search).toContain('added=2');
  });
});

describe('prefix', () => {
  it('should prepend prefix to relative input', async () => {
    const api = createInstance({ prefix: `${server.url}/v1` });
    const data = await api.get('users').json<{ path: string }>();
    expect(data.path).toBe('/v1/users');
  });

  it('should strip trailing slash from prefix', async () => {
    const api = createInstance({ prefix: `${server.url}/v1/` });
    const data = await api.get('users').json<{ path: string }>();
    expect(data.path).toBe('/v1/users');
  });

  it('should strip leading slash from path', async () => {
    const api = createInstance({ prefix: `${server.url}/v1` });
    const data = await api.get('/users').json<{ path: string }>();
    expect(data.path).toBe('/v1/users');
  });
});

describe('baseUrl', () => {
  it('should resolve relative paths', async () => {
    const api = createInstance({ baseUrl: `${server.url}/v2/` });
    const data = await api.get('users').json<{ path: string }>();
    expect(data.path).toBe('/v2/users');
  });

  it('should resolve ../ paths', async () => {
    const api = createInstance({ baseUrl: `${server.url}/v2/sub/` });
    const data = await api.get('../users').json<{ path: string }>();
    expect(data.path).toBe('/v2/users');
  });

  it('should preserve absolute URLs', async () => {
    const api = createInstance({ baseUrl: `${server.url}/v2/` });
    const data = await api.get(`${server.url}/v1/users`).json<{ path: string }>();
    expect(data.path).toBe('/v1/users');
  });
});

describe('context', () => {
  it('should pass context to hooks', async () => {
    let capturedContext: unknown;

    await neta.get(`${server.url}/echo`, {
      context: { userId: '42', role: 'admin' },
      hooks: {
        init: [
          (options: any) => {
            capturedContext = options.context;
          },
        ],
      },
    });

    expect(capturedContext).toEqual({ userId: '42', role: 'admin' });
  });

  it('should not send context as part of request', async () => {
    const data = await neta
      .get(`${server.url}/echo`, { context: { secret: 'not-sent' } })
      .json<{ body: string; headers: Record<string, string> }>();

    expect(data.body).toBe('');
    expect(JSON.stringify(data.headers)).not.toContain('not-sent');
  });
});

describe('custom fetch', () => {
  it('should use provided fetch implementation', async () => {
    let customFetchCalled = false;
    const customFetch = async (input: any, init: any) => {
      customFetchCalled = true;
      return globalThis.fetch(input, init);
    };

    const api = createInstance({ fetch: customFetch });
    await api.get(`${server.url}/echo`).json();

    expect(customFetchCalled).toBe(true);
  });
});

describe('input types', () => {
  it('should accept URL object as input', async () => {
    const url = new URL(`${server.url}/echo`);
    const data = await neta.get(url).json<{ method: string }>();
    expect(data.method).toBe('GET');
  });

  it('should accept Request object as input', async () => {
    const req = new Request(`${server.url}/echo`, { method: 'POST' });
    const data = await neta(req, { method: 'post' }).json<{ method: string }>();
    expect(data.method).toBe('POST');
  });
});

describe('throwHttpErrors', () => {
  it('should not throw when false and return response', async () => {
    const server2 = await createTestServer((_req, res) => {
      res.writeHead(500);
      res.end('server error');
    });

    const response = await neta.get(server2.url, { throwHttpErrors: false, retry: 0 });
    expect(response.status).toBe(500);

    await server2.close();
  });
});
