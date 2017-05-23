import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MinMaxRule extends MultiCriteriaRule{

    static NAME = 'min-max';

    constructor(expressionEngine){
        super(MinMaxRule.NAME, [-1, 1], expressionEngine);
    }
}
