var CMI5;

(function () {
    /* globals window, XMLHttpRequest, XDomainRequest */
    "use strict";
    var nativeRequest,
        xdrRequest,
        requestComplete,
        __delay,
        env = {},
        STATE_LMS_LAUNCHDATA = "LMS.LaunchData",
        CATEGORY_ACTIVITY_CMI5 = { id: "http://purl.org/xapi/cmi5/context/categories/cmi5" },
        CATEGORY_ACTIVITY_MOVEON = { id: "http://purl.org/xapi/cmi5/context/categories/moveon" },
        EXTENSION_SESSION_ID = { id: "http://purl.org/xapi/cmi5/context/extensions/sessionid" },
        VERB_INITIALIZED_ID = "http://adlnet.gov/expapi/verbs/initialized",
        VERB_TERMINATED_ID = "http://adlnet.gov/expapi/verbs/terminated",
        VERB_COMPLETED_ID = "http://adlnet.gov/expapi/verbs/completed",
        VERB_PASSED_ID = "http://adlnet.gov/expapi/verbs/passed",
        VERB_FAILED_ID = "http://adlnet.gov/expapi/verbs/failed",
        VERB_ANSWERED_ID = "http://adlnet.gov/expapi/verbs/answered";

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
        CMI5 base object

        @module CMI5
    */
    CMI5 = function (launchString) {
        this.log("CMI5 constructor", launchString);
        var url = new URI(launchString),
            cfg = url.search(true);

        // TODO: should validate launch string well formed?

        this.setFetch(cfg.fetch);
        this.setLRS(cfg.endpoint);
        this.setActor(cfg.actor);
        this.setActivity(cfg.activityId);
        this.setRegistration(cfg.registration);
    };

    /**
        @property DEBUG
        @static
        @default false
    */
    CMI5.DEBUG = true;

    CMI5.prototype = {
        _fetch: null,
        _endpoint: null,
        _actor: null,
        _registration: null,
        _activity: null,

        _lrs: null,
        _initialized: null,
        _terminated: null,
        _lmsLaunchData: null,
        _contextTemplate: null,

        /**
            @method postFetch
        */
        postFetch: function (callback) {
            this.log("postFetch");
            var self = this,
                cbWrapper;

            if (callback) {
                cbWrapper = function (err, response) {
                    self.log("postFetch::cbWrapper");
                    self.log("postFetch::cbWrapper", err);
                    self.log("postFetch::cbWrapper", response);
                    var auth;
                    if (err === null) {
                        try {
                            auth = JSON.parse(response.responseText);
                        }
                        catch (ex) {
                            self.log("postFetch::cbWrapper - failed to parse JSON response: " + ex);
                            callback("Post fetch failed to parse JSON response: " + ex, response);
                        }

                        self._lrs.auth = "Basic " + auth["auth-token"];
                    }

                    callback(err, response);
                };
            }

            return this._fetchRequest(
                this._fetchURL,
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

            this._lrs.retrieveState(
                STATE_LMS_LAUNCHDATA,
                {
                    activity: this._activity,
                    agent: this._actor,
                    registration: this._registration,
                    callback: function (err, result) {
                        if (err !== null) {
                            callback(err, result);
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
            @method initialize
        */
        initialize: function (callback) {
            this.log("initialize");
            var st;

            if (! this._initialized) {
                this._initialized = true;

                st = this._prepareStatement(VERB_INITIALIZED_ID);
                return this._sendStatement(st, callback);
            }

            this.log("initialize - already initialized");

            if (callback) {
                callback(null);
            }

            return;
        },

        /**
            @method terminate
        */
        terminate: function (callback) {
            this.log("terminate");
            var st;

            if (this._initialized) {
                if (! this._terminated) {
                    this._terminated = true;

                    st = this._prepareStatement(VERB_TERMINATED_ID);
                    return this._sendStatement(st, callback);
                }

                this.log("terminate - already terminated");
            }

            if (callback) {
                callback(null);
            }

            return;
        },

        /**
            @method inProgress
        */
        inProgress: function (callback) {
            this.log("inProgress");
            if (! this._initialized) {
                this.log("inProgress - not initialized");
                if (callback) {
                    callback("AU not in progress");
                }
                return false;
            }
            if (this._terminated) {
                this.log("inProgress - already terminated");
                if (callback) {
                    callback("AU already terminated");
                }
                return false;
            }

            return true;
        },

        /**
            @method passed
        */
        passed: function (callback) {
            this.log("passed");
        },

        /**
            @method failed
        */
        failed: function (callback) {
            this.log("failed");
            var st,
                sendResult;

            if (! this.inProgress(callback)) {
                return ;
            }

            // TODO: need to check passIsFinal?

            st = this._prepareStatement(VERB_FAILED_ID);
            sendResult = this._sendStatement(st, callback);

            // TODO: what do we return?
            return sendResult;
        },

        /**
            Safe version of logging, only displays when .DEBUG is true, and console.log
            is available

            @method log
        */
        log: function () {
            /* globals console */
            if (CMI5.DEBUG && typeof console !== "undefined" && console.log) {
                console.log.apply(console, arguments);
            }
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

            this._fetchURL = fetchURL;

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
                    (urlParts[3] !== null && typeof urlParts[3] !== "undefined" && urlParts[3] !== "") ? urlParts[3] : (urlParts[1] === "http:" ? "80" : (urlParts[1] === "https:" ? "443" : ""))
                )
            );
            if (isXD) {
                if (env.hasCORS) {
                    if (env.useXDR && schemeMatches) {
                        this._fetchRequest = xdrRequest;
                    }
                    else if (env.useXDR && ! schemeMatches) {
                        if (cfg.allowFail) {
                            this.log("[warning] URL invalid: cross domain request for differing scheme in IE with XDR (allowed to fail)");
                        }
                        else {
                            this.log("[error] URL invalid: cross domain request for differing scheme in IE with XDR");
                            throw new Error("URL invalid: cross domain request for differing scheme in IE with XDR");
                        }
                    }
                }
                else {
                    if (cfg.allowFail) {
                        this.log("[warning] URL invalid: cross domain requests not supported in this browser (allowed to fail)");
                    }
                    else {
                        this.log("[error] URL invalid: cross domain requests not supported in this browser");
                        throw new Error("URL invalid: cross domain requests not supported in this browser");
                    }
                }
            }
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
                this._lrs = new TinCan.LRS (
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
            this._activity = new TinCan.Activity({ id: activityId });
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

        _prepareContext: function () {
            //
            // deserializing a string version of the template is slower
            // but gives us cheap cloning capability so that we don't
            // alter the template itself
            //
            var context = JSON.parse(this._contextTemplate);

            context.registration = this._registration;
            context.contextActivities = context.contextActivities || {};
            context.contextActivities.category = context.contextActivities.category || [];

            context.contextActivities.category.push(CATEGORY_ACTIVITY_CMI5);

            return context;
        },

        _prepareStatement: function (verbId) {
            //this.log("_prepareStatement", verbId);
            var stCfg = {
                actor: this._actor,
                verb: {
                    id: verbId
                },
                target: this._activity,
                context: this._prepareContext()
            };

            return new TinCan.Statement(stCfg, { doStamp: false });
        },

        _sendStatement: function (st, callback) {
            var st,
                cbWrapper,
                result;

            if (callback) {
                cbWrapper = function (err, result) {
                    if (err !== null) {
                        callback(err, result);
                        return;
                    }

                    callback(err, result, st);
                };
            }

            result = this._lrs.saveStatement(st, { callback: cbWrapper });
            if (! callback) {
                return {
                    response: result,
                    statement: st
                };
            }
        }
    };

    /**
        Turn on debug logging

        @method enableDebug
        @static
    */
    CMI5.enableDebug = function () {
        CMI5.DEBUG = true;
    };

    /**
        Turn off debug logging

        @method disableDebug
        @static
    */
    CMI5.disableDebug = function () {
        CMI5.DEBUG = false;
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
                    this.log("[warning] There was a problem communicating with the server. (" + httpStatus + " | " + xhr.responseText+ ")");
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
    // one of the two of these is stuffed into the CMI5 instance where a
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
            fullRequest = fullUrl,
            err;
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

        if (typeof headers["Content-Type"] !== "undefined" && headers["Content-Type"] !== "application/json") {
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
            fullRequest += "?" + pairs.join("&");
        }
        fullUrl = fullRequest;

        xhr = new XDomainRequest ();
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
                //this.log("calling __delay");
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
        var xhr = new XMLHttpRequest (),
            url = window.location + "?forcenocache=" + TinCan.Utils.getUUID()
        ;
        xhr.open("GET", url, false);
        xhr.send(null);
    };
}());
