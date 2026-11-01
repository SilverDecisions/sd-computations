#!/usr/bin/env python3
# Generates exact-sum-cases.json for test/specs/psa-mean.spec.js: arrays of doubles
# (IEEE 754 hex) with
#   sum:  the double nearest to their exact sum, ties to even (Fraction arithmetic;
#         an exact sum beyond the double range is +-Infinity),
#   mean: the double nearest to their exact mean (Fraction sum / count).
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


def add(values, note):
    exact = sum((Fraction(v) for v in values), Fraction(0))
    case = {'values': [h(v) for v in values], 'sum': h(to_double(exact)), 'note': note}
    if values:
        case['mean'] = h(to_double(exact / len(values)))
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
print(json.dumps({'generator': 'test/data/exact-sum-cases.py', 'cases': cases}))
