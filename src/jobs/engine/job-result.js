import {JOB_STATUS} from "./job-status";
import {StepExecution} from "./step-execution";
import {Utils} from "sd-utils";
import {ExecutionContext} from "./execution-context";
import {JobExecution} from "./job-execution";

/*domain object representing the result of a job instance.*/
export class JobResult {
    id;
    jobInstance;
    lastUpdated = null;

    data; // job result data - this is not a data model!

    constructor(jobInstance, id, data) {
        if(id===null || id === undefined){
            this.id = Utils.guid();
        }else{
            this.id = id;
        }

        this.jobInstance = jobInstance;
        this.data = data;
    }

    getDTO(filteredProperties=[], deepClone = true){

        var cloneMethod = Utils.cloneDeepWith;
        if(!deepClone) {
            cloneMethod = Utils.cloneWith;
        }

        let dto = Utils.assign({}, cloneMethod(this, (value, key, object, stack)=> {
            if(filteredProperties.indexOf(key)>-1){
                return null;
            }

            if(value && value.$ObjectWithIdAndEditableFields && value.id){
                return {
                    '$ObjectWithIdAndEditableFields': true,
                    id: value.id
                }
            }

            if(value instanceof Error){
                return Utils.getErrorDTO(value);
            }
        }));

        return dto
    }
}
