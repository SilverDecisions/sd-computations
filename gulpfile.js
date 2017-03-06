var gulp = require('gulp');
var del = require('del');
var merge = require('merge-stream');
var plugins = require('gulp-load-plugins')();
var argv = require('yargs').argv;

var browserify = require("browserify");
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var buffer = require('vinyl-buffer');

var p = require('./package.json'),
    stringify = require('stringify');

var Server = require('karma').Server;

/* nicer browserify errors */
var gutil = require('gulp-util')
var chalk = require('chalk')

var projectName= "sd-computations";
var standaloneName= "SilverDecisions.Computations";

gulp.task('clean', function (cb) {
    return del(['tmp', 'dist'], cb);
});

gulp.task('build', ['clean'], function () {
    var jsFileName =  projectName;
    return buildJs('./standalone.index.js', standaloneName, jsFileName, "dist")
});

function buildJs(src, standaloneName,  jsFileName, dest) {

    var pipe = browserify({
        basedir: '.',
        debug: true,
        entries: [src],
        cache: {},
        packageCache: {},
        standalone: standaloneName
    }).transform("babelify", {presets: ["es2015"],  plugins: ["transform-class-properties", "transform-object-assign", ["babel-plugin-transform-builtin-extend", {globals: ["Error"]}]]})
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

gulp.task('default', ['build'],  function() {
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
