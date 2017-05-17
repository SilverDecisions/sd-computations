import {domain as model} from "sd-model";
import {ObjectiveRule} from "./objective-rule";
import {Policy} from "../../policies/policy";


export class MultiCriteriaRule extends ObjectiveRule {

    defaultWTP = 1;

    minimizedPayoffIndex = 0;
    maximizedPayoffIndex = 1;

    constructor(name, minimizedPayoffIndex, maximizedPayoffIndex, expressionEngine) {
        super(name, true, expressionEngine, true);
        this.minimizedPayoffIndex = minimizedPayoffIndex;
        this.maximizedPayoffIndex = maximizedPayoffIndex;
    }

    setDefaultWTP(defaultWTP) {
        this.defaultWTP = defaultWTP;
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
            this.cValue(node, 'probabilityToEnter', [0, 0]); //initial value
        } else {
            this.cValue(node, 'childrenPayoff', childrenPayoff);
        }

        this.cValue(node, 'combinedPayoff', this.computeCombinedPayoff(payoff));

        return this.cValue(node, 'payoff', payoff);
    }

    computeCombinedPayoff(payoff){
        if (this.defaultWTP === Infinity) {
            return payoff[this.maximizedPayoffIndex];
        }
        return this.subtract(this.multiply(this.defaultWTP, payoff[this.maximizedPayoffIndex]), payoff[this.minimizedPayoffIndex]);
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
