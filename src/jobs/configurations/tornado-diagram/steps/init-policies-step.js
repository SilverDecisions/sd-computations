import {Step} from "../../../engine/step";
import {JOB_STATUS} from "../../../engine/job-status";
import {PoliciesCollector} from "../../../../policies/policies-collector";
import {Utils} from "sd-utils";

export class InitPoliciesStep extends Step {
    constructor(jobRepository) {
        super("init_policies", jobRepository);
    }

    doExecute(stepExecution, result) {
        var data = stepExecution.getData();
        var params = stepExecution.getJobParameters();
        var ruleName = params.value("ruleName");
        var treeRoot = data.getRoots()[0];
        var policiesCollector = new PoliciesCollector(treeRoot);

        stepExecution.getJobExecutionContext().put("policies", policiesCollector.policies);
        stepExecution.getJobExecutionContext().put("policyByKey", Utils.getObjectByIdMap(policiesCollector.policies, null, 'key'));
        stepExecution.exitStatus = JOB_STATUS.COMPLETED;
        return stepExecution;

    }
}
