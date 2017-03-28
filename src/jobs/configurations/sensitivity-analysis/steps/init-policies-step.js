import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {PoliciesCollector} from "../../../../policies/policies-collector";

export class InitPoliciesStep extends Step {
    constructor(jobRepository) {
        super("init_policies", jobRepository);
    }

    doExecute(stepExecution, result) {
        var data = stepExecution.getData();
        var treeRoot = data.getRoots()[0];
        var policiesCollector = new PoliciesCollector(treeRoot);

        var policies = policiesCollector.policies;
        stepExecution.getJobExecutionContext().put("policies", policies);

        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;
    }
}
