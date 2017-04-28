import {domain as model} from 'sd-model'
import {ObjectiveRule} from './objective-rule'
import {Utils} from 'sd-utils'
import {PoliciesCollector} from "../../policies/policies-collector";
import {Policy} from "../../policies/policy";
import {ExpectedValueMaximizationRule} from "./expected-value-maximization-rule";
import {ExpectedValueMinimizationRule} from "./expected-value-minimization-rule";
import {MultiCriteriaRule} from "./multi-criteria-rule";


export class MaxMinRule extends MultiCriteriaRule{

    static NAME = 'max-min';

    constructor(expressionEngine){
        super(MaxMinRule.NAME, 1, 0, expressionEngine);
    }
}
