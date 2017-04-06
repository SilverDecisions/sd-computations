import {domain as model} from 'sd-model'
import {ObjectiveRule} from './objective-rule'
import {Utils} from 'sd-utils'

/*expected value maximization rule*/
export class ExpectedValueMaximizationRule extends ObjectiveRule{

    static NAME = 'expected-value-maximization';

    constructor(expressionEngine){
        super(ExpectedValueMaximizationRule.NAME, true, expressionEngine);
    }

    //  payoff - parent edge payoff
    computeOptimal(node, payoff=0, probabilityToEnter=1){
        this.cValue(node, 'optimal', true);
        if(node instanceof model.TerminalNode){
            this.cValue(node, 'probabilityToEnter', probabilityToEnter);
        }

        node.childEdges.forEach(e=>{
            if ( this.subtract(this.cValue(node,'payoff'),payoff).equals(this.cValue(e.childNode, 'payoff')) || !(node instanceof model.DecisionNode) ) {
                this.cValue(e, 'optimal', true);
                this.computeOptimal(e.childNode, this.basePayoff(e), this.multiply(probabilityToEnter, this.cValue(e,'probability')));
            }else{
                this.cValue(e, 'optimal', false);
            }
        })
    }

}
