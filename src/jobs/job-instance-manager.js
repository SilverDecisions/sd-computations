import {JobExecutionListener} from "./engine/job-execution-listener";
import {JOB_STATUS} from "./engine/job-status";
import {JobInstance} from "./engine/job-instance";
import {Utils, log} from "sd-utils";


export class JobInstanceManagerConfig {
    onJobStarted = () => {};
    onJobCompleted = result => {};
    onJobFailed = errors => {};
    onJobStopped = () => {};
    onJobTerminated = () => {};
    onProgress = (progress) => {};
    callbacksThisArg;
    updateInterval = 100;

    constructor(custom) {
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

/*convenience class for managing and tracking job instance progress*/
export class JobInstanceManager extends JobExecutionListener {

    jobsManger;
    jobInstance;
    config;

    lastJobExecution;
    lastUpdateTime;
    progress = null;

    constructor(jobsManger, jobInstanceOrExecution, config) {
        super();
        this.config = new JobInstanceManagerConfig(config);
        this.jobsManger = jobsManger;
        if (jobInstanceOrExecution instanceof JobInstance) {
            this.jobInstance = jobInstanceOrExecution;
            this.getLastJobExecution().then(je=> {
                this.checkProgress();
            })
        } else {
            this.lastJobExecution = jobInstanceOrExecution;
            this.jobInstance = this.lastJobExecution.jobInstance;
            this.checkProgress();
        }
        if (this.lastJobExecution && !this.lastJobExecution.isRunning()) {
            this.afterJob(this.lastJobExecution);
            return;
        }
        jobsManger.registerJobExecutionListener(this);
    }

    checkProgress() {

        var self = this;
        if (this.terminated || !this.lastJobExecution.isRunning() || this.getProgressPercents(this.progress) === 100) {
            return;
        }
        this.jobsManger.getProgress(this.lastJobExecution).then(progress=> {
            this.lastUpdateTime = new Date();
            if (progress) {
                this.progress = progress;
                this.config.onProgress.call(this.config.callbacksThisArg || this, progress);
            }

            setTimeout(function () {
                self.checkProgress();
            }, this.config.updateInterval)
        })
    }

    beforeJob(jobExecution) {
        if (jobExecution.jobInstance.id !== this.jobInstance.id) {
            return;
        }

        this.lastJobExecution = jobExecution;
        this.config.onJobStarted.call(this.config.callbacksThisArg || this);
    }

    getProgressPercents(progress) {
        if (!progress) {
            return 0;
        }
        return progress.current * 100 / progress.total;
    }

    getProgressFromExecution(jobExecution) {
        var job = this.jobsManger.getJobByName(jobExecution.jobInstance.jobName);
        return job.getProgress(jobExecution);
    }

    afterJob(jobExecution) {
        if (jobExecution.jobInstance.id !== this.jobInstance.id) {
            return;
        }
        this.lastJobExecution = jobExecution;
        if (JOB_STATUS.COMPLETED === jobExecution.status) {
            this.jobsManger.deregisterJobExecutionListener(this);
            this.progress = this.getProgressFromExecution(jobExecution);
            this.config.onProgress.call(this.config.callbacksThisArg || this, this.progress);
            this.jobsManger.getResult(jobExecution.jobInstance).then(result=> {
                this.config.onJobCompleted.call(this.config.callbacksThisArg || this, result.data);
            }).catch(e=> {
                log.error(e);
            })


        } else if (JOB_STATUS.FAILED === jobExecution.status) {
            this.config.onJobFailed.call(this.config.callbacksThisArg || this, jobExecution.failureExceptions);

        } else if (JOB_STATUS.STOPPED === jobExecution.status) {
            this.config.onJobStopped.call(this.config.callbacksThisArg || this);
        }
    }

    getLastJobExecution(forceUpdate = false) {
        if (!this.lastJobExecution || forceUpdate) {
            return this.jobsManger.jobRepository.getLastJobExecutionByInstance(this.jobInstance).then(je=> {
                this.lastJobExecution = je;
                return je;
            });
        }
        return Promise.resolve(this.lastJobExecution);
    }

    stop() {
        return this.getLastJobExecution().then(()=> {
            return this.jobsManger.stop(this.lastJobExecution)
        })
    }

    resume() {
        return this.getLastJobExecution().then(()=> {
            return this.jobsManger.run(this.jobInstance.jobName, this.lastJobExecution.jobParameters.values, this.lastJobExecution.getData()).then(je=> {
                this.lastJobExecution = je;
                this.checkProgress();
            }).catch(e=> {
                log.error(e);
            })
        })
    }

    terminate() {
        return this.getLastJobExecution().then(()=> {
            return this.jobsManger.terminate(this.jobInstance).then(()=> {
                this.terminated = true;
                this.config.onJobTerminated.call(this.config.callbacksThisArg || this, this.lastJobExecution);
                this.jobsManger.deregisterJobExecutionListener(this);

                return this.lastJobExecution;
            })
        }).catch(e=> {
            log.error(e);
        })
    }

}
