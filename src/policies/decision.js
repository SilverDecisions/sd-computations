
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

    static toDecisionString(decision, indent=false, keyProperty='name'){

        var res = Decision.generateKey(decision, keyProperty);
        var childrenRes = "";
        decision.children.forEach(d=>{
            if(childrenRes){
                childrenRes += ", "
            }
            childrenRes += Decision.toDecisionString(d,indent)
        });
        if(decision.children.length>1){
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
