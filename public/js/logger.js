(function () {
  'use strict';

  var ShyTalkLogger = {
    _config: { source: 'unknown', endpoint: '/api/logs', appVersion: null },
    _sessionTraceId: null,
    _getToken: null,
    _originalFetch: null,

    /**
     * Initialise the logger.
     * @param {Object} config
     * @param {string}   config.source    - e.g. 'admin-panel', 'landing-page'
     * @param {string}   config.endpoint  - full URL to POST /api/logs
     * @param {Function} [config.getToken] - returns Promise<string|null>
     * @param {string}   [config.appVersion]
     */
    init: function (config) {
      if (config.source) this._config.source = config.source;
      if (config.endpoint) this._config.endpoint = config.endpoint;
      if (config.appVersion) this._config.appVersion = config.appVersion;
      if (typeof config.getToken === 'function') this._getToken = config.getToken;

      // Session trace ID — persist across refreshes within the same tab
      var stored = sessionStorage.getItem('shytalk_session_trace_id');
      if (stored) {
        this._sessionTraceId = stored;
      } else {
        this._sessionTraceId = this._generateUUID();
        sessionStorage.setItem('shytalk_session_trace_id', this._sessionTraceId);
      }

      this._setupErrorHandlers();
      this._setupFetchInterceptor();
      this._setupClickTracking();
      this._logPerformance();

      this.info('Logger initialised', { source: this._config.source });
    },

    // ---- Public log methods ----

    debug: function (message, context) {
      this._send({ level: 'DEBUG', message: message, context: context });
    },

    info: function (message, context) {
      this._send({ level: 'INFO', message: message, context: context });
    },

    warn: function (message, context) {
      this._send({ level: 'WARN', message: message, context: context });
    },

    error: function (message, context) {
      this._send({ level: 'ERROR', message: message, context: context });
    },

    fatal: function (message, context) {
      this._send({ level: 'FATAL', message: message, context: context });
    },

    // ---- Internal methods ----

    /**
     * Build a full log entry and POST it fire-and-forget.
     */
    _send: function (entry) {
      var self = this;
      var payload = {
        level: entry.level,
        message: entry.message,
        source: self._config.source,
        sessionTraceId: self._sessionTraceId,
        platform: 'web',
        timestamp: new Date().toISOString(),
        context: entry.context || {}
      };

      if (self._config.appVersion) {
        payload.context.appVersion = self._config.appVersion;
      }

      // Add page info
      payload.context.url = window.location.href;
      payload.context.userAgent = navigator.userAgent;

      var tokenPromise;
      if (self._getToken) {
        try {
          tokenPromise = self._getToken();
        } catch (e) {
          tokenPromise = Promise.resolve(null);
        }
      } else {
        tokenPromise = Promise.resolve(null);
      }

      var fetchFn = self._originalFetch || window.fetch;

      tokenPromise.then(function (token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
        }
        if (self._sessionTraceId) {
          headers['x-session-trace-id'] = self._sessionTraceId;
        }
        return fetchFn.call(window, self._config.endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        });
      }).catch(function () {
        // Fire-and-forget — silently ignore errors
      });
    },

    /**
     * Generate a UUID v4 with crypto.randomUUID() fallback.
     */
    _generateUUID: function () {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      // Fallback for older browsers
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },

    /**
     * Listen for uncaught errors and unhandled promise rejections.
     */
    _setupErrorHandlers: function () {
      var self = this;

      window.addEventListener('error', function (event) {
        self.error('Uncaught error: ' + (event.message || 'Unknown error'), {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
          stack: event.error && event.error.stack ? event.error.stack : null
        });
      });

      window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        var message = 'Unhandled promise rejection';
        var stack = null;

        if (reason instanceof Error) {
          message += ': ' + reason.message;
          stack = reason.stack || null;
        } else if (typeof reason === 'string') {
          message += ': ' + reason;
        }

        self.error(message, { stack: stack });
      });
    },

    /**
     * Wrap window.fetch to add trace headers and log request completion.
     */
    _setupFetchInterceptor: function () {
      var self = this;
      self._originalFetch = window.fetch;

      window.fetch = function (input, init) {
        var url;
        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof Request) {
          url = input.url;
        } else {
          url = String(input);
        }

        // Do NOT intercept calls to the log endpoint (prevent infinite loop)
        if (url.indexOf('/api/logs') !== -1) {
          return self._originalFetch.call(window, input, init);
        }

        // Only add trace header to same-origin or our own API requests.
        // Adding custom headers to cross-origin requests triggers CORS
        // preflight which breaks Firebase SDK calls to googleapis.com.
        var isOwnApi = url.indexOf('/api/') !== -1 &&
          (url.indexOf(location.origin) === 0 || url.charAt(0) === '/');
        if (isOwnApi) {
          init = init || {};
          if (!init.headers) {
            init.headers = {};
          }
          if (init.headers instanceof Headers) {
            init.headers.set('x-session-trace-id', self._sessionTraceId);
          } else if (Array.isArray(init.headers)) {
            init.headers.push(['x-session-trace-id', self._sessionTraceId]);
          } else {
            init.headers['x-session-trace-id'] = self._sessionTraceId;
          }
        }

        var method = ((init && init.method) || 'GET').toUpperCase();
        var startTime = Date.now();

        return self._originalFetch.call(window, input, init).then(function (response) {
          var durationMs = Date.now() - startTime;
          self.info('Fetch completed', {
            url: url,
            method: method,
            status: response.status,
            durationMs: durationMs
          });
          return response;
        }).catch(function (err) {
          var durationMs = Date.now() - startTime;
          self.error('Fetch failed', {
            url: url,
            method: method,
            durationMs: durationMs,
            error: err.message || String(err)
          });
          throw err;
        });
      };
    },

    /**
     * Track clicks on elements with data-log attribute.
     */
    _setupClickTracking: function () {
      var self = this;

      document.addEventListener('click', function (event) {
        var el = event.target;
        // Walk up the DOM to find a data-log attribute
        while (el && el !== document) {
          if (el.hasAttribute && el.hasAttribute('data-log')) {
            self.info('User clicked: ' + el.getAttribute('data-log'));
            return;
          }
          el = el.parentElement;
        }
      });
    },

    /**
     * Log page performance metrics on window load.
     */
    _logPerformance: function () {
      var self = this;

      var logMetrics = function () {
        try {
          var entries = performance.getEntriesByType('navigation');
          if (entries && entries.length > 0) {
            var nav = entries[0];
            self.info('Page performance', {
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
              loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
              ttfb: Math.round(nav.responseStart - nav.startTime)
            });
          }
        } catch (e) {
          // Performance API not available — skip silently
        }
      };

      if (document.readyState === 'complete') {
        // Use setTimeout to ensure loadEventEnd is populated
        setTimeout(logMetrics, 0);
      } else {
        window.addEventListener('load', function () {
          // Small delay to ensure loadEventEnd is populated
          setTimeout(logMetrics, 100);
        });
      }
    }
  };

  window.ShyTalkLogger = ShyTalkLogger;
})();
