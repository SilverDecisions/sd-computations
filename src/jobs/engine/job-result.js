import {JOB_STATUS} from "./job-status";
import {StepExecution} from "./step-execution";
import {Utils} from "sd-utils";
import {ExecutionContext} from "./execution-context";

/*domain object representing the result of a job instance.*/
export class JobResult {
    id;
    jobInstance;
    lastUpdated = null;

    data;

    constructor(jobInstance, id) {
        if(id===null || id === undefined){
            this.id = Utils.guid();
        }else{
            this.id = id;
        }

        this.jobInstance = jobInstance;
    }
}
