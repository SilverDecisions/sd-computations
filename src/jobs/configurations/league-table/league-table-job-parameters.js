import {Utils} from "sd-utils";
import {JobParameters} from "../../engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../../engine/job-parameter-definition";

export class LeagueTableJobParameters extends JobParameters {

    initDefinitions() {
        this.definitions.push(new JobParameterDefinition("id", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("ruleName", PARAMETER_TYPE.STRING));
        this.definitions.push(new JobParameterDefinition("extendedPolicyDescription", PARAMETER_TYPE.BOOLEAN));
        // this.definitions.push(new JobParameterDefinition("minimumWTP", PARAMETER_TYPE.NUMBER).set("singleValueValidator", (v, allVals) => v >= 0 && v <= allVals['maximumWTP']));
        // this.definitions.push(new JobParameterDefinition("maximumWTP", PARAMETER_TYPE.NUMBER).set("singleValueValidator", (v, allVals) => v >= 0 && v >= allVals['minimumWTP']));

    }

    initDefaultValues() {
        this.values = {
            id: Utils.guid(),
            nameOfCriterion1: 'Cost',
            nameOfCriterion2: 'Effect',
            extendedPolicyDescription: true,
            minimumWTP: 0,
            maximumWTP: Infinity,
        }
    }
}
