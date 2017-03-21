import {Policy} from "./policy";
import {domain as model} from 'sd-model'
import {Utils} from 'sd-utils'
import {Decision} from "./decision";

export class PoliciesCollector{
    policies = [];

    constructor(root){
        this.collect(root).forEach((decisions,i)=>{
            this.policies.push(new Policy(i, decisions));
        });
    }

    collect(root){
        var nodeQueue = [root];
        var node;
        var decisionNodes = [];
        while(nodeQueue.length){
            node = nodeQueue.shift();

            if(node instanceof model.DecisionNode){
                decisionNodes.push(node);
                continue;
            }

            node.childEdges.forEach((edge, i)=>{
                nodeQueue.push(edge.childNode)
            })
        }

        return Utils.cartesianProductOf(decisionNodes.map((decisionNode)=>{
            var decisions= [];
            decisionNode.childEdges.forEach((edge, i)=>{

                var childDecisions = this.collect(edge.childNode); //all possible child decisions (cartesian)
                childDecisions.forEach(cd=>{
                    var decision = new Decision(decisionNode, i);
                    decisions.push(decision);
                    decision.children = cd;
                })

            });
            return decisions;
        }));
    }

}
