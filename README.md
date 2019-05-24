# cmi5.js
JavaScript implementation of cmi5 AU runtime

[![Build Status](https://travis-ci.org/RusticiSoftware/cmi5.js.png)](https://travis-ci.org/RusticiSoftware/cmi5.js)
[![GitHub release](https://img.shields.io/github/release/RusticiSoftware/cmi5.js.svg?maxAge=2592000)](https://github.com/RusticiSoftware/cmi5.js/releases)
[![npm](https://img.shields.io/npm/v/cmi5.js.svg?maxAge=2592000)](https://www.npmjs.com/package/cmi5.js)

This repository does not contain build artifacts, to use a non-source version you will have to build as described below or access artifacts via the [releases page](https://github.com/RusticiSoftware/cmi5.js/releases).

For hosted API documentation, basic usage instructions, etc. visit the main project website at:

http://rusticisoftware.github.io/cmi5.js/

For information about cmi5 visit:

http://aicc.github.io/CMI-5_Spec_Current/

## Building the Library

This repository uses a git submodule to reference our customized URI.js project which is not available via `npm`. Be sure to initialize the submodule repo before building using:

    git submodule update --init

The library uses Grunt for building. Install Node.js which includes `npm`. If you do not already have the base grunt command line tool installed run:

    npm install -g grunt-cli

Then from the root of the repository run:

    npm ci
    grunt

This will create `build/cmi5.js` and `build/cmi5-min.js`
