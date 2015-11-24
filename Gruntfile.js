module.exports = function (grunt) {
    "use strict";

    var pkg = grunt.file.readJSON("package.json"),
        banner = "/*! <%= pkg.name %> <%= pkg.version %> <%= grunt.template.today('isoDateTime') %> */\n";

    Object.keys(pkg.devDependencies).forEach(
        function (dep) {
            if (dep.substring(0, 6) === "grunt-") {
                grunt.loadNpmTasks(dep);
            }
        }
    );

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

            jshint: {
                options: {
                    jshintrc: ".jshintrc"
                },
                dist: [
                    "Gruntfile.js",
                    "src/*.js"
                ]
            },

            jscs: {
                dist: [
                    "Gruntfile.js",
                    "src/*.js"
                ],
                options: {
                    config: true
                }
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
                    files: {
                        "build/cmi5.js": [
                            "vendor/URI.js/src/punycode.js",
                            "vendor/URI.js/src/URI.js",
                            "node_modules/tincanjs/build/tincan.js",
                            "src/cmi5.js"
                        ]
                    },
                    nonull: true
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
            "jshint",
            "jscs",
            "concat",
            "uglify"
        ]
    );
    grunt.registerTask("default", "build");
};
