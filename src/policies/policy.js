import {Decision} from "./decision";

export class Policy{
    id;
    decisions = [];

    constructor(id, decisions){
        this.id = id;
        this.decisions = decisions || [];
        this.key = Policy.generateKey(this);
    }

    addDecision(node, decisionValue){
        var decision = new Decision(node, decisionValue);
        this.decisions .push(decision);
        this.key = Policy.generateKey(this);
        return decision;
    }

    static generateKey(policy){
        var key = "";
        policy.decisions.forEach(d=>key+=(key? "&": "")+d.key);
        return key;
    }

    equals(policy, ignoreId=true){
        if(this.key != policy.key){
            return false;
        }

        return ignoreId || this.id === policy.id;
    }

    getDecision(decisionNode){
        return Policy.getDecision(this, decisionNode);
    }

    static getDecision(policy, decisionNode){
        for(var i=0; i<policy.decisions.length; i++){
            var decision = Decision.getDecision(policy.decisions[i], decisionNode);
            if(decision){
                return decision;
            }
        }
        return null;
    }

    static toPolicyString(policy, extended=false, prependId=false){

        var res = "";
        policy.decisions.forEach(d=>{
            if(res){
                if(extended){
                    res += "\n"
                }else{
                    res += ", "
                }


            }
            res += Decision.toDecisionString(d, extended, 'name', '\t');
        });
        if(prependId && policy.id!==undefined){
            return policy.id+" "+res;
        }
        return res;
    }


    toPolicyString(indent=false){
        return Policy.toPolicyString(this, indent)
    }


}
