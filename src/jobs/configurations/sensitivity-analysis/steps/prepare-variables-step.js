import {Utils} from "sd-utils";
import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {ComputationsUtils} from "../../../../computations-utils";

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
            variableValues.push(ComputationsUtils.sequence(v.min, v.max, v.length));
        });
        variableValues = Utils.cartesianProductOf(variableValues);
        jobResult.data={
            variableValues: variableValues
        };
        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }
}
