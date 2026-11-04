#!/usr/bin/env python3
# Generates exact-sum-cases.json for test/specs/psa-mean.spec.js: arrays of doubles
# (IEEE 754 hex) with
#   sum:  the double nearest to their exact sum, ties to even (Fraction arithmetic;
#         an exact sum beyond the double range is +-Infinity),
#   mean: the double nearest to their exact mean (Fraction sum / count; count is
#         the number of values unless the case has a 'count').
# math.fsum gives the same sums where it does not overflow internally.
#   python3 -I test/data/exact-sum-cases.py > test/data/exact-sum-cases.json
import itertools
import json
import math
import random
import struct
from fractions import Fraction

h = lambda x: struct.pack('>d', x).hex()
MAX = 1.7976931348623157e308
rnd = random.Random(20261101)
cases = []


def to_double(f):
    try:
        return float(f)
    except OverflowError:
        return math.inf if f > 0 else -math.inf


def add(values, note, count=None):
    exact = sum((Fraction(v) for v in values), Fraction(0))
    case = {'values': [h(v) for v in values], 'sum': h(to_double(exact)), 'note': note}
    if count is not None:
        case['count'] = count
    if values or count:
        case['mean'] = h(to_double(exact / (count or len(values))))
    cases.append(case)


add([1e16, 1.0, -1e16], 'cancellation of large terms')
add([0.1] * 10, 'ten times 0.1 (exact sum 1.0000000000000000555)')
add([1.0, 1e100, 1.0, -1e100], 'small terms around a large cancellation')
add([2.0 ** 53, 1.0, 1e-16], 'tie broken by a smaller term')
add([2.0 ** 53, 1.0], 'tie, to even')
add([2.0 ** 53, 1.0, -1e-16], 'tie broken downwards')
add([5e-324, 5e-324, -1e-323], 'subnormals')
add([], 'empty')
# beyond the double range: both signs, cancellation, every order
for values, note in [
    ([1e308, 1e308], 'sum overflows, mean 1e308'),
    ([-1e308, -1e308], 'negative: sum overflows, mean -1e308'),
    ([MAX, MAX], 'MAX twice'),
    ([MAX, MAX, -MAX], 'MAX twice minus MAX'),
    ([1e308, 1e308, -1e308], 'intermediate beyond the range, finite sum'),
    ([-1e308, -1e308, 1e308], 'negative intermediate beyond the range'),
    ([1e308, 1e308, 1e308, -1e308, -1e308, 1.0], 'large cancellation with a small term'),
    ([MAX, MAX, 1e-300, -MAX], 'large terms and a tiny one'),
]:
    for order in sorted(set(itertools.permutations(values))):
        add(list(order), note + ' ' + str(order))
# large terms that cancel exactly, with a small remainder (normal and subnormal,
# both signs): every order of the short cases
MIN_NORMAL = 2.2250738585072014e-308
for big in [1e308, MAX, 1e300, 2.0 ** 1023, 1e16]:
    for small in [1e-305, -1e-305, 1e-300, MIN_NORMAL, -MIN_NORMAL, 1.5e-310, 5e-324, -5e-324, 1.0, -1e-16]:
        for order in sorted(set(itertools.permutations([big, -big, small]))):
            add(list(order), 'cancelling %r with remainder %r %s' % (big, small, order))
for order in sorted(set(itertools.permutations([1e308, 1e308, -1e308, -1e308, 1e-310]))):
    add(list(order), 'two large pairs cancelling, subnormal remainder ' + str(order))
for order in sorted(set(itertools.permutations([MAX, MAX, -MAX, 3e-320]))):
    add(list(order), 'beyond the range before the cancellation, subnormal remainder ' + str(order))
add([MAX, -MAX, 1e-300, -1e-300, 5e-324], 'two cancellations, subnormal remainder')
# ties of the mean
add([2.0 ** 53, 2.0 ** 53 + 2], 'mean 2^53 + 1: tie, to even (2^53)')
add([2.0 ** 53 + 2, 2.0 ** 53 + 4], 'mean 2^53 + 3: tie, to even (2^53 + 4)')
add([5e-324], 'mean half of 2^-1074: tie, to even (0)', 2)
add([1.5e-323], 'mean 1.5 * 2^-1074: tie, to even (2 * 2^-1074)', 2)
add([1e308, -1e308, 1e-300], 'remainder divided by more runs than values', 1000)
add([MAX, MAX, MAX], 'mean beyond the range', 2)
add([MAX, MAX], 'mean MAX', 2)
add([MAX] * 1000, '1000 times MAX: mean MAX')
add([MAX, -MAX] * 500 + [1.0], 'alternating MAX, -MAX and 1')
for i in range(30):
    n = rnd.randint(1, 200)
    scale = 10.0 ** rnd.randint(-5, 8)
    values = [(rnd.random() - 0.3) * scale for _ in range(n)]
    if i % 3 == 0:
        values += [-v for v in values[: n // 2]]  # partial cancellation
        rnd.shuffle(values)
    add(values, 'random %d values' % len(values))
for i in range(10):
    n = rnd.randint(2, 50)
    values = [(rnd.random() - 0.4) * MAX for _ in range(n)]
    add(values, 'random %d values near the double range' % n)
for i in range(20):
    # large values in exactly cancelling pairs, small normal / subnormal values, shuffled
    big = [(rnd.random() - 0.5) * MAX for _ in range(rnd.randint(1, 20))]
    small = [(rnd.random() - 0.5) * 10.0 ** rnd.randint(-320, -290) for _ in range(rnd.randint(1, 10))]
    values = big + [-v for v in big] + small
    rnd.shuffle(values)
    add(values, 'random %d large cancelling values with %d small ones' % (2 * len(big), len(small)))
for i in range(5):
    n = rnd.randint(2, 50)
    values = [(rnd.random() - 0.5) * 10.0 ** rnd.randint(-300, 300) for _ in range(n)]
    add(values, 'random %d values of every magnitude, more runs' % n, n + rnd.randint(1, 1000))
print(json.dumps({'generator': 'test/data/exact-sum-cases.py', 'cases': cases}))
