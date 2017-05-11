import {Utils} from "sd-utils";
import {Step} from "../../../../engine/step";
import {JOB_STATUS} from "../../../../engine/job-status";
import {ExpressionEngine} from "sd-expression-engine";
import {JobComputationException} from "../../../../engine/exceptions/job-computation-exception";

export class PrepareVariablesStep extends Step {
    constructor(expressionEngine, jobRepository) {
        super("prepare_variables", jobRepository);
        this.expressionEngine = expressionEngine;
    }

    doExecute(stepExecution, jobResult) {
        var params = stepExecution.getJobParameters();
        var numberOfRuns = params.value("numberOfRuns");
        var variables = params.value("variables");
        var variableValues = [];
        var data = stepExecution.getData();

        for(var runIndex=0; runIndex<numberOfRuns; runIndex++){
            var singleRunVariableValues = [];
            var errors = [];
            variables.forEach(v=> {
                try{
                    var evaluated = this.expressionEngine.eval(v.formula, true, Utils.cloneDeep(data.expressionScope));
                    singleRunVariableValues.push(ExpressionEngine.toFloat(evaluated));
                }catch(e){
                    errors.push({
                        variable: v,
                        error: e
                    });
                }
            });

            if(errors.length) {
                var errorData = {variables: []};
                errors.forEach(e=>{
                    errorData.variables[e.variable.name] = e.error.message;
                });
                console.log('errorData', errorData);
                throw new JobComputationException("param-computation", errorData)
            }

            variableValues.push(singleRunVariableValues)
        }

        jobResult.data={
            variableValues: variableValues
        };

        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }
}

