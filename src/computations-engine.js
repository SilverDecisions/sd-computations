import {Utils, log} from "sd-utils";
import {DataModel} from "sd-model";
import {ComputationsManager} from "./computations-manager";
import {ComputationsManagerConfig} from "./computations-manager";



export class ComputationsEngineConfig extends ComputationsManagerConfig{
    logLevel = 'warn';
    constructor(custom) {
        super();
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

//Entry point class for standalone computation workers
export class ComputationsEngine extends ComputationsManager{

    global = Utils.getGlobalObject();
    isWorker = Utils.isWorker();

    constructor(config, data){
        super(config, data);

        if(this.isWorker) {
            this.jobsManger.registerJobExecutionListener({
                beforeJob: (jobExecution)=>{
                    this.reply('beforeJob', jobExecution.getDTO());
                },

                afterJob: (jobExecution)=>{
                    this.reply('afterJob', jobExecution.getDTO());
                }
            });

            var instance = this;
            this.queryableFunctions = {
                runJob: function(jobName, jobParametersValues, dataDTO){
                    // console.log(jobName, jobParameters, serializedData);
                    var data = new DataModel(dataDTO);
                    instance.runJob(jobName, jobParametersValues, data);
                },
                executeJob: function(jobExecutionId){
                    instance.jobsManger.execute(jobExecutionId)
                },
                recompute: function(dataDTO, ruleName, evalCode, evalNumeric){
                    if(ruleName){
                        instance.objectiveRulesManager.setCurrentRuleByName(ruleName);
                    }
                    var allRules = !ruleName;
                    var data = new DataModel(dataDTO);
                    instance._checkValidityAndRecomputeObjective(data, allRules, evalCode, evalNumeric)
                    this.reply('recomputed', data.getDTO());
                }
            };

            global.onmessage = function(oEvent) {
                if (oEvent.data instanceof Object && oEvent.data.hasOwnProperty('queryMethod') && oEvent.data.hasOwnProperty('queryArguments')) {
                    instance.queryableFunctions[oEvent.data.queryMethod].apply(self, oEvent.data.queryArguments);
                } else {
                    instance.defaultReply(oEvent.data);
                }
            };
        }
    }



    setConfig(config) {
        super.setConfig(config);
        this.setLogLevel(this.config.logLevel);
        return this;
    }

    setLogLevel(level){
        log.setLevel(level)
    }

    defaultReply(message) {
        this.reply('test', message);
    }

    reply() {
        if (arguments.length < 1) {
            throw new TypeError('reply - not enough arguments');
        }
        this.global.postMessage({
            'queryMethodListener': arguments[0],
            'queryMethodArguments': Array.prototype.slice.call(arguments, 1)
        });
    }
}

