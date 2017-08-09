import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";
import {JobComputationException} from "../../../../engine/exceptions/job-computation-exception";
import {BatchStep} from "../../../../engine/batch/batch-step";
import {TreeValidator} from "../../../../../validation/tree-validator";
import {Policy} from "../../../../../policies/policy";
import {PoliciesCollector} from "../../../../../policies/policies-collector";

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

        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        let variableValues = jobExecutionContext.get("variableValues");
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

        if(!jobResult.data){
            jobResult.data = {
                variableNames: variableNames,
                defaultValues: defaultValues,
                variableExtents: variableValues.map(v=>[v[0], v[v.length-1]]),
                defaultPayoff: this.toFloat(payoff)[0],
                policies: policiesCollector.policies,
                rows: []
            };
        }

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

        let extents = jobResult.data.policies.map(policy=>{
            return {
                min: Infinity,
                max: -Infinity
            }
        });

        let values = jobResult.data.policies.map(policy=>{
            return {
                min: null,
                max: null
            }
        });

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

                if(payoff < extents[policyIndex].min){
                    extents[policyIndex].min = payoff;
                    values[policyIndex].min = variableValue
                }

                if(payoff > extents[policyIndex].max){
                    extents[policyIndex].max = payoff;
                    values[policyIndex].max = variableValue
                }
            });

        });

        return {
            variableName: variableName,
            variableIndex: itemIndex,
            extents: extents.map(e=>[this.toFloat(e.min), this.toFloat(e.max)]),
            extentVariableValues: values.map(v=>[this.toFloat(v.min), this.toFloat(v.max)])
        };

    }

    writeChunk(stepExecution, items, jobResult) {
        jobResult.data.rows.push(...items);
    }

    postProcess(stepExecution, jobResult) {
        jobResult.data.rows.sort((a, b)=>(b.extents[0][1]-b.extents[0][0])-(a.extents[0][1]-a.extents[0][0]))

    }


    toFloat(v){
        return ExpressionEngine.toFloat(v);
    }
}
