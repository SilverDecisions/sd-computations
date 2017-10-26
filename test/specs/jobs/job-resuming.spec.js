import {ComputationsManager} from '../../../src/computations-manager'
import {DataModel} from "sd-model";
import {parse as csvParse} from "csv"


let fixtures = jasmine.getFixtures();
fixtures.fixturesPath = "base/test/";
let fileName = 'job-n-way-sa.json';


describe("Job", () => {
    let computationsManager = new ComputationsManager();

    let json = loadData(fileName);

    describe(json.name + " from " + fileName + ":", function () {
        let job = computationsManager.getJobByName(json.name);
        let testConf = json.tests[0];


        testConf.data = JSON.parse(readFixtures("trees/" + testConf.treeFile)).data;
        let csv = testConf.csv;
        let params = testConf.params;
        let promiseResult;
        let promiseError;
        let jobResult;
        let jobParameters;
        let jobInstanceManager;

        let onCompleteCb = null;
        let onFailCb = null;
        let onStoppedCb = null;

        beforeAll(function (done) {
            if (testConf.csvFile) {
                loadCsv(testConf.csvFile, (c) => {
                    csv = c;
                    done();
                })
            } else {
                done();
            }
        });

        beforeAll(function (done) {

            computationsManager.data = new DataModel(testConf.data);
            jobParameters = job.createJobParameters(params);
            computationsManager.runJobWithInstanceManager(job.name, jobParameters.values, {
                onJobStarted: () => {

                },
                onJobCompleted: (res) => {
                    jobResult = res;
                    if (onCompleteCb) {
                        onCompleteCb(res);
                    }
                },
                onJobFailed: (e) => {
                    promiseError = e;
                    if (onFailCb) {
                        onFailCb(e);
                    }
                    done();
                },
                onJobStopped: () => {
                    if (onStoppedCb) {
                        onStoppedCb();
                    }
                }
            }).then(r => {
                promiseResult = r;
                jobInstanceManager = r;
                done();

            }).catch(e => {
                promiseError = e;
                done();
            })
        });

        it("job execution should not have errors", function () {
            expect(promiseError).toBeFalsy()
        });

        it("jobInstanceManager should not be undefined", () => {
            expect(jobInstanceManager).toBeTruthy()
        });

        it("job should be stoppable", (done) => {
            onStoppedCb = done;
            jobInstanceManager.stop().then((lastJobExecution) => {
                expect(lastJobExecution).toBeTruthy()
            }).catch(() => {
                fail();
                done();
            })
        });

        it("job should be resumable", (done) => {
            onCompleteCb = done;
            onFailCb = done;
            jobInstanceManager.resume().then((lastJobExecution) => {
                expect(lastJobExecution).toBeTruthy();

            }).catch(() => {
                fail();
                done();
            })
        });

        if (csv === true) {
            it("csv should be generated without errors", function () {
                expect(job.jobResultToCsvRows(jobResult, jobParameters)).toBeTruthy()

            });
        } else {
            it("csv should be correct", function () {
                let csv2 = job.jobResultToCsvRows(jobResult, jobParameters);
                compareCsv(csv2, csv)
            });
        }

        it("job instance should terminate without errors", function (done) {
            jobInstanceManager.terminate().then(r => {
                expect(r).toBeTruthy();
                done();
            }).catch(e => {
                expect(e).toBeFalsy();
                done();
            })

        });
    });

});


function loadData(fileName) {
    return JSON.parse(readFixtures("data/" + fileName));
}


function loadCsv(fileName, cb) {
    csvParse(readFixtures("data/csv/" + fileName), {'auto_parse': true}, function (err, rows) {
        cb(rows)
    })
}

function compareCsv(csv1, csv2) {
    expect(csv1.length).toEqual(csv2.length);

    csv1.forEach((row1, index) => {
        let row2 = csv2[index];
        expect(row1.length).toEqual(row2.length);

        row1.forEach((cell, cellIndex) => {
            expect(getCellVal(cell)).toEqual(getCellVal(row2[cellIndex]));
        });
    })
}

function getCellVal(v) {
    if (!v && v !== false) {
        return ''
    }
    if (v === false) {
        return 'false'
    }
    if (v === true) {
        return 'true'
    }
    return v;
}
