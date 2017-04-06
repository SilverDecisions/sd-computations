import {ExpressionEngine} from 'sd-expression-engine'
import {domain as model} from 'sd-model'
import {Decision} from "../../policies/decision";
import {Policy} from "../../policies/policy";
import {Utils} from "sd-utils";

/*Base class for objective rules*/
export class ObjectiveRule{
    name;
    expressionEngine;

    decisionPolicy;
    maximization;

    constructor(name, maximization, expressionEngine){
        this.name = name;
        this.maximization = maximization;
        this.expressionEngine = expressionEngine;
    }

    setDecisionPolicy(decisionPolicy){
        this.decisionPolicy = decisionPolicy;
    }

    clearDecisionPolicy(){
        this.decisionPolicy=null;
    }

    // should return array of selected children indexes
    makeDecision(decisionNode, childrenPayoffs){
        if(this.maximization){
            return Utils.indexesOf(childrenPayoffs, this.max(...childrenPayoffs));
        }
        return Utils.indexesOf(childrenPayoffs, this.min(...childrenPayoffs));
    }

    _makeDecision(decisionNode, childrenPayoffs){
        if(this.decisionPolicy){
            var decision = Policy.getDecision(this.decisionPolicy, decisionNode);
            if(decision){
                return [decision.decisionValue];
            }
            return [];
        }
        return this.makeDecision(decisionNode, childrenPayoffs);
    }

    // extension point for changing computed probability of edges in a chance node
    modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount){

    }

    // payoff - parent edge payoff, aggregatedPayoff - aggregated payoff along path
    computePayoff(node, payoff=0, aggregatedPayoff=0){
        var childrenPayoff = 0;
        if (node.childEdges.length) {
            if(node instanceof model.DecisionNode) {

                var selectedIndexes = this._makeDecision(node, node.childEdges.map(e=>this.computePayoff(e.childNode, this.basePayoff(e), this.add(this.basePayoff(e), aggregatedPayoff))));
                node.childEdges.forEach((e, i)=>{
                    this.clearComputedValues(e);
                    this.cValue(e, 'probability', selectedIndexes.indexOf(i) < 0 ? 0.0 : 1.0);
                });

            }else{
                var bestChild = -Infinity;
                var bestCount = 1;
                var worstChild = Infinity;
                var worstCount = 1;

                node.childEdges.forEach(e=>{
                    var childPayoff = this.computePayoff(e.childNode, this.basePayoff(e), this.add(this.basePayoff(e), aggregatedPayoff));
                    if(childPayoff < worstChild){
                        worstChild = childPayoff;
                        worstCount=1;
                    }else if(childPayoff.equals(worstChild)){
                        worstCount++
                    }
                    if(childPayoff > bestChild){
                        bestChild = childPayoff;
                        bestCount=1;
                    }else if(childPayoff.equals(bestChild)){
                        bestCount++
                    }

                    this.clearComputedValues(e);
                    this.cValue(e, 'probability', this.baseProbability(e));
                });
                this.modifyChanceProbability(node.childEdges, bestChild, bestCount, worstChild, worstCount);
            }

            var sumweight = 0 ;
            node.childEdges.forEach(e=>{
                sumweight=this.add(sumweight, this.cValue(e, 'probability'));
            });

            // console.log(payoff,node.childEdges,'sumweight',sumweight);
            if(sumweight>0){
                node.childEdges.forEach(e=>{
                    childrenPayoff = this.add(childrenPayoff, this.multiply(this.cValue(e, 'probability'),this.cValue(e.childNode, 'payoff')).div(sumweight));
                });
            }


        }

        payoff=this.add(payoff, childrenPayoff);
        this.clearComputedValues(node);

        if(node instanceof model.TerminalNode){
            this.cValue(node, 'aggregatedPayoff', aggregatedPayoff);
            this.cValue(node, 'probabilityToEnter', 0); //initial value
        }else{
            this.cValue(node, 'childrenPayoff', childrenPayoff);
        }

        return this.cValue(node, 'payoff', payoff);
    }

    // koloruje optymalne ścieżki
    computeOptimal(node){
        throw 'computeOptimal function not implemented for rule: '+this.name
    }

    /*Get or set object's computed value for current rule*/
    cValue(object, fieldName, value){
        return  object.computedValue(this.name, fieldName, value);
    }

    baseProbability(edge){
        return edge.computedBaseProbability();
    }

    basePayoff(edge){
        return edge.computedBasePayoff();
    }

    clearComputedValues(object){
        object.clearComputedValues(this.name);
    }

    add(a,b){
        return ExpressionEngine.add(a,b)
    }
    subtract(a,b){
        return ExpressionEngine.subtract(a,b)
    }
    divide(a,b){
        return ExpressionEngine.divide(a,b)
    }

    multiply(a,b){
        return ExpressionEngine.multiply(a,b)
    }

    max(){
        return ExpressionEngine.max(...arguments)
    }

    min(){
        return ExpressionEngine.min(...arguments)
    }

}
