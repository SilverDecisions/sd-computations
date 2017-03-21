var gulp = require('gulp');
var del = require('del');
var merge = require('merge-stream');
var plugins = require('gulp-load-plugins')();
var argv = require('yargs').argv;

var browserify = require("browserify");
var resolutions = require('browserify-resolutions');
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var buffer = require('vinyl-buffer');

var p = require('./package.json'),
    stringify = require('stringify');

var Server = require('karma').Server;

/* nicer browserify errors */
var gutil = require('gulp-util')
var chalk = require('chalk')

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

var projectName= "sd-computations";
var standaloneName= "SilverDecisions.Computations";
gulp
gulp.task('clean', function (cb) {
    return del(['tmp', 'dist'], cb);
});

gulp.task('build-clean', ['clean'], function () {
    return gulp.start('build');
});

gulp.task('build', ['build-standalone', 'build-module'], function () {
});

gulp.task('build-standalone', function () {
    var jsFileName =  projectName;
    return buildJs('./standalone.index.js', standaloneName, jsFileName, "dist/standalone")
});

gulp.task('build-module', function () {
    var jsFileName =  projectName;
    var b = browserify({
        debug: true,
    })
        .require('./index.js', {expose: projectName} )
        .external(sdDependencies);
    return finishBrowserifyBuild(b, jsFileName, "dist")
});

gulp.task('build-vendor', function () {
    return buildJsDependencies(projectName+"-vendor", vendorDependencies, "dist")
});

gulp.task('prepare-test', function(){
    return gulp
        .src('test/data/*.json')
        .pipe(require('gulp-filelist')('data-json-filelist.json', { flatten: true }))
        .pipe(gulp.dest('test'))
});

gulp.task('test', ['prepare-test'], function (done) {
    runTest(true, done)
});

gulp.task('test-watch', ['prepare-test'], function (done) {
    runTest(false, done)
});

function runTest(singleRun, done){
    new Server({
        configFile: __dirname + '/karma.conf.js',
        singleRun: singleRun
    }, function () {
        done();
    }).start();
}


function buildJs(src, standaloneName,  jsFileName, dest, external) {
    if(!external){
        external = []
    }

    var b = browserify({
        basedir: '.',
        debug: true,
        entries: [src],
        cache: {},
        packageCache: {},
        standalone: standaloneName
    }).transform(stringify, {
        appliesTo: { includeExtensions: ['.html'] }
    })
    // .plugin(resolutions, '*')
        .external(external)

    return finishBrowserifyBuild(b,jsFileName, dest)
}

function buildJsDependencies(jsFileName, moduleNames, dest){
    var b = browserify({
        debug: true,
        require: [moduleNames]
    })

    return finishBrowserifyBuild(b, jsFileName, dest)
}

function finishBrowserifyBuild(b, jsFileName, dest){
    var pipe = b
        .transform("babelify", {presets: ["es2015"],  plugins: ["transform-class-properties", "transform-object-assign", ["babel-plugin-transform-builtin-extend", {globals: ["Error"]}]]})
        .bundle()
        .on('error', map_error)
        .pipe(plugins.plumber({ errorHandler: onError }))
        .pipe(source(jsFileName+'.js'))
        .pipe(gulp.dest(dest))
        .pipe(buffer());
    var development = (argv.dev === undefined) ? false : true;
    if(!development){
        pipe.pipe(sourcemaps.init({loadMaps: true}))
        // .pipe(plugins.stripDebug())
            .pipe(plugins.uglify({
                compress: {
                    // drop_console: true
                }
            }))
            .pipe(plugins.rename({ extname: '.min.js' }))

            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest(dest));
    }
    return pipe;
}

gulp.task('default', ['build-clean'],  function() {
});

// error function for plumber
var onError = function (err) {
    console.log('onError', err);
    this.emit('end');
};


function map_error(err) {
    if (err.fileName) {
        // regular error
        gutil.log(chalk.red(err.name)
            + ': '
            + chalk.yellow(err.fileName.replace(__dirname + '/src/js/', ''))
            + ': '
            + 'Line '
            + chalk.magenta(err.lineNumber)
            + ' & '
            + 'Column '
            + chalk.magenta(err.columnNumber || err.column)
            + ': '
            + chalk.blue(err.description))
    } else {
        // browserify error..
        gutil.log(chalk.red(err.name)
            + ': '
            + chalk.yellow(err.message))
    }
    console.log(err)

    this.emit('end');
}
