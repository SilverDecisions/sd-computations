import {Utils} from "sd-utils";
import {JobParameters} from "../../../engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../../../engine/job-parameter-definition";
export class ProbabilisticSensitivityAnalysisJobParameters extends JobParameters {

    initDefinitions() {
        this.definitions.push(new JobParameterDefinition("id", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("ruleName", PARAMETER_TYPE.STRING));
        this.definitions.push(new JobParameterDefinition("failOnInvalidTree", PARAMETER_TYPE.BOOLEAN));
        this.definitions.push(new JobParameterDefinition("extendedPolicyDescription", PARAMETER_TYPE.BOOLEAN));
        this.definitions.push(new JobParameterDefinition("numberOfRuns", PARAMETER_TYPE.INTEGER).set("singleValueValidator", v => v > 0));

        this.definitions.push(new JobParameterDefinition("variables", [
                new JobParameterDefinition("name", PARAMETER_TYPE.STRING),
                new JobParameterDefinition("formula", PARAMETER_TYPE.NUMBER_EXPRESSION)
            ], 1, Infinity, false,
            null,
            values => Utils.isUnique(values, v=>v["name"]) //Variable names should be unique
        ))
    }

    initDefaultValues() {
        this.values = {
            id: Utils.guid(),
            extendedPolicyDescription: true,
            failOnInvalidTree: true
        }
    }
}
