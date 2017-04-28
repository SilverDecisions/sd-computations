import {
    ExpectedValueMaximizationRule,
    ExpectedValueMinimizationRule,
    MaxiMinRule,
    MaxiMaxRule,
    MiniMinRule,
    MiniMaxRule
} from "./rules";
import {log} from "sd-utils";
import * as model from "sd-model";
import {MinMaxRule} from "./rules/min-max-rule";
import {MaxMinRule} from "./rules/max-min-rule";

export class ObjectiveRulesManager{

    expressionEngine;
    currentRule;
    ruleByName = {};
    rules = [];

    flipPair = {};

    constructor(expressionEngine, currentRuleName) {
        this.expressionEngine = expressionEngine;
        this.addRule(new ExpectedValueMaximizationRule(expressionEngine));
        this.addRule(new ExpectedValueMinimizationRule(expressionEngine));
        this.addRule(new MaxiMinRule(expressionEngine));
        this.addRule(new MaxiMaxRule(expressionEngine));
        this.addRule(new MiniMinRule(expressionEngine));
        this.addRule(new MiniMaxRule(expressionEngine));

        let minMax = new MinMaxRule(expressionEngine);
        this.addRule(minMax);
        let maxMin = new MaxMinRule(expressionEngine);
        this.addRule(maxMin);

        this.addFlipPair(minMax, maxMin);



        if (currentRuleName) {
            this.currentRule = this.ruleByName[currentRuleName];
        } else {
            this.currentRule = this.rules[0];
        }

    }

    addRule(rule){
        this.ruleByName[rule.name]=rule;
        this.rules.push(rule);
    }

    isRuleName(ruleName){
         return !!this.ruleByName[ruleName]
    }

    setCurrentRuleByName(ruleName){
        this.currentRule = this.ruleByName[ruleName];
    }

    flipRule(){
        var flipped = this.flipPair[this.currentRule.name];
        if(flipped){
            this.currentRule = flipped;
        }
    }

    updateDefaultWTP(defaultWTP){
        this.rules.filter(r=>r.multiCriteria).forEach(r=>r.setDefaultWTP(parseFloat(defaultWTP)));
    }

    recompute(dataModel, allRules, decisionPolicy=null){

        var startTime = new Date().getTime();
        log.trace('recomputing rules, all: '+allRules);

        dataModel.getRoots().forEach(n=>{
            this.recomputeTree(n, allRules, decisionPolicy);
        });

        var time  = (new Date().getTime() - startTime/1000);
        log.trace('recomputation took '+time+'s');

        return this;
    }

    recomputeTree(root, allRules, decisionPolicy=null){
        log.trace('recomputing rules for tree ...', root);

        var startTime = new Date().getTime();

        var rules  = [this.currentRule];
        if(allRules){
            rules = this.rules;
        }

        rules.forEach(rule=> {
            rule.setDecisionPolicy(decisionPolicy);
            rule.computePayoff(root);
            rule.computeOptimal(root);
            rule.clearDecisionPolicy();
        });

        var time  = (new Date().getTime() - startTime)/1000;
        log.trace('recomputation took '+time+'s');

        return this;
    }


    getNodeDisplayValue(node, name) {
        return node.computedValue(this.currentRule.name, name)

    }

    getEdgeDisplayValue(e, name){
        if(name==='probability'){
            if(e.parentNode instanceof model.domain.DecisionNode){
                return e.computedValue(this.currentRule.name, 'probability');
            }
            if(e.parentNode instanceof model.domain.ChanceNode){
                return e.computedBaseProbability();
            }
            return null;
        }
        if(name==='payoff'){
            return e.computedValue(null, 'payoff');
        }
        if(name==='optimal'){
            return e.computedValue(this.currentRule.name, 'optimal')
        }
    }

    addFlipPair(rule1, rule2) {
        this.flipPair[rule1.name] = rule2;
        this.flipPair[rule2.name] = rule1;
    }
}
