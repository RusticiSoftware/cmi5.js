var Cmi5;

(function () {
    "use strict";
    var nativeRequest,
        xdrRequest,
        requestComplete,
        __delay,
        env = {},
        STATE_LMS_LAUNCHDATA = "LMS.LaunchData",
        LAUNCH_MODE_NORMAL = "Normal",
        AGENT_PROFILE_LEARNER_PREFS = "CMI5LearnerPreferences",
        CATEGORY_ACTIVITY_CMI5 = new TinCan.Activity(
            {
                id: "http://purl.org/xapi/cmi5/context/categories/cmi5"
            }
        ),
        CATEGORY_ACTIVITY_MOVEON = new TinCan.Activity(
            {
                id: "http://purl.org/xapi/cmi5/context/categories/moveon"
            }
        ),
        EXTENSION_SESSION_ID = {
            id: "http://purl.org/xapi/cmi5/context/extensions/sessionid"
        },
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
        ];

    verbDisplay[VERB_INITIALIZED_ID] = {
        "en": "initialized"
    };
    verbDisplay[VERB_TERMINATED_ID] = {
        "en": "terminated"
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
        Cmi5 base object

        @module Cmi5
    */
    Cmi5 = function (launchString) {
        this.log("constructor", launchString);
        var url,
            cfg,
            i;

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
        @property DEBUG
        @static
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
        _inProgress: false,
        _initialized: null,
        _passed: null,
        _failed: null,
        _completed: null,
        _terminated: null,
        _durationStart: null,

        /**
            @method start
        */
        start: function (callback, events) {
            this.log("start");
            var self = this;

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
                                }
                            );
                        }
                    );
                }
            );
        },

        /**
            @method postFetch
        */
        postFetch: function (callback) {
            this.log("postFetch");
            var self = this,
                cbWrapper;

            if (this._fetch === null) {
                callback(new Error("Can't POST to fetch URL without setFetch"));
                return;
            }

            if (callback) {
                cbWrapper = function (err, xhr) {
                    /* jshint maxdepth: 5 */
                    self.log("postFetch::cbWrapper");
                    self.log("postFetch::cbWrapper", err);
                    self.log("postFetch::cbWrapper", xhr);
                    var parsed,
                        responseContent = xhr.responseText,
                        responseContentType;

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
            @method loadLMSLaunchData
        */
        loadLMSLaunchData: function (callback) {
            this.log("loadLMSLaunchData");
            var self = this;

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
            @method loadLearnerPrefs
        */
        loadLearnerPrefs: function (callback) {
            this.log("loadLearnerPrefs");
            var self = this;

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
            @method saveLearnerPrefs
        */
        saveLearnerPrefs: function (callback) {
            this.log("saveLearnerPrefs");
            var self = this,
                result,
                cbWrapper;

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
                        (typeof val === "object" && TinCan.Utils.isApplicationJSON(self._learnerPrefs.contentType))
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
                (typeof val === "object" && TinCan.Utils.isApplicationJSON(self._learnerPrefs.contentType))
                    ? JSON.stringify(self._learnerPrefs.contents)
                    : self._learnerPrefs.contents
            );

            return;
        },

        /**
            @method initialize
        */
        initialize: function (callback) {
            this.log("initialize");
            var st,
                err;

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

            this._initialized = true;
            this._inProgress = true;
            this._durationStart = new Date().getTime();

            st = this.initializedStatement();
            return this.sendStatement(st, callback);
        },

        /**
            @method terminate
        */
        terminate: function (callback) {
            this.log("terminate");
            var st,
                err;

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

            this._terminated = true;
            this._inProgress = false;

            st = this.terminatedStatement();
            return this.sendStatement(st, callback);
        },

        /**
            @method completed
        */
        completed: function (callback) {
            this.log("completed");
            var st,
                err;

            if (! this.inProgress()) {
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

            this._completed = true;

            st = this.completedStatement();
            return this.sendStatement(st, callback);
        },

        /**
            @method passed
        */
        passed: function (score, callback) {
            this.log("passed");
            var st,
                err,
                callbackWrapper,
                result;

            if (! this.inProgress()) {
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

            if (this._failed !== null || this._passed !== null) {
                this.log("passed - already passed/failed");
                err = new Error("AU already passed/failed");

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
            @method failed
        */
        failed: function (score, callback) {
            this.log("failed");
            var st,
                err,
                callbackWrapper,
                result;

            if (! this.inProgress()) {
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
            @method inProgress
        */
        inProgress: function () {
            this.log("inProgress");
            return this._inProgress;
        },

        /**
            Safe version of logging, only displays when .DEBUG is true, and console.log
            is available

            @method log
        */
        log: function () {
            /* globals console */
            if (Cmi5.DEBUG && typeof console !== "undefined" && console.log) {
                arguments[0] = "cmi5.js:" + arguments[0];
                console.log.apply(console, arguments);
            }
        },

        /**
            @method getLaunchMethod
        */
        getLaunchMethod: function () {
            this.log("getLaunchMethod");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine launchMethod until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.launchMethod;
        },

        /**
            @method getLaunchMode
        */
        getLaunchMode: function () {
            this.log("getLaunchMode");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine launchMode until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.launchMode;
        },

        /**
            @method getLaunchParameters
        */
        getLaunchParameters: function () {
            this.log("getLaunchParameters");
            var result = null;

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine LaunchParameters until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.launchParameters !== "undefined") {
                result = this._lmsLaunchData.launchParameters;
            }

            return result;
        },

        /**
            @method getSessionId
        */
        getSessionId: function () {
            this.log("getSessionId");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine launchMode until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.contextTemplate.extensions[EXTENSION_SESSION_ID.id];
        },

        /**
            @method getMoveOn
        */
        getMoveOn: function () {
            this.log("getMoveOn");
            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine moveOn until LMS LaunchData has been loaded");
            }

            return this._lmsLaunchData.moveOn;
        },

        /**
            @method getMasteryScore
        */
        getMasteryScore: function () {
            this.log("getMasteryScore");
            var result = null;

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine masteryScore until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.masteryScore !== "undefined") {
                result = this._lmsLaunchData.masteryScore;
            }

            return result;
        },

        /**
            @method getReturnUrl
        */
        getReturnUrl: function () {
            this.log("getReturnUrl");
            var result = null;

            if (this._lmsLaunchData === null) {
                throw new Error("Can't determine returnUrl until LMS LaunchData has been loaded");
            }

            if (typeof this._lmsLaunchData.returnUrl !== "undefined") {
                result = this._lmsLaunchData.returnUrl;
            }

            return result;
        },

        /**
            @method getEntitlementKey
        */
        getEntitlementKey: function () {
            this.log("getEntitlementKey");
            var result = null;

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
            @method getLanguagePreference
        */
        getLanguagePreference: function () {
            this.log("getLanguagePreference");
            var result = null;

            if (this._learnerPrefs === null) {
                throw new Error("Can't determine language preference until learner preferences have been loaded");
            }

            if (typeof this._learnerPrefs.contents.languagePreference !== "undefined") {
                result = this._learnerPrefs.contents.languagePreference;
            }

            return result;
        },

        /**
            @method setLanguagePreference
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

            return;
        },

        /**
            @method getAudioPreference
        */
        getAudioPreference: function () {
            this.log("getAudioPreference");
            var result = null;

            if (this._learnerPrefs === null) {
                throw new Error("Can't determine audio preference until learner preferences have been loaded");
            }

            if (typeof this._learnerPrefs.contents.audioPreference !== "undefined") {
                result = this._learnerPrefs.contents.audioPreference;
            }

            return result;
        },

        /**
            @method setAudioPreference
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

            return;
        },

        /**
            @method getDuration
        */
        getDuration: function () {
            this.log("getDuration");

            return (new Date().getTime() - this._durationStart);
        },

        /**
            @method setFetch
        */
        setFetch: function (fetchURL) {
            this.log("setFetch: ", fetchURL);
            var urlParts,
                schemeMatches,
                locationPort,
                isXD;

            this._fetch = fetchURL;

            //
            // default to native request mode
            //
            this._fetchRequest = nativeRequest;

            // TODO: swap this for uri.js

            urlParts = fetchURL.toLowerCase().match(/([A-Za-z]+:)\/\/([^:\/]+):?(\d+)?(\/.*)?$/);
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
                locationPort = (location.protocol.toLowerCase() === "http:" ? "80" : (location.protocol.toLowerCase() === "https:" ? "443" : ""));
            }

            isXD = (

                // is same scheme?
                ! schemeMatches

                // is same host?
                || location.hostname.toLowerCase() !== urlParts[2]

                // is same port?
                || locationPort !== (
                    (urlParts[3] !== null && typeof urlParts[3] !== "undefined" && urlParts[3] !== "")
                        ? urlParts[3]
                        : (urlParts[1] === "http:" ? "80" : (urlParts[1] === "https:" ? "443" : "")
                    )
                )
            );
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
            @method getFetch
        */
        getFetch: function () {
            return this._fetch;
        },

        /**
            @method setLRS
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
            @method getLRS
        */
        getLRS: function () {
            return this._lrs;
        },

        /**
            @method setActor
        */
        setActor: function (actorJSON) {
            this._actor = TinCan.Agent.fromJSON(actorJSON);
        },

        /**
            @method getActor
        */
        getActor: function () {
            return this._actor;
        },

        /**
            @method setActivity
        */
        setActivity: function (activityId) {
            this._activity = new TinCan.Activity(
                {
                    id: activityId
                }
            );
        },

        /**
            @method getActivity
        */
        getActivity: function () {
            return this._activity;
        },

        /**
            @method setRegistration
        */
        setRegistration: function (registration) {
            this._registration = registration;
        },

        /**
            @method getRegistration
        */
        getRegistration: function () {
            return this._registration;
        },

        /**
            @method prepareStatement
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
            };

            if (typeof verbDisplay[verbId] !== "undefined") {
                stCfg.verb.display = verbDisplay[verbId];
            }

            return new TinCan.Statement(stCfg);
        },

        /**
            @method sendStatement
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
            @method initializedStatement
        */
        initializedStatement: function () {
            this.log("initializedStatement");
            return this._prepareStatement(VERB_INITIALIZED_ID);
        },

        /**
            @method terminatedStatement
        */
        terminatedStatement: function () {
            this.log("terminatedStatement");
            var st = this._prepareStatement(VERB_TERMINATED_ID);

            st.result = st.result || new TinCan.Result();
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            return st;
        },

        /**
            @method passedStatement
        */
        passedStatement: function (score) {
            this.log("passedStatement");
            var st = this._prepareStatement(VERB_PASSED_ID),
                masteryScore;

            st.result = st.result || new TinCan.Result();
            st.result.success = true;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            if (score) {
                try {
                    this._validateScore(score);
                }
                catch (ex) {
                    throw new Error("Invalid score - " + ex);
                }

                masteryScore = this.getMasteryScore();
                if (masteryScore !== null && typeof score.scaled !== "undefined") {
                    if (score.scaled < masteryScore) {
                        throw new Error("Invalid score - scaled score does not meet or exceed mastery score (" + score.scaled + " < " + masteryScore + ")");
                    }
                }

                st.result.score = new TinCan.Score(score);
            }

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        /**
            @method failedStatement
        */
        failedStatement: function (score) {
            this.log("failedStatement");
            var st = this._prepareStatement(VERB_FAILED_ID),
                masteryScore;

            st.result = st.result || new TinCan.Result();
            st.result.success = false;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            if (score) {
                try {
                    this._validateScore(score);
                }
                catch (ex) {
                    throw new Error("Invalid score - " + ex);
                }

                masteryScore = this.getMasteryScore();
                if (masteryScore !== null && typeof score.scaled !== "undefined") {
                    if (score.scaled >= masteryScore) {
                        throw new Error("Invalid score - scaled score exceeds mastery score (" + score.scaled + " >= " + masteryScore + ")");
                    }
                }

                st.result.score = new TinCan.Score(score);
            }

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        /**
            @method completedStatement
        */
        completedStatement: function () {
            this.log("completedStatement");
            var st = this._prepareStatement(VERB_COMPLETED_ID);

            st.result = st.result || new TinCan.Result();
            st.result.completion = true;
            st.result.duration = TinCan.Utils.convertMillisecondsToISO8601Duration(this.getDuration());

            st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

            return st;
        },

        _prepareContext: function () {
            //
            // deserializing a string version of the template is slower
            // but gives us cheap cloning capability so that we don't
            // alter the template itself
            //
            var context = JSON.parse(this._contextTemplate);

            context.registration = this._registration;

            return context;
        },

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

        _validateScore: function (score) {
            // polyfill for Number.isInteger from MDN
            var isInteger = function (value) {
                return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
            };

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
                if (! /^(\-|\+)?[01]+(\.[0-9]+)?$/.test(score.scaled)) {
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
        }
    };

    /**
        Turn on debug logging

        @method enableDebug
        @static
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
        this.log("requestComplete: " + control.finished + ", xhr.status: " + xhr.status);
        var requestCompleteResult,
            notFoundOk,
            httpStatus;

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
            httpStatus = (xhr.status === 1223) ? 204 : xhr.status;
        }

        if (! control.finished) {
            // may be in sync or async mode, using XMLHttpRequest or IE XDomainRequest, onreadystatechange or
            // onload or both might fire depending upon browser, just covering all bases with event hooks and
            // using 'finished' flag to avoid triggering events multiple times
            control.finished = true;

            notFoundOk = (cfg.ignore404 && httpStatus === 404);
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
        this.log("sendRequest using XMLHttpRequest");
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
        this.log("sendRequest using XDomainRequest");
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
        xhr.onprogress = function () {};
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

        return;
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
