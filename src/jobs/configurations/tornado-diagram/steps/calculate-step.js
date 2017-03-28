import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";

import {BatchStep} from "../../../engine/batch/batch-step";
import {TreeValidator} from "../../../../validation/tree-validator";
import {Policy} from "../../../../policies/policy";
import {PoliciesCollector} from "../../../../policies/policies-collector";

export class CalculateStep extends BatchStep {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("calculate_step", jobRepository, 1);
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    init(stepExecution, jobResult) {
        var jobExecutionContext = stepExecution.getJobExecutionContext();
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");

        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        var variableValues = jobExecutionContext.get("variableValues");
        var variableNames = params.value("variables").map(v=>v.name);
        stepExecution.executionContext.put("variableNames", variableNames);
        var data = stepExecution.getData();
        this.expressionsEvaluator.clear(data);
        this.expressionsEvaluator.evalGlobalCode(data);

        var defaultValues = {};
        Utils.forOwn(data.expressionScope, (v,k)=>{
            defaultValues[k]=this.toFloat(v);
        });

        if(!jobResult.data){
            var headers = ['policy'];
            variableNames.forEach(n=>headers.push(n));
            headers.push('payoff');
            jobResult.data = {
                headers:headers,
                rows: [],
                variableNames: variableNames,
                defaultValues: defaultValues,
                policies: jobExecutionContext.get("policies")
            };
        }

        return variableValues.length;
    }


    readNextChunk(stepExecution, startIndex, chunkSize) {
        var variableValues = stepExecution.getJobExecutionContext().get("variableValues");
        return variableValues.slice(startIndex, startIndex + chunkSize);
    }

    processItem(stepExecution, item, itemIndex) {
        var params = stepExecution.getJobParameters();
        var preserveDataModel = params.value("preserveDataModel");
        var ruleName = params.value("ruleName");
        var data = stepExecution.getData();
        var treeRoot = data.getRoots()[0];
        var variableNames = stepExecution.executionContext.get("variableNames");
        var variableName = variableNames[itemIndex];



        var results = []

        item.forEach(variableValue=>{

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalGlobalCode(data);

            data.expressionScope[variableName] = variableValue;

            this.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
            var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));
            var valid = vr.isValid();

            if(!valid) {
                return null;
            }

            this.objectiveRulesManager.recomputeTree(treeRoot, false);
            var policiesCollector = new PoliciesCollector(treeRoot, ruleName);
            var policies = policiesCollector.policies;

            var payoff = treeRoot.computedValue(ruleName, 'payoff');


            var r = {
                policies: policies,
                variableName: variableName,
                variableIndex: itemIndex,
                variableValue: variableValue,
                payoff: payoff
            };
            if(preserveDataModel){
                r.data = data.getDTO();
            }
            results.push(r)
        });

        return results;

    }

    writeChunk(stepExecution, items, jobResult) {
        var params = stepExecution.getJobParameters();
        var preserveDataModel = params.value("preserveDataModel");
        var policyByKey = stepExecution.getJobExecutionContext().get("policyByKey");
        var policies = stepExecution.getJobExecutionContext().get("policies");

        items.forEach(itemsWrapper=>{
            if(!itemsWrapper){
                return;
            }

            itemsWrapper.forEach(item=>{
                item.policies.forEach((policy)=>{

                    var rowCells = [Policy.toPolicyString(policy)];
                    jobResult.data.variableNames.forEach((v)=>{
                        var value = "default";
                        if(v == item.variableName){
                            value = this.toFloat(item.variableValue);
                        }else if(jobResult.data.defaultValues.hasOwnProperty(v)){
                            value = jobResult.data.defaultValues[v];
                        }
                        rowCells.push(value)
                    });
                    var payoff = item.payoff;
                    rowCells.push(Utils.isString(payoff)? payoff: this.toFloat(payoff));
                    var row = {
                        cells: rowCells,
                        policyIndex: policies.indexOf(policyByKey[policy.key]),
                    };
                    if(preserveDataModel){
                        row.data =  item.data
                    }
                    jobResult.data.rows.push(row);
                })
            })


        })
    }


    toFloat(v){
        return ExpressionEngine.toFloat(v);
    }
}
