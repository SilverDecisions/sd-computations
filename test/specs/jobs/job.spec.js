import {ComputationsManager} from '../../../src/computations-manager'
import {DataModel} from "sd-model";
import {parse as csvParse} from "csv"



let computationManagerConfigs = [
    {
        "name": "IDB job repository without worker",
        "config":{}
    },
    {
        "name": "IDB with worker",
        "config":{
            "worker": {
                "url": "/base/test/job-worker.worker.js"
            }
        }
    },
    {
        "name": "timeout job repository",
        "config":{
            "jobRepositoryType": "timeout"
        }
    },
    {
        "name": "simple job repository",
        "config":{
            "jobRepositoryType": "simple"
        }
    }
];


computationManagerConfigs.forEach(mangerConf=>{

    describe("Computation manger config ["+mangerConf.name+"] - ",  () => {
        let computationsManager = new ComputationsManager(mangerConf.config);

        beforeAll((done)=>{
            //hack to get generated browserify bundle script src and pass it to worker
            if(mangerConf.config.worker && mangerConf.config.worker.url && computationsManager.jobsManger.jobWorker){

                let browserifyBundleSrc = findScriptSrc(/.+\.browserify.*/);

                // let browserifyBundleSrc = $("script:regex(src, .+\.browserify.*)").attr('src');
                console.log('browserifyBundleSrc', browserifyBundleSrc);
                computationsManager.jobsManger.jobWorker.addListener("worker_loaded", ()=>{
                    // console.log("worker_loaded received");
                    done();
                });

                computationsManager.jobsManger.jobWorker.postMessage(browserifyBundleSrc)
            }else{
                done();
            }
        }, 15000);


        describe("Job", () => {


            let fixtures = jasmine.getFixtures();
            fixtures.fixturesPath = "base/test/";
            let fileList = JSON.parse(readFixtures("data-json-filelist.json"));



            fileList.filter(n=>n.lastIndexOf('job-', 0) === 0).forEach(function (fileName) {
                let json = loadData(fileName);

                describe(json.name+" from "+fileName+":", function(){
                    let job = computationsManager.getJobByName(json.name);

                    json.tests.forEach((testConf, testIndex)=>{

                        describe(" index " + testIndex, function () {
                            testConf.data = JSON.parse(readFixtures("trees/"+testConf.treeFile)).data;
                            let csv = testConf.csv;
                            let params = testConf.params;
                            let promiseResult;
                            let promiseError;
                            let jobResult;
                            let jobParameters;
                            let jobInstanceManager;


                            beforeAll(function (done) {
                                if(testConf.csvFile){
                                    loadCsv(testConf.csvFile, (c)=>{
                                        csv = c;
                                        done();
                                    })
                                }else{
                                    done();
                                }
                            });

                            beforeAll(function(done) {

                                computationsManager.data = new DataModel(testConf.data);
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
                                    jobInstanceManager = r;
                                }).catch(e=>{
                                    promiseError = e;
                                    done();
                                })
                            }, 15000);

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
                                    compareCsv(csv2, csv)
                                });
                            }

                            it("job instance should terminate without errors", function(done) {
                                jobInstanceManager.terminate().then(r=>{
                                    expect(r).toBeTruthy();
                                    done();
                                }).catch(e=>{
                                    expect(e).toBeFalsy();
                                    done();
                                })

                            });
                        });

                    })

                })
            });

        });
    });
});


function loadData(fileName){
    return JSON.parse(readFixtures("data/"+fileName));
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
            expect(getCellVal(cell)).toEqual(getCellVal(row2[cellIndex]));
        });
    })
}

function getCellVal(v){
    if (!v && v !== false){
        return ''
    }
    if(v === false){
        return 'false'
    }
    if(v === true){
        return 'true'
    }
    return v;
}

function findScriptSrc(regex){
    return $("script").filter(function() {
        return this.src.match(regex);
    }).first().attr('src');
}
