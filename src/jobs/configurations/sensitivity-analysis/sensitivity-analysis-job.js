import {SimpleJob} from "../../engine/simple-job";
import {SensitivityAnalysisJobParameters} from "./sensitivity-analysis-job-parameters";
import {PrepareVariablesStep} from "./steps/prepare-variables-step";
import {InitPoliciesStep} from "./steps/init-policies-step";
import {CalculateStep} from "./steps/calculate-step";
import {Policy} from "../../../policies/policy";


export class SensitivityAnalysisJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager, batchSize=5) {
        super("sensitivity-analysis", jobRepository, expressionsEvaluator, objectiveRulesManager);
        this.batchSize = 5;
        this.initSteps();
    }

    initSteps(){
        this.addStep(new PrepareVariablesStep(this.jobRepository, this.expressionsEvaluator.expressionEngine));
        this.addStep(new InitPoliciesStep(this.jobRepository));
        this.calculateStep = new CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager, this.batchSize);
        this.addStep(this.calculateStep);
    }

    createJobParameters(values) {
        return new SensitivityAnalysisJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
    }

    setBatchSize(batchSize){
        this.batchSize = batchSize;
        this.calculateStep.chunkSize = batchSize;
    }

    jobResultToCsvRows(jobResult, jobParameters, withHeaders=true){
        var result = [];
        if(withHeaders){
            var headers = ['policy_number', 'policy'];
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
