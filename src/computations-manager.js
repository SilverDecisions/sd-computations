import {ExpressionEngine} from "sd-expression-engine";
import {Utils} from "sd-utils";
import {ObjectiveRulesManager} from "./objective/objective-rules-manager";
import {TreeValidator} from "./validation/tree-validator";
import {OperationsManager} from "./operations/operations-manager";
import {JobsManager} from "./jobs/jobs-manager";
import {ExpressionsEvaluator} from "./expressions-evaluator";
import {JobInstanceManager} from "./jobs/job-instance-manager";
import {domain as model} from "sd-model";
import {Policy} from "./policies/policy";
import {McdmWeightValueValidator} from "./validation/mcdm-weight-value-validator";

/** Computation manager configuration object
 * @param custom configuration object to extend
 */
export class ComputationsManagerConfig {

    /**
     * logging level
     * */
    logLevel = null;

    /**
     * default objective rule name
     * */
    ruleName = null;

    /**
     * worker configuration object
     * */
    worker = {
        /**
         * delegate tree recomputation to worker
         * */
        delegateRecomputation: false,

        /**
         * worker url
         * */
        url: null
    };

    /**
     * job repository to use, available types: idb, timeout, simple
    * */
    jobRepositoryType = 'idb';

    /**
     * clear repository after init
     * */
    clearRepository = false;

    constructor(custom) {
        if (custom) {
            Utils.deepExtend(this, custom);
        }
    }
}

/** Computation manager
* @param {object} config
* @param {DataModel} data model object
* */
export class ComputationsManager {

    data;
    expressionEngine;
    expressionsEvaluator;
    objectiveRulesManager;
    operationsManager;
    jobsManger;

    treeValidator;

    constructor(config, data = null) {
        this.data = data;
        this.setConfig(config);
        this.expressionEngine = new ExpressionEngine();
        this.expressionsEvaluator = new ExpressionsEvaluator(this.expressionEngine);
        this.objectiveRulesManager = new ObjectiveRulesManager(this.expressionEngine, this.config.ruleName);
        this.operationsManager = new OperationsManager(this.data, this.expressionEngine);
        this.jobsManger = new JobsManager(this.expressionsEvaluator, this.objectiveRulesManager, {
            workerUrl: this.config.worker.url,
            repositoryType: this.config.jobRepositoryType,
            clearRepository: this.config.clearRepository
        });
        this.treeValidator = new TreeValidator(this.expressionEngine);
        this.mcdmWeightValueValidator = new McdmWeightValueValidator();
    }

    setConfig(config) {
        this.config = new ComputationsManagerConfig(config);
        return this;
    }


    /** Alias function for checkValidityAndRecomputeObjective*/
    recompute(){
        return this.checkValidityAndRecomputeObjective(...arguments);
    }

    /**
     * Checks validity of data model and recomputes objective rules
     * @returns promise
     * @param {boolean} allRules - recompute all objective rules
     * @param {boolean} evalCode - evaluate code
     * @param {boolean} evalNumeric - evaluate numeric expressions
     */
    checkValidityAndRecomputeObjective(allRules, evalCode = false, evalNumeric = true) {
        return Promise.resolve().then(()=> {
            if (this.config.worker.delegateRecomputation) {
                var params = {
                    evalCode: evalCode,
                    evalNumeric: evalNumeric
                };
                if (!allRules) {
                    params.ruleName = this.getCurrentRule().name;
                }
                return this.runJob("recompute", params, this.data, false).then((jobExecution)=> {
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

        this.objectiveRulesManager.updateDefaultCriterion1Weight(data.defaultCriterion1Weight);
        data.validationResults = [];

        if (evalCode || evalNumeric) {
            this.expressionsEvaluator.evalExpressions(data, evalCode, evalNumeric);
        }

        var weightValid = this.mcdmWeightValueValidator.validate(data.defaultCriterion1Weight);
        var multiCriteria = this.getCurrentRule().multiCriteria;


        data.getRoots().forEach(root=> {
            var vr = this.treeValidator.validate(data.getAllNodesInSubtree(root));
            data.validationResults.push(vr);
            if (vr.isValid() && (!multiCriteria || weightValid)) {
                this.objectiveRulesManager.recomputeTree(root, allRules);
            }
        });
    }

    /**
     * @returns {ObjectiveRule} current objective rule
     * */
    getCurrentRule() {
        return this.objectiveRulesManager.currentRule;
    }

    /**
     * Sets current objective rule
     * @param {string} ruleName - name of objective rule
     * */
    setCurrentRuleByName(ruleName) {
        this.config.ruleName = ruleName;
        return this.objectiveRulesManager.setCurrentRuleByName(ruleName)
    }

    /**
     *
     *  @param {string} jobName
     *  @returns {Job}
     * */
    getJobByName(jobName) {
        return this.jobsManger.getJobByName(jobName);
    }

    /**
     * @returns array of operations applicable to the given object (node or edge)
     * @param object
     */
    operationsForObject(object) {
        return this.operationsManager.operationsForObject(object);
    }


    /**
     * Checks validity of data model without recomputation and revalidation
     * @param {DataModel} data to check
     */

    isValid(data) {
        var data = data || this.data;
        return data.validationResults.every(vr=>vr.isValid());
    }
    /**
     * Run job
     * @param {string} name - job name
     * @param {object} jobParamsValues - job parameter values object
     * @param {DataModel} data model
     * @param {boolean} resolvePromiseAfterJobIsLaunched - immediately resolve promise with still running JobExecution
     * @returns {Promise} resolving to JobExecution
     */
    runJob(name, jobParamsValues, data, resolvePromiseAfterJobIsLaunched = true) {
        return this.jobsManger.run(name, jobParamsValues, data || this.data, resolvePromiseAfterJobIsLaunched)
    }

    /**
     * Run job using JobInstanceManager
     * @param {string} name - job name
     * @param {object} jobParamsValues - job parameter values object
     * @param {JobInstanceManagerConfig} jobInstanceManagerConfig - JobInstanceManager configuration
     * @returns {Promise} resolving to JobInstanceManager
     */
    runJobWithInstanceManager(name, jobParamsValues, jobInstanceManagerConfig) {
        return this.runJob(name, jobParamsValues).then(je=> {
            return new JobInstanceManager(this.jobsManger, je, jobInstanceManagerConfig);
        })
    }

    getObjectiveRules() {
        return this.objectiveRulesManager.rules;
    }

    getObjectiveRuleByName(ruleName){
        return this.objectiveRulesManager.getObjectiveRuleByName(ruleName)
    }

    isRuleName(ruleName) {
        return this.objectiveRulesManager.isRuleName(ruleName)
    }


    flipCriteria(data){
        data = data || this.data;
        data.reversePayoffs();
        let tmp = data.weightLowerBound;
        data.weightLowerBound = this.flip(data.weightUpperBound);
        data.weightUpperBound = this.flip(tmp);
        data.defaultCriterion1Weight = this.flip(data.defaultCriterion1Weight);
        this.objectiveRulesManager.flipRule();
        return this.checkValidityAndRecomputeObjective(false);
    }

    flip(a){
        if(a == Infinity){
            return 0;
        }

        if(a == 0){
            return Infinity;
        }

        return this.expressionEngine.serialize(ExpressionEngine.divide(1, a))
    }

    updateDisplayValues(data, policyToDisplay = null) {
        data = data || this.data;
        if (policyToDisplay) {
            return this.displayPolicy(data, policyToDisplay);
        }

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

    displayPolicy(policyToDisplay, data) {


        data = data || this.data;
        data.nodes.forEach(n=> {
            n.clearDisplayValues();
        });
        data.edges.forEach(e=> {
            e.clearDisplayValues();
        });
        data.getRoots().forEach((root)=>this.displayPolicyForNode(root, policyToDisplay));
    }

    displayPolicyForNode(node, policy) {
        if (node instanceof model.DecisionNode) {
            var decision = Policy.getDecision(policy, node);
            //console.log(decision, node, policy);
            if (decision) {
                node.displayValue('optimal', true)
                var childEdge = node.childEdges[decision.decisionValue];
                childEdge.displayValue('optimal', true)
                return this.displayPolicyForNode(childEdge.childNode, policy)
            }
            return;
        } else if(node instanceof model.ChanceNode){
            node.displayValue('optimal', true);
            node.childEdges.forEach(e=>{
                e.displayValue('optimal', true);
                this.displayPolicyForNode(e.childNode, policy)
            })
        }else if(node instanceof model.TerminalNode){
            node.displayValue('optimal', true);
        }


    }
}
