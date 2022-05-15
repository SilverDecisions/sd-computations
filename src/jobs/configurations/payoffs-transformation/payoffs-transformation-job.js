import {SimpleJob} from "../../engine/simple-job";
import {Step} from "../../engine/step";
import {JOB_STATUS} from "../../engine/job-status";
import {TreeValidator} from "../../../validation/tree-validator";

import {PayoffsTransformationJobParameters} from "./payoffs-transformation-job-parameters";
import {Job} from "../../engine/job";
import {domain as model} from "sd-model";
import {ExpressionEngine} from "sd-expression-engine";

export class PayoffsTransformationJob extends Job {

    static $NAME = 'payoffs-transformation';

    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super(PayoffsTransformationJob.$NAME, jobRepository);
        this.isRestartable = false;
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    doExecute(execution) {
        var data = execution.getData();
        var params = execution.jobParameters;
        let functionName = params.value("functionName");

        const root = data.findNodeById(params.value("objectId"));

        let makeClone = params.value("makeClone");

        let rootTarget = makeClone ? data.cloneSubtree(root, true) : root;


        rootTarget.code += '\n' + functionName + '('+ params.value('functionArgumentName') + ') = ' + params.value('functionBody');

        let allNodes = data.getAllNodesInSubtree(rootTarget);

        this.processNodePayoff(rootTarget, params);

        if(makeClone){
            let minY = Number.MAX_VALUE;
            let maxY = Number.MIN_VALUE;
            allNodes.forEach(n => {
                if (n.location.y < minY) {
                    minY = n.location.y;
                }
                if (n.location.y > maxY) {
                    maxY = n.location.y;
                }

            });

            let extentY = maxY - minY;
            let margin = 30;
            let offset = extentY + margin;


            rootTarget.move(0, offset);
            data.attachSubtree(rootTarget);
        }

        return execution;
    }

    processNodePayoff(node, params, parentEdge = null, aggregatedPayoff = [0, 0]){
        const payoffIndex = params.value("payoffIndex");
        if(node.type === model.TerminalNode.$TYPE){
            if (payoffIndex === null || payoffIndex === undefined) {
                parentEdge.payoff = aggregatedPayoff.map(p => this.transformValue(params, p));
            } else {
                parentEdge.payoff[payoffIndex] = this.transformValue(params, aggregatedPayoff[payoffIndex]);
            }

            return;
        }

        if (parentEdge) {
            if (payoffIndex === null || payoffIndex === undefined) {
                parentEdge.payoff.fill(0);
            } else {
                parentEdge.payoff[payoffIndex] = 0;
            }

        }


        node.childEdges.forEach((e) => {
            this.processNodePayoff(e.childNode, params, e, aggregatedPayoff.map((p,i) => ExpressionEngine.add(p, e.computedBasePayoff(undefined, i))))
        })
    }

    transformValue(params, p) {
        return params.value("functionName") + '(' + ExpressionEngine.toNumber(p).toFraction(false) + ')';
    }

    createJobParameters(values) {
        return new PayoffsTransformationJobParameters(values);
    }
}
