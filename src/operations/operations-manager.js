import {FlipSubtree} from "./flip-subtree";
import {PayoffsTransformation} from "./payoffs-transformation.js";


export class OperationsManager {

    operations = [];
    operationByName = {};

    constructor(data, expressionEngine, jobsManger){
        this.data = data;
        this.expressionEngine = expressionEngine;
        this.jobsManger = jobsManger;
        this.registerOperation(new FlipSubtree(data, expressionEngine));
        this.registerOperation(new PayoffsTransformation(data, expressionEngine));
    }

    registerOperation(operation){
        this.operations.push(operation);
        this.operationByName[operation.name] = operation;
    }


    getOperationByName(name){
        return this.operationByName[name];
    }

    operationsForObject(object){
        return this.operations.filter(op=>op.isApplicable(object))
    }

    setData(data){
        this.data = data;
        this.operations.forEach(o => o.data = data)
    }

    performOperation(object, operationName, jobParamsValues){

        let operation = this.getOperationByName(operationName);

        if(!operation.jobName){
            return Promise.resolve(operation.perform(object, jobParamsValues))
        }

        jobParamsValues['objectId'] = object.id;

        return this.jobsManger.run(operation.jobName, jobParamsValues, this.data, false).then((jobExecution)=> {

            const d = jobExecution.getData();
            this.data.nodes = d.nodes;
            this.data.edges = d.edges;
            this.data.code = d.code;

            operation.postProcess(object, jobParamsValues);

            return true;
        })
    }
}
