
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

    static generateKey(decision, keyProperty='$id'){
        var e = decision.node.childEdges[decision.decisionValue];
        return decision.node[keyProperty]+":"+(e[keyProperty]? e[keyProperty] : decision.decisionValue+1);
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
        if(decision.node===decisionNode || decision.node.$id === decisionNode.$id){
            return decision;
        }
        for(var i=0; i<decision.children.length; i++){
            var d = Decision.getDecision(decision.children[i], decisionNode);
            if(d){
                return d;
            }
        }
    }

    static toDecisionString(decision, indent=false, keyProperty='name'){

        var res = Decision.generateKey(decision, keyProperty);
        var childrenRes = "";
        decision.children.forEach(d=>{
            if(childrenRes){
                childrenRes += ", "
            }
            childrenRes += Decision.toDecisionString(d,indent)
        });
        if(decision.children.length){
            childrenRes = "(" + childrenRes + ")";
        }
        if(childrenRes.length){
            res += " - " +childrenRes;
        }

        return res;
    }

    toDecisionString(indent=false){
        return Decision.toDecisionString(this, indent)
    }
}
