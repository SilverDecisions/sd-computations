import {Utils} from "sd-utils";
import {DataModel} from "sd-model";
import {StepExecution} from "./step-execution";

export class ExecutionContext {

    dirty = false;
    context = {};

    constructor(context) {
        if (context) {
            this.context = Utils.clone(context)
        }
    }

    put(key, value) {
        var prevValue = this.context[key];
        if (value != null) {
            var result = this.context[key] = value;
            this.dirty = prevValue == null || prevValue != null && prevValue != value;
        }
        else {
            delete this.context[key];
            this.dirty = prevValue != null;
        }
    }

    get(key) {
        return this.context[key];
    }

    containsKey(key) {
        return this.context.hasOwnProperty(key);
    }

    remove(key) {
        delete this.context[key];
    }

    setData(data) { //set data model
        return this.put("data", data);
    }

    getData() { // get data model
        return this.get("data");
    }


    getDTO(filteredProperties = [], deepClone = true) {
        var cloneMethod = Utils.cloneDeepWith;
        if (!deepClone) {
            cloneMethod = Utils.cloneWith;
        }


        let dto = Utils.assign({}, cloneMethod(this, (value, key, object, stack)=> {
            if (filteredProperties.indexOf(key) > -1) {
                return null;
            }

            if (value instanceof DataModel) {
                return value.getDTO()
            }

            if(value && value.$ObjectWithIdAndEditableFields && value.id && this.getData().findById(value.id)){
                return {
                    '$ObjectWithIdAndEditableFields': true,
                    id: value.id
                }
            }

            if (value instanceof Error) {
                return Utils.getErrorDTO(value);
            }

        }));

        return dto
    }

}
