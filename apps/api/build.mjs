// Bundles the API (and workspace packages) into a single ESM file for the Docker image.
// better-sqlite3 is a native addon: it stays external and the image ships it next to the bundle.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  sourcemap: true,
  legalComments: 'none',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
