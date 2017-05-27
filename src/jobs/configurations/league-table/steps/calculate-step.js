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


        var payoffCoeffs = this.payoffCoeffs = rule.payoffCoeffs;

        this.expressionsEvaluator.evalExpressions(data);
        var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

        if (!vr.isValid()) {
            return stepExecution;
        }

        var compare = (a, b)=>(-payoffCoeffs[0] *  (b.payoffs[0] - a.payoffs[0])) || (-payoffCoeffs[1] *  (a.payoffs[1] - b.payoffs[1]));

        var rows = policies.map(policy => {
            this.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
            return {
                policies: [policy],
                payoffs: treeRoot.computedValue(ruleName, 'payoff').slice(),
                dominatedBy: null,
                extendedDominatedBy: null,
                incratio: null
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

        rows.sort((a, b)=>(payoffCoeffs[0] *  (a.payoffs[0] - b.payoffs[0])) || (-payoffCoeffs[1] *   (a.payoffs[1] - b.payoffs[1])));
        rows.forEach((r, i)=> {
            r.id = i+1;
        });
        // rows.sort(compare);
        rows.sort((a, b)=>(-payoffCoeffs[0] *  (a.payoffs[0] - b.payoffs[0])) || (-payoffCoeffs[1] *   (a.payoffs[1] - b.payoffs[1])));

        let bestCost = -payoffCoeffs[1] * Infinity,
            bestCostRow = null;

        let cmp= (a, b) => a > b;
        if(payoffCoeffs[1]<0){
            cmp= (a, b) => a < b;
        }

        rows.forEach((r, i)=> {
            if (cmp(r.payoffs[1], bestCost)) {
                bestCost = r.payoffs[1];
                bestCostRow = r;
            } else if(bestCostRow) {
                r.dominatedBy = bestCostRow.id;
            }
        });

        cmp= (a, b) => a < b;
        if(payoffCoeffs[0] > 0 && payoffCoeffs[1] < 0){
            cmp= (a, b) => a < b;
        }else if(payoffCoeffs[0] < 0 && payoffCoeffs[1] > 0){
            cmp= (a, b) => a < b;
        }else if(payoffCoeffs[1]<0){
            cmp= (a, b) => a > b;
        }

        let prev2NotDominated = null;
        rows.filter(r=>!r.dominatedBy).sort((a, b)=>(  payoffCoeffs[0] * (a.payoffs[0] - b.payoffs[0]))).forEach((r, i, arr)=> {
            if (i == 0) {
                r.incratio = 0;
                return;
            }

            let prev = arr[i - 1];

            r.incratio = this.computeICER(r, prev);
            if (i < 2) {
                return;
            }

            if(!prev2NotDominated){
                prev2NotDominated = arr[i - 2];
            }

            if(cmp(r.incratio,prev.incratio)){
                prev.incratio = null;
                prev.extendedDominatedBy = [prev2NotDominated.id, r.id] ;
                r.incratio = this.computeICER(r, prev2NotDominated);
            }else{
                prev2NotDominated = prev;
            }
        });

        let weightLowerBound = params.value("weightLowerBound");
        let weightUpperBound = params.value("weightUpperBound");

        //mark optimal for weight in [weightLowerBound, weightUpperBound]
        let lastLELower = null;
        rows.slice().filter(r=>!r.dominatedBy && !r.extendedDominatedBy).sort((a, b) => a.incratio - b.incratio).forEach((row, i, arr)=>{

            if(row.incratio <= weightLowerBound){
                lastLELower  = row;
            }else if(row.incratio == weightLowerBound){
                lastLELower = null;
            }

            row.optimal = row.incratio >= weightLowerBound && row.incratio <= weightUpperBound;

        });
        if(lastLELower){
            lastLELower.optimal = true;
        }

        rows.forEach(row=>{
            row.payoffs[0] =  ExpressionEngine.toFloat(row.payoffs[0]);
            row.payoffs[1] =  ExpressionEngine.toFloat(row.payoffs[1]);
            row.incratio = row.incratio === null ? null : ExpressionEngine.toFloat(row.incratio);
        });

        jobResult.data = {
            payoffNames: data.payoffNames.slice(),
            payoffCoeffs : payoffCoeffs,
            rows: rows.sort((a, b)=>(a.id - b.id)),
            weightLowerBound: ExpressionEngine.toFloat(weightLowerBound),
            weightUpperBound: ExpressionEngine.toFloat(weightUpperBound)
        };


        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }

    computeICER(r, prev){
        let d = ExpressionEngine.subtract(r.payoffs[0], prev.payoffs[0]);
        let n = ExpressionEngine.subtract(r.payoffs[1], prev.payoffs[1]);
        if (d == 0){
            if(n<0){
                return - Infinity;
            }
            return Infinity;
        }
        return Math.abs(ExpressionEngine.divide(n, d));
    }
}
