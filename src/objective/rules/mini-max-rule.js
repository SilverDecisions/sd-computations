import {domain as model} from 'sd-model'
import {ObjectiveRule} from './objective-rule'
import {Utils} from "sd-utils";

/*mini-max rule*/
export class MiniMaxRule extends ObjectiveRule{

    static NAME = 'mini-max';

    constructor(expressionEngine){
        super(MiniMaxRule.NAME, false, expressionEngine);
    }

    modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount){
        edges.forEach(e=>{
            this.clearComputedValues(e);
            this.cValue(e, 'probability', this.cValue(e.childNode, 'payoff')<bestChildPayoff ? 0.0 : (1.0/bestCount));
        });
    }

    //  payoff - parent edge payoff
    computeOptimal(node, payoff = 0, probabilityToEnter = 1) {
        this.cValue(node, 'optimal', true);
        if (node instanceof model.TerminalNode) {
            this.cValue(node, 'probabilityToEnter', probabilityToEnter);
        }

        var optimalEdge = null;
        if (node instanceof model.ChanceNode) {
            optimalEdge = Utils.maxBy(node.childEdges, e=>this.cValue(e.childNode, 'payoff'));
        }

        node.childEdges.forEach(e=> {
            var isOptimal = false;
            if (optimalEdge) {
                isOptimal = this.cValue(optimalEdge.childNode, 'payoff').equals(this.cValue(e.childNode, 'payoff'));
            } else isOptimal = !!(this.subtract(this.cValue(node, 'payoff'), payoff).equals(this.cValue(e.childNode, 'payoff')) || !(node instanceof model.DecisionNode));

            if (isOptimal) {
                this.cValue(e, 'optimal', true);
                this.computeOptimal(e.childNode, this.basePayoff(e), this.multiply(probabilityToEnter, this.cValue(e, 'probability')));
            } else {
                this.cValue(e, 'optimal', false);
            }
        })
    }
}
