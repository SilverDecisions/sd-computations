import {ExpressionEngine} from 'sd-expression-engine'
import {Utils} from "sd-utils";


export class McdmWeightValueValidator{

    additionalValidator = null;

    constructor(additionalValidator){
        this.additionalValidator = additionalValidator;
    }

    validate(value){
        if(value===null || value === undefined){
            return false;
        }

        let parsed = parseFloat(value);
        if(parsed !== Infinity && !ExpressionEngine.validate(value, {}, false)){
            return false
        }

        value = ExpressionEngine.toNumber(value);
        var maxSafeInteger = Number.MAX_SAFE_INTEGER || 9007199254740991; // Number.MAX_SAFE_INTEGER is undefined in IE
        if(ExpressionEngine.compare(value, 0) < 0 || (value !== Infinity && ExpressionEngine.compare(value, maxSafeInteger)> 0)){
            return false;
        }

        if(this.additionalValidator) {
            return this.additionalValidator(ExpressionEngine.toNumber(value))
        }

        return true;
    }

}
