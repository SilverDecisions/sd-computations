// Rollup plugin: wraps a CommonJS chunk the way browserify's `require` option
// did (`browserify().require('./index.js', {expose: name}).external(...)`): the
// file assigns a global `require` function that returns the chunk's exports for
// `name` (evaluated on first use) and passes other names on to the `require`
// defined before it or after it. The chunk's own require() calls of external
// modules (sd-utils) go the same way, so the bundle works after or before
// dist/sd-utils.js, as the browserify bundle did.
export function requireBundle(name) {
    const banner = [
        'require = (function (previousRequire) {',
        '    var cache = {};',
        '    var factories = {};',
        '    function newRequire(id, jumped) {',
        '        if (!Object.prototype.hasOwnProperty.call(factories, id)) {',
        '            var currentRequire = typeof require === "function" && require;',
        '            if (!jumped && currentRequire && currentRequire !== newRequire) {',
        '                return currentRequire(id, true);',
        '            }',
        '            if (previousRequire) {',
        '                return previousRequire(id, true);',
        '            }',
        '            var error = new Error("Cannot find module \'" + id + "\'");',
        '            error.code = "MODULE_NOT_FOUND";',
        '            throw error;',
        '        }',
        '        if (!cache[id]) {',
        '            var module = cache[id] = {exports: {}};',
        '            factories[id].call(module.exports, module, module.exports, function (dependency) {',
        '                return newRequire(dependency);',
        '            });',
        '        }',
        '        return cache[id].exports;',
        '    }',
        '    factories[' + JSON.stringify(name) + '] = function (module, exports, require) {'
    ].join('\n');
    const footer = [
        '    };',
        '    return newRequire;',
        '})(typeof require === "function" && require);'
    ].join('\n');
    return {
        name: 'require-bundle',
        outputOptions(options) {
            if (options.format !== 'cjs') {
                this.error('require-bundle needs output.format "cjs"');
            }
            return null;
        },
        banner: () => banner,
        footer: () => footer
    };
}
