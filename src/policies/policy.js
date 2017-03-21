import {Decision} from "./decision";

export class Policy{
    id;
    decisions = [];

    constructor(id, decisions){
        this.id = id;
        this.decisions = decisions || [];
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


    static toPolicyString(policy, indent=false){
        var res = "";
        policy.decisions.forEach(d=>{
            if(res){
                res += ", "
            }
            res += d.toDecisionString(indent);
        });
        return res;
    }


    toPolicyString(indent=false){
        return Policy.toPolicyString(this, indent)
    }


}
