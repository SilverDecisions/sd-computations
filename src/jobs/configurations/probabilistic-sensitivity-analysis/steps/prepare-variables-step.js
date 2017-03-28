import {Utils} from "sd-utils";
import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {ExpressionEngine} from "sd-expression-engine";

export class PrepareVariablesStep extends Step {
    constructor(expressionEngine, jobRepository) {
        super("prepare_variables", jobRepository);
        this.expressionEngine = expressionEngine;
    }

    doExecute(stepExecution) {
        var params = stepExecution.getJobParameters();
        var numberOfRuns = params.value("numberOfRuns");
        var variables = params.value("variables");
        var variableValues = [];
        var data = stepExecution.getData();

        for(var runIndex=0; runIndex<numberOfRuns; runIndex++){
            var singleRunVariableValues = [];
            variables.forEach(v=> {
                var evaluated = this.expressionEngine.eval(v.formula, true, Utils.cloneDeep(data.expressionScope));
                singleRunVariableValues.push(ExpressionEngine.toFloat(evaluated));
            });
            variableValues.push(singleRunVariableValues)
        }

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
