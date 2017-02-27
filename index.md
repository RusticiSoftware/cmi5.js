---
layout: index
---

### Getting Started

Download the build file(s) and load them on an HTML page. Only one of either 'build/cmi5.js' or 'build/cmi5-min.js' is needed at a time. You *can* link to the individual source files but this is not usually necessary outside of development on cmi5.js itself. The '-min.js' build file has been minified for performance but makes it slightly harder to debug.

cmi5.js can be installed via npm using `npm install cmi5.js`. See https://www.npmjs.com/package/cmi5.js for more.

## Basic Usage

### Start the AU session

The `Cmi5` object is the primary interface for the AU. Generally the constructor should be passed the launch URL as provided by the LMS. The URL will be parsed and the various parameters will be used to populate the properties necessary for the functionality of the object's methods.

```javascript
var launchUrl = document.location.href,
    cmi5;

//
// wrap construction in an exception block as creating the `TinCan.LRS` with the endpoint can throw
//
try {
    cmi5 = new Cmi5(launchUrl);
}
catch (ex) {
    console.log("Failed to setup Cmi5 object: " + ex);
    // TODO: do something with error, AU can't be initialized
    return;
}

cmi5.start(
    function (err) {
        if (err !== null) {
            console.log("Failed to start AU session: ", err);
            // TODO: do something with error, session didn't start correctly
            return;
        }

        // TODO: start successful, interact with cmi5 object
    }
);
```

### Send Passed/Failed/Completed

Using the `cmi5` object as initialized above, indicate completion to the LMS via:

```javascript
cmi5.completed(
    function (err) {
        if (err !== null) {
            // TODO: handle error
            return;
        }

        // TODO: handle success
    }
);
```

Using the same model, indicate passed via the `.passed` method, and failure via `.failed`.

### Send "cmi5 Allowed" Statements

To send a "cmi5 allowed" statement choose a verb id to send, prepare a statement, and then send the prepared statement as follows:

```javascript
var allowedSt = cmi5.prepareStatement(
    "http://adlnet.gov/expapi/verbs/experienced"
);

//
// edit `allowedSt` TinCan.Statement object as desired
//

cmi5.sendStatement(
    allowedSt,
    function (err, result, st) {
        if (err !== null) {
            // TODO: handle error
            return;
        }

        // TODO: handle success
    }
);
```

### Terminate Session

When the AU is about to exit, the session must be terminated and redirected to the return URL (when available):

```javascript
cmi5.terminate(
    function (err) {
        var returnUrl;

        if (err !== null) {
            // TODO: handle error
            return;
        }

        // TODO: handle success

        returnUrl = this.getReturnUrl();
        if (returnUrl !== null) {
            document.location.assign(returnUrl);
        }
    }
);
```
