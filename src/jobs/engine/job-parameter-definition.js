import {Utils} from "sd-utils";
import {ExpressionEngine} from "sd-expression-engine";

export const PARAMETER_TYPE = {
    STRING: 'STRING',
    DATE: 'DATE',
    INTEGER: 'INTEGER',
    NUMBER: 'FLOAT',
    BOOLEAN: 'BOOLEAN',
    NUMBER_EXPRESSION: 'NUMBER_EXPRESSION',
    COMPOSITE: 'COMPOSITE' //composite parameter with nested subparameters
};

export class JobParameterDefinition {
    name;
    type;
    nestedParameters = [];
    minOccurs;
    maxOccurs;
    required = true;

    identifying;
    validator;
    singleValueValidator;

    constructor(name, typeOrNestedParametersDefinitions, minOccurs = 1, maxOccurs = 1, identifying = false, singleValueValidator = null, validator = null) {
        this.name = name;
        if (Utils.isArray(typeOrNestedParametersDefinitions)) {
            this.type = PARAMETER_TYPE.COMPOSITE;
            this.nestedParameters = typeOrNestedParametersDefinitions;
        } else {
            this.type = typeOrNestedParametersDefinitions;
        }
        this.validator = validator;
        this.singleValueValidator = singleValueValidator;
        this.identifying = identifying;
        this.minOccurs = minOccurs;
        this.maxOccurs = maxOccurs;
    }

    set(key, val) {
        this[key] = val;
        return this;
    }

    validate(value, allValues) {
        var isArray = Utils.isArray(value);

        if (this.maxOccurs > 1 && !isArray) {
            return false;
        }

        if (!isArray) {
            return this.validateSingleValue(value, allValues)
        }

        if (value.length < this.minOccurs || value.length > this.maxOccurs) {
            return false;
        }

        if (!value.every(v=>this.validateSingleValue(v, value))) {
            return false;
        }

        if (this.validator) {
            return this.validator(value, allValues);
        }

        return true;
    }

    static computeNumberExpression(val){
        let parsed = parseFloat(val);
        if(parsed === Infinity || parsed === -Infinity) {
            return parsed;
        }

        if(!ExpressionEngine.validate(val, {}, false)){
            return null
        }

        return ExpressionEngine.eval(val, true)
    }

    // allValues - all values on the same level
    validateSingleValue(value, allValues) {
        if ((value === null || value === undefined) && this.minOccurs > 0) {
            return false
        }

        if (this.required && (!value && value !== 0 && value !== false)) {
            return false;
        }

        if (PARAMETER_TYPE.STRING === this.type && !Utils.isString(value)) {
            return false;
        }
        if (PARAMETER_TYPE.DATE === this.type && !Utils.isDate(value)) {
            return false;
        }
        if (PARAMETER_TYPE.INTEGER === this.type && !Utils.isInt(value)) {
            return false;
        }
        if (PARAMETER_TYPE.NUMBER === this.type && !Utils.isNumber(value)) {
            return false;
        }

        if (PARAMETER_TYPE.BOOLEAN === this.type && !Utils.isBoolean(value)) {
            return false;
        }


        if (PARAMETER_TYPE.NUMBER_EXPRESSION === this.type) {
            value = JobParameterDefinition.computeNumberExpression(value);
            if(value === null){
                return false
            }
        }

        if (PARAMETER_TYPE.COMPOSITE === this.type) {
            if (!Utils.isObject(value)) {
                return false;
            }
            if (!this.nestedParameters.every((nestedDef, i)=>nestedDef.validate(value[nestedDef.name]))) {
                return false;
            }
        }

        if (this.singleValueValidator) {
            return this.singleValueValidator(value, allValues);
        }

        return true;
    }

    value(value){
        if(PARAMETER_TYPE.NUMBER_EXPRESSION === this.type) {
            return JobParameterDefinition.computeNumberExpression(value);
        }

        return value;
    }
}
