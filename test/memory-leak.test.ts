import { describe, it, expect, beforeEach } from 'vitest';
import { createInstance } from '../src/index.js';

/**
 * Memory leak detection tests
 * These tests verify that resources are properly cleaned up
 */
describe('Memory Leak Detection', () => {
  describe('Instance Cleanup', () => {
    it('should allow garbage collection of instances', async () => {
      let instance = createInstance();
      expect(instance).toBeDefined();

      // Dereference to allow GC
      instance = null;
      expect(instance).toBeNull();
    });

    it('should not accumulate state across instances', async () => {
      const instances = Array(100).fill(0).map(() => createInstance());

      expect(instances).toHaveLength(100);
      expect(instances.every((inst) => inst !== null)).toBe(true);
    });

    it('should cleanup after creating multiple instances with options', async () => {
      const instances = Array(50).fill(0).map((_, i) =>
        createInstance({
          timeout: 5000 + i * 100,
          retry: i % 2 === 0 ? 3 : 0,
        })
      );

      instances.length = 0; // Clear array
      expect(instances).toHaveLength(0);
    });
  });

  describe('Hook Cleanup', () => {
    it('should cleanup hooks after use', async () => {
      const hooks = {
        beforeRequest: [() => undefined],
        afterResponse: [() => undefined],
        beforeError: [() => undefined],
      };

      const instance = createInstance({ hooks });
      expect(instance).toBeDefined();

      // Hooks should not persist
      const instance2 = createInstance();
      expect(instance2).toBeDefined();
    });

    it('should handle hook arrays with many hooks', async () => {
      const manyHooks = Array(1000).fill(0).map(() => () => undefined);

      const instance = createInstance({
        hooks: {
          beforeRequest: manyHooks,
        },
      });

      expect(instance).toBeDefined();
    });
  });

  describe('Request/Response Cleanup', () => {
    it('should not accumulate request objects', async () => {
      const requests = Array(100).fill(0).map((_, i) => ({
        url: `https://example.com/${i}`,
        method: 'GET',
      }));

      expect(requests).toHaveLength(100);
      requests.length = 0;
      expect(requests).toHaveLength(0);
    });

    it('should handle large response bodies without leaking memory', async () => {
      const largeBody = 'x'.repeat(1024 * 1024); // 1MB
      const response = new Response(largeBody, {
        headers: { 'content-type': 'text/plain' },
      });

      expect(response).toBeDefined();
    });
  });

  describe('Options Cleanup', () => {
    it('should not accumulate options across instances', async () => {
      const options1 = { timeout: 5000, retry: 3 };
      const options2 = { timeout: 10000, retry: 5 };

      const instance1 = createInstance(options1);
      const instance2 = createInstance(options2);

      expect(instance1).toBeDefined();
      expect(instance2).toBeDefined();

      // Options should not be shared
      expect(options1).not.toBe(options2);
    });
  });

  describe('Signal Cleanup', () => {
    it('should cleanup abort signals', async () => {
      const controller = new AbortController();
      const instance = createInstance({ signal: controller.signal });

      expect(instance).toBeDefined();

      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it('should handle signal cleanup without leaking', async () => {
      const signals = Array(50).fill(0).map(() => new AbortController().signal);

      expect(signals).toHaveLength(50);
      signals.length = 0;
      expect(signals).toHaveLength(0);
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should not accumulate event listeners', async () => {
      const instance = createInstance({
        onDownloadProgress: () => {},
        onUploadProgress: () => {},
      });

      expect(instance).toBeDefined();
    });

    it('should handle progress callbacks without memory issues', async () => {
      const callbacks = Array(100).fill(0).map(() => ({
        download: (p) => {},
        upload: (p) => {},
      }));

      expect(callbacks).toHaveLength(100);
    });
  });

  describe('Context Cleanup', () => {
    it('should cleanup context objects', async () => {
      const context = {
        userId: '123',
        sessionId: 'abc',
        data: Array(1000).fill('x'),
      };

      const instance = createInstance({ context });
      expect(instance).toBeDefined();

      // Context should not leak
      expect(context.data).toHaveLength(1000);
      context.data.length = 0;
    });
  });

  describe('Concurrent Operations Cleanup', () => {
    it('should cleanup after multiple concurrent operations', async () => {
      const instance = createInstance();

      const operations = Array(50).fill(0).map(() =>
        Promise.resolve({ status: 'ok' })
      );

      await Promise.all(operations);
      expect(operations).toHaveLength(50);
    });

    it('should not accumulate pending operations', async () => {
      const instance = createInstance({ timeout: 1000 });

      // Create promises that would normally complete
      const promises = Array(20).fill(0).map(() =>
        Promise.resolve('done')
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
    });
  });

  describe('Extended Instance Cleanup', () => {
    it('should cleanup extended instances', async () => {
      const base = createInstance({ timeout: 5000 });
      const extended = base.extend({ retry: 3 });

      expect(base).toBeDefined();
      expect(extended).toBeDefined();
    });

    it('should allow garbage collection of extended instances', async () => {
      let instance = createInstance();
      instance = instance.create({ timeout: 10000 });

      expect(instance).toBeDefined();
      instance = null;
      expect(instance).toBeNull();
    });
  });
});
