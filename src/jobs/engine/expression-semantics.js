import {ExpressionEngine} from "sd-expression-engine";

/*
 * Expression semantics profile: what decides the values of the expressions a job
 * evaluates. A stopped job is continued only under the profile it was started with
 * (see JobRepository): its rows are never combined with rows of another profile.
 *
 * The profile is the string
 *   "sd-expressions-<PROFILE_VERSION>;mathjs-<Math.js version>;<Math.js configuration>"
 * - PROFILE_VERSION (below): increase it when results can change while the Math.js
 *   version and configuration stay the same: the evaluation in sd-expression-engine
 *   (toFloat, toNumber, the arithmetic helpers, functions it adds to Math.js) or in
 *   sd-computations (scopes, evaluation order), or the definition of the profile.
 * - the full Math.js version of the installed sd-expression-engine (not only the
 *   major version: minor and patch releases changed results too, e.g. isInteger in
 *   15.1.0, mod in 11.11.1);
 * - the whole Math.js configuration (number type, precision, epsilon or relTol /
 *   absTol, matrix, predictable, randomSeed, ...) as canonical JSON. It is read each
 *   time the profile is taken, because the configuration is shared by all
 *   evaluations of the engine in a JavaScript context (page or worker) and can be
 *   changed at any time by config(...) in the application or in an expression.
 * Development tools and other dependencies are not part of it.
 */
export const EXPRESSION_SEMANTICS_PROFILE_VERSION = 1;

// Job executions stored by sd-computations <= 0.6.1 have no profile; those versions
// use sd-expression-engine 0.1.17 (Math.js 9.5.0) with its default configuration,
// whose profile this is (older engines are treated the same).
export const LEGACY_EXPRESSION_SEMANTICS = 'sd-expressions-1;mathjs-9.5.0;'
    + '{"epsilon":1e-12,"matrix":"Matrix","number":"number","precision":64,"predictable":false,"randomSeed":null}';

/*profile of the expression engine of this JavaScript context, as it is now*/
export function currentExpressionSemantics() {
    var version = ExpressionEngine.eval("version", false);
    var config;
    try {
        config = canonicalJson(ExpressionEngine.eval("config()", false));
    } catch (e) {
        // an engine that does not expose its configuration to expressions
        config = "config-unavailable";
    }
    return "sd-expressions-" + EXPRESSION_SEMANTICS_PROFILE_VERSION + ";mathjs-" + version + ";" + config;
}

function canonicalJson(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value === undefined ? null : value);
    }
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalJson).join(",") + "]";
    }
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}
