import {Utils} from "sd-utils";
import {JobParameters} from "../../engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../../engine/job-parameter-definition";

export class LeagueTableJobParameters extends JobParameters {

    initDefinitions() {
        this.definitions.push(new JobParameterDefinition("id", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("ruleName", PARAMETER_TYPE.STRING));
        this.definitions.push(new JobParameterDefinition("extendedPolicyDescription", PARAMETER_TYPE.BOOLEAN));
        this.definitions.push(new JobParameterDefinition("weightLowerBound", PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", (v, allVals) => {
            return v >= 0 && v <= JobParameterDefinition.computeNumberExpression(allVals['weightUpperBound'])
        }));
        this.definitions.push(new JobParameterDefinition("defaultWeight", PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", (v, allVals) => {
            return v >= 0 && v >= JobParameterDefinition.computeNumberExpression(allVals['weightLowerBound']) && v <= JobParameterDefinition.computeNumberExpression(allVals['weightUpperBound'])
        }));
        this.definitions.push(new JobParameterDefinition("weightUpperBound", PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", (v, allVals) => {
            return v >= 0 && v >= JobParameterDefinition.computeNumberExpression(allVals['weightLowerBound'])
        }));

    }


    initDefaultValues() {
        this.values = {
            id: Utils.guid(),
            nameOfCriterion1: 'Cost',
            nameOfCriterion2: 'Effect',
            extendedPolicyDescription: true,
            weightLowerBound: 0,
            defaultWeight: 0,
            weightUpperBound: Infinity,
        }
    }
}
