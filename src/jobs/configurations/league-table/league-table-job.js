import {SimpleJob} from "../../engine/simple-job";
import {Policy} from "../../../policies/policy";
import {ExpressionEngine} from "sd-expression-engine";
import {CalculateStep} from "./steps/calculate-step";
import {LeagueTableJobParameters} from "./league-table-job-parameters";


export class LeagueTableJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("league-table", jobRepository, expressionsEvaluator, objectiveRulesManager);
        this.initSteps();
    }

    initSteps() {
        this.calculateStep = new CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
        this.addStep(this.calculateStep);
    }

    createJobParameters(values) {
        return new LeagueTableJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
    }

    jobResultToCsvRows(jobResult, jobParameters, withHeaders = true) {
        var result = [];
        if (withHeaders) {
            var headers = ['policy_id', 'policy', jobResult.payoffNames[0], jobResult.payoffNames[1], 'dominated_by', 'extended-dominated_by', 'incratio'];
            result.push(headers);
        }

        jobResult.rows.forEach(row => {
            row.policies.forEach(policy=> {
                var rowCells = [
                    row.id,
                    Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription),
                    row.payoffs[1],
                    row.payoffs[0],
                    row.dominatedBy,
                    row.extendedDominatedBy === null ? null : row.extendedDominatedBy[0] + ', ' + row.extendedDominatedBy[1],
                    row.incratio
                ];
                result.push(rowCells);
            })
        });

        return result;
    }
}
