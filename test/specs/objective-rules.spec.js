import {ComputationsManager} from '../../src/computations-manager'
import {DataModel} from "sd-model";




describe("Objective rules", function () {
    let fixtures = jasmine.getFixtures();

    let computationsManager = new ComputationsManager({
        "worker": {
            "delegateRecomputation": true,
            "url": "/base/test/job-worker.worker.js"
        }
    });

    beforeAll((done)=>{
        //hack to get generated browserify bundle script src and pass it to worker
        let browserifyBundleSrc = findScriptSrc(/.+\.browserify.*/);
        computationsManager.jobsManger.jobWorker.addListener("worker_loaded", ()=>done());
        computationsManager.jobsManger.jobWorker.postMessage(browserifyBundleSrc)

    }, 15000);

    fixtures.fixturesPath = "base/test/trees";
    let json = JSON.parse(readFixtures("payoffrules_pass.json"));

    computationsManager.setData(new DataModel(json.data));

    let result;
    beforeAll(function (done) {
        computationsManager.data.clearComputedValues();
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            result = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            done();
        });
    }, 15000);


    computationsManager.getObjectiveRules().forEach(function (rule) {
        let ruleName = rule.name;

        describe(ruleName, function () {
            it("should be computed correctly", function () {
                result.trees.forEach(function (root, index) {
                    compare(ruleName, root, json.data.trees[index]);
                })
            })
        })
    });

});


function compare(ruleName, computedNode, expectedNode) {

    expect(computedNode.computed[ruleName]).toEqual(expectedNode.computed[ruleName]);

    computedNode.childEdges.forEach(function (e, i) {
        var expectedEdge = expectedNode.childEdges[i];
        expect(e.computed[ruleName]).toEqual(expectedEdge.computed[ruleName]);
        compare(ruleName, e.childNode, expectedEdge.childNode)
    });
}

function findScriptSrc(regex){
    return $("script").filter(function() {
        return this.src.match(regex);
    }).first().attr('src');
}
