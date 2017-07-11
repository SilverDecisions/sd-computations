import {PoliciesCollector} from '../src/policies/policies-collector'
import {ExpressionEngine} from "sd-expression-engine";
import {DataModel} from "sd-model";
import {ComputationsManager} from '../src/computations-manager'

import {JobParameters} from "../src/jobs/engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../src/jobs/engine/job-parameter-definition";


describe("Job paramter value of type", () => {

    let definition;
    let val = {};

    let createDefinition =  type => definition =  new JobParameterDefinition("param", type);
    let setValue = value => val[definition.name] = value;
    let validate = (value) => {
        setValue(value);
        return definition.validate(val[definition.name], val);
    };

    describe(PARAMETER_TYPE.STRING, function () {

        beforeAll(()=>createDefinition(PARAMETER_TYPE.STRING));

        it("should be valid for strings", function () {
            expect(validate("foo")).toBeTruthy();
        });

        it("should be invalid for non strings", function () {
            expect(validate(3.14)).toBeFalsy();
            expect(validate(new Date())).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.DATE, function () {

        beforeAll(()=>createDefinition(PARAMETER_TYPE.DATE));

        it("should be valid for date", function () {
            expect(validate(new Date())).toBeTruthy();
        });

        it("should be invalid for non dates", function () {
            expect(validate(3.14)).toBeFalsy();
            expect(validate("foo")).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.BOOLEAN, function () {
        beforeAll(()=>createDefinition(PARAMETER_TYPE.BOOLEAN));


        it("should be valid for booleans", function () {
            expect(validate(false)).toBeTruthy();
            expect(validate(true)).toBeTruthy();
        });

        it("should be invalid for non booleans", function () {
            expect(validate(3.14)).toBeFalsy();
            expect(validate("foo")).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.INTEGER, function () {
        beforeAll(()=>createDefinition(PARAMETER_TYPE.INTEGER));

        it("should be valid for integers", function () {
            expect(validate(123)).toBeTruthy();
            expect(validate(-123)).toBeTruthy();
        });

        it("should be invalid for floats", function () {
            expect(validate(3.14)).toBeFalsy();
        });

        it("should be invalid for non numbers", function () {
            expect(validate("foo")).toBeFalsy();
            expect(validate("[1,2,3]")).toBeFalsy();
            expect(validate("1+1")).toBeFalsy();
            expect(validate("2/234")).toBeFalsy();
            expect(validate("random()")).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.NUMBER, function () {
        beforeAll(()=>createDefinition(PARAMETER_TYPE.NUMBER));

        it("should be valid for number", function () {
            expect(validate(123)).toBeTruthy();
            expect(validate(-123)).toBeTruthy();
            expect(validate(3.14)).toBeTruthy();
        });

        it("should be invalid for non numbers", function () {
            expect(validate("foo")).toBeFalsy();
            expect(validate("[1,2,3]")).toBeFalsy();
            expect(validate("1+1")).toBeFalsy();
            expect(validate("2/234")).toBeFalsy();
            expect(validate("random()")).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.NUMBER_EXPRESSION, function () {
        beforeAll(()=>createDefinition(PARAMETER_TYPE.NUMBER_EXPRESSION));

        it("should be valid for numbers", function () {
            expect(validate(1)).toBeTruthy();
            expect(validate("131.312312")).toBeTruthy();
        });

        it("should be valid for number expressions", function () {
            expect(validate("1+1")).toBeTruthy();
            expect(validate("2/234")).toBeTruthy();
            expect(validate("random()")).toBeTruthy();
            expect(validate("Uniform(0.0,1.0)")).toBeTruthy();
        });

        it("should be invalid for non number expressions", function () {
            expect(validate("foo")).toBeFalsy();
            expect(validate("[1,2,3]")).toBeFalsy();
        });

    });

    describe(PARAMETER_TYPE.COMPOSITE, function () {
        beforeAll(()=>{
            definition =  new JobParameterDefinition("param", [
                    new JobParameterDefinition("string", PARAMETER_TYPE.STRING),
                    new JobParameterDefinition("number_expression", PARAMETER_TYPE.NUMBER_EXPRESSION),

                    new JobParameterDefinition("composite", [
                        new JobParameterDefinition("number", PARAMETER_TYPE.NUMBER),
                        new JobParameterDefinition("boolean", PARAMETER_TYPE.BOOLEAN)
                    ])

                ])
        });

        it("should be valid", function () {
            expect(validate({
                "string": "foo",
                "number_expression": "random()",
                "composite": {
                    "number": 1,
                    "boolean": true
                }
            })).toBeTruthy();

        });

        it("should be invalid", function () {
            expect(validate({
                "string": "foo",
            })).toBeFalsy();

            expect(validate({
                "string": "foo",
                "number_expression": new Date(),
                "composite": {
                    "number": 1,
                    "boolean": "asd"
                }
            })).toBeFalsy();
        });

    })

});

