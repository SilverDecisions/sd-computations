import {PARAMETER_TYPE} from "./job-parameter-definition";
import {Utils} from "sd-utils";

export class JobParameters{
    definitions = [];
    values={};

    constructor(values){
        this.initDefinitions();
        this.initDefaultValues();
        if (values) {
            Utils.deepExtend(this.values, values);
        }
    }

    initDefinitions(){

    }

    initDefaultValues(){

    }

    validate(){
        return this.definitions.every((def, i)=>def.validate(this.values[def.name], this.values));
    }

    getDefinition(path){
        var defs =this.definitions;
        let def = null;
        if(!path.split().every(name=>{
                def = Utils.find(defs, d=>d.name == name);
                if(!def){
                    return false
                }
                defs = def.nestedParameters;
                return true;
        })){
            return null;
        }
        return def;
    }

    /*get or set value by path*/
    value(path, value){
        if (arguments.length === 1) {
            let def = this.getDefinition(path);
            let val = Utils.get(this.values, path, null);
            if(def){
                return def.value(val);
            }
            return  val;
        }
        Utils.set(this.values, path, value);
        return value;
    }

    toString(){
        var result = "JobParameters[";

        this.definitions.forEach((d, i)=> {

            var val = this.values[d.name];
            // if(Utils.isArray(val)){
            //     var values = val;
            //
            //
            // }
            // if(PARAMETER_TYPE.COMPOSITE == d.type){
            //
            // }

            result += d.name + "="+val + ";";
        });
        result+="]";
        return result;
    }

    getDTO(){
        return {
            values: this.values
        }
    }
}
