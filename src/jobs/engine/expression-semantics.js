import {ExpressionEngine} from "sd-expression-engine";

// Profile: "sd-expressions-<PROFILE_VERSION>;mathjs-<full version>;<config() as canonical JSON>".
// Read on each use: config(...) can change the shared Math.js instance at any time.
// Bump PROFILE_VERSION when results change without a Math.js version or config change.
export const EXPRESSION_SEMANTICS_PROFILE_VERSION = 1;

// Profile assumed for executions without one (sd-computations <= 0.6.1): engine 0.1.17, defaults.
export const LEGACY_EXPRESSION_SEMANTICS = 'sd-expressions-1;mathjs-9.5.0;'
    + '{"epsilon":1e-12,"matrix":"Matrix","number":"number","precision":64,"predictable":false,"randomSeed":null}';

export function currentExpressionSemantics() {
    var version = ExpressionEngine.eval("version", false);
    var config;
    try {
        config = canonicalJson(ExpressionEngine.eval("config()", false));
    } catch (e) {
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
