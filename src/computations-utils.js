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
     * the values (ties to even), independent of their order, of cancellation and of
     * the magnitudes of the terms. An exact sum beyond the double range gives
     * +-Infinity; infinite or NaN values give the IEEE result of their sum
     * (+-Infinity or NaN).
     */
    static exactSum(values) {
        var acc = ComputationsUtils._accumulate(values);
        if (acc.special !== null) {
            return acc.special;
        }
        return ComputationsUtils._round(acc.digits, acc.negative, 0, false);
    }

    /**
     * Mean of JS numbers: the double nearest to (exact sum of the values) / count,
     * ties to even (a single rounding), so it is finite whenever that mean is in the
     * double range, independent of the order of the values. count: a positive
     * integer up to 2^52, defaults to values.length; another count gives
     * exactSum(values) / count (two roundings).
     */
    static exactMean(values, count) {
        if (count === undefined) {
            count = values.length;
        }
        if (!(count >= 1 && count <= ComputationsUtils._TWO_52 && Math.floor(count) === count)) {
            return ComputationsUtils.exactSum(values) / count;
        }
        var acc = ComputationsUtils._accumulate(values);
        if (acc.special !== null) {
            return acc.special;
        }
        // long division of the digits by count, bit by bit (the remainder stays below
        // count <= 2^52), with one more digit below 2^-1074 for the rounding; a
        // non-zero remainder is the sticky bit
        var digits = acc.digits;
        var quotient = new Array(digits.length + 1);
        var remainder = 0;
        for (var j = digits.length; j >= 0; j--) {
            var digit = j > 0 ? digits[j - 1] : 0;
            var q = 0;
            for (var weight = ComputationsUtils._DIGIT / 2; weight >= 1; weight /= 2) {
                var b = digit >= weight ? 1 : 0;
                digit -= b * weight;
                remainder = remainder * 2 + b;
                q *= 2;
                if (remainder >= count) {
                    remainder -= count;
                    q += 1;
                }
            }
            quotient[j] = q;
        }
        return ComputationsUtils._round(quotient, acc.negative, 1, remainder !== 0);
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

    // Exact fixed-point accumulation. Every finite double is m * 2^(s - 1074) with
    // integers m < 2^53 and 0 <= s <= 2045, so the sum of the values is A * 2^-1074
    // for an integer A of at most 2098 + log2(n) bits. A is kept as digits of base
    // 2^24 (JS numbers; exact integers below 2^53, negative digits allowed between
    // normalizations), least significant first. Returns {special} when a value is
    // infinite or NaN, otherwise {negative, digits} with the normalized digits of |A|.
    static _accumulate(values) {
        var DIGIT = ComputationsUtils._DIGIT;
        var BITS = ComputationsUtils._DIGIT_BITS;
        var digits = [];
        var i;
        for (i = 0; i < ComputationsUtils._DIGITS; i++) {
            digits.push(0);
        }
        var view = new DataView(new ArrayBuffer(8));
        var special = 0;
        var pending = 0;
        for (i = 0; i < values.length; i++) {
            var v = values[i];
            if (!isFinite(v)) {
                special += v;
                continue;
            }
            if (v === 0) {
                continue;
            }
            view.setFloat64(0, v);
            var high = view.getUint32(0);
            var exponent = (high >>> 20) & 0x7ff;
            var m = (high & 0xfffff) * 4294967296 + view.getUint32(4);
            if (exponent !== 0) {
                m += ComputationsUtils._TWO_52;
            }
            var s = exponent !== 0 ? exponent - 1 : 0;
            var j = Math.floor(s / BITS);
            var r = s - j * BITS;
            // m * 2^r split into three digits (m % 2^(24-r) and the divisions are exact)
            var low = Math.pow(2, BITS - r);
            var rest = Math.floor(m / low);
            var d0 = (m % low) * Math.pow(2, r);
            var d1 = rest % DIGIT;
            var d2 = Math.floor(rest / DIGIT);
            if (high >>> 31) {
                d0 = -d0;
                d1 = -d1;
                d2 = -d2;
            }
            digits[j] += d0;
            digits[j + 1] += d1;
            digits[j + 2] += d2;
            // |digit| grows by less than 2^29 per value: normalize long before 2^53
            if (++pending === 1048576) {
                ComputationsUtils._normalize(digits);
                pending = 0;
            }
        }
        if (special !== 0 || isNaN(special)) {
            return {special: special};
        }
        ComputationsUtils._normalize(digits);
        var negative = digits[digits.length - 1] < 0;
        if (negative) {
            for (i = 0; i < digits.length; i++) {
                digits[i] = -digits[i];
            }
            ComputationsUtils._normalize(digits);
        }
        return {special: null, negative: negative, digits: digits};
    }

    // carries: every digit but the last in [0, 2^24), the last one keeps the sign
    static _normalize(digits) {
        var DIGIT = ComputationsUtils._DIGIT;
        var carry = 0;
        for (var j = 0; j < digits.length - 1; j++) {
            var x = digits[j] + carry;
            carry = Math.floor(x / DIGIT);
            digits[j] = x - carry * DIGIT;
        }
        digits[digits.length - 1] += carry;
    }

    // The double nearest to +-(D + delta) * 2^(-1074 - 24 * fractionDigits), ties to
    // even, where D is given by normalized digits and 0 <= delta < 1 is non-zero iff
    // sticky. The result keeps 53 significant bits, or fewer below 2^-1022
    // (subnormal); beyond the range it is +-Infinity.
    static _round(digits, negative, fractionDigits, sticky) {
        var BITS = ComputationsUtils._DIGIT_BITS;
        var top = digits.length - 1;
        while (top >= 0 && digits[top] === 0) {
            top--;
        }
        if (top < 0) {
            // D = 0: an exact 0 is +0; a non-zero delta * 2^(-1074 - 24 * fractionDigits) is below
            // half of 2^-1074 when fractionDigits > 0 and rounds to a zero of its sign
            return negative && sticky ? -0 : 0;
        }
        var bits = top * BITS;
        while (Math.pow(2, bits - top * BITS) <= digits[top]) {
            bits++;
        }
        // position of the lowest kept bit: 53 significant bits, at least 2^-1074
        var shift = Math.max(bits - 53, BITS * fractionDigits);
        var js = Math.floor(shift / BITS);
        var q = 0;
        for (var j = top; j >= js; j--) {
            if (j > js) {
                q += digits[j] * Math.pow(2, j * BITS - shift);
            } else {
                q += Math.floor(digits[j] / Math.pow(2, shift - j * BITS));
            }
        }
        if (shift > 0) {
            // compare the bits below shift with half of 2^shift
            var hb = shift - 1;
            var jh = Math.floor(hb / BITS);
            var rh = hb - jh * BITS;
            var t = jh <= top ? digits[jh] % Math.pow(2, rh + 1) : 0;
            var half = Math.pow(2, rh);
            var cmp = t > half ? 1 : t < half ? -1 : 0;
            if (cmp === 0) {
                var below = sticky;
                for (var k = 0; k < jh && !below; k++) {
                    below = digits[k] !== 0;
                }
                cmp = below ? 1 : 0;
            }
            if (cmp > 0 || (cmp === 0 && q % 2 === 1)) {
                q += 1;
            }
        }
        var result = ComputationsUtils._scale(q, shift - 1074 - BITS * fractionDigits);
        return negative ? -result : result;
    }
}

ComputationsUtils._DIGIT_BITS = 24;
ComputationsUtils._DIGIT = 16777216;
// 2045 / 24 -> digit 85, + 2 digits per value, + carries of up to 2^53 values
ComputationsUtils._DIGITS = 92;
ComputationsUtils._TWO_52 = 4503599627370496;
