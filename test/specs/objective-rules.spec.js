import {ComputationsManager} from '../../src/computations-manager'
import {DataModel} from "sd-model";


describe("Objective rules", function () {
    let fixtures = jasmine.getFixtures();
    fixtures.fixturesPath = "base/test/trees";

    let computationsManager = new ComputationsManager();
    let json = JSON.parse(readFixtures("payoffrules_pass.json"));

    computationsManager.data = new DataModel(json.data);

    let result;
    beforeEach(function (done) {
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            result = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            done();
        });
    });


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
