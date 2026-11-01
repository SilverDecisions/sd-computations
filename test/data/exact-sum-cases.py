#!/usr/bin/env python3
# Generates exact-sum-cases.json for test/specs/psa-mean.spec.js: arrays of doubles (as
# IEEE 754 hex) and their correctly rounded sum computed by Python's math.fsum,
# which rounds the exact sum to the nearest double (ties to even).
#   python3 -I test/data/exact-sum-cases.py > test/data/exact-sum-cases.json
import json
import math
import random
import struct

h = lambda x: struct.pack('>d', x).hex()
rnd = random.Random(20261101)
cases = []


def add(values, note):
    cases.append({'values': [h(v) for v in values], 'sum': h(math.fsum(values)), 'note': note})


add([1e16, 1.0, -1e16], 'cancellation of large terms')
add([0.1] * 10, 'ten times 0.1 (exact sum 1.0000000000000000555)')
add([1.0, 1e100, 1.0, -1e100], 'small terms around a large cancellation')
add([2.0 ** 53, 1.0, 1e-16], 'tie broken by a smaller term')
add([2.0 ** 53, 1.0], 'tie, to even')
add([2.0 ** 53, 1.0, -1e-16], 'tie broken downwards')
add([5e-324, 5e-324, -1e-323], 'subnormals')
add([], 'empty')
for i in range(30):
    n = rnd.randint(1, 200)
    scale = 10.0 ** rnd.randint(-5, 8)
    values = [(rnd.random() - 0.3) * scale for _ in range(n)]
    if i % 3 == 0:
        values += [-v for v in values[: n // 2]]  # partial cancellation
        rnd.shuffle(values)
    add(values, 'random %d values' % len(values))
print(json.dumps({'generator': 'test/data/exact-sum-cases.py', 'cases': cases}))
