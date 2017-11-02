import {ComputationsManager} from '../../src/computations-manager'
import {DataModel} from "sd-model";
import {Utils} from "sd-utils";
import {FlipSubtree} from '../../src/operations/flip-subtree'

describe("Tree flipping", function () {
    let fixtures = jasmine.getFixtures();
    fixtures.fixturesPath = "base/test/trees";

    let computationsManager = new ComputationsManager();
    let json = JSON.parse(readFixtures("fliptest_pass.json"));



    let resultOrig;
    beforeAll(function (done) {
        computationsManager.setData(new DataModel(json.data));
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            resultOrig = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            done();
        });
    });

    let flipOperation;
    it("should be listed in operations applicable for node", ()=>{
        let roots = computationsManager.data.getRoots();
        let operations = computationsManager.operationsForObject(roots[0]);
        expect(operations.length>0).toBeTruthy();

        flipOperation = Utils.find(operations, (o)=>o instanceof FlipSubtree);
        expect(flipOperation).toBeTruthy();
        expect(flipOperation.canPerform(roots[0])).toBeTruthy();
        expect(flipOperation.canPerform(roots[1])).toBeTruthy();

    });


    it("should be performed correctly",(done)=>{
        let roots = computationsManager.data.getRoots();
        flipOperation.perform(roots[0]);
        flipOperation.perform(roots[1]);
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            let result = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            compare(result.trees[0], resultOrig.trees[1]);
            compare(result.trees[1], resultOrig.trees[0]);
            done();
        });
    });

    it("second call should revert tree to previous state",(done)=>{
        let roots = computationsManager.data.getRoots();
        flipOperation.perform(roots[0]);
        flipOperation.perform(roots[1]);
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            let result = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            compare(result.trees[0], resultOrig.trees[0]);
            compare(result.trees[1], resultOrig.trees[1]);
            done();
        });
    })
});


function compare(computedNode, expectedNode) {

    expect(computedNode.computed).toEqual(expectedNode.computed);

    computedNode.childEdges.forEach(function (e, i) {
        var expectedEdge = expectedNode.childEdges[i];
        expect(e.computed).toEqual(expectedEdge.computed);
        compare(e.childNode, expectedEdge.childNode)
    });
}

