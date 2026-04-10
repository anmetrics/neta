import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, {
  HTTPError,
  TimeoutError,
  NetworkError,
  SchemaValidationError,
  NetaError,
} from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname === '/json-error') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'BAD_REQUEST', detail: 'Invalid input' }));
      return;
    }

    if (url.pathname === '/text-error') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error text');
      return;
    }

    if (url.pathname === '/empty-error') {
      res.writeHead(500);
      res.end();
      return;
    }

    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 5000);
      return;
    }

    res.writeHead(404);
    res.end();
  });
});

afterAll(async () => {
  await server.close();
});

describe('HTTPError', () => {
  it('should be instance of HTTPError and Error', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('NetaError should alias HTTPError', () => {
    expect(NetaError).toBe(HTTPError);
  });

  it('should have code ERR_HTTP_ERROR', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.code).toBe('ERR_HTTP_ERROR');
    }
  });

  it('should have .response property readable after catch (no body consumed)', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
      expect.unreachable();
    } catch (error: any) {
      expect(error.response).toBeInstanceOf(Response);
      expect(error.response.status).toBe(400);

      // Fix verification: body should still be readable
      const text = await error.response.text();
      expect(text).toContain('BAD_REQUEST');
    }
  });

  it('should parse error data as JSON for JSON responses', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.data).toEqual({ code: 'BAD_REQUEST', detail: 'Invalid input' });
    }
  });

  it('should keep error data as text for non-JSON responses', async () => {
    try {
      await neta.get(`${server.url}/text-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.data).toBe('Internal server error text');
    }
  });

  it('should have .data = undefined for empty response body', async () => {
    try {
      await neta.get(`${server.url}/empty-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.data).toBeUndefined();
    }
  });

  it('should have .request reference', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.request).toBeInstanceOf(Request);
      expect(error.request.method).toBe('GET');
    }
  });

  it('should have .status property', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.status).toBe(400);
    }
  });

  it('should have descriptive message with status and URL', async () => {
    try {
      await neta.get(`${server.url}/json-error`, { retry: 0 });
    } catch (error: any) {
      expect(error.message).toContain('400');
      expect(error.message).toContain('GET');
    }
  });
});

describe('TimeoutError', () => {
  it('should be instance of TimeoutError and Error', async () => {
    try {
      await neta.get(`${server.url}/slow`, { timeout: 50, retry: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should have code ERR_TIMEOUT', async () => {
    try {
      await neta.get(`${server.url}/slow`, { timeout: 50, retry: 0 });
    } catch (error: any) {
      expect(error.code).toBe('ERR_TIMEOUT');
    }
  });

  it('should have .request reference', async () => {
    try {
      await neta.get(`${server.url}/slow`, { timeout: 50, retry: 0 });
    } catch (error: any) {
      expect(error.request).toBeInstanceOf(Request);
    }
  });
});

describe('NetworkError', () => {
  it('should be instance of NetworkError and Error', async () => {
    try {
      await neta.get('http://127.0.0.1:1/nothing', { retry: 0, timeout: 2000 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should have code ERR_NETWORK', async () => {
    try {
      await neta.get('http://127.0.0.1:1/nothing', { retry: 0, timeout: 2000 });
    } catch (error: any) {
      expect(error.code).toBe('ERR_NETWORK');
    }
  });

  it('should have cause from original error', async () => {
    try {
      await neta.get('http://127.0.0.1:1/nothing', { retry: 0, timeout: 2000 });
    } catch (error: any) {
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});

describe('SchemaValidationError', () => {
  it('should be instance of SchemaValidationError', async () => {
    const failingSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({
          issues: [{ message: 'Expected string', path: ['name'] }],
        }),
      },
    };

    try {
      await neta.get(`${server.url}/json-error`, { retry: 0, throwHttpErrors: false }).json(failingSchema as any);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
    }
  });

  it('should have .issues property', async () => {
    const failingSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({
          issues: [{ message: 'Expected string', path: ['name'] }],
        }),
      },
    };

    try {
      await neta.get(`${server.url}/json-error`, { retry: 0, throwHttpErrors: false }).json(failingSchema as any);
    } catch (error: any) {
      expect(error.issues).toEqual([{ message: 'Expected string', path: ['name'] }]);
    }
  });

  it('should have code ERR_SCHEMA_VALIDATION', async () => {
    const failingSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'bad' }] }),
      },
    };

    try {
      await neta.get(`${server.url}/json-error`, { retry: 0, throwHttpErrors: false }).json(failingSchema as any);
    } catch (error: any) {
      expect(error.code).toBe('ERR_SCHEMA_VALIDATION');
    }
  });

  it('should throw TypeError for invalid schema', async () => {
    await expect(
      (neta.get(`${server.url}/json-error`, { retry: 0, throwHttpErrors: false }).json as any)({}),
    ).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for null schema', async () => {
    await expect(
      (neta.get(`${server.url}/json-error`, { retry: 0, throwHttpErrors: false }).json as any)(null),
    ).rejects.toThrow(TypeError);
  });
});
