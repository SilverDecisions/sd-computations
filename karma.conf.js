var p = require('./package.json');
var projectName= p.name;
var dependencies = [];
var vendorDependencies = [];
var sdDependencies = [];
for(var k in p.dependencies){
    if(p.dependencies.hasOwnProperty(k)){
        dependencies.push(k);
        if(k.trim().startsWith("sd-")){
            sdDependencies.push(k)
        }else{
            vendorDependencies.push(k)
        }
    }
}

module.exports = function (config) {
    config.set({
        frameworks: ['browserify','jasmine'],
        plugins: [
            'karma-browserify',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-jasmine',
            'karma-coverage',
        ],
        files:[
            'node_modules/jquery/dist/jquery.js',
            'node_modules/jasmine-jquery/lib/jasmine-jquery.js',

            'node_modules/sd-random/dist/sd-random.js',
            'node_modules/sd-utils/dist/sd-utils.js',
            'node_modules/sd-expression-engine/dist/sd-expression-engine.js',
            'node_modules/sd-model/dist/sd-model.js',
            'dist/sd-computations-vendor.js',
            'src/**/*.js',
            'test/specs/**/*.js',
            // JSON fixture
            { pattern:  'test/data-json-filelist.json',
                watched:  true,
                served:   true,
                included: false },
            { pattern:  'test/data/*.json',
                watched:  true,
                served:   true,
                included: false },
            { pattern:  'test/trees/*.json',
                watched:  true,
                served:   true,
                included: false },
            { pattern:  'test/data/csv/*.csv',
                watched:  true,
                served:   true,
                included: false },
            { pattern:  'test/job-worker.worker.js',
                watched:  true,
                served:   true,
                included: false }
        ],

        preprocessors: {
            'src/**/*.js': ['browserify'],
            'test/specs/**/*.js': ['browserify'],
            // 'test/job-worker.worker.js': ['browserify'],
        },

        browserify: {

            debug: true,
            configure: function(bundle) {
                bundle.on('prebundle', function() {
                    bundle.require('./index.js', {expose: projectName} )
                        .external(dependencies);
                });
            },
            "transform": [
                [
                    "babelify",
                    {
                        "presets": [
                            "@babel/preset-env"
                        ],
                        "plugins": [
                            "transform-class-properties",
                            "transform-object-assign",
                            [
                                "babel-plugin-transform-builtin-extend",
                                {
                                    "globals": [
                                        "Error"
                                    ]
                                }
                            ],
                            "istanbul"
                        ]
                    },
                ]

            ]
        },

        // start these browsers
        browsers: ['ChromeHeadless', 'Firefox'],
        reporters: ['progress', 'coverage'],
        logLevel: config.LOG_WARN,
        singleRun: false,
        browserConsoleLogOptions: {
            terminal: true,
            level: ""
        },

        coverageReporter: {
            reporters: [
                // {'type': 'text'},
                {'type': 'html', dir: 'coverage'},
                {'type': 'lcov'}
            ]
        },
        browserDisconnectTolerance: 2,
        browserNoActivityTimeout: 50000,
        client: {
            jasmine: {
                random: false
            }
        }
    });
};
