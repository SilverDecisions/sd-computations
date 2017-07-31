import {Utils} from "sd-utils";
import {JobParameters} from "../../../engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../../../engine/job-parameter-definition";
export class SpiderPlotJobParameters extends JobParameters {

    initDefinitions() {
        this.definitions.push(new JobParameterDefinition("id", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("ruleName", PARAMETER_TYPE.STRING));
        this.definitions.push(new JobParameterDefinition("percentageChangeRange", PARAMETER_TYPE.NUMBER).set("singleValueValidator", v => v > 0 && v <=100));
        this.definitions.push(new JobParameterDefinition("length", PARAMETER_TYPE.INTEGER).set("singleValueValidator", v => v >= 0 && v % 2)); //length should be odd
        this.definitions.push(new JobParameterDefinition("variables", [
                new JobParameterDefinition("name", PARAMETER_TYPE.STRING),
            ], 1, Infinity, false,
            null,
            values => Utils.isUnique(values, v=>v["name"]) //Variable names should be unique
        ));
        this.definitions.push(new JobParameterDefinition("failOnInvalidTree", PARAMETER_TYPE.BOOLEAN));
    }

    initDefaultValues() {
        this.values = {
            id: Utils.guid(),
            failOnInvalidTree: true
        }
    }
}
