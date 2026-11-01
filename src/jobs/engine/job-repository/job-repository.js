import {JobKeyGenerator} from "../job-key-generator";
import {JobInstance} from "../job-instance";
import {Utils, log} from "sd-utils";
import {JobExecution} from "../job-execution";
import {JobExecutionAlreadyRunningException} from "../exceptions/job-execution-already-running-exception";
import {JOB_STATUS} from "../job-status";
import {JobInstanceAlreadyCompleteException} from "../exceptions/job-instance-already-complete-exception";
import {ExecutionContext} from "../execution-context";
import {StepExecution} from "../step-execution";
import {DataModel} from "sd-model";
import {JobResult} from "../job-result";

// The meaning of the expressions a job evaluates (Math.js version of
// sd-expression-engine). A job is resumed only under the semantics it was started
// with: results computed with different semantics are never combined.
export const EXPRESSION_SEMANTICS_KEY = "expressionSemantics";
// job executions stored by sd-computations <= 0.6.1 have no marker; those versions
// use sd-expression-engine <= 0.1.17 (Math.js 9)
export const LEGACY_EXPRESSION_SEMANTICS = "mathjs-9";

export class JobRepository {

    jobByName = {};

    // semantics of the current expression engine (set by JobsManager); null: not checked
    expressionSemantics = null;

    registerJob(job) {
        this.jobByName[job.name] = job;
    }

    getJobByName(name) {
        return this.jobByName[name];
    }


    /*returns promise*/
    getJobInstance(jobName, jobParameters) {
       throw "JobRepository getJobInstance function not implemented!"
    }

    /*should return promise that resolves to saved instance*/
    saveJobInstance(key, jobInstance){
        throw "JobRepository.saveJobInstance function not implemented!"
    }

    getJobExecutionById(id){
        throw "JobRepository.getJobExecutionById function not implemented!"
    }

    /*should return promise that resolves to saved jobExecution*/
    saveJobExecution(jobExecution){
        throw "JobRepository.saveJobInstance function not implemented!"
    }

    updateJobExecutionProgress(jobExecutionId, progress){
        throw "JobRepository.saveJobInstance function not implemented!"
    }

    getJobExecutionProgress(jobExecutionId){
        throw "JobRepository.getJobExecutionProgress function not implemented!"
    }

    saveJobExecutionFlag(jobExecutionId, flag){
        throw "JobRepository.saveJobExecutionFlag function not implemented!"
    }

    getJobExecutionFlag(jobExecutionId){
        throw "JobRepository.getJobExecutionFlag function not implemented!"
    }


    /*should return promise which resolves to saved stepExecution*/
    saveStepExecution(stepExecution){
        throw "JobRepository.saveStepExecution function not implemented!"
    }

    /*find job executions sorted by createTime, returns promise*/
    findJobExecutions(jobInstance) {
        throw "JobRepository.findJobExecutions function not implemented!"
    }

    getJobResult(jobResultId){
        throw "JobRepository.getJobResult function not implemented!"
    }

    getJobResultByInstance(jobInstance){
        throw "JobRepository.getJobResultByInstance function not implemented!"
    }

    getJobResultByExecution(jobInstance){
        throw "JobRepository.getJobResultByExecution function not implemented!"
    }

    saveJobResult(jobResult) {
        throw "JobRepository.setJobResult function not implemented!"
    }


    removeJobInstance(jobInstance, jobParameters){
        throw "JobRepository.removeJobInstance function not implemented!"
    }

    removeJobExecution(jobExecution){
        throw "JobRepository.removeJobExecution function not implemented!"
    }

    removeStepExecution(stepExecution){
        throw "JobRepository.removeStepExecution function not implemented!"
    }

    removeJobResult(jobResult){
        throw "JobRepository.removeJobResult function not implemented!"
    }

    /*Create a new JobInstance with the name and job parameters provided. return promise*/
    createJobInstance(jobName, jobParameters) {
        var jobInstance = new JobInstance(Utils.guid(), jobName);
        return this.saveJobInstance(jobInstance, jobParameters);
    }

    /*Check if an instance of this job already exists with the parameters provided.*/
    isJobInstanceExists(jobName, jobParameters) {
        return this.getJobInstance(jobName, jobParameters).then(result => !!result).catch(error=>false);
    }

    generateJobInstanceKey(jobName, jobParameters) {
        return jobName + "|" + JobKeyGenerator.generateKey(jobParameters);
    }

    getExpressionSemantics(jobExecution) {
        let semantics = jobExecution && jobExecution.executionContext && jobExecution.executionContext.get(EXPRESSION_SEMANTICS_KEY);
        return semantics || LEGACY_EXPRESSION_SEMANTICS;
    }

    /*true if the job execution may be continued with the current expression semantics*/
    isResumableWithCurrentSemantics(jobExecution) {
        return !this.expressionSemantics || this.getExpressionSemantics(jobExecution) === this.expressionSemantics;
    }

    /*Keeps a job instance (its executions and result) under another key, so that the
     * job parameters address a new instance. returns promise*/
    archiveJobInstance(jobInstance, jobParameters, semantics) {
        var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
        return this.moveJobInstanceKey(key, key + "|archived|" + semantics + "|" + jobInstance.id, jobInstance);
    }

    moveJobInstanceKey(key, newKey, jobInstance) {
        throw "JobRepository.moveJobInstanceKey function not implemented!"
    }

    /*Create a JobExecution for a given  Job and JobParameters. If matching JobInstance already exists,
     * the job must be restartable and it's last JobExecution must *not* be
     * completed. If matching JobInstance does not exist yet it will be  created.*/

    createJobExecution(jobName, jobParameters, data) {
        return this.getJobInstance(jobName, jobParameters).then(jobInstance=>{
            if (jobInstance != null) {
                return this.findJobExecutions(jobInstance).then(executions=>{
                    executions.forEach(execution=> {
                        if (execution.isRunning()) {
                            throw new JobExecutionAlreadyRunningException("A job execution for this job is already running: " + jobInstance.jobName);
                        }
                        if (execution.status == JOB_STATUS.COMPLETED || execution.status == JOB_STATUS.ABANDONED) {
                            throw new JobInstanceAlreadyCompleteException(
                                "A job instance already exists and is complete for parameters=" + jobParameters
                                + ".  If you want to run this job again, change the parameters.");
                        }
                    });

                    var lastExecution = executions[executions.length - 1];
                    if (!this.isResumableWithCurrentSemantics(lastExecution)) {
                        // started with other expression semantics: keep that job and start a new instance
                        let semantics = this.getExpressionSemantics(lastExecution);
                        log.warn("Job instance " + jobInstance.id + " of " + jobName + " was started with expression semantics " + semantics
                            + ", the current ones are " + this.expressionSemantics + ": it is kept and a new instance is started");
                        return this.archiveJobInstance(jobInstance, jobParameters, semantics).then(()=>this.newJobInstanceAndContext(jobName, jobParameters, data));
                    }

                    return [jobInstance, lastExecution.executionContext];
                })
            }

            // no job found, create one
            return this.newJobInstanceAndContext(jobName, jobParameters, data);
        }).then(instanceAndExecutionContext=>{
            var jobExecution = new JobExecution(instanceAndExecutionContext[0], jobParameters);
            jobExecution.executionContext = instanceAndExecutionContext[1];
            jobExecution.lastUpdated = new Date();
            return this.saveJobExecution(jobExecution);
        }).catch(e=>{
            throw e;
        })
    }

    newJobInstanceAndContext(jobName, jobParameters, data) {
        var jobInstance = this.createJobInstance(jobName, jobParameters);
        var executionContext = new ExecutionContext();
        var dataModel = new DataModel();
        dataModel._setNewState(data.createStateSnapshot());
        executionContext.setData(dataModel);
        if (this.expressionSemantics) {
            executionContext.put(EXPRESSION_SEMANTICS_KEY, this.expressionSemantics);
        }
        return Promise.all([jobInstance, executionContext]);
    }

    getLastJobExecution(jobName, jobParameters) {
        return this.getJobInstance(jobName, jobParameters).then((jobInstance)=>{
            if(!jobInstance){
                return null;
            }
            return this.getLastJobExecutionByInstance(jobInstance);
        })
    }

    getLastJobExecutionByInstance(jobInstance){
        return this.findJobExecutions(jobInstance).then(executions=>executions[executions.length -1]);
    }

    getLastStepExecution(jobInstance, stepName) {
        return this.findJobExecutions(jobInstance).then(jobExecutions=>{
            var stepExecutions=[];
            jobExecutions.forEach(jobExecution=>jobExecution.stepExecutions.filter(s=>s.stepName === stepName).forEach((s)=>stepExecutions.push(s)));
            var latest = null;
            stepExecutions.forEach(s=>{
                if (latest == null || latest.startTime.getTime() < s.startTime.getTime()) {
                    latest = s;
                }
            });
            return latest;
        })
    }

    addStepExecution(stepExecution) {
        stepExecution.lastUpdated = new Date();
        return this.saveStepExecution(stepExecution);
    }

    update(o){
        o.lastUpdated = new Date();

        if(o instanceof JobExecution){
            return this.saveJobExecution(o);
        }

        if(o instanceof StepExecution){
            return this.saveStepExecution(o);
        }

        throw "Object not updatable: "+o
    }

    remove(o){

        if(o instanceof JobExecution){
            return this.removeJobExecution(o);
        }

        if(o instanceof StepExecution){
            return this.removeStepExecution(o);
        }

        if(o instanceof JobResult){
            return this.removeJobResult();
        }

        return Promise.reject("Object not removable: "+o);
    }


    reviveJobInstance(dto) {
        return dto;
    }

    reviveExecutionContext(dto) {
        return dto;
    }

    reviveJobExecution(dto) {
        return dto;
    }

    reviveStepExecution(dto, jobExecution) {
        return dto;
    }
}
