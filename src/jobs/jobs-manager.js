import {Utils, log} from "sd-utils";
import {SensitivityAnalysisJob} from "./configurations/sensitivity-analysis/n-way/sensitivity-analysis-job";
import {JobLauncher} from "./engine/job-launcher";
import {JobWorker} from "./job-worker";
import {JobExecutionListener} from "./engine/job-execution-listener";
import {JobParameters} from "./engine/job-parameters";
import {IdbJobRepository} from "./engine/job-repository/idb-job-repository";
import {JOB_EXECUTION_FLAG} from "./engine/job-execution-flag";
import {RecomputeJob} from "./configurations/recompute/recompute-job";
import {ProbabilisticSensitivityAnalysisJob} from "./configurations/sensitivity-analysis/probabilistic/probabilistic-sensitivity-analysis-job";
import {TimeoutJobRepository} from "./engine/job-repository/timeout-job-repository";
import {TornadoDiagramJob} from "./configurations/sensitivity-analysis/tornado-diagram/tornado-diagram-job";
import {JOB_STATUS} from "./engine/job-status";
import {SimpleJobRepository} from "./engine/job-repository/simple-job-repository";
import {LeagueTableJob} from "./configurations/league-table/league-table-job";
import {SpiderPlotJob} from "./configurations/sensitivity-analysis/spider-plot/spider-plot-job";


export class JobsManagerConfig {

    workerUrl = null;
    repositoryType = 'idb';
    clearRepository = false;

    constructor(custom) {
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

export class JobsManager extends JobExecutionListener {


    useWorker;
    expressionsEvaluator;
    objectiveRulesManager;
    jobWorker;

    jobRepository;
    jobLauncher;

    jobExecutionListeners = [];

    afterJobExecutionPromiseResolves = {};
    jobInstancesToTerminate = {};

    constructor(expressionsEvaluator, objectiveRulesManager, config) {
        super();
        this.setConfig(config);
        this.expressionEngine = expressionsEvaluator.expressionEngine;
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;


        this.useWorker = !!this.config.workerUrl;
        if (this.useWorker) {
            this.initWorker(this.config.workerUrl);
        }

        this.initRepository();

        this.registerJobs();



        this.jobLauncher = new JobLauncher(this.jobRepository, this.jobWorker, (data)=>this.serializeData(data));
    }

    setConfig(config) {
        this.config = new JobsManagerConfig(config);
        return this;
    }

    initRepository() {
        switch (this.config.repositoryType){
            case 'idb':
                this.jobRepository = new IdbJobRepository(this.expressionEngine.getJsonReviver(), 'sd-job-repository', this.config.clearRepository);
                break;
            case 'timeout':
                this.jobRepository = new TimeoutJobRepository(this.expressionEngine.getJsonReviver());
                break;
            case 'simple':
                this.jobRepository = new SimpleJobRepository(this.expressionEngine.getJsonReviver());
                break;
            default:
                log.error('JobsManager configuration error! Unknown repository type: '+this.config.repositoryType+'. Using default: idb');
                this.config.repositoryType = 'idb';
                this.initRepository()
        }
    }

    serializeData(data) {
        return data.serialize(true, false, false, this.expressionEngine.getJsonReplacer());
    }

    getProgress(jobExecutionOrId) {
        var id = jobExecutionOrId;
        if (!Utils.isString(jobExecutionOrId)) {
            id = jobExecutionOrId.id
        }
        return this.jobRepository.getJobExecutionProgress(id);
    }

    getResult(jobInstance) {
        return this.jobRepository.getJobResultByInstance(jobInstance);
    }

    run(jobName, jobParametersValues, data, resolvePromiseAfterJobIsLaunched = true) {
        return this.jobLauncher.run(jobName, jobParametersValues, data, resolvePromiseAfterJobIsLaunched).then(jobExecution=> {
            if (resolvePromiseAfterJobIsLaunched || !jobExecution.isRunning()) {
                return jobExecution;
            }
            //job was delegated to worker and is still running

            return new Promise((resolve, reject)=> {
                this.afterJobExecutionPromiseResolves[jobExecution.id] = resolve;
            });
        });
    }

    execute(jobExecutionOrId) {
        return this.jobLauncher.execute(jobExecutionOrId);
    }

    stop(jobExecutionOrId) {
        var id = jobExecutionOrId;
        if (!Utils.isString(jobExecutionOrId)) {
            id = jobExecutionOrId.id
        }

        return this.jobRepository.getJobExecutionById(id).then(jobExecution=> {
            if (!jobExecution) {
                log.error("Job Execution not found: " + jobExecutionOrId);
                return null;
            }
            if (!jobExecution.isRunning()) {
                log.warn("Job Execution not running, status: " + jobExecution.status + ", endTime: " + jobExecution.endTime);
                return jobExecution;
            }

            return this.jobRepository.saveJobExecutionFlag(jobExecution.id, JOB_EXECUTION_FLAG.STOP).then(()=>jobExecution);
        });
    }

    /*stop job execution if running and delete job instance from repository*/
    terminate(jobInstance) {
        return this.jobRepository.getLastJobExecutionByInstance(jobInstance).then(jobExecution=> {
            if (jobExecution) {
                if(jobExecution.isRunning()){
                    return this.jobRepository.saveJobExecutionFlag(jobExecution.id, JOB_EXECUTION_FLAG.STOP).then(()=>jobExecution);
                }else{
                    return this.jobRepository.removeJobInstance(jobInstance, jobExecution.jobParameters);
                }
            }
        }).then(()=>{
            this.jobInstancesToTerminate[jobInstance.id]=jobInstance;
        })
    }

    getJobByName(jobName) {
        return this.jobRepository.getJobByName(jobName);
    }


    createJobParameters(jobName, jobParametersValues) {
        var job = this.jobRepository.getJobByName(jobName);
        return job.createJobParameters(jobParametersValues);
    }


    /*Returns a promise*/
    getLastJobExecution(jobName, jobParameters) {
        if (this.useWorker) {
            return this.jobWorker;
        }
        if (!(jobParameters instanceof JobParameters)) {
            jobParameters = this.createJobParameters(jobParameters)
        }
        return this.jobRepository.getLastJobExecution(jobName, jobParameters);
    }

    initWorker(workerUrl) {
        this.jobWorker = new JobWorker(workerUrl, ()=>{
            log.error('error in worker', arguments);
        });
        var argsDeserializer = (args)=> {
            return [this.jobRepository.reviveJobExecution(args[0])]
        };

        this.jobWorker.addListener("beforeJob", this.beforeJob, this, argsDeserializer);
        this.jobWorker.addListener("afterJob", this.afterJob, this, argsDeserializer);
        this.jobWorker.addListener("jobFatalError", this.onJobFatalError, this);
    }

    registerJobs() {

        let sensitivityAnalysisJob = new SensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
        let probabilisticSensitivityAnalysisJob = new ProbabilisticSensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
        if(!Utils.isWorker()){
            sensitivityAnalysisJob.setBatchSize(1);
            probabilisticSensitivityAnalysisJob.setBatchSize(1);
        }

        this.registerJob(sensitivityAnalysisJob);
        this.registerJob(new TornadoDiagramJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
        this.registerJob(probabilisticSensitivityAnalysisJob);
        this.registerJob(new RecomputeJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
        this.registerJob(new LeagueTableJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
        this.registerJob(new SpiderPlotJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
    }

    registerJob(job) {
        this.jobRepository.registerJob(job);
        job.registerExecutionListener(this)
    }

    registerJobExecutionListener(listener) {
        this.jobExecutionListeners.push(listener);
    }

    deregisterJobExecutionListener(listener) {
        var index = this.jobExecutionListeners.indexOf(listener);
        if (index > -1) {
            this.jobExecutionListeners.splice(index, 1)
        }
    }

    beforeJob(jobExecution) {
        log.debug("beforeJob", this.useWorker, jobExecution);
        this.jobExecutionListeners.forEach(l=>l.beforeJob(jobExecution));
    }

    afterJob(jobExecution) {
        log.debug("afterJob", this.useWorker, jobExecution);
        this.jobExecutionListeners.forEach(l=>l.afterJob(jobExecution));
        var promiseResolve = this.afterJobExecutionPromiseResolves[jobExecution.id];
        if (promiseResolve) {
            promiseResolve(jobExecution)
        }

        if(this.jobInstancesToTerminate[jobExecution.jobInstance.id]){
            this.jobRepository.removeJobInstance(jobExecution.jobInstance, jobExecution.jobParameters);
        }
    }

    onJobFatalError(jobExecutionId, error){
        var promiseResolve = this.afterJobExecutionPromiseResolves[jobExecutionId];
        if (promiseResolve) {
            this.jobRepository.getJobExecutionById(jobExecutionId).then(jobExecution=>{
                jobExecution.status = JOB_STATUS.FAILED;
                if(error){
                    jobExecution.failureExceptions.push(error);
                }

                return this.jobRepository.saveJobExecution(jobExecution).then(()=>{
                    promiseResolve(jobExecution);
                })
            }).catch(e=>{
                log.error(e);
            })

        }
        log.debug('onJobFatalError', jobExecutionId, error);
    }


}
