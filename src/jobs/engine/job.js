import {log} from 'sd-utils'
import {JOB_STATUS} from "./job-status";
import {JobInterruptedException} from "./exceptions/job-interrupted-exception";
import {JobParametersInvalidException} from "./exceptions/job-parameters-invalid-exception";
import {JobDataInvalidException} from "./exceptions/job-data-invalid-exception";
import {JOB_EXECUTION_FLAG} from "./job-execution-flag";
import {JobResult} from "./job-result";
/*Base class for jobs*/
//A Job is an entity that encapsulates an entire job process ( an abstraction representing the configuration of a job).

export class Job {

    id;
    name;
    steps = [];

    isRestartable=true;
    executionListeners = [];
    jobParametersValidator;

    jobRepository;

    constructor(name, jobRepository) {
        this.name = name;
        this.jobParametersValidator = this.getJobParametersValidator();
        this.jobDataValidator = this.getJobDataValidator();
        this.jobRepository = jobRepository;
    }

    setJobRepository(jobRepository) {
        this.jobRepository = jobRepository;
    }

    execute(execution) {
        log.debug("Job execution starting: ", execution);
        var jobResult;
        return this.checkExecutionFlags(execution).then(execution=>{

            if (execution.status === JOB_STATUS.STOPPING) {
                // The job was already stopped
                execution.status = JOB_STATUS.STOPPED;
                execution.exitStatus = JOB_STATUS.COMPLETED;
                log.debug("Job execution was stopped: " + execution);
                return execution;
            }

            if (this.jobParametersValidator && !this.jobParametersValidator.validate(execution.jobParameters)) {
                throw new JobParametersInvalidException("Invalid job parameters in job execute")
            }

            if(this.jobDataValidator && !this.jobDataValidator.validate(execution.getData())){
                throw new JobDataInvalidException("Invalid job data in job execute")
            }


            execution.startTime = new Date();
            return Promise.all([this.updateStatus(execution, JOB_STATUS.STARTED), this.getResult(execution), this.updateProgress(execution)]).then(res=>{
                execution=res[0];
                jobResult = res[1];
                if(!jobResult) {
                    jobResult = new JobResult(execution.jobInstance)
                }
                this.executionListeners.forEach(listener=>listener.beforeJob(execution));

                return this.doExecute(execution, jobResult);
            });

        }).then(execution=>{
            log.debug("Job execution complete: ",execution);
            return execution
        }).catch(e=>{
            if (e instanceof JobInterruptedException) {
                log.info("Encountered interruption executing job", e);
                execution.status = JOB_STATUS.STOPPED;
                execution.exitStatus = JOB_STATUS.STOPPED;
            } else {
                log.error("Encountered fatal error executing job", e);
                execution.status = JOB_STATUS.FAILED;
                execution.exitStatus = JOB_STATUS.FAILED;
            }
            execution.failureExceptions.push(e);
            return execution;
        }).then(execution=>{
            if(jobResult){
                return this.jobRepository.saveJobResult(jobResult).then(()=>execution)
            }
            return execution
        }).catch(e=>{
            log.error("Encountered fatal error saving job results", e);
            if(e){
                execution.failureExceptions.push(e);
            }
            execution.status = JOB_STATUS.FAILED;
            execution.exitStatus = JOB_STATUS.FAILED;
            return execution;
        }).then(execution=>{
            execution.endTime = new Date();
            return Promise.all([this.jobRepository.update(execution), this.updateProgress(execution)]).then(res=>res[0])
        }).then(execution=>{
            try {
                this.executionListeners.forEach(listener=>listener.afterJob(execution));
            } catch (e) {
                log.error("Exception encountered in afterStep callback", e);
            }
            return execution;
        })
    }


    updateStatus(jobExecution, status) {
        jobExecution.status=status;
        return this.jobRepository.update(jobExecution)
    }

    updateProgress(jobExecution){
        return this.jobRepository.updateJobExecutionProgress(jobExecution.id, this.getProgress(jobExecution));
    }

    /* Extension point for subclasses allowing them to concentrate on processing logic and ignore listeners, returns promise*/
    doExecute(execution, jobResult) {
        throw 'doExecute function not implemented for job: ' + this.name
    }

    getJobParametersValidator() {
        return {
            validate: (params) => params.validate()
        }
    }

    getJobDataValidator() {
        return {
            validate: (data) => true
        }
    }

    addStep(step){
        this.steps.push(step);
    }


    createJobParameters(values){
        throw 'createJobParameters function not implemented for job: ' + this.name
    }

    /*Should return progress object with fields:
    * current
    * total */
    getProgress(execution){
        return {
            total: 1,
            current: execution.status === JOB_STATUS.COMPLETED ? 1 : 0
        }
    }

    registerExecutionListener(listener){
        this.executionListeners.push(listener);
    }

    checkExecutionFlags(execution){
        return this.jobRepository.getJobExecutionFlag(execution.id).then(flag=>{
            if(JOB_EXECUTION_FLAG.STOP === flag){
                execution.stop();
            }
            return execution
        })
    }

    getResult(execution) {
        return this.jobRepository.getJobResultByInstance(execution.jobInstance);
    }
}
