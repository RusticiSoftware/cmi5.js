/* globals module */
module.exports = function (grunt) {
    "use strict";

    var pkg = grunt.file.readJSON("package.json"),
        banner = "/*! <%= pkg.name %> <%= pkg.version %> <%= grunt.template.today('isoDateTime') %> */\n",
        srcFileList = [
            "vendor/URI.js/src/punycode.js",
            "vendor/URI.js/src/URI.js",
            "node_modules/tincanjs/build/tincan.js",
            "src/cmi5.js"
        ];

    /* eslint-disable prefer-arrow-callback */
    Object.keys(pkg.devDependencies).forEach(
        function (dep) {
            if (dep.substring(0, 6) === "grunt-") {
                grunt.loadNpmTasks(dep);
            }
        }
    );
    /* eslint-enable prefer-arrow-callback */

    grunt.initConfig(
        {
            pkg: pkg,

            watch: {
                scripts: {
                    files: [
                        "src/*.js",
                        "!**/build"
                    ],
                    tasks: ["build"],
                    options: {
                        interrupt: true
                    }
                }
            },

            clean: {
                dist: [
                    "build"
                ]
            },

            fileExists: {
                dist: srcFileList
            },

            eslint: {
                target: [
                    "Gruntfile.js",
                    "src/*.js"
                ]
            },

            concat: {
                options: {
                    banner: banner,

                    // processing causes replacement of Grunt templating items
                    // in the source files, this is being used to set the package
                    // version into the cmi5.js source file
                    process: true
                },
                dist: {
                    src: srcFileList,
                    dest: "build/cmi5.js"
                }
            },

            uglify: {
                dist: {
                    files: {
                        "build/cmi5-min.js": ["build/cmi5.js"]
                    },
                    options: {
                        sourceMap: true
                    }
                }
            }
        }
    );

    grunt.registerTask(
        "build",
        [
            "fileExists",
            "eslint",
            "concat",
            "uglify"
        ]
    );
    grunt.registerTask("default", "build");
};
