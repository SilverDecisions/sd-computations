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
var runSequence = require('run-sequence');

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

gulp.task('clean', function (cb) {
    return del(['tmp', 'dist'], cb);
});

gulp.task('build-clean', ['clean'], function (cb) {
    runSequence('clean', 'build', cb)
});

gulp.task('build', ['build-standalone', 'build-module' ,'build-vendor'], function () {
});

gulp.task('build-standalone', function () {
    var jsFileName =  projectName;
    return buildJs('./standalone.index.js', standaloneName, jsFileName, "dist/standalone", false, true)
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
    return runTest(true, done)
});

gulp.task('test-watch', ['prepare-test'], function (done) {
    return runTest(false, done)
});

function runTest(singleRun, done){
    return new Server({
        configFile: __dirname + '/karma.conf.js',
        singleRun: singleRun
    }, function (err) {
        done(err);
    }).start();
}


function buildJs(src, standaloneName,  jsFileName, dest, external, failOnError) {
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

    return finishBrowserifyBuild(b,jsFileName, dest, failOnError)
}

function buildJsDependencies(jsFileName, moduleNames, dest, failOnError){
    var b = browserify({
        debug: true,
        require: [moduleNames]
    })

    return finishBrowserifyBuild(b, jsFileName, dest, failOnError)
}

function finishBrowserifyBuild(b, jsFileName, dest, failOnError){
    var pipe = b
        .transform("babelify", {presets: ["es2015"],  plugins: ["transform-class-properties", "transform-object-assign", ["transform-builtin-extend", {globals: ["Error"]}]]})
        .bundle();
    if(!failOnError){
        pipe = pipe.on('error', map_error )
            .pipe(plugins.plumber({ errorHandler: onError }))
    }


    pipe = pipe.pipe(source(jsFileName+'.js'))
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

gulp.task('default',  function(cb) {
    runSequence('build-clean', 'test', 'doc', cb);
});

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


gulp.task('doc', function () {
    return gulp.src('./src/computations-manager.js')
        .pipe(plugins.documentation('md', {shallow: true}))
        .pipe(gulp.dest('doc'));
});
