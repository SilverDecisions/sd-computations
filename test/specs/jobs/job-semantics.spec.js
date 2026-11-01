import {ComputationsManager} from '../../../src/computations-manager'
import {EXPRESSION_SEMANTICS_KEY} from '../../../src/jobs/engine/job-repository/job-repository'
import {currentExpressionSemantics, LEGACY_EXPRESSION_SEMANTICS} from '../../../src/jobs/engine/expression-semantics'
import {JOB_EXECUTION_FLAG} from '../../../src/jobs/engine/job-execution-flag'
import {JOB_STATUS} from '../../../src/jobs/engine/job-status'
import {ExpressionEngine} from "sd-expression-engine";
import {DataModel} from "sd-model";

// A stopped job is continued only under the expression semantics profile it was
// started with (Math.js version and configuration, expression-semantics.js);
// otherwise its instance is kept under another key and a new instance starts from
// the beginning, so that results of different semantics are never combined. A worker
// whose profile differs from the page's does not compute the page's jobs.

let fixtures = jasmine.getFixtures();
const JOB = "probabilistic-sensitivity-analysis";
// (the simple repository runs a job in microtasks only: the browser is blocked until it ends)
const RUNS = 100;
const STOP_AT = 20;

// another configuration of the same Math.js, and an expression whose value depends on it
const MAJOR = parseInt(ExpressionEngine.eval("version", false), 10);
const OTHER_CONFIG = MAJOR >= 13 ? "config({absTol: 0})" : "config({epsilon: 1e-10})";
const DEFAULT_CONFIG = MAJOR >= 13 ? "config({absTol: 1e-15})" : "config({epsilon: 1e-12})";
const PROBE = MAJOR >= 13 ? "1e-15 > 0" : "1 == 1 + 1e-11";
const DEFAULT_PROFILE = currentExpressionSemantics();

function loadTree(name) {
    fixtures.fixturesPath = "base/test/";
    return JSON.parse(readFixtures("trees/" + name)).data;
}

function parameterValues(job, runs) {
    return job.createJobParameters({
        ruleName: "expected-value-maximization",
        numberOfRuns: runs || RUNS,
        variables: [{name: "pr", formula: "Uniform(0.1, 0.9)"}]
    }).values;
}

function loadWorker(cm) {
    return new Promise(resolve => {
        let src = $("script").filter(function () {
            return this.src.match(/.+\.browserify.*/);
        }).first().attr('src');
        cm.jobsManger.jobWorker.addListener("worker_loaded", () => resolve());
        cm.jobsManger.jobWorker.postMessage(src);
    });
}

function lastExecution(repository, instance) {
    return repository.findJobExecutions(instance).then(executions => executions[executions.length - 1]);
}

function instanceAndExecution(repository, job, values) {
    return repository.getJobInstance(job.name, job.createJobParameters(values)).then(instance => instance ?
        lastExecution(repository, instance).then(execution => ({instance, execution})) : {instance: null});
}

function rowsOf(repository, instance) {
    return repository.getJobResultByInstance(instance).then(result => result && result.data && result.data.rows ?
        result.data.rows.map(r => [r.policyIndex, r.variables, String(r.payoff)]) : []);
}

describe("Expression semantics profile", () => {
    afterEach(() => ExpressionEngine.eval(DEFAULT_CONFIG, false));

    it("identifies the Math.js version and configuration", () => {
        expect(DEFAULT_PROFILE).toMatch(/^sd-expressions-1;mathjs-\d+\.\d+\.\d+;\{.+\}$/);
        expect(DEFAULT_PROFILE).toContain(";mathjs-" + ExpressionEngine.eval("version", false) + ";");
        if (MAJOR === 9) {
            // sd-expression-engine 0.1.17 with its defaults: the profile of executions without one
            expect(DEFAULT_PROFILE).toBe(LEGACY_EXPRESSION_SEMANTICS);
        } else {
            expect(DEFAULT_PROFILE).not.toBe(LEGACY_EXPRESSION_SEMANTICS);
        }
    });

    it("differs for configurations of the same Math.js that give different results, also after config(...) in an expression", () => {
        let defaultValue = ExpressionEngine.eval(PROBE, false);
        ExpressionEngine.eval(OTHER_CONFIG, false);
        let otherValue = ExpressionEngine.eval(PROBE, false);
        let otherProfile = currentExpressionSemantics();
        expect(otherValue).not.toBe(defaultValue);
        expect(otherProfile).not.toBe(DEFAULT_PROFILE);
        expect(otherProfile).toContain(";mathjs-" + ExpressionEngine.eval("version", false) + ";");
        ExpressionEngine.eval(DEFAULT_CONFIG, false);
        expect(currentExpressionSemantics()).toBe(DEFAULT_PROFILE);
        expect(ExpressionEngine.eval(PROBE, false)).toBe(defaultValue);
    });
});

[
    {name: "idb", config: {}, storedInstanceId: (repository, key) => repository.jobInstanceDao.get(key).then(dto => dto && dto.id)},
    {name: "simple", config: {jobRepositoryType: "simple"}, storedInstanceId: (repository, key) => Promise.resolve(repository.jobInstancesByKey[key]).then(i => i && i.id)}
].forEach(conf => {
    describe("Resuming jobs and expression semantics [" + conf.name + " repository, without worker]", () => {
        let cm = new ComputationsManager(conf.config);
        let repository = cm.jobsManger.jobRepository;
        let job = cm.getJobByName(JOB);

        beforeAll(() => {
            cm.setData(new DataModel(loadTree("rockefellerWithParams.json")));
        });

        afterEach(() => {
            ExpressionEngine.eval(DEFAULT_CONFIG, false);
            expect(currentExpressionSemantics()).toBe(DEFAULT_PROFILE);
        });

        // runs (or resumes) the job; stopAt: number of runs after which it is stopped
        // (the stop flag is set when that progress is stored, so the job stops before its next chunk)
        function run(values, stopAt, data) {
            let updateProgress = repository.updateJobExecutionProgress;
            if (stopAt) {
                repository.updateJobExecutionProgress = function (id, progress) {
                    return updateProgress.call(this, id, progress).then(r => progress.total === RUNS && progress.current >= stopAt ?
                        this.saveJobExecutionFlag(id, JOB_EXECUTION_FLAG.STOP).then(() => r) : r);
                };
            }
            let restore = () => {
                repository.updateJobExecutionProgress = updateProgress;
            };
            let previous = cm.data;
            if (data) {
                cm.setData(data);
            }
            return new Promise((resolve, reject) => {
                cm.runJobWithInstanceManager(JOB, values, {
                    onJobStopped: () => resolve({stopped: true}),
                    onJobCompleted: data => resolve({completed: true, data: data}),
                    onJobFailed: errors => resolve({failed: errors})
                }).catch(reject);
            }).then(r => {
                restore();
                cm.setData(previous);
                return r;
            }, e => {
                restore();
                cm.setData(previous);
                throw e;
            });
        }

        let key = values => repository.generateJobInstanceKey(JOB, job.createJobParameters(values));

        it("records the current profile in new job executions", (done) => {
            let values = parameterValues(job);
            run(values, STOP_AT).then(r => {
                expect(r.stopped).toBe(true);
                return instanceAndExecution(repository, job, values);
            }).then(({instance, execution}) => {
                expect(instance).toBeTruthy();
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(DEFAULT_PROFILE);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("continues the same instance under the same profile", (done) => {
            let values = parameterValues(job);
            let first, stoppedRows;
            run(values, STOP_AT).then(r => {
                expect(r.stopped).toBe(true);
                return instanceAndExecution(repository, job, values);
            }).then(r => {
                first = r.instance;
                return rowsOf(repository, first);
            }).then(rows => {
                stoppedRows = rows;
                return run(values);
            }).then(r => {
                expect(r.completed).toBe(true);
                let policies = r.data.policies.length;
                expect(stoppedRows.length).toBe(STOP_AT * policies);
                expect(r.data.rows.length).toBe(RUNS * policies);
                return instanceAndExecution(repository, job, values);
            }).then(({instance, execution}) => {
                expect(instance.id).toBe(first.id);
                expect(execution.status).toBe(JOB_STATUS.COMPLETED);
                return rowsOf(repository, instance);
            }).then(rows => {
                // the rows computed before the stop are continued, not recomputed
                expect(rows.slice(0, stoppedRows.length)).toEqual(stoppedRows);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("keeps a job of another profile (config(...) changed) and starts a new instance from the beginning", (done) => {
            let values = parameterValues(job);
            let old, oldRows, otherProfile;
            run(values, STOP_AT).then(() => instanceAndExecution(repository, job, values)).then(r => {
                old = r.instance;
                return rowsOf(repository, old);
            }).then(rows => {
                oldRows = rows;
                expect(rows.length).toBeGreaterThan(0);
                ExpressionEngine.eval(OTHER_CONFIG, false);
                otherProfile = currentExpressionSemantics();
                return run(values);
            }).then(r => {
                expect(r.completed).toBe(true);
                // all runs of the new instance, none of the stopped one
                expect(r.data.rows.length).toBe(RUNS * r.data.policies.length);
                return instanceAndExecution(repository, job, values);
            }).then(({instance, execution}) => {
                expect(instance.id).not.toBe(old.id);
                expect(execution.status).toBe(JOB_STATUS.COMPLETED);
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(otherProfile);
                return conf.storedInstanceId(repository, key(values) + "|archived|" + old.id);
            }).then(archivedId => {
                // the old job is kept as it was, under another key
                expect(archivedId).toBe(old.id);
                return lastExecution(repository, old);
            }).then(execution => {
                expect(execution.status).toBe(JOB_STATUS.STOPPED);
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(DEFAULT_PROFILE);
                return rowsOf(repository, old);
            }).then(rows => {
                expect(rows).toEqual(oldRows);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("treats executions without a profile (sd-computations <= 0.6.1) as sd-expression-engine 0.1.17 with its defaults", (done) => {
            let legacyValues = parameterValues(job);
            let otherValues = parameterValues(job);
            let stopWithoutProfile = (values) => run(values, STOP_AT).then(() => instanceAndExecution(repository, job, values)).then(({instance, execution}) => {
                execution.executionContext.remove(EXPRESSION_SEMANTICS_KEY);
                return repository.saveJobExecution(execution).then(() => instance);
            });
            let a, b;
            stopWithoutProfile(legacyValues).then(instance => {
                a = instance;
                return stopWithoutProfile(otherValues);
            }).then(instance => {
                b = instance;
                return run(legacyValues);
            }).then(r => {
                expect(r.completed).toBe(true);
                return instanceAndExecution(repository, job, legacyValues);
            }).then(({instance}) => {
                if (DEFAULT_PROFILE === LEGACY_EXPRESSION_SEMANTICS) {
                    expect(instance.id).toBe(a.id, "continued under 0.1.17 defaults");
                } else {
                    expect(instance.id).not.toBe(a.id, "a new instance under " + DEFAULT_PROFILE);
                }
                // another configuration: never continued
                ExpressionEngine.eval(OTHER_CONFIG, false);
                return run(otherValues);
            }).then(r => {
                expect(r.completed).toBe(true);
                return instanceAndExecution(repository, job, otherValues);
            }).then(({instance}) => {
                expect(instance.id).not.toBe(b.id);
                return conf.storedInstanceId(repository, key(otherValues) + "|archived|" + b.id);
            }).then(archivedId => {
                expect(archivedId).toBe(b.id);
            }).then(done, e => done.fail(e));
        }, 90000);

        it("fails a job whose own expressions change the profile, saves none of its results and does not continue it", (done) => {
            // the diagram changes the shared Math.js configuration in node code, evaluated in every run
            let tree = loadTree("rockefellerWithParams.json");
            tree.trees[0].code += "\ncfg = " + OTHER_CONFIG;
            let data = new DataModel(tree);
            let values = parameterValues(job);
            let failed;
            run(values, null, data).then(r => {
                expect(r.failed).toBeTruthy("failed");
                expect(String(r.failed && r.failed.map(e => e.message))).toContain("expression semantics");
                return instanceAndExecution(repository, job, values);
            }).then(({instance, execution}) => {
                failed = instance;
                expect(execution.status).toBe(JOB_STATUS.FAILED);
                expect(execution.isRunning()).toBe(false);
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(DEFAULT_PROFILE + ";changed-during-execution");
                return rowsOf(repository, instance);
            }).then(rows => {
                expect(rows.length).toBe(0, "no rows saved");
                // the configuration set by the diagram stays: a new run is a new instance, consistent from the start
                expect(currentExpressionSemantics()).not.toBe(DEFAULT_PROFILE);
                return run(values, null, data);
            }).then(r => {
                expect(r.completed).toBe(true);
                expect(r.data.rows.length).toBe(RUNS * r.data.policies.length);
                return instanceAndExecution(repository, job, values);
            }).then(({instance}) => {
                expect(instance.id).not.toBe(failed.id);
            }).then(done, e => done.fail(e));
        }, 90000);
    });
});

describe("Resuming jobs and expression semantics [idb repository, with a real Web Worker]", () => {
    // the page has the default configuration; this worker another one
    let cmOther = new ComputationsManager({worker: {url: "/base/test/job-worker-other-semantics.worker.js"}});
    let cmGood = new ComputationsManager({worker: {url: "/base/test/job-worker.worker.js"}});
    let job = cmOther.getJobByName(JOB);
    let repository = cmOther.jobsManger.jobRepository;
    const WORKER_RUNS = 50;

    beforeAll((done) => {
        let tree = loadTree("rockefellerWithParams.json");
        cmOther.setData(new DataModel(tree));
        cmGood.setData(new DataModel(tree));
        Promise.all([loadWorker(cmOther), loadWorker(cmGood)]).then(() => done());
    }, 30000);

    afterEach(() => {
        expect(currentExpressionSemantics()).toBe(DEFAULT_PROFILE);
    });

    function expectRefused(execution) {
        expect(execution.status).toBe(JOB_STATUS.FAILED);
        expect(execution.endTime).toBeTruthy();
        expect(execution.isRunning()).toBe(false);
        expect(String(execution.failureExceptions.map(e => e && e.message))).toContain("expression semantics");
        return repository.getJobExecutionById(execution.id).then(stored => {
            // stored: status, end, diagnostics
            expect(stored.status).toBe(JOB_STATUS.FAILED);
            expect(stored.isRunning()).toBe(false);
            expect(String(stored.failureExceptions.map(e => e && e.message))).toContain("expression semantics");
            expect(stored.stepExecutions.length).toBe(0, "nothing computed by the worker");
            return repository.getJobResultByInstance(stored.jobInstance);
        }).then(result => {
            expect(result).toBeFalsy("no result written by the worker");
        });
    }

    it("a refused execution is ended and reported to execution listeners (run resolves when launched)", (done) => {
        let values = parameterValues(job, WORKER_RUNS);
        let launched;
        let reported = new Promise(resolve => {
            let listener = {
                beforeJob: () => {},
                afterJob: e => {
                    if (launched && e.id === launched.id) {
                        cmOther.jobsManger.deregisterJobExecutionListener(listener);
                        resolve(e);
                    }
                }
            };
            cmOther.jobsManger.registerJobExecutionListener(listener);
        });
        cmOther.runJob(JOB, values).then(execution => {
            launched = execution;
            expect(execution.status).toBe(JOB_STATUS.STARTING);
            return reported;
        }).then(execution => expectRefused(execution)).then(done, e => done.fail(e));
    }, 30000);

    it("a refused execution resolves run(..., resolvePromiseAfterJobIsLaunched = false)", (done) => {
        let values = parameterValues(job, WORKER_RUNS);
        cmOther.runJob(JOB, values, null, false).then(execution => {
            expect(execution).toBeTruthy();
            return expectRefused(execution);
        }).then(done, e => done.fail(e));
    }, 30000);

    it("a refused execution reaches the JobInstanceManager, and the job is run again with a compatible worker", (done) => {
        let values = parameterValues(job, WORKER_RUNS);
        let refused;
        new Promise((resolve, reject) => {
            cmOther.runJobWithInstanceManager(JOB, values, {
                onJobFailed: errors => resolve(errors),
                onJobCompleted: () => reject("completed by the worker of other semantics")
            }).then(manager => (refused = manager)).catch(reject);
        }).then(errors => {
            expect(String(errors.map(e => e && e.message))).toContain("expression semantics");
            expect(refused.lastJobExecution.isRunning()).toBe(false);
            return expectRefused(refused.lastJobExecution);
        }).then(() => new Promise((resolve, reject) => {
            // again with the same, incompatible worker: refused again (not "already running")
            cmOther.runJobWithInstanceManager(JOB, values, {onJobFailed: resolve, onJobCompleted: () => reject("completed")}).catch(reject);
        })).then(() => new Promise((resolve, reject) => {
            // the compatible worker: the same instance is run and completes
            cmGood.runJobWithInstanceManager(JOB, values, {
                onJobCompleted: data => resolve(data),
                onJobFailed: errors => reject(errors)
            }).catch(reject);
        })).then(data => {
            expect(data.rows.length).toBe(WORKER_RUNS * data.policies.length);
            return instanceAndExecution(repository, job, values);
        }).then(({instance, execution}) => {
            expect(instance.id).toBe(refused.jobInstance.id);
            expect(execution.status).toBe(JOB_STATUS.COMPLETED);
            expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(DEFAULT_PROFILE);
            return repository.findJobExecutions(instance);
        }).then(executions => {
            expect(executions.map(e => e.status)).toEqual([JOB_STATUS.FAILED, JOB_STATUS.FAILED, JOB_STATUS.COMPLETED]);
            expect(executions.every(e => !e.isRunning())).toBe(true);
        }).then(done, e => done.fail(e));
    }, 60000);
});
