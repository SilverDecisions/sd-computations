import {ComputationsManager} from '../../../src/computations-manager'
import {DataModel} from "sd-model";
import {parse as csvParse} from "csv"

describe("Job", () => {


    let fixtures = jasmine.getFixtures();
    fixtures.fixturesPath = "base/test/";
    let fileList = JSON.parse(readFixtures("data-json-filelist.json"));

    let computationsManager = new ComputationsManager();

    fileList.filter(n=>n.lastIndexOf('job-', 0) === 0).forEach(function (fileName) {
        let json = loadData(fileName);

        describe(json.name+" from "+fileName+":", function(){
            let job = computationsManager.getJobByName(json.name);

            let csv = json.csv;
            let params = json.params;
            let promiseResult;
            let promiseError;
            let jobResult;
            let jobParameters;


            beforeAll(function (done) {
                if(json.csvFile){
                    loadCsv(json.csvFile, (c)=>{
                        csv = c;
                        done();
                    })
                }else{
                    done();
                }
            });

            beforeEach(function(done) {

                computationsManager.data = new DataModel(json.data);
                jobParameters = job.createJobParameters(params);
                computationsManager.runJobWithInstanceManager(job.name, jobParameters.values, {
                    onJobCompleted: (res)=>{
                        jobResult = res;
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

            if(csv === true){
                it("csv should be generated without errors", function() {
                    expect(job.jobResultToCsvRows(jobResult, jobParameters)).toBeTruthy()

                });
            }else{
                it("csv should be correct", function() {
                    let csv2 = job.jobResultToCsvRows(jobResult, jobParameters);
                    compareCsv(csv, csv2)
                });
            }



        })
    });

});


function loadData(fileName){
    var o = JSON.parse(readFixtures("data/"+fileName));
    o.data = JSON.parse(readFixtures("trees/"+o.treeFile)).data;
    return o;
}

function loadCsv(fileName, cb){
    csvParse(readFixtures("data/csv/"+fileName), {'auto_parse': true}, function(err, rows) {
        cb(rows)
    })
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
