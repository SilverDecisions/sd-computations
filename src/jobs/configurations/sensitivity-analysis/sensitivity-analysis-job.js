import {SimpleJob} from "../../engine/simple-job";
import {Step} from "../../engine/step";
import {JOB_STATUS} from "../../engine/job-status";
import {TreeValidator} from "../../../validation/tree-validator";
import {SensitivityAnalysisJobParameters} from "./sensitivity-analysis-job-parameters";
import {Utils} from "sd-utils";
import {BatchStep} from "../../engine/batch/batch-step";
import {ExpressionEngine} from "sd-expression-engine";
import {PoliciesCollector} from "../../../policies/policies-collector";

export class SensitivityAnalysisJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("sensitivity-analysis", jobRepository);
        this.addStep(new PrepareVariablesStep(jobRepository));
        this.addStep(new InitPoliciesStep(jobRepository));
        this.addStep(new CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
    }

    createJobParameters(values) {
        return new SensitivityAnalysisJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
    }

    getProgress(execution) {
        if (JOB_STATUS.COMPLETED === execution.status) {
            return 100;
        }
        if (!execution.stepExecutions.length) {
            return 0;
        }
        if (execution.stepExecutions.length == 1) {
            return JOB_STATUS.COMPLETED === execution.stepExecutions[0].status ? 1 : 0;
        }
        if (execution.stepExecutions.length == 2) {
            return JOB_STATUS.COMPLETED === execution.stepExecutions[0].status ? 2 : 1;
        }
        var lastStepExecution = execution.stepExecutions[2];
        if (JOB_STATUS.COMPLETED === lastStepExecution.status) {
            return 100;
        }

        return Math.max(2, Math.round(this.steps[2].getProgress(lastStepExecution) * 0.98));
    }
}

class PrepareVariablesStep extends Step {
    constructor(jobRepository) {
        super("prepare_variables", jobRepository);
    }

    doExecute(stepExecution) {
        var params = stepExecution.getJobParameters();
        var variables = params.value("variables");

        var variableValues = [];
        variables.forEach(v=> {
            variableValues.push(this.sequence(v.min, v.max, v.length));
        });
        variableValues = Utils.cartesianProductOf(variableValues);
        stepExecution.executionContext.put("variableValues", variableValues);
        stepExecution.getJobExecutionContext().put("variableValues", variableValues);

        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }

    sequence(min, max, length) {
        var extent = max - min;
        var step = extent / (length - 1);
        var result = [min];
        var curr = min;

        for (var i = 0; i < length - 2; i++) {
            curr += step;
            result.push(curr);
        }
        result.push(max);
        return result;
    }


}


class InitPoliciesStep extends Step {
    constructor(jobRepository) {
        super("init_policies", jobRepository);
    }

    doExecute(stepExecution) {
        var data = stepExecution.getData();
        var treeRoot = data.getRoots()[0];
        var policiesCollector = new PoliciesCollector(treeRoot);

        console.log('policies', policiesCollector.policies);
        stepExecution.executionContext.put("policies", policiesCollector.policies);
        //TODO

        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }


}

class CalculateStep extends BatchStep {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("calculate_step", jobRepository, 5);
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    init(stepExecution) {
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");
        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        var variableValues = stepExecution.executionContext.get("variableValues");
        var variableNames = params.value("variables").map(v=>v.name);
        stepExecution.executionContext.put("variableNames", variableNames)

        if(!stepExecution.jobExecution.getResult()){
            var headers = ['policy'];
            variableNames.forEach(n=>headers.push(n));
            headers.push('payoff');
            stepExecution.jobExecution.setResult({
                headers:headers,
                rows: []
            });
        }

        return variableValues.length;
    }


    readNextChunk(stepExecution, startIndex, chunkSize) {
        var variableValues = stepExecution.executionContext.get("variableValues");
        return variableValues.slice(startIndex, startIndex + chunkSize);
    }

    processItem(stepExecution, item) {
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");
        var data = stepExecution.getData();
        var treeRoot = data.getRoots()[0];
        var variableNames = stepExecution.executionContext.get("variableNames");

        this.expressionsEvaluator.evalGlobalCode(data);
        variableNames.forEach((variableName, i)=> {
            data.expressionScope[variableName] = item[i];
        });
        this.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
        var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

        if (!vr.isValid()) {
            return null
        }
        this.objectiveRulesManager.recomputeTree(treeRoot, false);
        var policies = new PoliciesCollector(treeRoot, ruleName).policies;
        var r = {
            data: data.getDTO(),
            policies: policies,
            variables: item,
            payoff: treeRoot.computedValue(ruleName, 'payoff')
        };
        // console.log(r)
        return r;




    }

    writeChunk(stepExecution, items) {
        var result = stepExecution.jobExecution.getResult();
        items.forEach(i=>{
            if(!i){
                return;
            }
            i.policies.forEach(policy=>{
                var rowCells = [policy.key];
                i.variables.forEach(v=>rowCells.push(v));
                rowCells.push(ExpressionEngine.toFloat(i.payoff));
                result.rows.push({
                    cells: rowCells,
                    data: i.data,
                    policy: policy
                });
            })
        })
    }

}
