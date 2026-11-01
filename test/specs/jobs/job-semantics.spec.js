import {ComputationsManager} from '../../../src/computations-manager'
import {JobsManager} from '../../../src/jobs/jobs-manager'
import {EXPRESSION_SEMANTICS_KEY} from '../../../src/jobs/engine/job-repository/job-repository'
import {JOB_EXECUTION_FLAG} from '../../../src/jobs/engine/job-execution-flag'
import {JOB_STATUS} from '../../../src/jobs/engine/job-status'
import {DataModel} from "sd-model";

// A stopped job is resumed only under the expression semantics it was started with;
// otherwise its instance is kept under another key and a new instance starts from
// the beginning, so that results of different semantics are never combined.

let fixtures = jasmine.getFixtures();
const JOB = "probabilistic-sensitivity-analysis";
const RUNS = 200;
const STOP_AT = 40;

[
    {name: "idb", config: {}, storedInstanceId: (repository, key) => repository.jobInstanceDao.get(key).then(dto => dto && dto.id)},
    {name: "simple", config: {jobRepositoryType: "simple"}, storedInstanceId: (repository, key) => Promise.resolve(repository.jobInstancesByKey[key]).then(i => i && i.id)}
].forEach(conf => {
    describe("Resuming jobs and expression semantics [" + conf.name + " repository]", () => {
        let cm = new ComputationsManager(conf.config);
        let repository = cm.jobsManger.jobRepository;
        let job = cm.getJobByName(JOB);
        let current = JobsManager.expressionSemantics();

        beforeAll(() => {
            fixtures.fixturesPath = "base/test/";
            cm.setData(new DataModel(JSON.parse(readFixtures("trees/rockefellerWithParams.json")).data));
        });

        afterEach(() => {
            repository.expressionSemantics = current;
        });

        function parameterValues() {
            return job.createJobParameters({
                ruleName: "expected-value-maximization",
                numberOfRuns: RUNS,
                variables: [{name: "pr", formula: "Uniform(0.1, 0.9)"}]
            }).values;
        }

        // runs (or resumes) the job; stopAt: number of runs after which it is stopped
        // (the stop flag is set when that progress is stored, so the job stops before its next chunk)
        function run(values, stopAt) {
            let updateProgress = repository.updateJobExecutionProgress;
            if (stopAt) {
                repository.updateJobExecutionProgress = function (id, progress) {
                    return updateProgress.call(this, id, progress).then(r => progress.total === RUNS && progress.current >= stopAt ?
                        this.saveJobExecutionFlag(id, JOB_EXECUTION_FLAG.STOP).then(() => r) : r);
                };
            }
            let manager;
            let restore = () => {
                repository.updateJobExecutionProgress = updateProgress;
                // as a new session: the manager of a stopped run does not follow its resumption
                if (manager) {
                    cm.jobsManger.deregisterJobExecutionListener(manager);
                }
            };
            return new Promise((resolve, reject) => {
                cm.runJobWithInstanceManager(JOB, values, {
                    onJobStopped: () => resolve({stopped: true}),
                    onJobCompleted: data => resolve({completed: true, data: data}),
                    onJobFailed: e => reject(e)
                }).then(m => (manager = m)).catch(reject);
            }).then(r => {
                restore();
                return r;
            }, e => {
                restore();
                throw e;
            });
        }

        function lastExecution(instance) {
            return repository.findJobExecutions(instance).then(executions => executions[executions.length - 1]);
        }

        function instanceAndExecution(values) {
            return repository.getJobInstance(JOB, job.createJobParameters(values)).then(instance => instance ?
                lastExecution(instance).then(execution => ({instance, execution})) : {instance: null});
        }

        function rowsOf(instance) {
            return repository.getJobResultByInstance(instance).then(result => result ?
                result.data.rows.map(r => [r.policyIndex, r.variables, String(r.payoff)]) : []);
        }

        function key(values) {
            return repository.generateJobInstanceKey(JOB, job.createJobParameters(values));
        }

        it("records the semantics of the installed expression engine in new job executions", (done) => {
            expect(current).toMatch(/^mathjs-\d+$/);
            expect(repository.expressionSemantics).toBe(current);
            let values = parameterValues();
            run(values, STOP_AT).then(r => {
                expect(r.stopped).toBe(true);
                return instanceAndExecution(values);
            }).then(({instance, execution}) => {
                expect(instance).toBeTruthy();
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(current);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("resumes the same instance under the same semantics", (done) => {
            let values = parameterValues();
            let first, stoppedRows;
            run(values, STOP_AT).then(r => {
                expect(r.stopped).toBe(true);
                return instanceAndExecution(values);
            }).then(r => {
                first = r.instance;
                return rowsOf(first);
            }).then(rows => {
                stoppedRows = rows;
                return run(values);
            }).then(r => {
                expect(r.completed).toBe(true);
                let policies = r.data.policies.length;
                expect(stoppedRows.length).toBe(STOP_AT * policies);
                expect(r.data.rows.length).toBe(RUNS * policies);
                return instanceAndExecution(values);
            }).then(({instance, execution}) => {
                expect(instance.id).toBe(first.id);
                expect(execution.status).toBe(JOB_STATUS.COMPLETED);
                return rowsOf(instance);
            }).then(rows => {
                // the rows computed before the stop are continued, not recomputed
                expect(rows.slice(0, stoppedRows.length)).toEqual(stoppedRows);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("keeps a job of other semantics and starts a new instance from the beginning", (done) => {
            let values = parameterValues();
            let old, oldRows;
            run(values, STOP_AT).then(() => instanceAndExecution(values)).then(r => {
                old = r.instance;
                return rowsOf(old);
            }).then(rows => {
                oldRows = rows;
                expect(rows.length).toBeGreaterThan(0);
                repository.expressionSemantics = "mathjs-other";
                return run(values);
            }).then(r => {
                expect(r.completed).toBe(true);
                // all runs of the new instance, none of the stopped one
                expect(r.data.rows.length).toBe(RUNS * r.data.policies.length);
                return instanceAndExecution(values);
            }).then(({instance, execution}) => {
                expect(instance.id).not.toBe(old.id);
                expect(execution.status).toBe(JOB_STATUS.COMPLETED);
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe("mathjs-other");
                return conf.storedInstanceId(repository, key(values) + "|archived|" + current + "|" + old.id);
            }).then(archivedId => {
                // the old job is kept as it was, under another key
                expect(archivedId).toBe(old.id);
                return lastExecution(old);
            }).then(execution => {
                expect(execution.status).toBe(JOB_STATUS.STOPPED);
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(current);
                return rowsOf(old);
            }).then(rows => {
                expect(rows).toEqual(oldRows);
            }).then(done, e => done.fail(e));
        }, 60000);

        it("treats executions without a marker (sd-computations <= 0.6.1) as Math.js 9", (done) => {
            let legacyValues = parameterValues();
            let otherValues = parameterValues();
            let stopWithoutMarker = (values) => run(values, STOP_AT).then(() => instanceAndExecution(values)).then(({instance, execution}) => {
                execution.executionContext.remove(EXPRESSION_SEMANTICS_KEY);
                return repository.saveJobExecution(execution).then(() => instance);
            });
            let a, b;
            stopWithoutMarker(legacyValues).then(instance => {
                a = instance;
                return stopWithoutMarker(otherValues);
            }).then(instance => {
                b = instance;
                repository.expressionSemantics = "mathjs-9";
                return run(legacyValues);
            }).then(r => {
                expect(r.completed).toBe(true);
                return instanceAndExecution(legacyValues);
            }).then(({instance}) => {
                expect(instance.id).toBe(a.id, "resumed under Math.js 9");
                repository.expressionSemantics = "mathjs-15";
                return run(otherValues);
            }).then(r => {
                expect(r.completed).toBe(true);
                return instanceAndExecution(otherValues);
            }).then(({instance}) => {
                expect(instance.id).not.toBe(b.id, "a new instance under Math.js 15");
                return conf.storedInstanceId(repository, key(otherValues) + "|archived|mathjs-9|" + b.id);
            }).then(archivedId => {
                expect(archivedId).toBe(b.id);
            }).then(done, e => done.fail(e));
        }, 90000);

        it("does not execute a job execution of other semantics (a worker with another engine)", (done) => {
            let parameters = job.createJobParameters(parameterValues());
            repository.createJobExecution(JOB, parameters, cm.data).then(execution => {
                expect(execution.executionContext.get(EXPRESSION_SEMANTICS_KEY)).toBe(current);
                repository.expressionSemantics = "mathjs-other";
                return cm.jobsManger.execute(execution.id);
            }).then(() => done.fail("executed"), e => {
                expect(String(e && e.message)).toContain("expression semantics " + current);
                done();
            });
        }, 60000);
    });
});
