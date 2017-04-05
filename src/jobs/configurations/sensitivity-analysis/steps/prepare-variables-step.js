import {Utils} from "sd-utils";
import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {ExpressionEngine} from "sd-expression-engine";

export class PrepareVariablesStep extends Step {
    constructor(jobRepository, expressionEngine) {
        super("prepare_variables", jobRepository);
        this.expressionEngine = expressionEngine;
    }

    doExecute(stepExecution, jobResult) {
        var params = stepExecution.getJobParameters();
        var variables = params.value("variables");

        var variableValues = [];
        variables.forEach(v=> {
            variableValues.push(this.sequence(v.min, v.max, v.length));
        });
        variableValues = Utils.cartesianProductOf(variableValues);
        jobResult.data={
            variableValues: variableValues
        };
        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }

    sequence(min, max, length) {
        var extent = ExpressionEngine.subtract(max, min);
        var step = ExpressionEngine.divide(extent,length - 1);
        var result = [min];
        var curr = min;

        for (var i = 0; i < length - 2; i++) {
            curr = ExpressionEngine.add(curr, step);
            result.push(ExpressionEngine.toFloat(curr));
        }
        result.push(max);
        return result;
    }
}
