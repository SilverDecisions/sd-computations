// Worker with another Math.js configuration than the page (job-semantics.spec.js).
self.onmessage = function(oEvent) { //hack to get browserify bundle script src

    importScripts('/base/dist/sd-computations-vendor.js');
    importScripts('/base/node_modules/sd-utils/dist/sd-utils.js');
    importScripts('/base/node_modules/sd-random/dist/sd-random.js');
    importScripts('/base/node_modules/sd-expression-engine/dist/sd-expression-engine.js');
    importScripts('/base/node_modules/sd-model/dist/sd-model.js');
    importScripts(oEvent.data);
    var ExpressionEngine = require("sd-expression-engine").ExpressionEngine;
    var major = parseInt(ExpressionEngine.eval("version", false), 10);
    ExpressionEngine.eval(major >= 13 ? "config({absTol: 0})" : "config({epsilon: 1e-10})", false);
    var computationsModule = require("sd-computations");
    var engine = new computationsModule.ComputationsEngine();
    engine.reply("worker_loaded")
};
