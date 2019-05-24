/*
    Copyright 2017 Rustici Software

    See the LICENSE.md, you may not use this file except in compliance with the License.

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

/**
cmi5.js AU runtime library

@module Cmi5
*/
var Cmi5; // eslint-disable-line no-implicit-globals

(function () {
    "use strict";
    var THIS_LIBRARY = {
            // set by the build step
            VERSION: "<%= pkg.version %>",
            NAME: "<%= pkg.name %>",
            DESCRIPTION: "<%= pkg.description %>"
        },
        nativeRequest,
        xdrRequest,
        requestComplete,
        __delay,
        env = {},
        STATE_LMS_LAUNCHDATA = "LMS.LaunchData",
        LAUNCH_MODE_NORMAL = "Normal",
        AGENT_PROFILE_LEARNER_PREFS = "cmi5LearnerPreferences",
        CATEGORY_ACTIVITY_CMI5 = new TinCan.Activity(
            {
                id: "https://w3id.org/xapi/cmi5/context/categories/cmi5"
            }
        ),
        CATEGORY_ACTIVITY_MOVEON = new TinCan.Activity(
            {
                id: "https://w3id.org/xapi/cmi5/context/categories/moveon"
            }
        ),
        OTHER_ACTIVITY_CMI5JS = new TinCan.Activity(
            {
                id: "http://id.tincanapi.com/activity/software/" + THIS_LIBRARY.NAME + "/" + THIS_LIBRARY.VERSION,
                definition: {
                    name: {
                        und: THIS_LIBRARY.NAME + " (" + THIS_LIBRARY.VERSION + ")"
                    },
                    description: {
                        en: THIS_LIBRARY.DESCRIPTION
                    },
                    type: "http://id.tincanapi.com/activitytype/source"
                }
            }
        ),
        EXTENSION_SESSION_ID = "https://w3id.org/xapi/cmi5/context/extensions/sessionid",
        EXTENSION_MASTERY_SCORE = "https://w3id.org/xapi/cmi5/context/extensions/masteryscore",
        VERB_INITIALIZED_ID = "http://adlnet.gov/expapi/verbs/initialized",
        VERB_TERMINATED_ID = "http://adlnet.gov/expapi/verbs/terminated",
        VERB_COMPLETED_ID = "http://adlnet.gov/expapi/verbs/completed",
        VERB_PASSED_ID = "http://adlnet.gov/expapi/verbs/passed",
        VERB_FAILED_ID = "http://adlnet.gov/expapi/verbs/failed",
        verbDisplay = {},
        launchParameters = [
            "endpoint",
            "fetch",
            "actor",
            "activityId",
            "registration"
        ],
        isInteger;

    // polyfill for Number.isInteger from MDN
    isInteger = function (value) {
        return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
    };

    verbDisplay[VERB_INITIALIZED_ID] = {
        en: "initialized"
    };
    verbDisplay[VERB_TERMINATED_ID] = {
        en: "terminated"
    };

    //
    // Detect CORS and XDR support
    //
    env.hasCORS = false;
    env.useXDR = false;

    if (typeof XMLHttpRequest !== "undefined" && typeof (new XMLHttpRequest()).withCredentials !== "undefined") {
        env.hasCORS = true;
    }
    else if (typeof XDomainRequest !== "undefined") {
        env.hasCORS = true;
        env.useXDR = true;
    }

    /**
        Top level interface constructor.

        It is highly recommended to use asynchronous calls to methods supporting a callback.

        @class Cmi5
        @constructor
        @param {String} [launchString] AU Launch URL providing configuration options
        @throws {Error} Invalid launch string
    */
    Cmi5 = function (launchString) {
        var url,
            cfg,
            i;

        this.log("constructor", launchString);

        if (typeof launchString !== "undefined") {
            url = new URI(launchString);
            cfg = url.search(true);

            for (i = 0; i < launchParameters.length; i += 1) {
                if (typeof cfg[launchParameters[i]] === "undefined" || cfg[launchParameters[i]] === "") {
                    throw new Error("Invalid launch string missing or empty parameter: " + launchParameters[i]);
                }
            }

            this.setFetch(cfg.fetch);
            this.setLRS(cfg.endpoint);
            this.setActor(cfg.actor);
            this.setActivity(cfg.activityId);
            this.setRegistration(cfg.registration);
        }
    };

    /**
        Version of this library

        @property VERSION
        @static
        @type String
    */
    Cmi5.VERSION = THIS_LIBRARY.VERSION;

    /**
        Whether or not to enable debug logging

        @property DEBUG
        @static
        @type Boolean
        @default false
    */
    Cmi5.DEBUG = false;

    Cmi5.prototype = {
        _fetch: null,
        _endpoint: null,
        _actor: null,
        _registration: null,
        _activity: null,

        _lrs: null,
        _fetchRequest: null,
        _fetchContent: null,
        _lmsLaunchData: null,
        _contextTemplate: null,
        _learnerPrefs: null,
        _isActive: false,
        _initialized: null,
        _passed: null,
        _failed: null,
        _completed: null,
        _terminated: null,
        _durationStart: null,
        _progress: null,
        _includeSourceActivity: true,

        /**
            Method to call to start the AU runtime

            This is a simplified "boot" sequence for the AU that will call the individual parts of the start up sequence that would otherwise need to be called in order sequentially.

            @method start
            @param {Function} callback Function to call on error or success
            @param {Object} [events] Functions to run at specific execution points
                @param {Function} [events.postFetch] Function to run after retrieving fetchUrl result
                @param {Function} [events.launchData] Function to run after retrieving launch data
                @param {Function} [events.learnerPrefs] Function to run after retrieving learner preferences
                @param {Function} [events.initializeStatement] Function to run after saving initialization statement
            @param {Object} [additionalProperties] Optional object param with properties to customize method behavior.
        */
        start: function (callback, events, additionalProperties) {
            var self = this,
                breakEarly = additionalProperties.breakBeforeInitializeStatement || false;

            this.log("start");

            events = events || {};

            self.postFetch(
                function (err) {
                    var prefix = "Failed to start AU - ";

                    if (typeof events.postFetch !== "undefined") {
                        events.postFetch.apply(this, arguments);
                    }
                    if (err !== null) {
                        callback(new Error(prefix + " POST to fetch: " + err));

                        return;
                    }

                    self.loadLMSLaunchData(
                        function (err) {
                            if (typeof events.launchData !== "undefined") {
                                events.launchData.apply(this, arguments);
                            }
                            if (err !== null) {
                                callback(new Error(prefix + " load LMS LaunchData: " + err));

                                return;
                            }

                            self.loadLearnerPrefs(
                                function (err) {
                                    if (typeof events.learnerPrefs !== "undefined") {
                                        events.learnerPrefs.apply(this, arguments);
                                    }
                                    if (err !== null) {
                                        callback(new Error(prefix + " load learner preferences: " + err));

                                        return;
                                    }

                                    if (! breakEarly) {
                                        self.initialize(
                                            function (err) {
                                                if (typeof events.initializeStatement !== "undefined") {
                                                    events.initializeStatement.apply(this, arguments);
                                                }
                                                if (err !== null) {
                                                    callback(new Error(prefix + " send initialized statement: " + err));

                                                    return;
                                                }

                                                callback(null);
                                            }
                                        );

                                        return;
                                    }

                                    callback(null);
                                }
                            );
                        }
                    );
                }
            );
        },

        /**
            Method to POST to the fetchUrl to retrieve the LRS credentials

            `setFetch` has to be called first and is called by the constructor if the launch string was provided to it.

            @method postFetch
            @param {Function} [callback] Function to call on error or success
        */
        postFetch: function (callback) {
            var self = this,
                cbWrapper;

            this.log("postFetch");

            if (this._fetch === null) {
                callback(new Error("Can't POST to fetch URL without setFetch"));

                return;
            }

            if (callback) {
                cbWrapper = function (err, xhr) {
                    var parsed,
                        responseContent = xhr.responseText,
                        responseContentType;

                    self.log("postFetch::cbWrapper");
                    self.log("postFetch::cbWrapper", err);
                    self.log("postFetch::cbWrapper", xhr);

                    if (err !== null) {
                        if (err === 0) {
                            err = "Aborted, offline, or invalid CORS endpoint";
                        }
                        else if (/^\d+$/.test(err)) {
                            if (typeof xhr.getResponseHeader !== "undefined") {
                                responseContentType = xhr.getResponseHeader("Content-Type");
                            }
                            else if (typeof xhr.contentType !== "undefined") {
                                responseContentType = xhr.contentType;
                            }
                            if (TinCan.Utils.isApplicationJSON(responseContentType)) {
                                try {
                                    parsed = JSON.parse(responseContent);

                                    if (typeof parsed["error-text"] !== "undefined") {
                                        err = parsed["error-text"] + " (" + parsed["error-code"] + ")";
                                    }
                                    else {
                                        err = "Failed to detect 'error-text' property in JSON error response";
                                    }
                                }
                                catch (ex) {
                                    err = "Failed to parse JSON error response: " + ex;
                                }
                            }
                            else {
                                err = xhr.responseText;
                            }
                        }
                        else {
                            err = xhr.responseText;
                        }
                        callback(new Error(err), xhr, parsed);

                        return;
                    }

                    try {
                        parsed = JSON.parse(responseContent);
                    }
                    catch (ex) {
                        self.log("postFetch::cbWrapper - failed to parse JSON response: " + ex);
                        callback(new Error("Post fetch response malformed: failed to parse JSON response (" + ex + ")"), xhr);

                        return;
                    }

                    if (parsed === null || typeof parsed !== "object" || typeof parsed["auth-token"] === "undefined") {
                        self.log("postFetch::cbWrapper - failed to access 'auth-token' property");
                        callback(new Error("Post fetch response malformed: failed to access 'auth-token' in (" + responseContent + ")"), xhr, parsed);

                        return;
                    }

                    self._fetchContent = parsed;
                    self._lrs.auth = "Basic " + parsed["auth-token"];

                    callback(err, xhr, parsed);
                };
            }

            return this._fetchRequest(
                this._fetch,
                {
                    method: "POST"
                },
                cbWrapper
            );
        },

        /**
            Method to load the LMS.LaunchData state document populated by the LMS

            Fetch data has to have already been loaded, in order to have LRS credential.

            @method loadLMSLaunchData
            @param {Function} callback Function to call on error or success
        */
        loadLMSLaunchData: function (callback) {
            var self = this;

            this.log("loadLMSLaunchData");

            if (this._fetchContent === null) {
                callback(new Error("Can't retrieve LMS Launch Data without successful postFetch"));

                return;
            }

            this._lrs.retrieveState(
                STATE_LMS_LAUNCHDATA,
                {
                    activity: this._activity,
                    agent: this._actor,
                    registration: this._registration,
                    callback: function (err, result) {
                        if (err !== null) {
                            callback(new Error("Failed to retrieve " + STATE_LMS_LAUNCHDATA + " State: " + err), result);

                            return;
                        }

                        //
                        // a missing state isn't an error as far as TinCanJS is concerned, but
                        // getting a 404 on the LMS LaunchData is a problem in cmi5 so fail here
                        // in that case (which is when result is null)
                        //
                        if (result === null) {
                            callback(new Error(STATE_LMS_LAUNCHDATA + " State not found"), result);

                            return;
                        }

                        self._lmsLaunchData = result.contents;

                        //
                        // store a stringified version of the context template for cheap
                        // cloning when we go to prepare it later for use in statements
                        //
                        self._contextTemplate = JSON.stringify(self._lmsLaunchData.contextTemplate);

                        callback(null, result);
                    }
                }
            );
        },

        /**
            Method to load learner prefs agent profile document possibly populated by the LMS

            @method loadLearnerPrefs
            @param {Function} callback Function to call on error or success
        */
        loadLearnerPrefs: function (callback) {
            var self = this;

            this.log("loadLearnerPrefs");

            if (this._lmsLaunchData === null) {
                callback(new Error("Can't retrieve Learner Preferences without successful loadLMSLaunchData"));

                return;
            }

            this._lrs.retrieveAgentProfile(
                AGENT_PROFILE_LEARNER_PREFS,
                {
                    agent: this._actor,
                    callback: function (err, result) {
                        if (err !== null) {
                            callback(new Error("Failed to retrieve " + AGENT_PROFILE_LEARNER_PREFS + " Agent Profile" + err), result);

                            return;
                        }

                        //
                        // result is null when the profile 404s which is not an error,
                        // just means it hasn't been set to anything
                        //
                        if (result !== null) {
                            self._learnerPrefs = result;
                        }
                        else {
                            //
                            // store an empty object locally to be able to distinguish a non-set
                            // preference document vs a non-fetched preference document
                            //
                            self._learnerPrefs = new TinCan.AgentProfile(
                                {
                                    id: AGENT_PROFILE_LEARNER_PREFS,
                                    contentType: "application/json",
                                    contents: {}
                                }
                            );
                        }

                        callback(null, result);
                    }
                }
            );
        },

        /**
            Method to save learner prefs to agent profile document in LRS

            @method saveLearnerPrefs
            @param {Function} [callback] Function to call on error or success
        */
        saveLearnerPrefs: function (callback) {
            var self = this,
                result,
                cbWrapper;

            this.log("saveLearnerPrefs");

            if (this._learnerPrefs === null) {
                result = new Error("Can't save Learner Preferences without first loading them");
                if (callback) {
                    callback(result);

                    return;
                }

                return result;
            }

            if (callback) {
                cbWrapper = function (err, result) {
                    self.log("saveLearnerPrefs - saveAgentProfile callback", err, result);
                    if (err !== null) {
                        callback(new Error("Failed to save " + AGENT_PROFILE_LEARNER_PREFS + " Agent Profile: " + err), result);

                        return;
                    }

                    self._learnerPrefs.etag = TinCan.Utils.getSHA1String(
                        typeof self._learnerPrefs.contents === "object" && TinCan.Utils.isApplicationJSON(self._learnerPrefs.contentType)
                            ? JSON.stringify(self._learnerPrefs.contents)
                            : self._learnerPrefs.contents
                    );

                    callback(null, result);
                };
            }

            result = this._lrs.saveAgentProfile(
                AGENT_PROFILE_LEARNER_PREFS,
                this._learnerPrefs.contents,
                {
                    agent: this._actor,
                    lastSHA1: this._learnerPrefs.etag,
                    contentType: this._learnerPrefs.contentType,
                    callback: cbWrapper
                }
            );
            if (cbWrapper) {
                return;
            }

            if (result.err !== null) {
                return new Error("Failed to save " + AGENT_PROFILE_LEARNER_PREFS + " Agent Profile: " + result.err);
            }

            self._learnerPrefs.etag = TinCan.Utils.getSHA1String(
                typeof self._learnerPrefs.contents === "object" && TinCan.Utils.isApplicationJSON(self._learnerPrefs.contentType)
                    ? JSON.stringify(self._learnerPrefs.contents)
                    : self._learnerPrefs.contents
            );
        },

        /**
            Finalize initialization process by sending initialized statement, starting duration tracker, and marking AU active

            @method initialize
            @param {Function} [callback] Function to call on error or success
            @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
            @throws {Error} <ul><li>Learner prefs not loaded</li><li>AU already initialized</li></ul>
        */
        initialize: function (callback, additionalProperties) {
            var st,
                err,
                callbackWrapper,
                result,
                additionalProperties = additionalProperties || {}; // eslint-disable-line no-redeclare

            this.log("initialize");

            if (this._learnerPrefs === null) {
                err = new Error("Can't send initialized statement without successful loadLearnerPrefs");
                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this._initialized) {
                this.log("initialize - already initialized");

                err = new Error("AU already initialized");
                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            st = this.initializedStatement();
            this._appendProvidedProperties(st, additionalProperties);

            if (callback) {
                callbackWrapper = function (err) {
                    this.log("initialize - callbackWrapper: " + err);
                    if (err === null) {
                        this._initialized = true;
                        this._isActive = true;
                        this._durationStart = new Date().getTime();
                    }

                    callback.apply(this, arguments);
                }.bind(this);
            }

            result = this.sendStatement(st, callbackWrapper);
            this.log("initialize - result: ", result);

            if (! callback && result.response.err === null) {
                this._initialized = true;
                this._isActive = true;
                this._durationStart = new Date().getTime();
            }

            return result;
        },

        /**
            Method to indicate session termination should occur, sends terminated statement, marks AU inactive

            @method terminate
            @param {Function} [callback] Function to call on error or success
            @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
            @throws {Error} <ul><li>AU not initialized</li><li>AU already terminated</li></ul>
        */
        terminate: function (callback, additionalProperties) {
            var st,
                err,
                callbackWrapper,
                result,
                additionalProperties = additionalProperties || {}; // eslint-disable-line no-redeclare

            this.log("terminate");

            if (! this._initialized) {
                this.log("terminate - not initialized");

                err = new Error("AU not initialized");
                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this._terminated) {
                this.log("terminate - already terminated");

                err = new Error("AU already terminated");
                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            st = this.terminatedStatement();
            this._appendProvidedProperties(st, additionalProperties);

            if (callback) {
                callbackWrapper = function (err) {
                    this.log("terminate - callbackWrapper: " + err);
                    if (err === null) {
                        this._terminated = true;
                        this._isActive = false;
                    }

                    callback.apply(this, arguments);
                }.bind(this);
            }

            result = this.sendStatement(st, callbackWrapper);
            this.log("terminate - result: ", result);

            if (! callback && result.response.err === null) {
                this._terminated = true;
                this._isActive = false;
            }

            return result;
        },

        /**
            Method to indicate learner has completed the AU, sends completed statement

            @method completed
            @param {Function} [callback] Function to call on error or success
            @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
            @throws {Error} <ul><li>AU not active</li><li>AU not in normal launch mode</li><li>AU already completed</li></ul>
        */
        completed: function (callback, additionalProperties) {
            var st,
                err,
                callbackWrapper,
                result,
                additionalProperties = additionalProperties || {}; // eslint-disable-line no-redeclare

            this.log("completed");

            if (! this.isActive()) {
                this.log("completed - not active");
                err = new Error("AU not active");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
                this.log("completed - non-Normal launch mode: ", this.getLaunchMode());
                err = new Error("AU not in Normal launch mode");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this._completed) {
                this.log("completed - already completed");
                err = new Error("AU already completed");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            st = this.completedStatement();
            this._appendProvidedProperties(st, additionalProperties);

            if (callback) {
                callbackWrapper = function (err) {
                    this.log("completed - callbackWrapper: " + err);
                    if (err === null) {
                        this.setProgress(null);
                        this._completed = true;
                    }

                    callback.apply(this, arguments);
                }.bind(this);
            }

            result = this.sendStatement(st, callbackWrapper);
            this.log("completed - result: ", result);

            if (! callback && result.response.err === null) {
                this.setProgress(null);
                this._completed = true;
            }

            return result;
        },

        /**
            Method to indicate learner has passed the AU, sends passed statement with optional score

            @method passed
            @param {Object} [score] Score to be included in statement (see `passedStatement`)
            @param {Function} [callback] Function to call on error or success
            @throws {Error} <ul><li>AU not active,</li><li>AU not in normal launch mode,</li><li>AU already passed,</li><li>Failed to create passed statement (usually because of malformed score)</li></ul>
        */
        passed: function (score, callback) {
            var st,
                err,
                callbackWrapper,
                result;

            this.log("passed");

            if (! this.isActive()) {
                this.log("passed - not active");
                err = new Error("AU not active");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
                this.log("passed - non-Normal launch mode: ", this.getLaunchMode());
                err = new Error("AU not in Normal launch mode");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this._passed !== null) {
                this.log("passed - already passed");
                err = new Error("AU already passed");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            try {
                st = this.passedStatement(score);
            }
            catch (ex) {
                this.log("passed - failed to create passed statement: " + ex);
                if (callback) {
                    callback("Failed to create passed statement - " + ex);

                    return;
                }

                throw ex;
            }

            if (callback) {
                callbackWrapper = function (err) {
                    this.log("passed - callbackWrapper: " + err);
                    if (err === null) {
                        this._passed = true;
                    }

                    callback.apply(this, arguments);
                }.bind(this);
            }

            result = this.sendStatement(st, callbackWrapper);
            this.log("passed - result: ", result);

            if (! callback && result.response.err === null) {
                this._passed = true;
            }

            return result;
        },

        /**
            Method to indicate learner has failed the AU, sends failed statement with optional score

            @method failed
            @param {Object} [score] Score to be included in statement (see `failedStatement`)
            @param {Function} [callback] Function to call on error or success
            @throws {Error} <ul><li>AU not active</li><li>AU not in normal launch mode</li><li>AU already passed/failed</li><li>Failed to create failed statement (usually because of malformed score)</li></ul>
        */
        failed: function (score, callback) {
            var st,
                err,
                callbackWrapper,
                result;

            this.log("failed");

            if (! this.isActive()) {
                this.log("failed - not active");
                err = new Error("AU not active");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
                this.log("failed - non-Normal launch mode: ", this.getLaunchMode());
                err = new Error("AU not in Normal launch mode");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            if (this._failed !== null || this._passed !== null) {
                this.log("failed - already passed/failed");
                err = new Error("AU already passed/failed");

                if (callback) {
                    callback(err);

                    return;
                }

                throw err;
            }

            try {
                st = this.failedStatement(score);
            }
            catch (ex) {
                this.log("failed - failed to create failed statement: " + ex);
                if (callback) {
                    callback("Failed to create failed statement - " + ex);

                    return;
                }

                throw ex;
            }

            if (callback) {
                callbackWrapper = function (err) {
                    this.log("failed - callbackWrapper: " + err);
                    if (err === null) {
                        this._failed = true;
                    }

                    callback.apply(this, arguments);
                }.bind(this);
            }

            result = this.sendStatement(st, callbackWrapper);
            this.log("failed - result: ", result);

            if (! callback && result.response.err === null) {
                this._failed = true;
            }

            return result;
        },

        /**
            Method indicating whether the AU is currently active, has been initialized and not terminated

            @method isActive
            @return {Boolean} Active flag
        */
        isActive: function () {
            this.log("isActive");

            return this._isActive;
        },

        /**
            Safe version of logging, only displays when .DEBUG is true, and console.log
            is available

            See `console.log` for parameters.

            @method log
        */
        log: function () {
            /* eslint-disable no-console */
            if (Cmi5.DEBUG && typeof console !== "undefined" && console.log) {
                arguments[0] = "cmi5.js:" + arguments[0];
                console.log.apply(console, arguments);
            }
            /* eslint-enable no-console */
        },

        /**
            Switch on/off whether a source activity is included in statements by default

            Default: on

            @method includeSourceActivity
            @param {Boolean} val true is include, false is exclude
        */
        includeSourceActivity: function (val) {
            this._includeSourceActivity = !! val;
        },

        /**
            Retrieve the launch method as provided in the LMS launch data

            @method getLaunchMethod
            @throws {Error} LMS launch data has not been loaded
            @return {String} launch method
        */
        getLaunchMethod: function () {
            this.log("getLaunchMethod");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine launchMethod until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.launchMethod;
        },

        /**
            Retrieve the launch mode as provided in the LMS launch data

            @method getLaunchMode
            @throws {Error} LMS launch data has not been loaded
            @return {String} launch mode
        */
        getLaunchMode: function () {
            this.log("getLaunchMode");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine launchMode until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.launchMode;
        },

        /**
            Retrieve the launch parameters when provided by the AU and in the launch data

            @method getLaunchParameters
            @throws {Error} LMS launch data has not been loaded
            @return {String|null} launch parameters when exist or null
        */
        getLaunchParameters: function () {
            var result = null;

            this.log("getLaunchParameters");

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine LaunchParameters until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.launchParameters !== "undefined") {
                result = this._lmsLaunchData.launchParameters;
            }

            return result;
        },

        /**
            Retrieve the session id

            @method getSessionId
            @throws {Error} LMS launch data has not been loaded
            @return {String} session id
        */
        getSessionId: function () {
            this.log("getSessionId");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine session id until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.contextTemplate.extensions[EXTENSION_SESSION_ID];
        },

        /**
            Retrieve the moveOn value

            @method getMoveOn
            @throws {Error} LMS launch data has not been loaded
            @return {String} moveOn value
        */
        getMoveOn: function () {
            this.log("getMoveOn");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine moveOn until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.moveOn;
        },

        /**
            Retrieve the mastery score as provided in LMS launch data

            @method getMasteryScore
            @throws {Error} LMS launch data has not been loaded
            @return {String|null} mastery score or null
        */
        getMasteryScore: function () {
            var result = null;

            this.log("getMasteryScore");

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine masteryScore until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.masteryScore !== "undefined") {
                result = this._lmsLaunchData.masteryScore;
            }

            return result;
        },

        /**
            Retrieve the return URL as provided in LMS launch data

            @method getReturnURL
            @throws {Error} LMS launch data has not been loaded
            @return {String|null} mastery score or null
        */
        getReturnURL: function () {
            var result = null;

            this.log("getReturnURL");

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine returnURL until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.returnURL !== "undefined") {
                result = this._lmsLaunchData.returnURL;
            }

            return result;
        },

        /**
            Retrieve the entitlement key as provided in LMS launch data

            @method getEntitlementKey
            @throws {Error} LMS launch data has not been loaded
            @return {String|null} entitlement key
        */
        getEntitlementKey: function () {
            var result = null;

            this.log("getEntitlementKey");

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine entitlementKey until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.entitlementKey !== "undefined") {
                if (typeof this._lmsLaunchData.entitlementKey.alternate !== "undefined") {
                    result = this._lmsLaunchData.entitlementKey.alternate;
                }
                else if (typeof this._lmsLaunchData.entitlementKey.courseStructure !== "undefined") {
                    result = this._lmsLaunchData.entitlementKey.courseStructure;
                }
            }

            return result;
        },

        /**
            Retrieve the language preference as provided in learner preferences

            @method getLanguagePreference
            @throws {Error} Learner preference data has not been loaded
            @return {String|null} language preference
        */
        getLanguagePreference: function () {
            var result = null;

            this.log("getLanguagePreference");

            if (this._learnerPrefs === null) {
                throw new Error("Can't determine language preference until learner preferences have been loaded");
            }

            if (typeof this._learnerPrefs.contents.languagePreference !== "undefined") {
                result = this._learnerPrefs.contents.languagePreference;
            }

            return result;
        },

        /**
            Locally set the learner's language preference

            @method setLanguagePreference
            @param {String} pref language preference code (use `""` to unset)
            @throws {Error} Learner preference data has not been loaded
        */
        setLanguagePreference: function (pref) {
            this.log("setLanguagePreference");

            if (this._learnerPrefs === null) {
                throw new Error("Can't set language preference until learner preferences have been loaded");
            }

            if (pref === "") {
                pref = null;
            }

            this._learnerPrefs.contents.languagePreference = pref;
        },

        /**
            Retrieve the audio preference as provided in learner preferences

            @method getAudioPreference
            @throws {Error} Learner preference data has not been loaded
            @return {String|null} audio preference
        */
        getAudioPreference: function () {
            var result = null;

            this.log("getAudioPreference");

            if (this._learnerPrefs === null) {
                throw new Error("Can't determine audio preference until learner preferences have been loaded");
            }

            if (typeof this._learnerPrefs.contents.audioPreference !== "undefined") {
                result = this._learnerPrefs.contents.audioPreference;
            }

            return result;
        },

        /**
            Locally set the learner's audio preference

            @method setAudioPreference
            @param {String} pref "on", "off", or `null`
            @throws {Error} Learner preference data has not been loaded
        */
        setAudioPreference: function (pref) {
            this.log("setAudioPreference");

            if (this._learnerPrefs === null) {
                throw new Error("Can't set audio preference until learner preferences have been loaded");
            }

            if (pref !== "on" && pref !== "off" && pref !== null) {
                throw new Error("Unrecognized value for audio preference: " + pref);
            }

            this._learnerPrefs.contents.audioPreference = pref;
        },

        /**
            Get the duration of this session so far

            @method getDuration
            @return {Number} Number of milliseconds
        */
        getDuration: function () {
            this.log("getDuration");

            return new Date().getTime() - this._durationStart;
        },

        /**
            Locally set the progress towards completion

            @method setProgress
            @param {Integer} progress progress as a percentage between 0 and 100
            @throws {Error} <ul><li>Not an integer</li><li>Less than zero or greater than 100</li></ul>
        */
        setProgress: function (progress) {
            this.log("setProgress: ", progress);

            if (progress !== null) {
                if (! isInteger(progress)) {
                    throw new Error("Invalid progress measure (not an integer): " + progress);
                }
                if (progress < 0 || progress > 100) {
                    throw new Error("Invalid progress measure must be greater than or equal to 0 and less than or equal to 100: " + progress);
                }
            }
            this._progress = progress;
        },

        /**
            Get progress

            @method getProgress
            @return {Integer|null} Integer value of locally set progress measure or null when not set
        */
        getProgress: function () {
            this.log("getProgress");

            return this._progress;
        },

        /**
            Set the fetch URL, called by the `Cmi5` constructor when provided a launch URL

            @method setFetch
            @param {String} fetchURL fetchURL as provided by the LMS in the launch string
        */
        setFetch: function (fetchURL) {
            var urlParts,
                schemeMatches,
                locationPort,
                isXD;

            this.log("setFetch: ", fetchURL);

            this._fetch = fetchURL;

            //
            // default to native request mode
            //
            this._fetchRequest = nativeRequest;

            // TODO: swap this for uri.js

            urlParts = fetchURL.toLowerCase().match(/([A-Za-z]+:)\/\/([^:/]+):?(\d+)?(\/.*)?$/);
            if (urlParts === null) {
                throw new Error("URL invalid: failed to divide URL parts");
            }

            //
            // determine whether this is a cross domain request,
            // whether our browser has CORS support at all, and then
            // if it does then if we are in IE with XDR only check that
            // the schemes match to see if we should be able to talk to
            // the other side
            //
            locationPort = location.port;
            schemeMatches = location.protocol.toLowerCase() === urlParts[1];

            //
            // normalize the location.port cause it appears to be "" when 80/443
            // but our endpoint may have provided it
            //
            if (locationPort === "") {
                locationPort = location.protocol.toLowerCase() === "http:" ? "80" : location.protocol.toLowerCase() === "https:" ? "443" : "";
            }

            isXD

                // is same scheme?
                = ! schemeMatches

                // is same host?
                || location.hostname.toLowerCase() !== urlParts[2]

                // is same port?
                || locationPort !== (
                    urlParts[3] !== null && typeof urlParts[3] !== "undefined" && urlParts[3] !== ""
                        ? urlParts[3]
                        : urlParts[1] === "http:" ? "80" : urlParts[1] === "https:" ? "443" : ""
                )
            ;
            if (isXD) {
                if (env.hasCORS) {
                    if (env.useXDR && schemeMatches) {
                        this._fetchRequest = xdrRequest;
                    }
                    else if (env.useXDR && ! schemeMatches) {
                        this.log("[error] URL invalid: cross domain request for differing scheme in IE with XDR");
                        throw new Error("URL invalid: cross domain request for differing scheme in IE with XDR");
                    }
                }
                else {
                    this.log("[error] URL invalid: cross domain requests not supported in this browser");
                    throw new Error("URL invalid: cross domain requests not supported in this browser");
                }
            }
        },

        /**
            Retrieve the fetch URL

            @method getFetch
            @return {String} the previous set fetch URL
        */
        getFetch: function () {
            return this._fetch;
        },

        /**
            Initialize the LRS to a `TinCan.LRS` object or update the existing object which will be used for all xAPI communications

            Called by the `Cmi5` constructor when provided a launch URL.

            @method setLRS
            @param {String} endpoint LRS location
            @param {String} auth Authentication token value
        */
        setLRS: function (endpoint, auth) {
            this.log("setLRS: ", endpoint, auth);
            if (this._lrs !== null) {
                if ((typeof auth === "undefined" && endpoint === null) || endpoint !== null) {
                    this._endpoint = this._lrs.endpoint = endpoint;
                }
                if (typeof auth !== "undefined" && auth !== null) {
                    this._lrs.auth = auth;
                }
            }
            else {
                this._lrs = new TinCan.LRS(
                    {
                        endpoint: endpoint,
                        auth: auth,
                        allowFail: false
                    }
                );
            }
        },

        /**
            Retrieve the `TinCan.LRS` object

            @method getLRS
            @return {TinCan.LRS} LRS object
        */
        getLRS: function () {
            return this._lrs;
        },

        /**
            Initialize the actor using a `TinCan.Agent` that will represent the learner

            Called by the `Cmi5` constructor when provided a launch URL.

            @method setActor
            @param {String|TinCan.Agent} agent Pre-constructed Agent or string of JSON used to construct Agent
            @throws {Error} <ul><li>Invalid actor, missing account IFI</li><li>Invalid account IFI</li></ul>
        */
        setActor: function (agent) {
            if (! (agent instanceof TinCan.Agent)) {
                agent = TinCan.Agent.fromJSON(agent);
            }

            //
            // don't generally want to do too much validation as the LMS
            // should be giving us valid information, *but* in this case
            // users need to be able to count on the type of object being
            // returned
            //
            if ((agent.account === null) || ! (agent.account instanceof TinCan.AgentAccount)) {
                throw new Error("Invalid actor: missing or invalid account");
            }
            else if (agent.account.name === null) {
                throw new Error("Invalid actor: name is null");
            }
            else if (agent.account.name === "") {
                throw new Error("Invalid actor: name is empty");
            }
            else if (agent.account.homePage === null) {
                throw new Error("Invalid actor: homePage is null");
            }
            else if (agent.account.homePage === "") {
                throw new Error("Invalid actor: homePage is empty");
            }

            this._actor = agent;
        },

        /**
            Retrieve the `TinCan.Agent` object representing the learner

            @method getActor
            @return {TinCan.Agent} Learner's Agent
        */
        getActor: function () {
            return this._actor;
        },

        /**
            Initialize the root object representing the AU

            Called by the `Cmi5` constructor when provided a launch URL.

            @method setActivity
            @param {String|TinCan.Activity} activity Pre-constructed Activity or string id used to construct Activity
            @throws {Error} <ul><li>Invalid activity, null id</li><li>Invalid activity, empty string id</li></ul>
        */
        setActivity: function (activity) {
            if (! (activity instanceof TinCan.Activity)) {
                activity = new TinCan.Activity(
                    {
                        id: activity
                    }
                );
            }

            if (activity.id === null) {
                throw new Error("Invalid activity: id is null");
            }
            else if (activity.id === "") {
                throw new Error("Invalid activity: id is empty");
            }

            this._activity = activity;
        },

        /**
            Retrieve the `TinCan.Activity` that is the root object representing the AU

            @method getActivity
            @return {TinCan.Activity} Root Activity
        */
        getActivity: function () {
            return this._activity;
        },

        /**
            Set the registration value

            Called by the `Cmi5` constructor when provided a launch URL.

            @method setRegistration
            @param {String} registration UUID representing the registration
            @throws {Error} <ul><li>Invalid registration, null</li><li>Invalid registration, empty string</li></ul>
        */
        setRegistration: function (registration) {
            if (registration === null) {
                throw new Error("Invalid registration: null");
            }
            else if (registration === "") {
                throw new Error("Invalid registration: empty");
            }

            this._registration = registration;
        },

        /**
            Retrieve the registration associated with the session

            @method getRegistration
            @return {String} Registration
        */
        getRegistration: function () {
            return this._registration;
        },

        /**
            Validate a Score object's properties

            @method validateScore
            @param {TinCan.Score|Object} score Score object to validate
            @throws {Error} <ul><li>Null or missing score argument</li><li>Non-integer min or max value (when provided)</li><li>Non-number, negative, or greater than 1 scaled value (when provided)</li><li>Non-integer, missing or invalid min/max, raw value (when provided)</li></ul>
            @return {Boolean} true for passing, otherwise exception is thrown
        */
        validateScore: function (score) {
            if (typeof score === "undefined" || score === null) {
                throw new Error("cannot validate score (score not provided): " + score);
            }

            if (typeof score.min !== "undefined") {
                if (! isInteger(score.min)) {
                    throw new Error("score.min is not an integer");
                }
            }
            if (typeof score.max !== "undefined") {
                if (! isInteger(score.max)) {
                    throw new Error("score.max is not an integer");
                }
            }

            if (typeof score.scaled !== "undefined") {
                if (! /^(-|\+)?[01]+(\.[0-9]+)?$/.test(score.scaled)) {
                    throw new Error("scaled score not a recognized number: " + score.scaled);
                }

                if (score.scaled < 0) {
                    throw new Error("scaled score must be greater than or equal to 0");
                }
                if (score.scaled > 1) {
                    throw new Error("scaled score must be less than or equal to 1");
                }
            }

            if (typeof score.raw !== "undefined") {
                if (! isInteger(score.raw)) {
                    throw new Error("score.raw is not an integer");
                }
                if (typeof score.min === "undefined") {
                    throw new Error("minimum score must be provided when including a raw score");
                }
                if (typeof score.max === "undefined") {
                    throw new Error("maximum score must be provided when including a raw score");
                }
                if (score.raw < score.min) {
                    throw new Error("raw score must be greater than or equal to minimum score");
                }
                if (score.raw > score.max) {
                    throw new Error("raw score must be less than or equal to maximum score");
                }
            }

            return true;
        },

        /**
            Prepare a cmi5 "allowed" statement including the actor, verb, object, and context

            Used to construct a cmi5 "allowed" statement with all relevant information that can then be optionally added to prior to sending.

            @method prepareStatement
            @param {String} verbId Verb identifier combined with other cmi5 pre-determined information (must be IRI)
            @return {TinCan.Statement} Statement
        */
        prepareStatement: function (verbId) {
            //
            // the specification allows for statements that are 'cmi5 allowed'
            // as oppposed to 'cmi5 defined' to be sent by the AU, so give the
            // AU the ability to get a prepared statement with a populated context
            // based on the template but without the category having been added
            //
            var stCfg = {
                    actor: this._actor,
                    verb: {
                        id: verbId
                    },
                    target: this._activity,
                    context: this._prepareContext()
                },
                progress = this.getProgress();

            if (typeof verbDisplay[verbId] !== "undefined") {
                stCfg.verb.display = verbDisplay[verbId];
            }

            if (verbId !== VERB_COMPLETED_ID && progress !== null) {
                stCfg.result = {
                    extensions: {
                        "https://w3id.org/xapi/cmi5/result/extensions/progress": progress
                    }
                };
            }

            return new TinCan.Statement(stCfg);
        },

        /**
            Store provided statement in the configured LRS

            @method sendStatement
            @param {TinCan.Statement} st Statement to be stored
            @param {Function} [callback] Function to run on success/failure of statement save
        */
        sendStatement: function (st, callback) {
            var cbWrapper,
                result;

            if (callback) {
                cbWrapper = function (err, result) {
                    if (err !== null) {
                        callback(new Error(err), result);

                        return;
                    }

                    callback(err, result, st);
                };
            }

            result = this._lrs.saveStatement(
                st,
                {
                    callback: cbWrapper
                }
            );
            if (! callback) {
                return {
                    response: result,
                    statement: st
                };
            }
        },

        /*
         * The ...Statement methods are provided for users that want to implement
         * a queueing like mechansim or something similar where they are expected
         * to abide by the AU restrictions on what statements can be sent, etc. on
         * their own.
         *
         * (Such as in SCORM Driver which was the impetus for adding them.)
        */

        /**
            Advanced Usage: retrieve prepared "initialized" statement

            Statement methods are provided for users that want to implement
            a queueing like mechansim or something similar where they are expected
            to abide by the AU restrictions on what statements can be sent, etc. on
            their own.

            @method initializedStatement
            @return {TinCan.Statement} Initialized statement
        */
        initializedStatement: function () {
            this.log("initializedStatement");

            return this._prepareStatement(VERB_INITIALIZED_ID);
        },

        /**
            Advanced Usage: retrieve prepared "terminated" statement

            Statement methods are provided for users that want to implement
            a queueing like mechansim or something similar where they are expected
            to abide by the AU restrictions on what statements can be sent, etc. on
            their own.

            @method terminatedStatement
            @return {TinCan.Statement} Terminated statement
        */
        terminatedStatement: function () {
            var st = this._prepareStatement(VERB_TERMINATED_ID);

            this.log("terminatedStatement");

            st.result = st.result || new TinCan.Result();
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            return st;
        },

        /**
            Advanced Usage: retrieve prepared "passed" statement

            Statement methods are provided for users that want to implement
            a queueing like mechansim or something similar where they are expected
            to abide by the AU restrictions on what statements can be sent, etc. on
            their own.

            @method passedStatement
            @param {Object} [score] Object to be used as the score, must meet masteryScore requirements, etc.
            @return {TinCan.Statement} Passed statement
        */
        passedStatement: function (score) {
            var st = this._prepareStatement(VERB_PASSED_ID),
                masteryScore;

            this.log("passedStatement");

            st.result = st.result || new TinCan.Result();
            st.result.success = true;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            if (score) {
                try {
                    this.validateScore(score);
                }
                catch (ex) {
                    throw new Error("Invalid score - " + ex);
                }

                masteryScore = this.getMasteryScore();
                if (masteryScore !== null && typeof score.scaled !== "undefined") {
                    if (score.scaled < masteryScore) {
                        throw new Error("Invalid score - scaled score does not meet or exceed mastery score (" + score.scaled + " < " + masteryScore + ")");
                    }

                    st.context.extensions = st.context.extensions || {};
                    st.context.extensions[EXTENSION_MASTERY_SCORE] = masteryScore;
                }

                st.result.score = new TinCan.Score(score);
            }

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        /**
            Advanced Usage: retrieve prepared "failed" statement

            Statement methods are provided for users that want to implement
            a queueing like mechansim or something similar where they are expected
            to abide by the AU restrictions on what statements can be sent, etc. on
            their own.

            @method failedStatement
            @param {Object} [score] Object to be used as the score, must meet masteryScore requirements, etc.
            @return {TinCan.Statement} Failed statement
        */
        failedStatement: function (score) {
            var st = this._prepareStatement(VERB_FAILED_ID),
                masteryScore;

            this.log("failedStatement");

            st.result = st.result || new TinCan.Result();
            st.result.success = false;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            if (score) {
                try {
                    this.validateScore(score);
                }
                catch (ex) {
                    throw new Error("Invalid score - " + ex);
                }

                masteryScore = this.getMasteryScore();
                if (masteryScore !== null && typeof score.scaled !== "undefined") {
                    if (score.scaled >= masteryScore) {
                        throw new Error("Invalid score - scaled score exceeds mastery score (" + score.scaled + " >= " + masteryScore + ")");
                    }

                    st.context.extensions = st.context.extensions || {};
                    st.context.extensions[EXTENSION_MASTERY_SCORE] = masteryScore;
                }

                st.result.score = new TinCan.Score(score);
            }

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        /**
            Advanced Usage: retrieve prepared "completed" statement

            Statement methods are provided for users that want to implement
            a queueing like mechansim or something similar where they are expected
            to abide by the AU restrictions on what statements can be sent, etc. on
            their own.

            @method completedStatement
            @return {TinCan.Statement} Completed statement
        */
        completedStatement: function () {
            var st = this._prepareStatement(VERB_COMPLETED_ID);

            this.log("completedStatement");

            st.result = st.result || new TinCan.Result();
            st.result.completion = true;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        /**
            @method _prepareContext
            @private
        */
        _prepareContext: function () {
            //
            // deserializing a string version of the template is slower
            // but gives us cheap cloning capability so that we don't
            // alter the template itself
            //
            var context = JSON.parse(this._contextTemplate);

            context.registration = this._registration;

            if (this._includeSourceActivity) {
                context.contextActivities = context.contextActivities || new TinCan.ContextActivities();
                context.contextActivities.other = context.contextActivities.other || [];
                context.contextActivities.other.push(OTHER_ACTIVITY_CMI5JS);
            }

            return context;
        },

        /**
            @method _prepareStatement
            @private
        */
        _prepareStatement: function (verbId) {
            //
            // statements sent by this lib are "cmi5 defined" statements meaning
            // they have the context category value added
            //
            var st = this.prepareStatement(verbId);

            st.context.contextActivities = st.context.contextActivities || new TinCan.ContextActivities();
            st.context.contextActivities.category = st.context.contextActivities.category || [];
            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_CMI5);

            return st;
        },

        /**
            @method _appendProvidedProperties
            @private
        */
        _appendProvidedProperties: function (st, additionalProperties) {
            //
            // If any additional properties were provided to be added to the statement, do so here. This allows for
            // xAPI profile extensibility
            //
            var property;

            if (typeof additionalProperties.context !== "undefined") {
                if (typeof additionalProperties.context.extensions !== "undefined") {
                    for (property in additionalProperties.context.extensions) {
                        if (additionalProperties.context.extensions.hasOwnProperty(property)) {
                            st.context.extensions[property] = additionalProperties.context.extensions[property];
                        }
                    }
                }
            }

            if (typeof additionalProperties.result !== "undefined") {
                st.result = st.result || new TinCan.Result();
                st.result.extensions = st.result.extensions || {};

                if (typeof additionalProperties.result.extensions !== "undefined") {
                    for (property in additionalProperties.result.extensions) {
                        if (additionalProperties.result.extensions.hasOwnProperty(property)) {
                            st.result.extensions[property] = additionalProperties.result.extensions[property];
                        }
                    }
                }
            }

            if (typeof additionalProperties.target !== "undefined") {
                if (typeof additionalProperties.target.definition !== "undefined") {
                    st.target.definition = st.target.definition || new TinCan.ActivityDefinition();

                    if (typeof additionalProperties.target.definition.type !== "undefined") {
                        st.target.definition.type = additionalProperties.target.definition.type;
                    }
                }
            }
        }
    };

    /**
        Turn on debug logging

        @method enableDebug
        @static
        @param {Boolean} [includeTinCan] Whether to enable debug logging from TinCanJS
    */
    Cmi5.enableDebug = function (includeTinCan) {
        Cmi5.DEBUG = true;

        if (includeTinCan) {
            TinCan.enableDebug();
        }
    };

    /**
        Turn off debug logging

        @method disableDebug
        @static
        @param {Boolean} [includeTinCan] Whether to disable debug logging from TinCanJS
    */
    Cmi5.disableDebug = function (includeTinCan) {
        Cmi5.DEBUG = false;

        if (includeTinCan) {
            TinCan.disableDebug();
        }
    };

    //
    // Setup request callback
    //
    requestComplete = function (xhr, cfg, control, callback) {
        var requestCompleteResult,
            notFoundOk,
            httpStatus;

        this.log("requestComplete: " + control.finished + ", xhr.status: " + xhr.status);

        //
        // XDomainRequest doesn't give us a way to get the status,
        // so allow passing in a forged one
        //
        if (typeof xhr.status === "undefined") {
            httpStatus = control.fakeStatus;
        }
        else {
            //
            // older versions of IE don't properly handle 204 status codes
            // so correct when receiving a 1223 to be 204 locally
            // http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
            //
            httpStatus = xhr.status === 1223 ? 204 : xhr.status;
        }

        if (! control.finished) {
            // may be in sync or async mode, using XMLHttpRequest or IE XDomainRequest, onreadystatechange or
            // onload or both might fire depending upon browser, just covering all bases with event hooks and
            // using 'finished' flag to avoid triggering events multiple times
            control.finished = true;

            notFoundOk = cfg.ignore404 && httpStatus === 404;
            if ((httpStatus >= 200 && httpStatus < 400) || notFoundOk) {
                if (callback) {
                    callback(null, xhr);
                }
                else {
                    requestCompleteResult = {
                        err: null,
                        xhr: xhr
                    };

                    return requestCompleteResult;
                }
            }
            else {
                requestCompleteResult = {
                    err: httpStatus,
                    xhr: xhr
                };
                if (httpStatus === 0) {
                    this.log("[warning] There was a problem communicating with the server. Aborted, offline, or invalid CORS endpoint (" + httpStatus + ")");
                }
                else {
                    this.log("[warning] There was a problem communicating with the server. (" + httpStatus + " | " + xhr.responseText + ")");
                }
                if (callback) {
                    callback(httpStatus, xhr);
                }

                return requestCompleteResult;
            }
        }
        else {
            return requestCompleteResult;
        }
    };

    //
    // one of the two of these is stuffed into the Cmi5 instance where a
    // request is needed which is fetch at the moment
    //
    nativeRequest = function (fullUrl, cfg, callback) {
        var self = this,
            xhr,
            prop,
            pairs = [],
            data,
            control = {
                finished: false,
                fakeStatus: null
            },
            async,
            fullRequest = fullUrl;

        this.log("sendRequest using XMLHttpRequest - async: " + async);

        cfg = cfg || {};
        cfg.params = cfg.params || {};
        cfg.headers = cfg.headers || {};

        async = typeof callback !== "undefined";

        for (prop in cfg.params) {
            if (cfg.params.hasOwnProperty(prop)) {
                pairs.push(prop + "=" + encodeURIComponent(cfg.params[prop]));
            }
        }
        if (pairs.length > 0) {
            fullRequest += "?" + pairs.join("&");
        }

        xhr = new XMLHttpRequest();

        xhr.open(cfg.method, fullRequest, async);
        for (prop in cfg.headers) {
            if (cfg.headers.hasOwnProperty(prop)) {
                xhr.setRequestHeader(prop, cfg.headers[prop]);
            }
        }

        if (typeof cfg.data !== "undefined") {
            cfg.data += "";
        }
        data = cfg.data;

        if (async) {
            xhr.onreadystatechange = function () {
                self.log("xhr.onreadystatechange - xhr.readyState: " + xhr.readyState);
                if (xhr.readyState === 4) {
                    requestComplete.call(self, xhr, cfg, control, callback);
                }
            };
        }

        //
        // research indicates that IE is known to just throw exceptions
        // on .send and it seems everyone pretty much just ignores them
        // including jQuery (https://github.com/jquery/jquery/blob/1.10.2/src/ajax.js#L549
        // https://github.com/jquery/jquery/blob/1.10.2/src/ajax/xhr.js#L97)
        //
        try {
            xhr.send(data);
        }
        catch (ex) {
            this.log("sendRequest caught send exception: " + ex);
        }

        if (async) {
            return;
        }

        return requestComplete.call(this, xhr, cfg, control);
    };
    xdrRequest = function (fullUrl, cfg, callback) {
        var self = this,
            xhr,
            pairs = [],
            data,
            prop,
            until,
            control = {
                finished: false,
                fakeStatus: null
            },
            err;

        this.log("sendRequest using XDomainRequest");

        cfg = cfg || {};
        cfg.params = cfg.params || {};
        cfg.headers = cfg.headers || {};

        if (typeof cfg.headers["Content-Type"] !== "undefined" && cfg.headers["Content-Type"] !== "application/json") {
            err = new Error("Unsupported content type for IE Mode request");
            if (callback) {
                callback(err, null);

                return null;
            }

            return {
                err: err,
                xhr: null
            };
        }

        for (prop in cfg.params) {
            if (cfg.params.hasOwnProperty(prop)) {
                pairs.push(prop + "=" + encodeURIComponent(cfg.params[prop]));
            }
        }

        if (pairs.length > 0) {
            fullUrl += "?" + pairs.join("&");
        }

        xhr = new XDomainRequest();
        xhr.open("POST", fullUrl);

        if (! callback) {
            xhr.onload = function () {
                control.fakeStatus = 200;
            };
            xhr.onerror = function () {
                control.fakeStatus = 400;
            };
            xhr.ontimeout = function () {
                control.fakeStatus = 0;
            };
        }
        else {
            xhr.onload = function () {
                control.fakeStatus = 200;
                requestComplete.call(self, xhr, cfg, control, callback);
            };
            xhr.onerror = function () {
                control.fakeStatus = 400;
                requestComplete.call(self, xhr, cfg, control, callback);
            };
            xhr.ontimeout = function () {
                control.fakeStatus = 0;
                requestComplete.call(self, xhr, cfg, control, callback);
            };
        }

        //
        // IE likes to randomly abort requests when some handlers
        // aren't defined, so define them with no-ops, see:
        //
        // http://cypressnorth.com/programming/internet-explorer-aborting-ajax-requests-fixed/
        // http://social.msdn.microsoft.com/Forums/ie/en-US/30ef3add-767c-4436-b8a9-f1ca19b4812e/ie9-rtm-xdomainrequest-issued-requests-may-abort-if-all-event-handlers-not-specified
        //
        xhr.onprogress = function () {}; // eslint-disable-line no-empty-function
        xhr.timeout = 0;

        //
        // research indicates that IE is known to just throw exceptions
        // on .send and it seems everyone pretty much just ignores them
        // including jQuery (https://github.com/jquery/jquery/blob/1.10.2/src/ajax.js#L549
        // https://github.com/jquery/jquery/blob/1.10.2/src/ajax/xhr.js#L97)
        //
        try {
            xhr.send(data);
        }
        catch (ex) {
            this.log("sendRequest caught send exception: " + ex);
        }

        if (! callback) {
            // synchronous call in IE, with no synchronous mode available
            until = 10000 + Date.now();
            this.log("sendRequest - until: " + until + ", finished: " + control.finished);

            while (Date.now() < until && control.fakeStatus === null) {
                __delay();
            }

            return requestComplete.call(self, xhr, cfg, control);
        }
    };

    /**
        Non-environment safe method used to create a delay to give impression
        of synchronous response (for IE, shocker)

        @method __delay
        @private
    */
    __delay = function () {
        //
        // use a synchronous request to the current location to allow the browser
        // to yield to the asynchronous request's events but still block in the
        // outer loop to make it seem synchronous to the end user
        //
        // removing this made the while loop too tight to allow the asynchronous
        // events through to get handled so that the response was correctly handled
        //
        var xhr = new XMLHttpRequest(),
            url = window.location + "?forcenocache=" + TinCan.Utils.getUUID();

        xhr.open("GET", url, false);
        xhr.send(null);
    };
}());
