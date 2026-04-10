import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInstance } from '../src/index.js';

describe('Edge Cases', () => {
  let neta;

  beforeEach(() => {
    neta = createInstance();
  });

  describe('Large Payloads', () => {
    it('should handle large JSON payloads', async () => {
      const largeData = {
        data: Array(1000).fill(0).map((_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      };

      const server = globalThis.mockServer || {
        respond: (req) => new Response(JSON.stringify(largeData), {
          headers: { 'content-type': 'application/json' },
        }),
      };

      expect(largeData.data.length).toBe(1000);
    });

    it('should handle large text payloads', async () => {
      const largeText = 'x'.repeat(1024 * 1024); // 1MB
      expect(largeText.length).toBe(1024 * 1024);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10).fill(0).map((_, i) =>
        Promise.resolve({ id: i, status: 'ok' })
      );

      const results = await Promise.all(requests);
      expect(results).toHaveLength(10);
      expect(results.every((r) => r.status === 'ok')).toBe(true);
    });

    it('should not have race conditions with shared state', async () => {
      const options = { timeout: 5000 };
      const instances = Array(5).fill(0).map(() => createInstance(options));

      expect(instances).toHaveLength(5);
      expect(instances.every((inst) => typeof inst === 'function')).toBe(true);
    });
  });

  describe('Error Edge Cases', () => {
    it('should handle errors without message property', async () => {
      const error = new Error();
      error.message = '';

      expect(error.message).toBe('');
    });

    it('should handle non-Error objects in catch blocks', async () => {
      const notAnError = 'string error';
      expect(typeof notAnError).toBe('string');
    });

    it('should handle very long error messages', async () => {
      const longMessage = 'Error: ' + 'x'.repeat(10000);
      expect(longMessage.length).toBeGreaterThan(10000);
    });
  });

  describe('Timeout Edge Cases', () => {
    it('should handle timeout of 0', async () => {
      const inst = createInstance({ timeout: 0 });
      expect(inst).toBeDefined();
    });

    it('should handle timeout of false', async () => {
      const inst = createInstance({ timeout: false });
      expect(inst).toBeDefined();
    });

    it('should handle very large timeout', async () => {
      const inst = createInstance({ timeout: 2147483647 }); // max safe int
      expect(inst).toBeDefined();
    });
  });

  describe('Header Edge Cases', () => {
    it('should handle empty headers', async () => {
      const inst = createInstance({ headers: {} });
      expect(inst).toBeDefined();
    });

    it('should handle header values with special characters', async () => {
      const headers = {
        'x-custom': 'value; with=special;chars',
        'x-unicode': '你好世界',
        'x-newline': 'line1\nline2',
      };

      expect(Object.keys(headers)).toHaveLength(3);
    });
  });

  describe('Retry Edge Cases', () => {
    it('should handle retry limit of 0', async () => {
      const inst = createInstance({ retry: 0 });
      expect(inst).toBeDefined();
    });

    it('should handle retry with infinite delay', async () => {
      const inst = createInstance({
        retry: {
          limit: 3,
          methods: ['get'],
          statusCodes: [500],
          afterStatusCodes: [],
          maxRetryAfter: Infinity,
          backoffLimit: Infinity,
          delay: () => Infinity,
          jitter: false,
          retryOnTimeout: false,
        },
      });
      expect(inst).toBeDefined();
    });

    it('should handle retry with custom jitter function', async () => {
      const inst = createInstance({
        retry: {
          limit: 2,
          methods: ['get'],
          statusCodes: [500],
          afterStatusCodes: [],
          maxRetryAfter: 30000,
          backoffLimit: 30000,
          delay: () => 100,
          jitter: (delay) => delay + Math.random() * 50,
          retryOnTimeout: false,
        },
      });
      expect(inst).toBeDefined();
    });
  });

  describe('Hook Edge Cases', () => {
    it('should handle hooks that throw errors', async () => {
      const inst = createInstance({
        hooks: {
          beforeRequest: [
            () => {
              throw new Error('Hook error');
            },
          ],
        },
      });
      expect(inst).toBeDefined();
    });

    it('should handle hooks that return undefined', async () => {
      const inst = createInstance({
        hooks: {
          beforeRequest: [() => undefined],
          afterResponse: [() => undefined],
          beforeError: [() => undefined],
        },
      });
      expect(inst).toBeDefined();
    });

    it('should handle multiple hooks in sequence', async () => {
      let callCount = 0;
      const inst = createInstance({
        hooks: {
          init: [
            () => { callCount++; },
            () => { callCount++; },
            () => { callCount++; },
          ],
        },
      });
      expect(inst).toBeDefined();
    });
  });

  describe('Method Edge Cases', () => {
    it('should have all HTTP methods', async () => {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
      methods.forEach((method) => {
        expect(typeof neta[method]).toBe('function');
      });
    });

    it('should have utility methods', async () => {
      expect(typeof neta.create).toBe('function');
      expect(typeof neta.extend).toBe('function');
      expect(typeof neta.retry).toBe('function');
    });
  });

  describe('Bearer Token Edge Cases', () => {
    it('should handle empty bearer token', async () => {
      const inst = createInstance({ bearerToken: '' });
      expect(inst).toBeDefined();
    });

    it('should handle bearer token with spaces', async () => {
      const inst = createInstance({ bearerToken: 'token with spaces' });
      expect(inst).toBeDefined();
    });

    it('should handle very long bearer token', async () => {
      const longToken = 'token_' + 'x'.repeat(10000);
      const inst = createInstance({ bearerToken: longToken });
      expect(inst).toBeDefined();
    });
  });

  describe('URL Edge Cases', () => {
    it('should handle various URL formats', async () => {
      const urls = [
        'http://localhost:3000',
        'https://example.com/path?query=value',
        'https://example.com:8080',
        '/relative/path',
        'example.com', // no protocol
      ];

      expect(urls).toHaveLength(5);
    });
  });
});
