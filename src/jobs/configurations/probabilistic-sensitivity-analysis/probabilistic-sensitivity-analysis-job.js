import {ProbabilisticSensitivityAnalysisJobParameters} from "./probabilistic-sensitivity-analysis-job-parameters";
import {InitPoliciesStep} from "../sensitivity-analysis/steps/init-policies-step";
import {SensitivityAnalysisJob} from "../sensitivity-analysis/sensitivity-analysis-job";
import {ProbCalculateStep} from "./steps/prob-calculate-step";
import {ComputePolicyStatsStep} from "./steps/compute-policy-stats-step";

export class ProbabilisticSensitivityAnalysisJob extends SensitivityAnalysisJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super(jobRepository, expressionsEvaluator, objectiveRulesManager);
        this.name = "probabilistic-sensitivity-analysis";
    }

    initSteps() {
        this.addStep(new InitPoliciesStep(this.jobRepository));
        this.addStep(new ProbCalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
        this.addStep(new ComputePolicyStatsStep(this.expressionsEvaluator.expressionEngine, this.objectiveRulesManager, this.jobRepository));
    }

    createJobParameters(values) {
        return new ProbabilisticSensitivityAnalysisJobParameters(values);
    }

    /*Should return progress object with fields:
     * current
     * total */
    getProgress(execution) {

        if (execution.stepExecutions.length <= 1) {
            return {
                total: 1,
                current: 0
            };
        }

        return this.steps[1].getProgress(execution.stepExecutions[1]);
    }
}
