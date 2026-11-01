import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";
import {CalculateStep} from "../../n-way/steps/calculate-step";
import {JobComputationException} from "../../../../engine/exceptions/job-computation-exception";
import {ComputationsUtils} from "../../../../../computations-utils";

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
            jobResult.data.expectedValues = Utils.fill(new Array(jobResult.data.policies.length), 0);
            jobResult.data.policyToHighestPayoffCount = Utils.fill(new Array(jobResult.data.policies.length), 0);
            jobResult.data.policyToLowestPayoffCount = Utils.fill(new Array(jobResult.data.policies.length), 0);
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
            var errors = [];
            variables.forEach(v=> {
                try{
                    var evaluated = this.expressionsEvaluator.expressionEngine.eval(v.formula, true, Utils.cloneDeep(data.expressionScope));
                    singleRunVariableValues.push(ExpressionEngine.toFloat(evaluated));
                }catch(e){
                    errors.push({
                        variable: v,
                        error: e
                    });
                }

            });
            if(errors.length) {
                var errorData = {variables: []};
                errors.forEach(e=>{
                    errorData.variables[e.variable.name] = e.error.message;
                });
                throw new JobComputationException("param-computation", errorData)
            }
            variableValues.push(singleRunVariableValues)
        }

        return variableValues;
    }

    processItem(stepExecution, item, currentItemCount, jobResult) {
        var r = super.processItem(stepExecution, item, jobResult);

        var params = stepExecution.getJobParameters();
        var numberOfRuns = params.value("numberOfRuns");
        var policies = stepExecution.getJobExecutionContext().get("policies");

        this.updatePolicyStats(r, policies, numberOfRuns, jobResult);

        return r;
    }

    updatePolicyStats(r, policies, numberOfRuns, jobResult){
        var highestPayoff = -Infinity;
        var lowestPayoff = Infinity;
        var bestPolicyIndexes = [];
        var worstPolicyIndexes = [];

        var zeroNum = ExpressionEngine.toNumber(0);

        policies.forEach((policy,i)=>{
            let payoff = r.payoffs[i];
            if(Utils.isString(payoff)){
                payoff = zeroNum;
            }
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
        });

        bestPolicyIndexes.forEach(policyIndex=>{
            jobResult.data.policyToHighestPayoffCount[policyIndex] = ExpressionEngine.add(jobResult.data.policyToHighestPayoffCount[policyIndex], ExpressionEngine.divide(1, bestPolicyIndexes.length))
        });

        worstPolicyIndexes.forEach(policyIndex=>{
            jobResult.data.policyToLowestPayoffCount[policyIndex] = ExpressionEngine.add(jobResult.data.policyToLowestPayoffCount[policyIndex], ExpressionEngine.divide(1, worstPolicyIndexes.length))
        });
    }


    // The expected value of a policy is the mean of its payoffs over the runs,
    // computed from the payoffs of the rows (the JS numbers of the computed
    // payoffs, each within half an ulp): their exact sum, correctly rounded (at a
    // scale where it cannot overflow), divided by the number of runs. The error is at
    // most 2^-53 of the mean absolute payoff plus one rounding of the result,
    // whatever the number of runs and their order. (Accumulating
    // add(expectedValue, divide(payoff, numberOfRuns)) with exact Fractions grows
    // without limit: thousands of digits after 1000 runs.)
    postProcess(stepExecution, jobResult) {
        var numberOfRuns = stepExecution.getJobParameters().value("numberOfRuns");
        var payoffsPerPolicy = jobResult.data.policies.map(()=>[]);
        jobResult.data.rows.forEach(row=> {
            payoffsPerPolicy[row.policyIndex].push(Utils.isString(row.payoff) ? 0 : row.payoff);
        });
        jobResult.data.expectedValues = payoffsPerPolicy.map(payoffs=>ComputationsUtils.exactMean(payoffs, numberOfRuns));
    }


    toFloat(v) {
        return ExpressionEngine.toFloat(v);
    }
}
