import {ComputationsManager} from '../../src/computations-manager'
import {DataModel} from "sd-model";
import {Utils} from "sd-utils";
import {PayoffsTransformation} from '../../src/operations/payoffs-transformation'

describe("Payoffs transformation", function () {
    let fixtures = jasmine.getFixtures();
    fixtures.fixturesPath = "base/test/trees";

    let computationsManager = new ComputationsManager();
    let json = JSON.parse(readFixtures("payofftransform_pass.json"));



    let resultOrig;
    beforeAll(function (done) {
        computationsManager.setData(new DataModel(json.data));
        computationsManager.checkValidityAndRecomputeObjective(true, true, true).then(() => {
            resultOrig = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            done();
        });
    });

    let operation;
    it("should be listed in operations applicable for root node", ()=>{
        let roots = computationsManager.data.getRoots();
        let operations = computationsManager.operationsForObject(roots[0]);
        expect(operations.length>0).toBeTruthy();

        operation = Utils.find(operations, (o)=>o instanceof PayoffsTransformation);
        expect(operation).toBeTruthy();
        expect(operation.canPerform(roots[0])).toBeTruthy();
        expect(operation.canPerform(roots[1])).toBeTruthy();

    });


    it("should be performed correctly",(done)=>{
        let roots = computationsManager.data.getRoots();
        computationsManager.performOperation(roots[0], operation.name, {
            id: Utils.guid(),
            //objectId: roots[0].id,
            functionName: 'transformPayoff',
            functionBody: 'p^2/2',
            functionArgumentName: 'p',
            makeClone: true
        }).then(()=>{
            return computationsManager.checkValidityAndRecomputeObjective(true, true, true);
        }).then(() => {
            let result = JSON.parse(computationsManager.data.serialize(true, false, false, computationsManager.expressionEngine.getJsonReplacer()));
            compare(result.trees[2], resultOrig.trees[1]);
            done();
        });

    });

});


function compare(computedNode, expectedNode) {

    expect(computedNode.computed).toEqual(expectedNode.computed);

    computedNode.childEdges.forEach(function (e, i) {
        var expectedEdge = expectedNode.childEdges[i];
        expect(e.computed).toEqual(expectedEdge.computed);
        compare(e.childNode, expectedEdge.childNode)
    });
}

