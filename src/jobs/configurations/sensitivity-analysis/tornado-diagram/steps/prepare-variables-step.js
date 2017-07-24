import {Utils} from "sd-utils";
import {Step} from "../../../../engine/step";
import {JOB_STATUS} from "../../../../engine/job-status";
import {ExpressionEngine} from "sd-expression-engine";
import {ComputationsUtils} from "../../../../../computations-utils";

export class PrepareVariablesStep extends Step {
    constructor(jobRepository) {
        super("prepare_variables", jobRepository);
    }

    doExecute(stepExecution) {
        var params = stepExecution.getJobParameters();
        var variables = params.value("variables");

        var variableValues = [];
        variables.forEach(v=> {
            variableValues.push(ComputationsUtils.sequence(v.min, v.max, v.length));
        });
        stepExecution.getJobExecutionContext().put("variableValues", variableValues);

        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }

}
