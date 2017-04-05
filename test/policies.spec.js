import {PoliciesCollector} from '../src/policies/policies-collector'
import {ExpressionEngine} from "sd-expression-engine";
import {DataModel} from "sd-model";

describe("Policies from", () => {

    var expressionEngine = new ExpressionEngine();

    var fixtures = jasmine.getFixtures();

    fixtures.fixturesPath = "base/test/";
    var fileList = JSON.parse(readFixtures("data-json-filelist.json"));

    fileList.filter(n=>true).forEach(function (fileName) {


        describe(fileName+":", function(){
            var data;
            var collector;
            var policies;

            var json = loadData(fileName);
            data = new DataModel(json.data);
            policies = json.policies;


            beforeEach(function() {
                var treeRoot = data.getRoots()[0];
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
    var o = JSON.parse(readFixtures("data/"+fileName));
    o.data = JSON.parse(readFixtures("trees/"+o.treeFile)).data;
    return o;
}
