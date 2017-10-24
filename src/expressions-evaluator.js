import {ExpressionEngine} from "sd-expression-engine";
import {domain as model} from 'sd-model'
import {Utils, log} from 'sd-utils'

/*Evaluates code and expressions in trees*/
export class ExpressionsEvaluator {
    expressionEngine;
    constructor(expressionEngine){
        this.expressionEngine = expressionEngine;
    }

    clear(data){
        data.nodes.forEach(n=>{
            n.clearComputedValues();
        });
        data.edges.forEach(e=>{
            e.clearComputedValues();
        });
    }

    clearTree(data, root){
        data.getAllNodesInSubtree(root).forEach(n=>{
            n.clearComputedValues();
            n.childEdges.forEach(e=>{
                e.clearComputedValues();
            })
        })
    }

    evalExpressions(data, evalCode=true, evalNumeric=true, initScopes=false){
        log.debug('evalExpressions evalCode:'+evalCode+' evalNumeric:'+evalNumeric);
        if(evalCode){
            this.evalGlobalCode(data);
        }

        data.getRoots().forEach(n=>{
            this.clearTree(data, n);
            this.evalExpressionsForNode(data, n, evalCode, evalNumeric,initScopes);
        });

    }

    evalGlobalCode(data){
        data.clearExpressionScope();
        data.$codeDirty = false;
        try{
            data.$codeError = null;
            this.expressionEngine.eval(data.code, false, data.expressionScope);
        }catch (e){
            data.$codeError = e;
        }
    }

    evalPayoff(edge, index = 0) {
        if (ExpressionEngine.hasAssignmentExpression(edge.payoff[index])) {
            return null;
        }
        return this.expressionEngine.eval(edge.payoff[index], true, edge.parentNode.expressionScope);
    }

    evalExpressionsForNode(data, node, evalCode=true, evalNumeric=true, initScope=false) {
        if(!node.expressionScope || initScope || evalCode){
            this.initScopeForNode(data, node);
        }
        if(evalCode){
            node.$codeDirty = false;
            if(node.code){
                try{
                    node.$codeError = null;
                    this.expressionEngine.eval(node.code, false, node.expressionScope);
                }catch (e){
                    node.$codeError = e;
                    log.debug(e);
                }
            }
        }

        if(evalNumeric){
            var scope = node.expressionScope;
            var probabilitySum=ExpressionEngine.toNumber(0);
            var hashEdges= [];
            var invalidProb = false;

            node.childEdges.forEach(e=>{
                e.payoff.forEach((rawPayoff, payoffIndex)=> {
                    let path = 'payoff[' + payoffIndex + ']';
                    if(e.isFieldValid(path, true, false)){
                        try{
                            e.computedValue(null, path, this.evalPayoff(e, payoffIndex))
                        }catch (err){
                            //   Left empty intentionally
                        }
                    }
                });



                if(node instanceof model.ChanceNode){
                    if(ExpressionEngine.isHash(e.probability)){
                        hashEdges.push(e);
                        return;
                    }

                    if(ExpressionEngine.hasAssignmentExpression(e.probability)){ //It should not occur here!
                        log.warn("evalExpressionsForNode hasAssignmentExpression!", e);
                        return null;
                    }

                    if(e.isFieldValid('probability', true, false)){
                        try{
                            var prob = this.expressionEngine.eval(e.probability, true, scope);
                            e.computedValue(null, 'probability', prob);
                            probabilitySum = ExpressionEngine.add(probabilitySum, prob);
                        }catch (err){
                            invalidProb = true;
                        }
                    }else{
                        invalidProb = true;
                    }
                }

            });


            if(node instanceof model.ChanceNode){
                var computeHash = hashEdges.length && !invalidProb && (probabilitySum.compare(0) >= 0 && probabilitySum.compare(1) <= 0);

                if(computeHash) {
                    var hash = ExpressionEngine.divide(ExpressionEngine.subtract(1, probabilitySum), hashEdges.length);
                    hashEdges.forEach(e=> {
                        e.computedValue(null, 'probability', hash);
                    });
                }
            }

            node.childEdges.forEach(e=>{
                this.evalExpressionsForNode(data, e.childNode, evalCode, evalNumeric, initScope);
            });
        }
    }

    initScopeForNode(data, node){
        var parent = node.$parent;
        var parentScope = parent?parent.expressionScope : data.expressionScope;
        node.expressionScope = Utils.cloneDeep(parentScope);
    }
}
