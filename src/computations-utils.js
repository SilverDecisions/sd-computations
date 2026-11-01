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
     * An infinite or NaN value makes the result infinite or NaN; an exact sum
     * beyond the double range gives +-Infinity.
     */
    static exactSum(values) {
        var scaled = ComputationsUtils._scaledSum(values);
        return scaled.special !== null ? scaled.special : ComputationsUtils._scale(scaled.sum, scaled.k);
    }

    /**
     * Mean of JS numbers: the exact sum of the values (correctly rounded, at a scale
     * where it cannot overflow) divided by count, so the result is finite whenever
     * the exact mean is, and within one rounding of the correctly rounded mean,
     * independent of the order of the values. count defaults to values.length.
     */
    static exactMean(values, count) {
        if (count === undefined) {
            count = values.length;
        }
        var scaled = ComputationsUtils._scaledSum(values);
        if (scaled.special !== null) {
            return scaled.special;
        }
        return ComputationsUtils._scale(scaled.sum / count, scaled.k);
    }

    // x * 2^k in steps that cannot overflow or underflow before the end
    static _scale(x, k) {
        while (k !== 0) {
            var step = Math.max(-1000, Math.min(1000, k));
            x *= Math.pow(2, step);
            k -= step;
        }
        return x;
    }

    // Shewchuk's algorithm with the final rounding of Python's math.fsum: the running
    // sum is kept exactly as non-overlapping partials. Every partial and every
    // intermediate sum is bounded by the sum of the absolute values; when that bound
    // could exceed the double range, all values are multiplied by 2^-k first (exact,
    // except for values below 2^(k-1022), whose contribution is below 2^(k-1074)
    // each). Returns {special} for infinite / NaN input, otherwise {sum, k}: the
    // correctly rounded sum of the values times 2^-k.
    static _scaledSum(values) {
        var special = 0;
        var max = 0;
        var i, j;
        for (i = 0; i < values.length; i++) {
            var v = values[i];
            if (!isFinite(v)) {
                special += v;
            } else if (Math.abs(v) > max) {
                max = Math.abs(v);
            }
        }
        if (special !== 0 || isNaN(special)) {
            return {special: special};
        }
        var k = 0;
        // n * max bounds the partials; keep it below 2^1000 (Number.MAX_VALUE is about 2^1024)
        while (ComputationsUtils._scale(max, -k) * values.length > Math.pow(2, 1000)) {
            k += 64;
        }
        var partials = [];
        for (i = 0; i < values.length; i++) {
            var x = ComputationsUtils._scale(values[i], -k);
            var p = 0;
            for (j = 0; j < partials.length; j++) {
                var y = partials[j];
                if (Math.abs(x) < Math.abs(y)) {
                    var t = x;
                    x = y;
                    y = t;
                }
                var hi = x + y;
                var lo = y - (hi - x);
                if (lo !== 0) {
                    partials[p++] = lo;
                }
                x = hi;
            }
            partials.length = p;
            partials.push(x);
        }
        var n = partials.length;
        if (n === 0) {
            return {special: null, sum: 0, k: k};
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
        // the rounding of sum was half-way and the next partial has the sign of the
        // remainder: round away from the tie
        if (n > 0 && ((rest < 0 && partials[n - 1] < 0) || (rest > 0 && partials[n - 1] > 0))) {
            var twice = rest * 2;
            var up = sum + twice;
            if (twice === up - sum) {
                sum = up;
            }
        }
        return {special: null, sum: sum, k: k};
    }
}
