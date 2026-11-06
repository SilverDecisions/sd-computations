# sd-computations
SilverDecisions computations module

[![codecov](https://codecov.io/gh/SilverDecisions/sd-computations/branch/master/graph/badge.svg)](https://codecov.io/gh/SilverDecisions/sd-computations)

## Built files

`dist/` is committed and rebuilt by the release (`npm run build`, Rollup):

| File | Format |
|---|---|
| `dist/sd-computations.js`, `.min.js` (+ `.map`) | defines a global `require` exposing `require('sd-computations')`; `sd-utils`, `sd-random`, `sd-model` and `sd-expression-engine` come from the global `require` of their own `dist/` bundles (loaded before or after it, e.g. in a job worker), idb is bundled |
| `dist/sd-computations-vendor.js`, `.min.js` (+ `.map`) | the same format for `require('idb')`; loaded by the Karma tests and their job worker |
| `dist/standalone/sd-computations.js`, `.min.js` (+ `.map`) | UMD: CommonJS, AMD or the global `SilverDecisions.Computations`; everything bundled |

The plain files carry an inline source map, the minified ones a `.map` file;
all are ES5. Consumers that bundle the sources (SilverDecisions) compile them
with the `browserify.transform` field of `package.json`; the build compiles
`src/` and idb with the same Babel options and the sd-* packages with their own.

## Development

Node 24 (`.nvmrc`); CI also builds and tests on Node 22.

```bash
npm ci
npm run build        # clean dist/, Rollup (rollup.config.mjs)
npm test             # Karma specs in headless Chrome (src/ with dist/sd-computations-vendor.js), incl. job worker specs
npm run test:build   # isolated build check, see scripts/check-build.js
npm run docs         # doc/API.md from src/computations-manager.js
```

`npm test` writes `test/data-json-filelist.json` (the fixtures the specs load)
and needs Chrome (`CHROME_BIN`). Build in a copy (or use `npm run test:build`)
unless you are preparing a release: the build rewrites the committed `dist/`.
