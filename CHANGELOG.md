# Changelog

## Unreleased

Changes since `0.6.1`. The version number is not changed yet, and the
committed `dist/` is still the `0.6.1` build.

### Build

- The `dist/` bundles are built with Rollup and npm scripts instead of
  gulp/browserify (`npm run build`). Same files, formats, globals and export
  names: `dist/sd-computations(.min).js` (global `require` exposing
  `sd-computations`, sd-* external, idb bundled),
  `dist/sd-computations-vendor(.min).js` (`require('idb')`) and
  `dist/standalone/sd-computations(.min).js` (UMD
  `SilverDecisions.Computations`); ES5, inline source maps in the plain files,
  `.map` files for the minified ones (terser with `toplevel: false`, so the
  minified `require` bundles keep their state local).
- From `node_modules` the build compiles only idb with the package's Babel
  options, as the `ignore` pattern of the `browserify.transform` field intends
  (Babel 7 reads that string as a path, so the gulp build compiled every file);
  the sd-* packages are compiled with their own options, Math.js and the other
  dependencies are ES5 already. The `browserify.transform` field is unchanged.
- `npm test` runs the Karma specs in headless Chrome (was `gulp test`),
  `npm run docs` writes `doc/API.md` (was `gulp doc`), `npm run test:build`
  checks a fresh build in an isolated copy; GitHub Actions (Linux Node 22 and
  24, Windows smoke) instead of Travis CI.
- Runtime dependencies and their locked versions unchanged; gulp and its
  plugins removed from the development dependencies.
- `test/data-json-filelist.json` lists `exact-sum-cases.json` too, as the test
  task has written it since that fixture was added.
