// Rollup plugin: compiles the files of packages that declare a babelify
// `browserify.transform` in their package.json (this package, sd-utils,
// sd-model, sd-random, sd-expression-engine) the way browserify + babelify
// compile them for consumers: Babel 7 with the options of that field and
// CommonJS modules (babelify's default). Rollup then bundles CommonJS modules
// only, so the module interop is Babel's, as in the browserify build.
// `include` lists other files compiled with this package's options: idb, which
// the `global` babelify transform of this package is meant to compile (its
// `ignore` string matches no path in Babel 7, so the browserify build compiled
// every file; the other packages are ES5 already). Other files are not compiled.
import fs from 'node:fs';
import path from 'node:path';
import {transformAsync} from '@babel/core';

function babelifyOptions(pkgFile) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const transform = ((pkg.browserify || {}).transform || [])
        .find(t => (Array.isArray(t) ? t[0] : t) === 'babelify');
    if (!transform) {
        return null;
    }
    // `global` is a browserify option, babelify removes it before calling Babel
    const {global, ...options} = Array.isArray(transform) ? (transform[1] || {}) : {};
    return options;
}

export function browserifyTransform({root, include = []}) {
    const rootOptions = babelifyOptions(path.join(root, 'package.json'));
    const packageOf = new Map();
    // nearest package.json of a file (cached per directory)
    function nearestPackage(dir) {
        if (packageOf.has(dir)) {
            return packageOf.get(dir);
        }
        const file = path.join(dir, 'package.json');
        const parent = path.dirname(dir);
        const result = fs.existsSync(file) ? {file, options: babelifyOptions(file)} : (parent === dir ? null : nearestPackage(parent));
        packageOf.set(dir, result);
        return result;
    }

    return {
        name: 'browserify-transform',
        async transform(code, id) {
            if (id.startsWith('\0') || !/\.js$/.test(id)) {
                return null;
            }
            const pkg = nearestPackage(path.dirname(id));
            const options = pkg && pkg.options ? pkg.options : (include.some(re => re.test(id)) ? rootOptions : null);
            if (!options) {
                return null;
            }
            const result = await transformAsync(code, Object.assign({}, options, {
                filename: id,
                cwd: root,
                babelrc: false,
                configFile: false,
                sourceMaps: true,
                // like babelify: the caller does not support ES modules, so
                // @babel/preset-env compiles them to CommonJS
                caller: {name: 'babelify', supportsStaticESM: false}
            }));
            return result ? {code: result.code, map: result.map} : null;
        }
    };
}
