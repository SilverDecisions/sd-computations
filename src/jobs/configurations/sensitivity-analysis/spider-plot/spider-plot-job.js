import {SimpleJob} from "../../../engine/simple-job";
import {CalculateStep} from "./steps/calculate-step";
import {SpiderPlotJobParameters} from "./spider-plot-job-parameters";

export class SpiderPlotJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("spider-plot", jobRepository);
        this.addStep(new CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
    }

    createJobParameters(values) {
        return new SpiderPlotJobParameters(values);
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
        if (execution.stepExecutions.length < 1) {
            return {
                total: 1,
                current: 0
            };
        }

        return this.steps[0].getProgress(execution.stepExecutions[0]);
    }

    jobResultToCsvRows(jobResult, jobParameters, withHeaders=true){

        let result = [];
        if(withHeaders){
            result.push(['variable_name', 'policy_no'].concat(jobResult.percentageRangeValues));
        }

        jobResult.rows.forEach((row, index) => {

            result.push(...row.payoffs.map((payoffs, policyIndex)=>[
                row.variableName,
                policyIndex+1,
                ...payoffs
            ]));

        });

        return result;
    }
}
