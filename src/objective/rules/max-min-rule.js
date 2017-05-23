import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MaxMinRule extends MultiCriteriaRule{

    static NAME = 'max-min';

    constructor(expressionEngine){
        super(MaxMinRule.NAME, [1, -1], expressionEngine);
    }
}
