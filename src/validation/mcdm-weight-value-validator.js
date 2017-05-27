import {ExpressionEngine} from 'sd-expression-engine'
import {Utils} from "sd-utils";


export class McdmWeightValueValidator{
    expressionEngine;
    constructor(expressionEngine){
        this.expressionEngine=expressionEngine;
    }

    validate(value){

        if(value===null || value === undefined){
            return false;
        }
        let parsed = parseFloat(value);
        if(parsed === Infinity) {
            return true;
        }
        if(parsed === -Infinity){
            return false;
        }

        if(!ExpressionEngine.validate(value, {})){
            return false
        }

        value = ExpressionEngine.toNumber(value);
        var maxSafeInteger = Number.MAX_SAFE_INTEGER || 9007199254740991; // Number.MAX_SAFE_INTEGER in undefined in IE
        return ExpressionEngine.compare(value, 0) >= 0 && ExpressionEngine.compare(value, maxSafeInteger) <= 0;
    }

}
