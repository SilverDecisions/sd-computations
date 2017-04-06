import {JOB_STATUS} from "../job-status";
import {log} from 'sd-utils'
import {Step} from "../step";
import {JobInterruptedException} from "../exceptions/job-interrupted-exception";

/*job step that process batch of items*/
export class BatchStep extends Step {

    chunkSize;
    static CURRENT_ITEM_COUNT_PROP = 'batch_step_current_item_count';
    static TOTAL_ITEM_COUNT_PROP = 'batch_step_total_item_count';

    constructor(name, jobRepository, chunkSize) {
        super(name, jobRepository);
        this.chunkSize = chunkSize;
    }

    /**
     * Extension point for subclasses to perform step initialization. Should return total item count
     */
    init(stepExecution, jobResult) {
        throw "BatchStep.init function not implemented for step: " + this.name;
    }

    /**
     * Extension point for subclasses to read and return chunk of items to process
     */
    readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
        throw "BatchStep.readNextChunk function not implemented for step: " + this.name;
    }

    /**
     * Extension point for subclasses to process single item
     * Must return processed item which will be passed in a chunk to writeChunk function
     */
    processItem(stepExecution, item, currentItemCount, jobResult) {
        throw "BatchStep.processItem function not implemented for step: " + this.name;
    }

    /**
     * Extension point for subclasses to write chunk of items. Not required
     */
    writeChunk(stepExecution, items, jobResult) {
    }

    /**
     * Extension point for subclasses to perform postprocessing after all items have been processed. Not required
     */
    postProcess(stepExecution, jobResult) {
    }


    setTotalItemCount(stepExecution, count) {
        stepExecution.executionContext.put(BatchStep.TOTAL_ITEM_COUNT_PROP, count);
    }

    getTotalItemCount(stepExecution) {
        return stepExecution.executionContext.get(BatchStep.TOTAL_ITEM_COUNT_PROP);
    }

    setCurrentItemCount(stepExecution, count) {
        stepExecution.executionContext.put(BatchStep.CURRENT_ITEM_COUNT_PROP, count);
    }

    getCurrentItemCount(stepExecution) {
        return stepExecution.executionContext.get(BatchStep.CURRENT_ITEM_COUNT_PROP) || 0;
    }


    doExecute(stepExecution, jobResult) {
        return Promise.resolve().then(()=> {
            return this.init(stepExecution, jobResult)
        }).catch(e=> {
            log.error("Failed to initialize batch step: " + this.name, e);
            throw e;
        }).then(totalItemCount=> {
            return Promise.resolve().then(()=>{
                this.setCurrentItemCount(stepExecution, this.getCurrentItemCount(stepExecution));
                this.setTotalItemCount(stepExecution, totalItemCount);
                return this.handleNextChunk(stepExecution, jobResult)
            }).catch(e=> {
                if(!(e instanceof JobInterruptedException)){
                    log.error("Failed to handle batch step: " + this.name, e);
                }
                throw e;
            })
        }).then(()=> {
            return Promise.resolve().then(()=>{
                return this.postProcess(stepExecution, jobResult)
            }).catch(e=> {
                log.error("Failed to postProcess batch step: " + this.name, e);
                throw e;
            })
        }).then(()=> {
            stepExecution.exitStatus = JOB_STATUS.COMPLETED;
            return stepExecution;
        })

    }

    handleNextChunk(stepExecution, jobResult) {
        var currentItemCount = this.getCurrentItemCount(stepExecution);
        var totalItemCount = this.getTotalItemCount(stepExecution);
        var chunkSize = Math.min(this.chunkSize, totalItemCount - currentItemCount);
        if (currentItemCount >= totalItemCount) {
            return stepExecution;
        }
        return this.checkJobExecutionFlags(stepExecution).then(()=> {
            // Check if someone is trying to stop us
            if (stepExecution.terminateOnly) {
                throw new JobInterruptedException("JobExecution interrupted.");
            }
            return stepExecution
        }).then(()=> {
            return Promise.resolve().then(()=>{
                return this.readNextChunk(stepExecution, currentItemCount, chunkSize, jobResult)
            }).catch(e=> {
                log.error("Failed to read chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + this.name, e);
                throw e;
            });
        }).then(chunk=> {
            return Promise.resolve().then(()=>{
                return this.processChunk(stepExecution, chunk, currentItemCount, jobResult)
            }).catch(e=> {
                log.error("Failed to process chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + this.name, e);
                throw e;
            })
        }).then(processedChunk=> {
            return Promise.resolve().then(()=>{
                return this.writeChunk(stepExecution, processedChunk, jobResult)
            }).catch(e=> {
                log.error("Failed to write chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + this.name, e);
                throw e;
            })
        }).then((res)=> {
            currentItemCount += chunkSize;
            this.setCurrentItemCount(stepExecution, currentItemCount);
            return this.updateJobProgress(stepExecution).then(()=> {
                return this.handleNextChunk(stepExecution, jobResult);
            });
        })
    }

    processChunk(stepExecution, chunk, currentItemCount, jobResult) { //TODO promisify
        return chunk.map((item, i)=>this.processItem(stepExecution, item, currentItemCount+i, jobResult));
    }

    /*Should return progress object with fields:
     * current
     * total */
    getProgress(stepExecution){
        return {
            total: this.getTotalItemCount(stepExecution),
            current: this.getCurrentItemCount(stepExecution)
        }
    }

    updateJobProgress(stepExecution) {
        var progress = this.jobRepository.getJobByName(stepExecution.jobExecution.jobInstance.jobName).getProgress(stepExecution.jobExecution);
        return this.jobRepository.updateJobExecutionProgress(stepExecution.jobExecution.id, progress);
    }

    checkJobExecutionFlags(stepExecution){
        return this.jobRepository.getJobByName(stepExecution.jobExecution.jobInstance.jobName).checkExecutionFlags(stepExecution.jobExecution);
    }
}
