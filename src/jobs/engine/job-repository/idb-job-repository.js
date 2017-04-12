import {JobRepository} from "./job-repository";
import {default as idb} from "idb";
import {Utils} from "sd-utils";
import {JobExecution} from "../job-execution";
import {JobInstance} from "../job-instance";
import {StepExecution} from "../step-execution";
import {ExecutionContext} from "../execution-context";
import {DataModel} from "sd-model";
import {log} from "sd-utils";

/* IndexedDB job repository*/
export class IdbJobRepository extends JobRepository {

    dbPromise;
    jobInstanceDao;
    jobExecutionDao;
    stepExecutionDao;
    jobResultDao;
    jobExecutionProgressDao;
    jobExecutionFlagDao;

    constructor(expressionsReviver, dbName = 'sd-job-repository', deleteDB = false) {
        super();
        this.dbName = dbName;
        this.expressionsReviver = expressionsReviver;
        if (deleteDB) {
            this.deleteDB().then(()=> {
                this.initDB()
            }).catch(e=> {
                log.error(e);
                this.initDB();
            })
        } else {
            this.initDB()
        }
    }

    initDB() {
        this.dbPromise = idb.open(this.dbName, 1, upgradeDB => {
            upgradeDB.createObjectStore('job-instances');
            var jobExecutionsOS = upgradeDB.createObjectStore('job-executions');
            jobExecutionsOS.createIndex("jobInstanceId", "jobInstance.id", {unique: false});
            jobExecutionsOS.createIndex("createTime", "createTime", {unique: false});
            jobExecutionsOS.createIndex("status", "status", {unique: false});
            upgradeDB.createObjectStore('job-execution-progress');
            upgradeDB.createObjectStore('job-execution-flags');
            var stepExecutionsOS = upgradeDB.createObjectStore('step-executions');
            stepExecutionsOS.createIndex("jobExecutionId", "jobExecutionId", {unique: false});

            var jobResultOS = upgradeDB.createObjectStore('job-results');
            jobResultOS.createIndex("jobInstanceId", "jobInstance.id", {unique: true});
        });

        this.jobInstanceDao = new ObjectStoreDao('job-instances', this.dbPromise);
        this.jobExecutionDao = new ObjectStoreDao('job-executions', this.dbPromise);
        this.jobExecutionProgressDao = new ObjectStoreDao('job-execution-progress', this.dbPromise);
        this.jobExecutionFlagDao = new ObjectStoreDao('job-execution-flags', this.dbPromise);
        this.stepExecutionDao = new ObjectStoreDao('step-executions', this.dbPromise);
        this.jobResultDao = new ObjectStoreDao('job-results', this.dbPromise);
    }

    deleteDB() {
        return Promise.resolve().then(_=>idb.delete(this.dbName));
    }


    getJobResult(jobResultId) {
        return this.jobResultDao.get(jobResultId);
    }

    getJobResultByInstance(jobInstance) {
        return this.jobResultDao.getByIndex("jobInstanceId", jobInstance.id);
    }

    saveJobResult(jobResult) {
        return this.jobResultDao.set(jobResult.id, jobResult).then(r=>jobResult);
    }

    /*returns promise*/
    getJobInstance(jobName, jobParameters) {
        var key = this.generateJobInstanceKey(jobName, jobParameters);
        return this.jobInstanceDao.get(key).then(dto=>dto ? this.reviveJobInstance(dto) : dto);
    }

    /*should return promise that resolves to saved instance*/
    saveJobInstance(jobInstance, jobParameters) {
        var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
        return this.jobInstanceDao.set(key, jobInstance).then(r=>jobInstance);
    }

    /*should return promise that resolves to saved jobExecution*/
    saveJobExecution(jobExecution) {
        var dto = jobExecution.getDTO();
        var stepExecutionsDTOs = dto.stepExecutions;
        dto.stepExecutions = null;
        return this.jobExecutionDao.set(jobExecution.id, dto).then(r=>this.saveStepExecutionsDTOS(stepExecutionsDTOs)).then(r=>jobExecution);
    }

    updateJobExecutionProgress(jobExecutionId, progress) {
        return this.jobExecutionProgressDao.set(jobExecutionId, progress)
    }

    getJobExecutionProgress(jobExecutionId) {
        return this.jobExecutionProgressDao.get(jobExecutionId)
    }

    saveJobExecutionFlag(jobExecutionId, flag) {
        return this.jobExecutionFlagDao.set(jobExecutionId, flag)
    }

    getJobExecutionFlag(jobExecutionId) {
        return this.jobExecutionFlagDao.get(jobExecutionId)
    }

    /*should return promise which resolves to saved stepExecution*/
    saveStepExecution(stepExecution) {
        var dto = stepExecution.getDTO(["jobExecution"]);
        return this.stepExecutionDao.set(stepExecution.id, dto).then(r=>stepExecution);
    }

    saveStepExecutionsDTOS(stepExecutions, savedExecutions = []) {
        if (stepExecutions.length <= savedExecutions.length) {
            return Promise.resolve(savedExecutions);
        }
        var stepExecutionDTO = stepExecutions[savedExecutions.length];
        return this.stepExecutionDao.set(stepExecutionDTO.id, stepExecutionDTO).then(()=> {
            savedExecutions.push(stepExecutionDTO);
            return this.saveStepExecutionsDTOS(stepExecutions, savedExecutions);
        });
    }

    getJobExecutionById(id) {
        return this.jobExecutionDao.get(id).then(dto=> {
            return this.fetchJobExecutionRelations(dto);
        });
    }

    fetchJobExecutionRelations(jobExecutionDTO, revive = true) {
        if (!jobExecutionDTO) {
            return Promise.resolve(null)
        }
        return this.findStepExecutions(jobExecutionDTO.id, false).then(steps=> {
            jobExecutionDTO.stepExecutions = steps;
            if (!revive) {
                return jobExecutionDTO;
            }
            return this.reviveJobExecution(jobExecutionDTO);
        })
    }

    fetchJobExecutionsRelations(jobExecutionDtoList, revive = true, fetched = []) {
        if (jobExecutionDtoList.length <= fetched.length) {
            return Promise.resolve(fetched);
        }
        return this.fetchJobExecutionRelations(jobExecutionDtoList[fetched.length], revive).then((jobExecution)=> {
            fetched.push(jobExecution);

            return this.fetchJobExecutionsRelations(jobExecutionDtoList, revive, fetched);
        });
    }

    findStepExecutions(jobExecutionId, revive = true) {
        return this.stepExecutionDao.getAllByIndex("jobExecutionId", jobExecutionId).then(dtos=> {
            if (!revive) {
                return dtos;
            }
            return dtos.map(dto=>this.reviveStepExecution(dto));
        })
    }


    /*find job executions sorted by createTime, returns promise*/
    findJobExecutions(jobInstance, fetchRelationsAndRevive = true) {
        return this.jobExecutionDao.getAllByIndex("jobInstanceId", jobInstance.id).then(values=> {
            var sorted = values.sort(function (a, b) {
                return a.createTime.getTime() - b.createTime.getTime()
            });

            if (!fetchRelationsAndRevive) {
                return sorted;
            }

            return this.fetchJobExecutionsRelations(sorted, true)
        });
    }

    getLastJobExecutionByInstance(jobInstance) {
        return this.findJobExecutions(jobInstance, false).then(executions=>this.fetchJobExecutionRelations(executions[executions.length - 1]));
    }

    getLastStepExecution(jobInstance, stepName) {
        return this.findJobExecutions(jobInstance).then(jobExecutions=> {
            var stepExecutions = [];
            jobExecutions.forEach(jobExecution=>jobExecution.stepExecutions.filter(s=>s.stepName === stepName).forEach((s)=>stepExecutions.push(s)));
            var latest = null;
            stepExecutions.forEach(s=> {
                if (latest == null || latest.startTime.getTime() < s.startTime.getTime()) {
                    latest = s;
                }
            });
            return latest;
        })
    }

    reviveJobInstance(dto) {
        return new JobInstance(dto.id, dto.jobName);
    }

    reviveExecutionContext(dto) {
        var executionContext = new ExecutionContext();
        executionContext.context = dto.context;
        var data = executionContext.getData();
        if (data) {
            var dataModel = new DataModel();
            dataModel.loadFromDTO(data, this.expressionsReviver);
            executionContext.setData(dataModel);
        }
        return executionContext
    }

    reviveJobExecution(dto) {

        var job = this.getJobByName(dto.jobInstance.jobName);
        var jobInstance = this.reviveJobInstance(dto.jobInstance);
        var jobParameters = job.createJobParameters(dto.jobParameters.values);
        var jobExecution = new JobExecution(jobInstance, jobParameters, dto.id);
        var executionContext = this.reviveExecutionContext(dto.executionContext);
        return Utils.mergeWith(jobExecution, dto, (objValue, srcValue, key, object, source, stack)=> {
            if (key === "jobInstance") {
                return jobInstance;
            }
            if (key === "executionContext") {
                return executionContext;
            }
            if (key === "jobParameters") {
                return jobParameters;
            }
            if (key === "jobExecution") {
                return jobExecution;
            }

            if (key === "stepExecutions") {
                return srcValue.map(stepDTO => this.reviveStepExecution(stepDTO, jobExecution));
            }
        })
    }

    reviveStepExecution(dto, jobExecution) {
        var stepExecution = new StepExecution(dto.stepName, jobExecution, dto.id);
        var executionContext = this.reviveExecutionContext(dto.executionContext);
        return Utils.mergeWith(stepExecution, dto, (objValue, srcValue, key, object, source, stack)=> {
            if (key === "jobExecution") {
                return jobExecution;
            }
            if (key === "executionContext") {
                return executionContext;
            }
        })
    }
}


class ObjectStoreDao {

    name;
    dbPromise;

    constructor(name, dbPromise) {
        this.name = name;
        this.dbPromise = dbPromise;
    }

    get(key) {
        return this.dbPromise.then(db => {
            return db.transaction(this.name)
                .objectStore(this.name).get(key);
        });
    }

    getAllByIndex(indexName, key) {
        return this.dbPromise.then(db => {
            return db.transaction(this.name)
                .objectStore(this.name).index(indexName).getAll(key)
        });
    }

    getByIndex(indexName, key) {
        return this.dbPromise.then(db => {
            return db.transaction(this.name)
                .objectStore(this.name).index(indexName).get(key)
        });
    }

    set(key, val) {
        return this.dbPromise.then(db => {
            const tx = db.transaction(this.name, 'readwrite');
            tx.objectStore(this.name).put(val, key);
            return tx.complete;
        });
    }

    remove(key) {
        return this.dbPromise.then(db => {
            const tx = db.transaction(this.name, 'readwrite');
            tx.objectStore(this.name).delete(key);
            return tx.complete;
        });
    }

    clear() {
        return this.dbPromise.then(db => {
            const tx = db.transaction(this.name, 'readwrite');
            tx.objectStore(this.name).clear();
            return tx.complete;
        });
    }

    keys() {
        return this.dbPromise.then(db => {
            const tx = db.transaction(this.name);
            const keys = [];
            const store = tx.objectStore(this.name);

            // This would be store.getAllKeys(), but it isn't supported by Edge or Safari.
            // openKeyCursor isn't supported by Safari, so we fall back
            (store.iterateKeyCursor || store.iterateCursor).call(store, cursor => {
                if (!cursor) return;
                keys.push(cursor.key);
                cursor.continue();
            });

            return tx.complete.then(() => keys);
        });
    }
}
