// Guard against shipping app.asar without a JavaScript module required by main.js.
// Electron-builder's explicit build.files whitelist excludes new files unless added.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const desktop = path.resolve(__dirname, '..');
const manifest = require(path.join(desktop, 'package.json'));
const included = manifest.build.files;
const source = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const rootModules = [...source.matchAll(/require\(['"](\.\/[^'"/]+)['"]\)/g)].map(m => m[1]);
for (const relativeModule of rootModules) {
  const filename = `${relativeModule.slice(2)}.js`;
  assert.ok(fs.existsSync(path.join(desktop, filename)), `Runtime module missing from source: ${filename}`);
  assert.ok(included.includes(filename), `Electron installer omits runtime module: ${filename}`);
}
console.log('desktop packaged runtime file whitelist: PASS');
