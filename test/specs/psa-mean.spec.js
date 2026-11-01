import {ComputationsManager} from '../../src/computations-manager'
import {ComputationsUtils} from '../../src/computations-utils'
import {DataModel} from "sd-model";

// Expected values of the probabilistic sensitivity analysis: the exact sum of the
// payoffs of the rows, correctly rounded, divided by the number of runs.

let fixtures = jasmine.getFixtures();

function fromHex(hex) {
    let view = new DataView(new ArrayBuffer(8));
    for (let i = 0; i < 8; i++) {
        view.setUint8(i, parseInt(hex.substr(i * 2, 2), 16));
    }
    return view.getFloat64(0);
}

// exact value of a double times 2^1074 (an integer), with bigint
function scaled(v) {
    let view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, v);
    let bits = view.getBigUint64(0);
    let negative = (bits >> BigInt(63)) === BigInt(1);
    let exponent = Number((bits >> BigInt(52)) & BigInt(0x7ff));
    let fraction = bits & ((BigInt(1) << BigInt(52)) - BigInt(1));
    let mantissa = exponent === 0 ? fraction : fraction | (BigInt(1) << BigInt(52));
    let shift = exponent === 0 ? 0 : exponent - 1;
    let value = mantissa << BigInt(shift);
    return negative ? -value : value;
}

function babs(v) {
    return v < BigInt(0) ? -v : v;
}

// distance to the next double away from zero
function ulp(x) {
    let view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(x));
    view.setBigUint64(0, view.getBigUint64(0) + BigInt(1));
    return view.getFloat64(0) - Math.abs(x);
}

// deterministic permutation (Fisher-Yates with a fixed linear congruential generator)
function shuffled(values, seed) {
    let s = seed;
    let copy = values.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2147483648;
        let j = s % (i + 1);
        let t = copy[i];
        copy[i] = copy[j];
        copy[j] = t;
    }
    return copy;
}

describe("ComputationsUtils.exactSum and exactMean", () => {
    // reference: exact Fraction arithmetic in Python (test/data/exact-sum-cases.py), including
    // sums beyond the double range of both signs, cancellations and every order of them
    fixtures.fixturesPath = "base/test/";
    let cases = JSON.parse(readFixtures("data/exact-sum-cases.json")).cases;

    it("exactSum is the correctly rounded sum, +-Infinity only when the exact sum is beyond the range", () => {
        expect(cases.length).toBeGreaterThan(100);
        cases.forEach(c => {
            let values = c.values.map(fromHex);
            let sum = ComputationsUtils.exactSum(values);
            expect(Object.is(sum, fromHex(c.sum))).toBe(true, c.note + ': ' + sum + ' expected ' + fromHex(c.sum));
        });
    });

    it("exactMean is within one rounding of the correctly rounded mean and finite when the mean is", () => {
        cases.filter(c => c.mean).forEach(c => {
            let values = c.values.map(fromHex);
            let mean = ComputationsUtils.exactMean(values);
            let expected = fromHex(c.mean);
            expect(isFinite(mean)).toBe(isFinite(expected), c.note);
            expect(Object.is(mean, expected) || Math.abs(mean - expected) <= ulp(expected)).toBe(true, c.note + ': ' + mean + ' expected ' + expected);
        });
    });

    it("results do not depend on the order of the values", () => {
        cases.forEach((c, i) => {
            let values = c.values.map(fromHex);
            let sum = ComputationsUtils.exactSum(values);
            let mean = ComputationsUtils.exactMean(values);
            [values.slice().reverse(), shuffled(values, i + 1), shuffled(values, i + 1000)].forEach(order => {
                expect(Object.is(ComputationsUtils.exactSum(order), sum)).toBe(true, c.note + ' sum');
                expect(Object.is(ComputationsUtils.exactMean(order), mean)).toBe(true, c.note + ' mean');
            });
        });
    });

    it("probabilistic analysis postProcess: finite means of payoffs whose sum is beyond the range", () => {
        let job = new ComputationsManager({}).getJobByName("probabilistic-sensitivity-analysis");
        let step = job.steps.find(s => s.postProcess && s.updatePolicyStats);
        let run = (payoffs) => {
            let jobResult = {data: {policies: [{}], rows: payoffs.map(p => ({policyIndex: 0, variables: [], payoff: p}))}};
            step.postProcess({getJobParameters: () => ({value: name => name === "numberOfRuns" ? payoffs.length : null})}, jobResult);
            return jobResult.data.expectedValues[0];
        };
        expect(run([1e308, 1e308])).toBe(1e308);
        expect(run([-1e308, -1e308])).toBe(-1e308);
        [[1e308, 1e308, -1e308], [1e308, -1e308, 1e308], [-1e308, 1e308, 1e308]].forEach(order => {
            expect(run(order)).toBe(1e308 / 3, JSON.stringify(order));
        });
        // 'n/a' payoffs count as 0; 2 MAX / 3 correctly rounded (Python Fraction): 1.1984620899082105e308
        expect(run([Number.MAX_VALUE, Number.MAX_VALUE, 'n/a'])).toBe(1.1984620899082105e308);
    });

    it("handles infinite and NaN values", () => {
        expect(ComputationsUtils.exactSum([1, Infinity])).toBe(Infinity);
        expect(ComputationsUtils.exactSum([-Infinity, 1])).toBe(-Infinity);
        expect(isNaN(ComputationsUtils.exactSum([Infinity, -Infinity]))).toBe(true);
        expect(isNaN(ComputationsUtils.exactSum([1, NaN]))).toBe(true);
    });
});

[
    {name: "without worker", config: {}},
    {name: "with worker", config: {worker: {url: "/base/test/job-worker.worker.js"}}}
].forEach(managerConf => {
    describe("Probabilistic sensitivity analysis expected values [" + managerConf.name + "]", () => {
        let computationsManager = new ComputationsManager(managerConf.config);
        let jobResult;
        let jobParameters;
        let error;
        let duration;
        const numberOfRuns = 1000;

        beforeAll((done) => {
            let worker = computationsManager.jobsManger.jobWorker;
            if (managerConf.config.worker && worker) {
                let src = $("script").filter(function () {
                    return this.src.match(/.+\.browserify.*/);
                }).first().attr('src');
                worker.addListener("worker_loaded", () => done());
                worker.postMessage(src);
            } else {
                done();
            }
        }, 15000);

        beforeAll((done) => {
            fixtures.fixturesPath = "base/test/";
            let data = JSON.parse(readFixtures("trees/rockefellerWithParams.json")).data;
            computationsManager.setData(new DataModel(data));
            let job = computationsManager.getJobByName("probabilistic-sensitivity-analysis");
            jobParameters = job.createJobParameters({
                ruleName: "expected-value-maximization",
                numberOfRuns: numberOfRuns,
                variables: [
                    {name: "pr", formula: "Uniform(0.1, 0.9)"},
                    {name: "sens", formula: "Triangular(0.8, 1, 0.9)"},
                    {name: "spec", formula: "Normal(0.7, 0.05)"}
                ],
                extendedPolicyDescription: true
            });
            let start = Date.now();
            computationsManager.runJobWithInstanceManager(job.name, jobParameters.values, {
                onJobCompleted: (res) => {
                    duration = Date.now() - start;
                    jobResult = {data: res}; // onJobCompleted receives the result data
                    done();
                },
                onJobFailed: (e) => {
                    error = e;
                    done();
                }
            }).catch(e => {
                error = e;
                done();
            });
        }, 120000);

        it("runs without errors", () => {
            expect(error).toBeFalsy();
            console.log('PSA ' + numberOfRuns + ' runs ' + managerConf.name + ': ' + duration + ' ms');
        });

        it("expected value = mean of the payoffs of the rows within one rounding", () => {
            let rowsPerPolicy = jobResult.data.policies.map(() => []);
            jobResult.data.rows.forEach(row => rowsPerPolicy[row.policyIndex].push(typeof row.payoff === 'string' ? 0 : row.payoff));
            jobResult.data.expectedValues.forEach((ev, i) => {
                expect(rowsPerPolicy[i].length).toBe(numberOfRuns);
                expect(typeof ev).toBe('number');
                // exact: S = sum of the payoffs * 2^1074, mean = S / (runs * 2^1074)
                let S = rowsPerPolicy[i].reduce((acc, p) => acc + scaled(p), BigInt(0));
                let E = scaled(ev) * BigInt(numberOfRuns);
                // |ev - mean| <= 2^-52 |mean| (two roundings of half an ulp each), cross-multiplied
                expect(babs(E - S) * (BigInt(1) << BigInt(52)) <= babs(S)).toBe(true, 'policy ' + i + ': ' + ev);
            });
        });
    });
});
