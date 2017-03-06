import {JOB_STATUS} from "./job-status";
import {log} from 'sd-utils'

import {JobInterruptedException} from "./exceptions/job-interrupted-exception";
/*domain object representing the configuration of a job step*/
export class Step {

    id;
    name;
    isRestartable = true;
    steps = [];
    executionListeners = [];

    jobRepository;

    constructor(name, jobRepository) {
        this.name = name;
        this.jobRepository = jobRepository;
    }

    setJobRepository(jobRepository) {
        this.jobRepository = jobRepository;
    }

    /*Process the step and assign progress and status meta information to the StepExecution provided*/
    execute(stepExecution) {
        log.debug("Executing step: name=" + this.name);
        stepExecution.startTime = new Date();
        stepExecution.status = JOB_STATUS.STARTED;
        var exitStatus;
        return this.jobRepository.update(stepExecution).then(stepExecution=>{
            exitStatus = JOB_STATUS.EXECUTING;

            this.executionListeners.forEach(listener=>listener.beforeStep(stepExecution));
            this.open(stepExecution.executionContext);

            return this.doExecute(stepExecution)
        }).then(_stepExecution=>{
            stepExecution = _stepExecution;
            exitStatus = stepExecution.exitStatus;

            // Check if someone is trying to stop us
            if (stepExecution.terminateOnly) {
                throw new JobInterruptedException("JobExecution interrupted.");
            }
            // Need to upgrade here not set, in case the execution was stopped
            stepExecution.status = JOB_STATUS.COMPLETED;
            log.debug("Step execution success: name=" + this.name);
            return stepExecution
        }).catch(e=>{
            stepExecution.status = this.determineJobStatus(e);
            exitStatus = stepExecution.status;
            stepExecution.failureExceptions.push(e);

            if (stepExecution.status == JOB_STATUS.STOPPED) {
                log.info("Encountered interruption executing step: " + this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
            }
            else {
                log.error("Encountered an error executing step: " + this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
            }
            return stepExecution;
        }).then(stepExecution=>{
            try {
                stepExecution.exitStatus = exitStatus;
                this.executionListeners.forEach(listener=>listener.afterStep(stepExecution));
            }
            catch (e) {
                log.error("Exception in afterStep callback in step " + this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
            }

            stepExecution.endTime = new Date();
            stepExecution.exitStatus = exitStatus;


            return this.jobRepository.update(stepExecution)
        }).then(stepExecution=>{
            try {
                this.close(stepExecution.executionContext);
            }
            catch (e) {
                log.error("Exception while closing step execution resources in step: " + this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                stepExecution.failureExceptions.push(e);
            }

            try {
                this.close(stepExecution.executionContext);
            }
            catch (e) {
                log.error("Exception while closing step execution resources in step: " + this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                stepExecution.failureExceptions.push(e);
            }

            // doExecutionRelease();

            log.debug("Step execution complete: " + stepExecution.id);
            return stepExecution;
        });

    }

    determineJobStatus(e) {
        if (e instanceof JobInterruptedException) {
            return JOB_STATUS.STOPPED;
        }
        else {
            return JOB_STATUS.FAILED;
        }
    }

    /**
     * Extension point for subclasses to execute business logic. Subclasses should set the exitStatus on the
     * StepExecution before returning. Must return stepExecution
     */
    doExecute(stepExecution) {
    }

    /**
     * Extension point for subclasses to provide callbacks to their collaborators at the beginning of a step, to open or
     * acquire resources. Does nothing by default.
     */
    open(executionContext) {
    }

    /**
     * Extension point for subclasses to provide callbacks to their collaborators at the end of a step (right at the end
     * of the finally block), to close or release resources. Does nothing by default.
     */
    close(executionContext) {
    }

    /*Should return progress in percents (integer)*/
    getProgress(stepExecution){
        return stepExecution.status === JOB_STATUS.COMPLETED ? 100 : 0;
    }
}
