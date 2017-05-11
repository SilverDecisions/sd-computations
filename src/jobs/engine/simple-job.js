import {log} from 'sd-utils'
import {JOB_STATUS} from "./job-status";
import {Job} from "./job";
import {Utils} from "sd-utils";
import {ExecutionContext} from "./execution-context";
import {Step} from "./step";
import {JobInterruptedException} from "./exceptions/job-interrupted-exception";
import {JobRestartException} from "./exceptions/job-restart-exception";
import {JOB_EXECUTION_FLAG} from "./job-execution-flag";

/* Simple Job that sequentially executes a job by iterating through its list of steps.  Any Step that fails will fail the job.  The job is
 considered complete when all steps have been executed.*/

export class SimpleJob extends Job {

    constructor(name, jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super(name, jobRepository, expressionsEvaluator, objectiveRulesManager)
    }

    getStep(stepName) {
        return Utils.find(this.steps, s=>s.name == stepName);
    }

    doExecute(execution, jobResult) {

        return this.handleNextStep(execution, jobResult).then(lastExecutedStepExecution=>{
            if (lastExecutedStepExecution != null) {
                log.debug("Updating JobExecution status: ", lastExecutedStepExecution);
                execution.status = lastExecutedStepExecution.status;
                execution.exitStatus = lastExecutedStepExecution.exitStatus;
                execution.failureExceptions.push(...lastExecutedStepExecution.failureExceptions)
            }
            return execution;
        });
    }

    handleNextStep(jobExecution, jobResult, prevStep=null, prevStepExecution=null){
        var stepIndex = 0;
        if(prevStep){
            stepIndex = this.steps.indexOf(prevStep)+1;
        }
        if(stepIndex>=this.steps.length){
            return Promise.resolve(prevStepExecution)
        }
        var step = this.steps[stepIndex];
        return this.handleStep(step, jobExecution, jobResult).then(stepExecution=>{
            if(stepExecution.status !== JOB_STATUS.COMPLETED){ // Terminate the job if a step fails
                return stepExecution;
            }
            return this.handleNextStep(jobExecution, jobResult, step, stepExecution);
        })
    }

    handleStep(step, jobExecution, jobResult) {
        var jobInstance = jobExecution.jobInstance;
        return this.checkExecutionFlags(jobExecution).then(jobExecution=>{
            if (jobExecution.isStopping()) {
                throw new JobInterruptedException("JobExecution interrupted.");
            }
            return this.jobRepository.getLastStepExecution(jobInstance, step.name)

        }).then(lastStepExecution=>{
            if (this.stepExecutionPartOfExistingJobExecution(jobExecution, lastStepExecution)) {
                // If the last execution of this step was in the same job, it's probably intentional so we want to run it again.
                log.info("Duplicate step detected in execution of job. step: " + step.name + " jobName: ", jobInstance.jobName);
                lastStepExecution = null;
            }

            var currentStepExecution = lastStepExecution;

            if (!this.shouldStart(currentStepExecution, jobExecution, step)) {
                return currentStepExecution;
            }

            currentStepExecution = jobExecution.createStepExecution(step.name);

            var isCompleted = lastStepExecution != null && lastStepExecution.status === JOB_STATUS.COMPLETED;
            var isRestart = lastStepExecution != null && !isCompleted;
            var skipExecution = isCompleted && step.skipOnRestartIfCompleted;

            if (isRestart) {
                currentStepExecution.executionContext = lastStepExecution.executionContext;
                if (lastStepExecution.executionContext.containsKey("executed")) {
                    currentStepExecution.executionContext.remove("executed");
                }
            }
            else {

                currentStepExecution.executionContext = new ExecutionContext();
            }
            if(skipExecution){
                currentStepExecution.exitStatus = JOB_STATUS.COMPLETED;
                currentStepExecution.status = JOB_STATUS.COMPLETED;
                currentStepExecution.executionContext.put("skipped", true);
            }

            return this.jobRepository.addStepExecution(currentStepExecution).then((_currentStepExecution)=>{
                currentStepExecution=_currentStepExecution;
                if(skipExecution){
                    log.info("Skipping completed step execution: [" + step.name + "]");
                    return currentStepExecution;
                }
                log.info("Executing step: [" + step.name + "]");
                return step.execute(currentStepExecution, jobResult)
            }).then(()=>{
                currentStepExecution.executionContext.put("executed", true);
                return currentStepExecution;
            }).catch (e => {
                jobExecution.status = JOB_STATUS.FAILED;
                return this.jobRepository.update(jobExecution).then(jobExecution=>{throw e})
            });

        }).then((currentStepExecution)=>{
            if (currentStepExecution.status == JOB_STATUS.STOPPING
                || currentStepExecution.status == JOB_STATUS.STOPPED) {
                // Ensure that the job gets the message that it is stopping
                jobExecution.status = JOB_STATUS.STOPPING;
                // throw new Error("Job interrupted by step execution");
            }
            return this.updateProgress(jobExecution).then(()=>currentStepExecution);
        })

    }

    stepExecutionPartOfExistingJobExecution(jobExecution, stepExecution) {
        return stepExecution != null && stepExecution.jobExecution.id == jobExecution.id
    }

    shouldStart(lastStepExecution, execution, step) {
        var stepStatus;
        if (lastStepExecution == null) {
            stepStatus = JOB_STATUS.STARTING;
        }
        else {
            stepStatus = lastStepExecution.status;
        }

        if (stepStatus == JOB_STATUS.UNKNOWN) {
            throw new JobRestartException("Cannot restart step from UNKNOWN status")
        }

        return stepStatus != JOB_STATUS.COMPLETED || step.isRestartable;
    }

    getProgress(execution){
        var completedSteps = execution.stepExecutions.length;
        let progress = {
            total: this.steps.length,
            current: completedSteps
        };
        if(!completedSteps){
            return progress
        }
        if(JOB_STATUS.COMPLETED !== execution.stepExecutions[execution.stepExecutions.length-1].status){
            progress.current--;
        }

        return progress;
    }

    addStep(){
        if(arguments.length===1){
            return super.addStep(arguments[0])
        }
        var step = new Step(arguments[0], this.jobRepository);
        step.doExecute = arguments[1];
        return super.addStep(step);
    }

}
