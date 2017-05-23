import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MaxMaxRule extends MultiCriteriaRule{

    static NAME = 'max-max';

    constructor(expressionEngine){
        super(MaxMaxRule.NAME, [1, 1], expressionEngine);
    }
}
