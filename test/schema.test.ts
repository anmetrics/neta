import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neta, { SchemaValidationError } from '../src/index.js';
import { createTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 42, name: 'Alice' }));
  });
});

afterAll(async () => {
  await server.close();
});

// Minimal Standard Schema implementations for testing
function stringSchema() {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: unknown) => {
        if (typeof value !== 'string') {
          return { issues: [{ message: 'Expected string', path: [] }] };
        }
        return { value };
      },
    },
  };
}

function objectSchema(shape: Record<string, 'string' | 'number'>) {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: unknown) => {
        const issues: Array<{ message: string; path: Array<string> }> = [];
        if (typeof value !== 'object' || value === null) {
          return { issues: [{ message: 'Expected object', path: [] }] };
        }
        for (const [key, expectedType] of Object.entries(shape)) {
          const actual = (value as Record<string, unknown>)[key];
          if (typeof actual !== expectedType) {
            issues.push({ message: `Expected ${expectedType}`, path: [key] });
          }
        }
        return issues.length > 0 ? { issues } : { value };
      },
    },
  };
}

describe('Standard Schema validation', () => {
  it('should validate and return typed value when schema passes', async () => {
    const schema = objectSchema({ id: 'number', name: 'string' });
    const data = await neta.get(server.url).json(schema as any);
    expect(data).toEqual({ id: 42, name: 'Alice' });
  });

  it('should throw SchemaValidationError with issues when validation fails', async () => {
    const schema = objectSchema({ id: 'string', name: 'number' });

    try {
      await neta.get(server.url).json(schema as any);
      expect.unreachable();
    } catch (error: any) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect(error.issues).toHaveLength(2);
      expect(error.issues[0].path).toEqual(['id']);
    }
  });

  it('should support async validate function', async () => {
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value: unknown) => {
          await new Promise((r) => setTimeout(r, 10));
          return { value };
        },
      },
    };

    const data = await neta.get(server.url).json(schema as any);
    expect(data).toEqual({ id: 42, name: 'Alice' });
  });

  it('should throw TypeError for object without ~standard', async () => {
    await expect(neta.get(server.url).json({} as any)).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for null schema', async () => {
    await expect(neta.get(server.url).json(null as any)).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for schema missing validate function', async () => {
    const badSchema = { '~standard': { version: 1, vendor: 'test' } };
    await expect(neta.get(server.url).json(badSchema as any)).rejects.toThrow(TypeError);
  });

  it('should pass returned value through for non-identity transforms', async () => {
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (_value: unknown) => ({ value: 'transformed' }),
      },
    };

    const data = await neta.get(server.url).json(schema as any);
    expect(data).toBe('transformed');
  });

  // stringSchema is defined for symmetry — not used in current tests
  void stringSchema;
});
