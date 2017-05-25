import {domain as model} from "sd-model";
import {ObjectiveRule} from "./objective-rule";
import {Policy} from "../../policies/policy";


export class MultiCriteriaRule extends ObjectiveRule {

    criterion1Weight = 1;
    payoffCoeffs = [1, -1];

    constructor(name, payoffCoeffs, expressionEngine) {
        super(name, true, expressionEngine, true);
        this.payoffCoeffs = payoffCoeffs;

    }

    setDefaultCriterion1Weight(criterion1Weight) {
        this.criterion1Weight = criterion1Weight;
    }

    // payoff - parent edge payoff, aggregatedPayoff - aggregated payoff along path
    computePayoff(node, payoff = [0, 0], aggregatedPayoff = [0, 0]) {
        var childrenPayoff = [0, 0];
        if (node.childEdges.length) {
            if (node instanceof model.DecisionNode) {

                var selectedIndexes = [];
                var bestChild = -Infinity;

                node.childEdges.forEach((e, i)=> {
                    let basePayoffs = [this.basePayoff(e, 0), this.basePayoff(e, 1)];
                    var childPayoff = this.computePayoff(e.childNode, basePayoffs, [this.add(basePayoffs[0], aggregatedPayoff[0]), this.add(basePayoffs[1], aggregatedPayoff[1])]);
                    var childCombinedPayoff = this.cValue(e.childNode, 'combinedPayoff');
                    if (childCombinedPayoff > bestChild) {
                        bestChild = childCombinedPayoff;
                        selectedIndexes = [i];
                    } else if (bestChild.equals(childCombinedPayoff)) {
                        selectedIndexes.push(i);
                    }
                });

                if (this.decisionPolicy) {
                    selectedIndexes = [];
                    var decision = Policy.getDecision(this.decisionPolicy, node);
                    if (decision) {
                        selectedIndexes = [decision.decisionValue];
                    }

                }

                node.childEdges.forEach((e, i)=> {
                    this.clearComputedValues(e);
                    this.cValue(e, 'probability', selectedIndexes.indexOf(i) < 0 ? 0.0 : 1.0);
                });
            } else {
                node.childEdges.forEach(e=> {
                    let basePayoffs = [this.basePayoff(e, 0), this.basePayoff(e, 1)];
                    this.computePayoff(e.childNode, basePayoffs, [this.add(basePayoffs[0], aggregatedPayoff[0]), this.add(basePayoffs[1], aggregatedPayoff[1])]);
                    this.clearComputedValues(e);
                    this.cValue(e, 'probability', this.baseProbability(e));
                });
            }

            var sumweight = 0;
            node.childEdges.forEach(e=> {
                sumweight = this.add(sumweight, this.cValue(e, 'probability'));
            });

            if (sumweight > 0) {
                node.childEdges.forEach(e=> {
                    childrenPayoff.forEach((p, i)=> {
                        let ep = this.cValue(e.childNode, 'payoff[' + i + ']');
                        childrenPayoff[i] = this.add(p, this.multiply(this.cValue(e, 'probability'), ep).div(sumweight))
                    });
                });
            }


        }
        payoff.forEach((p, i)=> {
            payoff[i] = this.add(p, childrenPayoff[i]);
        });

        this.clearComputedValues(node);

        if (node instanceof model.TerminalNode) {
            this.cValue(node, 'aggregatedPayoff', aggregatedPayoff);
            this.cValue(node, 'probabilityToEnter', 0); //initial value
        } else {
            this.cValue(node, 'childrenPayoff', childrenPayoff);
        }

        this.cValue(node, 'combinedPayoff', this.computeCombinedPayoff(payoff));

        return this.cValue(node, 'payoff', payoff);
    }

    computeCombinedPayoff(payoff){
        // [criterion 1 coeff]*[criterion 1]*[weight]+[criterion 2 coeff]*[criterion 2]
        if (this.criterion1Weight === Infinity) {
            return this.multiply(this.payoffCoeffs[0], payoff[0]);
        }
        return this.add(this.multiply(this.payoffCoeffs[0], this.multiply(this.criterion1Weight, payoff[0])), this.multiply(this.payoffCoeffs[1], payoff[1]));
    }

    //  combinedPayoff - parent edge combinedPayoff
    computeOptimal(node, combinedPayoff = 0, probabilityToEnter = 1) {
        this.cValue(node, 'optimal', true);
        if (node instanceof model.TerminalNode) {
            this.cValue(node, 'probabilityToEnter', probabilityToEnter);
        }

        node.childEdges.forEach(e=> {
            if (this.subtract(this.cValue(node, 'combinedPayoff'), combinedPayoff).equals(this.cValue(e.childNode, 'combinedPayoff')) || !(node instanceof model.DecisionNode)) {
                this.cValue(e, 'optimal', true);
                this.computeOptimal(e.childNode, this.computeCombinedPayoff([this.basePayoff(e, 0), this.basePayoff(e, 1)]), this.multiply(probabilityToEnter, this.cValue(e, 'probability')));
            } else {
                this.cValue(e, 'optimal', false);
            }
        })
    }
}
