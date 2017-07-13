import {ComputationsManager} from '../src/computations-manager'
import {DataModel} from "sd-model";

describe("League table from", () => {


    let fixtures = jasmine.getFixtures();

    fixtures.fixturesPath = "base/test/";
    let fileList = JSON.parse(readFixtures("data-json-filelist.json"));

    let computationsManager = new ComputationsManager();
    let job = computationsManager.getJobByName("league-table");



    fileList.filter(n=>n.lastIndexOf('league-table', 0) === 0).forEach(function (fileName) {


        describe(fileName+":", function(){
            let data;

            let csv;

            let json = loadData(fileName);
            data = new DataModel(json.data);
            //console.log(data);
            csv = json.csv;
            let params = json.params;
            let promiseResult;
            let promiseError;
            let jobResult;
            let jobParameters;
            beforeEach(function(done) {
                let treeRoot = data.getRoots()[0];
                computationsManager.data = data;
                jobParameters = job.createJobParameters(params);
                computationsManager.runJobWithInstanceManager(job.name, jobParameters.values, {
                    onJobCompleted: (res)=>{
                        jobResult = res;
                        // console.log('res', res);
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
                let csv2 = job.jobResultToCsvRows(jobResult, jobParameters);
                compareCsv(csv, csv2)
            });

        })
    });

});


function loadData(fileName){
    var o = JSON.parse(readFixtures("data/"+fileName));
    o.data = JSON.parse(readFixtures("trees/"+o.treeFile)).data;
    return o;
}

function compareCsv(csv1, csv2){
    expect(csv1.length).toEqual(csv2.length);

    csv1.forEach((row1, index)=>{
        let row2 = csv2[index];
        expect(row1.length).toEqual(row2.length);

        row1.forEach((cell, cellIndex)=>{
            expect(cell).toEqual(row2[cellIndex]);
        });
    })
}
