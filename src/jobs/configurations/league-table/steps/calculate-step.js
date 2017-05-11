import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {PoliciesCollector} from "../../../../policies/policies-collector";
import {ExpressionEngine} from "sd-expression-engine";
import {TreeValidator} from "../../../../validation/tree-validator";
import {Policy} from "../../../../policies/policy";

export class CalculateStep extends Step {
    constructor(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        super("calculate_step", jobRepository);
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
        this.treeValidator = new TreeValidator();
    }

    doExecute(stepExecution, jobResult) {
        var data = stepExecution.getData();
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");
        this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        let rule = this.objectiveRulesManager.currentRule;
        var treeRoot = data.getRoots()[0];
        var policiesCollector = new PoliciesCollector(treeRoot);

        var policies = policiesCollector.policies;


        var minimizedIndex = this.minimizedIndex = rule.minimizedPayoffIndex;
        var maximizedIndex = this.maximizedIndex = rule.maximizedPayoffIndex;

        this.expressionsEvaluator.evalExpressions(data);
        var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

        if (!vr.isValid()) {
            return stepExecution;
        }

        var compare = (a, b)=>(b.payoffs[maximizedIndex] - a.payoffs[maximizedIndex]) || (a.payoffs[minimizedIndex] - b.payoffs[minimizedIndex]);

        var rows = policies.map(policy => {
            this.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
            return {
                policies: [policy],
                payoffs: treeRoot.computedValue(ruleName, 'payoff').slice(),
                dominatedBy: null,
                extendedDominatedBy: null,
                ICER: null
            }
        }).sort(compare);

        rows = rows.reduce((previousValue, currentValue, index, array)=>{
            if(!previousValue.length){
                return [currentValue]
            }

            let prev = previousValue[previousValue.length-1];
            if(compare(prev, currentValue) == 0){
                prev.policies.push(...currentValue.policies);
                return previousValue
            }
            return previousValue.concat(currentValue)
        }, []);

        rows.sort((a, b)=>(a.payoffs[maximizedIndex] - b.payoffs[maximizedIndex]) || (a.payoffs[minimizedIndex] - b.payoffs[minimizedIndex]));
        rows.forEach((r, i)=> {
            r.id = i+1;
        });
        rows.sort(compare);

        let minCost = Infinity,
            minCostRow = null;

        rows.forEach((r, i)=> {
            if (r.payoffs[minimizedIndex] < minCost) {
                minCost = r.payoffs[minimizedIndex];
                minCostRow = r;
            } else if(minCostRow) {
                r.dominatedBy = minCostRow.id;
            }
        });


        rows.filter(r=>!r.dominatedBy).sort((a, b)=>(a.payoffs[maximizedIndex] - b.payoffs[maximizedIndex])).forEach((r, i, arr)=> {
            if (i == 0) {
                r.ICER = 0;
                return;
            }
            let prev = arr[i - 1];

            r.ICER = this.computeICER(r, prev);
            if (i < 2) {
                return;
            }

            let prev2 = arr[i - 2];
            if (prev2.extendedDominatedBy !== null) {
                return;
            }

            if(r.ICER < prev.ICER){
                prev.ICER = null;
                prev.extendedDominatedBy = [prev2.id, r.id] ;

                r.ICER = this.computeICER(r, prev2);
            }
        });

        rows.forEach(row=>{
            row.payoffs[0] =  ExpressionEngine.toFloat(row.payoffs[0]);
            row.payoffs[1] =  ExpressionEngine.toFloat(row.payoffs[1]);
            row.ICER = row.ICER === null ? null : ExpressionEngine.toFloat(row.ICER);
        });

        jobResult.data = {
            maximizedPayoffIndex: maximizedIndex,
            minimizedPayoffIndex: minimizedIndex,
            rows: rows.sort((a, b)=>(a.payoffs[maximizedIndex] - b.payoffs[maximizedIndex]) || (a.payoffs[minimizedIndex] - b.payoffs[minimizedIndex]))
        };


        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }

    computeICER(r, prev){
        let d = ExpressionEngine.subtract(r.payoffs[this.maximizedIndex], prev.payoffs[this.maximizedIndex]);
        let n = ExpressionEngine.subtract(r.payoffs[this.minimizedIndex], prev.payoffs[this.minimizedIndex]);
        if (d == 0){
            if(n<0){
                return - Infinity;
            }
            return Infinity;
        }
        return ExpressionEngine.divide(n, d);
    }
}
