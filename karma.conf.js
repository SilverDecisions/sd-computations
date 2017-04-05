module.exports = function (config) {
    config.set({
        frameworks: ['browserify','jasmine'],
        plugins: [
            'karma-browserify',
            'karma-phantomjs-launcher',
            'karma-chrome-launcher',
            'karma-jasmine'
        ],
        files:[
            'node_modules/jquery/dist/jquery.js',
            'node_modules/jasmine-jquery/lib/jasmine-jquery.js',
            'node_modules/sd-utils/dist/sd-utils.js',
            'node_modules/sd-model/dist/sd-model.js',
            'node_modules/sd-expression-engine/dist/sd-expression-engine.js',
            'dist/sd-computations-vendor.js',
            'src/**/*.js',
            'test/*.js',
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
                included: false }
        ],

        preprocessors: {
            'src/**/*.js': ['browserify'],
            'test/**/*.js': ['browserify']
        },

        browserify: {
            debug: true,
            "transform": [
                [
                    "babelify",
                    {
                        "presets": [
                            "es2015"
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
                            ]
                        ]
                    }
                ]
            ],
            bundleExternal: false
        },

        // start these browsers
        browsers: ['PhantomJS'],
        reporters: ['progress'],
        logLevel: config.LOG_WARN,
        singleRun: false,
        browserConsoleLogOptions: {
            terminal: true,
            level: ""
        }
    });
};
