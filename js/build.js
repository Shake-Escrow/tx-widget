import * as esbuild from 'esbuild';

const dev   = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const shared = {
  entryPoints: ['src/index.js'],
  bundle:      true,
  minify:      !dev,
  sourcemap:   true,
  external:    [],   // viem bundled in — widget is self-contained
};

const configs = [
  // ESM — for npm consumers (React, Vue, etc.)
  {
    ...shared,
    format:    'esm',
    outfile:   'dist/index.js',
    platform:  'browser',
  },
  // CJS — for CommonJS consumers
  {
    ...shared,
    format:    'cjs',
    outfile:   'dist/index.cjs',
    platform:  'browser',
  },
  // IIFE — for <script src="…"> usage; exposes window.Xmagnet
  {
    ...shared,
    format:       'iife',
    globalName:   '__PlatformWidget',  // assigned but also sets window.Xmagnet internally
    outfile:      'dist/platform.js',
    platform:     'browser',
    target:       ['es2020', 'chrome80', 'firefox78', 'safari14'],
  },
];

if (watch) {
  const contexts = await Promise.all(configs.map(c => esbuild.context(c)));
  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log('[esbuild] watching for changes…');
} else {
  await Promise.all(configs.map(c => esbuild.build(c)));
  console.log('[esbuild] build complete');
}
