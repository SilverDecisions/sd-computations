import {ExpressionEngine} from "sd-expression-engine";
import {Utils, log} from "sd-utils";
import {ObjectiveRulesManager} from "./objective/objective-rules-manager";
import {TreeValidator} from "./validation/tree-validator";
import {OperationsManager} from "./operations/operations-manager";
import {JobsManager} from "./jobs/jobs-manager";
import {ExpressionsEvaluator} from "./expressions-evaluator";
import {JobDataInvalidException} from "./jobs/engine/exceptions/job-data-invalid-exception";
import {JobParametersInvalidException} from "./jobs/engine/exceptions/job-parameters-invalid-exception";
import {JobInstanceManager} from "./jobs/job-instance-manager";


export class ComputationsManagerConfig {

    logLevel = null;

    ruleName = null;
    worker = {
        delegateRecomputation:false,
        url: null
    };

    constructor(custom) {
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

export class ComputationsManager {
    data;
    expressionEngine;

    expressionsEvaluator;
    objectiveRulesManager;
    operationsManager;
    jobsManger;

    treeValidator;

    constructor(config, data=null) {
        this.data = data;
        this.setConfig(config);
        this.expressionEngine = new ExpressionEngine();
        this.expressionsEvaluator = new ExpressionsEvaluator(this.expressionEngine);
        this.objectiveRulesManager = new ObjectiveRulesManager(this.data, this.expressionEngine, this.config.ruleName);
        this.operationsManager = new OperationsManager(this.data, this.expressionEngine);
        this.jobsManger = new JobsManager(this.expressionsEvaluator, this.objectiveRulesManager, this.config.worker.url);
        this.treeValidator = new TreeValidator(this.expressionEngine);
    }

    setConfig(config) {
        this.config = new ComputationsManagerConfig(config);
        return this;
    }

    getCurrentRule() {
        return this.objectiveRulesManager.currentRule;
    }

    getJobByName(jobName){
        return this.jobsManger.getJobByName(jobName);
    }

    runJob(name, jobParamsValues, data, resolvePromiseAfterJobIsLaunched = true) {
        return this.jobsManger.run(name, jobParamsValues, data || this.data, resolvePromiseAfterJobIsLaunched)
    }

    runJobWithInstanceManager(name, jobParamsValues, jobInstanceManagerConfig) {
        return this.runJob(name, jobParamsValues).then(je=>{
            return new JobInstanceManager(this.jobsManger, je, jobInstanceManagerConfig);
        })

    }

    getObjectiveRules() {
        return this.objectiveRulesManager.rules;
    }

    isRuleName(ruleName) {
        return this.objectiveRulesManager.isRuleName(ruleName)
    }

    setCurrentRuleByName(ruleName) {
        this.config.ruleName = ruleName;
        return this.objectiveRulesManager.setCurrentRuleByName(ruleName)
    }

    operationsForObject(object) {
        return this.operationsManager.operationsForObject(object);
    }

    checkValidityAndRecomputeObjective(allRules, evalCode = false, evalNumeric = true) {
        return Promise.resolve().then(()=> {
            if (this.config.worker.delegateRecomputation) {
                var params = {
                    evalCode: evalCode,
                    evalNumeric: evalNumeric
                };
                if(!allRules){
                    params.ruleName = this.getCurrentRule().name;
                }
                return this.runJob("recompute", params, this.data, false).then((jobExecution)=>{
                    var d = jobExecution.getData();
                    this.data.updateFrom(d)
                })
            }
            return this._checkValidityAndRecomputeObjective(this.data, allRules, evalCode, evalNumeric);
        }).then(()=> {
            this.updateDisplayValues(this.data);
        })

    }

    _checkValidityAndRecomputeObjective(data, allRules, evalCode = false, evalNumeric = true) {
        data.validationResults = [];

        if (evalCode || evalNumeric) {
            this.expressionsEvaluator.evalExpressions(data, evalCode, evalNumeric);
        }

        data.getRoots().forEach(root=> {
            var vr = this.treeValidator.validate(data.getAllNodesInSubtree(root));
            data.validationResults.push(vr);
            if (vr.isValid()) {
                this.objectiveRulesManager.recomputeTree(root, allRules);
            }
        });
    }

    updateDisplayValues(data) {
        data.nodes.forEach(n=> {
            this.updateNodeDisplayValues(n);
        });
        data.edges.forEach(e=> {
            this.updateEdgeDisplayValues(e);
        })
    }

    updateNodeDisplayValues(node) {
        node.$DISPLAY_VALUE_NAMES.forEach(n=>node.displayValue(n, this.objectiveRulesManager.getNodeDisplayValue(node, n)));
    }

    updateEdgeDisplayValues(e) {
        e.$DISPLAY_VALUE_NAMES.forEach(n=>e.displayValue(n, this.objectiveRulesManager.getEdgeDisplayValue(e, n)));
    }
}
