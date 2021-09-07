/*
    Copyright 2021 Rustici Software

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

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

const THIS_LIBRARY = {
        VERSION: "__PACKAGE_VERSION__",
        NAME: "__PACKAGE_NAME__",
        DESCRIPTION: "__PACKAGE_DESCRIPTION__"
    },
    XAPI_VERSION = "1.0.3",
    STATE_LMS_LAUNCHDATA = "LMS.LaunchData",
    AGENT_PROFILE_LEARNER_PREFS = "cmi5LearnerPreferences",
    LAUNCH_MODE_NORMAL = "Normal",
    CATEGORY_ACTIVITY_CMI5 = {
        id: "https://w3id.org/xapi/cmi5/context/categories/cmi5"
    },
    CATEGORY_ACTIVITY_MOVEON = {
        id: "https://w3id.org/xapi/cmi5/context/categories/moveon"
    },
    OTHER_ACTIVITY_CMI5JS = {
        id: `http://id.tincanapi.com/activity/software/${THIS_LIBRARY.NAME}/${THIS_LIBRARY.VERSION}`,
        definition: {
            name: {
                und: `${THIS_LIBRARY.NAME} (${THIS_LIBRARY.VERSION})`
            },
            description: {
                en: THIS_LIBRARY.DESCRIPTION
            },
            type: "http://id.tincanapi.com/activitytype/source"
        }
    },
    EXTENSION_SESSION_ID = "https://w3id.org/xapi/cmi5/context/extensions/sessionid",
    EXTENSION_MASTERY_SCORE = "https://w3id.org/xapi/cmi5/context/extensions/masteryscore",
    VERB_INITIALIZED_ID = "http://adlnet.gov/expapi/verbs/initialized",
    VERB_TERMINATED_ID = "http://adlnet.gov/expapi/verbs/terminated",
    VERB_COMPLETED_ID = "http://adlnet.gov/expapi/verbs/completed",
    VERB_PASSED_ID = "http://adlnet.gov/expapi/verbs/passed",
    VERB_FAILED_ID = "http://adlnet.gov/expapi/verbs/failed",
    verbDisplay = {
        [VERB_INITIALIZED_ID]: {en: "initialized"},
        [VERB_TERMINATED_ID]: {en: "terminated"},
        [VERB_COMPLETED_ID]: {en: "completed"},
        [VERB_PASSED_ID]: {en: "passed"},
        [VERB_FAILED_ID]: {en: "failed"}
    },
    launchParameters = [
        "endpoint",
        "fetch",
        "actor",
        "activityId",
        "registration"
    ];

/**
    Top level interface constructor.

    @class Cmi5
    @constructor
    @param {String} [launchString] AU Launch URL providing configuration options
    @throws {Error} Invalid launch string
*/
export default function Cmi5 (launchString) {
    this.log("constructor", launchString);

    if (typeof launchString !== "undefined") {
        const url = new URL(launchString),
            params = url.searchParams;

        this.log("params");

        for (let i = 0; i < launchParameters.length; i += 1) {
            if (! params.has(launchParameters[i])) {
                throw new Error(`Invalid launch string missing or empty parameter: ${launchParameters[i]}`);
            }
        }

        this.setFetch(params.get("fetch"));
        this.setEndpoint(params.get("endpoint"));
        this.setActor(params.get("actor"));
        this.setActivityId(params.get("activityId"));
        this.setRegistration(params.get("registration"));
    }
}

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

/**
    Turn on debug logging

    @method enableDebug
    @static
*/
Cmi5.enableDebug = () => {
    Cmi5.DEBUG = true;
};

/**
    Turn off debug logging

    @method disableDebug
    @static
*/
Cmi5.disableDebug = () => {
    Cmi5.DEBUG = false;
};

// eslint-disable-next-line no-mixed-operators,no-bitwise
Cmi5.uuidv4 = () => ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

/**
    @method convertISO8601DurationToMilliseconds
    @static
    @param {String} ISO8601Duration Duration in ISO8601 format
    @return {Int} Duration in milliseconds

    Note: does not handle input strings with years, months and days
*/
Cmi5.convertISO8601DurationToMilliseconds = (ISO8601Duration) => {
    const isValueNegative = ISO8601Duration.indexOf("-") >= 0,
        indexOfT = ISO8601Duration.indexOf("T"),
        indexOfS = ISO8601Duration.indexOf("S");
    let indexOfH = ISO8601Duration.indexOf("H"),
        indexOfM = ISO8601Duration.indexOf("M"),
        hours,
        minutes;

    if ((indexOfT === -1) || ((indexOfM !== -1) && (indexOfM < indexOfT)) || (ISO8601Duration.indexOf("D") !== -1) || (ISO8601Duration.indexOf("Y") !== -1)) {
        throw new Error("ISO 8601 durations including years, months and/or days are not currently supported");
    }

    if (indexOfH === -1) {
        indexOfH = indexOfT;
        hours = 0;
    }
    else {
        hours = parseInt(ISO8601Duration.slice(indexOfT + 1, indexOfH), 10);
    }

    if (indexOfM === -1) {
        indexOfM = indexOfT;
        minutes = 0;
    }
    else {
        minutes = parseInt(ISO8601Duration.slice(indexOfH + 1, indexOfM), 10);
    }

    const seconds = parseFloat(ISO8601Duration.slice(indexOfM + 1, indexOfS));
    let durationInMilliseconds = parseInt(((((hours * 60 + minutes) * 60) + seconds) * 1000), 10); // eslint-disable-line no-extra-parens, no-mixed-operators

    if (isNaN(durationInMilliseconds)) {
        durationInMilliseconds = 0;
    }
    if (isValueNegative) {
        durationInMilliseconds *= -1;
    }

    return durationInMilliseconds;
};

/**
    @method convertMillisecondsToISO8601Duration
    @static
    @param {Int} inputMilliseconds Duration in milliseconds
    @return {String} Duration in ISO8601 format
*/
Cmi5.convertMillisecondsToISO8601Duration = (inputMilliseconds) => {
    const inputMillisecondsAsInt = parseInt(inputMilliseconds, 10);
    let result = "PT",

        // round to nearest 0.01 seconds
        inputCentisecondsAsInt = Math.round(inputMillisecondsAsInt / 10);

    if (inputCentisecondsAsInt < 0) {
        result = "-" + result;
        inputCentisecondsAsInt *= -1;
    }

    /* eslint-disable no-extra-parens */
    const hours = parseInt(((inputCentisecondsAsInt) / 360000), 10),
        minutes = parseInt((((inputCentisecondsAsInt) % 360000) / 6000), 10),
        seconds = (((inputCentisecondsAsInt) % 360000) % 6000) / 100;
    /* eslint-enable no-extra-parens */

    if (hours > 0) {
        result += hours + "H";
    }

    if (minutes > 0) {
        result += minutes + "M";
    }

    result += seconds + "S";

    return result;
};

Cmi5.prototype = {
    _fetch: null,
    _endpoint: null,
    _actor: null,
    _registration: null,
    _activityId: null,

    _auth: null,
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
        @param {Object} [events] Functions to run at specific execution points
            @param {Function} [events.postFetch] Function to run after retrieving fetchUrl result
            @param {Function} [events.launchData] Function to run after retrieving launch data
            @param {Function} [events.learnerPrefs] Function to run after retrieving learner preferences
            @param {Function} [events.initializeStatement] Function to run after saving initialization statement
        @param {Object} [additionalProperties] Optional object param with properties to customize method behavior.
    */
    start: async function (events = {}, additionalProperties) {
        this.log("start");

        try {
            await this.postFetch();

            if (typeof events.postFetch !== "undefined") {
                await events.postFetch.apply(this);
            }

            await this.loadLMSLaunchData();

            if (typeof events.launchData !== "undefined") {
                await events.launchData.apply(this);
            }

            await this.loadLearnerPrefs();

            if (typeof events.learnerPrefs !== "undefined") {
                await events.learnerPrefs.apply(this);
            }

            await this.initialize(additionalProperties);

            if (typeof events.initializeStatement !== "undefined") {
                await events.initializeStatement.apply(this);
            }
        }
        catch (ex) {
            throw new Error(`Failed to start AU: ${ex}`);
        }
    },

    /**
        Method to POST to the fetchUrl to retrieve the LRS credentials

        `setFetch` has to be called first and is called by the constructor if the launch string was provided to it.

        @method postFetch
    */
    postFetch: async function () {
        this.log("postFetch");

        if (this._fetch === null) {
            throw new Error("Can't POST to fetch URL without setFetch");
        }

        let fetchResponse;

        try {
            fetchResponse = await fetch(
                this._fetch,
                {
                    mode: "cors",
                    method: "POST"
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed to make fetch request: ${ex}`);
        }

        if (! fetchResponse.ok) {
            throw new Error(`Post fetch response returned error: ${fetchResponse.status}`);
        }

        if (fetchResponse.status === 200) {
            const fetchContent = await fetchResponse.json();

            if (typeof fetchContent["auth-token"] !== "undefined") {
                this._fetchContent = fetchContent;
                this.setAuth(`Basic ${fetchContent["auth-token"]}`);

                return;
            }

            throw new Error(`Post fetch response indicated LMS error: ${fetchContent["error-code"]}`);
        }

        throw new Error(`Post fetch response status code unexpected: ${fetchResponse.status}`);
    },

    /**
        Method to load the LMS.LaunchData state document populated by the LMS

        Fetch data has to have already been loaded, in order to have LRS credential.

        @method loadLMSLaunchData
    */
    loadLMSLaunchData: async function () {
        this.log("loadLMSLaunchData");

        if (this._fetchContent === null) {
            throw new Error("Can't retrieve LMS Launch Data without successful postFetch");
        }

        let response;

        try {
            response = await fetch(
                `${this._endpoint}/activities/state?` + new URLSearchParams(
                    {
                        stateId: STATE_LMS_LAUNCHDATA,
                        activityId: this._activityId,
                        agent: JSON.stringify(this._actor),
                        registration: this._registration
                    }
                ),
                {
                    mode: "cors",
                    method: "get",
                    headers: {
                        "X-Experience-API-Version": XAPI_VERSION,
                        Authorization: this._auth
                    }
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed to GET LMS launch data: ${ex}`);
        }

        this._lmsLaunchData = await response.json();

        //
        // store a stringified version of the context template for cheap
        // cloning when we go to prepare it later for use in statements
        //
        this._contextTemplate = JSON.stringify(this._lmsLaunchData.contextTemplate);
    },

    /**
        Method to load learner prefs agent profile document possibly populated by the LMS

        @method loadLearnerPrefs
    */
    loadLearnerPrefs: async function () {
        this.log("loadLearnerPrefs");

        if (this._lmsLaunchData === null) {
            throw new Error("Can't retrieve Learner Preferences without successful loadLMSLaunchData");
        }

        let response;

        try {
            response = await fetch(
                `${this._endpoint}/agents/profile?` + new URLSearchParams(
                    {
                        profileId: AGENT_PROFILE_LEARNER_PREFS,
                        agent: JSON.stringify(this._actor)
                    }
                ),
                {
                    mode: "cors",
                    method: "get",
                    headers: {
                        "X-Experience-API-Version": XAPI_VERSION,
                        Authorization: this._auth
                    }
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed request to retrieve learner preferences: ${ex}`);
        }

        if (response.status === 200) {
            this._learnerPrefs = {
                contents: await response.json(),
                etag: response.headers.ETag
            };

            return;
        }
        if (response.status === 404) {
            this.log("Learner Preferences request returned not found (expected)");

            this._learnerPrefs = {
                contents: {}
            };

            return;
        }

        throw new Error("Failed to get learner preferences: unrecognized response status");
    },

    /**
        Method to save learner prefs to agent profile document in LRS

        @method saveLearnerPrefs
    */
    saveLearnerPrefs: async function () {
        this.log("saveLearnerPrefs");

        if (this._learnerPrefs === null) {
            throw new Error("Can't save Learner Preferences without first loading them");
        }

        let response;

        try {
            response = await fetch(
                `${this._endpoint}/agents/profile?` + new URLSearchParams(
                    {
                        profileId: AGENT_PROFILE_LEARNER_PREFS,
                        agent: JSON.stringify(this._actor)
                    }
                ),
                {
                    mode: "cors",
                    method: "put",
                    headers: {
                        "X-Experience-API-Version": XAPI_VERSION,
                        Authorization: this._auth,
                        "Content-Type": "application/json",
                        ...this._learnerPrefs.etag ? {"If-Match": this._learnerPrefs.etag} : {"If-None-Match": "*"}
                    },
                    body: JSON.stringify(this._learnerPrefs.contents)
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed request to save learner preferences: ${ex}`);
        }

        if (response.status === 403) {
            this.log("Save of learner preferences denied by LMS");
            this._learnerPrefs.saveDisallowed = true;

            return;
        }

        if (response.status !== 204) {
            throw new Error(`Failed to save learner preferences: ${response.status}`);
        }

        this._learnerPrefs.etag = response.headers.ETag;
    },

    /**
        Finalize initialization process by sending initialized statement, starting duration tracker, and marking AU active

        @method initialize
        @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
        @throws {Error} <ul><li>Learner prefs not loaded</li><li>AU already initialized</li></ul>
    */
    initialize: async function (additionalProperties = {}) {
        this.log("initialize");

        if (this._lmsLaunchData === null) {
            throw new Error("Failed to initialize: can't send initialized statement without successful loadLMSLaunchData");
        }
        if (this._learnerPrefs === null) {
            throw new Error("Failed to initialize: can't send initialized statement without successful loadLearnerPrefs");
        }

        if (this._initialized) {
            throw new Error("Failed to initialize: AU already initialized");
        }

        const st = this.initializedStatement();

        this._appendProvidedProperties(st, additionalProperties);

        try {
            await this.sendStatement(st);
        }
        catch (ex) {
            throw new Error(`Failed to initialize: exception sending initialized statement (${ex})`);
        }

        this._initialized = true;
        this._isActive = true;
        this._durationStart = new Date().getTime();
    },

    /**
        Method to indicate session termination should occur, sends terminated statement, marks AU inactive

        @method terminate
        @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
        @throws {Error} <ul><li>AU not initialized</li><li>AU already terminated</li></ul>
    */
    terminate: async function (additionalProperties = {}) {
        this.log("terminate");

        if (! this._initialized) {
            throw new Error("AU not initialized");
        }
        if (this._terminated) {
            throw new Error("AU already terminated");
        }

        const st = this.terminatedStatement();

        this._appendProvidedProperties(st, additionalProperties);

        try {
            await this.sendStatement(st);
        }
        catch (ex) {
            throw new Error(`Failed to terminate: exception sending terminated statement (${ex})`);
        }

        this._terminated = true;
        this._isActive = false;
    },

    /**
        Method to indicate learner has completed the AU, sends completed statement

        @method completed
        @param {Object} [additionalProperties] Optional object containing properties to append to the cmi5 statement.
        @throws {Error} <ul><li>AU not active</li><li>AU not in normal launch mode</li><li>AU already completed</li></ul>
    */
    completed: async function (additionalProperties = {}) {
        this.log("completed");

        if (! this.isActive()) {
            throw new Error("AU not active");
        }
        if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
            throw new Error("AU not in Normal launch mode");
        }
        if (this._completed) {
            throw new Error("AU already completed");
        }

        const st = this.completedStatement();

        this._appendProvidedProperties(st, additionalProperties);

        try {
            await this.sendStatement(st);
        }
        catch (ex) {
            throw new Error(`Failed to send completed statement: ${ex}`);
        }

        this.setProgress(null);
        this._completed = true;
    },

    /**
        Method to indicate learner has passed the AU, sends passed statement with optional score

        @method passed
        @param {Object} [score] Score to be included in statement (see `passedStatement`)
        @throws {Error} <ul><li>AU not active,</li><li>AU not in Normal launch mode,</li><li>AU already passed,</li><li>Failed to create passed statement (usually because of malformed score)</li></ul>
    */
    passed: async function (score) {
        this.log("passed");

        if (! this.isActive()) {
            throw new Error("AU not active");
        }
        if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
            throw new Error("AU not in Normal launch mode");
        }
        if (this._passed !== null) {
            throw new Error("AU already passed");
        }

        let st;

        try {
            st = this.passedStatement(score);
        }
        catch (ex) {
            throw new Error(`Failed to create passed statement: ${ex}`);
        }

        try {
            await this.sendStatement(st);
        }
        catch (ex) {
            throw new Error(`Failed to send passed statement: ${ex}`);
        }

        this._passed = true;
    },

    /**
        Method to indicate learner has failed the AU, sends failed statement with optional score

        @method failed
        @param {Object} [score] Score to be included in statement (see `failedStatement`)
        @throws {Error} <ul><li>AU not active</li><li>AU not in Normal launch mode</li><li>AU already passed/failed</li><li>Failed to create failed statement (usually because of malformed score)</li></ul>
    */
    failed: async function (score) {
        this.log("failed");

        if (! this.isActive()) {
            throw new Error("AU not active");
        }
        if (this.getLaunchMode() !== LAUNCH_MODE_NORMAL) {
            throw new Error("AU not in Normal launch mode");
        }
        if (this._failed !== null || this._passed !== null) {
            throw new Error("AU already passed/failed");
        }

        let st;

        try {
            st = this.failedStatement(score);
        }
        catch (ex) {
            throw new Error(`Failed to create failed statement: ${ex}`);
        }

        try {
            await this.sendStatement(st);
        }
        catch (ex) {
            throw new Error(`Failed to send failed statement: ${ex}`);
        }

        this._failed = true;
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
        this.log("getLaunchParameters");

        if (this._lmsLaunchData === null) {
            throw new Error("Can't determine LaunchParameters until LMS LaunchData has been loaded");
        }

        let result = null;

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
        this.log("getMasteryScore");

        if (this._lmsLaunchData === null) {
            throw new Error("Can't determine masteryScore until LMS LaunchData has been loaded");
        }

        let result = null;

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
        this.log("getReturnURL");

        if (this._lmsLaunchData === null) {
            throw new Error("Can't determine returnURL until LMS LaunchData has been loaded");
        }

        let result = null;

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
        this.log("getEntitlementKey");

        if (this._lmsLaunchData === null) {
            throw new Error("Can't determine entitlementKey until LMS LaunchData has been loaded");
        }

        let result = null;

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
        this.log("getLanguagePreference");

        if (this._learnerPrefs === null) {
            throw new Error("Can't determine language preference until learner preferences have been loaded");
        }

        let result = null;

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
            // eslint-disable-next-line no-param-reassign
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
        this.log("getAudioPreference");

        if (this._learnerPrefs === null) {
            throw new Error("Can't determine audio preference until learner preferences have been loaded");
        }

        let result = null;

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
            throw new Error(`Unrecognized value for audio preference: ${pref}`);
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
            if (! Number.isInteger(progress)) {
                throw new Error(`Invalid progress measure (not an integer): ${progress}`);
            }
            if (progress < 0 || progress > 100) {
                throw new Error(`Invalid progress measure must be greater than or equal to 0 and less than or equal to 100: ${progress}`);
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
        Set the LRS endpoint, called by the `Cmi5` constructor when provided a launch URL

        @method setEndpoint
        @param {String} endpoint endpoint as provided by the LMS in the launch string
    */
    setEndpoint: function (endpoint) {
        this.log("setEndpoint: ", endpoint);

        this._endpoint = endpoint;
    },

    /**
        Retrieve the LRS endpoint

        @method getEndpoint
        @return {String} the previous set endpoint
    */
    getEndpoint: function () {
        return this._endpoint;
    },

    /**
        Set the LRS authorization header

        @method setAuth
        @param {String} auth Authorization header value
    */
    setAuth: function (auth) {
        this.log("setAuth: ", auth);

        this._auth = auth;
    },

    /**
        Retrieve the LRS authorization header

        @method getAuth
        @return {String} the previous set auth header value
    */
    getAuth: function () {
        return this._auth;
    },

    /**
        Set the fetch URL, called by the `Cmi5` constructor when provided a launch URL

        @method setFetch
        @param {String} fetchURL fetchURL as provided by the LMS in the launch string
    */
    setFetch: function (fetchURL) {
        this.log("setFetch: ", fetchURL);

        this._fetch = fetchURL;
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
        Initialize the actor that will represent the learner

        Called by the `Cmi5` constructor when provided a launch URL.

        @method setActor
        @param {String|Object} agent Pre-constructed Agent or string of JSON used to construct Agent
        @throws {Error} <ul><li>Invalid actor, missing account IFI</li><li>Invalid account IFI</li></ul>
    */
    setActor: function (agent) {
        this.log("setActor", agent);

        if (typeof agent === "string") {
            try {
                // eslint-disable-next-line no-param-reassign
                agent = JSON.parse(agent);
            }
            catch (ex) {
                throw new Error(`Invalid actor: failed to parse string as JSON (${ex})`);
            }
        }

        //
        // don't generally want to do too much validation as the LMS
        // should be giving us valid information, *but* in this case
        // users need to be able to count on the type of object being
        // returned
        //
        if (typeof agent.account === "undefined") {
            throw new Error("Invalid actor: account is missing");
        }
        else if (typeof agent.account.name === "undefined") {
            throw new Error("Invalid actor: account name is missing");
        }
        else if (agent.account.name === "") {
            throw new Error("Invalid actor: account name is empty");
        }
        else if (typeof agent.account.homePage === "undefined") {
            throw new Error("Invalid actor: account homePage is missing");
        }
        else if (agent.account.homePage === "") {
            throw new Error("Invalid actor: account homePage is empty");
        }

        this._actor = agent;
    },

    /**
        Retrieve the actor object representing the learner

        @method getActor
        @return {Object} Learner's Agent
    */
    getActor: function () {
        return this._actor;
    },

    /**
        Initialize the root object representing the AU

        Called by the `Cmi5` constructor when provided a launch URL.

        @method setActivity
        @param {String} activity String id used to construct Activity
        @throws {Error} <ul><li>Invalid activity, null id</li><li>Invalid activity, empty string id</li></ul>
    */
    setActivityId: function (activityId) {
        this.log("setActivityId", activityId);

        if (typeof activityId === "undefined") {
            throw new Error("Invalid activityId: argument missing");
        }
        else if (activityId === "") {
            throw new Error("Invalid activityId: empty string");
        }

        this._activityId = activityId;
    },

    /**
        Retrieve the Activity id that represents the root object of the AU

        @method getActivityId
        @return {String} Activity Id
    */
    getActivityId: function () {
        return this._activityId;
    },

    /**
        Set the registration value

        Called by the `Cmi5` constructor when provided a launch URL.

        @method setRegistration
        @param {String} registration UUID representing the registration
        @throws {Error} <ul><li>Invalid registration, null</li><li>Invalid registration, empty string</li></ul>
    */
    setRegistration: function (registration) {
        this.log("setRegistration", registration);

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
        @param {Object} score Score object to validate
        @throws {Error} <ul><li>Null or missing score argument</li><li>Non-integer min or max value (when provided)</li><li>Non-number, negative, or greater than 1 scaled value (when provided)</li><li>Non-integer, missing or invalid min/max, raw value (when provided)</li></ul>
        @return {Boolean} true for passing, otherwise exception is thrown
    */
    validateScore: function (score) {
        if (typeof score === "undefined" || score === null) {
            throw new Error(`cannot validate score (score not provided): ${score}`);
        }

        if (typeof score.min !== "undefined") {
            if (! Number.isInteger(score.min)) {
                throw new Error("score.min is not an integer");
            }
        }
        if (typeof score.max !== "undefined") {
            if (! Number.isInteger(score.max)) {
                throw new Error("score.max is not an integer");
            }
        }

        if (typeof score.scaled !== "undefined") {
            if (! /^(-|\+)?[01]+(\.[0-9]+)?$/.test(score.scaled)) {
                throw new Error(`scaled score not a recognized number: ${score.scaled}`);
            }

            if (score.scaled < 0) {
                throw new Error("scaled score must be greater than or equal to 0");
            }
            if (score.scaled > 1) {
                throw new Error("scaled score must be less than or equal to 1");
            }
        }

        if (typeof score.raw !== "undefined") {
            if (! Number.isInteger(score.raw)) {
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
        @return {Object} Statement
    */
    prepareStatement: function (verbId) {
        //
        // the specification allows for statements that are 'cmi5 allowed'
        // as oppposed to 'cmi5 defined' to be sent by the AU, so give the
        // AU the ability to get a prepared statement with a populated context
        // based on the template but without the category having been added
        //
        const stCfg = {
                id: Cmi5.uuidv4(),
                timestamp: new Date().toISOString(),
                actor: this._actor,
                verb: {
                    id: verbId
                },
                object: {
                    id: this._activityId
                },
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

        return stCfg;
    },

    /**
        Store provided statement in the configured LRS

        @method sendStatement
        @param {Object} st Statement to be stored
    */
    sendStatement: async function (st) {
        this.log("sendStatement", st);

        if (typeof st.id === "undefined") {
            st.id = Cmi5.uuidv4();
        }

        let response;

        try {
            response = await fetch(
                `${this._endpoint}/statements?` + new URLSearchParams(
                    {
                        statementId: st.id
                    }
                ),
                {
                    mode: "cors",
                    method: "put",
                    headers: {
                        "X-Experience-API-Version": XAPI_VERSION,
                        Authorization: this._auth,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(st)
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed request to send statement: ${ex}`);
        }

        if (response.status !== 204) {
            throw new Error(`Failed to send statement: status code ${response.status}`);
        }
    },

    /**
        Store provided statements in the configured LRS

        @method sendStatements
        @param {Array} sts Statements to be stored
     */
    sendStatements: async function (sts) {
        this.log("sendStatements", sts);

        sts.forEach((st) => {
            if (typeof st.id === "undefined") {
                st.id = Cmi5.uuidv4();
            }
        });

        let response;

        try {
            response = await fetch(
                `${this._endpoint}/statements`,
                {
                    mode: "cors",
                    method: "post",
                    headers: {
                        "X-Experience-API-Version": XAPI_VERSION,
                        Authorization: this._auth,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(sts)
                }
            );
        }
        catch (ex) {
            throw new Error(`Failed request to send statements: ${ex}`);
        }

        if (response.status !== 204) {
            throw new Error(`Failed to send statements: status code ${response.status}`);
        }
    },

    /*
     * The ...Statement methods are provided for users that want to implement
     * a queueing like mechanism or something similar where they are expected
     * to abide by the AU restrictions on what statements can be sent, etc. on
     * their own.
    */

    /**
        Advanced Usage: retrieve prepared "initialized" statement

        Statement methods are provided for users that want to implement
        a queueing like mechanism or something similar where they are expected
        to abide by the AU restrictions on what statements can be sent, etc. on
        their own.

        @method initializedStatement
        @return {Object} Initialized statement
    */
    initializedStatement: function () {
        this.log("initializedStatement");

        return this._prepareStatement(VERB_INITIALIZED_ID);
    },

    /**
        Advanced Usage: retrieve prepared "terminated" statement

        Statement methods are provided for users that want to implement
        a queueing like mechanism or something similar where they are expected
        to abide by the AU restrictions on what statements can be sent, etc. on
        their own.

        @method terminatedStatement
        @return {Object} Terminated statement
    */
    terminatedStatement: function () {
        this.log("terminatedStatement");

        const st = this._prepareStatement(VERB_TERMINATED_ID);

        st.result = st.result || {};
        st.result.duration = Cmi5.convertMillisecondsToISO8601Duration(this.getDuration());

        return st;
    },

    /**
        Advanced Usage: retrieve prepared "passed" statement

        Statement methods are provided for users that want to implement
        a queueing like mechanism or something similar where they are expected
        to abide by the AU restrictions on what statements can be sent, etc. on
        their own.

        @method passedStatement
        @param {Object} [score] Object to be used as the score, must meet masteryScore requirements, etc.
        @return {Object} Passed statement
    */
    passedStatement: function (score) {
        this.log("passedStatement");

        const st = this._prepareStatement(VERB_PASSED_ID);

        st.result = st.result || {};
        st.result.success = true;
        st.result.duration = Cmi5.convertMillisecondsToISO8601Duration(this.getDuration());

        if (score) {
            try {
                this.validateScore(score);
            }
            catch (ex) {
                throw new Error(`Invalid score: ${ex}`);
            }

            const masteryScore = this.getMasteryScore();

            if (masteryScore !== null && typeof score.scaled !== "undefined") {
                if (score.scaled < masteryScore) {
                    throw new Error(`Invalid score: scaled score does not meet or exceed mastery score (${score.scaled} < ${masteryScore})`);
                }

                st.context.extensions = st.context.extensions || {};
                st.context.extensions[EXTENSION_MASTERY_SCORE] = masteryScore;
            }

            st.result.score = score;
        }

        st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

        return st;
    },

    /**
        Advanced Usage: retrieve prepared "failed" statement

        Statement methods are provided for users that want to implement
        a queueing like mechanism or something similar where they are expected
        to abide by the AU restrictions on what statements can be sent, etc. on
        their own.

        @method failedStatement
        @param {Object} [score] Object to be used as the score, must meet masteryScore requirements, etc.
        @return {Object} Failed statement
    */
    failedStatement: function (score) {
        this.log("failedStatement");

        const st = this._prepareStatement(VERB_FAILED_ID);

        st.result = st.result || {};
        st.result.success = false;
        st.result.duration = Cmi5.convertMillisecondsToISO8601Duration(this.getDuration());

        if (score) {
            try {
                this.validateScore(score);
            }
            catch (ex) {
                throw new Error(`Invalid score: ${ex}`);
            }

            const masteryScore = this.getMasteryScore();

            if (masteryScore !== null && typeof score.scaled !== "undefined") {
                if (score.scaled >= masteryScore) {
                    throw new Error(`Invalid score: scaled score exceeds mastery score (${score.scaled} >= ${masteryScore})`);
                }

                st.context.extensions = st.context.extensions || {};
                st.context.extensions[EXTENSION_MASTERY_SCORE] = masteryScore;
            }

            st.result.score = score;
        }

        st.context.contextActivities.category.push(CATEGORY_ACTIVITY_MOVEON);

        return st;
    },

    /**
        Advanced Usage: retrieve prepared "completed" statement

        Statement methods are provided for users that want to implement
        a queueing like mechanism or something similar where they are expected
        to abide by the AU restrictions on what statements can be sent, etc. on
        their own.

        @method completedStatement
        @return {Object} Completed statement
    */
    completedStatement: function () {
        this.log("completedStatement");

        const st = this._prepareStatement(VERB_COMPLETED_ID);

        st.result = st.result || {};
        st.result.completion = true;
        st.result.duration = Cmi5.convertMillisecondsToISO8601Duration(this.getDuration());

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
        const context = JSON.parse(this._contextTemplate);

        context.registration = this._registration;

        if (this._includeSourceActivity) {
            context.contextActivities = context.contextActivities || {};
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
        const st = this.prepareStatement(verbId);

        st.context.contextActivities = st.context.contextActivities || {};
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
        if (typeof additionalProperties.context !== "undefined") {
            if (typeof additionalProperties.context.extensions !== "undefined") {
                for (const property in additionalProperties.context.extensions) {
                    if (additionalProperties.context.extensions.hasOwnProperty(property)) {
                        st.context.extensions[property] = additionalProperties.context.extensions[property];
                    }
                }
            }
        }

        if (typeof additionalProperties.result !== "undefined") {
            st.result = st.result || {};
            st.result.extensions = st.result.extensions || {};

            if (typeof additionalProperties.result.extensions !== "undefined") {
                for (const property in additionalProperties.result.extensions) {
                    if (additionalProperties.result.extensions.hasOwnProperty(property)) {
                        st.result.extensions[property] = additionalProperties.result.extensions[property];
                    }
                }
            }
        }

        if (typeof additionalProperties.object !== "undefined") {
            if (typeof additionalProperties.object.definition !== "undefined") {
                st.object.definition = st.object.definition || {};

                if (typeof additionalProperties.object.definition.type !== "undefined") {
                    st.object.definition.type = additionalProperties.object.definition.type;
                }
            }
        }
    }
};
