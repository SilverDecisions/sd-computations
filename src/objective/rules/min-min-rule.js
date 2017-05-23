import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MinMinRule extends MultiCriteriaRule{

    static NAME = 'min-min';

    constructor(expressionEngine){
        super(MinMinRule.NAME, [-1, -1], expressionEngine);
    }
}
