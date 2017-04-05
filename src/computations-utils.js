import {ExpressionEngine} from "sd-expression-engine";
export class ComputationsUtils{

    static sequence(min, max, length) {
        var extent = ExpressionEngine.subtract(max, min);
        var result = [min];
        var steps = length - 1;
        if(!steps){
            return result;
        }
        var step = ExpressionEngine.divide(extent,length - 1);
        var curr = min;
        for (var i = 0; i < length - 2; i++) {
            curr = ExpressionEngine.add(curr, step);
            result.push(ExpressionEngine.toFloat(curr));
        }
        result.push(max);
        return result;
    }
}
