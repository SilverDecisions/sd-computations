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

describe("ComputationsUtils.exactSum", () => {
    it("gives the correctly rounded sum (reference: Python math.fsum, test/data/exact-sum-cases.py)", () => {
        fixtures.fixturesPath = "base/test/";
        let cases = JSON.parse(readFixtures("data/exact-sum-cases.json")).cases;
        expect(cases.length).toBeGreaterThan(30);
        cases.forEach(c => {
            let values = c.values.map(fromHex);
            let sum = ComputationsUtils.exactSum(values);
            expect(Object.is(sum, fromHex(c.sum))).toBe(true, c.note + ': ' + sum + ' expected ' + fromHex(c.sum));
            // independent of the order
            expect(Object.is(ComputationsUtils.exactSum(values.slice().reverse()), sum)).toBe(true, c.note + ' reversed');
        });
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
