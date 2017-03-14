import {JobRepository} from "./job-repository";
import {Utils} from "sd-utils";

export class SimpleJobRepository extends JobRepository{
    jobInstancesByKey = {};
    jobExecutions = [];
    stepExecutions = [];
    executionProgress = {};
    executionFlags = {};

    /*returns promise*/
    getJobInstance(jobName, jobParameters) {
        var key = this.generateJobInstanceKey(jobName, jobParameters);
        return Promise.resolve(this.jobInstancesByKey[key]);
    }

    /*should return promise that resolves to saved instance*/
    saveJobInstance(jobInstance, jobParameters){
        var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
        this.jobInstancesByKey[key] = jobInstance;
        return Promise.resolve(jobInstance)
    }

    getJobExecutionById(id){
        return Promise.resolve(Utils.find(this.jobExecutions, ex=>ex.id===id))
    }

    /*should return promise that resolves to saved jobExecution*/
    saveJobExecution(jobExecution){
        this.jobExecutions.push(jobExecution);
        return Promise.resolve(jobExecution);
    }

    updateJobExecutionProgress(jobExecutionId, progress){
        this.executionProgress[jobExecutionId] = progress;
        return Promise.resolve(progress)
    }

    getJobExecutionProgress(jobExecutionId){
        return Promise.resolve(this.executionProgress[jobExecutionId])
    }

    saveJobExecutionFlag(jobExecutionId, flag){
        this.executionFlags[jobExecutionId] = flag;
        return Promise.resolve(flag)
    }

    getJobExecutionFlag(jobExecutionId){
        return Promise.resolve(this.executionFlags[jobExecutionId])
    }

    /*should return promise which resolves to saved stepExecution*/
    saveStepExecution(stepExecution){
        this.stepExecutions.push(stepExecution);
        return Promise.resolve(stepExecution);
    }

    /*find job executions sorted by createTime, returns promise*/
    findJobExecutions(jobInstance) {
        return Promise.resolve(this.jobExecutions.filter(e=>e.jobInstance.id == jobInstance.id).sort(function (a, b) {
            return a.createTime.getTime() - b.createTime.getTime()
        }));
    }
}
