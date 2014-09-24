/*
 * grunt-hub
 * https://github.com/shama/grunt-hub
 *
 * Copyright (c) 2014 Kyle Robinson Young
 * Licensed under the MIT license.
 */

module.exports = function(grunt) {
  'use strict';

  var _ = require('lodash');
  var async = require('async');
  var chalk = require('chalk');
  var path = require('path');

  var defaultDependencyFns = {
    // Dependency function to depend on a project's bower dependencies.
   'bower': function(gruntfile, allGruntfiles) {
      var projectPath = path.dirname(gruntfile);
      var bowerJson = require(path.join(projectPath, "bower.json"));
      var bowerDependencies = _.extend(bowerJson.dependencies, bowerJson.devDependencies);
      var dependencies = [];
      // for each dependency...
      Object.keys(bowerDependencies).forEach(function(dependencyName) {
        var dependencyValue = bowerDependencies[dependencyName];
        var dependencyPath = path.resolve(projectPath, dependencyValue);
        // check if there's a Gruntfile we know about in that directory...
        allGruntfiles.forEach(function(gruntfile2) {
          if (path.dirname(gruntfile2) == dependencyPath) {
            // and depend on that Gruntfile if so.
            dependencies.push(gruntfile2);
          }
        });
      });
      return dependencies;
    }
  }

  grunt.registerMultiTask('hub', 'Run multiple grunt projects', function() {

    var gruntTaskArgs = this.args;
    var options = this.options({
      allowSelf: false,
      dependencyFn: false
    });

    // Get hub's own Gruntfile.
    var ownGruntfile = grunt.option('gruntfile') || grunt.file.expand({filter: 'isFile'}, '{G,g}runtfile.{js,coffee}')[0];
    ownGruntfile = path.resolve(process.cwd(), ownGruntfile || '');

    var cliArgs = process.argv.slice(2)
      .filter(function(arg, index, arr) {
        return (
          // Remove arguments that were tasks to this Gruntfile.
          !(_.contains(grunt.cli.tasks, arg)) &&
          // Remove "--gruntfile=project/Gruntfile.js" and "--gruntfile".
          !(/^--gruntfile(=.*)?/.test(arg)) &&
          // Remove anything that follows "--gruntfile" (i.e. as its argument).
          !(index > 0 && arr[index-1] === '--gruntfile')
        );
      });

    var errorCount = 0;
    var asyncTasks = {};

    // Create the async task callbacks and dependencies.
    // See https://github.com/caolan/async#auto.
    this.files.forEach(function(filesMapping) {

      var gruntfiles = grunt.file.expand({filter: 'isFile'}, filesMapping.src)
        .map(function(gruntfile) {
          return path.resolve(gruntfile);
        });
      if (!options.allowSelf) {
        gruntfiles = _.without(gruntfiles, ownGruntfile);
      }
      if (!gruntfiles.length) {
        grunt.log.warn('No Gruntfiles matched the file patterns: "' + filesMapping.orig.src.join(', ') + '"');
        return;
      }

      gruntfiles.forEach(function(gruntfile) {

        // Get the dependencies for this Gruntfile.
        var dependencies = [];
        var dependencyFn = filesMapping.dependencyFn || options.dependencyFn;
        if (dependencyFn) {
          if (typeof dependencyFn === 'string') {
            dependencyFn = defaultDependencyFns[dependencyFn];
          }
          try {
            dependencies = dependencyFn(gruntfile, gruntfiles);
          }
          catch (e) {
            grunt.log.error(
              'Could not get dependencies for Gruntfile (' + e.message + '): ' + gruntfile + '. ' +
              'Assuming no dependencies.');
          }
        }

        // Get the subtasks to run.
        var gruntTasksToRun = (
          (gruntTaskArgs.length < 1 ? false : gruntTaskArgs) ||
          filesMapping.tasks ||
          ['default']
        );

        // Create the async task function to run once all dependencies have run.
        // Output is collected and printed as a batch once the task completes.
        var asyncTaskFn = function(callback) {
          var outputToWrite = [];
          grunt.log.writeln('');
          grunt.log.writeln(chalk.cyan('>> ') + 'Running [' + gruntTasksToRun + '] on ' + gruntfile);

          // Spawn the child process.
          var child = grunt.util.spawn({
            grunt: true,
            opts: {cwd: path.dirname(gruntfile)},
            args: [].concat(gruntTasksToRun, cliArgs || [], '--gruntfile=' + gruntfile)
          }, function(err, res, code) {
            if (err) { errorCount++; }
            grunt.log.writeln('');
            grunt.log.writeln(chalk.cyan('>> ') + 'From ' + gruntfile + ':\n');
            outputToWrite.forEach(function(lineData) {
              lineData.fn(lineData.data);
            });
            callback(err);
          });

          // Buffer its stdout and stderr, to be printed on completion.
          child.stdout.on('data', function(data) {
            outputToWrite.push({
              fn: grunt.log.write,
              data: data
            });
          });
          child.stderr.on('data', function(data) {
            outputToWrite.push({
              fn: grunt.log.error,
              data: data
            });
          });
        };

        asyncTasks[gruntfile] = dependencies.concat([asyncTaskFn]);
      });
    });

    var done = this.async();
    async.auto(asyncTasks, function(err, results) {
      grunt.log.writeln('');
      grunt.log.writeln(chalk.cyan('>> ') + 'From ' + ownGruntfile + ':');
      done(err);
    });

  });

};
