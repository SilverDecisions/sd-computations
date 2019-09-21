import {JobRepository} from "./job-repository";
import {Utils} from "sd-utils";
import {SimpleJobRepository} from "./simple-job-repository";



export class TimeoutJobRepository extends SimpleJobRepository{

    createTimeoutPromise(valueToResolve, delay=1){
        return new Promise(resolve=>{
            setTimeout(function(){
                resolve(valueToResolve);
            }, delay)
        });
    }

    /*returns promise*/
    getJobInstance(jobName, jobParameters) {
        var key = this.generateJobInstanceKey(jobName, jobParameters);
        return this.createTimeoutPromise(this.jobInstancesByKey[key]);
    }

    /*should return promise that resolves to saved instance*/
    saveJobInstance(jobInstance, jobParameters){
        var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
        this.jobInstancesByKey[key] = jobInstance;
        return this.createTimeoutPromise(jobInstance);
    }

    getJobResult(jobResultId){
        return this.createTimeoutPromise(Utils.find(this.jobResults, r=>r.id===jobResultId));
    }

    getJobResultByInstance(jobInstance){
        return this.createTimeoutPromise(Utils.find(this.jobResults, r=>r.jobInstance.id===jobInstance.id));
    }

    getJobResultByExecution(jobExecution){
        return this.getJobResultByInstance(jobExecution.jobInstance);
    }

    saveJobResult(jobResult) {
        this.jobResults.push(jobResult);
        return this.createTimeoutPromise(jobResult);
    }

    getJobExecutionById(id){
        return this.createTimeoutPromise(Utils.find(this.jobExecutions, ex=>ex.id===id));
    }

    /*should return promise that resolves to saved jobExecution*/
    saveJobExecution(jobExecution){
        this.jobExecutions.push(jobExecution);
        return this.createTimeoutPromise(jobExecution);
    }

    updateJobExecutionProgress(jobExecutionId, progress){
        this.executionProgress[jobExecutionId] = progress;
        return this.createTimeoutPromise(progress);
    }

    getJobExecutionProgress(jobExecutionId){
        return this.createTimeoutPromise(this.executionProgress[jobExecutionId]);
    }

    saveJobExecutionFlag(jobExecutionId, flag){
        this.executionFlags[jobExecutionId] = flag;
        return this.createTimeoutPromise(flag);
    }

    getJobExecutionFlag(jobExecutionId){
        return this.createTimeoutPromise(this.executionFlags[jobExecutionId]);
    }

    /*should return promise which resolves to saved stepExecution*/
    saveStepExecution(stepExecution){
        this.stepExecutions.push(stepExecution);
        return this.createTimeoutPromise(stepExecution);
    }

    /*find job executions sorted by createTime, returns promise*/
    findJobExecutions(jobInstance) {
        return this.createTimeoutPromise(this.jobExecutions.filter(e=>e.jobInstance.id == jobInstance.id).sort(function (a, b) {
            return a.createTime.getTime() - b.createTime.getTime()
        }));
    }

    remove(object){ //TODO

    }
}
