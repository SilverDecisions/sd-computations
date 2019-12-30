import {domain as model} from 'sd-model'
import {TreeValidator} from "../validation/tree-validator";
import {JobExecutingOperation} from "./job-executing-operation";
import {PayoffsTransformationJob} from "../jobs/configurations/payoffs-transformation/payoffs-transformation-job";


export class PayoffsTransformation extends JobExecutingOperation {

    static $NAME = 'payoffsTransformation';

    data;
    expressionEngine;

    constructor(data, expressionEngine) {
        super(PayoffsTransformation.$NAME, PayoffsTransformationJob.$NAME);
        this.data = data;
        this.expressionEngine = expressionEngine;
        this.treeValidator = new TreeValidator(expressionEngine);
    }

    isApplicable(object){
        return object instanceof model.ChanceNode || object instanceof model.DecisionNode
    }

    canPerform(node) {
        if (!this.isApplicable(node)) {
            return false;
        }

        if (!this.treeValidator.validate(this.data.getAllNodesInSubtree(node)).isValid()) { //check if the whole subtree is proper
            return false;
        }

        return !node.$parent && node.childEdges.length > 0;
    }

}
