import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";
import {BatchStep} from "../../../../engine/batch/batch-step";
import {TreeValidator} from "../../../../../validation/tree-validator";
import {Policy} from "../../../../../policies/policy";
import {JobComputationException} from "../../../../engine/exceptions/job-computation-exception";

export class CalculateStep extends BatchStep {

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager, batchSize) {
        super("calculate_step", jobRepository, batchSize);
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    init(stepExecution, jobResult) {
        var jobExecutionContext = stepExecution.getJobExecutionContext();
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");

        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        var variableValues = jobResult.data.variableValues;
        var variableNames = params.value("variables").map(v=>v.name);
        stepExecution.executionContext.put("variableNames", variableNames);


        if (!jobResult.data.rows) {
            jobResult.data.rows = [];
            jobResult.data.variableNames = variableNames;
        }

        return variableValues.length;
    }


    readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
        var variableValues = jobResult.data.variableValues;
        return variableValues.slice(startIndex, startIndex + chunkSize);
    }


    processItem(stepExecution, item) {
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");
        var failOnInvalidTree = params.value("failOnInvalidTree");
        var data = stepExecution.getData();
        var treeRoot = data.getRoots()[0];
        var variableNames = stepExecution.executionContext.get("variableNames");
        var policies = stepExecution.getJobExecutionContext().get("policies");

        this.expressionsEvaluator.clear(data);
        this.expressionsEvaluator.evalGlobalCode(data);
        variableNames.forEach((variableName, i)=> {
            data.expressionScope[variableName] = item[i];
        });

        this.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
        var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

        var valid = vr.isValid();

        if(!valid && failOnInvalidTree){
            let errorData = {
                variables: {}
            };
            variableNames.forEach((variableName, i)=> {
                errorData.variables[variableName] = item[i];
            });
            throw new JobComputationException("computations", errorData)
        }

        var payoffs = [];

        policies.forEach(policy=> {
            var payoff = 'n/a';
            if (valid) {
                this.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                payoff = treeRoot.computedValue(ruleName, 'payoff')[0];
            }
            payoffs.push(payoff);
        });

        return {
            policies: policies,
            variables: item,
            payoffs: payoffs
        };
    }

    writeChunk(stepExecution, items, jobResult) {
        var params = stepExecution.getJobParameters();
        var extendedPolicyDescription = params.value("extendedPolicyDescription");

        items.forEach(item=> {
            if (!item) {
                return;
            }
            item.policies.forEach((policy, i)=> {
                var variables = item.variables.map(v => this.toFloat(v));

                var payoff = item.payoffs[i];
                var row = {
                    policyIndex: i,
                    variables: variables,
                    payoff: Utils.isString(payoff) ? payoff : this.toFloat(payoff)
                };
                jobResult.data.rows.push(row);
            })
        })
    }

    postProcess(stepExecution, jobResult) {
        delete jobResult.data.variableValues;
    }


    toFloat(v) {
        return ExpressionEngine.toFloat(v);
    }
}
