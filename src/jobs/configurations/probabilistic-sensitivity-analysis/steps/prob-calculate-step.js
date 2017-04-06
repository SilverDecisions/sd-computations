import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";
import {BatchStep} from "../../../engine/batch/batch-step";
import {TreeValidator} from "../../../../validation/tree-validator";
import {Policy} from "../../../../policies/policy";
import {CalculateStep} from "../../sensitivity-analysis/steps/calculate-step";

export class ProbCalculateStep extends CalculateStep {



    init(stepExecution, jobResult) {
        var jobExecutionContext = stepExecution.getJobExecutionContext();
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");

        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        var variableNames = params.value("variables").map(v=>v.name);
        stepExecution.executionContext.put("variableNames", variableNames);

        if(!jobResult.data.rows){
            jobResult.data.rows = [];
            jobResult.data.variableNames = variableNames;
            jobResult.data.expectedValues = new Array(jobResult.data.policies.length).fill(0);
            jobResult.data.policyToHighestPayoffCount = new Array(jobResult.data.policies.length).fill(0);
            jobResult.data.policyToLowestPayoffCount = new Array(jobResult.data.policies.length).fill(0);
        }

        return params.value("numberOfRuns");
    }

    readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
        var params = stepExecution.getJobParameters();
        var variables = params.value("variables");
        var data = stepExecution.getData();
        var variableValues = [];
        for(var runIndex=0; runIndex<chunkSize; runIndex++){
            var singleRunVariableValues = [];
            variables.forEach(v=> {
                var evaluated = this.expressionsEvaluator.expressionEngine.eval(v.formula, true, Utils.cloneDeep(data.expressionScope));
                singleRunVariableValues.push(ExpressionEngine.toFloat(evaluated));
            });
            variableValues.push(singleRunVariableValues)
        }

        return variableValues;
    }

    processItem(stepExecution, item, currentItemCount, jobResult) {
        var r = super.processItem(stepExecution, item, jobResult);

        var params = stepExecution.getJobParameters();
        var numberOfRuns = params.value("numberOfRuns");
        var policies = stepExecution.getJobExecutionContext().get("policies");

        this.updatePolicyStats(r, policies, numberOfRuns, jobResult)

        return r;
    }

    updatePolicyStats(r, policies, numberOfRuns, jobResult){
        var highestPayoff = -Infinity;
        var lowestPayoff = Infinity;
        var bestPolicyIndexes = [];
        var worstPolicyIndexes = [];

        policies.forEach((policy,i)=>{
            let payoff = r.payoffs[i];
            if(payoff < lowestPayoff){
                lowestPayoff = payoff;
                worstPolicyIndexes = [i];
            }else if(payoff.equals(lowestPayoff)){
                worstPolicyIndexes.push(i)
            }
            if(payoff > highestPayoff){
                highestPayoff = payoff;
                bestPolicyIndexes = [i]
            }else if(payoff.equals(highestPayoff)){
                bestPolicyIndexes.push(i)
            }

            jobResult.data.expectedValues[i] = ExpressionEngine.add(jobResult.data.expectedValues[i], ExpressionEngine.divide(payoff, numberOfRuns));
        });

        bestPolicyIndexes.forEach(policyIndex=>{
            jobResult.data.policyToHighestPayoffCount[policyIndex] = ExpressionEngine.add(jobResult.data.policyToHighestPayoffCount[policyIndex], ExpressionEngine.divide(1, bestPolicyIndexes.length))
        });

        worstPolicyIndexes.forEach(policyIndex=>{
            jobResult.data.policyToLowestPayoffCount[policyIndex] = ExpressionEngine.add(jobResult.data.policyToLowestPayoffCount[policyIndex], ExpressionEngine.divide(1, worstPolicyIndexes.length))
        });
    }


    postProcess(stepExecution, jobResult) {
        jobResult.data.expectedValues = jobResult.data.expectedValues.map(v=>this.toFloat(v));
    }


    toFloat(v) {
        return ExpressionEngine.toFloat(v);
    }
}
