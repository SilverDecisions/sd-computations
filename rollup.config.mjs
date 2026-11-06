// JavaScript build (`npm run build`). Each bundle is written as a plain file with
// an inline source map and as a minified file with an external .map, like the
// previous gulp/browserify build:
//   dist/sd-computations(.min).js         defines a global `require` that returns
//       the exports of index.js for require('sd-computations'); sd-utils,
//       sd-random, sd-model and sd-expression-engine are external and come from
//       the global `require` of their dist bundles (format of browserify's
//       `require` option); idb is bundled
//   dist/sd-computations-vendor(.min).js  the same format for require('idb'),
//       loaded by the Karma tests and their job worker, whose bundles keep idb
//       external
//   dist/standalone/sd-computations(.min).js  UMD of standalone.index.js with
//       everything bundled: module.exports, AMD module or
//       SilverDecisions.Computations
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import {browserifyTransform} from './scripts/browserify-transform.mjs';
import {requireBundle} from './scripts/require-bundle.mjs';

const NAME = 'sd-computations';
const SD_DEPENDENCIES = ['sd-expression-engine', 'sd-model', 'sd-random', 'sd-utils'];
const root = path.dirname(fileURLToPath(import.meta.url));

// Compilation as browserify + babelify compile the packages for consumers
// (scripts/browserify-transform.mjs): index.js, standalone.index.js, src/ and
// idb with the Babel options of the `browserify.transform` field in package.json
// (@babel/preset-env with the browserslist of package.json, class fields as
// assignments, Object.assign inlined, Error subclasses keep their prototype),
// the sd-* packages with those of their own package.json. Math.js (lib/cjs)
// and the other dependencies are bundled as published.
const plugins = () => [
    // the `browser` and `main` fields, as browserify resolves packages (idb:
    // build/cjs/index.js; decimal.js, seedrandom without Node's crypto)
    nodeResolve({browser: true, mainFields: ['browser', 'main'], preferBuiltins: false}),
    browserifyTransform({root, include: [/[\\/]node_modules[\\/]idb[\\/]/]}),
    // strictRequires: every CommonJS module runs when it is first required, as
    // in the browserify bundle
    commonjs({strictRequires: true})
];

// Math.js lib/cjs has a few `/* #__PURE__ */` comments Rollup cannot place
// (INVALID_ANNOTATION, the comment is dropped, the code is unchanged), and
// step-execution.js imports execution-context.js and job-execution.js, which
// import it back (CIRCULAR_DEPENDENCY; CommonJS modules run on first require,
// as in browserify); every other warning is reported.
const CYCLE = /^src\/jobs\/engine\/(step-execution|execution-context|job-execution)\.js$/;
function onwarn(warning, warn) {
    if (warning.code === 'INVALID_ANNOTATION' && /[\\/]node_modules[\\/]mathjs[\\/]/.test(warning.id || '')) {
        return;
    }
    if (warning.code === 'CIRCULAR_DEPENDENCY' && (warning.ids || []).every(id => CYCLE.test(path.relative(root, id).split(path.sep).join('/')))) {
        return;
    }
    warn(warning);
}

function outputs(file, output) {
    const common = Object.assign({exports: 'auto'}, output);
    return [
        Object.assign({file: file + '.js', sourcemap: 'inline'}, common),
        // toplevel: false, as for the other formats: @rollup/plugin-terser turns it on for cjs,
        // which moves the variables of the require wrapper into the global scope
        Object.assign({file: file + '.min.js', sourcemap: true, plugins: [terser({toplevel: false})]}, common)
    ];
}

export default [
    {
        input: 'index.js',
        external: SD_DEPENDENCIES,
        onwarn,
        plugins: plugins().concat([requireBundle(NAME)]),
        output: outputs('dist/' + NAME, {format: 'cjs'})
    },
    {
        input: 'idb',
        onwarn,
        plugins: plugins().concat([requireBundle('idb')]),
        output: outputs('dist/' + NAME + '-vendor', {format: 'cjs'})
    },
    {
        input: 'standalone.index.js',
        onwarn,
        plugins: plugins(),
        output: outputs('dist/standalone/' + NAME, {format: 'umd', name: 'SilverDecisions.Computations', extend: true})
    }
];
