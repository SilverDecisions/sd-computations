


/*Base class for complex operations executing a job*/
import {Operation} from "./operation";

export class JobExecutingOperation extends Operation{


    jobName; //Job name if this operation executes a job

    constructor(name, jobName = null){
        super(name);

        this.name = name;
        this.jobName = jobName;
    }


    //check if can perform operation for applicable object
    canPerform(object, params){

        throw 'canPerform function not implemented for operation: '+this.name
    }

    //Performed in job by operations manager
    perform(object, params, ){

    }


    postProcess(object, params){

    }


}
