import {SimpleJob} from "../../engine/simple-job";
import {SensitivityAnalysisJobParameters} from "./sensitivity-analysis-job-parameters";
import {PrepareVariablesStep} from "./steps/prepare-variables-step";
import {InitPoliciesStep} from "./steps/init-policies-step";
import {CalculateStep} from "./steps/calculate-step";
import {Policy} from "../../../policies/policy";
import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";


export class SensitivityAnalysisJob extends SimpleJob {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager, batchSize=5) {
        super("sensitivity-analysis", jobRepository, expressionsEvaluator, objectiveRulesManager);
        this.batchSize = 5;
        this.initSteps();
    }

    initSteps(){
        this.addStep(new PrepareVariablesStep(this.jobRepository, this.expressionsEvaluator.expressionEngine));
        this.addStep(new InitPoliciesStep(this.jobRepository));
        this.calculateStep = new CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager, this.batchSize);
        this.addStep(this.calculateStep);
    }

    createJobParameters(values) {
        return new SensitivityAnalysisJobParameters(values);
    }

    getJobDataValidator() {
        return {
            validate: (data) => data.getRoots().length === 1
        }
    }

    setBatchSize(batchSize){
        this.batchSize = batchSize;
        this.calculateStep.chunkSize = batchSize;
    }

    jobResultToCsvRows(jobResult, jobParameters, withHeaders=true){
        var result = [];
        if(withHeaders){
            var headers = ['policy_number', 'policy'];
            jobResult.variableNames.forEach(n=>headers.push(n));
            headers.push('payoff');
            result.push(headers);
        }

        var roundVariables = !!jobParameters.values.roundVariables;
        if(roundVariables){
            this.roundVariables(jobResult);
        }

        jobResult.rows.forEach(row => {
            var policy = jobResult.policies[row.policyIndex];
            var rowCells = [row.policyIndex+1, Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription)];
            row.variables.forEach(v=> rowCells.push(v));
            rowCells.push(row.payoff);
            result.push(rowCells);

            if(row._variables){ //revert original variables
                row.variables = row._variables;
                delete row._variables;
            }
        });

        return result;
    }

    roundVariables(jobResult){
        var uniqueValues = jobResult.variableNames.map(()=>new Set());

        jobResult.rows.forEach(row => {
            row._variables = row.variables.slice(); // save original row variables
            row.variables.forEach((v,i)=> {
                uniqueValues[i].add(v)
            });
        });

        var uniqueValuesNo = uniqueValues.map((s)=>s.size);
        var maxPrecision = 14;
        var precision = 2;
        var notReadyVariablesIndexes = jobResult.variableNames.map((v,i)=>i);
        while(precision<=maxPrecision && notReadyVariablesIndexes.length){
            uniqueValues = notReadyVariablesIndexes.map(()=>new Set());
            jobResult.rows.forEach(row => {
                notReadyVariablesIndexes.forEach((variableIndex, notReadyIndex)=>{

                    var val = row._variables[variableIndex];
                    val = Utils.round(val, precision);
                    uniqueValues[notReadyIndex].add(val);

                    row.variables[variableIndex] = val;
                })
            });

            var newReadyIndexes = [];
            uniqueValues.forEach((uniqueVals, notReadyIndex)=>{
                var origUniqueCount = uniqueValuesNo[notReadyVariablesIndexes[notReadyIndex]] ;
                if(origUniqueCount==uniqueVals.size){ //ready in previous iteration
                    newReadyIndexes.push(notReadyIndex);
                }
            });
            if(newReadyIndexes.length) { //revert values to prev iteration
                newReadyIndexes.reverse();
                newReadyIndexes.forEach(notReadyIndex=>{
                    notReadyVariablesIndexes.splice(notReadyIndex, 1);
                })
            }
            precision++;
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
