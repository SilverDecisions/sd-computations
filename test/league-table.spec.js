import {ComputationsManager} from '../src/computations-manager'
import {DataModel} from "sd-model";

describe("League table from", () => {


    var fixtures = jasmine.getFixtures();

    fixtures.fixturesPath = "base/test/";
    var fileList = JSON.parse(readFixtures("data-json-filelist.json"));

    var computationsManager = new ComputationsManager();
    var job = computationsManager.getJobByName("league-table");



    fileList.filter(n=>n.lastIndexOf('league-table', 0) === 0).forEach(function (fileName) {


        describe(fileName+":", function(){
            var data;

            var csv;

            var json = loadData(fileName);
            data = new DataModel(json.data);
            console.log(data);
            csv = json.csv;
            var params = json.params;
            var promiseResult;
            var promiseError;
            var jobResult;

            beforeEach(function(done) {
                var treeRoot = data.getRoots()[0];
                computationsManager.data = data;
                computationsManager.runJobWithInstanceManager(job.name, job.createJobParameters(params).values, {
                    onJobCompleted: (res)=>{
                        jobResult = res;
                        console.log('res', res);
                        done();
                    },
                    onJobFailed: (e)=>{
                        promiseError = e;
                        done();
                    },
                }).then(r=>{
                    promiseResult = r;
                }).catch(e=>{
                    promiseError = e;
                    done();
                })
            });

            it("job execution should not have errors", function() {
                expect(promiseError).toBeFalsy()
            });

            it("csv should be correct", function() {
                console.log('jobResult', jobResult, jobResult.data);
                var csv2 = job.jobResultToCsvRows(jobResult.data);

                console.log(csv2);

            });


        })
    });

});


function loadData(fileName){
    var o = JSON.parse(readFixtures("data/"+fileName));
    o.data = JSON.parse(readFixtures("trees/"+o.treeFile)).data;
    return o;
}
