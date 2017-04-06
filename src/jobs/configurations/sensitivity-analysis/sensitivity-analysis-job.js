import {SimpleJob} from "../../engine/simple-job";
import {SensitivityAnalysisJobParameters} from "./sensitivity-analysis-job-parameters";
import {PrepareVariablesStep} from "./steps/prepare-variables-step";
import {InitPoliciesStep} from "./steps/init-policies-step";
import {CalculateStep} from "./steps/calculate-step";
import {Policy} from "../../../policies/policy";


export class SensitivityAnalysisJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("sensitivity-analysis", jobRepository, expressionsEvaluator, objectiveRulesManager);
    }

    initSteps(){
        this.addStep(new PrepareVariablesStep(this.jobRepository, this.expressionsEvaluator.expressionEngine));
        this.addStep(new InitPoliciesStep(this.jobRepository));
        this.addStep(new CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
    }

    createJobParameters(values) {
        return new SensitivityAnalysisJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
    }

    jobResultToCsvRows(jobResult, jobParameters, withHeaders=true){
        var result = [];
        if(withHeaders){
            var headers = ['policy number', 'policy'];
            jobResult.variableNames.forEach(n=>headers.push(n));
            headers.push('payoff');
            result.push(headers);
        }


        jobResult.rows.forEach(row => {
            var policy = jobResult.policies[row.policyIndex];
            var rowCells = [row.policyIndex+1, Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription)];
            row.variables.forEach(v=> rowCells.push(v));
            rowCells.push(row.payoff);
            result.push(rowCells);
        });

        return result;
    }

    /*Should return progress object with fields:
     * current
     * total */
    getProgress(execution){

        if (execution.stepExecutions.length <= 2) {
            return {
                total: 1,
                current: 0
            };
        }

        return this.steps[2].getProgress(execution.stepExecutions[2]);
    }
}
