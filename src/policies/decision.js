
export class Decision{
    node;
    decisionValue; //index of  selected edge
    children = [];
    key;

    constructor(node, decisionValue) {
        this.node = node;
        this.decisionValue = decisionValue;
        this.key = Decision.generateKey(this);
    }

    static generateKey(decision, keyProperty='id'){
        var e = decision.node.childEdges[decision.decisionValue];
        var key = decision.node[keyProperty]+":"+(e[keyProperty]? e[keyProperty] : decision.decisionValue+1);
        return key.replace(/\n/g, ' ');
    }

    addDecision(node, decisionValue){
        var decision = new Decision(node, decisionValue);
        this.children.push(decision);
        this.key = Decision.generateKey(this);
        return decision;
    }

    getDecision(decisionNode){
        return Decision.getDecision(this, decisionNode)
    }

    static getDecision(decision, decisionNode){
        if(decision.node===decisionNode || decision.node.id === decisionNode.id){
            return decision;
        }
        for(var i=0; i<decision.children.length; i++){
            var d = Decision.getDecision(decision.children[i], decisionNode);
            if(d){
                return d;
            }
        }
    }

    static toDecisionString(decision, extended=false, keyProperty='name', indent = ''){

        var res = Decision.generateKey(decision, keyProperty);
        var childrenRes = "";

        decision.children.forEach(d=>{
            if(childrenRes){
                if(extended){
                    childrenRes += '\n'+indent;
                }else{
                    childrenRes += ", "
                }

            }
            childrenRes += Decision.toDecisionString(d,extended,keyProperty, indent+'\t')
        });
        if(decision.children.length){
            if(extended){
                childrenRes =  '\n'+indent +childrenRes;
            }else{
                childrenRes = " - (" + childrenRes + ")";
            }



        }

        return res+childrenRes;
    }

    toDecisionString(indent=false){
        return Decision.toDecisionString(this, indent)
    }
}
