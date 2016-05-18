# cmi5.js
JavaScript implementation of cmi5 AU runtime

This repository does not contain build artifacts, to use a non-source version you will have to build as described below.

## Building the Library

The library uses Grunt for building. Install Node.js which includes `npm`. If you do not already have the base grunt command line tool installed run:

    npm install -g grunt-cli 

Then from the root of the repository run:

    npm install
    grunt
   
This will create `build/cmi5.js` and `build/cmi5-min.js`
