import {ComputationsManager} from '../../src/computations-manager'
import {DataModel, domain} from "sd-model";


describe("Programmatically build decision tree", function () {

    let dataModel;
    let computationsManager;

    let ruleName = "expected-value-maximization";

    beforeEach(function () {
        dataModel = new DataModel();
        computationsManager = new ComputationsManager({ruleName: ruleName}, dataModel);
    });


    it("should be computed correctly", function(done)  {

        dataModel.code = 'a = 1 \nb=2'; //global expression code

        let root = new domain.DecisionNode();
        root.name = 'A';
        root.code = 'c = a + b + 1';

        dataModel.addNode(root);

        let node2 = new domain.ChanceNode();
        node2.name = 'B - first child of A';

        let edge = dataModel.addNode(node2, root);
        edge.setPayoff('c');  // equivalent to edge.setPayoff('c', 0) - 0 - index

        let node3 = new domain.TerminalNode();
        edge = dataModel.addNode(node3, node2);
        edge.setPayoff(1); //


        computationsManager.recompute(false, true).then(() => { //ES6 Promise

            expect(computationsManager.isValid()).toBeTruthy();

            //root = dataModel.getRoots()[0]

            let payoff = root.computedValue(ruleName, 'payoff[0]');

            expect(payoff.valueOf()).toEqual(5);
            expect(root.computedValue(ruleName, 'payoff[0]')).toEqual(root.computed[ruleName].payoff[0]);

            done();
        }).catch(e=>{
            fail(e);
            done();
        });
    });


});
