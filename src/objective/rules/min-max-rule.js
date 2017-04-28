import {domain as model} from 'sd-model'
import {ObjectiveRule} from './objective-rule'
import {Utils} from 'sd-utils'
import {PoliciesCollector} from "../../policies/policies-collector";
import {Policy} from "../../policies/policy";
import {ExpectedValueMaximizationRule} from "./expected-value-maximization-rule";
import {ExpectedValueMinimizationRule} from "./expected-value-minimization-rule";
import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MinMaxRule extends MultiCriteriaRule{

    static NAME = 'min-max';

    constructor(expressionEngine){
        super(MinMaxRule.NAME, 0, 1, expressionEngine);
    }
}
