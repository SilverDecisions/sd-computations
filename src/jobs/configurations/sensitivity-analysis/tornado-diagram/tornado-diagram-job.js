import {SimpleJob} from "../../../engine/simple-job";
import {PrepareVariablesStep} from "./steps/prepare-variables-step";
import {InitPoliciesStep} from "./steps/init-policies-step";
import {CalculateStep} from "./steps/calculate-step";
import {TornadoDiagramJobParameters} from "./tornado-diagram-job-parameters";

export class TornadoDiagramJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("tornado-diagram", jobRepository);
        this.addStep(new PrepareVariablesStep(jobRepository));
        this.addStep(new InitPoliciesStep(jobRepository));
        this.addStep(new CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
    }

    createJobParameters(values) {
        return new TornadoDiagramJobParameters(values);
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
