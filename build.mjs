// node build.mjs [--version=0.1.0] [--watch]
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const version = arg('version', '0.0.0-dev');
const banner = readFileSync('meta.js', 'utf8').replace(/^(\/\/ @version\s+).*$/m, `$1${version}`);

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'chrome121',
  minify: false,
  charset: 'utf8',
  banner: { js: banner },
  outfile: 'dist/mullive-plusplus.user.js',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`watching... (version ${version})`);
} else {
  await esbuild.build(options);
  console.log(`built dist/mullive-plusplus.user.js (version ${version})`);
}
