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

    /**
     * Sum of JS numbers, correctly rounded: the double nearest to the exact sum of
     * the values (ties to even), independent of their order and of cancellation.
     * Shewchuk's algorithm with the final rounding of Python's math.fsum: the
     * running sum is kept exactly as non-overlapping partials. An infinite or NaN
     * value makes the result infinite or NaN; an overflow of the exact sum gives
     * +-Infinity.
     */
    static exactSum(values) {
        var partials = [];
        var special = 0;
        for (var v = 0; v < values.length; v++) {
            var x = values[v];
            if (!isFinite(x)) {
                special += x;
                continue;
            }
            var i = 0;
            for (var j = 0; j < partials.length; j++) {
                var y = partials[j];
                if (Math.abs(x) < Math.abs(y)) {
                    var t = x;
                    x = y;
                    y = t;
                }
                var hi = x + y;
                var lo = y - (hi - x);
                if (lo !== 0) {
                    partials[i++] = lo;
                }
                x = hi;
            }
            partials.length = i;
            partials.push(x);
        }
        if (special !== 0 || isNaN(special)) {
            return special;
        }
        var n = partials.length;
        if (n === 0) {
            return 0;
        }
        var sum = partials[--n];
        var rest = 0;
        while (n > 0) {
            var a = sum;
            var b = partials[--n];
            sum = a + b;
            rest = b - (sum - a);
            if (rest !== 0) {
                break;
            }
        }
        // the rounding of sum was half-way and the next partial has the sign of
        // the remainder: round away from the tie
        if (n > 0 && ((rest < 0 && partials[n - 1] < 0) || (rest > 0 && partials[n - 1] > 0))) {
            var twice = rest * 2;
            var up = sum + twice;
            if (twice === up - sum) {
                sum = up;
            }
        }
        return sum;
    }
}
