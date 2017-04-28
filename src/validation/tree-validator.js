import {domain as model, ValidationResult} from "sd-model";
import {ExpressionEngine} from "sd-expression-engine";
import {ProbabilityValueValidator} from "./probability-value-validator";
import {PayoffValueValidator} from "./payoff-value-validator";

export class TreeValidator {

    expressionEngine;

    constructor(expressionEngine) {
        this.expressionEngine = expressionEngine;
        this.probabilityValueValidator = new ProbabilityValueValidator(expressionEngine);
        this.payoffValueValidator = new PayoffValueValidator(expressionEngine);
    }

    validate(nodes) {

        var validationResult = new ValidationResult();

        nodes.forEach(n=> {
            this.validateNode(n, validationResult);
        });

        return validationResult;
    }

    validateNode(node, validationResult = new ValidationResult()) {

        if (node instanceof model.TerminalNode) {
            return;
        }
        if (!node.childEdges.length) {
            validationResult.addError('incompletePath', node)
        }

        var probabilitySum = ExpressionEngine.toNumber(0);
        var withHash = false;
        node.childEdges.forEach((e, i)=> {
            e.setValueValidity('probability', true);

            if (node instanceof model.ChanceNode) {
                var probability = e.computedBaseProbability();
                if (!this.probabilityValueValidator.validate(probability)) {
                    if (!ExpressionEngine.isHash(e.probability)) {
                        validationResult.addError({name: 'invalidProbability', data: {'number': i + 1}}, node);
                        e.setValueValidity('probability', false);
                    }

                } else {
                    probabilitySum = ExpressionEngine.add(probabilitySum, probability);
                }
            }

            e.payoff.forEach((rawPayoff, payoffIndex)=> {
                var path = 'payoff[' + payoffIndex + ']';
                e.setValueValidity(path, true);
                var payoff = e.computedBasePayoff(undefined, payoffIndex);
                if (!this.payoffValueValidator.validate(payoff)) {
                    validationResult.addError({name: 'invalidPayoff', data: {'number': i + 1}}, node);
                    e.setValueValidity(path, false);
                }
            })


        });
        if (node instanceof model.ChanceNode) {
            if (isNaN(probabilitySum) || !probabilitySum.equals(1)) {
                validationResult.addError('probabilityDoNotSumUpTo1', node);
            }
        }


        return validationResult;
    }
}
