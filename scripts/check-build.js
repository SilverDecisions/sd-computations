#!/usr/bin/env node
// Build check in an isolated copy (`npm run test:build`, used by CI):
//
//  1. copy the files of the working tree (git ls-files) to a temp dir, `npm ci` there
//  2. `npm run build`: exit code 0, no Rollup warnings
//  3. the nine dist artifacts exist, nothing else is in dist/; the bundles are
//     ES5; their source maps (inline in the plain files, .map files next to the
//     minified ones) parse and list the sources
//  4. the build changed nothing outside dist/
//  5. the bundles in a vm context, plain and minified: the export names of
//     0.6.1; the module bundle together with the dist bundles of the installed
//     sd-utils, sd-random, sd-expression-engine and sd-model (minified with the
//     minified ones), in the dependency order and reversed, adds only `require`
//     to the global scope and recomputes a small tree; the vendor bundle
//     exposes idb; the standalone bundle defines SilverDecisions.Computations
//  6. `npm test`: the Karma specs in headless Chrome with the fresh
//     dist/sd-computations-vendor.js, including the job worker specs
//  7. `npm pack`: the tarball contains the entry points, sources and dist; it is
//     installed into an empty consumer that bundles require('sd-computations')
//     with browserify + babelify (the package's browserify.transform field, like
//     SilverDecisions); the bundle is evaluated and has the export names
//  8. a syntax error injected into the sources fails `npm run build` with a
//     non-zero exit code and a diagnostic naming the file and line; nothing
//     outside dist/ changes
//
// Usage: node scripts/check-build.js [--keep] [--skip-karma] [--skip-consumer]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const NAME = 'sd-computations';
const ERROR_FILE = 'src/computations-manager.js';
const ERROR_LINE = 1;
// bundle -> a source its map must list
const BUNDLES = {
    ['dist/' + NAME]: ERROR_FILE,
    ['dist/' + NAME + '-vendor']: 'node_modules/idb/build/cjs/index.js',
    ['dist/standalone/' + NAME]: ERROR_FILE
};
const ARTIFACTS = Object.keys(BUNDLES).reduce((list, b) => list.concat(['.js', '.min.js', '.min.js.map'].map(ext => b + ext)), []);
const PACKED = ['package.json', 'README.md', 'LICENSE', 'index.js', 'standalone.index.js', 'src/index.js', ERROR_FILE].concat(ARTIFACTS);
// export names of 0.6.1
const MODULE_EXPORTS = ['ComputationsEngine', 'ComputationsEngineConfig', 'ComputationsManager', 'ComputationsManagerConfig',
    'ExpressionsEvaluator', 'JobWorker', 'JobsManager', 'JobsManagerConfig', 'engine'];
const STANDALONE_EXPORTS = ['ComputationsEngine', 'ComputationsEngineConfig', 'ComputationsManager', 'ComputationsManagerConfig'];
const IDB_EXPORTS = ['deleteDB', 'openDB', 'unwrap', 'wrap'];
const SD_DEPENDENCIES = ['sd-utils', 'sd-random', 'sd-expression-engine', 'sd-model'];
// the toolchain SilverDecisions compiles the package with
const CONSUMER_DEPS = ['browserify@17', 'babelify@10', '@babel/core@7', '@babel/preset-env@7',
    'babel-plugin-transform-class-properties@6', 'babel-plugin-transform-object-assign@6',
    'babel-plugin-transform-builtin-extend@1'];

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const failures = [];
const fail = msg => {
    failures.push(msg);
    console.error('FAIL ' + msg);
};
const ok = msg => console.log('ok   ' + msg);

// npm as `node npm-cli.js`: on Windows `npm` is a .cmd file that spawnSync cannot
// run without a shell. npm_execpath is set when this runs as an npm script.
const NPM_CLI = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find(p => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));

function run(cmd, cmdArgs, opts) {
    const r = spawnSync(cmd, cmdArgs, Object.assign({encoding: 'utf8', maxBuffer: 256 * 1024 * 1024}, opts));
    return {status: r.status, stdout: r.stdout || '', log: (r.stdout || '') + (r.stderr || '')};
}

function npm(npmArgs, opts) {
    if (!NPM_CLI) {
        throw new Error('npm-cli.js not found next to ' + process.execPath);
    }
    return run(process.execPath, [NPM_CLI].concat(npmArgs), opts);
}

function hashTree(dir, skip) {
    const out = {};
    (function walk(rel) {
        for (const e of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})) {
            const r = rel ? rel + '/' + e.name : e.name;
            if (skip.some(s => r === s || r.startsWith(s + '/'))) {
                continue;
            }
            if (e.isDirectory()) {
                walk(r);
            } else {
                out[r] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, r))).digest('hex');
            }
        }
    })('');
    return out;
}

function changedOutsideDist(dir, before) {
    const after = hashTree(dir, ['node_modules', 'dist']);
    return [...new Set(Object.keys(before).concat(Object.keys(after)))].filter(f => before[f] !== after[f]);
}

function copyTree(dest) {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'})
        .split('\0').filter(f => f && fs.existsSync(path.join(root, f)));
    for (const f of files) {
        fs.mkdirSync(path.join(dest, path.dirname(f)), {recursive: true});
        fs.copyFileSync(path.join(root, f), path.join(dest, f));
    }
    return files.length;
}

// acorn from the isolated copy (installed by its `npm ci`)
let toolsDir = root;
function isES5(file) {
    const acorn = require(require.resolve('acorn', {paths: [toolsDir]}));
    try {
        acorn.parse(fs.readFileSync(file, 'utf8'), {ecmaVersion: 5});
        return null;
    } catch (e) {
        return e.message;
    }
}

// null if the file references a parsable source map (inline data: URL for the
// plain files, a .map file next to the minified ones) that lists `source`
function sourceMapProblem(file, minified, source) {
    const ref = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(fs.readFileSync(file, 'utf8'));
    if (!ref) {
        return 'no sourceMappingURL comment at the end';
    }
    const inline = /^data:application\/json;(?:charset=utf-8;)?base64,/.exec(ref[1]);
    if (minified ? inline || ref[1] !== path.basename(file) + '.map' : !inline) {
        return 'expected ' + (minified ? 'a reference to ' + path.basename(file) + '.map' : 'an inline source map') + ', got ' + ref[1].slice(0, 40);
    }
    let map;
    try {
        map = JSON.parse(inline ? Buffer.from(ref[1].slice(inline[0].length), 'base64').toString('utf8')
            : fs.readFileSync(path.join(path.dirname(file), ref[1]), 'utf8'));
    } catch (e) {
        return 'source map is not readable JSON: ' + e.message;
    }
    if (map.version !== 3 || typeof map.mappings !== 'string' || !/[A-Za-z]/.test(map.mappings)) {
        return 'source map has no version 3 mappings';
    }
    if (!Array.isArray(map.sources) || !map.sources.some(s => s.split('\\').join('/').endsWith(source))) {
        return 'source map does not list ' + source;
    }
    if (map.sourcesContent && map.sourcesContent.length !== map.sources.length) {
        return 'source map sourcesContent does not match its sources';
    }
    return null;
}

const sameNames = (actual, expected) => JSON.stringify(actual.slice().sort()) === JSON.stringify(expected.slice().sort());

// The tree of test/specs/programmatic-tree.spec.js: the payoff of the root is 5.
const RECOMPUTE = `(function (C, M, done) {
    var d = M.domain, data = new M.DataModel();
    data.code = 'a = 1 \\nb=2';
    var root = new d.DecisionNode(); root.code = 'c = a + b + 1';
    data.addNode(root);
    var chance = new d.ChanceNode();
    data.addNode(chance, root).setPayoff('c');
    data.addNode(new d.TerminalNode(), chance).setPayoff(1);
    var manager = new C.ComputationsManager({ruleName: 'expected-value-maximization', jobRepositoryType: 'timeout'}, data);
    manager.recompute(false, true).then(function () {
        done(manager.isValid() + ' ' + root.computedValue('expected-value-maximization', 'payoff[0]').valueOf());
    }, function (e) { done('error: ' + e.message); });
})`;

function evaluate(files) {
    const ctx = vm.createContext({setTimeout, clearTimeout, console: {log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {}}});
    const before = Object.getOwnPropertyNames(vm.runInContext('this', ctx));
    for (const f of files) {
        vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, {filename: f});
    }
    return {ctx, added: Object.getOwnPropertyNames(vm.runInContext('this', ctx)).filter(n => !before.includes(n)).sort()};
}

async function checkBundles(copy) {
    const dist = path.join(copy, 'dist');
    const dep = (name, min) => path.join(copy, 'node_modules', name, 'dist', name + min + '.js');
    for (const min of ['', '.min']) {
        const own = path.join(dist, NAME + min + '.js');
        for (const order of [SD_DEPENDENCIES.map(n => dep(n, min)).concat(own), [own].concat(SD_DEPENDENCIES.map(n => dep(n, min)).reverse())]) {
            const label = 'module' + min + (order[0] === own ? ', loaded first' : ', loaded last');
            try {
                const {ctx, added} = evaluate(order);
                const names = vm.runInContext('Object.keys(require("sd-computations"))', ctx);
                const result = await new Promise(resolve => vm.runInContext(RECOMPUTE, ctx)(
                    vm.runInContext('require("sd-computations")', ctx), vm.runInContext('require("sd-model")', ctx), resolve));
                const problems = [];
                sameNames(added, ['require']) ? null : problems.push('globals ' + added.join(' '));
                sameNames(names, MODULE_EXPORTS) ? null : problems.push('exports ' + names.join(' '));
                result === 'true 5' ? null : problems.push('recompute gave ' + result);
                problems.length ? fail(label + ': ' + problems.join('; ')) : ok(label + ' with the sd-* bundles: only `require` added, exports, recompute');
            } catch (e) {
                fail(label + ': ' + e.message);
            }
        }
        try {
            const vendor = evaluate([path.join(dist, NAME + '-vendor' + min + '.js')]);
            const idb = vm.runInContext('Object.keys(require("idb"))', vendor.ctx);
            sameNames(vendor.added, ['require']) && sameNames(idb, IDB_EXPORTS) ? ok('vendor' + min + ': require("idb") with ' + idb.join(', '))
                : fail('vendor' + min + ': globals ' + vendor.added.join(' ') + ', idb exports ' + idb.join(' '));
            const standalone = evaluate([path.join(dist, 'standalone', NAME + min + '.js')]);
            const names = vm.runInContext('Object.keys(SilverDecisions.Computations)', standalone.ctx);
            const engine = vm.runInContext('typeof new SilverDecisions.Computations.ComputationsManager({jobRepositoryType: "timeout"}).expressionEngine.eval', standalone.ctx);
            sameNames(names, STANDALONE_EXPORTS) && engine === 'function' ? ok('standalone' + min + ': SilverDecisions.Computations with ' + names.join(', '))
                : fail('standalone' + min + ': exports ' + names.join(' ') + ', engine ' + engine);
        } catch (e) {
            fail('vendor/standalone' + min + ': ' + e.message);
        }
    }
}

function runKarma(copy) {
    const r = npm(['test'], {cwd: copy});
    const summary = (r.log.replace(/\u001b\[[\d;]*[A-Za-z]/g, '').match(/Executed \d+ of \d+[^\n]*\((?:[\d.]+ secs) \/ [\d.]+ secs\)/g) || ['no summary']).pop();
    r.status === 0 && /SUCCESS/.test(summary) ? ok('npm test (Karma, headless Chrome, job worker): ' + summary)
        : fail('npm test exited with ' + r.status + ': ' + summary + '\n' + r.log.slice(-3000));
}

function checkPackage(tmp, copy) {
    let r = npm(['pack', '--json', '--pack-destination', tmp], {cwd: copy});
    if (r.status !== 0) {
        console.error(r.log);
        fail('npm pack exited with ' + r.status);
        return;
    }
    // stdout only: npm 11 writes warnings (e.g. gitignore-fallback) to stderr
    const info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0];
    const files = info.files.map(f => f.path);
    const missing = PACKED.filter(f => !files.includes(f));
    missing.length ? fail('tarball misses ' + missing.join(', ')) : ok('tarball ' + info.filename + ': ' + files.length + ' files, '
        + Math.round(info.size / 1024) + ' KiB, contains ' + PACKED.length + ' required files');

    const consumer = path.join(tmp, 'consumer');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({name: 'consumer', private: true}));
    r = npm(['install', '--no-audit', '--no-fund', '--no-package-lock', path.join(tmp, info.filename)].concat(CONSUMER_DEPS), {cwd: consumer});
    if (r.status !== 0) {
        console.error(r.log);
        fail('installing the tarball into a consumer failed');
        return;
    }
    fs.writeFileSync(path.join(consumer, 'entry.js'), "module.exports = require('" + NAME + "');\n");
    const bundle = path.join(consumer, 'bundle.js');
    r = run(process.execPath, [path.join(consumer, 'node_modules', 'browserify', 'bin', 'cmd.js'),
        'entry.js', '--standalone', 'Consumer', '-o', bundle], {cwd: consumer});
    if (r.status !== 0) {
        console.error(r.log);
        fail('browserify of the installed package failed');
        return;
    }
    try {
        const {ctx} = evaluate([bundle]);
        const names = vm.runInContext('Object.keys(Consumer)', ctx);
        sameNames(names, MODULE_EXPORTS) ? ok('browserify + babelify bundle of require(\'' + NAME + '\') from the tarball: ' + names.length + ' exports')
            : fail('consumer bundle exports ' + names.join(' '));
    } catch (e) {
        fail('consumer bundle: ' + e.message);
    }
}

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), NAME + '-check-'));
    const copy = path.join(tmp, 'copy');
    console.log('isolated copy: ' + copy);
    try {
        // 1
        ok('copied ' + copyTree(copy) + ' files');
        let r = npm(['ci', '--no-audit', '--no-fund'], {cwd: copy});
        if (r.status !== 0) {
            console.error(r.log);
            fail('npm ci exited with ' + r.status);
            return;
        }
        ok('npm ci');
        toolsDir = copy;

        // 2
        const before = hashTree(copy, ['node_modules', 'dist']);
        r = npm(['run', 'build'], {cwd: copy});
        if (r.status !== 0) {
            console.error(r.log);
            fail('npm run build exited with ' + r.status);
            return;
        }
        const warnings = r.log.split('\n').filter(l => /^\(!\)|\[!\]/.test(l.replace(/\u001b\[[\d;]*m/g, '')));
        warnings.length ? fail('build warnings:\n' + warnings.join('\n')) : ok('npm run build, no warnings');

        // 3
        for (const a of ARTIFACTS) {
            const f = path.join(copy, a);
            if (!fs.existsSync(f) || !fs.statSync(f).size) {
                fail(a + ' missing or empty');
                continue;
            }
            if (a.endsWith('.js')) {
                const err = isES5(f);
                err ? fail(a + ' is not ES5: ' + err) : null;
                const problem = sourceMapProblem(f, a.endsWith('.min.js'), BUNDLES[a.replace(/(\.min)?\.js$/, '')]);
                problem ? fail(a + ': ' + problem) : null;
            }
        }
        const extra = fs.readdirSync(path.join(copy, 'dist'), {recursive: true})
            .map(f => 'dist/' + String(f).split(path.sep).join('/'))
            .filter(f => fs.statSync(path.join(copy, f)).isFile() && !ARTIFACTS.includes(f));
        extra.length ? fail('unexpected files in dist/: ' + extra.join(', ')) : null;
        ok(ARTIFACTS.length + ' artifacts checked (ES5, source maps parsed); sizes: ' + ARTIFACTS.map(a =>
            a.slice(5) + ' ' + Math.round(fs.statSync(path.join(copy, a)).size / 1024) + ' KiB').join(', '));

        // 4
        const changed = changedOutsideDist(copy, before);
        changed.length ? fail('build changed files outside dist/: ' + changed.join(', ')) : ok('nothing changed outside dist/');

        // 5
        await checkBundles(copy);

        // 6
        if (!flag('--skip-karma')) {
            runKarma(copy);
        }

        // 7 (before 8, which breaks the sources of its own copy)
        if (!flag('--skip-consumer')) {
            checkPackage(tmp, copy);
        }

        // 8
        const broken = path.join(tmp, 'broken');
        fs.cpSync(copy, broken, {recursive: true});
        const errorFile = path.join(broken, ERROR_FILE);
        const lines = fs.readFileSync(errorFile, 'utf8').split('\n');
        lines.splice(ERROR_LINE - 1, 0, 'var = ;');
        fs.writeFileSync(errorFile, lines.join('\n'));
        const beforeBroken = hashTree(broken, ['node_modules', 'dist']);
        r = npm(['run', 'build'], {cwd: broken});
        const named = r.log.includes(ERROR_FILE.split('/').pop()) && new RegExp('\\(' + ERROR_LINE + ':\\d+\\)|:' + ERROR_LINE + ':\\d+').test(r.log);
        if (r.status === 0) {
            fail('npm run build with a syntax error in ' + ERROR_FILE + ' exited with 0');
        } else if (!named) {
            console.error(r.log.split('\n').slice(0, 25).join('\n'));
            fail('no diagnostic naming ' + ERROR_FILE + ' line ' + ERROR_LINE);
        } else {
            ok('syntax error in ' + ERROR_FILE + ': exit code ' + r.status + ', diagnostic names line ' + ERROR_LINE);
        }
        const brokenChanged = changedOutsideDist(broken, beforeBroken);
        brokenChanged.length ? fail('failed build changed files outside dist/: ' + brokenChanged.join(', ')) : null;
    } finally {
        if (flag('--keep')) {
            console.log('kept ' + tmp);
        } else {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    }
}

main().then(() => {
    if (failures.length) {
        console.error('\n' + failures.length + ' check(s) failed');
        process.exit(1);
    }
    console.log('\nall build checks passed');
}, e => {
    console.error(e);
    process.exit(1);
});
