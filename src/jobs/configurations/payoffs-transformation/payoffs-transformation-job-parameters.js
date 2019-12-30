import {Utils} from "sd-utils";
import {JobParameters} from "../../engine/job-parameters";
import {JobParameterDefinition, PARAMETER_TYPE} from "../../engine/job-parameter-definition";
export class PayoffsTransformationJobParameters extends JobParameters {

    initDefinitions() {
        this.definitions.push(new JobParameterDefinition("id", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("objectId", PARAMETER_TYPE.STRING, 1, 1, true));
        this.definitions.push(new JobParameterDefinition("functionName", PARAMETER_TYPE.STRING).set('required', true));
        this.definitions.push(new JobParameterDefinition("functionBody", PARAMETER_TYPE.STRING).set('required', true));
        this.definitions.push(new JobParameterDefinition("functionArgumentName", PARAMETER_TYPE.STRING).set('required', true));
        this.definitions.push(new JobParameterDefinition("makeClone", PARAMETER_TYPE.BOOLEAN));
    }

    initDefaultValues() {
        this.values = {
            id: Utils.guid(),
            functionName: 'transformPayoff',
            functionBody: 'log(p)',
            functionArgumentName: 'p',
            makeClone: true
        }
    }
}
