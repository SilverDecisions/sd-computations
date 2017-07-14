import {PoliciesCollector} from '../../src/policies/policies-collector'
import {ExpressionEngine} from "sd-expression-engine";
import {DataModel} from "sd-model";

describe("Policies from", () => {

    let expressionEngine = new ExpressionEngine();

    let fixtures = jasmine.getFixtures();

    fixtures.fixturesPath = "base/test/";
    let fileList = JSON.parse(readFixtures("data-json-filelist.json"));

    fileList.filter(n=>n.lastIndexOf('policies', 0) === 0).forEach(function (fileName) {


        describe(fileName+":", function(){
            let data;
            let collector;
            let policies;

            let json = loadData(fileName);
            data = new DataModel(json.data);
            policies = json.policies;


            beforeEach(function() {
                let treeRoot = data.getRoots()[0];
                collector = new PoliciesCollector(treeRoot);
            });

            it("number should be correct", function() {
                expect(collector.policies.length).toEqual(policies.strings.length)
            });

            it("one line string descriptions should be correct", function() {

                expect(collector).not.toBeFalsy()
                collector.policies.forEach((p,i)=>{
                    var policyString = p.toPolicyString();
                    expect(policies.strings[i]).toEqual(policyString)
                })

            });
        })
    });

});


function loadData(fileName){
    let o = JSON.parse(readFixtures("data/"+fileName));
    o.data = JSON.parse(readFixtures("trees/"+o.treeFile)).data;
    return o;
}
