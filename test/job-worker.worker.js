
self.onmessage = function(oEvent) { //hack to get browserify bundle script src

    importScripts('/base/dist/sd-computations-vendor.js');
    importScripts('/base/node_modules/sd-utils/dist/sd-utils.js');
    importScripts('/base/node_modules/sd-random/dist/sd-random.js');
    importScripts('/base/node_modules/sd-expression-engine/dist/sd-expression-engine.js');
    importScripts('/base/node_modules/sd-model/dist/sd-model.js');
    console.log('received browserifyBundleSrc', oEvent.data);
    importScripts(oEvent.data);
    var computationsModule = require("sd-computations");
    // console.log(computationsModule)
    var engine = new computationsModule.ComputationsEngine();
    engine.reply("worker_loaded")
};

