import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.js'],
  format: ['esm', 'cjs'],
  clean: true,
  target: 'es2022',
  sourcemap: true,
  splitting: false,
  minify: true,
});
