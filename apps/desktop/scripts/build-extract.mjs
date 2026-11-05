import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src', 'lib', 'extract.js')],
  outfile: path.join(root, 'dist', 'extract.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});