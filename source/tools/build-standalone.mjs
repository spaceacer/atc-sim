// `npm run build:standalone`: bundles the whole game into ONE html file,
// ATC-Sim-<version>.html (version from package.json, e.g. ATC-Sim-0.5.0.html),
// with the script and stylesheet inlined. It runs by
// double-clicking (file://), no server needed: browsers only block
// *separate* module files on file://, not an inline script.

import { build } from 'esbuild';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const file = `ATC-Sim-${version}.html`;

const result = await build({
  entryPoints: ['src/ui/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/ui/style.css', 'utf8');

const html = readFileSync('index.html', 'utf8')
  .replace(/<link rel="stylesheet" href="\.\/src\/ui\/style\.css" \/>/, () => `<style>\n${css}</style>`)
  .replace(/<script type="module" src="\.\/src\/ui\/main\.ts"><\/script>/, () => `<script>\n${js}</script>`);

if (html.includes('src/ui/')) throw new Error('index.html changed shape: an asset was not inlined');
if (!html.includes(`content="${version}"`)) throw new Error(`index.html version meta does not match package.json ${version}`);
// Remove builds of other versions so only the current one is left to double-click.
for (const old of readdirSync('.')) {
  if (/^ATC-Sim(-\d+\.\d+\.\d+)?\.html$/.test(old) && old !== file) unlinkSync(old);
}
writeFileSync(file, html);
console.log(`${file} written (${Math.round(html.length / 1024)} KB). Double-click it to play.`);
