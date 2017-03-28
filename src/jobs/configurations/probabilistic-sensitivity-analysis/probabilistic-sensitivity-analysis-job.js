import {SimpleJob} from "../../engine/simple-job";
import {ProbabilisticSensitivityAnalysisJobParameters} from "./probabilistic-sensitivity-analysis-job-parameters";
import {PrepareVariablesStep} from "./steps/prepare-variables-step";
import {InitPoliciesStep} from "../sensitivity-analysis/steps/init-policies-step";
import {CalculateStep} from "../sensitivity-analysis/steps/calculate-step";

export class ProbabilisticSensitivityAnalysisJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("probabilistic-sensitivity-analysis", jobRepository);
        this.addStep(new PrepareVariablesStep(expressionsEvaluator.expressionEngine, jobRepository));
        this.addStep(new InitPoliciesStep(jobRepository));
        this.addStep(new CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
    }

    createJobParameters(values) {
        return new ProbabilisticSensitivityAnalysisJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
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
