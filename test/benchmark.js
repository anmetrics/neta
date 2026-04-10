/**
 * Performance Benchmark for Neta
 * Measures performance under various scenarios
 */

import { createInstance } from '../src/index.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatTime(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function benchmark(name, fn, iterations = 1000) {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    await fn();
  }

  const end = performance.now();
  const total = end - start;
  const avg = total / iterations;

  log(`${name}: ${formatTime(total)} (${iterations} iterations, avg: ${formatTime(avg)})`, 'green');
  return { total, avg, iterations };
}

async function run() {
  log('\n╔══════════════════════════════════════════════════════════╗', 'blue');
  log('║           Neta Performance Benchmark                    ║', 'blue');
  log('╚══════════════════════════════════════════════════════════╝\n', 'blue');

  log('Instance Creation Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  await benchmark('Create basic instance', () => {
    createInstance();
  }, 10000);

  await benchmark('Create instance with options', () => {
    createInstance({ timeout: 5000, retry: 3 });
  }, 10000);

  await benchmark('Create instance with hooks', () => {
    createInstance({
      hooks: {
        beforeRequest: [() => undefined],
        afterResponse: [() => undefined],
      },
    });
  }, 5000);

  log('\nInstance Extension Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  const base = createInstance();

  await benchmark('Extend instance', () => {
    base.extend({ timeout: 10000 });
  }, 5000);

  await benchmark('Create new instance from base', () => {
    base.create({ retry: 5 });
  }, 5000);

  log('\nHTTP Method Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const method of methods) {
    await benchmark(`Call ${method.toUpperCase()} method`, () => {
      try {
        base[method]('https://example.com');
      } catch {
        // Ignore network errors in benchmark
      }
    }, 5000);
  }

  log('\nRetry Configuration Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  await benchmark('Create instance with default retry', () => {
    createInstance({ retry: 3 });
  }, 5000);

  await benchmark('Create instance with custom retry config', () => {
    createInstance({
      retry: {
        limit: 5,
        methods: ['get', 'post'],
        statusCodes: [408, 429, 500, 502, 503],
        afterStatusCodes: [429, 503],
        maxRetryAfter: 30000,
        backoffLimit: 30000,
        delay: (attempt) => 300 * Math.pow(2, attempt - 1),
        jitter: (delay) => delay + Math.random() * delay * 0.1,
        retryOnTimeout: true,
      },
    });
  }, 3000);

  log('\nTimeout Configuration Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  await benchmark('Create instance with timeout', () => {
    createInstance({ timeout: 5000 });
  }, 5000);

  await benchmark('Create instance with totalTimeout', () => {
    createInstance({ timeout: 5000, totalTimeout: 30000 });
  }, 5000);

  log('\nHeader Configuration Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  const headers = {
    'x-custom-1': 'value1',
    'x-custom-2': 'value2',
    'x-custom-3': 'value3',
  };

  await benchmark('Create instance with headers', () => {
    createInstance({ headers });
  }, 5000);

  log('\nMemory Efficiency Benchmarks:', 'yellow');
  log('─────────────────────────────────────────────────────────', 'yellow');

  const initialMemory = process.memoryUsage();

  for (let i = 0; i < 1000; i++) {
    createInstance();
  }

  const finalMemory = process.memoryUsage();
  const heapUsed = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

  log(`Heap used for 1000 instances: ${heapUsed.toFixed(2)}MB`, 'green');

  log('\n╔══════════════════════════════════════════════════════════╗', 'blue');
  log('║                  Benchmark Complete                      ║', 'blue');
  log('╚══════════════════════════════════════════════════════════╝\n', 'blue');
}

run().catch((error) => {
  log(`Benchmark failed: ${error.message}`, 'red');
  process.exit(1);
});
