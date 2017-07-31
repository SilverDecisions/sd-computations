import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";
import {JobComputationException} from "../../../../engine/exceptions/job-computation-exception";
import {BatchStep} from "../../../../engine/batch/batch-step";
import {TreeValidator} from "../../../../../validation/tree-validator";
import {Policy} from "../../../../../policies/policy";
import {PoliciesCollector} from "../../../../../policies/policies-collector";
import {ComputationsUtils} from "../../../../../computations-utils";

export class CalculateStep extends BatchStep {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("calculate_step", jobRepository, 1);
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    init(stepExecution, jobResult) {
        let jobExecutionContext = stepExecution.getJobExecutionContext();
        let params = stepExecution.getJobParameters();
        let ruleName = params.value("ruleName");
        let percentageChangeRange = params.value("percentageChangeRange");
        let length = params.value("length");
        let variables = params.value("variables");

        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        let variableNames = params.value("variables").map(v=>v.name);
        stepExecution.executionContext.put("variableNames", variableNames);
        let data = stepExecution.getData();

        let treeRoot = data.getRoots()[0];
        let payoff = treeRoot.computedValue(ruleName, 'payoff');

        this.expressionsEvaluator.clear(data);
        this.expressionsEvaluator.evalExpressions(data);

        this.objectiveRulesManager.recomputeTree(treeRoot, false);

        let policiesCollector = new PoliciesCollector(treeRoot, ruleName);

        let defaultValues = {};
        Utils.forOwn(data.expressionScope, (v,k)=>{
            defaultValues[k]=this.toFloat(v);
        });


        let percentageRangeValues = ComputationsUtils.sequence(-percentageChangeRange, percentageChangeRange, length);

        let variableValues = [];

        variables.forEach(v=> {
            let defVal = defaultValues[v.name];
            variableValues.push(percentageRangeValues.map(p=> this.toFloat(ExpressionEngine.add(defVal, ExpressionEngine.multiply(ExpressionEngine.divide(p,100), defVal)))));
        });


        if(!jobResult.data){
            jobResult.data = {
                variableNames: variableNames,
                defaultValues: defaultValues,
                percentageRangeValues: percentageRangeValues,
                defaultPayoff: this.toFloat(payoff)[0],
                policies: policiesCollector.policies,
                rows: []
            };
        }

        stepExecution.getJobExecutionContext().put("variableValues", variableValues);
        return variableValues.length;
    }


    readNextChunk(stepExecution, startIndex, chunkSize) {
        let variableValues = stepExecution.getJobExecutionContext().get("variableValues");
        return variableValues.slice(startIndex, startIndex + chunkSize);
    }

    processItem(stepExecution, item, itemIndex, jobResult) {
        let params = stepExecution.getJobParameters();
        let ruleName = params.value("ruleName");
        let failOnInvalidTree = params.value("failOnInvalidTree");
        let data = stepExecution.getData();
        let treeRoot = data.getRoots()[0];
        let variableNames = stepExecution.executionContext.get("variableNames");
        let variableName = variableNames[itemIndex];


        let payoffs = jobResult.data.policies.map(policy=>[]);

        this.expressionsEvaluator.clear(data);
        this.expressionsEvaluator.evalGlobalCode(data);


        item.forEach(variableValue=>{

            data.expressionScope[variableName] = variableValue;

            this.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
            let vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));
            let valid = vr.isValid();

            if(!valid && failOnInvalidTree){
                let errorData = {
                    variables: {}
                };
                errorData.variables[variableName] = variableValue;

                throw new JobComputationException("computations", errorData)
            }

            jobResult.data.policies.forEach((policy, policyIndex)=>{
                this.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                let payoff = treeRoot.computedValue(ruleName, 'payoff')[0];
                payoffs[policyIndex].push(this.toFloat(payoff));
            });

        });

        return {
            variableName: variableName,
            variableIndex: itemIndex,
            variableValues: item,
            payoffs: payoffs
        };

    }

    writeChunk(stepExecution, items, jobResult) {
        jobResult.data.rows.push(...items);
    }


    toFloat(v){
        return ExpressionEngine.toFloat(v);
    }
}
