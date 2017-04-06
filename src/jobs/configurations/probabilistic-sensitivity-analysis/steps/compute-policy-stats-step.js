import {log} from "sd-utils";
import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {ExpressionEngine} from "sd-expression-engine";

export class ComputePolicyStatsStep extends Step {
    constructor(expressionEngine, objectiveRulesManager, jobRepository) {
        super("compute_policy_stats", jobRepository);
        this.expressionEngine = expressionEngine;
        this.objectiveRulesManager = objectiveRulesManager;
    }

    doExecute(stepExecution, jobResult) {
        var params = stepExecution.getJobParameters();
        var numberOfRuns = params.value("numberOfRuns");
        var ruleName = params.value("ruleName");

        let rule = this.objectiveRulesManager.ruleByName[ruleName];


        var payoffsPerPolicy = jobResult.data.policies.map(()=>[]);

        jobResult.data.rows.forEach(row=> {
            payoffsPerPolicy[row.policyIndex].push(row.payoff)
        });

        log.debug('payoffsPerPolicy', payoffsPerPolicy, jobResult.data.rows.length, rule.maximization);

        jobResult.data.medians = payoffsPerPolicy.map(payoffs=>ExpressionEngine.median(payoffs));
        jobResult.data.standardDeviations = payoffsPerPolicy.map(payoffs=>ExpressionEngine.std(payoffs));

        if(rule.maximization) {
            jobResult.data.policyIsBestProbabilities = jobResult.data.policyToHighestPayoffCount.map(v=>ExpressionEngine.toFloat(ExpressionEngine.divide(v, numberOfRuns)));
        }else{
            jobResult.data.policyIsBestProbabilities = jobResult.data.policyToLowestPayoffCount.map(v=>ExpressionEngine.toFloat(ExpressionEngine.divide(v, numberOfRuns)));
        }

        jobResult.data.policyToHighestPayoffCount = jobResult.data.policyToHighestPayoffCount.map(v=>ExpressionEngine.toFloat(v));
        jobResult.data.policyToLowestPayoffCount = jobResult.data.policyToLowestPayoffCount.map(v=>ExpressionEngine.toFloat(v));


        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }
}
