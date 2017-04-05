require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        },
        set: function(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      request.onupgradeneeded = function(event) {
        if (upgradeCallback) {
          upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
        }
      };

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
  }
  else {
    self.idb = exp;
  }
}());

},{}],2:[function(require,module,exports){
(function (global){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ComputationsEngine = exports.ComputationsEngineConfig = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _get = function get(object, property, receiver) {
    if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
        var parent = Object.getPrototypeOf(object);if (parent === null) {
            return undefined;
        } else {
            return get(parent, property, receiver);
        }
    } else if ("value" in desc) {
        return desc.value;
    } else {
        var getter = desc.get;if (getter === undefined) {
            return undefined;
        }return getter.call(receiver);
    }
};

var _sdUtils = require("sd-utils");

var _sdModel = require("sd-model");

var _computationsManager = require("./computations-manager");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var ComputationsEngineConfig = exports.ComputationsEngineConfig = function (_ComputationsManagerC) {
    _inherits(ComputationsEngineConfig, _ComputationsManagerC);

    function ComputationsEngineConfig(custom) {
        _classCallCheck(this, ComputationsEngineConfig);

        var _this = _possibleConstructorReturn(this, (ComputationsEngineConfig.__proto__ || Object.getPrototypeOf(ComputationsEngineConfig)).call(this));

        _this.logLevel = 'warn';

        if (custom) {
            _sdUtils.Utils.deepExtend(_this, custom);
        }
        return _this;
    }

    return ComputationsEngineConfig;
}(_computationsManager.ComputationsManagerConfig);

//Entry point class for standalone computation workers


var ComputationsEngine = exports.ComputationsEngine = function (_ComputationsManager) {
    _inherits(ComputationsEngine, _ComputationsManager);

    function ComputationsEngine(config, data) {
        _classCallCheck(this, ComputationsEngine);

        var _this2 = _possibleConstructorReturn(this, (ComputationsEngine.__proto__ || Object.getPrototypeOf(ComputationsEngine)).call(this, config, data));

        _this2.global = _sdUtils.Utils.getGlobalObject();
        _this2.isWorker = _sdUtils.Utils.isWorker();

        if (_this2.isWorker) {
            _this2.jobsManger.registerJobExecutionListener({
                beforeJob: function beforeJob(jobExecution) {
                    _this2.reply('beforeJob', jobExecution.getDTO());
                },

                afterJob: function afterJob(jobExecution) {
                    _this2.reply('afterJob', jobExecution.getDTO());
                }
            });

            var instance = _this2;
            _this2.queryableFunctions = {
                runJob: function runJob(jobName, jobParametersValues, dataDTO) {
                    // console.log(jobName, jobParameters, serializedData);
                    var data = new _sdModel.DataModel(dataDTO);
                    instance.runJob(jobName, jobParametersValues, data);
                },
                executeJob: function executeJob(jobExecutionId) {
                    instance.jobsManger.execute(jobExecutionId).catch(function (e) {
                        instance.reply('jobFatalError', jobExecutionId, _sdUtils.Utils.getErrorDTO(e));
                    });
                },
                recompute: function recompute(dataDTO, ruleName, evalCode, evalNumeric) {
                    if (ruleName) {
                        instance.objectiveRulesManager.setCurrentRuleByName(ruleName);
                    }
                    var allRules = !ruleName;
                    var data = new _sdModel.DataModel(dataDTO);
                    instance._checkValidityAndRecomputeObjective(data, allRules, evalCode, evalNumeric);
                    this.reply('recomputed', data.getDTO());
                }
            };

            global.onmessage = function (oEvent) {
                if (oEvent.data instanceof Object && oEvent.data.hasOwnProperty('queryMethod') && oEvent.data.hasOwnProperty('queryArguments')) {
                    instance.queryableFunctions[oEvent.data.queryMethod].apply(self, oEvent.data.queryArguments);
                } else {
                    instance.defaultReply(oEvent.data);
                }
            };
        }
        return _this2;
    }

    _createClass(ComputationsEngine, [{
        key: "setConfig",
        value: function setConfig(config) {
            _get(ComputationsEngine.prototype.__proto__ || Object.getPrototypeOf(ComputationsEngine.prototype), "setConfig", this).call(this, config);
            this.setLogLevel(this.config.logLevel);
            return this;
        }
    }, {
        key: "setLogLevel",
        value: function setLogLevel(level) {
            _sdUtils.log.setLevel(level);
        }
    }, {
        key: "defaultReply",
        value: function defaultReply(message) {
            this.reply('test', message);
        }
    }, {
        key: "reply",
        value: function reply() {
            if (arguments.length < 1) {
                throw new TypeError('reply - not enough arguments');
            }
            this.global.postMessage({
                'queryMethodListener': arguments[0],
                'queryMethodArguments': Array.prototype.slice.call(arguments, 1)
            });
        }
    }]);

    return ComputationsEngine;
}(_computationsManager.ComputationsManager);

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./computations-manager":3,"sd-model":"sd-model","sd-utils":"sd-utils"}],3:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ComputationsManager = exports.ComputationsManagerConfig = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdExpressionEngine = require("sd-expression-engine");

var _sdUtils = require("sd-utils");

var _objectiveRulesManager = require("./objective/objective-rules-manager");

var _treeValidator = require("./validation/tree-validator");

var _operationsManager = require("./operations/operations-manager");

var _jobsManager = require("./jobs/jobs-manager");

var _expressionsEvaluator = require("./expressions-evaluator");

var _jobDataInvalidException = require("./jobs/engine/exceptions/job-data-invalid-exception");

var _jobParametersInvalidException = require("./jobs/engine/exceptions/job-parameters-invalid-exception");

var _jobInstanceManager = require("./jobs/job-instance-manager");

var _sdModel = require("sd-model");

var _policy = require("./policies/policy");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var ComputationsManagerConfig = exports.ComputationsManagerConfig = function ComputationsManagerConfig(custom) {
    _classCallCheck(this, ComputationsManagerConfig);

    this.logLevel = null;
    this.ruleName = null;
    this.worker = {
        delegateRecomputation: false,
        url: null
    };

    if (custom) {
        _sdUtils.Utils.deepExtend(this, custom);
    }
};

var ComputationsManager = exports.ComputationsManager = function () {
    function ComputationsManager(config) {
        var data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

        _classCallCheck(this, ComputationsManager);

        this.data = data;
        this.setConfig(config);
        this.expressionEngine = new _sdExpressionEngine.ExpressionEngine();
        this.expressionsEvaluator = new _expressionsEvaluator.ExpressionsEvaluator(this.expressionEngine);
        this.objectiveRulesManager = new _objectiveRulesManager.ObjectiveRulesManager(this.data, this.expressionEngine, this.config.ruleName);
        this.operationsManager = new _operationsManager.OperationsManager(this.data, this.expressionEngine);
        this.jobsManger = new _jobsManager.JobsManager(this.expressionsEvaluator, this.objectiveRulesManager, this.config.worker.url);
        this.treeValidator = new _treeValidator.TreeValidator(this.expressionEngine);
    }

    _createClass(ComputationsManager, [{
        key: "setConfig",
        value: function setConfig(config) {
            this.config = new ComputationsManagerConfig(config);
            return this;
        }
    }, {
        key: "getCurrentRule",
        value: function getCurrentRule() {
            return this.objectiveRulesManager.currentRule;
        }
    }, {
        key: "getJobByName",
        value: function getJobByName(jobName) {
            return this.jobsManger.getJobByName(jobName);
        }
    }, {
        key: "runJob",
        value: function runJob(name, jobParamsValues, data) {
            var resolvePromiseAfterJobIsLaunched = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;

            return this.jobsManger.run(name, jobParamsValues, data || this.data, resolvePromiseAfterJobIsLaunched);
        }
    }, {
        key: "runJobWithInstanceManager",
        value: function runJobWithInstanceManager(name, jobParamsValues, jobInstanceManagerConfig) {
            var _this = this;

            return this.runJob(name, jobParamsValues).then(function (je) {
                return new _jobInstanceManager.JobInstanceManager(_this.jobsManger, je, jobInstanceManagerConfig);
            });
        }
    }, {
        key: "getObjectiveRules",
        value: function getObjectiveRules() {
            return this.objectiveRulesManager.rules;
        }
    }, {
        key: "isRuleName",
        value: function isRuleName(ruleName) {
            return this.objectiveRulesManager.isRuleName(ruleName);
        }
    }, {
        key: "setCurrentRuleByName",
        value: function setCurrentRuleByName(ruleName) {
            this.config.ruleName = ruleName;
            return this.objectiveRulesManager.setCurrentRuleByName(ruleName);
        }
    }, {
        key: "operationsForObject",
        value: function operationsForObject(object) {
            return this.operationsManager.operationsForObject(object);
        }
    }, {
        key: "checkValidityAndRecomputeObjective",
        value: function checkValidityAndRecomputeObjective(allRules) {
            var _this2 = this;

            var evalCode = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
            var evalNumeric = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            return Promise.resolve().then(function () {
                if (_this2.config.worker.delegateRecomputation) {
                    var params = {
                        evalCode: evalCode,
                        evalNumeric: evalNumeric
                    };
                    if (!allRules) {
                        params.ruleName = _this2.getCurrentRule().name;
                    }
                    return _this2.runJob("recompute", params, _this2.data, false).then(function (jobExecution) {
                        var d = jobExecution.getData();
                        _this2.data.updateFrom(d);
                    });
                }
                return _this2._checkValidityAndRecomputeObjective(_this2.data, allRules, evalCode, evalNumeric);
            }).then(function () {
                _this2.updateDisplayValues(_this2.data);
            });
        }
    }, {
        key: "_checkValidityAndRecomputeObjective",
        value: function _checkValidityAndRecomputeObjective(data, allRules) {
            var _this3 = this;

            var evalCode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
            var evalNumeric = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;

            data.validationResults = [];

            if (evalCode || evalNumeric) {
                this.expressionsEvaluator.evalExpressions(data, evalCode, evalNumeric);
            }

            data.getRoots().forEach(function (root) {
                var vr = _this3.treeValidator.validate(data.getAllNodesInSubtree(root));
                data.validationResults.push(vr);
                if (vr.isValid()) {
                    _this3.objectiveRulesManager.recomputeTree(root, allRules);
                }
            });
        }

        //Checks validity of data model without recomputation and revalidation

    }, {
        key: "isValid",
        value: function isValid(data) {
            var data = data || this.data;
            return data.validationResults.every(function (vr) {
                return vr.isValid();
            });
        }
    }, {
        key: "updateDisplayValues",
        value: function updateDisplayValues(data) {
            var _this4 = this;

            var policyToDisplay = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

            data = data || this.data;
            if (policyToDisplay) {
                return this.displayPolicy(data, policyToDisplay);
            }

            data.nodes.forEach(function (n) {
                _this4.updateNodeDisplayValues(n);
            });
            data.edges.forEach(function (e) {
                _this4.updateEdgeDisplayValues(e);
            });
        }
    }, {
        key: "updateNodeDisplayValues",
        value: function updateNodeDisplayValues(node) {
            var _this5 = this;

            node.$DISPLAY_VALUE_NAMES.forEach(function (n) {
                return node.displayValue(n, _this5.objectiveRulesManager.getNodeDisplayValue(node, n));
            });
        }
    }, {
        key: "updateEdgeDisplayValues",
        value: function updateEdgeDisplayValues(e) {
            var _this6 = this;

            e.$DISPLAY_VALUE_NAMES.forEach(function (n) {
                return e.displayValue(n, _this6.objectiveRulesManager.getEdgeDisplayValue(e, n));
            });
        }
    }, {
        key: "displayPolicy",
        value: function displayPolicy(policyToDisplay, data) {
            var _this7 = this;

            data = data || this.data;
            data.nodes.forEach(function (n) {
                n.clearDisplayValues();
            });
            data.edges.forEach(function (e) {
                e.clearDisplayValues();
            });
            data.getRoots().forEach(function (root) {
                return _this7.displayPolicyForNode(root, policyToDisplay);
            });
        }
    }, {
        key: "displayPolicyForNode",
        value: function displayPolicyForNode(node, policy) {
            var _this8 = this;

            if (node instanceof _sdModel.domain.DecisionNode) {
                var decision = _policy.Policy.getDecision(policy, node);
                //console.log(decision, node, policy);
                if (decision) {
                    node.displayValue('optimal', true);
                    var childEdge = node.childEdges[decision.decisionValue];
                    childEdge.displayValue('optimal', true);
                    return this.displayPolicyForNode(childEdge.childNode, policy);
                }
                return;
            }

            node.childEdges.forEach(function (e) {
                return _this8.displayPolicyForNode(e.childNode, policy);
            });
        }
    }]);

    return ComputationsManager;
}();

},{"./expressions-evaluator":4,"./jobs/engine/exceptions/job-data-invalid-exception":24,"./jobs/engine/exceptions/job-parameters-invalid-exception":28,"./jobs/job-instance-manager":51,"./jobs/jobs-manager":53,"./objective/objective-rules-manager":54,"./operations/operations-manager":65,"./policies/policy":68,"./validation/tree-validator":71,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],4:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ExpressionsEvaluator = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdExpressionEngine = require('sd-expression-engine');

var _sdModel = require('sd-model');

var _sdUtils = require('sd-utils');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Evaluates code and expressions in trees*/
var ExpressionsEvaluator = exports.ExpressionsEvaluator = function () {
    function ExpressionsEvaluator(expressionEngine) {
        _classCallCheck(this, ExpressionsEvaluator);

        this.expressionEngine = expressionEngine;
    }

    _createClass(ExpressionsEvaluator, [{
        key: 'clear',
        value: function clear(data) {
            data.nodes.forEach(function (n) {
                n.clearComputedValues();
            });
            data.edges.forEach(function (e) {
                e.clearComputedValues();
            });
        }
    }, {
        key: 'clearTree',
        value: function clearTree(data, root) {
            data.getAllNodesInSubtree(root).forEach(function (n) {
                n.clearComputedValues();
                n.childEdges.forEach(function (e) {
                    e.clearComputedValues();
                });
            });
        }
    }, {
        key: 'evalExpressions',
        value: function evalExpressions(data) {
            var evalCode = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            var _this = this;

            var evalNumeric = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
            var initScopes = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

            _sdUtils.log.debug('evalExpressions evalCode:' + evalCode + ' evalNumeric:' + evalNumeric);
            if (evalCode) {
                this.evalGlobalCode(data);
            }

            data.getRoots().forEach(function (n) {
                _this.clearTree(data, n);
                _this.evalExpressionsForNode(data, n, evalCode, evalNumeric, initScopes);
            });
        }
    }, {
        key: 'evalGlobalCode',
        value: function evalGlobalCode(data) {
            data.clearExpressionScope();
            data.$codeDirty = false;
            try {
                data.$codeError = null;
                this.expressionEngine.eval(data.code, false, data.expressionScope);
            } catch (e) {
                data.$codeError = e;
            }
        }
    }, {
        key: 'evalExpressionsForNode',
        value: function evalExpressionsForNode(data, node) {
            var evalCode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var _this2 = this;

            var evalNumeric = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;
            var initScope = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : false;

            if (!node.expressionScope || initScope || evalCode) {
                this.initScopeForNode(data, node);
            }
            if (evalCode) {
                node.$codeDirty = false;
                if (node.code) {
                    try {
                        node.$codeError = null;
                        this.expressionEngine.eval(node.code, false, node.expressionScope);
                    } catch (e) {
                        node.$codeError = e;
                        _sdUtils.log.debug(e);
                    }
                }
            }

            if (evalNumeric) {
                var scope = node.expressionScope;
                var probabilitySum = _sdExpressionEngine.ExpressionEngine.toNumber(0);
                var hashEdges = [];
                var invalidProb = false;

                node.childEdges.forEach(function (e) {
                    if (e.isFieldValid('payoff', true, false)) {
                        try {
                            e.computedValue(null, 'payoff', _this2.expressionEngine.evalPayoff(e));
                        } catch (err) {
                            //   Left empty intentionally
                        }
                    }

                    if (node instanceof _sdModel.domain.ChanceNode) {
                        if (_sdExpressionEngine.ExpressionEngine.isHash(e.probability)) {
                            hashEdges.push(e);
                            return;
                        }

                        if (_sdExpressionEngine.ExpressionEngine.hasAssignmentExpression(e.probability)) {
                            //It should not occur here!
                            _sdUtils.log.warn("evalExpressionsForNode hasAssignmentExpression!", e);
                            return null;
                        }

                        if (e.isFieldValid('probability', true, false)) {
                            try {
                                var prob = _this2.expressionEngine.eval(e.probability, true, scope);
                                e.computedValue(null, 'probability', prob);
                                probabilitySum = _sdExpressionEngine.ExpressionEngine.add(probabilitySum, prob);
                            } catch (err) {
                                invalidProb = true;
                            }
                        } else {
                            invalidProb = true;
                        }
                    }
                });

                if (node instanceof _sdModel.domain.ChanceNode) {
                    var computeHash = hashEdges.length && !invalidProb && probabilitySum.compare(0) >= 0 && probabilitySum.compare(1) <= 0;

                    if (computeHash) {
                        var hash = _sdExpressionEngine.ExpressionEngine.divide(_sdExpressionEngine.ExpressionEngine.subtract(1, probabilitySum), hashEdges.length);
                        hashEdges.forEach(function (e) {
                            e.computedValue(null, 'probability', hash);
                        });
                    }
                }

                node.childEdges.forEach(function (e) {
                    _this2.evalExpressionsForNode(data, e.childNode, evalCode, evalNumeric, initScope);
                });
            }
        }
    }, {
        key: 'initScopeForNode',
        value: function initScopeForNode(data, node) {
            var parent = node.$parent;
            var parentScope = parent ? parent.expressionScope : data.expressionScope;
            node.expressionScope = _sdUtils.Utils.cloneDeep(parentScope);
        }
    }]);

    return ExpressionsEvaluator;
}();

},{"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],5:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _computationsEngine = require('./computations-engine');

Object.keys(_computationsEngine).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _computationsEngine[key];
    }
  });
});

var _computationsManager = require('./computations-manager');

Object.keys(_computationsManager).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _computationsManager[key];
    }
  });
});

var _expressionsEvaluator = require('./expressions-evaluator');

Object.keys(_expressionsEvaluator).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _expressionsEvaluator[key];
    }
  });
});

var _index = require('./jobs/index');

Object.keys(_index).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _index[key];
    }
  });
});

},{"./computations-engine":2,"./computations-manager":3,"./expressions-evaluator":4,"./jobs/index":50}],6:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ProbabilisticSensitivityAnalysisJobParameters = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _jobParameters = require("../../engine/job-parameters");

var _jobParameterDefinition = require("../../engine/job-parameter-definition");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var ProbabilisticSensitivityAnalysisJobParameters = exports.ProbabilisticSensitivityAnalysisJobParameters = function (_JobParameters) {
    _inherits(ProbabilisticSensitivityAnalysisJobParameters, _JobParameters);

    function ProbabilisticSensitivityAnalysisJobParameters() {
        _classCallCheck(this, ProbabilisticSensitivityAnalysisJobParameters);

        return _possibleConstructorReturn(this, (ProbabilisticSensitivityAnalysisJobParameters.__proto__ || Object.getPrototypeOf(ProbabilisticSensitivityAnalysisJobParameters)).apply(this, arguments));
    }

    _createClass(ProbabilisticSensitivityAnalysisJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("extendedPolicyDescription", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("numberOfRuns", _jobParameterDefinition.PARAMETER_TYPE.INTEGER).set("singleValueValidator", function (v) {
                return v > 0;
            }));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("variables", [new _jobParameterDefinition.JobParameterDefinition("name", _jobParameterDefinition.PARAMETER_TYPE.STRING), new _jobParameterDefinition.JobParameterDefinition("formula", _jobParameterDefinition.PARAMETER_TYPE.NUMBER_EXPRESSION)], 1, Infinity, false, null, function (values) {
                return _sdUtils.Utils.isUnique(values, function (v) {
                    return v["name"];
                });
            } //Variable names should be unique
            ));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                extendedPolicyDescription: true
            };
        }
    }]);

    return ProbabilisticSensitivityAnalysisJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":38,"../../engine/job-parameters":39,"sd-utils":"sd-utils"}],7:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ProbabilisticSensitivityAnalysisJob = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _simpleJob = require("../../engine/simple-job");

var _probabilisticSensitivityAnalysisJobParameters = require("./probabilistic-sensitivity-analysis-job-parameters");

var _prepareVariablesStep = require("./steps/prepare-variables-step");

var _initPoliciesStep = require("../sensitivity-analysis/steps/init-policies-step");

var _calculateStep = require("../sensitivity-analysis/steps/calculate-step");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var ProbabilisticSensitivityAnalysisJob = exports.ProbabilisticSensitivityAnalysisJob = function (_SimpleJob) {
    _inherits(ProbabilisticSensitivityAnalysisJob, _SimpleJob);

    function ProbabilisticSensitivityAnalysisJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, ProbabilisticSensitivityAnalysisJob);

        var _this = _possibleConstructorReturn(this, (ProbabilisticSensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(ProbabilisticSensitivityAnalysisJob)).call(this, "probabilistic-sensitivity-analysis", jobRepository));

        _this.addStep(new _prepareVariablesStep.PrepareVariablesStep(expressionsEvaluator.expressionEngine, jobRepository));
        _this.addStep(new _initPoliciesStep.InitPoliciesStep(jobRepository));
        _this.addStep(new _calculateStep.CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
        return _this;
    }

    _createClass(ProbabilisticSensitivityAnalysisJob, [{
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _probabilisticSensitivityAnalysisJobParameters.ProbabilisticSensitivityAnalysisJobParameters(values);
        }
    }, {
        key: "getJobDataValidator",
        value: function getJobDataValidator() {
            return {
                validate: function validate(data) {
                    return data.getRoots().length === 1;
                }
            };
        }

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(execution) {

            if (execution.stepExecutions.length <= 2) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[2].getProgress(execution.stepExecutions[2]);
        }
    }]);

    return ProbabilisticSensitivityAnalysisJob;
}(_simpleJob.SimpleJob);

},{"../../engine/simple-job":46,"../sensitivity-analysis/steps/calculate-step":13,"../sensitivity-analysis/steps/init-policies-step":14,"./probabilistic-sensitivity-analysis-job-parameters":6,"./steps/prepare-variables-step":8}],8:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.PrepareVariablesStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _sdExpressionEngine = require("sd-expression-engine");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var PrepareVariablesStep = exports.PrepareVariablesStep = function (_Step) {
    _inherits(PrepareVariablesStep, _Step);

    function PrepareVariablesStep(expressionEngine, jobRepository) {
        _classCallCheck(this, PrepareVariablesStep);

        var _this = _possibleConstructorReturn(this, (PrepareVariablesStep.__proto__ || Object.getPrototypeOf(PrepareVariablesStep)).call(this, "prepare_variables", jobRepository));

        _this.expressionEngine = expressionEngine;
        return _this;
    }

    _createClass(PrepareVariablesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var _this2 = this;

            var params = stepExecution.getJobParameters();
            var numberOfRuns = params.value("numberOfRuns");
            var variables = params.value("variables");
            var variableValues = [];
            var data = stepExecution.getData();

            for (var runIndex = 0; runIndex < numberOfRuns; runIndex++) {
                var singleRunVariableValues = [];
                variables.forEach(function (v) {
                    var evaluated = _this2.expressionEngine.eval(v.formula, true, _sdUtils.Utils.cloneDeep(data.expressionScope));
                    singleRunVariableValues.push(_sdExpressionEngine.ExpressionEngine.toFloat(evaluated));
                });
                variableValues.push(singleRunVariableValues);
            }

            jobResult.data = {
                variableValues: variableValues
            };

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }, {
        key: "sequence",
        value: function sequence(min, max, length) {
            var extent = _sdExpressionEngine.ExpressionEngine.subtract(max, min);
            var step = _sdExpressionEngine.ExpressionEngine.divide(extent, length - 1);
            var result = [min];
            var curr = min;

            for (var i = 0; i < length - 2; i++) {
                curr = _sdExpressionEngine.ExpressionEngine.add(curr, step);
                result.push(_sdExpressionEngine.ExpressionEngine.toFloat(curr));
            }
            result.push(max);
            return result;
        }
    }]);

    return PrepareVariablesStep;
}(_step.Step);

},{"../../../engine/job-status":44,"../../../engine/step":49,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],9:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.RecomputeJobParameters = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _jobParameters = require("../../engine/job-parameters");

var _jobParameterDefinition = require("../../engine/job-parameter-definition");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var RecomputeJobParameters = exports.RecomputeJobParameters = function (_JobParameters) {
    _inherits(RecomputeJobParameters, _JobParameters);

    function RecomputeJobParameters() {
        _classCallCheck(this, RecomputeJobParameters);

        return _possibleConstructorReturn(this, (RecomputeJobParameters.__proto__ || Object.getPrototypeOf(RecomputeJobParameters)).apply(this, arguments));
    }

    _createClass(RecomputeJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING, 0));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("evalCode", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("evalNumeric", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                ruleName: null, //recompute all rules
                evalCode: true,
                evalNumeric: true
            };
        }
    }]);

    return RecomputeJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":38,"../../engine/job-parameters":39,"sd-utils":"sd-utils"}],10:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.RecomputeJob = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _simpleJob = require("../../engine/simple-job");

var _step = require("../../engine/step");

var _jobStatus = require("../../engine/job-status");

var _treeValidator = require("../../../validation/tree-validator");

var _batchStep = require("../../engine/batch/batch-step");

var _recomputeJobParameters = require("./recompute-job-parameters");

var _job = require("../../engine/job");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var RecomputeJob = exports.RecomputeJob = function (_Job) {
    _inherits(RecomputeJob, _Job);

    function RecomputeJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, RecomputeJob);

        var _this = _possibleConstructorReturn(this, (RecomputeJob.__proto__ || Object.getPrototypeOf(RecomputeJob)).call(this, "recompute", jobRepository));

        _this.isRestartable = false;
        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;
        _this.treeValidator = new _treeValidator.TreeValidator();
        return _this;
    }

    _createClass(RecomputeJob, [{
        key: "doExecute",
        value: function doExecute(execution) {
            var data = execution.getData();
            var params = execution.jobParameters;
            var ruleName = params.value("ruleName");
            var allRules = !ruleName;
            if (ruleName) {
                this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            }
            this.checkValidityAndRecomputeObjective(data, allRules, params.value("evalCode"), params.value("evalNumeric"));
            return execution;
        }
    }, {
        key: "checkValidityAndRecomputeObjective",
        value: function checkValidityAndRecomputeObjective(data, allRules, evalCode, evalNumeric) {
            var _this2 = this;

            data.validationResults = [];

            if (evalCode || evalNumeric) {
                this.expressionsEvaluator.evalExpressions(data, evalCode, evalNumeric);
            }

            data.getRoots().forEach(function (root) {
                var vr = _this2.treeValidator.validate(data.getAllNodesInSubtree(root));
                data.validationResults.push(vr);
                if (vr.isValid()) {
                    _this2.objectiveRulesManager.recomputeTree(root, allRules);
                }
            });
        }
    }, {
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _recomputeJobParameters.RecomputeJobParameters(values);
        }
    }]);

    return RecomputeJob;
}(_job.Job);

},{"../../../validation/tree-validator":71,"../../engine/batch/batch-step":21,"../../engine/job":45,"../../engine/job-status":44,"../../engine/simple-job":46,"../../engine/step":49,"./recompute-job-parameters":9}],11:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SensitivityAnalysisJobParameters = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _jobParameters = require("../../engine/job-parameters");

var _jobParameterDefinition = require("../../engine/job-parameter-definition");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var SensitivityAnalysisJobParameters = exports.SensitivityAnalysisJobParameters = function (_JobParameters) {
    _inherits(SensitivityAnalysisJobParameters, _JobParameters);

    function SensitivityAnalysisJobParameters() {
        _classCallCheck(this, SensitivityAnalysisJobParameters);

        return _possibleConstructorReturn(this, (SensitivityAnalysisJobParameters.__proto__ || Object.getPrototypeOf(SensitivityAnalysisJobParameters)).apply(this, arguments));
    }

    _createClass(SensitivityAnalysisJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("extendedPolicyDescription", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("variables", [new _jobParameterDefinition.JobParameterDefinition("name", _jobParameterDefinition.PARAMETER_TYPE.STRING), new _jobParameterDefinition.JobParameterDefinition("min", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("max", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("length", _jobParameterDefinition.PARAMETER_TYPE.INTEGER).set("singleValueValidator", function (v) {
                return v >= 0;
            })], 1, Infinity, false, function (v) {
                return v["min"] <= v["max"];
            }, function (values) {
                return _sdUtils.Utils.isUnique(values, function (v) {
                    return v["name"];
                });
            } //Variable names should be unique
            ));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                extendedPolicyDescription: true
            };
        }
    }]);

    return SensitivityAnalysisJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":38,"../../engine/job-parameters":39,"sd-utils":"sd-utils"}],12:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SensitivityAnalysisJob = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _simpleJob = require("../../engine/simple-job");

var _sensitivityAnalysisJobParameters = require("./sensitivity-analysis-job-parameters");

var _prepareVariablesStep = require("./steps/prepare-variables-step");

var _initPoliciesStep = require("./steps/init-policies-step");

var _calculateStep = require("./steps/calculate-step");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var SensitivityAnalysisJob = exports.SensitivityAnalysisJob = function (_SimpleJob) {
    _inherits(SensitivityAnalysisJob, _SimpleJob);

    function SensitivityAnalysisJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, SensitivityAnalysisJob);

        var _this = _possibleConstructorReturn(this, (SensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(SensitivityAnalysisJob)).call(this, "sensitivity-analysis", jobRepository));

        _this.addStep(new _prepareVariablesStep.PrepareVariablesStep(jobRepository, expressionsEvaluator.expressionEngine));
        _this.addStep(new _initPoliciesStep.InitPoliciesStep(jobRepository));
        _this.addStep(new _calculateStep.CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
        return _this;
    }

    _createClass(SensitivityAnalysisJob, [{
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _sensitivityAnalysisJobParameters.SensitivityAnalysisJobParameters(values);
        }
    }, {
        key: "getJobDataValidator",
        value: function getJobDataValidator() {
            return {
                validate: function validate(data) {
                    return data.getRoots().length === 1;
                }
            };
        }

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(execution) {

            if (execution.stepExecutions.length <= 2) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[2].getProgress(execution.stepExecutions[2]);
        }
    }]);

    return SensitivityAnalysisJob;
}(_simpleJob.SimpleJob);

},{"../../engine/simple-job":46,"./sensitivity-analysis-job-parameters":11,"./steps/calculate-step":13,"./steps/init-policies-step":14,"./steps/prepare-variables-step":15}],13:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.CalculateStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _sdExpressionEngine = require("sd-expression-engine");

var _batchStep = require("../../../engine/batch/batch-step");

var _treeValidator = require("../../../../validation/tree-validator");

var _policy = require("../../../../policies/policy");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var CalculateStep = exports.CalculateStep = function (_BatchStep) {
    _inherits(CalculateStep, _BatchStep);

    function CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, CalculateStep);

        var _this = _possibleConstructorReturn(this, (CalculateStep.__proto__ || Object.getPrototypeOf(CalculateStep)).call(this, "calculate_step", jobRepository, 5));

        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;
        _this.treeValidator = new _treeValidator.TreeValidator();
        return _this;
    }

    _createClass(CalculateStep, [{
        key: "init",
        value: function init(stepExecution, jobResult) {
            var jobExecutionContext = stepExecution.getJobExecutionContext();
            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");

            this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            var variableValues = jobResult.data.variableValues;
            var variableNames = params.value("variables").map(function (v) {
                return v.name;
            });
            stepExecution.executionContext.put("variableNames", variableNames);

            if (!jobResult.data.headers) {
                var headers = ['policy'];
                variableNames.forEach(function (n) {
                    return headers.push(n);
                });
                headers.push('payoff');

                jobResult.data.headers = headers;
                jobResult.data.rows = [];
                jobResult.data.variableNames = variableNames;
            }

            return variableValues.length;
        }
    }, {
        key: "readNextChunk",
        value: function readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
            var variableValues = jobResult.data.variableValues;
            return variableValues.slice(startIndex, startIndex + chunkSize);
        }
    }, {
        key: "processItem",
        value: function processItem(stepExecution, item) {
            var _this2 = this;

            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            var data = stepExecution.getData();
            var treeRoot = data.getRoots()[0];
            var variableNames = stepExecution.executionContext.get("variableNames");
            var policies = stepExecution.getJobExecutionContext().get("policies");

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalGlobalCode(data);
            variableNames.forEach(function (variableName, i) {
                data.expressionScope[variableName] = item[i];
            });
            this.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
            var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

            var valid = vr.isValid();
            var payoffs = [];
            var dataList = [];
            policies.forEach(function (policy) {
                var payoff = 'n/a';
                if (valid) {
                    _this2.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                    payoff = treeRoot.computedValue(ruleName, 'payoff');
                }

                payoffs.push(payoff);
            });

            return {
                dataList: dataList,
                policies: policies,
                variables: item,
                payoffs: payoffs
            };
        }
    }, {
        key: "writeChunk",
        value: function writeChunk(stepExecution, items, jobResult) {
            var _this3 = this;

            var params = stepExecution.getJobParameters();
            var extendedPolicyDescription = params.value("extendedPolicyDescription");

            items.forEach(function (item) {
                if (!item) {
                    return;
                }
                item.policies.forEach(function (policy, i) {
                    var rowCells = [_policy.Policy.toPolicyString(policy, extendedPolicyDescription)];
                    item.variables.forEach(function (v) {
                        rowCells.push(_this3.toFloat(v));
                    });
                    var payoff = item.payoffs[i];
                    rowCells.push(_sdUtils.Utils.isString(payoff) ? payoff : _this3.toFloat(payoff));
                    var row = {
                        cells: rowCells,
                        policyIndex: i
                    };
                    jobResult.data.rows.push(row);
                });
            });
        }
    }, {
        key: "postProcess",
        value: function postProcess(stepExecution, jobResult) {
            delete jobResult.data.variableValues;
        }
    }, {
        key: "toFloat",
        value: function toFloat(v) {
            return _sdExpressionEngine.ExpressionEngine.toFloat(v);
        }
    }]);

    return CalculateStep;
}(_batchStep.BatchStep);

},{"../../../../policies/policy":68,"../../../../validation/tree-validator":71,"../../../engine/batch/batch-step":21,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],14:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.InitPoliciesStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _policiesCollector = require("../../../../policies/policies-collector");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var InitPoliciesStep = exports.InitPoliciesStep = function (_Step) {
    _inherits(InitPoliciesStep, _Step);

    function InitPoliciesStep(jobRepository) {
        _classCallCheck(this, InitPoliciesStep);

        return _possibleConstructorReturn(this, (InitPoliciesStep.__proto__ || Object.getPrototypeOf(InitPoliciesStep)).call(this, "init_policies", jobRepository));
    }

    _createClass(InitPoliciesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var data = stepExecution.getData();
            var treeRoot = data.getRoots()[0];
            var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot);

            var policies = policiesCollector.policies;
            stepExecution.getJobExecutionContext().put("policies", policies);
            jobResult.data.policies = policies;

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return InitPoliciesStep;
}(_step.Step);

},{"../../../../policies/policies-collector":67,"../../../engine/job-status":44,"../../../engine/step":49}],15:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.PrepareVariablesStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _sdExpressionEngine = require("sd-expression-engine");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var PrepareVariablesStep = exports.PrepareVariablesStep = function (_Step) {
    _inherits(PrepareVariablesStep, _Step);

    function PrepareVariablesStep(jobRepository, expressionEngine) {
        _classCallCheck(this, PrepareVariablesStep);

        var _this = _possibleConstructorReturn(this, (PrepareVariablesStep.__proto__ || Object.getPrototypeOf(PrepareVariablesStep)).call(this, "prepare_variables", jobRepository));

        _this.expressionEngine = expressionEngine;
        return _this;
    }

    _createClass(PrepareVariablesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var _this2 = this;

            var params = stepExecution.getJobParameters();
            var variables = params.value("variables");

            var variableValues = [];
            variables.forEach(function (v) {
                variableValues.push(_this2.sequence(v.min, v.max, v.length));
            });
            variableValues = _sdUtils.Utils.cartesianProductOf(variableValues);
            jobResult.data = {
                variableValues: variableValues
            };
            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }, {
        key: "sequence",
        value: function sequence(min, max, length) {
            var extent = _sdExpressionEngine.ExpressionEngine.subtract(max, min);
            var step = _sdExpressionEngine.ExpressionEngine.divide(extent, length - 1);
            var result = [min];
            var curr = min;

            for (var i = 0; i < length - 2; i++) {
                curr = _sdExpressionEngine.ExpressionEngine.add(curr, step);
                result.push(_sdExpressionEngine.ExpressionEngine.toFloat(curr));
            }
            result.push(max);
            return result;
        }
    }]);

    return PrepareVariablesStep;
}(_step.Step);

},{"../../../engine/job-status":44,"../../../engine/step":49,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],16:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.CalculateStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _sdExpressionEngine = require("sd-expression-engine");

var _batchStep = require("../../../engine/batch/batch-step");

var _treeValidator = require("../../../../validation/tree-validator");

var _policy = require("../../../../policies/policy");

var _policiesCollector = require("../../../../policies/policies-collector");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var CalculateStep = exports.CalculateStep = function (_BatchStep) {
    _inherits(CalculateStep, _BatchStep);

    function CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, CalculateStep);

        var _this = _possibleConstructorReturn(this, (CalculateStep.__proto__ || Object.getPrototypeOf(CalculateStep)).call(this, "calculate_step", jobRepository, 1));

        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;
        _this.treeValidator = new _treeValidator.TreeValidator();
        return _this;
    }

    _createClass(CalculateStep, [{
        key: "init",
        value: function init(stepExecution, jobResult) {
            var _this2 = this;

            var jobExecutionContext = stepExecution.getJobExecutionContext();
            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");

            this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            var variableValues = jobExecutionContext.get("variableValues");
            var variableNames = params.value("variables").map(function (v) {
                return v.name;
            });
            stepExecution.executionContext.put("variableNames", variableNames);
            var data = stepExecution.getData();
            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalGlobalCode(data);

            var defaultValues = {};
            _sdUtils.Utils.forOwn(data.expressionScope, function (v, k) {
                defaultValues[k] = _this2.toFloat(v);
            });

            if (!jobResult.data) {
                var headers = ['policy'];
                variableNames.forEach(function (n) {
                    return headers.push(n);
                });
                headers.push('payoff');
                jobResult.data = {
                    headers: headers,
                    rows: [],
                    variableNames: variableNames,
                    defaultValues: defaultValues,
                    policies: jobExecutionContext.get("policies")
                };
            }

            return variableValues.length;
        }
    }, {
        key: "readNextChunk",
        value: function readNextChunk(stepExecution, startIndex, chunkSize) {
            var variableValues = stepExecution.getJobExecutionContext().get("variableValues");
            return variableValues.slice(startIndex, startIndex + chunkSize);
        }
    }, {
        key: "processItem",
        value: function processItem(stepExecution, item, itemIndex) {
            var _this3 = this;

            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            var data = stepExecution.getData();
            var treeRoot = data.getRoots()[0];
            var variableNames = stepExecution.executionContext.get("variableNames");
            var variableName = variableNames[itemIndex];

            var results = [];

            item.forEach(function (variableValue) {

                _this3.expressionsEvaluator.clear(data);
                _this3.expressionsEvaluator.evalGlobalCode(data);

                data.expressionScope[variableName] = variableValue;

                _this3.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
                var vr = _this3.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));
                var valid = vr.isValid();

                if (!valid) {
                    return null;
                }

                _this3.objectiveRulesManager.recomputeTree(treeRoot, false);
                var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot, ruleName);
                var policies = policiesCollector.policies;

                var payoff = treeRoot.computedValue(ruleName, 'payoff');

                var r = {
                    policies: policies,
                    variableName: variableName,
                    variableIndex: itemIndex,
                    variableValue: variableValue,
                    payoff: payoff
                };
                results.push(r);
            });

            return results;
        }
    }, {
        key: "writeChunk",
        value: function writeChunk(stepExecution, items, jobResult) {
            var _this4 = this;

            var params = stepExecution.getJobParameters();

            var policyByKey = stepExecution.getJobExecutionContext().get("policyByKey");
            var policies = stepExecution.getJobExecutionContext().get("policies");

            items.forEach(function (itemsWrapper) {
                if (!itemsWrapper) {
                    return;
                }

                itemsWrapper.forEach(function (item) {
                    item.policies.forEach(function (policy) {

                        var rowCells = [_policy.Policy.toPolicyString(policy)];
                        jobResult.data.variableNames.forEach(function (v) {
                            var value = "default";
                            if (v == item.variableName) {
                                value = _this4.toFloat(item.variableValue);
                            } else if (jobResult.data.defaultValues.hasOwnProperty(v)) {
                                value = jobResult.data.defaultValues[v];
                            }
                            rowCells.push(value);
                        });
                        var payoff = item.payoff;
                        rowCells.push(_sdUtils.Utils.isString(payoff) ? payoff : _this4.toFloat(payoff));
                        var row = {
                            cells: rowCells,
                            policyIndex: policies.indexOf(policyByKey[policy.key])
                        };
                        jobResult.data.rows.push(row);
                    });
                });
            });
        }
    }, {
        key: "toFloat",
        value: function toFloat(v) {
            return _sdExpressionEngine.ExpressionEngine.toFloat(v);
        }
    }]);

    return CalculateStep;
}(_batchStep.BatchStep);

},{"../../../../policies/policies-collector":67,"../../../../policies/policy":68,"../../../../validation/tree-validator":71,"../../../engine/batch/batch-step":21,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],17:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.InitPoliciesStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _policiesCollector = require("../../../../policies/policies-collector");

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var InitPoliciesStep = exports.InitPoliciesStep = function (_Step) {
    _inherits(InitPoliciesStep, _Step);

    function InitPoliciesStep(jobRepository) {
        _classCallCheck(this, InitPoliciesStep);

        return _possibleConstructorReturn(this, (InitPoliciesStep.__proto__ || Object.getPrototypeOf(InitPoliciesStep)).call(this, "init_policies", jobRepository));
    }

    _createClass(InitPoliciesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, result) {
            var data = stepExecution.getData();
            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            var treeRoot = data.getRoots()[0];
            var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot);

            stepExecution.getJobExecutionContext().put("policies", policiesCollector.policies);
            stepExecution.getJobExecutionContext().put("policyByKey", _sdUtils.Utils.getObjectByIdMap(policiesCollector.policies, null, 'key'));
            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return InitPoliciesStep;
}(_step.Step);

},{"../../../../policies/policies-collector":67,"../../../engine/job-status":44,"../../../engine/step":49,"sd-utils":"sd-utils"}],18:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.PrepareVariablesStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _sdExpressionEngine = require("sd-expression-engine");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var PrepareVariablesStep = exports.PrepareVariablesStep = function (_Step) {
    _inherits(PrepareVariablesStep, _Step);

    function PrepareVariablesStep(jobRepository) {
        _classCallCheck(this, PrepareVariablesStep);

        return _possibleConstructorReturn(this, (PrepareVariablesStep.__proto__ || Object.getPrototypeOf(PrepareVariablesStep)).call(this, "prepare_variables", jobRepository));
    }

    _createClass(PrepareVariablesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution) {
            var _this2 = this;

            var params = stepExecution.getJobParameters();
            var variables = params.value("variables");

            var variableValues = [];
            variables.forEach(function (v) {
                variableValues.push(_this2.sequence(v.min, v.max, v.length));
            });
            // variableValues = Utils.cartesianProductOf(variableValues);
            stepExecution.getJobExecutionContext().put("variableValues", variableValues);

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }, {
        key: "sequence",
        value: function sequence(min, max, length) {
            var extent = max - min;
            var step = extent / (length - 1);
            var result = [min];
            var curr = min;

            for (var i = 0; i < length - 2; i++) {
                curr += step;

                result.push(_sdExpressionEngine.ExpressionEngine.toFloat(_sdExpressionEngine.ExpressionEngine.round(curr, 16)));
            }
            result.push(max);
            return result;
        }
    }]);

    return PrepareVariablesStep;
}(_step.Step);

},{"../../../engine/job-status":44,"../../../engine/step":49,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],19:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.TornadoDiagramJobParameters = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _jobParameters = require("../../engine/job-parameters");

var _jobParameterDefinition = require("../../engine/job-parameter-definition");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var TornadoDiagramJobParameters = exports.TornadoDiagramJobParameters = function (_JobParameters) {
    _inherits(TornadoDiagramJobParameters, _JobParameters);

    function TornadoDiagramJobParameters() {
        _classCallCheck(this, TornadoDiagramJobParameters);

        return _possibleConstructorReturn(this, (TornadoDiagramJobParameters.__proto__ || Object.getPrototypeOf(TornadoDiagramJobParameters)).apply(this, arguments));
    }

    _createClass(TornadoDiagramJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("variables", [new _jobParameterDefinition.JobParameterDefinition("name", _jobParameterDefinition.PARAMETER_TYPE.STRING), new _jobParameterDefinition.JobParameterDefinition("min", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("max", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("length", _jobParameterDefinition.PARAMETER_TYPE.INTEGER).set("singleValueValidator", function (v) {
                return v >= 0;
            })], 1, Infinity, false, function (v) {
                return v["min"] <= v["max"];
            }, function (values) {
                return _sdUtils.Utils.isUnique(values, function (v) {
                    return v["name"];
                });
            } //Variable names should be unique
            ));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid()
            };
        }
    }]);

    return TornadoDiagramJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":38,"../../engine/job-parameters":39,"sd-utils":"sd-utils"}],20:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.TornadoDiagramJob = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _simpleJob = require("../../engine/simple-job");

var _prepareVariablesStep = require("./steps/prepare-variables-step");

var _initPoliciesStep = require("./steps/init-policies-step");

var _calculateStep = require("./steps/calculate-step");

var _tornadoDiagramJobParameters = require("./tornado-diagram-job-parameters");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var TornadoDiagramJob = exports.TornadoDiagramJob = function (_SimpleJob) {
    _inherits(TornadoDiagramJob, _SimpleJob);

    function TornadoDiagramJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, TornadoDiagramJob);

        var _this = _possibleConstructorReturn(this, (TornadoDiagramJob.__proto__ || Object.getPrototypeOf(TornadoDiagramJob)).call(this, "tornado-diagram", jobRepository));

        _this.addStep(new _prepareVariablesStep.PrepareVariablesStep(jobRepository));
        _this.addStep(new _initPoliciesStep.InitPoliciesStep(jobRepository));
        _this.addStep(new _calculateStep.CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
        return _this;
    }

    _createClass(TornadoDiagramJob, [{
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _tornadoDiagramJobParameters.TornadoDiagramJobParameters(values);
        }
    }, {
        key: "getJobDataValidator",
        value: function getJobDataValidator() {
            return {
                validate: function validate(data) {
                    return data.getRoots().length === 1;
                }
            };
        }

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(execution) {

            if (execution.stepExecutions.length <= 2) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[2].getProgress(execution.stepExecutions[2]);
        }
    }]);

    return TornadoDiagramJob;
}(_simpleJob.SimpleJob);

},{"../../engine/simple-job":46,"./steps/calculate-step":16,"./steps/init-policies-step":17,"./steps/prepare-variables-step":18,"./tornado-diagram-job-parameters":19}],21:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.BatchStep = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobStatus = require("../job-status");

var _sdUtils = require("sd-utils");

var _step = require("../step");

var _jobInterruptedException = require("../exceptions/job-interrupted-exception");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*job step that process batch of items*/
var BatchStep = exports.BatchStep = function (_Step) {
    _inherits(BatchStep, _Step);

    function BatchStep(name, jobRepository, chunkSize) {
        _classCallCheck(this, BatchStep);

        var _this = _possibleConstructorReturn(this, (BatchStep.__proto__ || Object.getPrototypeOf(BatchStep)).call(this, name, jobRepository));

        _this.chunkSize = chunkSize;
        return _this;
    }

    /**
     * Extension point for subclasses to perform step initialization. Should return total item count
     */

    _createClass(BatchStep, [{
        key: "init",
        value: function init(stepExecution, jobResult) {
            throw "BatchStep.init function not implemented for step: " + this.name;
        }

        /**
         * Extension point for subclasses to read and return chunk of items to process
         */

    }, {
        key: "readNextChunk",
        value: function readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
            throw "BatchStep.readNextChunk function not implemented for step: " + this.name;
        }

        /**
         * Extension point for subclasses to process single item
         * Must return processed item which will be passed in a chunk to writeChunk function
         */

    }, {
        key: "processItem",
        value: function processItem(stepExecution, item, jobResult) {
            throw "BatchStep.processItem function not implemented for step: " + this.name;
        }

        /**
         * Extension point for subclasses to write chunk of items. Not required
         */

    }, {
        key: "writeChunk",
        value: function writeChunk(stepExecution, items, jobResult) {}

        /**
         * Extension point for subclasses to perform postprocessing after all items have been processed. Not required
         */

    }, {
        key: "postProcess",
        value: function postProcess(stepExecution, jobResult) {}
    }, {
        key: "setTotalItemCount",
        value: function setTotalItemCount(stepExecution, count) {
            stepExecution.executionContext.put(BatchStep.TOTAL_ITEM_COUNT_PROP, count);
        }
    }, {
        key: "getTotalItemCount",
        value: function getTotalItemCount(stepExecution) {
            return stepExecution.executionContext.get(BatchStep.TOTAL_ITEM_COUNT_PROP);
        }
    }, {
        key: "setCurrentItemCount",
        value: function setCurrentItemCount(stepExecution, count) {
            stepExecution.executionContext.put(BatchStep.CURRENT_ITEM_COUNT_PROP, count);
        }
    }, {
        key: "getCurrentItemCount",
        value: function getCurrentItemCount(stepExecution) {
            return stepExecution.executionContext.get(BatchStep.CURRENT_ITEM_COUNT_PROP) || 0;
        }
    }, {
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var _this2 = this;

            return Promise.resolve().then(function () {
                return _this2.init(stepExecution, jobResult);
            }).catch(function (e) {
                _sdUtils.log.error("Failed to initialize batch step: " + _this2.name, e);
                throw e;
            }).then(function (totalItemCount) {
                return Promise.resolve().then(function () {
                    _this2.setCurrentItemCount(stepExecution, _this2.getCurrentItemCount(stepExecution));
                    _this2.setTotalItemCount(stepExecution, totalItemCount);
                    return _this2.handleNextChunk(stepExecution, jobResult);
                }).catch(function (e) {
                    if (!(e instanceof _jobInterruptedException.JobInterruptedException)) {
                        _sdUtils.log.error("Failed to handle batch step: " + _this2.name, e);
                    }
                    throw e;
                });
            }).then(function () {
                return Promise.resolve().then(function () {
                    return _this2.postProcess(stepExecution, jobResult);
                }).catch(function (e) {
                    _sdUtils.log.error("Failed to postProcess batch step: " + _this2.name, e);
                    throw e;
                });
            }).then(function () {
                stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
                return stepExecution;
            });
        }
    }, {
        key: "handleNextChunk",
        value: function handleNextChunk(stepExecution, jobResult) {
            var _this3 = this;

            var currentItemCount = this.getCurrentItemCount(stepExecution);
            var totalItemCount = this.getTotalItemCount(stepExecution);
            var chunkSize = Math.min(this.chunkSize, totalItemCount - currentItemCount);
            if (currentItemCount >= totalItemCount) {
                return stepExecution;
            }
            return this.checkJobExecutionFlags(stepExecution).then(function () {
                // Check if someone is trying to stop us
                if (stepExecution.terminateOnly) {
                    throw new _jobInterruptedException.JobInterruptedException("JobExecution interrupted.");
                }
                return stepExecution;
            }).then(function () {
                return Promise.resolve().then(function () {
                    return _this3.readNextChunk(stepExecution, currentItemCount, chunkSize, jobResult);
                }).catch(function (e) {
                    _sdUtils.log.error("Failed to read chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + _this3.name, e);
                    throw e;
                });
            }).then(function (chunk) {
                return Promise.resolve().then(function () {
                    return _this3.processChunk(stepExecution, chunk, currentItemCount, jobResult);
                }).catch(function (e) {
                    _sdUtils.log.error("Failed to process chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + _this3.name, e);
                    throw e;
                });
            }).then(function (processedChunk) {
                return Promise.resolve().then(function () {
                    return _this3.writeChunk(stepExecution, processedChunk, jobResult);
                }).catch(function (e) {
                    _sdUtils.log.error("Failed to write chunk (" + currentItemCount + "," + chunkSize + ") in batch step: " + _this3.name, e);
                    throw e;
                });
            }).then(function (res) {
                currentItemCount += chunkSize;
                _this3.setCurrentItemCount(stepExecution, currentItemCount);
                return _this3.updateJobProgress(stepExecution).then(function () {
                    return _this3.handleNextChunk(stepExecution, jobResult);
                });
            });
        }
    }, {
        key: "processChunk",
        value: function processChunk(stepExecution, chunk, currentItemCount, jobResult) {
            var _this4 = this;

            //TODO promisify
            return chunk.map(function (item, i) {
                return _this4.processItem(stepExecution, item, currentItemCount + i, jobResult);
            });
        }

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(stepExecution) {
            return {
                total: this.getTotalItemCount(stepExecution),
                current: this.getCurrentItemCount(stepExecution)
            };
        }
    }, {
        key: "updateJobProgress",
        value: function updateJobProgress(stepExecution) {
            var progress = this.jobRepository.getJobByName(stepExecution.jobExecution.jobInstance.jobName).getProgress(stepExecution.jobExecution);
            return this.jobRepository.updateJobExecutionProgress(stepExecution.jobExecution.id, progress);
        }
    }, {
        key: "checkJobExecutionFlags",
        value: function checkJobExecutionFlags(stepExecution) {
            return this.jobRepository.getJobByName(stepExecution.jobExecution.jobInstance.jobName).checkExecutionFlags(stepExecution.jobExecution);
        }
    }]);

    return BatchStep;
}(_step.Step);

BatchStep.CURRENT_ITEM_COUNT_PROP = 'batch_step_current_item_count';
BatchStep.TOTAL_ITEM_COUNT_PROP = 'batch_step_total_item_count';

},{"../exceptions/job-interrupted-exception":27,"../job-status":44,"../step":49,"sd-utils":"sd-utils"}],22:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

function _extendableBuiltin(cls) {
    function ExtendableBuiltin() {
        var instance = Reflect.construct(cls, Array.from(arguments));
        Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
        return instance;
    }

    ExtendableBuiltin.prototype = Object.create(cls.prototype, {
        constructor: {
            value: cls,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    if (Object.setPrototypeOf) {
        Object.setPrototypeOf(ExtendableBuiltin, cls);
    } else {
        ExtendableBuiltin.__proto__ = cls;
    }

    return ExtendableBuiltin;
}

var ExtendableError = exports.ExtendableError = function (_extendableBuiltin2) {
    _inherits(ExtendableError, _extendableBuiltin2);

    function ExtendableError(message) {
        _classCallCheck(this, ExtendableError);

        var _this = _possibleConstructorReturn(this, (ExtendableError.__proto__ || Object.getPrototypeOf(ExtendableError)).call(this, message));

        _this.name = _this.constructor.name;
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(_this, _this.constructor);
        } else {
            _this.stack = new Error(message).stack;
        }
        return _this;
    }

    return ExtendableError;
}(_extendableBuiltin(Error));

},{}],23:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extendableError = require('./extendable-error');

Object.keys(_extendableError).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _extendableError[key];
    }
  });
});

var _jobDataInvalidException = require('./job-data-invalid-exception');

Object.keys(_jobDataInvalidException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobDataInvalidException[key];
    }
  });
});

var _jobExecutionAlreadyRunningException = require('./job-execution-already-running-exception');

Object.keys(_jobExecutionAlreadyRunningException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobExecutionAlreadyRunningException[key];
    }
  });
});

var _jobInstanceAlreadyCompleteException = require('./job-instance-already-complete-exception');

Object.keys(_jobInstanceAlreadyCompleteException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobInstanceAlreadyCompleteException[key];
    }
  });
});

var _jobInterruptedException = require('./job-interrupted-exception');

Object.keys(_jobInterruptedException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobInterruptedException[key];
    }
  });
});

var _jobParametersInvalidException = require('./job-parameters-invalid-exception');

Object.keys(_jobParametersInvalidException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobParametersInvalidException[key];
    }
  });
});

var _jobRestartException = require('./job-restart-exception');

Object.keys(_jobRestartException).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobRestartException[key];
    }
  });
});

},{"./extendable-error":22,"./job-data-invalid-exception":24,"./job-execution-already-running-exception":25,"./job-instance-already-complete-exception":26,"./job-interrupted-exception":27,"./job-parameters-invalid-exception":28,"./job-restart-exception":29}],24:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobDataInvalidException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobDataInvalidException = exports.JobDataInvalidException = function (_ExtendableError) {
  _inherits(JobDataInvalidException, _ExtendableError);

  function JobDataInvalidException() {
    _classCallCheck(this, JobDataInvalidException);

    return _possibleConstructorReturn(this, (JobDataInvalidException.__proto__ || Object.getPrototypeOf(JobDataInvalidException)).apply(this, arguments));
  }

  return JobDataInvalidException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],25:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobExecutionAlreadyRunningException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobExecutionAlreadyRunningException = exports.JobExecutionAlreadyRunningException = function (_ExtendableError) {
  _inherits(JobExecutionAlreadyRunningException, _ExtendableError);

  function JobExecutionAlreadyRunningException() {
    _classCallCheck(this, JobExecutionAlreadyRunningException);

    return _possibleConstructorReturn(this, (JobExecutionAlreadyRunningException.__proto__ || Object.getPrototypeOf(JobExecutionAlreadyRunningException)).apply(this, arguments));
  }

  return JobExecutionAlreadyRunningException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],26:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobInstanceAlreadyCompleteException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobInstanceAlreadyCompleteException = exports.JobInstanceAlreadyCompleteException = function (_ExtendableError) {
  _inherits(JobInstanceAlreadyCompleteException, _ExtendableError);

  function JobInstanceAlreadyCompleteException() {
    _classCallCheck(this, JobInstanceAlreadyCompleteException);

    return _possibleConstructorReturn(this, (JobInstanceAlreadyCompleteException.__proto__ || Object.getPrototypeOf(JobInstanceAlreadyCompleteException)).apply(this, arguments));
  }

  return JobInstanceAlreadyCompleteException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],27:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobInterruptedException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobInterruptedException = exports.JobInterruptedException = function (_ExtendableError) {
  _inherits(JobInterruptedException, _ExtendableError);

  function JobInterruptedException() {
    _classCallCheck(this, JobInterruptedException);

    return _possibleConstructorReturn(this, (JobInterruptedException.__proto__ || Object.getPrototypeOf(JobInterruptedException)).apply(this, arguments));
  }

  return JobInterruptedException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],28:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobParametersInvalidException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobParametersInvalidException = exports.JobParametersInvalidException = function (_ExtendableError) {
  _inherits(JobParametersInvalidException, _ExtendableError);

  function JobParametersInvalidException() {
    _classCallCheck(this, JobParametersInvalidException);

    return _possibleConstructorReturn(this, (JobParametersInvalidException.__proto__ || Object.getPrototypeOf(JobParametersInvalidException)).apply(this, arguments));
  }

  return JobParametersInvalidException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],29:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobRestartException = undefined;

var _extendableError = require("./extendable-error");

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
  }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobRestartException = exports.JobRestartException = function (_ExtendableError) {
  _inherits(JobRestartException, _ExtendableError);

  function JobRestartException() {
    _classCallCheck(this, JobRestartException);

    return _possibleConstructorReturn(this, (JobRestartException.__proto__ || Object.getPrototypeOf(JobRestartException)).apply(this, arguments));
  }

  return JobRestartException;
}(_extendableError.ExtendableError);

},{"./extendable-error":22}],30:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ExecutionContext = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var ExecutionContext = exports.ExecutionContext = function () {
    function ExecutionContext(context) {
        _classCallCheck(this, ExecutionContext);

        this.dirty = false;
        this.context = {};

        if (context) {
            this.context = _sdUtils.Utils.clone(context);
        }
    }

    _createClass(ExecutionContext, [{
        key: "put",
        value: function put(key, value) {
            var prevValue = this.context[key];
            if (value != null) {
                var result = this.context[key] = value;
                this.dirty = prevValue == null || prevValue != null && prevValue != value;
            } else {
                delete this.context[key];
                this.dirty = prevValue != null;
            }
        }
    }, {
        key: "get",
        value: function get(key) {
            return this.context[key];
        }
    }, {
        key: "containsKey",
        value: function containsKey(key) {
            return this.context.hasOwnProperty(key);
        }
    }, {
        key: "remove",
        value: function remove(key) {
            delete this.context[key];
        }
    }, {
        key: "setData",
        value: function setData(data) {
            //set data model
            return this.put("data", data);
        }
    }, {
        key: "getData",
        value: function getData() {
            // get data model
            return this.get("data");
        }
    }, {
        key: "getDTO",
        value: function getDTO() {
            var dto = _sdUtils.Utils.cloneDeep(this);
            var data = this.getData();
            if (data) {
                data = data.getDTO();
                dto.context["data"] = data;
            }
            return dto;
        }
    }]);

    return ExecutionContext;
}();

},{"sd-utils":"sd-utils"}],31:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.exceptions = undefined;

var _executionContext = require('./execution-context');

Object.keys(_executionContext).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _executionContext[key];
    }
  });
});

var _job = require('./job');

Object.keys(_job).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _job[key];
    }
  });
});

var _jobExecution = require('./job-execution');

Object.keys(_jobExecution).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobExecution[key];
    }
  });
});

var _jobExecutionFlag = require('./job-execution-flag');

Object.keys(_jobExecutionFlag).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobExecutionFlag[key];
    }
  });
});

var _jobExecutionListener = require('./job-execution-listener');

Object.keys(_jobExecutionListener).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobExecutionListener[key];
    }
  });
});

var _jobInstance = require('./job-instance');

Object.keys(_jobInstance).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobInstance[key];
    }
  });
});

var _jobKeyGenerator = require('./job-key-generator');

Object.keys(_jobKeyGenerator).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobKeyGenerator[key];
    }
  });
});

var _jobLauncher = require('./job-launcher');

Object.keys(_jobLauncher).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobLauncher[key];
    }
  });
});

var _jobParameterDefinition = require('./job-parameter-definition');

Object.keys(_jobParameterDefinition).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobParameterDefinition[key];
    }
  });
});

var _jobParameters = require('./job-parameters');

Object.keys(_jobParameters).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobParameters[key];
    }
  });
});

var _jobStatus = require('./job-status');

Object.keys(_jobStatus).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobStatus[key];
    }
  });
});

var _simpleJob = require('./simple-job');

Object.keys(_simpleJob).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _simpleJob[key];
    }
  });
});

var _step = require('./step');

Object.keys(_step).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _step[key];
    }
  });
});

var _stepExecution = require('./step-execution');

Object.keys(_stepExecution).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _stepExecution[key];
    }
  });
});

var _stepExecutionListener = require('./step-execution-listener');

Object.keys(_stepExecutionListener).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _stepExecutionListener[key];
    }
  });
});

var _exceptions = require('./exceptions');

var exceptions = _interopRequireWildcard(_exceptions);

function _interopRequireWildcard(obj) {
  if (obj && obj.__esModule) {
    return obj;
  } else {
    var newObj = {};if (obj != null) {
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key];
      }
    }newObj.default = obj;return newObj;
  }
}

exports.exceptions = exceptions;

},{"./exceptions":23,"./execution-context":30,"./job":45,"./job-execution":34,"./job-execution-flag":32,"./job-execution-listener":33,"./job-instance":35,"./job-key-generator":36,"./job-launcher":37,"./job-parameter-definition":38,"./job-parameters":39,"./job-status":44,"./simple-job":46,"./step":49,"./step-execution":48,"./step-execution-listener":47}],32:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
var JOB_EXECUTION_FLAG = exports.JOB_EXECUTION_FLAG = {
    STOP: 'STOP'
};

},{}],33:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobExecutionListener = exports.JobExecutionListener = function () {
    function JobExecutionListener() {
        _classCallCheck(this, JobExecutionListener);
    }

    _createClass(JobExecutionListener, [{
        key: "beforeJob",

        /*Called before a job executes*/
        value: function beforeJob(jobExecution) {}

        /*Called after completion of a job. Called after both successful and failed executions*/

    }, {
        key: "afterJob",
        value: function afterJob(jobExecution) {}
    }]);

    return JobExecutionListener;
}();

},{}],34:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobExecution = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobStatus = require("./job-status");

var _stepExecution = require("./step-execution");

var _sdUtils = require("sd-utils");

var _executionContext = require("./execution-context");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*domain object representing the execution of a job.*/
var JobExecution = exports.JobExecution = function () {
    function JobExecution(jobInstance, jobParameters, id) {
        _classCallCheck(this, JobExecution);

        this.stepExecutions = [];
        this.status = _jobStatus.JOB_STATUS.STARTING;
        this.exitStatus = _jobStatus.JOB_STATUS.UNKNOWN;
        this.executionContext = new _executionContext.ExecutionContext();
        this.startTime = null;
        this.createTime = new Date();
        this.endTime = null;
        this.lastUpdated = null;
        this.failureExceptions = [];

        if (id === null || id === undefined) {
            this.id = _sdUtils.Utils.guid();
        } else {
            this.id = id;
        }

        this.jobInstance = jobInstance;
        this.jobParameters = jobParameters;
    }

    /**
     * Register a step execution with the current job execution.
     * @param stepName the name of the step the new execution is associated with
     */

    _createClass(JobExecution, [{
        key: "createStepExecution",
        value: function createStepExecution(stepName) {
            var stepExecution = new _stepExecution.StepExecution(stepName, this);
            this.stepExecutions.push(stepExecution);
            return stepExecution;
        }
    }, {
        key: "isRunning",
        value: function isRunning() {
            return !this.endTime;
        }

        /**
         * Test if this JobExecution has been signalled to
         * stop.
         */

    }, {
        key: "isStopping",
        value: function isStopping() {
            return this.status === _jobStatus.JOB_STATUS.STOPPING;
        }

        /**
         * Signal the JobExecution to stop.
         */

    }, {
        key: "stop",
        value: function stop() {
            this.stepExecutions.forEach(function (se) {
                se.terminateOnly = true;
            });
            this.status = _jobStatus.JOB_STATUS.STOPPING;
        }
    }, {
        key: "getData",
        value: function getData() {
            return this.executionContext.getData();
        }
    }, {
        key: "getDTO",
        value: function getDTO() {
            var filteredProperties = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
            var deepClone = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            var cloneMethod = _sdUtils.Utils.cloneDeepWith;
            if (!deepClone) {
                cloneMethod = _sdUtils.Utils.cloneWith;
            }

            return _sdUtils.Utils.assign({}, cloneMethod(this, function (value, key, object, stack) {
                if (filteredProperties.indexOf(key) > -1) {
                    return null;
                }

                if (["jobParameters", "executionContext"].indexOf(key) > -1) {
                    return value.getDTO();
                }
                if (value instanceof Error) {
                    return _sdUtils.Utils.getErrorDTO(value);
                }

                if (value instanceof _stepExecution.StepExecution) {
                    return value.getDTO(["jobExecution"], deepClone);
                }
            }));
        }
    }]);

    return JobExecution;
}();

},{"./execution-context":30,"./job-status":44,"./step-execution":48,"sd-utils":"sd-utils"}],35:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/* object representing a uniquely identifiable job run. JobInstance can be restarted multiple times in case of execution failure and it's lifecycle ends with first successful execution*/
var JobInstance = exports.JobInstance = function JobInstance(id, jobName) {
    _classCallCheck(this, JobInstance);

    this.id = id;
    this.jobName = jobName;
};

},{}],36:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobKeyGenerator = exports.JobKeyGenerator = function () {
    function JobKeyGenerator() {
        _classCallCheck(this, JobKeyGenerator);
    }

    _createClass(JobKeyGenerator, null, [{
        key: "generateKey",

        /*Method to generate the unique key used to identify a job instance.*/
        value: function generateKey(jobParameters) {
            var result = "";
            jobParameters.definitions.forEach(function (d, i) {
                if (d.identifying) {
                    result += d.name + "=" + jobParameters.values[d.name] + ";";
                }
            });
            return result;
        }
    }]);

    return JobKeyGenerator;
}();

},{}],37:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobLauncher = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobRestartException = require("./exceptions/job-restart-exception");

var _jobStatus = require("./job-status");

var _sdUtils = require("sd-utils");

var _jobParametersInvalidException = require("./exceptions/job-parameters-invalid-exception");

var _jobDataInvalidException = require("./exceptions/job-data-invalid-exception");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobLauncher = exports.JobLauncher = function () {
    function JobLauncher(jobRepository, jobWorker, dataModelSerializer) {
        _classCallCheck(this, JobLauncher);

        this.jobRepository = jobRepository;
        this.jobWorker = jobWorker;
        this.dataModelSerializer = dataModelSerializer;
    }

    _createClass(JobLauncher, [{
        key: "run",
        value: function run(jobOrName, jobParametersValues, data) {
            var _this = this;

            var resolvePromiseAfterJobIsLaunched = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;

            var job;
            var jobParameters;

            return Promise.resolve().then(function () {
                if (_sdUtils.Utils.isString(jobOrName)) {
                    job = _this.jobRepository.getJobByName(jobOrName);
                } else {
                    job = jobOrName;
                }
                if (!job) {
                    throw new _jobRestartException.JobRestartException("No such job: " + jobOrName);
                }

                jobParameters = job.createJobParameters(jobParametersValues);

                return _this.validate(job, jobParameters, data);
            }).then(function (valid) {
                return _this.jobRepository.createJobExecution(job.name, jobParameters, data).then(function (jobExecution) {

                    if (_this.jobWorker) {
                        _sdUtils.log.debug("Job: [" + job.name + "] execution [" + jobExecution.id + "] delegated to worker");
                        _this.jobWorker.executeJob(jobExecution.id);
                        return jobExecution;
                    }

                    var executionPromise = _this._execute(job, jobExecution);
                    if (resolvePromiseAfterJobIsLaunched) {
                        return jobExecution;
                    }
                    return executionPromise;
                });
            });
        }
    }, {
        key: "validate",
        value: function validate(job, jobParameters, data) {
            return this.jobRepository.getLastJobExecution(job.name, jobParameters).then(function (lastExecution) {
                if (lastExecution != null) {
                    if (!job.isRestartable) {
                        throw new _jobRestartException.JobRestartException("JobInstance already exists and is not restartable");
                    }

                    lastExecution.stepExecutions.forEach(function (execution) {
                        if (execution.status == _jobStatus.JOB_STATUS.UNKNOWN) {
                            throw new _jobRestartException.JobRestartException("Step [" + execution.stepName + "] is of status UNKNOWN");
                        }
                    });
                }
                if (job.jobParametersValidator && !job.jobParametersValidator.validate(jobParameters)) {
                    throw new _jobParametersInvalidException.JobParametersInvalidException("Invalid job parameters in jobLauncher.run for job: " + job.name);
                }

                if (job.jobDataValidator && !job.jobDataValidator.validate(data)) {
                    throw new _jobDataInvalidException.JobDataInvalidException("Invalid job data in jobLauncher.run for job: " + job.name);
                }

                return true;
            });
        }

        /**Execute previously created job execution*/

    }, {
        key: "execute",
        value: function execute(jobExecutionOrId) {
            var _this2 = this;

            return Promise.resolve().then(function () {
                if (_sdUtils.Utils.isString(jobExecutionOrId)) {
                    return _this2.jobRepository.getJobExecutionById(jobExecutionOrId);
                }
                return jobExecutionOrId;
            }).then(function (jobExecution) {
                if (!jobExecution) {
                    throw new _jobRestartException.JobRestartException("JobExecution [" + jobExecutionOrId + "] is not found");
                }

                if (jobExecution.status !== _jobStatus.JOB_STATUS.STARTING) {
                    throw new _jobRestartException.JobRestartException("JobExecution [" + jobExecution.id + "] already started");
                }

                var jobName = jobExecution.jobInstance.jobName;
                var job = _this2.jobRepository.getJobByName(jobName);
                if (!job) {
                    throw new _jobRestartException.JobRestartException("No such job: " + jobName);
                }

                return _this2._execute(job, jobExecution);
            });
        }
    }, {
        key: "_execute",
        value: function _execute(job, jobExecution) {
            var jobName = job.name;
            _sdUtils.log.info("Job: [" + jobName + "] launched with the following parameters: [" + jobExecution.jobParameters + "]", jobExecution.getData());
            return job.execute(jobExecution).then(function (jobExecution) {
                _sdUtils.log.info("Job: [" + jobName + "] completed with the following parameters: [" + jobExecution.jobParameters + "] and the following status: [" + jobExecution.status + "]");
                return jobExecution;
            }).catch(function (e) {
                _sdUtils.log.error("Job: [" + jobName + "] failed unexpectedly and fatally with the following parameters: [" + jobExecution.jobParameters + "]", e);
                throw e;
            });
        }
    }]);

    return JobLauncher;
}();

},{"./exceptions/job-data-invalid-exception":24,"./exceptions/job-parameters-invalid-exception":28,"./exceptions/job-restart-exception":29,"./job-status":44,"sd-utils":"sd-utils"}],38:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobParameterDefinition = exports.PARAMETER_TYPE = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require('sd-utils');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var PARAMETER_TYPE = exports.PARAMETER_TYPE = {
    STRING: 'STRING',
    DATE: 'DATE',
    INTEGER: 'INTEGER',
    NUMBER: 'FLOAT',
    BOOLEAN: 'BOOLEAN',
    NUMBER_EXPRESSION: 'NUMBER_EXPRESSION',
    COMPOSITE: 'COMPOSITE' //composite parameter with nested subparameters
};

var JobParameterDefinition = exports.JobParameterDefinition = function () {
    function JobParameterDefinition(name, typeOrNestedParametersDefinitions) {
        var minOccurs = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;
        var maxOccurs = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 1;
        var identifying = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : false;
        var singleValueValidator = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : null;
        var validator = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : null;

        _classCallCheck(this, JobParameterDefinition);

        this.nestedParameters = [];
        this.required = true;

        this.name = name;
        if (_sdUtils.Utils.isArray(typeOrNestedParametersDefinitions)) {
            this.type = PARAMETER_TYPE.COMPOSITE;
            this.nestedParameters = typeOrNestedParametersDefinitions;
        } else {
            this.type = typeOrNestedParametersDefinitions;
        }
        this.validator = validator;
        this.singleValueValidator = singleValueValidator;
        this.identifying = identifying;
        this.minOccurs = minOccurs;
        this.maxOccurs = maxOccurs;
    }

    _createClass(JobParameterDefinition, [{
        key: 'set',
        value: function set(key, val) {
            this[key] = val;
            return this;
        }
    }, {
        key: 'validate',
        value: function validate(value) {
            var isArray = _sdUtils.Utils.isArray(value);

            if (this.maxOccurs > 1 && !isArray) {
                return false;
            }

            if (!isArray) {
                return this.validateSingleValue(value);
            }

            if (value.length < this.minOccurs || value.length > this.maxOccurs) {
                return false;
            }

            if (!value.every(this.validateSingleValue, this)) {
                return false;
            }

            if (this.validator) {
                return this.validator(value);
            }

            return true;
        }
    }, {
        key: 'validateSingleValue',
        value: function validateSingleValue(value) {
            if ((value === null || value === undefined) && this.minOccurs > 0) {
                return false;
            }

            if (this.required && !value && value !== 0 && value !== false) {
                return false;
            }

            if (PARAMETER_TYPE.STRING === this.type && !_sdUtils.Utils.isString(value)) {
                return false;
            }
            if (PARAMETER_TYPE.DATE === this.type && !_sdUtils.Utils.isDate(value)) {
                return false;
            }
            if (PARAMETER_TYPE.INTEGER === this.type && !_sdUtils.Utils.isInt(value)) {
                return false;
            }
            if (PARAMETER_TYPE.NUMBER === this.type && !_sdUtils.Utils.isNumber(value)) {
                return false;
            }

            if (PARAMETER_TYPE.COMPOSITE === this.type) {
                if (!_sdUtils.Utils.isObject(value)) {
                    return false;
                }
                if (!this.nestedParameters.every(function (nestedDef, i) {
                    return nestedDef.validate(value[nestedDef.name]);
                })) {
                    return false;
                }
            }

            if (this.singleValueValidator) {
                return this.singleValueValidator(value);
            }

            return true;
        }
    }]);

    return JobParameterDefinition;
}();

},{"sd-utils":"sd-utils"}],39:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobParameters = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobParameterDefinition = require("./job-parameter-definition");

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobParameters = function () {
    function JobParameters(values) {
        _classCallCheck(this, JobParameters);

        this.definitions = [];
        this.values = {};

        this.initDefinitions();
        this.initDefaultValues();
        if (values) {
            _sdUtils.Utils.deepExtend(this.values, values);
        }
    }

    _createClass(JobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {}
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {}
    }, {
        key: "validate",
        value: function validate() {
            var _this = this;

            return this.definitions.every(function (def, i) {
                return def.validate(_this.values[def.name]);
            });
        }

        /*get or set value by path*/

    }, {
        key: "value",
        value: function value(path, _value) {
            if (arguments.length === 1) {
                return _sdUtils.Utils.get(this.values, path, null);
            }
            _sdUtils.Utils.set(this.values, path, _value);
            return _value;
        }
    }, {
        key: "toString",
        value: function toString() {
            var _this2 = this;

            var result = "JobParameters[";

            this.definitions.forEach(function (d, i) {

                var val = _this2.values[d.name];
                // if(Utils.isArray(val)){
                //     var values = val;
                //
                //
                // }
                // if(PARAMETER_TYPE.COMPOSITE == d.type){
                //
                // }

                result += d.name + "=" + val + ";";
            });
            result += "]";
            return result;
        }
    }, {
        key: "getDTO",
        value: function getDTO() {
            return {
                values: this.values
            };
        }
    }]);

    return JobParameters;
}();

exports.JobParameters = JobParameters;

},{"./job-parameter-definition":38,"sd-utils":"sd-utils"}],40:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.IdbJobRepository = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobRepository = require("./job-repository");

var _idb = require("idb");

var _idb2 = _interopRequireDefault(_idb);

var _sdUtils = require("sd-utils");

var _jobExecution = require("../job-execution");

var _jobInstance = require("../job-instance");

var _stepExecution = require("../step-execution");

var _executionContext = require("../execution-context");

var _sdModel = require("sd-model");

function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/* IndexedDB job repository*/
var IdbJobRepository = exports.IdbJobRepository = function (_JobRepository) {
    _inherits(IdbJobRepository, _JobRepository);

    function IdbJobRepository(expressionsReviver) {
        var dbName = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'sd-job-repository';
        var deleteDB = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

        _classCallCheck(this, IdbJobRepository);

        var _this = _possibleConstructorReturn(this, (IdbJobRepository.__proto__ || Object.getPrototypeOf(IdbJobRepository)).call(this));

        _this.dbName = dbName;
        _this.expressionsReviver = expressionsReviver;
        if (deleteDB) {
            _this.deleteDB().then(function () {
                _this.initDB();
            });
        } else {
            _this.initDB();
        }

        _this.jobInstanceDao = new ObjectStoreDao('job-instances', _this.dbPromise);
        _this.jobExecutionDao = new ObjectStoreDao('job-executions', _this.dbPromise);
        _this.jobExecutionProgressDao = new ObjectStoreDao('job-execution-progress', _this.dbPromise);
        _this.jobExecutionFlagDao = new ObjectStoreDao('job-execution-flags', _this.dbPromise);

        _this.stepExecutionDao = new ObjectStoreDao('step-executions', _this.dbPromise);
        _this.jobResultDao = new ObjectStoreDao('job-results', _this.dbPromise);
        return _this;
    }

    _createClass(IdbJobRepository, [{
        key: "initDB",
        value: function initDB() {
            this.dbPromise = _idb2.default.open(this.dbName, 1, function (upgradeDB) {
                upgradeDB.createObjectStore('job-instances');
                var jobExecutionsOS = upgradeDB.createObjectStore('job-executions');
                jobExecutionsOS.createIndex("jobInstanceId", "jobInstance.id", { unique: false });
                jobExecutionsOS.createIndex("createTime", "createTime", { unique: false });
                jobExecutionsOS.createIndex("status", "status", { unique: false });
                upgradeDB.createObjectStore('job-execution-progress');
                upgradeDB.createObjectStore('job-execution-flags');
                var stepExecutionsOS = upgradeDB.createObjectStore('step-executions');
                stepExecutionsOS.createIndex("jobExecutionId", "jobExecutionId", { unique: false });

                var jobResultOS = upgradeDB.createObjectStore('job-results');
                jobResultOS.createIndex("jobInstanceId", "jobInstance.id", { unique: true });
            });
        }
    }, {
        key: "deleteDB",
        value: function deleteDB() {
            var _this2 = this;

            return Promise.resolve().then(function (_) {
                return _idb2.default.delete(_this2.dbName);
            });
        }
    }, {
        key: "getJobResult",
        value: function getJobResult(jobResultId) {
            return this.jobResultDao.get(jobResultId);
        }
    }, {
        key: "getJobResultByInstance",
        value: function getJobResultByInstance(jobInstance) {
            return this.jobResultDao.getByIndex("jobInstanceId", jobInstance.id);
        }
    }, {
        key: "saveJobResult",
        value: function saveJobResult(jobResult) {
            return this.jobResultDao.set(jobResult.id, jobResult).then(function (r) {
                return jobResult;
            });
        }

        /*returns promise*/

    }, {
        key: "getJobInstance",
        value: function getJobInstance(jobName, jobParameters) {
            var _this3 = this;

            var key = this.generateJobInstanceKey(jobName, jobParameters);
            return this.jobInstanceDao.get(key).then(function (dto) {
                return dto ? _this3.reviveJobInstance(dto) : dto;
            });
        }

        /*should return promise that resolves to saved instance*/

    }, {
        key: "saveJobInstance",
        value: function saveJobInstance(jobInstance, jobParameters) {
            var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
            return this.jobInstanceDao.set(key, jobInstance).then(function (r) {
                return jobInstance;
            });
        }

        /*should return promise that resolves to saved jobExecution*/

    }, {
        key: "saveJobExecution",
        value: function saveJobExecution(jobExecution) {
            var _this4 = this;

            var dto = jobExecution.getDTO();
            var stepExecutionsDTOs = dto.stepExecutions;
            dto.stepExecutions = null;
            return this.jobExecutionDao.set(jobExecution.id, dto).then(function (r) {
                return _this4.saveStepExecutionsDTOS(stepExecutionsDTOs);
            }).then(function (r) {
                return jobExecution;
            });
        }
    }, {
        key: "updateJobExecutionProgress",
        value: function updateJobExecutionProgress(jobExecutionId, progress) {
            return this.jobExecutionProgressDao.set(jobExecutionId, progress);
        }
    }, {
        key: "getJobExecutionProgress",
        value: function getJobExecutionProgress(jobExecutionId) {
            return this.jobExecutionProgressDao.get(jobExecutionId);
        }
    }, {
        key: "saveJobExecutionFlag",
        value: function saveJobExecutionFlag(jobExecutionId, flag) {
            return this.jobExecutionFlagDao.set(jobExecutionId, flag);
        }
    }, {
        key: "getJobExecutionFlag",
        value: function getJobExecutionFlag(jobExecutionId) {
            return this.jobExecutionFlagDao.get(jobExecutionId);
        }

        /*should return promise which resolves to saved stepExecution*/

    }, {
        key: "saveStepExecution",
        value: function saveStepExecution(stepExecution) {
            var dto = stepExecution.getDTO(["jobExecution"]);
            return this.stepExecutionDao.set(stepExecution.id, dto).then(function (r) {
                return stepExecution;
            });
        }
    }, {
        key: "saveStepExecutionsDTOS",
        value: function saveStepExecutionsDTOS(stepExecutions) {
            var _this5 = this;

            var savedExecutions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

            if (stepExecutions.length <= savedExecutions.length) {
                return Promise.resolve(savedExecutions);
            }
            var stepExecutionDTO = stepExecutions[savedExecutions.length];
            return this.stepExecutionDao.set(stepExecutionDTO.id, stepExecutionDTO).then(function () {
                savedExecutions.push(stepExecutionDTO);
                return _this5.saveStepExecutionsDTOS(stepExecutions, savedExecutions);
            });
        }
    }, {
        key: "getJobExecutionById",
        value: function getJobExecutionById(id) {
            var _this6 = this;

            return this.jobExecutionDao.get(id).then(function (dto) {
                return _this6.fetchJobExecutionRelations(dto);
            });
        }
    }, {
        key: "fetchJobExecutionRelations",
        value: function fetchJobExecutionRelations(jobExecutionDTO) {
            var _this7 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            if (!jobExecutionDTO) {
                return Promise.resolve(null);
            }
            return this.findStepExecutions(jobExecutionDTO.id, false).then(function (steps) {
                jobExecutionDTO.stepExecutions = steps;
                if (!revive) {
                    return jobExecutionDTO;
                }
                return _this7.reviveJobExecution(jobExecutionDTO);
            });
        }
    }, {
        key: "fetchJobExecutionsRelations",
        value: function fetchJobExecutionsRelations(jobExecutionDtoList) {
            var _this8 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
            var fetched = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

            if (jobExecutionDtoList.length <= fetched.length) {
                return Promise.resolve(fetched);
            }
            return this.fetchJobExecutionRelations(jobExecutionDtoList[fetched.length], revive).then(function (jobExecution) {
                fetched.push(jobExecution);

                return _this8.fetchJobExecutionsRelations(jobExecutionDtoList, revive, fetched);
            });
        }
    }, {
        key: "findStepExecutions",
        value: function findStepExecutions(jobExecutionId) {
            var _this9 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            return this.stepExecutionDao.getAllByIndex("jobExecutionId", jobExecutionId).then(function (dtos) {
                if (!revive) {
                    return dtos;
                }
                return dtos.map(function (dto) {
                    return _this9.reviveStepExecution(dto);
                });
            });
        }

        /*find job executions sorted by createTime, returns promise*/

    }, {
        key: "findJobExecutions",
        value: function findJobExecutions(jobInstance) {
            var _this10 = this;

            var fetchRelationsAndRevive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            return this.jobExecutionDao.getAllByIndex("jobInstanceId", jobInstance.id).then(function (values) {
                var sorted = values.sort(function (a, b) {
                    return a.createTime.getTime() - b.createTime.getTime();
                });

                if (!fetchRelationsAndRevive) {
                    return sorted;
                }

                return _this10.fetchJobExecutionsRelations(sorted, true);
            });
        }
    }, {
        key: "getLastJobExecutionByInstance",
        value: function getLastJobExecutionByInstance(jobInstance) {
            var _this11 = this;

            return this.findJobExecutions(jobInstance, false).then(function (executions) {
                return _this11.fetchJobExecutionRelations(executions[executions.length - 1]);
            });
        }
    }, {
        key: "getLastStepExecution",
        value: function getLastStepExecution(jobInstance, stepName) {
            return this.findJobExecutions(jobInstance).then(function (jobExecutions) {
                var stepExecutions = [];
                jobExecutions.forEach(function (jobExecution) {
                    return jobExecution.stepExecutions.filter(function (s) {
                        return s.stepName === stepName;
                    }).forEach(function (s) {
                        return stepExecutions.push(s);
                    });
                });
                var latest = null;
                stepExecutions.forEach(function (s) {
                    if (latest == null || latest.startTime.getTime() < s.startTime.getTime()) {
                        latest = s;
                    }
                });
                return latest;
            });
        }
    }, {
        key: "reviveJobInstance",
        value: function reviveJobInstance(dto) {
            return new _jobInstance.JobInstance(dto.id, dto.jobName);
        }
    }, {
        key: "reviveExecutionContext",
        value: function reviveExecutionContext(dto) {
            var executionContext = new _executionContext.ExecutionContext();
            executionContext.context = dto.context;
            var data = executionContext.getData();
            if (data) {
                var dataModel = new _sdModel.DataModel();
                dataModel.loadFromDTO(data, this.expressionsReviver);
                executionContext.setData(dataModel);
            }
            return executionContext;
        }
    }, {
        key: "reviveJobExecution",
        value: function reviveJobExecution(dto) {
            var _this12 = this;

            var job = this.getJobByName(dto.jobInstance.jobName);
            var jobInstance = this.reviveJobInstance(dto.jobInstance);
            var jobParameters = job.createJobParameters(dto.jobParameters.values);
            var jobExecution = new _jobExecution.JobExecution(jobInstance, jobParameters, dto.id);
            var executionContext = this.reviveExecutionContext(dto.executionContext);
            return _sdUtils.Utils.mergeWith(jobExecution, dto, function (objValue, srcValue, key, object, source, stack) {
                if (key === "jobInstance") {
                    return jobInstance;
                }
                if (key === "executionContext") {
                    return executionContext;
                }
                if (key === "jobParameters") {
                    return jobParameters;
                }
                if (key === "jobExecution") {
                    return jobExecution;
                }

                if (key === "stepExecutions") {
                    return srcValue.map(function (stepDTO) {
                        return _this12.reviveStepExecution(stepDTO, jobExecution);
                    });
                }
            });
        }
    }, {
        key: "reviveStepExecution",
        value: function reviveStepExecution(dto, jobExecution) {
            var stepExecution = new _stepExecution.StepExecution(dto.stepName, jobExecution, dto.id);
            var executionContext = this.reviveExecutionContext(dto.executionContext);
            return _sdUtils.Utils.mergeWith(stepExecution, dto, function (objValue, srcValue, key, object, source, stack) {
                if (key === "jobExecution") {
                    return jobExecution;
                }
                if (key === "executionContext") {
                    return executionContext;
                }
            });
        }
    }]);

    return IdbJobRepository;
}(_jobRepository.JobRepository);

var ObjectStoreDao = function () {
    function ObjectStoreDao(name, dbPromise) {
        _classCallCheck(this, ObjectStoreDao);

        this.name = name;
        this.dbPromise = dbPromise;
    }

    _createClass(ObjectStoreDao, [{
        key: "get",
        value: function get(key) {
            var _this13 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this13.name).objectStore(_this13.name).get(key);
            });
        }
    }, {
        key: "getAllByIndex",
        value: function getAllByIndex(indexName, key) {
            var _this14 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this14.name).objectStore(_this14.name).index(indexName).getAll(key);
            });
        }
    }, {
        key: "getByIndex",
        value: function getByIndex(indexName, key) {
            var _this15 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this15.name).objectStore(_this15.name).index(indexName).get(key);
            });
        }
    }, {
        key: "set",
        value: function set(key, val) {
            var _this16 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this16.name, 'readwrite');
                tx.objectStore(_this16.name).put(val, key);
                return tx.complete;
            });
        }
    }, {
        key: "remove",
        value: function remove(key) {
            var _this17 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this17.name, 'readwrite');
                tx.objectStore(_this17.name).delete(key);
                return tx.complete;
            });
        }
    }, {
        key: "clear",
        value: function clear() {
            var _this18 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this18.name, 'readwrite');
                tx.objectStore(_this18.name).clear();
                return tx.complete;
            });
        }
    }, {
        key: "keys",
        value: function keys() {
            var _this19 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this19.name);
                var keys = [];
                var store = tx.objectStore(_this19.name);

                // This would be store.getAllKeys(), but it isn't supported by Edge or Safari.
                // openKeyCursor isn't supported by Safari, so we fall back
                (store.iterateKeyCursor || store.iterateCursor).call(store, function (cursor) {
                    if (!cursor) return;
                    keys.push(cursor.key);
                    cursor.continue();
                });

                return tx.complete.then(function () {
                    return keys;
                });
            });
        }
    }]);

    return ObjectStoreDao;
}();

},{"../execution-context":30,"../job-execution":34,"../job-instance":35,"../step-execution":48,"./job-repository":41,"idb":1,"sd-model":"sd-model","sd-utils":"sd-utils"}],41:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobRepository = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobKeyGenerator = require("../job-key-generator");

var _jobInstance = require("../job-instance");

var _sdUtils = require("sd-utils");

var _jobExecution = require("../job-execution");

var _jobExecutionAlreadyRunningException = require("../exceptions/job-execution-already-running-exception");

var _jobStatus = require("../job-status");

var _jobInstanceAlreadyCompleteException = require("../exceptions/job-instance-already-complete-exception");

var _executionContext = require("../execution-context");

var _stepExecution = require("../step-execution");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobRepository = exports.JobRepository = function () {
    function JobRepository() {
        _classCallCheck(this, JobRepository);

        this.jobByName = {};
    }

    _createClass(JobRepository, [{
        key: "registerJob",
        value: function registerJob(job) {
            this.jobByName[job.name] = job;
        }
    }, {
        key: "getJobByName",
        value: function getJobByName(name) {
            return this.jobByName[name];
        }

        /*returns promise*/

    }, {
        key: "getJobInstance",
        value: function getJobInstance(jobName, jobParameters) {
            throw "JobRepository getJobInstance function not implemented!";
        }

        /*should return promise that resolves to saved instance*/

    }, {
        key: "saveJobInstance",
        value: function saveJobInstance(key, jobInstance) {
            throw "JobRepository.saveJobInstance function not implemented!";
        }
    }, {
        key: "getJobExecutionById",
        value: function getJobExecutionById(id) {
            throw "JobRepository.getJobExecutionById function not implemented!";
        }

        /*should return promise that resolves to saved jobExecution*/

    }, {
        key: "saveJobExecution",
        value: function saveJobExecution(jobExecution) {
            throw "JobRepository.saveJobInstance function not implemented!";
        }
    }, {
        key: "updateJobExecutionProgress",
        value: function updateJobExecutionProgress(jobExecutionId, progress) {
            throw "JobRepository.saveJobInstance function not implemented!";
        }
    }, {
        key: "getJobExecutionProgress",
        value: function getJobExecutionProgress(jobExecutionId) {
            throw "JobRepository.getJobExecutionProgress function not implemented!";
        }
    }, {
        key: "saveJobExecutionFlag",
        value: function saveJobExecutionFlag(jobExecutionId, flag) {
            throw "JobRepository.saveJobExecutionFlag function not implemented!";
        }
    }, {
        key: "getJobExecutionFlag",
        value: function getJobExecutionFlag(jobExecutionId) {
            throw "JobRepository.getJobExecutionFlag function not implemented!";
        }

        /*should return promise which resolves to saved stepExecution*/

    }, {
        key: "saveStepExecution",
        value: function saveStepExecution(stepExecution) {
            throw "JobRepository.saveStepExecution function not implemented!";
        }

        /*find job executions sorted by createTime, returns promise*/

    }, {
        key: "findJobExecutions",
        value: function findJobExecutions(jobInstance) {
            throw "JobRepository.findJobExecutions function not implemented!";
        }
    }, {
        key: "getJobResult",
        value: function getJobResult(jobResultId) {
            throw "JobRepository.getJobResult function not implemented!";
        }
    }, {
        key: "getJobResultByInstance",
        value: function getJobResultByInstance(jobInstance) {
            throw "JobRepository.getJobResultByInstance function not implemented!";
        }
    }, {
        key: "saveJobResult",
        value: function saveJobResult(jobResult) {
            throw "JobRepository.setJobResult function not implemented!";
        }

        /*Create a new JobInstance with the name and job parameters provided. return promise*/

    }, {
        key: "createJobInstance",
        value: function createJobInstance(jobName, jobParameters) {
            var jobInstance = new _jobInstance.JobInstance(_sdUtils.Utils.guid(), jobName);
            return this.saveJobInstance(jobInstance, jobParameters);
        }

        /*Check if an instance of this job already exists with the parameters provided.*/

    }, {
        key: "isJobInstanceExists",
        value: function isJobInstanceExists(jobName, jobParameters) {
            return this.getJobInstance(jobName, jobParameters).then(function (result) {
                return !!result;
            }).catch(function (error) {
                return false;
            });
        }
    }, {
        key: "generateJobInstanceKey",
        value: function generateJobInstanceKey(jobName, jobParameters) {
            return jobName + "|" + _jobKeyGenerator.JobKeyGenerator.generateKey(jobParameters);
        }

        /*Create a JobExecution for a given  Job and JobParameters. If matching JobInstance already exists,
         * the job must be restartable and it's last JobExecution must *not* be
         * completed. If matching JobInstance does not exist yet it will be  created.*/

    }, {
        key: "createJobExecution",
        value: function createJobExecution(jobName, jobParameters, data) {
            var _this = this;

            return this.getJobInstance(jobName, jobParameters).then(function (jobInstance) {
                if (jobInstance != null) {
                    return _this.findJobExecutions(jobInstance).then(function (executions) {
                        executions.forEach(function (execution) {
                            if (execution.isRunning()) {
                                throw new _jobExecutionAlreadyRunningException.JobExecutionAlreadyRunningException("A job execution for this job is already running: " + jobInstance.jobName);
                            }
                            if (execution.status == _jobStatus.JOB_STATUS.COMPLETED || execution.status == _jobStatus.JOB_STATUS.ABANDONED) {
                                throw new _jobInstanceAlreadyCompleteException.JobInstanceAlreadyCompleteException("A job instance already exists and is complete for parameters=" + jobParameters + ".  If you want to run this job again, change the parameters.");
                            }
                        });

                        var executionContext = executions[executions.length - 1].executionContext;

                        return [jobInstance, executionContext];
                    });
                }

                // no job found, create one
                jobInstance = _this.createJobInstance(jobName, jobParameters);
                var executionContext = new _executionContext.ExecutionContext();
                executionContext.setData(data);
                return Promise.all([jobInstance, executionContext]);
            }).then(function (instanceAndExecutionContext) {
                var jobExecution = new _jobExecution.JobExecution(instanceAndExecutionContext[0], jobParameters);
                jobExecution.executionContext = instanceAndExecutionContext[1];
                jobExecution.lastUpdated = new Date();
                return _this.saveJobExecution(jobExecution);
            }).catch(function (e) {
                throw e;
            });
        }
    }, {
        key: "getLastJobExecution",
        value: function getLastJobExecution(jobName, jobParameters) {
            var _this2 = this;

            return this.getJobInstance(jobName, jobParameters).then(function (jobInstance) {
                if (!jobInstance) {
                    return null;
                }
                return _this2.getLastJobExecutionByInstance(jobInstance);
            });
        }
    }, {
        key: "getLastJobExecutionByInstance",
        value: function getLastJobExecutionByInstance(jobInstance) {
            return this.findJobExecutions(jobInstance).then(function (executions) {
                return executions[executions.length - 1];
            });
        }
    }, {
        key: "getLastStepExecution",
        value: function getLastStepExecution(jobInstance, stepName) {
            return this.findJobExecutions(jobInstance).then(function (jobExecutions) {
                var stepExecutions = [];
                jobExecutions.forEach(function (jobExecution) {
                    return jobExecution.stepExecutions.filter(function (s) {
                        return s.stepName === stepName;
                    }).forEach(function (s) {
                        return stepExecutions.push(s);
                    });
                });
                var latest = null;
                stepExecutions.forEach(function (s) {
                    if (latest == null || latest.startTime.getTime() < s.startTime.getTime()) {
                        latest = s;
                    }
                });
                return latest;
            });
        }
    }, {
        key: "addStepExecution",
        value: function addStepExecution(stepExecution) {
            stepExecution.lastUpdated = new Date();
            return this.saveStepExecution(stepExecution);
        }
    }, {
        key: "update",
        value: function update(o) {
            o.lastUpdated = new Date();

            if (o instanceof _jobExecution.JobExecution) {
                return this.saveJobExecution(o);
            }

            if (o instanceof _stepExecution.StepExecution) {
                return this.saveStepExecution(o);
            }

            throw "Object not updatable: " + o;
        }
    }, {
        key: "remove",
        value: function remove(o) {//TODO
            // if(o instanceof JobExecution){
            //     return this.removeJobExecution(o);
            // }
            //
            // if(o instanceof StepExecution){
            //     return this.removeStepExecution(o);
            // }
        }
    }, {
        key: "reviveJobInstance",
        value: function reviveJobInstance(dto) {
            return dto;
        }
    }, {
        key: "reviveExecutionContext",
        value: function reviveExecutionContext(dto) {
            return dto;
        }
    }, {
        key: "reviveJobExecution",
        value: function reviveJobExecution(dto) {
            return dto;
        }
    }, {
        key: "reviveStepExecution",
        value: function reviveStepExecution(dto, jobExecution) {
            return dto;
        }
    }]);

    return JobRepository;
}();

},{"../exceptions/job-execution-already-running-exception":25,"../exceptions/job-instance-already-complete-exception":26,"../execution-context":30,"../job-execution":34,"../job-instance":35,"../job-key-generator":36,"../job-status":44,"../step-execution":48,"sd-utils":"sd-utils"}],42:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.TimeoutJobRepository = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobRepository = require("./job-repository");

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var TimeoutJobRepository = exports.TimeoutJobRepository = function (_JobRepository) {
    _inherits(TimeoutJobRepository, _JobRepository);

    function TimeoutJobRepository() {
        var _ref;

        var _temp, _this, _ret;

        _classCallCheck(this, TimeoutJobRepository);

        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        return _ret = (_temp = (_this = _possibleConstructorReturn(this, (_ref = TimeoutJobRepository.__proto__ || Object.getPrototypeOf(TimeoutJobRepository)).call.apply(_ref, [this].concat(args))), _this), _this.jobInstancesByKey = {}, _this.jobExecutions = [], _this.stepExecutions = [], _this.executionProgress = {}, _this.executionFlags = {}, _this.jobResults = [], _temp), _possibleConstructorReturn(_this, _ret);
    }

    _createClass(TimeoutJobRepository, [{
        key: "createTimeoutPromise",
        value: function createTimeoutPromise(valueToResolve) {
            var delay = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;

            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(valueToResolve);
                }, delay);
            });
        }

        /*returns promise*/

    }, {
        key: "getJobInstance",
        value: function getJobInstance(jobName, jobParameters) {
            var key = this.generateJobInstanceKey(jobName, jobParameters);
            return this.createTimeoutPromise(this.jobInstancesByKey[key]);
        }

        /*should return promise that resolves to saved instance*/

    }, {
        key: "saveJobInstance",
        value: function saveJobInstance(jobInstance, jobParameters) {
            var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
            this.jobInstancesByKey[key] = jobInstance;
            return this.createTimeoutPromise(jobInstance);
        }
    }, {
        key: "getJobResult",
        value: function getJobResult(jobResultId) {
            return this.createTimeoutPromise(_sdUtils.Utils.find(this.jobResults, function (r) {
                return r.id === jobResultId;
            }));
        }
    }, {
        key: "getJobResultByInstance",
        value: function getJobResultByInstance(jobInstance) {
            return this.createTimeoutPromise(_sdUtils.Utils.find(this.jobResults, function (r) {
                return r.jobInstance.id === jobInstance.id;
            }));
        }
    }, {
        key: "saveJobResult",
        value: function saveJobResult(jobResult) {
            this.jobResults.push(jobResult);
            return this.createTimeoutPromise(jobResult);
        }
    }, {
        key: "getJobExecutionById",
        value: function getJobExecutionById(id) {
            return this.createTimeoutPromise(_sdUtils.Utils.find(this.jobExecutions, function (ex) {
                return ex.id === id;
            }));
        }

        /*should return promise that resolves to saved jobExecution*/

    }, {
        key: "saveJobExecution",
        value: function saveJobExecution(jobExecution) {
            this.jobExecutions.push(jobExecution);
            return this.createTimeoutPromise(jobExecution);
        }
    }, {
        key: "updateJobExecutionProgress",
        value: function updateJobExecutionProgress(jobExecutionId, progress) {
            this.executionProgress[jobExecutionId] = progress;
            return this.createTimeoutPromise(progress);
        }
    }, {
        key: "getJobExecutionProgress",
        value: function getJobExecutionProgress(jobExecutionId) {
            return this.createTimeoutPromise(this.executionProgress[jobExecutionId]);
        }
    }, {
        key: "saveJobExecutionFlag",
        value: function saveJobExecutionFlag(jobExecutionId, flag) {
            this.executionFlags[jobExecutionId] = flag;
            return this.createTimeoutPromise(flag);
        }
    }, {
        key: "getJobExecutionFlag",
        value: function getJobExecutionFlag(jobExecutionId) {
            return this.createTimeoutPromise(this.executionFlags[jobExecutionId]);
        }

        /*should return promise which resolves to saved stepExecution*/

    }, {
        key: "saveStepExecution",
        value: function saveStepExecution(stepExecution) {
            this.stepExecutions.push(stepExecution);
            return this.createTimeoutPromise(stepExecution);
        }

        /*find job executions sorted by createTime, returns promise*/

    }, {
        key: "findJobExecutions",
        value: function findJobExecutions(jobInstance) {
            return this.createTimeoutPromise(this.jobExecutions.filter(function (e) {
                return e.jobInstance.id == jobInstance.id;
            }).sort(function (a, b) {
                return a.createTime.getTime() - b.createTime.getTime();
            }));
        }
    }, {
        key: "remove",
        value: function remove(object) {//TODO

        }
    }]);

    return TimeoutJobRepository;
}(_jobRepository.JobRepository);

},{"./job-repository":41,"sd-utils":"sd-utils"}],43:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobResult = undefined;

var _jobStatus = require("./job-status");

var _stepExecution = require("./step-execution");

var _sdUtils = require("sd-utils");

var _executionContext = require("./execution-context");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*domain object representing the result of a job instance.*/
var JobResult = exports.JobResult = function JobResult(jobInstance, id) {
    _classCallCheck(this, JobResult);

    this.lastUpdated = null;

    if (id === null || id === undefined) {
        this.id = _sdUtils.Utils.guid();
    } else {
        this.id = id;
    }

    this.jobInstance = jobInstance;
};

},{"./execution-context":30,"./job-status":44,"./step-execution":48,"sd-utils":"sd-utils"}],44:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
var JOB_STATUS = exports.JOB_STATUS = {
    COMPLETED: 'COMPLETED',
    STARTING: 'STARTING',
    STARTED: 'STARTED',
    STOPPING: 'STOPPING',
    STOPPED: 'STOPPED',
    FAILED: 'FAILED',
    UNKNOWN: 'UNKNOWN',
    ABANDONED: 'ABANDONED',
    EXECUTING: 'EXECUTING' //for exit status only
};

},{}],45:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.Job = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _jobStatus = require("./job-status");

var _jobInterruptedException = require("./exceptions/job-interrupted-exception");

var _jobParametersInvalidException = require("./exceptions/job-parameters-invalid-exception");

var _jobDataInvalidException = require("./exceptions/job-data-invalid-exception");

var _jobExecutionFlag = require("./job-execution-flag");

var _jobResult = require("./job-result");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Base class for jobs*/
//A Job is an entity that encapsulates an entire job process ( an abstraction representing the configuration of a job).

var Job = exports.Job = function () {
    function Job(name, jobRepository) {
        _classCallCheck(this, Job);

        this.steps = [];
        this.isRestartable = true;
        this.executionListeners = [];

        this.name = name;
        this.jobParametersValidator = this.getJobParametersValidator();
        this.jobDataValidator = this.getJobDataValidator();
        this.jobRepository = jobRepository;
    }

    _createClass(Job, [{
        key: "setJobRepository",
        value: function setJobRepository(jobRepository) {
            this.jobRepository = jobRepository;
        }
    }, {
        key: "execute",
        value: function execute(execution) {
            var _this = this;

            _sdUtils.log.debug("Job execution starting: ", execution);
            var jobResult;
            return this.checkExecutionFlags(execution).then(function (execution) {

                if (execution.status === _jobStatus.JOB_STATUS.STOPPING) {
                    // The job was already stopped
                    execution.status = _jobStatus.JOB_STATUS.STOPPED;
                    execution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
                    _sdUtils.log.debug("Job execution was stopped: " + execution);
                    return execution;
                }

                if (_this.jobParametersValidator && !_this.jobParametersValidator.validate(execution.jobParameters)) {
                    throw new _jobParametersInvalidException.JobParametersInvalidException("Invalid job parameters in job execute");
                }

                if (_this.jobDataValidator && !_this.jobDataValidator.validate(execution.getData())) {
                    throw new _jobDataInvalidException.JobDataInvalidException("Invalid job data in job execute");
                }

                execution.startTime = new Date();
                return Promise.all([_this.updateStatus(execution, _jobStatus.JOB_STATUS.STARTED), _this.getResult(execution), _this.updateProgress(execution)]).then(function (res) {
                    execution = res[0];
                    jobResult = res[1];
                    if (!jobResult) {
                        jobResult = new _jobResult.JobResult(execution.jobInstance);
                    }
                    _this.executionListeners.forEach(function (listener) {
                        return listener.beforeJob(execution);
                    });

                    return _this.doExecute(execution, jobResult);
                });
            }).then(function (execution) {
                _sdUtils.log.debug("Job execution complete: ", execution);
                return execution;
            }).catch(function (e) {
                if (e instanceof _jobInterruptedException.JobInterruptedException) {
                    _sdUtils.log.info("Encountered interruption executing job", e);
                    execution.status = _jobStatus.JOB_STATUS.STOPPED;
                    execution.exitStatus = _jobStatus.JOB_STATUS.STOPPED;
                } else {
                    _sdUtils.log.error("Encountered fatal error executing job", e);
                    execution.status = _jobStatus.JOB_STATUS.FAILED;
                    execution.exitStatus = _jobStatus.JOB_STATUS.FAILED;
                }
                execution.failureExceptions.push(e);
                return execution;
            }).then(function (execution) {
                if (jobResult) {
                    return _this.jobRepository.saveJobResult(jobResult).then(function () {
                        return execution;
                    });
                }
                return execution;
            }).catch(function (e) {
                _sdUtils.log.error("Encountered fatal error saving job results", e);
                if (e) {
                    execution.failureExceptions.push(e);
                }
                execution.status = _jobStatus.JOB_STATUS.FAILED;
                execution.exitStatus = _jobStatus.JOB_STATUS.FAILED;
                return execution;
            }).then(function (execution) {
                execution.endTime = new Date();
                return Promise.all([_this.jobRepository.update(execution), _this.updateProgress(execution)]).then(function (res) {
                    return res[0];
                });
            }).then(function (execution) {
                try {
                    _this.executionListeners.forEach(function (listener) {
                        return listener.afterJob(execution);
                    });
                } catch (e) {
                    _sdUtils.log.error("Exception encountered in afterStep callback", e);
                }
                return execution;
            });
        }
    }, {
        key: "updateStatus",
        value: function updateStatus(jobExecution, status) {
            jobExecution.status = status;
            return this.jobRepository.update(jobExecution);
        }
    }, {
        key: "updateProgress",
        value: function updateProgress(jobExecution) {
            return this.jobRepository.updateJobExecutionProgress(jobExecution.id, this.getProgress(jobExecution));
        }

        /* Extension point for subclasses allowing them to concentrate on processing logic and ignore listeners, returns promise*/

    }, {
        key: "doExecute",
        value: function doExecute(execution, jobResult) {
            throw 'doExecute function not implemented for job: ' + this.name;
        }
    }, {
        key: "getJobParametersValidator",
        value: function getJobParametersValidator() {
            return {
                validate: function validate(params) {
                    return params.validate();
                }
            };
        }
    }, {
        key: "getJobDataValidator",
        value: function getJobDataValidator() {
            return {
                validate: function validate(data) {
                    return true;
                }
            };
        }
    }, {
        key: "addStep",
        value: function addStep(step) {
            this.steps.push(step);
        }
    }, {
        key: "createJobParameters",
        value: function createJobParameters(values) {
            throw 'createJobParameters function not implemented for job: ' + this.name;
        }

        /*Should return progress object with fields:
        * current
        * total */

    }, {
        key: "getProgress",
        value: function getProgress(execution) {
            return {
                total: 1,
                current: execution.status === _jobStatus.JOB_STATUS.COMPLETED ? 1 : 0
            };
        }
    }, {
        key: "registerExecutionListener",
        value: function registerExecutionListener(listener) {
            this.executionListeners.push(listener);
        }
    }, {
        key: "checkExecutionFlags",
        value: function checkExecutionFlags(execution) {
            return this.jobRepository.getJobExecutionFlag(execution.id).then(function (flag) {
                if (_jobExecutionFlag.JOB_EXECUTION_FLAG.STOP === flag) {
                    execution.stop();
                }
                return execution;
            });
        }
    }, {
        key: "getResult",
        value: function getResult(execution) {
            return this.jobRepository.getJobResultByInstance(execution.jobInstance);
        }
    }]);

    return Job;
}();

},{"./exceptions/job-data-invalid-exception":24,"./exceptions/job-interrupted-exception":27,"./exceptions/job-parameters-invalid-exception":28,"./job-execution-flag":32,"./job-result":43,"./job-status":44,"sd-utils":"sd-utils"}],46:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SimpleJob = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _get = function get(object, property, receiver) {
    if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
        var parent = Object.getPrototypeOf(object);if (parent === null) {
            return undefined;
        } else {
            return get(parent, property, receiver);
        }
    } else if ("value" in desc) {
        return desc.value;
    } else {
        var getter = desc.get;if (getter === undefined) {
            return undefined;
        }return getter.call(receiver);
    }
};

var _sdUtils = require("sd-utils");

var _jobStatus = require("./job-status");

var _job = require("./job");

var _executionContext = require("./execution-context");

var _step = require("./step");

var _jobInterruptedException = require("./exceptions/job-interrupted-exception");

var _jobRestartException = require("./exceptions/job-restart-exception");

var _jobExecutionFlag = require("./job-execution-flag");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/* Simple Job that sequentially executes a job by iterating through its list of steps.  Any Step that fails will fail the job.  The job is
 considered complete when all steps have been executed.*/

var SimpleJob = exports.SimpleJob = function (_Job) {
    _inherits(SimpleJob, _Job);

    function SimpleJob(name, jobRepository) {
        _classCallCheck(this, SimpleJob);

        return _possibleConstructorReturn(this, (SimpleJob.__proto__ || Object.getPrototypeOf(SimpleJob)).call(this, name, jobRepository));
    }

    _createClass(SimpleJob, [{
        key: "getStep",
        value: function getStep(stepName) {
            return _sdUtils.Utils.find(this.steps, function (s) {
                return s.name == stepName;
            });
        }
    }, {
        key: "doExecute",
        value: function doExecute(execution, jobResult) {

            return this.handleNextStep(execution, jobResult).then(function (lastExecutedStepExecution) {
                if (lastExecutedStepExecution != null) {
                    _sdUtils.log.debug("Updating JobExecution status: ", lastExecutedStepExecution);
                    execution.status = lastExecutedStepExecution.status;
                    execution.exitStatus = lastExecutedStepExecution.exitStatus;
                }
                return execution;
            });
        }
    }, {
        key: "handleNextStep",
        value: function handleNextStep(jobExecution, jobResult) {
            var _this2 = this;

            var prevStep = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
            var prevStepExecution = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;

            var stepIndex = 0;
            if (prevStep) {
                stepIndex = this.steps.indexOf(prevStep) + 1;
            }
            if (stepIndex >= this.steps.length) {
                return Promise.resolve(prevStepExecution);
            }
            var step = this.steps[stepIndex];
            return this.handleStep(step, jobExecution, jobResult).then(function (stepExecution) {
                if (stepExecution.status !== _jobStatus.JOB_STATUS.COMPLETED) {
                    // Terminate the job if a step fails
                    return stepExecution;
                }
                return _this2.handleNextStep(jobExecution, jobResult, step, stepExecution);
            });
        }
    }, {
        key: "handleStep",
        value: function handleStep(step, jobExecution, jobResult) {
            var _this3 = this;

            var jobInstance = jobExecution.jobInstance;
            return this.checkExecutionFlags(jobExecution).then(function (jobExecution) {
                if (jobExecution.isStopping()) {
                    throw new _jobInterruptedException.JobInterruptedException("JobExecution interrupted.");
                }
                return _this3.jobRepository.getLastStepExecution(jobInstance, step.name);
            }).then(function (lastStepExecution) {
                if (_this3.stepExecutionPartOfExistingJobExecution(jobExecution, lastStepExecution)) {
                    // If the last execution of this step was in the same job, it's probably intentional so we want to run it again.
                    _sdUtils.log.info("Duplicate step detected in execution of job. step: " + step.name + " jobName: ", jobInstance.jobName);
                    lastStepExecution = null;
                }

                var currentStepExecution = lastStepExecution;

                if (!_this3.shouldStart(currentStepExecution, jobExecution, step)) {
                    return currentStepExecution;
                }

                currentStepExecution = jobExecution.createStepExecution(step.name);

                var isCompleted = lastStepExecution != null && lastStepExecution.status === _jobStatus.JOB_STATUS.COMPLETED;
                var isRestart = lastStepExecution != null && !isCompleted;
                var skipExecution = isCompleted && step.skipOnRestartIfCompleted;

                if (isRestart) {
                    currentStepExecution.executionContext = lastStepExecution.executionContext;
                    if (lastStepExecution.executionContext.containsKey("executed")) {
                        currentStepExecution.executionContext.remove("executed");
                    }
                } else {

                    currentStepExecution.executionContext = new _executionContext.ExecutionContext();
                }
                if (skipExecution) {
                    currentStepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
                    currentStepExecution.status = _jobStatus.JOB_STATUS.COMPLETED;
                    currentStepExecution.executionContext.put("skipped", true);
                }

                return _this3.jobRepository.addStepExecution(currentStepExecution).then(function (_currentStepExecution) {
                    currentStepExecution = _currentStepExecution;
                    if (skipExecution) {
                        _sdUtils.log.info("Skipping completed step execution: [" + step.name + "]");
                        return currentStepExecution;
                    }
                    _sdUtils.log.info("Executing step: [" + step.name + "]");
                    return step.execute(currentStepExecution, jobResult);
                }).then(function () {
                    currentStepExecution.executionContext.put("executed", true);
                    return currentStepExecution;
                }).catch(function (e) {
                    jobExecution.status = _jobStatus.JOB_STATUS.FAILED;
                    return _this3.jobRepository.update(jobExecution).then(function (jobExecution) {
                        throw e;
                    });
                });
            }).then(function (currentStepExecution) {
                if (currentStepExecution.status == _jobStatus.JOB_STATUS.STOPPING || currentStepExecution.status == _jobStatus.JOB_STATUS.STOPPED) {
                    // Ensure that the job gets the message that it is stopping
                    jobExecution.status = _jobStatus.JOB_STATUS.STOPPING;
                    // throw new Error("Job interrupted by step execution");
                }
                return _this3.updateProgress(jobExecution).then(function () {
                    return currentStepExecution;
                });
            });
        }
    }, {
        key: "stepExecutionPartOfExistingJobExecution",
        value: function stepExecutionPartOfExistingJobExecution(jobExecution, stepExecution) {
            return stepExecution != null && stepExecution.jobExecution.id == jobExecution.id;
        }
    }, {
        key: "shouldStart",
        value: function shouldStart(lastStepExecution, execution, step) {
            var stepStatus;
            if (lastStepExecution == null) {
                stepStatus = _jobStatus.JOB_STATUS.STARTING;
            } else {
                stepStatus = lastStepExecution.status;
            }

            if (stepStatus == _jobStatus.JOB_STATUS.UNKNOWN) {
                throw new _jobRestartException.JobRestartException("Cannot restart step from UNKNOWN status");
            }

            return stepStatus != _jobStatus.JOB_STATUS.COMPLETED || step.isRestartable;
        }
    }, {
        key: "getProgress",
        value: function getProgress(execution) {
            var completedSteps = execution.stepExecutions.length;
            if (_jobStatus.JOB_STATUS.COMPLETED !== execution.stepExecutions[execution.stepExecutions.length - 1].status) {
                completedSteps--;
            }

            return Math.round(completedSteps * 100 / this.steps.length);
        }
    }, {
        key: "addStep",
        value: function addStep() {
            if (arguments.length === 1) {
                return _get(SimpleJob.prototype.__proto__ || Object.getPrototypeOf(SimpleJob.prototype), "addStep", this).call(this, arguments[0]);
            }
            var step = new _step.Step(arguments[0], this.jobRepository);
            step.doExecute = arguments[1];
            return _get(SimpleJob.prototype.__proto__ || Object.getPrototypeOf(SimpleJob.prototype), "addStep", this).call(this, step);
        }
    }]);

    return SimpleJob;
}(_job.Job);

},{"./exceptions/job-interrupted-exception":27,"./exceptions/job-restart-exception":29,"./execution-context":30,"./job":45,"./job-execution-flag":32,"./job-status":44,"./step":49,"sd-utils":"sd-utils"}],47:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var StepExecutionListener = exports.StepExecutionListener = function () {
    function StepExecutionListener() {
        _classCallCheck(this, StepExecutionListener);
    }

    _createClass(StepExecutionListener, [{
        key: "beforeStep",

        /*Called before a step executes*/
        value: function beforeStep(jobExecution) {}

        /*Called after completion of a step. Called after both successful and failed executions*/

    }, {
        key: "afterStep",
        value: function afterStep(jobExecution) {}
    }]);

    return StepExecutionListener;
}();

},{}],48:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.StepExecution = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _executionContext = require("./execution-context");

var _jobStatus = require("./job-status");

var _jobExecution = require("./job-execution");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*
 representation of the execution of a step
 */
var StepExecution = exports.StepExecution = function () {
    function StepExecution(stepName, jobExecution, id) {
        _classCallCheck(this, StepExecution);

        this.status = _jobStatus.JOB_STATUS.STARTING;
        this.exitStatus = _jobStatus.JOB_STATUS.EXECUTING;
        this.executionContext = new _executionContext.ExecutionContext();
        this.startTime = new Date();
        this.endTime = null;
        this.lastUpdated = null;
        this.terminateOnly = false;
        this.failureExceptions = [];

        if (id === null || id === undefined) {
            this.id = _sdUtils.Utils.guid();
        } else {
            this.id = id;
        }

        this.stepName = stepName;
        this.jobExecution = jobExecution;
        this.jobExecutionId = jobExecution.id;
    } //flag to indicate that an execution should halt
    //execution context for single step level,

    _createClass(StepExecution, [{
        key: "getJobParameters",
        value: function getJobParameters() {
            return this.jobExecution.jobParameters;
        }
    }, {
        key: "getJobExecutionContext",
        value: function getJobExecutionContext() {
            return this.jobExecution.executionContext;
        }
    }, {
        key: "getData",
        value: function getData() {
            return this.jobExecution.getData();
        }
    }, {
        key: "getDTO",
        value: function getDTO() {
            var filteredProperties = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
            var deepClone = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            var cloneMethod = _sdUtils.Utils.cloneDeepWith;
            if (!deepClone) {
                cloneMethod = _sdUtils.Utils.cloneWith;
            }

            return _sdUtils.Utils.assign({}, cloneMethod(this, function (value, key, object, stack) {
                if (filteredProperties.indexOf(key) > -1) {
                    return null;
                }
                if (["executionContext"].indexOf(key) > -1) {
                    return value.getDTO();
                }
                if (value instanceof Error) {
                    return _sdUtils.Utils.getErrorDTO(value);
                }

                if (value instanceof _jobExecution.JobExecution) {
                    return value.getDTO(["stepExecutions"], deepClone);
                }
            }));
        }
    }]);

    return StepExecution;
}();

},{"./execution-context":30,"./job-execution":34,"./job-status":44,"sd-utils":"sd-utils"}],49:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.Step = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobStatus = require("./job-status");

var _sdUtils = require("sd-utils");

var _jobInterruptedException = require("./exceptions/job-interrupted-exception");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*domain object representing the configuration of a job step*/
var Step = exports.Step = function () {
    function Step(name, jobRepository) {
        _classCallCheck(this, Step);

        this.isRestartable = true;
        this.skipOnRestartIfCompleted = true;
        this.steps = [];
        this.executionListeners = [];

        this.name = name;
        this.jobRepository = jobRepository;
    }

    _createClass(Step, [{
        key: "setJobRepository",
        value: function setJobRepository(jobRepository) {
            this.jobRepository = jobRepository;
        }

        /*Process the step and assign progress and status meta information to the StepExecution provided*/

    }, {
        key: "execute",
        value: function execute(stepExecution, jobResult) {
            var _this = this;

            _sdUtils.log.debug("Executing step: name=" + this.name);
            stepExecution.startTime = new Date();
            stepExecution.status = _jobStatus.JOB_STATUS.STARTED;
            var exitStatus;
            return this.jobRepository.update(stepExecution).then(function (stepExecution) {
                exitStatus = _jobStatus.JOB_STATUS.EXECUTING;

                _this.executionListeners.forEach(function (listener) {
                    return listener.beforeStep(stepExecution);
                });
                _this.open(stepExecution.executionContext);

                return _this.doExecute(stepExecution, jobResult);
            }).then(function (_stepExecution) {
                stepExecution = _stepExecution;
                exitStatus = stepExecution.exitStatus;

                // Check if someone is trying to stop us
                if (stepExecution.terminateOnly) {
                    throw new _jobInterruptedException.JobInterruptedException("JobExecution interrupted.");
                }
                // Need to upgrade here not set, in case the execution was stopped
                stepExecution.status = _jobStatus.JOB_STATUS.COMPLETED;
                _sdUtils.log.debug("Step execution success: name=" + _this.name);
                return stepExecution;
            }).catch(function (e) {
                stepExecution.status = _this.determineJobStatus(e);
                exitStatus = stepExecution.status;
                stepExecution.failureExceptions.push(e);

                if (stepExecution.status == _jobStatus.JOB_STATUS.STOPPED) {
                    _sdUtils.log.info("Encountered interruption executing step: " + _this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                } else {
                    _sdUtils.log.error("Encountered an error executing step: " + _this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                }
                return stepExecution;
            }).then(function (stepExecution) {
                try {
                    stepExecution.exitStatus = exitStatus;
                    _this.executionListeners.forEach(function (listener) {
                        return listener.afterStep(stepExecution);
                    });
                } catch (e) {
                    _sdUtils.log.error("Exception in afterStep callback in step " + _this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                }

                stepExecution.endTime = new Date();
                stepExecution.exitStatus = exitStatus;

                return _this.jobRepository.update(stepExecution);
            }).then(function (stepExecution) {
                try {
                    _this.close(stepExecution.executionContext);
                } catch (e) {
                    _sdUtils.log.error("Exception while closing step execution resources in step: " + _this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                    stepExecution.failureExceptions.push(e);
                }

                try {
                    _this.close(stepExecution.executionContext);
                } catch (e) {
                    _sdUtils.log.error("Exception while closing step execution resources in step: " + _this.name + " in job: " + stepExecution.jobExecution.jobInstance.jobName, e);
                    stepExecution.failureExceptions.push(e);
                }

                // doExecutionRelease();

                _sdUtils.log.debug("Step execution complete: " + stepExecution.id);
                return stepExecution;
            });
        }
    }, {
        key: "determineJobStatus",
        value: function determineJobStatus(e) {
            if (e instanceof _jobInterruptedException.JobInterruptedException) {
                return _jobStatus.JOB_STATUS.STOPPED;
            } else {
                return _jobStatus.JOB_STATUS.FAILED;
            }
        }

        /**
         * Extension point for subclasses to execute business logic. Subclasses should set the exitStatus on the
         * StepExecution before returning. Must return stepExecution
         */

    }, {
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {}

        /**
         * Extension point for subclasses to provide callbacks to their collaborators at the beginning of a step, to open or
         * acquire resources. Does nothing by default.
         */

    }, {
        key: "open",
        value: function open(executionContext) {}

        /**
         * Extension point for subclasses to provide callbacks to their collaborators at the end of a step (right at the end
         * of the finally block), to close or release resources. Does nothing by default.
         */

    }, {
        key: "close",
        value: function close(executionContext) {}

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(stepExecution) {
            return {
                total: 1,
                current: stepExecution.status === _jobStatus.JOB_STATUS.COMPLETED ? 1 : 0
            };
        }
    }]);

    return Step;
}();

},{"./exceptions/job-interrupted-exception":27,"./job-status":44,"sd-utils":"sd-utils"}],50:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.engine = undefined;

var _jobsManager = require('./jobs-manager');

Object.keys(_jobsManager).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobsManager[key];
    }
  });
});

var _jobWorker = require('./job-worker');

Object.keys(_jobWorker).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _jobWorker[key];
    }
  });
});

var _index = require('./engine/index');

var engine = _interopRequireWildcard(_index);

function _interopRequireWildcard(obj) {
  if (obj && obj.__esModule) {
    return obj;
  } else {
    var newObj = {};if (obj != null) {
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key];
      }
    }newObj.default = obj;return newObj;
  }
}

exports.engine = engine;

},{"./engine/index":31,"./job-worker":52,"./jobs-manager":53}],51:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobInstanceManager = exports.JobInstanceManagerConfig = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _jobExecutionListener = require("./engine/job-execution-listener");

var _jobStatus = require("./engine/job-status");

var _jobInstance = require("./engine/job-instance");

var _sdUtils = require("sd-utils");

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobInstanceManagerConfig = exports.JobInstanceManagerConfig = function JobInstanceManagerConfig(custom) {
    _classCallCheck(this, JobInstanceManagerConfig);

    this.onJobStarted = function () {};

    this.onJobCompleted = function (result) {};

    this.onJobFailed = function (errors) {};

    this.onJobStopped = function () {};

    this.onJobTerminated = function () {};

    this.onProgress = function (progress) {};

    this.updateInterval = 100;

    if (custom) {
        _sdUtils.Utils.deepExtend(this, custom);
    }
};

/*convenience class for managing and tracking job instance progress*/

var JobInstanceManager = exports.JobInstanceManager = function (_JobExecutionListener) {
    _inherits(JobInstanceManager, _JobExecutionListener);

    function JobInstanceManager(jobsManger, jobInstanceOrExecution, config) {
        _classCallCheck(this, JobInstanceManager);

        var _this = _possibleConstructorReturn(this, (JobInstanceManager.__proto__ || Object.getPrototypeOf(JobInstanceManager)).call(this));

        _this.progress = null;

        _this.config = new JobInstanceManagerConfig(config);
        _this.jobsManger = jobsManger;
        if (jobInstanceOrExecution instanceof _jobInstance.JobInstance) {
            _this.jobInstance = jobInstanceOrExecution;
            _this.getLastJobExecution().then(function (je) {
                _this.checkProgress();
            });
        } else {
            _this.lastJobExecution = jobInstanceOrExecution;
            _this.jobInstance = _this.lastJobExecution.jobInstance;
            _this.checkProgress();
        }
        if (_this.lastJobExecution && !_this.lastJobExecution.isRunning()) {
            _this.afterJob(_this.lastJobExecution);
            return _possibleConstructorReturn(_this);
        }
        jobsManger.registerJobExecutionListener(_this);
        return _this;
    }

    _createClass(JobInstanceManager, [{
        key: "checkProgress",
        value: function checkProgress() {
            var _this2 = this;

            var self = this;
            if (this.terminated || !this.lastJobExecution.isRunning() || this.getProgressPercents(this.progress) === 100) {
                return;
            }
            this.jobsManger.getProgress(this.lastJobExecution).then(function (progress) {
                _this2.lastUpdateTime = new Date();
                if (progress) {
                    _this2.progress = progress;
                    _this2.config.onProgress.call(_this2.config.callbacksThisArg || _this2, progress);
                }

                setTimeout(function () {
                    self.checkProgress();
                }, _this2.config.updateInterval);
            });
        }
    }, {
        key: "beforeJob",
        value: function beforeJob(jobExecution) {
            if (jobExecution.jobInstance.id !== this.jobInstance.id) {
                return;
            }

            this.lastJobExecution = jobExecution;
            this.config.onJobStarted.call(this.config.callbacksThisArg || this);
        }
    }, {
        key: "getProgressPercents",
        value: function getProgressPercents(progress) {
            if (!progress) {
                return 0;
            }
            return progress.current * 100 / progress.total;
        }
    }, {
        key: "getProgressFromExecution",
        value: function getProgressFromExecution(jobExecution) {
            var job = this.jobsManger.getJobByName(jobExecution.jobInstance.jobName);
            return job.getProgress(jobExecution);
        }
    }, {
        key: "afterJob",
        value: function afterJob(jobExecution) {
            var _this3 = this;

            if (jobExecution.jobInstance.id !== this.jobInstance.id) {
                return;
            }
            this.lastJobExecution = jobExecution;
            if (_jobStatus.JOB_STATUS.COMPLETED === jobExecution.status) {
                this.jobsManger.deregisterJobExecutionListener(this);
                this.progress = this.getProgressFromExecution(jobExecution);
                this.config.onProgress.call(this.config.callbacksThisArg || this, this.progress);
                this.jobsManger.getResult(jobExecution.jobInstance).then(function (result) {
                    _this3.config.onJobCompleted.call(_this3.config.callbacksThisArg || _this3, result.data);
                }).catch(function (e) {
                    _sdUtils.log.error(e);
                });
            } else if (_jobStatus.JOB_STATUS.FAILED === jobExecution.status) {
                this.config.onJobFailed.call(this.config.callbacksThisArg || this, jobExecution.failureExceptions);
            } else if (_jobStatus.JOB_STATUS.STOPPED === jobExecution.status) {
                this.config.onJobStopped.call(this.config.callbacksThisArg || this);
            }
        }
    }, {
        key: "getLastJobExecution",
        value: function getLastJobExecution() {
            var _this4 = this;

            var forceUpdate = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

            if (!this.lastJobExecution || forceUpdate) {
                return this.jobsManger.jobRepository.getLastJobExecutionByInstance(this.jobInstance).then(function (je) {
                    _this4.lastJobExecution = je;
                    return je;
                });
            }
            return Promise.resolve(this.lastJobExecution);
        }
    }, {
        key: "stop",
        value: function stop() {
            var _this5 = this;

            return this.getLastJobExecution().then(function () {
                return _this5.jobsManger.stop(_this5.lastJobExecution);
            });
        }
    }, {
        key: "resume",
        value: function resume() {
            var _this6 = this;

            return this.getLastJobExecution().then(function () {
                return _this6.jobsManger.run(_this6.jobInstance.jobName, _this6.lastJobExecution.jobParameters.values, _this6.lastJobExecution.getData()).then(function (je) {
                    _this6.lastJobExecution = je;
                    _this6.checkProgress();
                }).catch(function (e) {
                    _sdUtils.log.error(e);
                });
            });
        }
    }, {
        key: "terminate",
        value: function terminate() {
            var _this7 = this;

            return this.getLastJobExecution().then(function () {
                return _this7.jobsManger.terminate(_this7.jobInstance).then(function () {
                    _this7.terminated = true;
                    _this7.config.onJobTerminated.call(_this7.config.callbacksThisArg || _this7, _this7.lastJobExecution);
                    _this7.jobsManger.deregisterJobExecutionListener(_this7);

                    return _this7.lastJobExecution;
                });
            }).catch(function (e) {
                _sdUtils.log.error(e);
            });
        }
    }]);

    return JobInstanceManager;
}(_jobExecutionListener.JobExecutionListener);

},{"./engine/job-execution-listener":33,"./engine/job-instance":35,"./engine/job-status":44,"sd-utils":"sd-utils"}],52:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var JobWorker = exports.JobWorker = function () {
    function JobWorker(url, defaultListener, onError) {
        _classCallCheck(this, JobWorker);

        this.listeners = {};

        var instance = this;
        this.worker = new Worker(url);
        this.defaultListener = defaultListener || function () {};
        if (onError) {
            this.worker.onerror = onError;
        }

        this.worker.onmessage = function (event) {
            if (event.data instanceof Object && event.data.hasOwnProperty('queryMethodListener') && event.data.hasOwnProperty('queryMethodArguments')) {
                var listener = instance.listeners[event.data.queryMethodListener];
                var args = event.data.queryMethodArguments;
                if (listener.deserializer) {
                    args = listener.deserializer(args);
                }
                listener.fn.apply(listener.thisArg, args);
            } else {
                this.defaultListener.call(instance, event.data);
            }
        };
    }

    _createClass(JobWorker, [{
        key: 'sendQuery',
        value: function sendQuery() {
            if (arguments.length < 1) {
                throw new TypeError('JobWorker.sendQuery takes at least one argument');
            }
            this.worker.postMessage({
                'queryMethod': arguments[0],
                'queryArguments': Array.prototype.slice.call(arguments, 1)
            });
        }
    }, {
        key: 'runJob',
        value: function runJob(jobName, jobParametersValues, dataDTO) {
            this.sendQuery('runJob', jobName, jobParametersValues, dataDTO);
        }
    }, {
        key: 'executeJob',
        value: function executeJob(jobExecutionId) {
            this.sendQuery('executeJob', jobExecutionId);
        }
    }, {
        key: 'recompute',
        value: function recompute(dataDTO, ruleNames, evalCode, evalNumeric) {
            this.sendQuery('recompute', dataDTO, ruleNames, evalCode, evalNumeric);
        }
    }, {
        key: 'postMessage',
        value: function postMessage(message) {
            this.worker.postMessage(message);
        }
    }, {
        key: 'terminate',
        value: function terminate() {
            this.worker.terminate();
        }
    }, {
        key: 'addListener',
        value: function addListener(name, listener, thisArg, deserializer) {
            this.listeners[name] = {
                fn: listener,
                thisArg: thisArg || this,
                deserializer: deserializer
            };
        }
    }, {
        key: 'removeListener',
        value: function removeListener(name) {
            delete this.listeners[name];
        }
    }]);

    return JobWorker;
}();

},{}],53:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobsManager = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require("sd-utils");

var _sensitivityAnalysisJob = require("./configurations/sensitivity-analysis/sensitivity-analysis-job");

var _jobLauncher = require("./engine/job-launcher");

var _jobWorker = require("./job-worker");

var _jobExecutionListener = require("./engine/job-execution-listener");

var _jobParameters = require("./engine/job-parameters");

var _idbJobRepository = require("./engine/job-repository/idb-job-repository");

var _jobExecutionFlag = require("./engine/job-execution-flag");

var _recomputeJob = require("./configurations/recompute/recompute-job");

var _probabilisticSensitivityAnalysisJob = require("./configurations/probabilistic-sensitivity-analysis/probabilistic-sensitivity-analysis-job");

var _timeoutJobRepository = require("./engine/job-repository/timeout-job-repository");

var _tornadoDiagramJob = require("./configurations/tornado-diagram/tornado-diagram-job");

var _jobStatus = require("./engine/job-status");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

var JobsManager = exports.JobsManager = function (_JobExecutionListener) {
    _inherits(JobsManager, _JobExecutionListener);

    function JobsManager(expressionsEvaluator, objectiveRulesManager, workerUrl) {
        _classCallCheck(this, JobsManager);

        var _this = _possibleConstructorReturn(this, (JobsManager.__proto__ || Object.getPrototypeOf(JobsManager)).call(this));

        _this.jobExecutionListeners = [];
        _this.afterJobExecutionPromiseResolves = {};
        _this.jobInstancesToTerminate = {};

        _this.expressionEngine = expressionsEvaluator.expressionEngine;
        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;

        _this.jobRepository = new _idbJobRepository.IdbJobRepository(_this.expressionEngine.getJsonReviver());
        // this.jobRepository = new TimeoutJobRepository(this.expressionEngine.getJsonReviver());
        _this.registerJobs();

        _this.useWorker = !!workerUrl;
        if (_this.useWorker) {
            _this.initWorker(workerUrl);
        }

        _this.jobLauncher = new _jobLauncher.JobLauncher(_this.jobRepository, _this.jobWorker, function (data) {
            return _this.serializeData(data);
        });
        return _this;
    }

    _createClass(JobsManager, [{
        key: "serializeData",
        value: function serializeData(data) {
            return data.serialize(true, false, false, this.expressionEngine.getJsonReplacer());
        }
    }, {
        key: "getProgress",
        value: function getProgress(jobExecutionOrId) {
            var id = jobExecutionOrId;
            if (!_sdUtils.Utils.isString(jobExecutionOrId)) {
                id = jobExecutionOrId.id;
            }
            return this.jobRepository.getJobExecutionProgress(id);
        }
    }, {
        key: "getResult",
        value: function getResult(jobInstance) {
            return this.jobRepository.getJobResultByInstance(jobInstance);
        }
    }, {
        key: "run",
        value: function run(jobName, jobParametersValues, data) {
            var _this2 = this;

            var resolvePromiseAfterJobIsLaunched = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : true;

            return this.jobLauncher.run(jobName, jobParametersValues, data, resolvePromiseAfterJobIsLaunched).then(function (jobExecution) {
                if (resolvePromiseAfterJobIsLaunched || !jobExecution.isRunning()) {
                    return jobExecution;
                }
                //job was delegated to worker and is still running

                return new Promise(function (resolve, reject) {
                    _this2.afterJobExecutionPromiseResolves[jobExecution.id] = resolve;
                });
            });
        }
    }, {
        key: "execute",
        value: function execute(jobExecutionOrId) {
            return this.jobLauncher.execute(jobExecutionOrId);
        }
    }, {
        key: "stop",
        value: function stop(jobExecutionOrId) {
            var _this3 = this;

            var id = jobExecutionOrId;
            if (!_sdUtils.Utils.isString(jobExecutionOrId)) {
                id = jobExecutionOrId.id;
            }

            return this.jobRepository.getJobExecutionById(id).then(function (jobExecution) {
                if (!jobExecution) {
                    _sdUtils.log.error("Job Execution not found: " + jobExecutionOrId);
                    return null;
                }
                if (!jobExecution.isRunning()) {
                    _sdUtils.log.warn("Job Execution not running, status: " + jobExecution.status + ", endTime: " + jobExecution.endTime);
                    return jobExecution;
                }

                return _this3.jobRepository.saveJobExecutionFlag(jobExecution.id, _jobExecutionFlag.JOB_EXECUTION_FLAG.STOP).then(function () {
                    return jobExecution;
                });
            });
        }

        /*stop job execution if running and delete job instance from repository*/

    }, {
        key: "terminate",
        value: function terminate(jobInstance) {
            var _this4 = this;

            return this.jobRepository.getLastJobExecutionByInstance(jobInstance).then(function (jobExecution) {
                if (jobExecution && jobExecution.isRunning()) {
                    return _this4.jobRepository.saveJobExecutionFlag(jobExecution.id, _jobExecutionFlag.JOB_EXECUTION_FLAG.STOP).then(function () {
                        return jobExecution;
                    });
                }
            }).then(function () {
                _this4.jobInstancesToTerminate[jobInstance.id] = jobInstance;
            });
        }
    }, {
        key: "getJobByName",
        value: function getJobByName(jobName) {
            return this.jobRepository.getJobByName(jobName);
        }
    }, {
        key: "createJobParameters",
        value: function createJobParameters(jobName, jobParametersValues) {
            var job = this.jobRepository.getJobByName(jobName);
            return job.createJobParameters(jobParametersValues);
        }

        /*Returns a promise*/

    }, {
        key: "getLastJobExecution",
        value: function getLastJobExecution(jobName, jobParameters) {
            if (this.useWorker) {
                return this.jobWorker;
            }
            if (!(jobParameters instanceof _jobParameters.JobParameters)) {
                jobParameters = this.createJobParameters(jobParameters);
            }
            return this.jobRepository.getLastJobExecution(jobName, jobParameters);
        }
    }, {
        key: "initWorker",
        value: function initWorker(workerUrl) {
            var _arguments = arguments,
                _this5 = this;

            this.jobWorker = new _jobWorker.JobWorker(workerUrl, function () {
                _sdUtils.log.error('error in worker', _arguments);
            });
            var argsDeserializer = function argsDeserializer(args) {
                return [_this5.jobRepository.reviveJobExecution(args[0])];
            };

            this.jobWorker.addListener("beforeJob", this.beforeJob, this, argsDeserializer);
            this.jobWorker.addListener("afterJob", this.afterJob, this, argsDeserializer);
            this.jobWorker.addListener("jobFatalError", this.onJobFatalError, this);
        }
    }, {
        key: "registerJobs",
        value: function registerJobs() {
            this.registerJob(new _sensitivityAnalysisJob.SensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
            this.registerJob(new _tornadoDiagramJob.TornadoDiagramJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
            this.registerJob(new _probabilisticSensitivityAnalysisJob.ProbabilisticSensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
            this.registerJob(new _recomputeJob.RecomputeJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
        }
    }, {
        key: "registerJob",
        value: function registerJob(job) {
            this.jobRepository.registerJob(job);
            job.registerExecutionListener(this);
        }
    }, {
        key: "registerJobExecutionListener",
        value: function registerJobExecutionListener(listener) {
            this.jobExecutionListeners.push(listener);
        }
    }, {
        key: "deregisterJobExecutionListener",
        value: function deregisterJobExecutionListener(listener) {
            var index = this.jobExecutionListeners.indexOf(listener);
            if (index > -1) {
                this.jobExecutionListeners.splice(index, 1);
            }
        }
    }, {
        key: "beforeJob",
        value: function beforeJob(jobExecution) {
            _sdUtils.log.debug("beforeJob", this.useWorker, jobExecution);
            this.jobExecutionListeners.forEach(function (l) {
                return l.beforeJob(jobExecution);
            });
        }
    }, {
        key: "afterJob",
        value: function afterJob(jobExecution) {
            _sdUtils.log.debug("afterJob", this.useWorker, jobExecution);
            this.jobExecutionListeners.forEach(function (l) {
                return l.afterJob(jobExecution);
            });
            var promiseResolve = this.afterJobExecutionPromiseResolves[jobExecution.id];
            if (promiseResolve) {
                promiseResolve(jobExecution);
            }

            if (this.jobInstancesToTerminate[jobExecution.jobInstance.id]) {
                this.jobRepository.remove(jobExecution.jobInstance);
            }
        }
    }, {
        key: "onJobFatalError",
        value: function onJobFatalError(jobExecutionId, error) {
            var _this6 = this;

            var promiseResolve = this.afterJobExecutionPromiseResolves[jobExecutionId];
            if (promiseResolve) {
                this.jobRepository.getJobExecutionById(jobExecutionId).then(function (jobExecution) {
                    jobExecution.status = _jobStatus.JOB_STATUS.FAILED;
                    if (error) {
                        jobExecution.failureExceptions.push(error);
                    }

                    return _this6.jobRepository.saveJobExecution(jobExecution).then(function () {
                        promiseResolve(jobExecution);
                    });
                }).catch(function (e) {
                    _sdUtils.log.error(e);
                });
            }
            _sdUtils.log.debug('onJobFatalError', jobExecutionId, error);
        }
    }]);

    return JobsManager;
}(_jobExecutionListener.JobExecutionListener);

},{"./configurations/probabilistic-sensitivity-analysis/probabilistic-sensitivity-analysis-job":7,"./configurations/recompute/recompute-job":10,"./configurations/sensitivity-analysis/sensitivity-analysis-job":12,"./configurations/tornado-diagram/tornado-diagram-job":20,"./engine/job-execution-flag":32,"./engine/job-execution-listener":33,"./engine/job-launcher":37,"./engine/job-parameters":39,"./engine/job-repository/idb-job-repository":40,"./engine/job-repository/timeout-job-repository":42,"./engine/job-status":44,"./job-worker":52,"sd-utils":"sd-utils"}],54:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ObjectiveRulesManager = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _rules = require("./rules");

var _sdUtils = require("sd-utils");

var _sdModel = require("sd-model");

var model = _interopRequireWildcard(_sdModel);

function _interopRequireWildcard(obj) {
    if (obj && obj.__esModule) {
        return obj;
    } else {
        var newObj = {};if (obj != null) {
            for (var key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key];
            }
        }newObj.default = obj;return newObj;
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var ObjectiveRulesManager = exports.ObjectiveRulesManager = function () {
    function ObjectiveRulesManager(data, expressionEngine, currentRuleName) {
        _classCallCheck(this, ObjectiveRulesManager);

        this.ruleByName = {};

        this.data = data;
        this.expressionEngine = expressionEngine;
        var max = new _rules.ExpectedValueMaximizationRule(expressionEngine);
        var maxiMin = new _rules.MaxiMinRule(expressionEngine);
        var maxiMax = new _rules.MaxiMaxRule(expressionEngine);
        var min = new _rules.ExpectedValueMinimizationRule(expressionEngine);
        var miniMin = new _rules.MiniMinRule(expressionEngine);
        var miniMax = new _rules.MiniMaxRule(expressionEngine);
        this.ruleByName[max.name] = max;
        this.ruleByName[maxiMin.name] = maxiMin;
        this.ruleByName[maxiMax.name] = maxiMax;
        this.ruleByName[min.name] = min;
        this.ruleByName[miniMin.name] = miniMin;
        this.ruleByName[miniMax.name] = miniMax;
        this.rules = [max, min, maxiMin, maxiMax, miniMin, miniMax];
        if (currentRuleName) {
            this.currentRule = this.ruleByName[currentRuleName];
        } else {
            this.currentRule = this.rules[0];
        }
    }

    _createClass(ObjectiveRulesManager, [{
        key: "isRuleName",
        value: function isRuleName(ruleName) {
            return !!this.ruleByName[ruleName];
        }
    }, {
        key: "setCurrentRuleByName",
        value: function setCurrentRuleByName(ruleName) {
            this.currentRule = this.ruleByName[ruleName];
        }
    }, {
        key: "recompute",
        value: function recompute(allRules) {
            var _this = this;

            var decisionPolicy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

            var startTime = new Date().getTime();
            _sdUtils.log.trace('recomputing rules, all: ' + allRules);

            this.data.getRoots().forEach(function (n) {
                _this.recomputeTree(n, allRules, decisionPolicy);
            });

            var time = new Date().getTime() - startTime / 1000;
            _sdUtils.log.trace('recomputation took ' + time + 's');

            return this;
        }
    }, {
        key: "recomputeTree",
        value: function recomputeTree(root, allRules) {
            var decisionPolicy = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

            _sdUtils.log.trace('recomputing rules for tree ...', root);

            var startTime = new Date().getTime();

            var rules = [this.currentRule];
            if (allRules) {
                rules = this.rules;
            }

            rules.forEach(function (rule) {
                rule.setDecisionPolicy(decisionPolicy);
                rule.computePayoff(root);
                rule.computeOptimal(root);
                rule.clearDecisionPolicy();
            });

            var time = (new Date().getTime() - startTime) / 1000;
            _sdUtils.log.trace('recomputation took ' + time + 's');

            return this;
        }
    }, {
        key: "getNodeDisplayValue",
        value: function getNodeDisplayValue(node, name) {
            return node.computedValue(this.currentRule.name, name);
        }
    }, {
        key: "getEdgeDisplayValue",
        value: function getEdgeDisplayValue(e, name) {
            if (name === 'probability') {
                if (e.parentNode instanceof model.domain.DecisionNode) {
                    return e.computedValue(this.currentRule.name, 'probability');
                }
                if (e.parentNode instanceof model.domain.ChanceNode) {
                    return e.computedBaseProbability();
                }
                return null;
            }
            if (name === 'payoff') {
                return e.computedBasePayoff();
            }
            if (name === 'optimal') {
                return e.computedValue(this.currentRule.name, 'optimal');
            }
        }
    }]);

    return ObjectiveRulesManager;
}();

},{"./rules":57,"sd-model":"sd-model","sd-utils":"sd-utils"}],55:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ExpectedValueMaximizationRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*expected value maximization rule*/
var ExpectedValueMaximizationRule = exports.ExpectedValueMaximizationRule = function (_ObjectiveRule) {
    _inherits(ExpectedValueMaximizationRule, _ObjectiveRule);

    function ExpectedValueMaximizationRule(expressionEngine) {
        _classCallCheck(this, ExpectedValueMaximizationRule);

        return _possibleConstructorReturn(this, (ExpectedValueMaximizationRule.__proto__ || Object.getPrototypeOf(ExpectedValueMaximizationRule)).call(this, ExpectedValueMaximizationRule.NAME, expressionEngine));
    }

    _createClass(ExpectedValueMaximizationRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.max.apply(this, _toConsumableArray(childrenPayoffs)));
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this2 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            node.childEdges.forEach(function (e) {
                if (_this2.subtract(_this2.cValue(node, 'payoff'), payoff).equals(_this2.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode)) {
                    _this2.cValue(e, 'optimal', true);
                    _this2.computeOptimal(e.childNode, _this2.basePayoff(e), _this2.multiply(probabilityToEnter, _this2.cValue(e, 'probability')));
                } else {
                    _this2.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return ExpectedValueMaximizationRule;
}(_objectiveRule.ObjectiveRule);

ExpectedValueMaximizationRule.NAME = 'expected-value-maximization';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],56:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ExpectedValueMinimizationRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*expected value minimization rule*/
var ExpectedValueMinimizationRule = exports.ExpectedValueMinimizationRule = function (_ObjectiveRule) {
    _inherits(ExpectedValueMinimizationRule, _ObjectiveRule);

    function ExpectedValueMinimizationRule(expressionEngine) {
        _classCallCheck(this, ExpectedValueMinimizationRule);

        return _possibleConstructorReturn(this, (ExpectedValueMinimizationRule.__proto__ || Object.getPrototypeOf(ExpectedValueMinimizationRule)).call(this, ExpectedValueMinimizationRule.NAME, expressionEngine));
    }

    _createClass(ExpectedValueMinimizationRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.min.apply(this, _toConsumableArray(childrenPayoffs)));
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this2 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            node.childEdges.forEach(function (e) {
                if (_this2.subtract(_this2.cValue(node, 'payoff'), payoff).equals(_this2.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode)) {
                    _this2.cValue(e, 'optimal', true);
                    _this2.computeOptimal(e.childNode, _this2.basePayoff(e), _this2.multiply(probabilityToEnter, _this2.cValue(e, 'probability')));
                } else {
                    _this2.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return ExpectedValueMinimizationRule;
}(_objectiveRule.ObjectiveRule);

ExpectedValueMinimizationRule.NAME = 'expected-value-minimization';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],57:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _objectiveRule = require('./objective-rule');

Object.keys(_objectiveRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _objectiveRule[key];
    }
  });
});

var _expectedValueMaximizationRule = require('./expected-value-maximization-rule');

Object.keys(_expectedValueMaximizationRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _expectedValueMaximizationRule[key];
    }
  });
});

var _expectedValueMinimizationRule = require('./expected-value-minimization-rule');

Object.keys(_expectedValueMinimizationRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _expectedValueMinimizationRule[key];
    }
  });
});

var _maxiMaxRule = require('./maxi-max-rule');

Object.keys(_maxiMaxRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _maxiMaxRule[key];
    }
  });
});

var _maxiMinRule = require('./maxi-min-rule');

Object.keys(_maxiMinRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _maxiMinRule[key];
    }
  });
});

var _miniMaxRule = require('./mini-max-rule');

Object.keys(_miniMaxRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _miniMaxRule[key];
    }
  });
});

var _miniMinRule = require('./mini-min-rule');

Object.keys(_miniMinRule).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _miniMinRule[key];
    }
  });
});

},{"./expected-value-maximization-rule":55,"./expected-value-minimization-rule":56,"./maxi-max-rule":58,"./maxi-min-rule":59,"./mini-max-rule":60,"./mini-min-rule":61,"./objective-rule":62}],58:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MaxiMaxRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*maxi-max rule*/
var MaxiMaxRule = exports.MaxiMaxRule = function (_ObjectiveRule) {
    _inherits(MaxiMaxRule, _ObjectiveRule);

    function MaxiMaxRule(expressionEngine) {
        _classCallCheck(this, MaxiMaxRule);

        return _possibleConstructorReturn(this, (MaxiMaxRule.__proto__ || Object.getPrototypeOf(MaxiMaxRule)).call(this, MaxiMaxRule.NAME, expressionEngine));
    }

    _createClass(MaxiMaxRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.max.apply(this, _toConsumableArray(childrenPayoffs)));
        }
    }, {
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.cValue(e.childNode, 'payoff') < bestChildPayoff ? 0.0 : 1.0 / bestCount);
            });
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this3 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            var optimalEdge = null;
            if (node instanceof _sdModel.domain.ChanceNode) {
                optimalEdge = _sdUtils.Utils.maxBy(node.childEdges, function (e) {
                    return _this3.cValue(e.childNode, 'payoff');
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.cValue(optimalEdge.childNode, 'payoff').equals(_this3.cValue(e.childNode, 'payoff'));
                } else isOptimal = !!(_this3.subtract(_this3.cValue(node, 'payoff'), payoff).equals(_this3.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode));

                if (isOptimal) {
                    _this3.cValue(e, 'optimal', true);
                    _this3.computeOptimal(e.childNode, _this3.basePayoff(e), _this3.multiply(probabilityToEnter, _this3.cValue(e, 'probability')));
                } else {
                    _this3.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return MaxiMaxRule;
}(_objectiveRule.ObjectiveRule);

MaxiMaxRule.NAME = 'maxi-max';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],59:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MaxiMinRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*maxi-min rule*/
var MaxiMinRule = exports.MaxiMinRule = function (_ObjectiveRule) {
    _inherits(MaxiMinRule, _ObjectiveRule);

    function MaxiMinRule(expressionEngine) {
        _classCallCheck(this, MaxiMinRule);

        return _possibleConstructorReturn(this, (MaxiMinRule.__proto__ || Object.getPrototypeOf(MaxiMinRule)).call(this, MaxiMinRule.NAME, expressionEngine));
    }

    _createClass(MaxiMinRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.max.apply(this, _toConsumableArray(childrenPayoffs)));
        }
    }, {
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.cValue(e.childNode, 'payoff') > worstChildPayoff ? 0.0 : 1.0 / worstCount);
            });
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this3 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            var optimalEdge = null;
            if (node instanceof _sdModel.domain.ChanceNode) {
                optimalEdge = _sdUtils.Utils.minBy(node.childEdges, function (e) {
                    return _this3.cValue(e.childNode, 'payoff');
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.cValue(optimalEdge.childNode, 'payoff').equals(_this3.cValue(e.childNode, 'payoff'));
                } else isOptimal = !!(_this3.subtract(_this3.cValue(node, 'payoff'), payoff).equals(_this3.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode));

                if (isOptimal) {
                    _this3.cValue(e, 'optimal', true);
                    _this3.computeOptimal(e.childNode, _this3.basePayoff(e), _this3.multiply(probabilityToEnter, _this3.cValue(e, 'probability')));
                } else {
                    _this3.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return MaxiMinRule;
}(_objectiveRule.ObjectiveRule);

MaxiMinRule.NAME = 'maxi-min';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],60:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MiniMaxRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*mini-max rule*/
var MiniMaxRule = exports.MiniMaxRule = function (_ObjectiveRule) {
    _inherits(MiniMaxRule, _ObjectiveRule);

    function MiniMaxRule(expressionEngine) {
        _classCallCheck(this, MiniMaxRule);

        return _possibleConstructorReturn(this, (MiniMaxRule.__proto__ || Object.getPrototypeOf(MiniMaxRule)).call(this, MiniMaxRule.NAME, expressionEngine));
    }

    _createClass(MiniMaxRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.min.apply(this, _toConsumableArray(childrenPayoffs)));
        }
    }, {
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.cValue(e.childNode, 'payoff') < bestChildPayoff ? 0.0 : 1.0 / bestCount);
            });
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this3 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            var optimalEdge = null;
            if (node instanceof _sdModel.domain.ChanceNode) {
                optimalEdge = _sdUtils.Utils.maxBy(node.childEdges, function (e) {
                    return _this3.cValue(e.childNode, 'payoff');
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.cValue(optimalEdge.childNode, 'payoff').equals(_this3.cValue(e.childNode, 'payoff'));
                } else isOptimal = !!(_this3.subtract(_this3.cValue(node, 'payoff'), payoff).equals(_this3.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode));

                if (isOptimal) {
                    _this3.cValue(e, 'optimal', true);
                    _this3.computeOptimal(e.childNode, _this3.basePayoff(e), _this3.multiply(probabilityToEnter, _this3.cValue(e, 'probability')));
                } else {
                    _this3.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return MiniMaxRule;
}(_objectiveRule.ObjectiveRule);

MiniMaxRule.NAME = 'mini-max';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],61:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MiniMinRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _objectiveRule = require('./objective-rule');

var _sdUtils = require('sd-utils');

function _toConsumableArray(arr) {
    if (Array.isArray(arr)) {
        for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
            arr2[i] = arr[i];
        }return arr2;
    } else {
        return Array.from(arr);
    }
}

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*mini-min rule*/
var MiniMinRule = exports.MiniMinRule = function (_ObjectiveRule) {
    _inherits(MiniMinRule, _ObjectiveRule);

    function MiniMinRule(expressionEngine) {
        _classCallCheck(this, MiniMinRule);

        return _possibleConstructorReturn(this, (MiniMinRule.__proto__ || Object.getPrototypeOf(MiniMinRule)).call(this, MiniMinRule.NAME, expressionEngine));
    }

    _createClass(MiniMinRule, [{
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.min.apply(this, _toConsumableArray(childrenPayoffs)));
        }
    }, {
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.cValue(e.childNode, 'payoff') > worstChildPayoff ? 0.0 : 1.0 / worstCount);
            });
        }

        //  payoff - parent edge payoff

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            var _this3 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            var optimalEdge = null;
            if (node instanceof _sdModel.domain.ChanceNode) {
                optimalEdge = _sdUtils.Utils.minBy(node.childEdges, function (e) {
                    return _this3.cValue(e.childNode, 'payoff');
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.cValue(optimalEdge.childNode, 'payoff').equals(_this3.cValue(e.childNode, 'payoff'));
                } else isOptimal = !!(_this3.subtract(_this3.cValue(node, 'payoff'), payoff).equals(_this3.cValue(e.childNode, 'payoff')) || !(node instanceof _sdModel.domain.DecisionNode));

                if (isOptimal) {
                    _this3.cValue(e, 'optimal', true);
                    _this3.computeOptimal(e.childNode, _this3.basePayoff(e), _this3.multiply(probabilityToEnter, _this3.cValue(e, 'probability')));
                } else {
                    _this3.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return MiniMinRule;
}(_objectiveRule.ObjectiveRule);

MiniMinRule.NAME = 'mini-min';

},{"./objective-rule":62,"sd-model":"sd-model","sd-utils":"sd-utils"}],62:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ObjectiveRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdExpressionEngine = require('sd-expression-engine');

var _sdModel = require('sd-model');

var _decision = require('../../policies/decision');

var _policy = require('../../policies/policy');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Base class for objective rules*/
var ObjectiveRule = exports.ObjectiveRule = function () {
    function ObjectiveRule(name, expressionEngine) {
        _classCallCheck(this, ObjectiveRule);

        this.name = name;
        this.expressionEngine = expressionEngine;
    }

    _createClass(ObjectiveRule, [{
        key: 'setDecisionPolicy',
        value: function setDecisionPolicy(decisionPolicy) {
            this.decisionPolicy = decisionPolicy;
        }
    }, {
        key: 'clearDecisionPolicy',
        value: function clearDecisionPolicy() {
            this.decisionPolicy = null;
        }

        // should return array of selected children indexes

    }, {
        key: 'makeDecision',
        value: function makeDecision(decisionNode, childrenPayoffs) {
            throw 'makeDecision function not implemented for rule: ' + this.name;
        }
    }, {
        key: '_makeDecision',
        value: function _makeDecision(decisionNode, childrenPayoffs) {
            if (this.decisionPolicy) {
                var decision = _policy.Policy.getDecision(this.decisionPolicy, decisionNode);
                if (decision) {
                    return [decision.decisionValue];
                }
                return [];
            }
            return this.makeDecision(decisionNode, childrenPayoffs);
        }

        // extension point for changing computed probability of edges in a chance node

    }, {
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {}

        // payoff - parent edge payoff, aggregatedPayoff - aggregated payoff along path

    }, {
        key: 'computePayoff',
        value: function computePayoff(node) {
            var _this = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var aggregatedPayoff = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;

            var childrenPayoff = 0;
            if (node.childEdges.length) {
                if (node instanceof _sdModel.domain.DecisionNode) {

                    var selectedIndexes = this._makeDecision(node, node.childEdges.map(function (e) {
                        return _this.computePayoff(e.childNode, _this.basePayoff(e), _this.add(_this.basePayoff(e), aggregatedPayoff));
                    }));
                    node.childEdges.forEach(function (e, i) {
                        _this.clearComputedValues(e);
                        _this.cValue(e, 'probability', selectedIndexes.indexOf(i) < 0 ? 0.0 : 1.0);
                    });
                } else {
                    var bestChild = -Infinity;
                    var bestCount = 1;
                    var worstChild = Infinity;
                    var worstCount = 1;

                    node.childEdges.forEach(function (e) {
                        var childPayoff = _this.computePayoff(e.childNode, _this.basePayoff(e), _this.add(_this.basePayoff(e), aggregatedPayoff));
                        if (childPayoff < worstChild) {
                            worstChild = childPayoff;
                            worstCount = 1;
                        } else if (childPayoff.equals(worstChild)) {
                            worstCount++;
                        }
                        if (childPayoff > bestChild) {
                            bestChild = childPayoff;
                            bestCount = 1;
                        } else if (childPayoff.equals(bestChild)) {
                            bestCount++;
                        }

                        _this.clearComputedValues(e);
                        _this.cValue(e, 'probability', _this.baseProbability(e));
                    });
                    this.modifyChanceProbability(node.childEdges, bestChild, bestCount, worstChild, worstCount);
                }

                var sumweight = 0;
                node.childEdges.forEach(function (e) {
                    sumweight = _this.add(sumweight, _this.cValue(e, 'probability'));
                });

                // console.log(payoff,node.childEdges,'sumweight',sumweight);
                if (sumweight > 0) {
                    node.childEdges.forEach(function (e) {
                        childrenPayoff = _this.add(childrenPayoff, _this.multiply(_this.cValue(e, 'probability'), _this.cValue(e.childNode, 'payoff')).div(sumweight));
                    });
                }
            }

            payoff = this.add(payoff, childrenPayoff);
            this.clearComputedValues(node);

            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'aggregatedPayoff', aggregatedPayoff);
                this.cValue(node, 'probabilityToEnter', 0); //initial value
            } else {
                this.cValue(node, 'childrenPayoff', childrenPayoff);
            }

            return this.cValue(node, 'payoff', payoff);
        }

        // koloruje optymalne ścieżki

    }, {
        key: 'computeOptimal',
        value: function computeOptimal(node) {
            throw 'computeOptimal function not implemented for rule: ' + this.name;
        }

        /*Get or set object's computed value for current rule*/

    }, {
        key: 'cValue',
        value: function cValue(object, fieldName, value) {
            return object.computedValue(this.name, fieldName, value);
        }
    }, {
        key: 'baseProbability',
        value: function baseProbability(edge) {
            return edge.computedBaseProbability();
        }
    }, {
        key: 'basePayoff',
        value: function basePayoff(edge) {
            return edge.computedBasePayoff();
        }
    }, {
        key: 'clearComputedValues',
        value: function clearComputedValues(object) {
            object.clearComputedValues(this.name);
        }
    }, {
        key: 'add',
        value: function add(a, b) {
            return _sdExpressionEngine.ExpressionEngine.add(a, b);
        }
    }, {
        key: 'subtract',
        value: function subtract(a, b) {
            return _sdExpressionEngine.ExpressionEngine.subtract(a, b);
        }
    }, {
        key: 'divide',
        value: function divide(a, b) {
            return _sdExpressionEngine.ExpressionEngine.divide(a, b);
        }
    }, {
        key: 'multiply',
        value: function multiply(a, b) {
            return _sdExpressionEngine.ExpressionEngine.multiply(a, b);
        }
    }, {
        key: 'max',
        value: function max() {
            return _sdExpressionEngine.ExpressionEngine.max.apply(_sdExpressionEngine.ExpressionEngine, arguments);
        }
    }, {
        key: 'min',
        value: function min() {
            return _sdExpressionEngine.ExpressionEngine.min.apply(_sdExpressionEngine.ExpressionEngine, arguments);
        }
    }]);

    return ObjectiveRule;
}();

},{"../../policies/decision":66,"../../policies/policy":68,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],63:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.FlipSubtree = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require('sd-model');

var _sdExpressionEngine = require('sd-expression-engine');

var _sdUtils = require('sd-utils');

var _operation = require('./operation');

var _treeValidator = require('../validation/tree-validator');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
    if (!self) {
        throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }return call && ((typeof call === "undefined" ? "undefined" : _typeof(call)) === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : _typeof(superClass)));
    }subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
}

/*Subtree flipping operation*/
var FlipSubtree = exports.FlipSubtree = function (_Operation) {
    _inherits(FlipSubtree, _Operation);

    function FlipSubtree(data, expressionEngine) {
        _classCallCheck(this, FlipSubtree);

        var _this = _possibleConstructorReturn(this, (FlipSubtree.__proto__ || Object.getPrototypeOf(FlipSubtree)).call(this, FlipSubtree.$NAME));

        _this.data = data;
        _this.expressionEngine = expressionEngine;
        _this.treeValidator = new _treeValidator.TreeValidator(expressionEngine);
        return _this;
    }

    _createClass(FlipSubtree, [{
        key: 'isApplicable',
        value: function isApplicable(object) {
            return object instanceof _sdModel.domain.ChanceNode;
        }
    }, {
        key: 'canPerform',
        value: function canPerform(node) {
            if (!this.isApplicable(node)) {
                return false;
            }

            if (!this.treeValidator.validate(this.data.getAllNodesInSubtree(node)).isValid()) {
                //check if the whole subtree is proper
                return false;
            }

            if (node.childEdges.length < 1) {
                return false;
            }

            var grandchildrenNumber = null;
            var grandchildrenEdgeLabels = [];
            var childrenEdgeLabelsSet = new Set();
            var grandchildrenEdgeLabelsSet;
            if (!node.childEdges.every(function (e) {

                var child = e.childNode;
                if (!(child instanceof _sdModel.domain.ChanceNode)) {
                    return false;
                }

                if (childrenEdgeLabelsSet.has(e.name.trim())) {
                    // edge labels should be unique
                    return false;
                }
                childrenEdgeLabelsSet.add(e.name.trim());

                if (grandchildrenNumber === null) {
                    grandchildrenNumber = child.childEdges.length;
                    if (grandchildrenNumber < 1) {
                        return false;
                    }
                    child.childEdges.forEach(function (ge) {
                        grandchildrenEdgeLabels.push(ge.name.trim());
                    });

                    grandchildrenEdgeLabelsSet = new Set(grandchildrenEdgeLabels);

                    if (grandchildrenEdgeLabelsSet.size !== grandchildrenEdgeLabels.length) {
                        //grandchildren edge labels should be unique
                        return false;
                    }

                    return true;
                }

                if (child.childEdges.length != grandchildrenNumber) {
                    return false;
                }

                if (!child.childEdges.every(function (ge, i) {
                    return grandchildrenEdgeLabels[i] === ge.name.trim();
                })) {
                    return false;
                }

                return true;
            })) {

                return false;
            }

            return true;
        }
    }, {
        key: 'perform',
        value: function perform(root) {
            var _this2 = this;

            var rootClone = this.data.cloneSubtree(root, true);
            var oldChildrenNumber = root.childEdges.length;
            var oldGrandChildrenNumber = root.childEdges[0].childNode.childEdges.length;

            var childrenNumber = oldGrandChildrenNumber;
            var grandChildrenNumber = oldChildrenNumber;

            var callbacksDisabled = this.data.callbacksDisabled;
            this.data.callbacksDisabled = true;

            var childX = root.childEdges[0].childNode.location.x;
            var topY = root.childEdges[0].childNode.childEdges[0].childNode.location.y;
            var bottomY = root.childEdges[oldChildrenNumber - 1].childNode.childEdges[oldGrandChildrenNumber - 1].childNode.location.y;

            var extentY = bottomY - topY;
            var stepY = extentY / (childrenNumber + 1);

            root.childEdges.slice().forEach(function (e) {
                return _this2.data.removeNode(e.childNode);
            });

            for (var i = 0; i < childrenNumber; i++) {
                var child = new _sdModel.domain.ChanceNode(new _sdModel.domain.Point(childX, topY + (i + 1) * stepY));
                var edge = this.data.addNode(child, root);
                edge.name = rootClone.childEdges[0].childNode.childEdges[i].name;

                edge.probability = 0;

                for (var j = 0; j < grandChildrenNumber; j++) {
                    var grandChild = rootClone.childEdges[j].childNode.childEdges[i].childNode;

                    var grandChildEdge = this.data.attachSubtree(grandChild, child);
                    grandChildEdge.name = rootClone.childEdges[j].name;
                    grandChildEdge.payoff = _sdExpressionEngine.ExpressionEngine.add(rootClone.childEdges[j].computedBasePayoff(), rootClone.childEdges[j].childNode.childEdges[i].computedBasePayoff());

                    grandChildEdge.probability = _sdExpressionEngine.ExpressionEngine.multiply(rootClone.childEdges[j].computedBaseProbability(), rootClone.childEdges[j].childNode.childEdges[i].computedBaseProbability());
                    edge.probability = _sdExpressionEngine.ExpressionEngine.add(edge.probability, grandChildEdge.probability);
                }

                var divideGrandChildEdgeProbability = function divideGrandChildEdgeProbability(p) {
                    return _sdExpressionEngine.ExpressionEngine.divide(p, edge.probability);
                };
                if (edge.probability.equals(0)) {
                    var prob = _sdExpressionEngine.ExpressionEngine.divide(1, grandChildrenNumber);
                    divideGrandChildEdgeProbability = function divideGrandChildEdgeProbability(p) {
                        return prob;
                    };
                }

                var probabilitySum = 0.0;
                child.childEdges.forEach(function (grandChildEdge) {
                    grandChildEdge.probability = divideGrandChildEdgeProbability(grandChildEdge.probability);
                    probabilitySum = _sdExpressionEngine.ExpressionEngine.add(probabilitySum, grandChildEdge.probability);
                    grandChildEdge.probability = _this2.expressionEngine.serialize(grandChildEdge.probability);
                });

                this._normalizeProbabilitiesAfterFlip(child.childEdges, probabilitySum);
                edge.probability = this.expressionEngine.serialize(edge.probability);
            }
            this._normalizeProbabilitiesAfterFlip(root.childEdges);

            this.data.callbacksDisabled = callbacksDisabled;
            this.data._fireNodeAddedCallback();
        }
    }, {
        key: '_normalizeProbabilitiesAfterFlip',
        value: function _normalizeProbabilitiesAfterFlip(childEdges, probabilitySum) {
            var _this3 = this;

            if (!probabilitySum) {
                probabilitySum = 0.0;
                childEdges.forEach(function (e) {
                    probabilitySum = _sdExpressionEngine.ExpressionEngine.add(probabilitySum, e.probability);
                });
            }
            if (!probabilitySum.equals(1)) {
                _sdUtils.log.info('Sum of the probabilities in child nodes is not equal to 1 : ', probabilitySum);
                var newProbabilitySum = 0.0;
                var cf = 1000000000000; //10^12
                var prec = 12;
                childEdges.forEach(function (e) {
                    e.probability = parseInt(_sdExpressionEngine.ExpressionEngine.round(e.probability, prec) * cf);
                    newProbabilitySum = newProbabilitySum + e.probability;
                });
                var rest = cf - newProbabilitySum;
                _sdUtils.log.info('Normalizing with rounding to precision: ' + prec, rest);
                childEdges[0].probability = _sdExpressionEngine.ExpressionEngine.add(rest, childEdges[0].probability);
                newProbabilitySum = 0.0;
                childEdges.forEach(function (e) {
                    e.probability = _this3.expressionEngine.serialize(_sdExpressionEngine.ExpressionEngine.divide(parseInt(e.probability), cf));
                });
            }
        }
    }]);

    return FlipSubtree;
}(_operation.Operation);

FlipSubtree.$NAME = 'flipSubtree';

},{"../validation/tree-validator":71,"./operation":64,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],64:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Base class for complex operations on tree structure*/
var Operation = exports.Operation = function () {
    function Operation(name) {
        _classCallCheck(this, Operation);

        this.name = name;
    }

    //check if operation is potentially applicable for object


    _createClass(Operation, [{
        key: 'isApplicable',
        value: function isApplicable() {
            throw 'isApplicable function not implemented for operation: ' + this.name;
        }

        //check if can perform operation for applicable object

    }, {
        key: 'canPerform',
        value: function canPerform(object) {
            throw 'canPerform function not implemented for operation: ' + this.name;
        }
    }, {
        key: 'perform',
        value: function perform(object) {
            throw 'perform function not implemented for operation: ' + this.name;
        }
    }]);

    return Operation;
}();

},{}],65:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.OperationsManager = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _flipSubtree = require("./flip-subtree");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var OperationsManager = exports.OperationsManager = function () {
    function OperationsManager(data, expressionEngine) {
        _classCallCheck(this, OperationsManager);

        this.operations = [];
        this.operationByName = {};

        this.data = data;
        this.expressionEngine = expressionEngine;
        this.registerOperation(new _flipSubtree.FlipSubtree(data, expressionEngine));
    }

    _createClass(OperationsManager, [{
        key: "registerOperation",
        value: function registerOperation(operation) {
            this.operations.push(operation);
            this.operationByName[operation.name] = operation;
        }
    }, {
        key: "getOperationByName",
        value: function getOperationByName(name) {
            return this.operationByName[name];
        }
    }, {
        key: "operationsForObject",
        value: function operationsForObject(object) {
            return this.operations.filter(function (op) {
                return op.isApplicable(object);
            });
        }
    }]);

    return OperationsManager;
}();

},{"./flip-subtree":63}],66:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var Decision = exports.Decision = function () {
    //index of  selected edge
    function Decision(node, decisionValue) {
        _classCallCheck(this, Decision);

        this.children = [];

        this.node = node;
        this.decisionValue = decisionValue;
        this.key = Decision.generateKey(this);
    }

    _createClass(Decision, [{
        key: 'addDecision',
        value: function addDecision(node, decisionValue) {
            var decision = new Decision(node, decisionValue);
            this.children.push(decision);
            this.key = Decision.generateKey(this);
            return decision;
        }
    }, {
        key: 'getDecision',
        value: function getDecision(decisionNode) {
            return Decision.getDecision(this, decisionNode);
        }
    }, {
        key: 'toDecisionString',
        value: function toDecisionString() {
            var indent = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

            return Decision.toDecisionString(this, indent);
        }
    }], [{
        key: 'generateKey',
        value: function generateKey(decision) {
            var keyProperty = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '$id';

            var e = decision.node.childEdges[decision.decisionValue];
            var key = decision.node[keyProperty] + ":" + (e[keyProperty] ? e[keyProperty] : decision.decisionValue + 1);
            return key.replace(/\n/g, ' ');
        }
    }, {
        key: 'getDecision',
        value: function getDecision(decision, decisionNode) {
            if (decision.node === decisionNode || decision.node.$id === decisionNode.$id) {
                return decision;
            }
            for (var i = 0; i < decision.children.length; i++) {
                var d = Decision.getDecision(decision.children[i], decisionNode);
                if (d) {
                    return d;
                }
            }
        }
    }, {
        key: 'toDecisionString',
        value: function toDecisionString(decision) {
            var extended = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
            var keyProperty = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'name';
            var indent = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : '';

            var res = Decision.generateKey(decision, keyProperty);
            var childrenRes = "";

            decision.children.forEach(function (d) {
                if (childrenRes) {
                    if (extended) {
                        childrenRes += '\n' + indent;
                    } else {
                        childrenRes += ", ";
                    }
                }
                childrenRes += Decision.toDecisionString(d, extended, keyProperty, indent + '\t');
            });
            if (decision.children.length) {
                if (extended) {
                    childrenRes = '\n' + indent + childrenRes;
                } else {
                    childrenRes = " - (" + childrenRes + ")";
                }
            }

            return res + childrenRes;
        }
    }]);

    return Decision;
}();

},{}],67:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.PoliciesCollector = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _policy = require('./policy');

var _sdModel = require('sd-model');

var _sdUtils = require('sd-utils');

var _decision = require('./decision');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var PoliciesCollector = exports.PoliciesCollector = function () {
    function PoliciesCollector(root, optimalForRuleName) {
        var _this = this;

        _classCallCheck(this, PoliciesCollector);

        this.policies = [];
        this.ruleName = false;

        this.ruleName = optimalForRuleName;
        this.collect(root).forEach(function (decisions, i) {
            _this.policies.push(new _policy.Policy("#" + (i + 1), decisions));
        });
        if (this.policies.length === 1) {
            this.policies[0].id = "default";
        }
    }

    _createClass(PoliciesCollector, [{
        key: 'collect',
        value: function collect(root) {
            var _this2 = this;

            var nodeQueue = [root];
            var node;
            var decisionNodes = [];
            while (nodeQueue.length) {
                node = nodeQueue.shift();

                if (this.ruleName && !node.computedValue(this.ruleName, 'optimal')) {
                    continue;
                }

                if (node instanceof _sdModel.domain.DecisionNode) {
                    decisionNodes.push(node);
                    continue;
                }

                node.childEdges.forEach(function (edge, i) {
                    nodeQueue.push(edge.childNode);
                });
            }

            return _sdUtils.Utils.cartesianProductOf(decisionNodes.map(function (decisionNode) {
                var decisions = [];
                decisionNode.childEdges.forEach(function (edge, i) {

                    if (_this2.ruleName && !edge.computedValue(_this2.ruleName, 'optimal')) {
                        return;
                    }

                    var childDecisions = _this2.collect(edge.childNode); //all possible child decisions (cartesian)
                    childDecisions.forEach(function (cd) {
                        var decision = new _decision.Decision(decisionNode, i);
                        decisions.push(decision);
                        decision.children = cd;
                    });
                });
                return decisions;
            }));
        }
    }]);

    return PoliciesCollector;
}();

},{"./decision":66,"./policy":68,"sd-model":"sd-model","sd-utils":"sd-utils"}],68:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.Policy = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _decision = require("./decision");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var Policy = exports.Policy = function () {
    function Policy(id, decisions) {
        _classCallCheck(this, Policy);

        this.decisions = [];

        this.id = id;
        this.decisions = decisions || [];
        this.key = Policy.generateKey(this);
    }

    _createClass(Policy, [{
        key: "addDecision",
        value: function addDecision(node, decisionValue) {
            var decision = new _decision.Decision(node, decisionValue);
            this.decisions.push(decision);
            this.key = Policy.generateKey(this);
            return decision;
        }
    }, {
        key: "equals",
        value: function equals(policy) {
            var ignoreId = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            if (this.key != policy.key) {
                return false;
            }

            return ignoreId || this.id === policy.id;
        }
    }, {
        key: "getDecision",
        value: function getDecision(decisionNode) {
            return Policy.getDecision(this, decisionNode);
        }
    }, {
        key: "toPolicyString",
        value: function toPolicyString() {
            var indent = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

            return Policy.toPolicyString(this, indent);
        }
    }], [{
        key: "generateKey",
        value: function generateKey(policy) {
            var key = "";
            policy.decisions.forEach(function (d) {
                return key += (key ? "&" : "") + d.key;
            });
            return key;
        }
    }, {
        key: "getDecision",
        value: function getDecision(policy, decisionNode) {
            for (var i = 0; i < policy.decisions.length; i++) {
                var decision = _decision.Decision.getDecision(policy.decisions[i], decisionNode);
                if (decision) {
                    return decision;
                }
            }
            return null;
        }
    }, {
        key: "toPolicyString",
        value: function toPolicyString(policy) {
            var extended = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
            var prependId = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

            var res = "";
            policy.decisions.forEach(function (d) {
                if (res) {
                    if (extended) {
                        res += "\n";
                    } else {
                        res += ", ";
                    }
                }
                res += _decision.Decision.toDecisionString(d, extended, 'name', '\t');
            });
            if (prependId && policy.id !== undefined) {
                return policy.id + " " + res;
            }
            return res;
        }
    }]);

    return Policy;
}();

},{"./decision":66}],69:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.PayoffValueValidator = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdExpressionEngine = require("sd-expression-engine");

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Computed base value validator*/
var PayoffValueValidator = exports.PayoffValueValidator = function () {
    function PayoffValueValidator(expressionEngine) {
        _classCallCheck(this, PayoffValueValidator);

        this.expressionEngine = expressionEngine;
    }

    _createClass(PayoffValueValidator, [{
        key: "validate",
        value: function validate(value) {
            if (value === null || value === undefined) {
                return false;
            }
            var value = _sdExpressionEngine.ExpressionEngine.toNumber(value);
            return value.compare(Number.MIN_SAFE_INTEGER) >= 0 && value.compare(Number.MAX_SAFE_INTEGER) <= 0;
        }
    }]);

    return PayoffValueValidator;
}();

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],70:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ProbabilityValueValidator = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdExpressionEngine = require("sd-expression-engine");

var _sdUtils = require("sd-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

/*Computed base value validator*/
var ProbabilityValueValidator = exports.ProbabilityValueValidator = function () {
    function ProbabilityValueValidator(expressionEngine) {
        _classCallCheck(this, ProbabilityValueValidator);

        this.expressionEngine = expressionEngine;
    }

    _createClass(ProbabilityValueValidator, [{
        key: "validate",
        value: function validate(value, edge) {
            if (value === null || value === undefined) {
                return false;
            }

            var value = _sdExpressionEngine.ExpressionEngine.toNumber(value);
            return value.compare(0) >= 0 && value.compare(1) <= 0;
        }
    }]);

    return ProbabilityValueValidator;
}();

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],71:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.TreeValidator = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdUtils = require('sd-utils');

var _sdModel = require('sd-model');

var _sdExpressionEngine = require('sd-expression-engine');

var _probabilityValueValidator = require('./probability-value-validator');

var _payoffValueValidator = require('./payoff-value-validator');

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var TreeValidator = exports.TreeValidator = function () {
    function TreeValidator(expressionEngine) {
        _classCallCheck(this, TreeValidator);

        this.expressionEngine = expressionEngine;
        this.probabilityValueValidator = new _probabilityValueValidator.ProbabilityValueValidator(expressionEngine);
        this.payoffValueValidator = new _payoffValueValidator.PayoffValueValidator(expressionEngine);
    }

    _createClass(TreeValidator, [{
        key: 'validate',
        value: function validate(nodes) {
            var _this = this;

            var validationResult = new _sdModel.ValidationResult();

            nodes.forEach(function (n) {
                _this.validateNode(n, validationResult);
            });

            return validationResult;
        }
    }, {
        key: 'validateNode',
        value: function validateNode(node) {
            var _this2 = this;

            var validationResult = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : new _sdModel.ValidationResult();

            if (node instanceof _sdModel.domain.TerminalNode) {
                return;
            }
            if (!node.childEdges.length) {
                validationResult.addError('incompletePath', node);
            }

            var probabilitySum = _sdExpressionEngine.ExpressionEngine.toNumber(0);
            var withHash = false;
            node.childEdges.forEach(function (e, i) {
                e.setValueValidity('probability', true);
                e.setValueValidity('payoff', true);

                if (node instanceof _sdModel.domain.ChanceNode) {
                    var probability = e.computedBaseProbability();
                    if (!_this2.probabilityValueValidator.validate(probability)) {
                        if (!_sdExpressionEngine.ExpressionEngine.isHash(e.probability)) {
                            validationResult.addError({ name: 'invalidProbability', data: { 'number': i + 1 } }, node);
                            e.setValueValidity('probability', false);
                        }
                    } else {
                        probabilitySum = _sdExpressionEngine.ExpressionEngine.add(probabilitySum, probability);
                    }
                }
                var payoff = e.computedBasePayoff();
                if (!_this2.payoffValueValidator.validate(payoff)) {
                    validationResult.addError({ name: 'invalidPayoff', data: { 'number': i + 1 } }, node);
                    // console.log('invalidPayoff', e);
                    e.setValueValidity('payoff', false);
                }
            });
            if (node instanceof _sdModel.domain.ChanceNode) {
                if (isNaN(probabilitySum) || !probabilitySum.equals(1)) {
                    validationResult.addError('probabilityDoNotSumUpTo1', node);
                }
            }

            return validationResult;
        }
    }]);

    return TreeValidator;
}();

},{"./payoff-value-validator":69,"./probability-value-validator":70,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],"sd-computations":[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _index = require('./src/index');

Object.keys(_index).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _index[key];
    }
  });
});

},{"./src/index":5}]},{},[])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmNcXHNyY1xcY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyY1xcY29tcHV0YXRpb25zLW1hbmFnZXIuanMiLCJzcmNcXGV4cHJlc3Npb25zLWV2YWx1YXRvci5qcyIsInNyY1xcaW5kZXguanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xccHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1xccHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzXFxzdGVwc1xccHJlcGFyZS12YXJpYWJsZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHJlY29tcHV0ZVxccmVjb21wdXRlLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xccmVjb21wdXRlXFxyZWNvbXB1dGUtam9iLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxzdGVwc1xcY2FsY3VsYXRlLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxzZW5zaXRpdml0eS1hbmFseXNpc1xcc3RlcHNcXGluaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxzdGVwc1xccHJlcGFyZS12YXJpYWJsZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHRvcm5hZG8tZGlhZ3JhbVxcc3RlcHNcXGNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcdG9ybmFkby1kaWFncmFtXFxzdGVwc1xcaW5pdC1wb2xpY2llcy1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcdG9ybmFkby1kaWFncmFtXFxzdGVwc1xccHJlcGFyZS12YXJpYWJsZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHRvcm5hZG8tZGlhZ3JhbVxcdG9ybmFkby1kaWFncmFtLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcdG9ybmFkby1kaWFncmFtXFx0b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGJhdGNoXFxiYXRjaC1zdGVwLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGV4dGVuZGFibGUtZXJyb3IuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcaW5kZXguanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxqb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1yZXN0YXJ0LWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGVjdXRpb24tY29udGV4dC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxpbmRleC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItZXhlY3V0aW9uLWZsYWcuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWV4ZWN1dGlvbi1saXN0ZW5lci5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItZXhlY3V0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1pbnN0YW5jZS5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2Ita2V5LWdlbmVyYXRvci5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItbGF1bmNoZXIuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXBhcmFtZXRlci1kZWZpbml0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXBvc2l0b3J5XFxpZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXJlcG9zaXRvcnlcXGpvYi1yZXBvc2l0b3J5LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXBvc2l0b3J5XFx0aW1lb3V0LWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXN1bHQuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXN0YXR1cy5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2IuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcc2ltcGxlLWpvYi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxzdGVwLWV4ZWN1dGlvbi1saXN0ZW5lci5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxzdGVwLWV4ZWN1dGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxzdGVwLmpzIiwic3JjXFxqb2JzXFxpbmRleC5qcyIsInNyY1xcam9ic1xcam9iLWluc3RhbmNlLW1hbmFnZXIuanMiLCJzcmNcXGpvYnNcXGpvYi13b3JrZXIuanMiLCJzcmNcXGpvYnNcXGpvYnMtbWFuYWdlci5qcyIsInNyY1xcb2JqZWN0aXZlXFxvYmplY3RpdmUtcnVsZXMtbWFuYWdlci5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcZXhwZWN0ZWQtdmFsdWUtbWF4aW1pemF0aW9uLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXGV4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbi1ydWxlLmpzIiwic3JjXFxvYmplY3RpdmVcXHJ1bGVzXFxpbmRleC5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWF4aS1tYXgtcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWF4aS1taW4tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWluaS1tYXgtcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWluaS1taW4tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmNcXG9wZXJhdGlvbnNcXGZsaXAtc3VidHJlZS5qcyIsInNyY1xcb3BlcmF0aW9uc1xcb3BlcmF0aW9uLmpzIiwic3JjXFxvcGVyYXRpb25zXFxvcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmNcXHBvbGljaWVzXFxkZWNpc2lvbi5qcyIsInNyY1xccG9saWNpZXNcXHBvbGljaWVzLWNvbGxlY3Rvci5qcyIsInNyY1xccG9saWNpZXNcXHBvbGljeS5qcyIsInNyY1xcdmFsaWRhdGlvblxccGF5b2ZmLXZhbHVlLXZhbGlkYXRvci5qcyIsInNyY1xcdmFsaWRhdGlvblxccHJvYmFiaWxpdHktdmFsdWUtdmFsaWRhdG9yLmpzIiwic3JjXFx2YWxpZGF0aW9uXFx0cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUN0VEE7O0FBQ0E7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0ksQUFLYSxtQyxBQUFBO3dDQUVUOztzQ0FBQSxBQUFZLFFBQVE7OEJBQUE7O2tKQUFBOztjQURwQixB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QUM3QztxQ0FBQSxBQUFpQixTQUFTLEVBQUMsTUFBRCxBQUFPLGlCQUFpQixNQUFNLEVBQUMsVUFBVSxJQUFuRSxBQUEwQixBQUE4QixBQUFlLE9BQXZFLEFBQTRFLEFBQzVFO0FBQ0E7c0JBQUEsQUFBRSxpQkFBRixBQUFtQixVQUFuQixBQUE2QixBQUNoQztBQUdKO0FBeEJELEFBeUJBO2dCQUFJLGdCQUFnQixnQkFBcEIsQUFBMEIsWUFBWSxBQUNsQztvQkFBSSxNQUFBLEFBQU0sbUJBQW1CLENBQUMsZUFBQSxBQUFlLE9BQTdDLEFBQThCLEFBQXNCLElBQUksQUFDcEQ7cUNBQUEsQUFBaUIsU0FBakIsQUFBMEIsNEJBQTFCLEFBQXNELEFBQ3pEO0FBQ0o7QUFHRDs7bUJBQUEsQUFBTyxBQUNWOzs7Ozs7Ozs7Ozs7Ozs7O0FDdkVMLDJDQUFBO2lEQUFBOztnQkFBQTt3QkFBQTtvQkFBQTtBQUFBO0FBQUEiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVxdWVzdC5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcmVxdWVzdDtcbiAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG4gICAgICBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcblxuICAgIHAucmVxdWVzdCA9IHJlcXVlc3Q7XG4gICAgcmV0dXJuIHA7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsKSB7XG4gICAgICAgICAgdGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcbiAgICB0aGlzLl9pbmRleCA9IGluZGV4O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ211bHRpRW50cnknLFxuICAgICd1bmlxdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdnZXQnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcbiAgICB0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuICAgICdkaXJlY3Rpb24nLFxuICAgICdrZXknLFxuICAgICdwcmltYXJ5S2V5JyxcbiAgICAndmFsdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuICAgICd1cGRhdGUnLFxuICAgICdkZWxldGUnXG4gIF0pO1xuXG4gIC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG4gIFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcbiAgICBpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGN1cnNvciA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICBmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuICAgIHRoaXMuX3N0b3JlID0gc3RvcmU7XG4gIH1cblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnaW5kZXhOYW1lcycsXG4gICAgJ2F1dG9JbmNyZW1lbnQnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdwdXQnLFxuICAgICdhZGQnLFxuICAgICdkZWxldGUnLFxuICAgICdjbGVhcicsXG4gICAgJ2dldCcsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdkZWxldGVJbmRleCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuICAgIHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgVHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuICAgICdvYmplY3RTdG9yZU5hbWVzJyxcbiAgICAnbW9kZSdcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcbiAgICAnYWJvcnQnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICAgIHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG4gICAgdGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG4gIH1cblxuICBVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnZGVsZXRlT2JqZWN0U3RvcmUnLFxuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gREIoZGIpIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICB9XG5cbiAgREIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICAvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuICAvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG4gIFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuICAgIFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZVtmdW5jTmFtZS5yZXBsYWNlKCdvcGVuJywgJ2l0ZXJhdGUnKV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGFyZ3MgPSB0b0FycmF5KGFyZ3VtZW50cyk7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICAgICAgdmFyIG5hdGl2ZU9iamVjdCA9IHRoaXMuX3N0b3JlIHx8IHRoaXMuX2luZGV4O1xuICAgICAgICB2YXIgcmVxdWVzdCA9IG5hdGl2ZU9iamVjdFtmdW5jTmFtZV0uYXBwbHkobmF0aXZlT2JqZWN0LCBhcmdzLnNsaWNlKDAsIC0xKSk7XG4gICAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY2FsbGJhY2socmVxdWVzdC5yZXN1bHQpO1xuICAgICAgICB9O1xuICAgICAgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gcG9seWZpbGwgZ2V0QWxsXG4gIFtJbmRleCwgT2JqZWN0U3RvcmVdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICBpZiAoQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCkgcmV0dXJuO1xuICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwgPSBmdW5jdGlvbihxdWVyeSwgY291bnQpIHtcbiAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICB2YXIgaXRlbXMgPSBbXTtcblxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgaW5zdGFuY2UuaXRlcmF0ZUN1cnNvcihxdWVyeSwgZnVuY3Rpb24oY3Vyc29yKSB7XG4gICAgICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpdGVtcy5wdXNoKGN1cnNvci52YWx1ZSk7XG5cbiAgICAgICAgICBpZiAoY291bnQgIT09IHVuZGVmaW5lZCAmJiBpdGVtcy5sZW5ndGggPT0gY291bnQpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjdXJzb3IuY29udGludWUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICB2YXIgZXhwID0ge1xuICAgIG9wZW46IGZ1bmN0aW9uKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdvcGVuJywgW25hbWUsIHZlcnNpb25dKTtcbiAgICAgIHZhciByZXF1ZXN0ID0gcC5yZXF1ZXN0O1xuXG4gICAgICByZXF1ZXN0Lm9udXBncmFkZW5lZWRlZCA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmICh1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgICAgICB1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKGRiKSB7XG4gICAgICAgIHJldHVybiBuZXcgREIoZGIpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBkZWxldGU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdkZWxldGVEYXRhYmFzZScsIFtuYW1lXSk7XG4gICAgfVxuICB9O1xuXG4gIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZXhwO1xuICB9XG4gIGVsc2Uge1xuICAgIHNlbGYuaWRiID0gZXhwO1xuICB9XG59KCkpO1xuIiwiaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zTWFuYWdlcn0gZnJvbSBcIi4vY29tcHV0YXRpb25zLW1hbmFnZXJcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ30gZnJvbSBcIi4vY29tcHV0YXRpb25zLW1hbmFnZXJcIjtcblxuXG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmVDb25maWcgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlne1xuICAgIGxvZ0xldmVsID0gJ3dhcm4nO1xuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vRW50cnkgcG9pbnQgY2xhc3MgZm9yIHN0YW5kYWxvbmUgY29tcHV0YXRpb24gd29ya2Vyc1xuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc0VuZ2luZSBleHRlbmRzIENvbXB1dGF0aW9uc01hbmFnZXJ7XG5cbiAgICBnbG9iYWwgPSBVdGlscy5nZXRHbG9iYWxPYmplY3QoKTtcbiAgICBpc1dvcmtlciA9IFV0aWxzLmlzV29ya2VyKCk7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWcsIGRhdGEpe1xuICAgICAgICBzdXBlcihjb25maWcsIGRhdGEpO1xuXG4gICAgICAgIGlmKHRoaXMuaXNXb3JrZXIpIHtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5yZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHtcbiAgICAgICAgICAgICAgICBiZWZvcmVKb2I6IChqb2JFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ2JlZm9yZUpvYicsIGpvYkV4ZWN1dGlvbi5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIGFmdGVySm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdhZnRlckpvYicsIGpvYkV4ZWN1dGlvbi5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICAgICAgICB0aGlzLnF1ZXJ5YWJsZUZ1bmN0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBydW5Kb2I6IGZ1bmN0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pe1xuICAgICAgICAgICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzLCBzZXJpYWxpemVkRGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkYXRhID0gbmV3IERhdGFNb2RlbChkYXRhRFRPKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucnVuSm9iKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgZXhlY3V0ZUpvYjogZnVuY3Rpb24oam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5qb2JzTWFuZ2VyLmV4ZWN1dGUoam9iRXhlY3V0aW9uSWQpLmNhdGNoKGU9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJlcGx5KCdqb2JGYXRhbEVycm9yJywgam9iRXhlY3V0aW9uSWQsIFV0aWxzLmdldEVycm9yRFRPKGUpKTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlY29tcHV0ZTogZnVuY3Rpb24oZGF0YURUTywgcnVsZU5hbWUsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICAgICAgICAgIGlmKHJ1bGVOYW1lKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdmFyIGFsbFJ1bGVzID0gIXJ1bGVOYW1lO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLl9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ3JlY29tcHV0ZWQnLCBkYXRhLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBnbG9iYWwub25tZXNzYWdlID0gZnVuY3Rpb24ob0V2ZW50KSB7XG4gICAgICAgICAgICAgICAgaWYgKG9FdmVudC5kYXRhIGluc3RhbmNlb2YgT2JqZWN0ICYmIG9FdmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZCcpICYmIG9FdmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeUFyZ3VtZW50cycpKSB7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnF1ZXJ5YWJsZUZ1bmN0aW9uc1tvRXZlbnQuZGF0YS5xdWVyeU1ldGhvZF0uYXBwbHkoc2VsZiwgb0V2ZW50LmRhdGEucXVlcnlBcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLmRlZmF1bHRSZXBseShvRXZlbnQuZGF0YSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHN1cGVyLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLnNldExvZ0xldmVsKHRoaXMuY29uZmlnLmxvZ0xldmVsKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgc2V0TG9nTGV2ZWwobGV2ZWwpe1xuICAgICAgICBsb2cuc2V0TGV2ZWwobGV2ZWwpXG4gICAgfVxuXG4gICAgZGVmYXVsdFJlcGx5KG1lc3NhZ2UpIHtcbiAgICAgICAgdGhpcy5yZXBseSgndGVzdCcsIG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJlcGx5KCkge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcGx5IC0gbm90IGVub3VnaCBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmdsb2JhbC5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAncXVlcnlNZXRob2RMaXN0ZW5lcic6IGFyZ3VtZW50c1swXSxcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZEFyZ3VtZW50cyc6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZXNNYW5hZ2VyfSBmcm9tIFwiLi9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXJcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtPcGVyYXRpb25zTWFuYWdlcn0gZnJvbSBcIi4vb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXJcIjtcbmltcG9ydCB7Sm9ic01hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9icy1tYW5hZ2VyXCI7XG5pbXBvcnQge0V4cHJlc3Npb25zRXZhbHVhdG9yfSBmcm9tIFwiLi9leHByZXNzaW9ucy1ldmFsdWF0b3JcIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VNYW5hZ2VyfSBmcm9tIFwiLi9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4vcG9saWNpZXMvcG9saWN5XCI7XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnIHtcblxuICAgIGxvZ0xldmVsID0gbnVsbDtcblxuICAgIHJ1bGVOYW1lID0gbnVsbDtcbiAgICB3b3JrZXIgPSB7XG4gICAgICAgIGRlbGVnYXRlUmVjb21wdXRhdGlvbjpmYWxzZSxcbiAgICAgICAgdXJsOiBudWxsXG4gICAgfTtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNNYW5hZ2VyIHtcbiAgICBkYXRhO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgb3BlcmF0aW9uc01hbmFnZXI7XG4gICAgam9ic01hbmdlcjtcblxuICAgIHRyZWVWYWxpZGF0b3I7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWcsIGRhdGE9bnVsbCkge1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBuZXcgRXhwcmVzc2lvbkVuZ2luZSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gbmV3IEV4cHJlc3Npb25zRXZhbHVhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gbmV3IE9iamVjdGl2ZVJ1bGVzTWFuYWdlcih0aGlzLmRhdGEsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5jb25maWcucnVsZU5hbWUpO1xuICAgICAgICB0aGlzLm9wZXJhdGlvbnNNYW5hZ2VyID0gbmV3IE9wZXJhdGlvbnNNYW5hZ2VyKHRoaXMuZGF0YSwgdGhpcy5leHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyID0gbmV3IEpvYnNNYW5hZ2VyKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmNvbmZpZy53b3JrZXIudXJsKTtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IodGhpcy5leHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudFJ1bGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5jdXJyZW50UnVsZTtcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnJ1bihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEgfHwgdGhpcy5kYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZClcbiAgICB9XG5cbiAgICBydW5Kb2JXaXRoSW5zdGFuY2VNYW5hZ2VyKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgam9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMpLnRoZW4oamU9PntcbiAgICAgICAgICAgIHJldHVybiBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyKHRoaXMuam9ic01hbmdlciwgamUsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyk7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVzO1xuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmlzUnVsZU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgdGhpcy5jb25maWcucnVsZU5hbWUgPSBydWxlTmFtZTtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIG9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbnNNYW5hZ2VyLm9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KTtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25maWcud29ya2VyLmRlbGVnYXRlUmVjb21wdXRhdGlvbikge1xuICAgICAgICAgICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICAgIGV2YWxDb2RlOiBldmFsQ29kZSxcbiAgICAgICAgICAgICAgICAgICAgZXZhbE51bWVyaWM6IGV2YWxOdW1lcmljXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZighYWxsUnVsZXMpe1xuICAgICAgICAgICAgICAgICAgICBwYXJhbXMucnVsZU5hbWUgPSB0aGlzLmdldEN1cnJlbnRSdWxlKCkubmFtZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucnVuSm9iKFwicmVjb21wdXRlXCIsIHBhcmFtcywgdGhpcy5kYXRhLCBmYWxzZSkudGhlbigoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IGpvYkV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGF0YS51cGRhdGVGcm9tKGQpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKHRoaXMuZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZURpc3BsYXlWYWx1ZXModGhpcy5kYXRhKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIF9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcbiAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cyA9IFtdO1xuXG4gICAgICAgIGlmIChldmFsQ29kZSB8fCBldmFsTnVtZXJpYykge1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKHJvb3Q9PiB7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KSk7XG4gICAgICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLnB1c2godnIpO1xuICAgICAgICAgICAgaWYgKHZyLmlzVmFsaWQoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvL0NoZWNrcyB2YWxpZGl0eSBvZiBkYXRhIG1vZGVsIHdpdGhvdXQgcmVjb21wdXRhdGlvbiBhbmQgcmV2YWxpZGF0aW9uXG4gICAgaXNWYWxpZChkYXRhKXtcbiAgICAgICAgdmFyIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgcmV0dXJuIGRhdGEudmFsaWRhdGlvblJlc3VsdHMuZXZlcnkodnI9PnZyLmlzVmFsaWQoKSk7XG4gICAgfVxuXG4gICAgdXBkYXRlRGlzcGxheVZhbHVlcyhkYXRhLCBwb2xpY3lUb0Rpc3BsYXk9bnVsbCkge1xuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGlmKHBvbGljeVRvRGlzcGxheSl7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5KGRhdGEsIHBvbGljeVRvRGlzcGxheSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobik7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlRWRnZURpc3BsYXlWYWx1ZXMoZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobm9kZSkge1xuICAgICAgICBub2RlLiRESVNQTEFZX1ZBTFVFX05BTUVTLmZvckVhY2gobj0+bm9kZS5kaXNwbGF5VmFsdWUobiwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuKSkpO1xuICAgIH1cblxuICAgIHVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpIHtcbiAgICAgICAgZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49PmUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldEVkZ2VEaXNwbGF5VmFsdWUoZSwgbikpKTtcbiAgICB9XG5cbiAgICBkaXNwbGF5UG9saWN5KHBvbGljeVRvRGlzcGxheSwgZGF0YSkge1xuXG5cbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBlLmNsZWFyRGlzcGxheVZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2goKHJvb3QpPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKHJvb3QscG9saWN5VG9EaXNwbGF5KSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeUZvck5vZGUobm9kZSwgcG9saWN5KXtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHBvbGljeSwgbm9kZSk7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKGRlY2lzaW9uLCBub2RlLCBwb2xpY3kpO1xuICAgICAgICAgICAgaWYoZGVjaXNpb24pe1xuICAgICAgICAgICAgICAgIG5vZGUuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICB2YXIgY2hpbGRFZGdlID0gbm9kZS5jaGlsZEVkZ2VzW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgICAgIGNoaWxkRWRnZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGNoaWxkRWRnZS5jaGlsZE5vZGUsIHBvbGljeSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PnRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUoZS5jaGlsZE5vZGUsIHBvbGljeSkpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qRXZhbHVhdGVzIGNvZGUgYW5kIGV4cHJlc3Npb25zIGluIHRyZWVzKi9cbmV4cG9ydCBjbGFzcyBFeHByZXNzaW9uc0V2YWx1YXRvciB7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBjbGVhcihkYXRhKXtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGUuY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhclRyZWUoZGF0YSwgcm9vdCl7XG4gICAgICAgIGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIG4uY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlPXRydWUsIGV2YWxOdW1lcmljPXRydWUsIGluaXRTY29wZXM9ZmFsc2Upe1xuICAgICAgICBsb2cuZGVidWcoJ2V2YWxFeHByZXNzaW9ucyBldmFsQ29kZTonK2V2YWxDb2RlKycgZXZhbE51bWVyaWM6JytldmFsTnVtZXJpYyk7XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIHRoaXMuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyVHJlZShkYXRhLCBuKTtcbiAgICAgICAgICAgIHRoaXMuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBuLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsaW5pdFNjb3Blcyk7XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgZXZhbEdsb2JhbENvZGUoZGF0YSl7XG4gICAgICAgIGRhdGEuY2xlYXJFeHByZXNzaW9uU2NvcGUoKTtcbiAgICAgICAgZGF0YS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgIHRyeXtcbiAgICAgICAgICAgIGRhdGEuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChkYXRhLmNvZGUsIGZhbHNlLCBkYXRhLmV4cHJlc3Npb25TY29wZSk7XG4gICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBub2RlLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGU9ZmFsc2UpIHtcbiAgICAgICAgaWYoIW5vZGUuZXhwcmVzc2lvblNjb3BlIHx8IGluaXRTY29wZSB8fCBldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoZXZhbENvZGUpe1xuICAgICAgICAgICAgbm9kZS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgICAgICBpZihub2RlLmNvZGUpe1xuICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS4kY29kZUVycm9yID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwobm9kZS5jb2RlLCBmYWxzZSwgbm9kZS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICAgICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IGU7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZihldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB2YXIgc2NvcGUgPSBub2RlLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bT1FeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuICAgICAgICAgICAgdmFyIGhhc2hFZGdlcz0gW107XG4gICAgICAgICAgICB2YXIgaW52YWxpZFByb2IgPSBmYWxzZTtcblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKCdwYXlvZmYnLCB0cnVlLCBmYWxzZSkpe1xuICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3BheW9mZicsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsUGF5b2ZmKGUpKVxuICAgICAgICAgICAgICAgICAgICB9Y2F0Y2ggKGVycil7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyAgIExlZnQgZW1wdHkgaW50ZW50aW9uYWxseVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMucHVzaChlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaGFzQXNzaWdubWVudEV4cHJlc3Npb24oZS5wcm9iYWJpbGl0eSkpeyAvL0l0IHNob3VsZCBub3Qgb2NjdXIgaGVyZSFcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiZXZhbEV4cHJlc3Npb25zRm9yTm9kZSBoYXNBc3NpZ25tZW50RXhwcmVzc2lvbiFcIiwgZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKCdwcm9iYWJpbGl0eScsIHRydWUsIGZhbHNlKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByb2IgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChlLnByb2JhYmlsaXR5LCB0cnVlLCBzY29wZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnZhbGlkUHJvYiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH0pO1xuXG5cbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICB2YXIgY29tcHV0ZUhhc2ggPSBoYXNoRWRnZXMubGVuZ3RoICYmICFpbnZhbGlkUHJvYiAmJiAocHJvYmFiaWxpdHlTdW0uY29tcGFyZSgwKSA+PSAwICYmIHByb2JhYmlsaXR5U3VtLmNvbXBhcmUoMSkgPD0gMCk7XG5cbiAgICAgICAgICAgICAgICBpZihjb21wdXRlSGFzaCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaGFzaCA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoMSwgcHJvYmFiaWxpdHlTdW0pLCBoYXNoRWRnZXMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgaGFzaEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncHJvYmFiaWxpdHknLCBoYXNoKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgdGhpcy5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIGUuY2hpbGROb2RlLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsIGluaXRTY29wZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSl7XG4gICAgICAgIHZhciBwYXJlbnQgPSBub2RlLiRwYXJlbnQ7XG4gICAgICAgIHZhciBwYXJlbnRTY29wZSA9IHBhcmVudD9wYXJlbnQuZXhwcmVzc2lvblNjb3BlIDogZGF0YS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgIG5vZGUuZXhwcmVzc2lvblNjb3BlID0gVXRpbHMuY2xvbmVEZWVwKHBhcmVudFNjb3BlKTtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1lbmdpbmUnXG5leHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9leHByZXNzaW9ucy1ldmFsdWF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYnMvaW5kZXgnXG5cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJudW1iZXJPZlJ1bnNcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID4gMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZm9ybXVsYVwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTilcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7UHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuLi9zZW5zaXRpdml0eS1hbmFseXNpcy9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4uL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwicHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBQcmVwYXJlVmFyaWFibGVzU3RlcChleHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLCBqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcChqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgQ2FsY3VsYXRlU3RlcChqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIFByZXBhcmVWYXJpYWJsZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcInByZXBhcmVfdmFyaWFibGVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcblxuICAgICAgICBmb3IodmFyIHJ1bkluZGV4PTA7IHJ1bkluZGV4PG51bWJlck9mUnVuczsgcnVuSW5kZXgrKyl7XG4gICAgICAgICAgICB2YXIgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICAgICAgdmFyIGV2YWx1YXRlZCA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKHYuZm9ybXVsYSwgdHJ1ZSwgVXRpbHMuY2xvbmVEZWVwKGRhdGEuZXhwcmVzc2lvblNjb3BlKSk7XG4gICAgICAgICAgICAgICAgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZXZhbHVhdGVkKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQuZGF0YT17XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlczogdmFyaWFibGVWYWx1ZXNcbiAgICAgICAgfTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChtYXgsIG1pbik7XG4gICAgICAgIHZhciBzdGVwID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoZXh0ZW50LGxlbmd0aCAtIDEpO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW21pbl07XG4gICAgICAgIHZhciBjdXJyID0gbWluO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoIC0gMjsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoY3Vyciwgc3RlcCk7XG4gICAgICAgICAgICByZXN1bHQucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoY3VycikpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdC5wdXNoKG1heCk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgUmVjb21wdXRlSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAwKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV2YWxDb2RlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXZhbE51bWVyaWNcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBydWxlTmFtZTogbnVsbCwgLy9yZWNvbXB1dGUgYWxsIHJ1bGVzXG4gICAgICAgICAgICBldmFsQ29kZTogdHJ1ZSxcbiAgICAgICAgICAgIGV2YWxOdW1lcmljOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7UmVjb21wdXRlSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcmVjb21wdXRlLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2JcIjtcblxuZXhwb3J0IGNsYXNzIFJlY29tcHV0ZUpvYiBleHRlbmRzIEpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwicmVjb21wdXRlXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmlzUmVzdGFydGFibGUgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkYXRhID0gZXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IGV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGFsbFJ1bGVzID0gIXJ1bGVOYW1lO1xuICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBwYXJhbXMudmFsdWUoXCJldmFsQ29kZVwiKSwgcGFyYW1zLnZhbHVlKFwiZXZhbE51bWVyaWNcIikpXG4gICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgfVxuXG4gICAgY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKSB7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZihldmFsQ29kZXx8ZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKHJvb3Q9PiB7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KSk7XG4gICAgICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLnB1c2godnIpO1xuICAgICAgICAgICAgaWYgKHZyLmlzVmFsaWQoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFJlY29tcHV0ZUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPD0gdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7UHJlcGFyZVZhcmlhYmxlc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXBcIjtcbmltcG9ydCB7SW5pdFBvbGljaWVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5cblxuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInNlbnNpdGl2aXR5LWFuYWx5c2lzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKGpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDYWxjdWxhdGVTdGVwKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIDUpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuXG5cbiAgICAgICAgaWYgKCFqb2JSZXN1bHQuZGF0YS5oZWFkZXJzKSB7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5J107XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2gobj0+aGVhZGVycy5wdXNoKG4pKTtcbiAgICAgICAgICAgIGhlYWRlcnMucHVzaCgncGF5b2ZmJyk7XG5cbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG5cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG4gICAgICAgIHZhcmlhYmxlTmFtZXMuZm9yRWFjaCgodmFyaWFibGVOYW1lLCBpKT0+IHtcbiAgICAgICAgICAgIGRhdGEuZXhwcmVzc2lvblNjb3BlW3ZhcmlhYmxlTmFtZV0gPSBpdGVtW2ldO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcblxuICAgICAgICB2YXIgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG4gICAgICAgIHZhciBwYXlvZmZzID0gW107XG4gICAgICAgIHZhciBkYXRhTGlzdCA9IFtdO1xuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKHBvbGljeT0+IHtcbiAgICAgICAgICAgIHZhciBwYXlvZmYgPSAnbi9hJztcbiAgICAgICAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgICAgIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICBwYXlvZmZzLnB1c2gocGF5b2ZmKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGRhdGFMaXN0OiBkYXRhTGlzdCxcbiAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgIHZhcmlhYmxlczogaXRlbSxcbiAgICAgICAgICAgIHBheW9mZnM6IHBheW9mZnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbiA9IHBhcmFtcy52YWx1ZShcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIik7XG5cbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtPT4ge1xuICAgICAgICAgICAgaWYgKCFpdGVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksIGkpPT4ge1xuICAgICAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKV07XG4gICAgICAgICAgICAgICAgaXRlbS52YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgICAgICAgICByb3dDZWxscy5wdXNoKHRoaXMudG9GbG9hdCh2KSlcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gaXRlbS5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgICAgIHJvd0NlbGxzLnB1c2goVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSA/IHBheW9mZiA6IHRoaXMudG9GbG9hdChwYXlvZmYpKTtcbiAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICBjZWxsczogcm93Q2VsbHMsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBpLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKHJvdyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBkZWxldGUgam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcblxuZXhwb3J0IGNsYXNzIEluaXRQb2xpY2llc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiaW5pdF9wb2xpY2llc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWNpZXNcIiwgcG9saWNpZXMpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcyA9IHBvbGljaWVzO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIFByZXBhcmVWYXJpYWJsZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihcInByZXBhcmVfdmFyaWFibGVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuXG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXMucHVzaCh0aGlzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhcmlhYmxlVmFsdWVzID0gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGE9e1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXM6IHZhcmlhYmxlVmFsdWVzXG4gICAgICAgIH07XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBzZXF1ZW5jZShtaW4sIG1heCwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBleHRlbnQgPSBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KG1heCwgbWluKTtcbiAgICAgICAgdmFyIHN0ZXAgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShleHRlbnQsbGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgPSBFeHByZXNzaW9uRW5naW5lLmFkZChjdXJyLCBzdGVwKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChjdXJyKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCAxKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG4gICAgICAgIHZhciBkZWZhdWx0VmFsdWVzID0ge307XG4gICAgICAgIFV0aWxzLmZvck93bihkYXRhLmV4cHJlc3Npb25TY29wZSwgKHYsayk9PntcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXNba109dGhpcy50b0Zsb2F0KHYpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeSddO1xuICAgICAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKG49PmhlYWRlcnMucHVzaChuKSk7XG4gICAgICAgICAgICBoZWFkZXJzLnB1c2goJ3BheW9mZicpO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICAgICAgaGVhZGVyczpoZWFkZXJzLFxuICAgICAgICAgICAgICAgIHJvd3M6IFtdLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlTmFtZXM6IHZhcmlhYmxlTmFtZXMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlczogZGVmYXVsdFZhbHVlcyxcbiAgICAgICAgICAgICAgICBwb2xpY2llczogam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJwb2xpY2llc1wiKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSkge1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGl0ZW1JbmRleCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWUgPSB2YXJpYWJsZU5hbWVzW2l0ZW1JbmRleF07XG5cblxuXG4gICAgICAgIHZhciByZXN1bHRzID0gW11cblxuICAgICAgICBpdGVtLmZvckVhY2godmFyaWFibGVWYWx1ZT0+e1xuXG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcblxuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IHZhcmlhYmxlVmFsdWU7XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuICAgICAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgICAgICBpZighdmFsaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UpO1xuICAgICAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290LCBydWxlTmFtZSk7XG4gICAgICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuICAgICAgICAgICAgdmFyIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcblxuXG4gICAgICAgICAgICB2YXIgciA9IHtcbiAgICAgICAgICAgICAgICBwb2xpY2llczogcG9saWNpZXMsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lOiB2YXJpYWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVJbmRleDogaXRlbUluZGV4LFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlVmFsdWU6IHZhcmlhYmxlVmFsdWUsXG4gICAgICAgICAgICAgICAgcGF5b2ZmOiBwYXlvZmZcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXN1bHRzLnB1c2gocilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG5cbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuXG4gICAgICAgIHZhciBwb2xpY3lCeUtleSA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljeUJ5S2V5XCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW1zV3JhcHBlcj0+e1xuICAgICAgICAgICAgaWYoIWl0ZW1zV3JhcHBlcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpdGVtc1dyYXBwZXIuZm9yRWFjaChpdGVtPT57XG4gICAgICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3kpPT57XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW1BvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3kpXTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2KT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbHVlID0gXCJkZWZhdWx0XCI7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZih2ID09IGl0ZW0udmFyaWFibGVOYW1lKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHRoaXMudG9GbG9hdChpdGVtLnZhcmlhYmxlVmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWVsc2UgaWYoam9iUmVzdWx0LmRhdGEuZGVmYXVsdFZhbHVlcy5oYXNPd25Qcm9wZXJ0eSh2KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBqb2JSZXN1bHQuZGF0YS5kZWZhdWx0VmFsdWVzW3ZdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaCh2YWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBpdGVtLnBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaChVdGlscy5pc1N0cmluZyhwYXlvZmYpPyBwYXlvZmY6IHRoaXMudG9GbG9hdChwYXlvZmYpKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvdyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNlbGxzOiByb3dDZWxscyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBwb2xpY2llcy5pbmRleE9mKHBvbGljeUJ5S2V5W3BvbGljeS5rZXldKSxcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKHJvdyk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCByZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWN5QnlLZXlcIiwgVXRpbHMuZ2V0T2JqZWN0QnlJZE1hcChwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcywgbnVsbCwgJ2tleScpKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHRoaXMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJ2YXJpYWJsZVZhbHVlc1wiLCB2YXJpYWJsZVZhbHVlcyk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIHNlcXVlbmNlKG1pbiwgbWF4LCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGV4dGVudCA9IG1heCAtIG1pbjtcbiAgICAgICAgdmFyIHN0ZXAgPSBleHRlbnQgLyAobGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgKz0gc3RlcDtcblxuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUucm91bmQoY3VyciwgMTYpKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPD0gdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi90b3JuYWRvLWRpYWdyYW0tam9iLXBhcmFtZXRlcnNcIjtcblxuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJ0b3JuYWRvLWRpYWdyYW1cIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENhbGN1bGF0ZVN0ZXAoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuXG4vKmpvYiBzdGVwIHRoYXQgcHJvY2VzcyBiYXRjaCBvZiBpdGVtcyovXG5leHBvcnQgY2xhc3MgQmF0Y2hTdGVwIGV4dGVuZHMgU3RlcCB7XG5cbiAgICBjaHVua1NpemU7XG4gICAgc3RhdGljIENVUlJFTlRfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfY3VycmVudF9pdGVtX2NvdW50JztcbiAgICBzdGF0aWMgVE9UQUxfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfdG90YWxfaXRlbV9jb3VudCc7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBjaHVua1NpemUpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuY2h1bmtTaXplID0gY2h1bmtTaXplO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHN0ZXAgaW5pdGlhbGl6YXRpb24uIFNob3VsZCByZXR1cm4gdG90YWwgaXRlbSBjb3VudFxuICAgICAqL1xuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLmluaXQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcmVhZCBhbmQgcmV0dXJuIGNodW5rIG9mIGl0ZW1zIHRvIHByb2Nlc3NcbiAgICAgKi9cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnJlYWROZXh0Q2h1bmsgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvY2VzcyBzaW5nbGUgaXRlbVxuICAgICAqIE11c3QgcmV0dXJuIHByb2Nlc3NlZCBpdGVtIHdoaWNoIHdpbGwgYmUgcGFzc2VkIGluIGEgY2h1bmsgdG8gd3JpdGVDaHVuayBmdW5jdGlvblxuICAgICAqL1xuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5wcm9jZXNzSXRlbSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byB3cml0ZSBjaHVuayBvZiBpdGVtcy4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gcG9zdHByb2Nlc3NpbmcgYWZ0ZXIgYWxsIGl0ZW1zIGhhdmUgYmVlbiBwcm9jZXNzZWQuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuXG4gICAgc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QKTtcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCkgfHwgMDtcbiAgICB9XG5cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBpbml0aWFsaXplIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pLnRoZW4odG90YWxJdGVtQ291bnQ9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdG90YWxJdGVtQ291bnQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGlmKCEoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSl7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcG9zdFByb2Nlc3MgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIGhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGN1cnJlbnRJdGVtQ291bnQgPSB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciB0b3RhbEl0ZW1Db3VudCA9IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBjaHVua1NpemUgPSBNYXRoLm1pbih0aGlzLmNodW5rU2l6ZSwgdG90YWxJdGVtQ291bnQgLSBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgaWYgKGN1cnJlbnRJdGVtQ291bnQgPj0gdG90YWxJdGVtQ291bnQpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50LCBjaHVua1NpemUsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHJlYWQgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pLnRoZW4oY2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcHJvY2VzcyBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKHByb2Nlc3NlZENodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIHByb2Nlc3NlZENodW5rLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byB3cml0ZSBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKChyZXMpPT4ge1xuICAgICAgICAgICAgY3VycmVudEl0ZW1Db3VudCArPSBjaHVua1NpemU7XG4gICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHsgLy9UT0RPIHByb21pc2lmeVxuICAgICAgICByZXR1cm4gY2h1bmsubWFwKChpdGVtLCBpKT0+dGhpcy5wcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50K2ksIGpvYlJlc3VsdCkpO1xuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCwgcHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmNoZWNrRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjbGFzcyBFeHRlbmRhYmxlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgICAgICBzdXBlcihtZXNzYWdlKTtcbiAgICAgICAgdGhpcy5uYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgICAgICBpZiAodHlwZW9mIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCB0aGlzLmNvbnN0cnVjdG9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuc3RhY2sgPSAobmV3IEVycm9yKG1lc3NhZ2UpKS5zdGFjaztcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vZXh0ZW5kYWJsZS1lcnJvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlLWFscmVhZHktY29tcGxldGUtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXJlc3RhcnQtZXhjZXB0aW9uJ1xuXG5cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iRGF0YUludmFsaWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYlJlc3RhcnRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBFeGVjdXRpb25Db250ZXh0IHtcblxuICAgIGRpcnR5ID0gZmFsc2U7XG4gICAgY29udGV4dCA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoY29udGV4dCkge1xuICAgICAgICBpZiAoY29udGV4dCkge1xuICAgICAgICAgICAgdGhpcy5jb250ZXh0ID0gVXRpbHMuY2xvbmUoY29udGV4dClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1dChrZXksIHZhbHVlKSB7XG4gICAgICAgIHZhciBwcmV2VmFsdWUgPSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICAgICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHZhciByZXN1bHQgPSB0aGlzLmNvbnRleHRba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5kaXJ0eSA9IHByZXZWYWx1ZSA9PSBudWxsIHx8IHByZXZWYWx1ZSAhPSBudWxsICYmIHByZXZWYWx1ZSAhPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICAgICAgICAgIHRoaXMuZGlydHkgPSBwcmV2VmFsdWUgIT0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldChrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dFtrZXldO1xuICAgIH1cblxuICAgIGNvbnRhaW5zS2V5KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb250ZXh0Lmhhc093blByb3BlcnR5KGtleSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKGtleSkge1xuICAgICAgICBkZWxldGUgdGhpcy5jb250ZXh0W2tleV07XG4gICAgfVxuXG4gICAgc2V0RGF0YShkYXRhKSB7IC8vc2V0IGRhdGEgbW9kZWxcbiAgICAgICAgcmV0dXJuIHRoaXMucHV0KFwiZGF0YVwiLCBkYXRhKTtcbiAgICB9XG5cbiAgICBnZXREYXRhKCkgeyAvLyBnZXQgZGF0YSBtb2RlbFxuICAgICAgICByZXR1cm4gdGhpcy5nZXQoXCJkYXRhXCIpO1xuICAgIH1cblxuICAgIGdldERUTygpIHtcbiAgICAgICAgdmFyIGR0byA9IFV0aWxzLmNsb25lRGVlcCh0aGlzKTtcbiAgICAgICAgdmFyIGRhdGEgPSB0aGlzLmdldERhdGEoKTtcbiAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgIGRhdGEgPSBkYXRhLmdldERUTygpO1xuICAgICAgICAgICAgZHRvLmNvbnRleHRbXCJkYXRhXCJdID0gZGF0YTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxufVxuIiwiaW1wb3J0ICogYXMgZXhjZXB0aW9ucyBmcm9tICcuL2V4Y2VwdGlvbnMnXG5cbmV4cG9ydCB7ZXhjZXB0aW9uc31cbmV4cG9ydCAqIGZyb20gJy4vZXhlY3V0aW9uLWNvbnRleHQnXG5leHBvcnQgKiBmcm9tICcuL2pvYidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1mbGFnJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1rZXktZ2VuZXJhdG9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItbGF1bmNoZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlcnMnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1zdGF0dXMnXG5leHBvcnQgKiBmcm9tICcuL3NpbXBsZS1qb2InXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAnXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAtZXhlY3V0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwLWV4ZWN1dGlvbi1saXN0ZW5lcidcblxuXG5cblxuIiwiZXhwb3J0IGNvbnN0IEpPQl9FWEVDVVRJT05fRkxBRyA9IHtcbiAgICBTVE9QOiAnU1RPUCdcbn07XG4iLCJleHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuICAgIC8qQ2FsbGVkIGJlZm9yZSBhIGpvYiBleGVjdXRlcyovXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxuXG4gICAgLypDYWxsZWQgYWZ0ZXIgY29tcGxldGlvbiBvZiBhIGpvYi4gQ2FsbGVkIGFmdGVyIGJvdGggc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV4ZWN1dGlvbnMqL1xuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcblxuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgZXhlY3V0aW9uIG9mIGEgam9iLiovXG5leHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uIHtcbiAgICBpZDtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBqb2JQYXJhbWV0ZXJzO1xuICAgIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5VTktOT1dOO1xuICAgIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuXG4gICAgc3RhcnRUaW1lID0gbnVsbDtcbiAgICBjcmVhdGVUaW1lID0gbmV3IERhdGUoKTtcbiAgICBlbmRUaW1lID0gbnVsbDtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICBmYWlsdXJlRXhjZXB0aW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3Ioam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMsIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlO1xuICAgICAgICB0aGlzLmpvYlBhcmFtZXRlcnMgPSBqb2JQYXJhbWV0ZXJzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgc3RlcCBleGVjdXRpb24gd2l0aCB0aGUgY3VycmVudCBqb2IgZXhlY3V0aW9uLlxuICAgICAqIEBwYXJhbSBzdGVwTmFtZSB0aGUgbmFtZSBvZiB0aGUgc3RlcCB0aGUgbmV3IGV4ZWN1dGlvbiBpcyBhc3NvY2lhdGVkIHdpdGhcbiAgICAgKi9cbiAgICBjcmVhdGVTdGVwRXhlY3V0aW9uKHN0ZXBOYW1lKSB7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uID0gbmV3IFN0ZXBFeGVjdXRpb24oc3RlcE5hbWUsIHRoaXMpO1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGlzUnVubmluZygpIHtcbiAgICAgICAgcmV0dXJuICF0aGlzLmVuZFRpbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGVzdCBpZiB0aGlzIEpvYkV4ZWN1dGlvbiBoYXMgYmVlbiBzaWduYWxsZWQgdG9cbiAgICAgKiBzdG9wLlxuICAgICAqL1xuICAgIGlzU3RvcHBpbmcoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTaWduYWwgdGhlIEpvYkV4ZWN1dGlvbiB0byBzdG9wLlxuICAgICAqL1xuICAgIHN0b3AoKSB7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzZT0+IHtcbiAgICAgICAgICAgIHNlLnRlcm1pbmF0ZU9ubHkgPSB0cnVlO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgIH1cblxuICAgIGdldERhdGEoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGlvbkNvbnRleHQuZ2V0RGF0YSgpO1xuICAgIH1cblxuICAgIGdldERUTyhmaWx0ZXJlZFByb3BlcnRpZXMgPSBbXSwgZGVlcENsb25lID0gdHJ1ZSkge1xuICAgICAgICB2YXIgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZURlZXBXaXRoO1xuICAgICAgICBpZiAoIWRlZXBDbG9uZSkge1xuICAgICAgICAgICAgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZVdpdGg7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuYXNzaWduKHt9LCBjbG9uZU1ldGhvZCh0aGlzLCAodmFsdWUsIGtleSwgb2JqZWN0LCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoZmlsdGVyZWRQcm9wZXJ0aWVzLmluZGV4T2Yoa2V5KSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChbXCJqb2JQYXJhbWV0ZXJzXCIsIFwiZXhlY3V0aW9uQ29udGV4dFwiXS5pbmRleE9mKGtleSkgPiAtMSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gVXRpbHMuZ2V0RXJyb3JEVE8odmFsdWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTyhbXCJqb2JFeGVjdXRpb25cIl0sIGRlZXBDbG9uZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpXG4gICAgfVxufVxuIiwiLyogb2JqZWN0IHJlcHJlc2VudGluZyBhIHVuaXF1ZWx5IGlkZW50aWZpYWJsZSBqb2IgcnVuLiBKb2JJbnN0YW5jZSBjYW4gYmUgcmVzdGFydGVkIG11bHRpcGxlIHRpbWVzIGluIGNhc2Ugb2YgZXhlY3V0aW9uIGZhaWx1cmUgYW5kIGl0J3MgbGlmZWN5Y2xlIGVuZHMgd2l0aCBmaXJzdCBzdWNjZXNzZnVsIGV4ZWN1dGlvbiovXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2V7XG5cbiAgICBpZDtcbiAgICBqb2JOYW1lO1xuICAgIGNvbnN0cnVjdG9yKGlkLCBqb2JOYW1lKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmpvYk5hbWUgPSBqb2JOYW1lO1xuICAgIH1cblxufVxuIiwiXG5leHBvcnQgY2xhc3MgSm9iS2V5R2VuZXJhdG9yIHtcbiAgICAvKk1ldGhvZCB0byBnZW5lcmF0ZSB0aGUgdW5pcXVlIGtleSB1c2VkIHRvIGlkZW50aWZ5IGEgam9iIGluc3RhbmNlLiovXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFwiXCI7XG4gICAgICAgIGpvYlBhcmFtZXRlcnMuZGVmaW5pdGlvbnMuZm9yRWFjaCgoZCwgaSk9PiB7XG4gICAgICAgICAgICBpZihkLmlkZW50aWZ5aW5nKXtcbiAgICAgICAgICAgICAgICByZXN1bHQgKz0gZC5uYW1lICsgXCI9XCIgKyBqb2JQYXJhbWV0ZXJzLnZhbHVlc1tkLm5hbWVdICsgXCI7XCI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVzdGFydEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcblxuZXhwb3J0IGNsYXNzIEpvYkxhdW5jaGVyIHtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG4gICAgam9iV29ya2VyO1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgam9iV29ya2VyLCBkYXRhTW9kZWxTZXJpYWxpemVyKSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgICAgIHRoaXMuam9iV29ya2VyID0gam9iV29ya2VyO1xuICAgICAgICB0aGlzLmRhdGFNb2RlbFNlcmlhbGl6ZXIgPSBkYXRhTW9kZWxTZXJpYWxpemVyO1xuICAgIH1cblxuXG4gICAgcnVuKGpvYk9yTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHZhciBqb2I7XG4gICAgICAgIHZhciBqb2JQYXJhbWV0ZXJzO1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgaWYgKFV0aWxzLmlzU3RyaW5nKGpvYk9yTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk9yTmFtZSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgam9iID0gam9iT3JOYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFqb2IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIk5vIHN1Y2ggam9iOiBcIiArIGpvYk9yTmFtZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGpvYlBhcmFtZXRlcnMgPSBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzVmFsdWVzKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGUoam9iLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKTtcbiAgICAgICAgfSkudGhlbih2YWxpZD0+e1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5jcmVhdGVKb2JFeGVjdXRpb24oam9iLm5hbWUsIGpvYlBhcmFtZXRlcnMsIGRhdGEpLnRoZW4oam9iRXhlY3V0aW9uPT57XG5cblxuICAgICAgICAgICAgICAgIGlmKHRoaXMuam9iV29ya2VyKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iOiBbXCIgKyBqb2IubmFtZSArIFwiXSBleGVjdXRpb24gW1wiK2pvYkV4ZWN1dGlvbi5pZCtcIl0gZGVsZWdhdGVkIHRvIHdvcmtlclwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JXb3JrZXIuZXhlY3V0ZUpvYihqb2JFeGVjdXRpb24uaWQpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBleGVjdXRpb25Qcm9taXNlID0gdGhpcy5fZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgaWYocmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uUHJvbWlzZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdmFsaWRhdGUoam9iLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYi5uYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKGxhc3RFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChsYXN0RXhlY3V0aW9uICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWpvYi5pc1Jlc3RhcnRhYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iSW5zdGFuY2UgYWxyZWFkeSBleGlzdHMgYW5kIGlzIG5vdCByZXN0YXJ0YWJsZVwiKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBsYXN0RXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZvckVhY2goZXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlVOS05PV04pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiU3RlcCBbXCIgKyBleGVjdXRpb24uc3RlcE5hbWUgKyBcIl0gaXMgb2Ygc3RhdHVzIFVOS05PV05cIik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChqb2Iuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciAmJiAham9iLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IudmFsaWRhdGUoam9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBwYXJhbWV0ZXJzIGluIGpvYkxhdW5jaGVyLnJ1biBmb3Igam9iOiBcIitqb2IubmFtZSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoam9iLmpvYkRhdGFWYWxpZGF0b3IgJiYgIWpvYi5qb2JEYXRhVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEpKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRGF0YUludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBkYXRhIGluIGpvYkxhdW5jaGVyLnJ1biBmb3Igam9iOiBcIitqb2IubmFtZSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqRXhlY3V0ZSBwcmV2aW91c2x5IGNyZWF0ZWQgam9iIGV4ZWN1dGlvbiovXG4gICAgZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKXtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgaWYoVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpe1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChqb2JFeGVjdXRpb25PcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICB9KS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoIWpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gW1wiICsgam9iRXhlY3V0aW9uT3JJZCArIFwiXSBpcyBub3QgZm91bmRcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24uc3RhdHVzICE9PSBKT0JfU1RBVFVTLlNUQVJUSU5HKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gW1wiICsgam9iRXhlY3V0aW9uLmlkICsgXCJdIGFscmVhZHkgc3RhcnRlZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGpvYk5hbWUgPSBqb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZTtcbiAgICAgICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgICAgICAgICAgaWYoIWpvYil7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJObyBzdWNoIGpvYjogXCIgKyBqb2JOYW1lKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuICB0aGlzLl9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBfZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHZhciBqb2JOYW1lID0gam9iLm5hbWU7XG4gICAgICAgIGxvZy5pbmZvKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGxhdW5jaGVkIHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXVwiLCBqb2JFeGVjdXRpb24uZ2V0RGF0YSgpKTtcbiAgICAgICAgcmV0dXJuIGpvYi5leGVjdXRlKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGxvZy5pbmZvKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGNvbXBsZXRlZCB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl0gYW5kIHRoZSBmb2xsb3dpbmcgc3RhdHVzOiBbXCIgKyBqb2JFeGVjdXRpb24uc3RhdHVzICsgXCJdXCIpO1xuICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgfSkuY2F0Y2goZSA9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBmYWlsZWQgdW5leHBlY3RlZGx5IGFuZCBmYXRhbGx5IHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXVwiLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5leHBvcnQgY29uc3QgUEFSQU1FVEVSX1RZUEUgPSB7XG4gICAgU1RSSU5HOiAnU1RSSU5HJyxcbiAgICBEQVRFOiAnREFURScsXG4gICAgSU5URUdFUjogJ0lOVEVHRVInLFxuICAgIE5VTUJFUjogJ0ZMT0FUJyxcbiAgICBCT09MRUFOOiAnQk9PTEVBTicsXG4gICAgTlVNQkVSX0VYUFJFU1NJT046ICdOVU1CRVJfRVhQUkVTU0lPTicsXG4gICAgQ09NUE9TSVRFOiAnQ09NUE9TSVRFJyAvL2NvbXBvc2l0ZSBwYXJhbWV0ZXIgd2l0aCBuZXN0ZWQgc3VicGFyYW1ldGVyc1xufTtcblxuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlckRlZmluaXRpb24ge1xuICAgIG5hbWU7XG4gICAgdHlwZTtcbiAgICBuZXN0ZWRQYXJhbWV0ZXJzID0gW107XG4gICAgbWluT2NjdXJzO1xuICAgIG1heE9jY3VycztcbiAgICByZXF1aXJlZCA9IHRydWU7XG5cbiAgICBpZGVudGlmeWluZztcbiAgICB2YWxpZGF0b3I7XG4gICAgc2luZ2xlVmFsdWVWYWxpZGF0b3I7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnMsIG1pbk9jY3VycyA9IDEsIG1heE9jY3VycyA9IDEsIGlkZW50aWZ5aW5nID0gZmFsc2UsIHNpbmdsZVZhbHVlVmFsaWRhdG9yID0gbnVsbCwgdmFsaWRhdG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICBpZiAoVXRpbHMuaXNBcnJheSh0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnMpKSB7XG4gICAgICAgICAgICB0aGlzLnR5cGUgPSBQQVJBTUVURVJfVFlQRS5DT01QT1NJVEU7XG4gICAgICAgICAgICB0aGlzLm5lc3RlZFBhcmFtZXRlcnMgPSB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnM7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnR5cGUgPSB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52YWxpZGF0b3IgPSB2YWxpZGF0b3I7XG4gICAgICAgIHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IgPSBzaW5nbGVWYWx1ZVZhbGlkYXRvcjtcbiAgICAgICAgdGhpcy5pZGVudGlmeWluZyA9IGlkZW50aWZ5aW5nO1xuICAgICAgICB0aGlzLm1pbk9jY3VycyA9IG1pbk9jY3VycztcbiAgICAgICAgdGhpcy5tYXhPY2N1cnMgPSBtYXhPY2N1cnM7XG4gICAgfVxuXG4gICAgc2V0KGtleSwgdmFsKSB7XG4gICAgICAgIHRoaXNba2V5XSA9IHZhbDtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpIHtcbiAgICAgICAgdmFyIGlzQXJyYXkgPSBVdGlscy5pc0FycmF5KHZhbHVlKTtcblxuICAgICAgICBpZiAodGhpcy5tYXhPY2N1cnMgPiAxICYmICFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUubGVuZ3RoIDwgdGhpcy5taW5PY2N1cnMgfHwgdmFsdWUubGVuZ3RoID4gdGhpcy5tYXhPY2N1cnMpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdmFsdWUuZXZlcnkodGhpcy52YWxpZGF0ZVNpbmdsZVZhbHVlLCB0aGlzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMudmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IodmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVTaW5nbGVWYWx1ZSh2YWx1ZSkge1xuICAgICAgICBpZiAoKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpICYmIHRoaXMubWluT2NjdXJzID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCAmJiAoIXZhbHVlICYmIHZhbHVlICE9PSAwICYmIHZhbHVlICE9PSBmYWxzZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5TVFJJTkcgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkRBVEUgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5JTlRFR0VSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzSW50KHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNOdW1iZXIodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIGlmICghVXRpbHMuaXNPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLm5lc3RlZFBhcmFtZXRlcnMuZXZlcnkoKG5lc3RlZERlZiwgaSk9Pm5lc3RlZERlZi52YWxpZGF0ZSh2YWx1ZVtuZXN0ZWREZWYubmFtZV0pKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvcih2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1BBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc3tcbiAgICBkZWZpbml0aW9ucyA9IFtdO1xuICAgIHZhbHVlcz17fTtcblxuICAgIGNvbnN0cnVjdG9yKHZhbHVlcyl7XG4gICAgICAgIHRoaXMuaW5pdERlZmluaXRpb25zKCk7XG4gICAgICAgIHRoaXMuaW5pdERlZmF1bHRWYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLnZhbHVlcywgdmFsdWVzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXREZWZpbml0aW9ucygpe1xuXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKXtcblxuICAgIH1cblxuICAgIHZhbGlkYXRlKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmRlZmluaXRpb25zLmV2ZXJ5KChkZWYsIGkpPT5kZWYudmFsaWRhdGUodGhpcy52YWx1ZXNbZGVmLm5hbWVdKSk7XG4gICAgfVxuXG4gICAgLypnZXQgb3Igc2V0IHZhbHVlIGJ5IHBhdGgqL1xuICAgIHZhbHVlKHBhdGgsIHZhbHVlKXtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiAgVXRpbHMuZ2V0KHRoaXMudmFsdWVzLCBwYXRoLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBVdGlscy5zZXQodGhpcy52YWx1ZXMsIHBhdGgsIHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHRvU3RyaW5nKCl7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIkpvYlBhcmFtZXRlcnNbXCI7XG5cbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcblxuICAgICAgICAgICAgdmFyIHZhbCA9IHRoaXMudmFsdWVzW2QubmFtZV07XG4gICAgICAgICAgICAvLyBpZihVdGlscy5pc0FycmF5KHZhbCkpe1xuICAgICAgICAgICAgLy8gICAgIHZhciB2YWx1ZXMgPSB2YWw7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIC8vIGlmKFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURSA9PSBkLnR5cGUpe1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiK3ZhbCArIFwiO1wiO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVzdWx0Kz1cIl1cIjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBnZXREVE8oKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlczogdGhpcy52YWx1ZXNcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7ZGVmYXVsdCBhcyBpZGJ9IGZyb20gXCJpZGJcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcblxuLyogSW5kZXhlZERCIGpvYiByZXBvc2l0b3J5Ki9cbmV4cG9ydCBjbGFzcyBJZGJKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBkYlByb21pc2U7XG4gICAgam9iSW5zdGFuY2VEYW87XG4gICAgam9iRXhlY3V0aW9uRGFvO1xuICAgIHN0ZXBFeGVjdXRpb25EYW87XG4gICAgam9iUmVzdWx0RGFvO1xuICAgIGpvYkV4ZWN1dGlvblByb2dyZXNzRGFvO1xuICAgIGpvYkV4ZWN1dGlvbkZsYWdEYW87XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc1Jldml2ZXIsIGRiTmFtZSA9J3NkLWpvYi1yZXBvc2l0b3J5JywgZGVsZXRlREI9ZmFsc2UpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5kYk5hbWU9ZGJOYW1lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zUmV2aXZlciA9IGV4cHJlc3Npb25zUmV2aXZlcjtcbiAgICAgICAgaWYoZGVsZXRlREIpe1xuICAgICAgICAgICAgdGhpcy5kZWxldGVEQigpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICB0aGlzLmluaXREQigpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgfVxuXG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZURhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWluc3RhbmNlcycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb25zJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tZmxhZ3MnLCB0aGlzLmRiUHJvbWlzZSk7XG5cbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9uRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdzdGVwLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0RGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItcmVzdWx0cycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICB9XG5cbiAgICBpbml0REIoKXtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBpZGIub3Blbih0aGlzLmRiTmFtZSwgMSwgdXBncmFkZURCID0+IHtcbiAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWluc3RhbmNlcycpO1xuICAgICAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbnNPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7IHVuaXF1ZTogZmFsc2UgfSk7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJjcmVhdGVUaW1lXCIsIFwiY3JlYXRlVGltZVwiLCB7IHVuaXF1ZTogZmFsc2UgfSk7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJzdGF0dXNcIiwgXCJzdGF0dXNcIiwgeyB1bmlxdWU6IGZhbHNlIH0pO1xuICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJyk7XG4gICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tZmxhZ3MnKTtcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdzdGVwLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBcImpvYkV4ZWN1dGlvbklkXCIsIHsgdW5pcXVlOiBmYWxzZSB9KTtcblxuICAgICAgICAgICAgdmFyIGpvYlJlc3VsdE9TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItcmVzdWx0cycpO1xuICAgICAgICAgICAgam9iUmVzdWx0T1MuY3JlYXRlSW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIFwiam9iSW5zdGFuY2UuaWRcIiwgeyB1bmlxdWU6IHRydWUgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGRlbGV0ZURCKCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKF89PmlkYi5kZWxldGUodGhpcy5kYk5hbWUpKTtcbiAgICB9XG5cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXQoam9iUmVzdWx0SWQpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uZ2V0QnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5zZXQoam9iUmVzdWx0LmlkLCBqb2JSZXN1bHQpLnRoZW4ocj0+am9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5nZXQoa2V5KS50aGVuKGR0bz0+ZHRvID8gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8pOiBkdG8pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5zZXQoa2V5LCBqb2JJbnN0YW5jZSkudGhlbihyPT5qb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBqb2JFeGVjdXRpb24uZ2V0RFRPKCk7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc0RUT3MgPSBkdG8uc3RlcEV4ZWN1dGlvbnM7XG4gICAgICAgIGR0by5zdGVwRXhlY3V0aW9ucz1udWxsO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uc2V0KGpvYkV4ZWN1dGlvbi5pZCwgZHRvKS50aGVuKHI9PnRoaXMuc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9uc0RUT3MpKS50aGVuKHI9PmpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBmbGFnKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBzdGVwRXhlY3V0aW9uLmdldERUTyhbXCJqb2JFeGVjdXRpb25cIl0pO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+c3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9ucywgc2F2ZWRFeGVjdXRpb25zPVtdKSB7XG4gICAgICAgIGlmKHN0ZXBFeGVjdXRpb25zLmxlbmd0aDw9c2F2ZWRFeGVjdXRpb25zLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25EVE8gPSBzdGVwRXhlY3V0aW9uc1tzYXZlZEV4ZWN1dGlvbnMubGVuZ3RoXTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5zZXQoc3RlcEV4ZWN1dGlvbkRUTy5pZCwgc3RlcEV4ZWN1dGlvbkRUTykudGhlbigoKT0+e1xuICAgICAgICAgICAgc2F2ZWRFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbkRUTyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldChpZCkudGhlbihkdG89PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGR0byk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkRUTywgcmV2aXZlPXRydWUpe1xuICAgICAgICBpZigham9iRXhlY3V0aW9uRFRPKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5maW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uRFRPLmlkLCBmYWxzZSkudGhlbihzdGVwcz0+e1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uRFRPLnN0ZXBFeGVjdXRpb25zID0gc3RlcHM7XG4gICAgICAgICAgICBpZighcmV2aXZlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uRFRPO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmV2aXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbkRUTyk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZT10cnVlLCBmZXRjaGVkPVtdKXtcbiAgICAgICAgaWYoam9iRXhlY3V0aW9uRHRvTGlzdC5sZW5ndGg8PWZldGNoZWQubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmV0Y2hlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdFtmZXRjaGVkLmxlbmd0aF0sIHJldml2ZSkudGhlbigoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgZmV0Y2hlZC5wdXNoKGpvYkV4ZWN1dGlvbik7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0LCByZXZpdmUsIGZldGNoZWQpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmaW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uSWQsIHJldml2ZT10cnVlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5nZXRBbGxCeUluZGV4KFwiam9iRXhlY3V0aW9uSWRcIiwgam9iRXhlY3V0aW9uSWQpLnRoZW4oZHRvcz0+e1xuICAgICAgICAgICAgaWYoIXJldml2ZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGR0b3M7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZHRvcy5tYXAoZHRvPT50aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oZHRvKSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZldGNoUmVsYXRpb25zQW5kUmV2aXZlPXRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIGpvYkluc3RhbmNlLmlkKS50aGVuKHZhbHVlcz0+IHtcbiAgICAgICAgICAgIHZhciBzb3J0ZWQgPSAgdmFsdWVzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZighZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoc29ydGVkLCB0cnVlKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmYWxzZSkudGhlbihleGVjdXRpb25zPT50aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLTFdKSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucz1bXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+e1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVKb2JJbnN0YW5jZShkdG8pIHtcbiAgICAgICAgcmV0dXJuIG5ldyBKb2JJbnN0YW5jZShkdG8uaWQsIGR0by5qb2JOYW1lKTtcbiAgICB9XG5cbiAgICByZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0bykge1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuY29udGV4dCA9IGR0by5jb250ZXh0O1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbkNvbnRleHQuZ2V0RGF0YSgpO1xuICAgICAgICBpZihkYXRhKXtcbiAgICAgICAgICAgIHZhciBkYXRhTW9kZWwgPSBuZXcgRGF0YU1vZGVsKCk7XG4gICAgICAgICAgICBkYXRhTW9kZWwubG9hZEZyb21EVE8oZGF0YSwgdGhpcy5leHByZXNzaW9uc1Jldml2ZXIpO1xuICAgICAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5zZXREYXRhKGRhdGFNb2RlbCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHRcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG5cbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuZ2V0Sm9iQnlOYW1lKGR0by5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8uam9iSW5zdGFuY2UpO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGR0by5qb2JQYXJhbWV0ZXJzLnZhbHVlcyk7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoam9iRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iSW5zdGFuY2VcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYlBhcmFtZXRlcnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JFeGVjdXRpb25cIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwic3RlcEV4ZWN1dGlvbnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBzcmNWYWx1ZS5tYXAoc3RlcERUTyA9PiB0aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oc3RlcERUTywgam9iRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKGR0by5zdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoc3RlcEV4ZWN1dGlvbiwgZHRvLCAob2JqVmFsdWUsIHNyY1ZhbHVlLCBrZXksIG9iamVjdCwgc291cmNlLCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuXG5cbmNsYXNzIE9iamVjdFN0b3JlRGFvIHtcblxuICAgIG5hbWU7XG4gICAgZGJQcm9taXNlO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgZGJQcm9taXNlKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuZGJQcm9taXNlID0gZGJQcm9taXNlO1xuICAgIH1cblxuICAgIGdldChrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5nZXQoa2V5KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0QWxsQnlJbmRleChpbmRleE5hbWUsIGtleSl7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuaW5kZXgoaW5kZXhOYW1lKS5nZXRBbGwoa2V5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRCeUluZGV4KGluZGV4TmFtZSwga2V5KXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5wdXQodmFsLCBrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmRlbGV0ZShrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhcigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuY2xlYXIoKTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAga2V5cygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpO1xuICAgICAgICAgICAgY29uc3Qga2V5cyA9IFtdO1xuICAgICAgICAgICAgY29uc3Qgc3RvcmUgPSB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpO1xuXG4gICAgICAgICAgICAvLyBUaGlzIHdvdWxkIGJlIHN0b3JlLmdldEFsbEtleXMoKSwgYnV0IGl0IGlzbid0IHN1cHBvcnRlZCBieSBFZGdlIG9yIFNhZmFyaS5cbiAgICAgICAgICAgIC8vIG9wZW5LZXlDdXJzb3IgaXNuJ3Qgc3VwcG9ydGVkIGJ5IFNhZmFyaSwgc28gd2UgZmFsbCBiYWNrXG4gICAgICAgICAgICAoc3RvcmUuaXRlcmF0ZUtleUN1cnNvciB8fCBzdG9yZS5pdGVyYXRlQ3Vyc29yKS5jYWxsKHN0b3JlLCBjdXJzb3IgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghY3Vyc29yKSByZXR1cm47XG4gICAgICAgICAgICAgICAga2V5cy5wdXNoKGN1cnNvci5rZXkpO1xuICAgICAgICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZS50aGVuKCgpID0+IGtleXMpO1xuICAgICAgICB9KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYktleUdlbmVyYXRvcn0gZnJvbSBcIi4uL2pvYi1rZXktZ2VuZXJhdG9yXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi4vam9iLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb25cIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuXG5leHBvcnQgY2xhc3MgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBqb2JCeU5hbWUgPSB7fTtcblxuICAgIHJlZ2lzdGVySm9iKGpvYikge1xuICAgICAgICB0aGlzLmpvYkJ5TmFtZVtqb2IubmFtZV0gPSBqb2I7XG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iQnlOYW1lW25hbWVdO1xuICAgIH1cblxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkgZ2V0Sm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGtleSwgam9iSW5zdGFuY2Upe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3MgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25GbGFnIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlU3RlcEV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmZpbmRKb2JFeGVjdXRpb25zIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypDcmVhdGUgYSBuZXcgSm9iSW5zdGFuY2Ugd2l0aCB0aGUgbmFtZSBhbmQgam9iIHBhcmFtZXRlcnMgcHJvdmlkZWQuIHJldHVybiBwcm9taXNlKi9cbiAgICBjcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IG5ldyBKb2JJbnN0YW5jZShVdGlscy5ndWlkKCksIGpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ2hlY2sgaWYgYW4gaW5zdGFuY2Ugb2YgdGhpcyBqb2IgYWxyZWFkeSBleGlzdHMgd2l0aCB0aGUgcGFyYW1ldGVycyBwcm92aWRlZC4qL1xuICAgIGlzSm9iSW5zdGFuY2VFeGlzdHMoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKHJlc3VsdCA9PiAhIXJlc3VsdCkuY2F0Y2goZXJyb3I9PmZhbHNlKTtcbiAgICB9XG5cbiAgICBnZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIGpvYk5hbWUgKyBcInxcIiArIEpvYktleUdlbmVyYXRvci5nZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIEpvYkV4ZWN1dGlvbiBmb3IgYSBnaXZlbiAgSm9iIGFuZCBKb2JQYXJhbWV0ZXJzLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyxcbiAgICAgKiB0aGUgam9iIG11c3QgYmUgcmVzdGFydGFibGUgYW5kIGl0J3MgbGFzdCBKb2JFeGVjdXRpb24gbXVzdCAqbm90KiBiZVxuICAgICAqIGNvbXBsZXRlZC4gSWYgbWF0Y2hpbmcgSm9iSW5zdGFuY2UgZG9lcyBub3QgZXhpc3QgeWV0IGl0IHdpbGwgYmUgIGNyZWF0ZWQuKi9cblxuICAgIGNyZWF0ZUpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oam9iSW5zdGFuY2U9PntcbiAgICAgICAgICAgIGlmIChqb2JJbnN0YW5jZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oZXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgICAgICAgICBleGVjdXRpb25zLmZvckVhY2goZXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbihcIkEgam9iIGV4ZWN1dGlvbiBmb3IgdGhpcyBqb2IgaXMgYWxyZWFkeSBydW5uaW5nOiBcIiArIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkFCQU5ET05FRCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJBIGpvYiBpbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgY29tcGxldGUgZm9yIHBhcmFtZXRlcnM9XCIgKyBqb2JQYXJhbWV0ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICsgXCIuICBJZiB5b3Ugd2FudCB0byBydW4gdGhpcyBqb2IgYWdhaW4sIGNoYW5nZSB0aGUgcGFyYW1ldGVycy5cIik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtIDFdLmV4ZWN1dGlvbkNvbnRleHQ7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtqb2JJbnN0YW5jZSwgZXhlY3V0aW9uQ29udGV4dF07XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbm8gam9iIGZvdW5kLCBjcmVhdGUgb25lXG4gICAgICAgICAgICBqb2JJbnN0YW5jZSA9IHRoaXMuY3JlYXRlSm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YSk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XSk7XG4gICAgICAgIH0pLnRoZW4oaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0PT57XG4gICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uID0gbmV3IEpvYkV4ZWN1dGlvbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMF0sIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMV07XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKChqb2JJbnN0YW5jZSk9PntcbiAgICAgICAgICAgIGlmKCFqb2JJbnN0YW5jZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT5leGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0xXSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucz1bXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+e1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBhZGRTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZShvKXtcbiAgICAgICAgby5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBcIk9iamVjdCBub3QgdXBkYXRhYmxlOiBcIitvXG4gICAgfVxuXG5cbiAgICByZW1vdmUobyl7IC8vVE9ET1xuICAgICAgICAvLyBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgLy8gICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbihvKTtcbiAgICAgICAgLy8gfVxuICAgICAgICAvL1xuICAgICAgICAvLyBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIC8vICAgICByZXR1cm4gdGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uKG8pO1xuICAgICAgICAvLyB9XG4gICAgfVxuXG5cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlSm9iRXhlY3V0aW9uKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZVN0ZXBFeGVjdXRpb24oZHRvLCBqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5cbmV4cG9ydCBjbGFzcyBUaW1lb3V0Sm9iUmVwb3NpdG9yeSBleHRlbmRzIEpvYlJlcG9zaXRvcnl7XG4gICAgam9iSW5zdGFuY2VzQnlLZXkgPSB7fTtcbiAgICBqb2JFeGVjdXRpb25zID0gW107XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBleGVjdXRpb25Qcm9ncmVzcyA9IHt9O1xuICAgIGV4ZWN1dGlvbkZsYWdzID0ge307XG4gICAgam9iUmVzdWx0cz1bXTtcbiAgICBcbiAgICBjcmVhdGVUaW1lb3V0UHJvbWlzZSh2YWx1ZVRvUmVzb2x2ZSwgZGVsYXk9MSl7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlPT57XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh2YWx1ZVRvUmVzb2x2ZSk7XG4gICAgICAgICAgICB9LCBkZWxheSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0gPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmlkPT09am9iUmVzdWx0SWQpKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuam9iSW5zdGFuY2UuaWQ9PT1qb2JJbnN0YW5jZS5pZCkpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5wdXNoKGpvYlJlc3VsdCk7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JFeGVjdXRpb25zLCBleD0+ZXguaWQ9PT1pZCkpO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5wdXNoKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0gPSBwcm9ncmVzcztcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UocHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0gPSBmbGFnO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShmbGFnKTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGU9PmUuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKG9iamVjdCl7IC8vVE9ET1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcblxuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgcmVzdWx0IG9mIGEgam9iIGluc3RhbmNlLiovXG5leHBvcnQgY2xhc3MgSm9iUmVzdWx0IHtcbiAgICBpZDtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICBkYXRhO1xuXG4gICAgY29uc3RydWN0b3Ioam9iSW5zdGFuY2UsIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjb25zdCBKT0JfU1RBVFVTID0ge1xuICAgIENPTVBMRVRFRDogJ0NPTVBMRVRFRCcsXG4gICAgU1RBUlRJTkc6ICdTVEFSVElORycsXG4gICAgU1RBUlRFRDogJ1NUQVJURUQnLFxuICAgIFNUT1BQSU5HOiAnU1RPUFBJTkcnLFxuICAgIFNUT1BQRUQ6ICdTVE9QUEVEJyxcbiAgICBGQUlMRUQ6ICdGQUlMRUQnLFxuICAgIFVOS05PV046ICdVTktOT1dOJyxcbiAgICBBQkFORE9ORUQ6ICdBQkFORE9ORUQnLFxuICAgIEVYRUNVVElORzogJ0VYRUNVVElORycgLy9mb3IgZXhpdCBzdGF0dXMgb25seVxufTtcbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5pbXBvcnQge0pvYlJlc3VsdH0gZnJvbSBcIi4vam9iLXJlc3VsdFwiO1xuLypCYXNlIGNsYXNzIGZvciBqb2JzKi9cbi8vQSBKb2IgaXMgYW4gZW50aXR5IHRoYXQgZW5jYXBzdWxhdGVzIGFuIGVudGlyZSBqb2IgcHJvY2VzcyAoIGFuIGFic3RyYWN0aW9uIHJlcHJlc2VudGluZyB0aGUgY29uZmlndXJhdGlvbiBvZiBhIGpvYikuXG5cbmV4cG9ydCBjbGFzcyBKb2Ige1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBzdGVwcyA9IFtdO1xuXG4gICAgaXNSZXN0YXJ0YWJsZT10cnVlO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuICAgIGpvYlBhcmFtZXRlcnNWYWxpZGF0b3I7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgPSB0aGlzLmdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JEYXRhVmFsaWRhdG9yID0gdGhpcy5nZXRKb2JEYXRhVmFsaWRhdG9yKCk7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgc2V0Sm9iUmVwb3NpdG9yeShqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBzdGFydGluZzogXCIsIGV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBqb2JSZXN1bHQ7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3MoZXhlY3V0aW9uKS50aGVuKGV4ZWN1dGlvbj0+e1xuXG4gICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5TVE9QUElORykge1xuICAgICAgICAgICAgICAgIC8vIFRoZSBqb2Igd2FzIGFscmVhZHkgc3RvcHBlZFxuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHdhcyBzdG9wcGVkOiBcIiArIGV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciAmJiAhdGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYodGhpcy5qb2JEYXRhVmFsaWRhdG9yICYmICF0aGlzLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmdldERhdGEoKSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICBleGVjdXRpb24uc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy51cGRhdGVTdGF0dXMoZXhlY3V0aW9uLCBKT0JfU1RBVFVTLlNUQVJURUQpLCB0aGlzLmdldFJlc3VsdChleGVjdXRpb24pLCB0aGlzLnVwZGF0ZVByb2dyZXNzKGV4ZWN1dGlvbildKS50aGVuKHJlcz0+e1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbj1yZXNbMF07XG4gICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gcmVzWzFdO1xuICAgICAgICAgICAgICAgIGlmKCFqb2JSZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gbmV3IEpvYlJlc3VsdChleGVjdXRpb24uam9iSW5zdGFuY2UpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZUpvYihleGVjdXRpb24pKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIsZXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBqb2JcIiwgZSk7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgZmF0YWwgZXJyb3IgZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKGpvYlJlc3VsdCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkudGhlbigoKT0+ZXhlY3V0aW9uKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBzYXZpbmcgam9iIHJlc3VsdHNcIiwgZSk7XG4gICAgICAgICAgICBpZihlKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhlY3V0aW9uLmVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT5yZXNbMF0pXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVySm9iKGV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBlbmNvdW50ZXJlZCBpbiBhZnRlclN0ZXAgY2FsbGJhY2tcIiwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdXBkYXRlU3RhdHVzKGpvYkV4ZWN1dGlvbiwgc3RhdHVzKSB7XG4gICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXM9c3RhdHVzO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pXG4gICAgfVxuXG4gICAgdXBkYXRlUHJvZ3Jlc3Moam9iRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb24uaWQsIHRoaXMuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgLyogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIGFsbG93aW5nIHRoZW0gdG8gY29uY2VudHJhdGUgb24gcHJvY2Vzc2luZyBsb2dpYyBhbmQgaWdub3JlIGxpc3RlbmVycywgcmV0dXJucyBwcm9taXNlKi9cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgJ2RvRXhlY3V0ZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIGdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKHBhcmFtcykgPT4gcGFyYW1zLnZhbGlkYXRlKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IHRydWVcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZFN0ZXAoc3RlcCl7XG4gICAgICAgIHRoaXMuc3RlcHMucHVzaChzdGVwKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKXtcbiAgICAgICAgdGhyb3cgJ2NyZWF0ZUpvYlBhcmFtZXRlcnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICogY3VycmVudFxuICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcoZXhlY3V0aW9uLmlkKS50aGVuKGZsYWc9PntcbiAgICAgICAgICAgIGlmKEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QID09PSBmbGFnKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RvcCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldFJlc3VsdChleGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYn0gZnJvbSBcIi4vam9iXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5cbi8qIFNpbXBsZSBKb2IgdGhhdCBzZXF1ZW50aWFsbHkgZXhlY3V0ZXMgYSBqb2IgYnkgaXRlcmF0aW5nIHRocm91Z2ggaXRzIGxpc3Qgb2Ygc3RlcHMuICBBbnkgU3RlcCB0aGF0IGZhaWxzIHdpbGwgZmFpbCB0aGUgam9iLiAgVGhlIGpvYiBpc1xuIGNvbnNpZGVyZWQgY29tcGxldGUgd2hlbiBhbGwgc3RlcHMgaGF2ZSBiZWVuIGV4ZWN1dGVkLiovXG5cbmV4cG9ydCBjbGFzcyBTaW1wbGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihuYW1lLCBqb2JSZXBvc2l0b3J5KVxuICAgIH1cblxuICAgIGdldFN0ZXAoc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIFV0aWxzLmZpbmQodGhpcy5zdGVwcywgcz0+cy5uYW1lID09IHN0ZXBOYW1lKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChleGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiVXBkYXRpbmcgSm9iRXhlY3V0aW9uIHN0YXR1czogXCIsIGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBwcmV2U3RlcD1udWxsLCBwcmV2U3RlcEV4ZWN1dGlvbj1udWxsKXtcbiAgICAgICAgdmFyIHN0ZXBJbmRleCA9IDA7XG4gICAgICAgIGlmKHByZXZTdGVwKXtcbiAgICAgICAgICAgIHN0ZXBJbmRleCA9IHRoaXMuc3RlcHMuaW5kZXhPZihwcmV2U3RlcCkrMTtcbiAgICAgICAgfVxuICAgICAgICBpZihzdGVwSW5kZXg+PXRoaXMuc3RlcHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocHJldlN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSB0aGlzLnN0ZXBzW3N0ZXBJbmRleF07XG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVN0ZXAoc3RlcCwgam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQpLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuQ09NUExFVEVEKXsgLy8gVGVybWluYXRlIHRoZSBqb2IgaWYgYSBzdGVwIGZhaWxzXG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCwgc3RlcCwgc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSBqb2JFeGVjdXRpb24uam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3Moam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5pc1N0b3BwaW5nKCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcC5uYW1lKVxuXG4gICAgICAgIH0pLnRoZW4obGFzdFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmICh0aGlzLnN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIGxhc3RTdGVwRXhlY3V0aW9uKSkge1xuICAgICAgICAgICAgICAgIC8vIElmIHRoZSBsYXN0IGV4ZWN1dGlvbiBvZiB0aGlzIHN0ZXAgd2FzIGluIHRoZSBzYW1lIGpvYiwgaXQncyBwcm9iYWJseSBpbnRlbnRpb25hbCBzbyB3ZSB3YW50IHRvIHJ1biBpdCBhZ2Fpbi5cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkR1cGxpY2F0ZSBzdGVwIGRldGVjdGVkIGluIGV4ZWN1dGlvbiBvZiBqb2IuIHN0ZXA6IFwiICsgc3RlcC5uYW1lICsgXCIgam9iTmFtZTogXCIsIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgIGxhc3RTdGVwRXhlY3V0aW9uID0gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGN1cnJlbnRTdGVwRXhlY3V0aW9uID0gbGFzdFN0ZXBFeGVjdXRpb247XG5cbiAgICAgICAgICAgIGlmICghdGhpcy5zaG91bGRTdGFydChjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iRXhlY3V0aW9uLCBzdGVwKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBqb2JFeGVjdXRpb24uY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwLm5hbWUpO1xuXG4gICAgICAgICAgICB2YXIgaXNDb21wbGV0ZWQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIGxhc3RTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICB2YXIgaXNSZXN0YXJ0ID0gbGFzdFN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiAhaXNDb21wbGV0ZWQ7XG4gICAgICAgICAgICB2YXIgc2tpcEV4ZWN1dGlvbiA9IGlzQ29tcGxldGVkICYmIHN0ZXAuc2tpcE9uUmVzdGFydElmQ29tcGxldGVkO1xuXG4gICAgICAgICAgICBpZiAoaXNSZXN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuY29udGFpbnNLZXkoXCJleGVjdXRlZFwiKSkge1xuICAgICAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnJlbW92ZShcImV4ZWN1dGVkXCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJza2lwcGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmFkZFN0ZXBFeGVjdXRpb24oY3VycmVudFN0ZXBFeGVjdXRpb24pLnRoZW4oKF9jdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbj1fY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgaWYoc2tpcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiU2tpcHBpbmcgY29tcGxldGVkIHN0ZXAgZXhlY3V0aW9uOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFeGVjdXRpbmcgc3RlcDogW1wiICsgc3RlcC5uYW1lICsgXCJdXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGVwLmV4ZWN1dGUoY3VycmVudFN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcImV4ZWN1dGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH0pLmNhdGNoIChlID0+IHtcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e3Rocm93IGV9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSkudGhlbigoY3VycmVudFN0ZXBFeGVjdXRpb24pPT57XG4gICAgICAgICAgICBpZiAoY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBJTkdcbiAgICAgICAgICAgICAgICB8fCBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIGpvYiBnZXRzIHRoZSBtZXNzYWdlIHRoYXQgaXQgaXMgc3RvcHBpbmdcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICAgICAgICAgICAgICAvLyB0aHJvdyBuZXcgRXJyb3IoXCJKb2IgaW50ZXJydXB0ZWQgYnkgc3RlcCBleGVjdXRpb25cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pLnRoZW4oKCk9PmN1cnJlbnRTdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIHN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCA9PSBqb2JFeGVjdXRpb24uaWRcbiAgICB9XG5cbiAgICBzaG91bGRTdGFydChsYXN0U3RlcEV4ZWN1dGlvbiwgZXhlY3V0aW9uLCBzdGVwKSB7XG4gICAgICAgIHZhciBzdGVwU3RhdHVzO1xuICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24gPT0gbnVsbCkge1xuICAgICAgICAgICAgc3RlcFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHN0ZXBTdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkNhbm5vdCByZXN0YXJ0IHN0ZXAgZnJvbSBVTktOT1dOIHN0YXR1c1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHN0ZXBTdGF0dXMgIT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgc3RlcC5pc1Jlc3RhcnRhYmxlO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHZhciBjb21wbGV0ZWRTdGVwcyA9IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGg7XG4gICAgICAgIGlmKEpPQl9TVEFUVVMuQ09NUExFVEVEICE9PSBleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aC0xXS5zdGF0dXMpe1xuICAgICAgICAgICAgY29tcGxldGVkU3RlcHMtLTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBNYXRoLnJvdW5kKGNvbXBsZXRlZFN0ZXBzICogMTAwIC8gdGhpcy5zdGVwcy5sZW5ndGgpO1xuICAgIH1cblxuICAgIGFkZFN0ZXAoKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aD09PTEpe1xuICAgICAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoYXJndW1lbnRzWzBdKVxuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gbmV3IFN0ZXAoYXJndW1lbnRzWzBdLCB0aGlzLmpvYlJlcG9zaXRvcnkpO1xuICAgICAgICBzdGVwLmRvRXhlY3V0ZSA9IGFyZ3VtZW50c1sxXTtcbiAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoc3RlcCk7XG4gICAgfVxuXG59XG4iLCJleHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBzdGVwIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVTdGVwKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxuXG4gICAgLypDYWxsZWQgYWZ0ZXIgY29tcGxldGlvbiBvZiBhIHN0ZXAuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlclN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuL2pvYi1leGVjdXRpb25cIjtcblxuLypcbiByZXByZXNlbnRhdGlvbiBvZiB0aGUgZXhlY3V0aW9uIG9mIGEgc3RlcFxuICovXG5leHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgc3RlcE5hbWU7XG4gICAgam9iRXhlY3V0aW9uO1xuXG4gICAgc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7IC8vZXhlY3V0aW9uIGNvbnRleHQgZm9yIHNpbmdsZSBzdGVwIGxldmVsLFxuXG4gICAgc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICBlbmRUaW1lID0gbnVsbDtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICB0ZXJtaW5hdGVPbmx5ID0gZmFsc2U7IC8vZmxhZyB0byBpbmRpY2F0ZSB0aGF0IGFuIGV4ZWN1dGlvbiBzaG91bGQgaGFsdFxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihzdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc3RlcE5hbWUgPSBzdGVwTmFtZTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uSWQgPSBqb2JFeGVjdXRpb24uaWQ7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVycygpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Db250ZXh0KCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0O1xuICAgIH1cblxuICAgIGdldERhdGEoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzPVtdLCBkZWVwQ2xvbmUgPSB0cnVlKXtcblxuICAgICAgICB2YXIgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZURlZXBXaXRoO1xuICAgICAgICBpZighZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoW1wiZXhlY3V0aW9uQ29udGV4dFwiXS5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYodmFsdWUgaW5zdGFuY2VvZiBFcnJvcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTyhbXCJzdGVwRXhlY3V0aW9uc1wiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcblxuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iIHN0ZXAqL1xuZXhwb3J0IGNsYXNzIFN0ZXAge1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBpc1Jlc3RhcnRhYmxlID0gdHJ1ZTtcbiAgICBza2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ9dHJ1ZTtcbiAgICBzdGVwcyA9IFtdO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICAvKlByb2Nlc3MgdGhlIHN0ZXAgYW5kIGFzc2lnbiBwcm9ncmVzcyBhbmQgc3RhdHVzIG1ldGEgaW5mb3JtYXRpb24gdG8gdGhlIFN0ZXBFeGVjdXRpb24gcHJvdmlkZWQqL1xuICAgIGV4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcIkV4ZWN1dGluZyBzdGVwOiBuYW1lPVwiICsgdGhpcy5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRFRDtcbiAgICAgICAgdmFyIGV4aXRTdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRVhFQ1VUSU5HO1xuXG4gICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5iZWZvcmVTdGVwKHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIHRoaXMub3BlbihzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICB9KS50aGVuKF9zdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uID0gX3N0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBzb21lb25lIGlzIHRyeWluZyB0byBzdG9wIHVzXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi50ZXJtaW5hdGVPbmx5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIE5lZWQgdG8gdXBncmFkZSBoZXJlIG5vdCBzZXQsIGluIGNhc2UgdGhlIGV4ZWN1dGlvbiB3YXMgc3RvcHBlZFxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlN0ZXAgZXhlY3V0aW9uIHN1Y2Nlc3M6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSB0aGlzLmRldGVybWluZUpvYlN0YXR1cyhlKTtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcblxuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBFRCkge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGFuIGVycm9yIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gZXhpdFN0YXR1cztcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5hZnRlclN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gaW4gYWZ0ZXJTdGVwIGNhbGxiYWNrIGluIHN0ZXAgXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbG9zZShzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gd2hpbGUgY2xvc2luZyBzdGVwIGV4ZWN1dGlvbiByZXNvdXJjZXMgaW4gc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBkb0V4ZWN1dGlvblJlbGVhc2UoKTtcblxuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gY29tcGxldGU6IFwiICsgc3RlcEV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG5cbiAgICB9XG5cbiAgICBkZXRlcm1pbmVKb2JTdGF0dXMoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIGV4ZWN1dGUgYnVzaW5lc3MgbG9naWMuIFN1YmNsYXNzZXMgc2hvdWxkIHNldCB0aGUgZXhpdFN0YXR1cyBvbiB0aGVcbiAgICAgKiBTdGVwRXhlY3V0aW9uIGJlZm9yZSByZXR1cm5pbmcuIE11c3QgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgKi9cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGJlZ2lubmluZyBvZiBhIHN0ZXAsIHRvIG9wZW4gb3JcbiAgICAgKiBhY3F1aXJlIHJlc291cmNlcy4gRG9lcyBub3RoaW5nIGJ5IGRlZmF1bHQuXG4gICAgICovXG4gICAgb3BlbihleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGVuZCBvZiBhIHN0ZXAgKHJpZ2h0IGF0IHRoZSBlbmRcbiAgICAgKiBvZiB0aGUgZmluYWxseSBibG9jayksIHRvIGNsb3NlIG9yIHJlbGVhc2UgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBjbG9zZShleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQgPyAxIDogMFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0ICogYXMgZW5naW5lIGZyb20gJy4vZW5naW5lL2luZGV4J1xuXG5leHBvcnQge2VuZ2luZX1cbmV4cG9ydCAqIGZyb20gJy4vam9icy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itd29ya2VyJ1xuXG5cblxuIiwiaW1wb3J0IHtKb2JFeGVjdXRpb25MaXN0ZW5lcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXJcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuL2VuZ2luZS9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyB7XG4gICAgb25Kb2JTdGFydGVkID0gKCkgPT4ge1xuICAgIH07XG4gICAgb25Kb2JDb21wbGV0ZWQgPSByZXN1bHQgPT4ge1xuICAgIH07XG4gICAgb25Kb2JGYWlsZWQgPSBlcnJvcnMgPT4ge1xuICAgIH07XG4gICAgb25Kb2JTdG9wcGVkID0gKCkgPT4ge1xuICAgIH07XG4gICAgb25Kb2JUZXJtaW5hdGVkID0gKCkgPT4ge1xuICAgIH07XG4gICAgb25Qcm9ncmVzcyA9IChwcm9ncmVzcykgPT4ge1xuICAgIH07XG4gICAgY2FsbGJhY2tzVGhpc0FyZztcbiAgICB1cGRhdGVJbnRlcnZhbCA9IDEwMDtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qY29udmVuaWVuY2UgY2xhc3MgZm9yIG1hbmFnaW5nIGFuZCB0cmFja2luZyBqb2IgaW5zdGFuY2UgcHJvZ3Jlc3MqL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuICAgIGpvYnNNYW5nZXI7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgY29uZmlnO1xuXG4gICAgbGFzdEpvYkV4ZWN1dGlvbjtcbiAgICBsYXN0VXBkYXRlVGltZTtcbiAgICBwcm9ncmVzcyA9IG51bGw7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JzTWFuZ2VyLCBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IGpvYnNNYW5nZXI7XG4gICAgICAgIGlmIChqb2JJbnN0YW5jZU9yRXhlY3V0aW9uIGluc3RhbmNlb2YgSm9iSW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxhc3RKb2JFeGVjdXRpb24gJiYgIXRoaXMubGFzdEpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgdGhpcy5hZnRlckpvYih0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcbiAgICB9XG5cbiAgICBjaGVja1Byb2dyZXNzKCkge1xuXG4gICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgaWYgKHRoaXMudGVybWluYXRlZCB8fCAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpIHx8IHRoaXMuZ2V0UHJvZ3Jlc3NQZXJjZW50cyh0aGlzLnByb2dyZXNzKSA9PT0gMTAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFByb2dyZXNzKHRoaXMubGFzdEpvYkV4ZWN1dGlvbikudGhlbihwcm9ncmVzcz0+IHtcbiAgICAgICAgICAgIHRoaXMubGFzdFVwZGF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgaWYgKHByb2dyZXNzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHByb2dyZXNzO1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHByb2dyZXNzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9LCB0aGlzLmNvbmZpZy51cGRhdGVJbnRlcnZhbClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgIT09IHRoaXMuam9iSW5zdGFuY2UuaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdGFydGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc1BlcmNlbnRzKHByb2dyZXNzKSB7XG4gICAgICAgIGlmICghcHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9ncmVzcy5jdXJyZW50ICogMTAwIC8gcHJvZ3Jlc3MudG90YWw7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgaWYgKEpPQl9TVEFUVVMuQ09NUExFVEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHRoaXMuZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vblByb2dyZXNzLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLnByb2dyZXNzKTtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5nZXRSZXN1bHQoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlKS50aGVuKHJlc3VsdD0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkNvbXBsZXRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcmVzdWx0LmRhdGEpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLkZBSUxFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JGYWlsZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucyk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLlNUT1BQRUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iU3RvcHBlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGZvcmNlVXBkYXRlID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxhc3RKb2JFeGVjdXRpb24gfHwgZm9yY2VVcGRhdGUpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHJldHVybiBqZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzdG9wKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuc3RvcCh0aGlzLmxhc3RKb2JFeGVjdXRpb24pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIucnVuKHRoaXMuam9iSW5zdGFuY2Uuam9iTmFtZSwgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMudmFsdWVzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uZ2V0RGF0YSgpKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHRlcm1pbmF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnRlcm1pbmF0ZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMudGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JUZXJtaW5hdGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBKb2JXb3JrZXJ7XG5cbiAgICB3b3JrZXI7XG4gICAgbGlzdGVuZXJzID0ge307XG4gICAgZGVmYXVsdExpc3RlbmVyO1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBkZWZhdWx0TGlzdGVuZXIsIG9uRXJyb3Ipe1xuICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICB0aGlzLndvcmtlciA9IG5ldyBXb3JrZXIodXJsKTtcbiAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIgPSBkZWZhdWx0TGlzdGVuZXIgfHwgZnVuY3Rpb24oKSB7fTtcbiAgICAgICAgaWYgKG9uRXJyb3IpIHt0aGlzLndvcmtlci5vbmVycm9yID0gb25FcnJvcjt9XG5cbiAgICAgICAgdGhpcy53b3JrZXIub25tZXNzYWdlID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5kYXRhIGluc3RhbmNlb2YgT2JqZWN0ICYmXG4gICAgICAgICAgICAgICAgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RMaXN0ZW5lcicpICYmIGV2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kQXJndW1lbnRzJykpIHtcbiAgICAgICAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBpbnN0YW5jZS5saXN0ZW5lcnNbZXZlbnQuZGF0YS5xdWVyeU1ldGhvZExpc3RlbmVyXTtcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IGV2ZW50LmRhdGEucXVlcnlNZXRob2RBcmd1bWVudHM7XG4gICAgICAgICAgICAgICAgaWYobGlzdGVuZXIuZGVzZXJpYWxpemVyKXtcbiAgICAgICAgICAgICAgICAgICAgYXJncyA9IGxpc3RlbmVyLmRlc2VyaWFsaXplcihhcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGlzdGVuZXIuZm4uYXBwbHkobGlzdGVuZXIudGhpc0FyZywgYXJncyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuZGVmYXVsdExpc3RlbmVyLmNhbGwoaW5zdGFuY2UsIGV2ZW50LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzZW5kUXVlcnkoKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSm9iV29ya2VyLnNlbmRRdWVyeSB0YWtlcyBhdCBsZWFzdCBvbmUgYXJndW1lbnQnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAncXVlcnlNZXRob2QnOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3J1bkpvYicsIGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pXG4gICAgfVxuXG4gICAgZXhlY3V0ZUpvYihqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdleGVjdXRlSm9iJywgam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgcmVjb21wdXRlKGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3JlY29tcHV0ZScsIGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgIH1cblxuICAgIHBvc3RNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICAgICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLndvcmtlci50ZXJtaW5hdGUoKTtcbiAgICB9XG5cbiAgICBhZGRMaXN0ZW5lcihuYW1lLCBsaXN0ZW5lciwgdGhpc0FyZywgZGVzZXJpYWxpemVyKSB7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzW25hbWVdID0ge1xuICAgICAgICAgICAgZm46IGxpc3RlbmVyLFxuICAgICAgICAgICAgdGhpc0FyZzogdGhpc0FyZyB8fCB0aGlzLFxuICAgICAgICAgICAgZGVzZXJpYWxpemVyOiBkZXNlcmlhbGl6ZXJcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZW1vdmVMaXN0ZW5lcihuYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmxpc3RlbmVyc1tuYW1lXTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7Sm9iTGF1bmNoZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItbGF1bmNoZXJcIjtcbmltcG9ydCB7Sm9iV29ya2VyfSBmcm9tIFwiLi9qb2Itd29ya2VyXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7SWRiSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L2lkYi1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7UmVjb21wdXRlSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9yZWNvbXB1dGUvcmVjb21wdXRlLWpvYlwiO1xuaW1wb3J0IHtQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtUaW1lb3V0Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG5cbiAgICB1c2VXb3JrZXI7XG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIGpvYldvcmtlcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG4gICAgam9iTGF1bmNoZXI7XG5cbiAgICBqb2JFeGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcblxuICAgIGFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzID0ge307XG4gICAgam9iSW5zdGFuY2VzVG9UZXJtaW5hdGUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIHdvcmtlclVybCkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuXG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBJZGJKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgLy8gdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFRpbWVvdXRKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYnMoKTtcblxuICAgICAgICB0aGlzLnVzZVdvcmtlciA9ICEhd29ya2VyVXJsO1xuICAgICAgICBpZiAodGhpcy51c2VXb3JrZXIpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdFdvcmtlcih3b3JrZXJVcmwpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JMYXVuY2hlciA9IG5ldyBKb2JMYXVuY2hlcih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuam9iV29ya2VyLCAoZGF0YSk9PnRoaXMuc2VyaWFsaXplRGF0YShkYXRhKSk7XG4gICAgfVxuXG4gICAgc2VyaWFsaXplRGF0YShkYXRhKSB7XG4gICAgICAgIHJldHVybiBkYXRhLnNlcmlhbGl6ZSh0cnVlLCBmYWxzZSwgZmFsc2UsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmVwbGFjZXIoKSk7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICB2YXIgaWQgPSBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICBpZiAoIVV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKSB7XG4gICAgICAgICAgICBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQuaWRcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGlkKTtcbiAgICB9XG5cbiAgICBnZXRSZXN1bHQoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLnJ1bihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgfHwgIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2pvYiB3YXMgZGVsZWdhdGVkIHRvIHdvcmtlciBhbmQgaXMgc3RpbGwgcnVubmluZ1xuXG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdID0gcmVzb2x2ZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iTGF1bmNoZXIuZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKTtcbiAgICB9XG5cbiAgICBzdG9wKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKCFqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2IgRXhlY3V0aW9uIG5vdCBmb3VuZDogXCIgKyBqb2JFeGVjdXRpb25PcklkKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgbG9nLndhcm4oXCJKb2IgRXhlY3V0aW9uIG5vdCBydW5uaW5nLCBzdGF0dXM6IFwiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiLCBlbmRUaW1lOiBcIiArIGpvYkV4ZWN1dGlvbi5lbmRUaW1lKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbi5pZCwgSk9CX0VYRUNVVElPTl9GTEFHLlNUT1ApLnRoZW4oKCk9PmpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qc3RvcCBqb2IgZXhlY3V0aW9uIGlmIHJ1bm5pbmcgYW5kIGRlbGV0ZSBqb2IgaW5zdGFuY2UgZnJvbSByZXBvc2l0b3J5Ki9cbiAgICB0ZXJtaW5hdGUoam9iSW5zdGFuY2UpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24gJiYgam9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS50aGVuKCgpPT57XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkluc3RhbmNlLmlkXT1qb2JJbnN0YW5jZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcykge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuICAgIH1cblxuXG4gICAgLypSZXR1cm5zIGEgcHJvbWlzZSovXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iV29ya2VyO1xuICAgICAgICB9XG4gICAgICAgIGlmICghKGpvYlBhcmFtZXRlcnMgaW5zdGFuY2VvZiBKb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IHRoaXMuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICBpbml0V29ya2VyKHdvcmtlclVybCkge1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IG5ldyBKb2JXb3JrZXIod29ya2VyVXJsLCAoKT0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKCdlcnJvciBpbiB3b3JrZXInLCBhcmd1bWVudHMpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIGFyZ3NEZXNlcmlhbGl6ZXIgPSAoYXJncyk9PiB7XG4gICAgICAgICAgICByZXR1cm4gW3RoaXMuam9iUmVwb3NpdG9yeS5yZXZpdmVKb2JFeGVjdXRpb24oYXJnc1swXSldXG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJiZWZvcmVKb2JcIiwgdGhpcy5iZWZvcmVKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImFmdGVySm9iXCIsIHRoaXMuYWZ0ZXJKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImpvYkZhdGFsRXJyb3JcIiwgdGhpcy5vbkpvYkZhdGFsRXJyb3IsIHRoaXMpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVySm9icygpIHtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFRvcm5hZG9EaWFncmFtSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBSZWNvbXB1dGVKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVySm9iKGpvYikge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkucmVnaXN0ZXJKb2Ioam9iKTtcbiAgICAgICAgam9iLnJlZ2lzdGVyRXhlY3V0aW9uTGlzdGVuZXIodGhpcylcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xuICAgIH1cblxuICAgIGRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xuICAgICAgICB2YXIgaW5kZXggPSB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5pbmRleE9mKGxpc3RlbmVyKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiYmVmb3JlSm9iXCIsIHRoaXMudXNlV29ya2VyLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGw9PmwuYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikpO1xuICAgIH1cblxuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJhZnRlckpvYlwiLCB0aGlzLnVzZVdvcmtlciwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsPT5sLmFmdGVySm9iKGpvYkV4ZWN1dGlvbikpO1xuICAgICAgICB2YXIgcHJvbWlzZVJlc29sdmUgPSB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbi5pZF07XG4gICAgICAgIGlmIChwcm9taXNlUmVzb2x2ZSkge1xuICAgICAgICAgICAgcHJvbWlzZVJlc29sdmUoam9iRXhlY3V0aW9uKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYodGhpcy5qb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZVtqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWRdKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5yZW1vdmUoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIG9uSm9iRmF0YWxFcnJvcihqb2JFeGVjdXRpb25JZCwgZXJyb3Ipe1xuICAgICAgICB2YXIgcHJvbWlzZVJlc29sdmUgPSB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbklkXTtcbiAgICAgICAgaWYgKHByb21pc2VSZXNvbHZlKSB7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChqb2JFeGVjdXRpb25JZCkudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgaWYoZXJyb3Ipe1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlcnJvcik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgICAgICBwcm9taXNlUmVzb2x2ZShqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcblxuICAgICAgICB9XG4gICAgICAgIGxvZy5kZWJ1Zygnb25Kb2JGYXRhbEVycm9yJywgam9iRXhlY3V0aW9uSWQsIGVycm9yKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlLCBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZSwgTWF4aU1pblJ1bGUsIE1heGlNYXhSdWxlLCBNaW5pTWluUnVsZSwgTWluaU1heFJ1bGV9IGZyb20gXCIuL3J1bGVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSBcInNkLXV0aWxzXCJcbmltcG9ydCAqIGFzIG1vZGVsIGZyb20gXCJzZC1tb2RlbFwiO1xuXG5leHBvcnQgY2xhc3MgT2JqZWN0aXZlUnVsZXNNYW5hZ2Vye1xuXG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjdXJyZW50UnVsZTtcbiAgICBydWxlQnlOYW1lPXt9O1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSwgY3VycmVudFJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHZhciBtYXggPSBuZXcgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHZhciBtYXhpTWluID0gbmV3IE1heGlNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB2YXIgbWF4aU1heCA9IG5ldyBNYXhpTWF4UnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdmFyIG1pbiA9IG5ldyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdmFyIG1pbmlNaW4gPSBuZXcgTWluaU1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHZhciBtaW5pTWF4ID0gbmV3IE1pbmlNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLnJ1bGVCeU5hbWVbbWF4Lm5hbWVdPW1heDtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW21heGlNaW4ubmFtZV09bWF4aU1pbjtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW21heGlNYXgubmFtZV09bWF4aU1heDtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW21pbi5uYW1lXT1taW47XG4gICAgICAgIHRoaXMucnVsZUJ5TmFtZVttaW5pTWluLm5hbWVdPW1pbmlNaW47XG4gICAgICAgIHRoaXMucnVsZUJ5TmFtZVttaW5pTWF4Lm5hbWVdPW1pbmlNYXg7XG4gICAgICAgIHRoaXMucnVsZXMgPSBbbWF4LCBtaW4sIG1heGlNaW4sIG1heGlNYXgsIG1pbmlNaW4sIG1pbmlNYXhdO1xuICAgICAgICBpZihjdXJyZW50UnVsZU5hbWUpe1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtjdXJyZW50UnVsZU5hbWVdO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVzWzBdO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgIHJldHVybiAhIXRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV1cbiAgICB9XG5cbiAgICBzZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIHJlY29tcHV0ZShhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0aW5nIHJ1bGVzLCBhbGw6ICcrYWxsUnVsZXMpO1xuXG4gICAgICAgIHRoaXMuZGF0YS5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5yZWNvbXB1dGVUcmVlKG4sIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB0aW1lICA9IChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIHN0YXJ0VGltZS8xMDAwKTtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGF0aW9uIHRvb2sgJyt0aW1lKydzJyk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMgZm9yIHRyZWUgLi4uJywgcm9vdCk7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuXG4gICAgICAgIHZhciBydWxlcyAgPSBbdGhpcy5jdXJyZW50UnVsZV07XG4gICAgICAgIGlmKGFsbFJ1bGVzKXtcbiAgICAgICAgICAgIHJ1bGVzID0gdGhpcy5ydWxlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJ1bGVzLmZvckVhY2gocnVsZT0+IHtcbiAgICAgICAgICAgIHJ1bGUuc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlUGF5b2ZmKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlT3B0aW1hbChyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY2xlYXJEZWNpc2lvblBvbGljeSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdGltZSAgPSAobmV3IERhdGUoKS5nZXRUaW1lKCkgLSBzdGFydFRpbWUpLzEwMDA7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRhdGlvbiB0b29rICcrdGltZSsncycpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuYW1lKSB7XG4gICAgICAgIHJldHVybiBub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCBuYW1lKVxuXG4gICAgfVxuXG4gICAgZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuYW1lKXtcbiAgICAgICAgaWYobmFtZT09PSdwcm9iYWJpbGl0eScpe1xuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdwcm9iYWJpbGl0eScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J3BheW9mZicpe1xuICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRCYXNlUGF5b2ZmKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYobmFtZT09PSdvcHRpbWFsJyl7XG4gICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgJ29wdGltYWwnKVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWF4aW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUuTkFNRSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKXtcbiAgICAgICAgcmV0dXJuIFV0aWxzLmluZGV4ZXNPZihjaGlsZHJlblBheW9mZnMsIHRoaXMubWF4KC4uLmNoaWxkcmVuUGF5b2ZmcykpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsJ3BheW9mZicpLHBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKmV4cGVjdGVkIHZhbHVlIG1pbmltaXphdGlvbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdleHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLk5BTUUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIHJldHVybiBVdGlscy5pbmRleGVzT2YoY2hpbGRyZW5QYXlvZmZzLCB0aGlzLm1pbiguLi5jaGlsZHJlblBheW9mZnMpKTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmPTAsIHByb2JhYmlsaXR5VG9FbnRlcj0xKXtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSl7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGlmICggdGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCdwYXlvZmYnKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpICkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJleHBvcnQgKiBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWluLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWluLXJ1bGUnXG5cblxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNYXhSdWxlLk5BTUUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIHJldHVybiBVdGlscy5pbmRleGVzT2YoY2hpbGRyZW5QYXlvZmZzLCB0aGlzLm1heCguLi5jaGlsZHJlblBheW9mZnMpKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJyk8YmVzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC9iZXN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1heEJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jVmFsdWUob3B0aW1hbEVkZ2UuY2hpbGROb2RlLCAncGF5b2ZmJykuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZicpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyptYXhpLW1pbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBNYXhpTWluUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXhpLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWF4aU1pblJ1bGUuTkFNRSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKXtcbiAgICAgICAgcmV0dXJuIFV0aWxzLmluZGV4ZXNPZihjaGlsZHJlblBheW9mZnMsIHRoaXMubWF4KC4uLmNoaWxkcmVuUGF5b2ZmcykpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKT53b3JzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC93b3JzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5taW5CeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY1ZhbHVlKG9wdGltYWxFZGdlLmNoaWxkTm9kZSwgJ3BheW9mZicpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsICdwYXlvZmYnKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNYXhSdWxlLk5BTUUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIHJldHVybiBVdGlscy5pbmRleGVzT2YoY2hpbGRyZW5QYXlvZmZzLCB0aGlzLm1pbiguLi5jaGlsZHJlblBheW9mZnMpKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJyk8YmVzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC9iZXN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1heEJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jVmFsdWUob3B0aW1hbEVkZ2UuY2hpbGROb2RlLCAncGF5b2ZmJykuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZicpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNaW5SdWxlLk5BTUUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIHJldHVybiBVdGlscy5pbmRleGVzT2YoY2hpbGRyZW5QYXlvZmZzLCB0aGlzLm1pbiguLi5jaGlsZHJlblBheW9mZnMpKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJyk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNWYWx1ZShvcHRpbWFsRWRnZS5jaGlsZE5vZGUsICdwYXlvZmYnKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJyksIHBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvZGVjaXNpb25cIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cbi8qQmFzZSBjbGFzcyBmb3Igb2JqZWN0aXZlIHJ1bGVzKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxle1xuICAgIG5hbWU7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGRlY2lzaW9uUG9saWN5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpe1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5ID0gZGVjaXNpb25Qb2xpY3k7XG4gICAgfVxuXG4gICAgY2xlYXJEZWNpc2lvblBvbGljeSgpe1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5PW51bGw7XG4gICAgfVxuXG4gICAgLy8gc2hvdWxkIHJldHVybiBhcnJheSBvZiBzZWxlY3RlZCBjaGlsZHJlbiBpbmRleGVzXG4gICAgbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKXtcbiAgICAgICAgdGhyb3cgJ21ha2VEZWNpc2lvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHJ1bGU6ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgX21ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIGlmKHRoaXMuZGVjaXNpb25Qb2xpY3kpe1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5tYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpO1xuICAgIH1cblxuICAgIC8vIGV4dGVuc2lvbiBwb2ludCBmb3IgY2hhbmdpbmcgY29tcHV0ZWQgcHJvYmFiaWxpdHkgb2YgZWRnZXMgaW4gYSBjaGFuY2Ugbm9kZVxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG5cbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmY9MCwgYWdncmVnYXRlZFBheW9mZj0wKXtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gMDtcbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSB0aGlzLl9tYWtlRGVjaXNpb24obm9kZSwgbm9kZS5jaGlsZEVkZ2VzLm1hcChlPT50aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSkpKTtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgIHZhciB3b3JzdENoaWxkID0gSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q291bnQgPSAxO1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmKGNoaWxkUGF5b2ZmIDwgd29yc3RDaGlsZCl7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50PTE7XG4gICAgICAgICAgICAgICAgICAgIH1lbHNlIGlmKGNoaWxkUGF5b2ZmLmVxdWFscyh3b3JzdENoaWxkKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50KytcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZihjaGlsZFBheW9mZiA+IGJlc3RDaGlsZCl7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudD0xO1xuICAgICAgICAgICAgICAgICAgICB9ZWxzZSBpZihjaGlsZFBheW9mZi5lcXVhbHMoYmVzdENoaWxkKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5tb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShub2RlLmNoaWxkRWRnZXMsIGJlc3RDaGlsZCwgYmVzdENvdW50LCB3b3JzdENoaWxkLCB3b3JzdENvdW50KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDAgO1xuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodD10aGlzLmFkZChzdW13ZWlnaHQsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhwYXlvZmYsbm9kZS5jaGlsZEVkZ2VzLCdzdW13ZWlnaHQnLHN1bXdlaWdodCk7XG4gICAgICAgICAgICBpZihzdW13ZWlnaHQ+MCl7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZiA9IHRoaXMuYWRkKGNoaWxkcmVuUGF5b2ZmLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpLmRpdihzdW13ZWlnaHQpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cblxuICAgICAgICBwYXlvZmY9dGhpcy5hZGQocGF5b2ZmLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhub2RlKTtcblxuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJywgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICAvLyBrb2xvcnVqZSBvcHR5bWFsbmUgxZtjaWXFvGtpXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSl7XG4gICAgICAgIHRocm93ICdjb21wdXRlT3B0aW1hbCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHJ1bGU6ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLypHZXQgb3Igc2V0IG9iamVjdCdzIGNvbXB1dGVkIHZhbHVlIGZvciBjdXJyZW50IHJ1bGUqL1xuICAgIGNWYWx1ZShvYmplY3QsIGZpZWxkTmFtZSwgdmFsdWUpe1xuICAgICAgICByZXR1cm4gIG9iamVjdC5jb21wdXRlZFZhbHVlKHRoaXMubmFtZSwgZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgYmFzZVByb2JhYmlsaXR5KGVkZ2Upe1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgIH1cblxuICAgIGJhc2VQYXlvZmYoZWRnZSl7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVBheW9mZigpO1xuICAgIH1cblxuICAgIGNsZWFyQ29tcHV0ZWRWYWx1ZXMob2JqZWN0KXtcbiAgICAgICAgb2JqZWN0LmNsZWFyQ29tcHV0ZWRWYWx1ZXModGhpcy5uYW1lKTtcbiAgICB9XG5cbiAgICBhZGQoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuYWRkKGEsYilcbiAgICB9XG4gICAgc3VidHJhY3QoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoYSxiKVxuICAgIH1cbiAgICBkaXZpZGUoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGEsYilcbiAgICB9XG5cbiAgICBtdWx0aXBseShhLGIpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShhLGIpXG4gICAgfVxuXG4gICAgbWF4KCl7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1heCguLi5hcmd1bWVudHMpXG4gICAgfVxuXG4gICAgbWluKCl7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1pbiguLi5hcmd1bWVudHMpXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtPcGVyYXRpb259IGZyb20gXCIuL29wZXJhdGlvblwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuXG4vKlN1YnRyZWUgZmxpcHBpbmcgb3BlcmF0aW9uKi9cbmV4cG9ydCBjbGFzcyBGbGlwU3VidHJlZSBleHRlbmRzIE9wZXJhdGlvbntcblxuICAgIHN0YXRpYyAkTkFNRSA9ICdmbGlwU3VidHJlZSc7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihGbGlwU3VidHJlZS4kTkFNRSk7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIGlzQXBwbGljYWJsZShvYmplY3Qpe1xuICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZVxuICAgIH1cblxuICAgIGNhblBlcmZvcm0obm9kZSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWNhYmxlKG5vZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZSh0aGlzLmRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUobm9kZSkpLmlzVmFsaWQoKSkgeyAvL2NoZWNrIGlmIHRoZSB3aG9sZSBzdWJ0cmVlIGlzIHByb3BlclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuTnVtYmVyID0gbnVsbDtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzID0gW107XG4gICAgICAgIHZhciBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KCk7XG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldDtcbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMuZXZlcnkoZT0+IHtcblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IGUuY2hpbGROb2RlO1xuICAgICAgICAgICAgICAgIGlmICghKGNoaWxkIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuaGFzKGUubmFtZS50cmltKCkpKSB7IC8vIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuYWRkKGUubmFtZS50cmltKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5OdW1iZXIgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbk51bWJlciA9IGNoaWxkLmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA8IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ2U9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5wdXNoKGdlLm5hbWUudHJpbSgpKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuc2l6ZSAhPT0gZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMubGVuZ3RoKSB7IC8vZ3JhbmRjaGlsZHJlbiBlZGdlIGxhYmVscyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGggIT0gZ3JhbmRjaGlsZHJlbk51bWJlcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFjaGlsZC5jaGlsZEVkZ2VzLmV2ZXJ5KChnZSwgaSk9PmdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzW2ldID09PSBnZS5uYW1lLnRyaW0oKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICB9KSkge1xuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBwZXJmb3JtKHJvb3QpIHtcblxuICAgICAgICB2YXIgcm9vdENsb25lID0gdGhpcy5kYXRhLmNsb25lU3VidHJlZShyb290LCB0cnVlKTtcbiAgICAgICAgdmFyIG9sZENoaWxkcmVuTnVtYmVyID0gcm9vdC5jaGlsZEVkZ2VzLmxlbmd0aDtcbiAgICAgICAgdmFyIG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXMubGVuZ3RoO1xuXG4gICAgICAgIHZhciBjaGlsZHJlbk51bWJlciA9IG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXI7XG4gICAgICAgIHZhciBncmFuZENoaWxkcmVuTnVtYmVyID0gb2xkQ2hpbGRyZW5OdW1iZXI7XG5cbiAgICAgICAgdmFyIGNhbGxiYWNrc0Rpc2FibGVkID0gdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSB0cnVlO1xuXG5cbiAgICAgICAgdmFyIGNoaWxkWCA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueDtcbiAgICAgICAgdmFyIHRvcFkgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG4gICAgICAgIHZhciBib3R0b21ZID0gcm9vdC5jaGlsZEVkZ2VzW29sZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmNoaWxkRWRnZXNbb2xkR3JhbmRDaGlsZHJlbk51bWJlciAtIDFdLmNoaWxkTm9kZS5sb2NhdGlvbi55O1xuXG4gICAgICAgIHZhciBleHRlbnRZID0gYm90dG9tWSAtIHRvcFk7XG4gICAgICAgIHZhciBzdGVwWSA9IGV4dGVudFkgLyAoY2hpbGRyZW5OdW1iZXIgKyAxKTtcblxuICAgICAgICByb290LmNoaWxkRWRnZXMuc2xpY2UoKS5mb3JFYWNoKGU9PiB0aGlzLmRhdGEucmVtb3ZlTm9kZShlLmNoaWxkTm9kZSkpO1xuXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZHJlbk51bWJlcjsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBuZXcgbW9kZWwuQ2hhbmNlTm9kZShuZXcgbW9kZWwuUG9pbnQoY2hpbGRYLCB0b3BZICsgKGkgKyAxKSAqIHN0ZXBZKSk7XG4gICAgICAgICAgICB2YXIgZWRnZSA9IHRoaXMuZGF0YS5hZGROb2RlKGNoaWxkLCByb290KTtcbiAgICAgICAgICAgIGVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLm5hbWU7XG5cbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSAwO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGdyYW5kQ2hpbGRyZW5OdW1iZXI7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY2hpbGROb2RlO1xuXG5cbiAgICAgICAgICAgICAgICB2YXIgZ3JhbmRDaGlsZEVkZ2UgPSB0aGlzLmRhdGEuYXR0YWNoU3VidHJlZShncmFuZENoaWxkLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLm5hbWU7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucGF5b2ZmID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUGF5b2ZmKCksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVBheW9mZigpKTtcblxuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpKTtcbiAgICAgICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoZWRnZS5wcm9iYWJpbGl0eSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocCwgZWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBpZiAoZWRnZS5wcm9iYWJpbGl0eS5lcXVhbHMoMCkpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGdyYW5kQ2hpbGRyZW5OdW1iZXIpO1xuICAgICAgICAgICAgICAgIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IHByb2I7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChncmFuZENoaWxkRWRnZT0+IHtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZC5jaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShlZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAocm9vdC5jaGlsZEVkZ2VzKTtcblxuXG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IGNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuX2ZpcmVOb2RlQWRkZWRDYWxsYmFjaygpO1xuICAgIH1cblxuICAgIF9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgaWYoIXByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgbG9nLmluZm8oJ1N1bSBvZiB0aGUgcHJvYmFiaWxpdGllcyBpbiBjaGlsZCBub2RlcyBpcyBub3QgZXF1YWwgdG8gMSA6ICcsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIHZhciBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIHZhciBjZiA9IDEwMDAwMDAwMDAwMDA7IC8vMTBeMTJcbiAgICAgICAgICAgIHZhciBwcmVjID0gMTI7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gcGFyc2VJbnQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChlLnByb2JhYmlsaXR5LCBwcmVjKSAqIGNmKTtcbiAgICAgICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IG5ld1Byb2JhYmlsaXR5U3VtICsgZS5wcm9iYWJpbGl0eTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdmFyIHJlc3QgPSBjZiAtIG5ld1Byb2JhYmlsaXR5U3VtO1xuICAgICAgICAgICAgbG9nLmluZm8oJ05vcm1hbGl6aW5nIHdpdGggcm91bmRpbmcgdG8gcHJlY2lzaW9uOiAnICsgcHJlYywgcmVzdCk7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocmVzdCwgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHBhcnNlSW50KGUucHJvYmFiaWxpdHkpLCBjZikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiXG4vKkJhc2UgY2xhc3MgZm9yIGNvbXBsZXggb3BlcmF0aW9ucyBvbiB0cmVlIHN0cnVjdHVyZSovXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9ue1xuXG4gICAgbmFtZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUpe1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgb3BlcmF0aW9uIGlzIHBvdGVudGlhbGx5IGFwcGxpY2FibGUgZm9yIG9iamVjdFxuICAgIGlzQXBwbGljYWJsZSgpe1xuICAgICAgICB0aHJvdyAnaXNBcHBsaWNhYmxlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgY2FuIHBlcmZvcm0gb3BlcmF0aW9uIGZvciBhcHBsaWNhYmxlIG9iamVjdFxuICAgIGNhblBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ2NhblBlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgcGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAncGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtGbGlwU3VidHJlZX0gZnJvbSBcIi4vZmxpcC1zdWJ0cmVlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbnNNYW5hZ2VyIHtcblxuICAgIG9wZXJhdGlvbnMgPSBbXTtcbiAgICBvcGVyYXRpb25CeU5hbWUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnJlZ2lzdGVyT3BlcmF0aW9uKG5ldyBGbGlwU3VidHJlZShkYXRhLCBleHByZXNzaW9uRW5naW5lKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJPcGVyYXRpb24ob3BlcmF0aW9uKXtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zLnB1c2gob3BlcmF0aW9uKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25CeU5hbWVbb3BlcmF0aW9uLm5hbWVdID0gb3BlcmF0aW9uO1xuICAgIH1cblxuXG4gICAgZ2V0T3BlcmF0aW9uQnlOYW1lKG5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25CeU5hbWVbbmFtZV07XG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3Qpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zLmZpbHRlcihvcD0+b3AuaXNBcHBsaWNhYmxlKG9iamVjdCkpXG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBEZWNpc2lvbntcbiAgICBub2RlO1xuICAgIGRlY2lzaW9uVmFsdWU7IC8vaW5kZXggb2YgIHNlbGVjdGVkIGVkZ2VcbiAgICBjaGlsZHJlbiA9IFtdO1xuICAgIGtleTtcblxuICAgIGNvbnN0cnVjdG9yKG5vZGUsIGRlY2lzaW9uVmFsdWUpIHtcbiAgICAgICAgdGhpcy5ub2RlID0gbm9kZTtcbiAgICAgICAgdGhpcy5kZWNpc2lvblZhbHVlID0gZGVjaXNpb25WYWx1ZTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5PSckaWQnKXtcbiAgICAgICAgdmFyIGUgPSBkZWNpc2lvbi5ub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgIHZhciBrZXkgPSBkZWNpc2lvbi5ub2RlW2tleVByb3BlcnR5XStcIjpcIisoZVtrZXlQcm9wZXJ0eV0/IGVba2V5UHJvcGVydHldIDogZGVjaXNpb24uZGVjaXNpb25WYWx1ZSsxKTtcbiAgICAgICAgcmV0dXJuIGtleS5yZXBsYWNlKC9cXG4vZywgJyAnKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSlcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24oZGVjaXNpb24sIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGlmKGRlY2lzaW9uLm5vZGU9PT1kZWNpc2lvbk5vZGUgfHwgZGVjaXNpb24ubm9kZS4kaWQgPT09IGRlY2lzaW9uTm9kZS4kaWQpe1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICB9XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkID0gRGVjaXNpb24uZ2V0RGVjaXNpb24oZGVjaXNpb24uY2hpbGRyZW5baV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRpYyB0b0RlY2lzaW9uU3RyaW5nKGRlY2lzaW9uLCBleHRlbmRlZD1mYWxzZSwga2V5UHJvcGVydHk9J25hbWUnLCBpbmRlbnQgPSAnJyl7XG5cbiAgICAgICAgdmFyIHJlcyA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eSk7XG4gICAgICAgIHZhciBjaGlsZHJlblJlcyA9IFwiXCI7XG5cbiAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4uZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihjaGlsZHJlblJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSAnXFxuJytpbmRlbnQ7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLGV4dGVuZGVkLGtleVByb3BlcnR5LCBpbmRlbnQrJ1xcdCcpXG4gICAgICAgIH0pO1xuICAgICAgICBpZihkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGgpe1xuICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gICdcXG4nK2luZGVudCArY2hpbGRyZW5SZXM7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9IFwiIC0gKFwiICsgY2hpbGRyZW5SZXMgKyBcIilcIjtcbiAgICAgICAgICAgIH1cblxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXMrY2hpbGRyZW5SZXM7XG4gICAgfVxuXG4gICAgdG9EZWNpc2lvblN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljeVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWNpZXNDb2xsZWN0b3J7XG4gICAgcG9saWNpZXMgPSBbXTtcbiAgICBydWxlTmFtZT1mYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKHJvb3QsIG9wdGltYWxGb3JSdWxlTmFtZSl7XG4gICAgICAgIHRoaXMucnVsZU5hbWUgPSBvcHRpbWFsRm9yUnVsZU5hbWU7XG4gICAgICAgIHRoaXMuY29sbGVjdChyb290KS5mb3JFYWNoKChkZWNpc2lvbnMsaSk9PntcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXMucHVzaChuZXcgUG9saWN5KFwiI1wiKyhpKzEpLCBkZWNpc2lvbnMpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHRoaXMucG9saWNpZXMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzWzBdLmlkID0gXCJkZWZhdWx0XCJcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbGxlY3Qocm9vdCl7XG4gICAgICAgIHZhciBub2RlUXVldWUgPSBbcm9vdF07XG4gICAgICAgIHZhciBub2RlO1xuICAgICAgICB2YXIgZGVjaXNpb25Ob2RlcyA9IFtdO1xuICAgICAgICB3aGlsZShub2RlUXVldWUubGVuZ3RoKXtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlUXVldWUuc2hpZnQoKTtcblxuICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICBkZWNpc2lvbk5vZGVzLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuICAgICAgICAgICAgICAgIG5vZGVRdWV1ZS5wdXNoKGVkZ2UuY2hpbGROb2RlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YoZGVjaXNpb25Ob2Rlcy5tYXAoKGRlY2lzaW9uTm9kZSk9PntcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbnM9IFtdO1xuICAgICAgICAgICAgZGVjaXNpb25Ob2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcblxuICAgICAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIWVkZ2UuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZERlY2lzaW9ucyA9IHRoaXMuY29sbGVjdChlZGdlLmNoaWxkTm9kZSk7IC8vYWxsIHBvc3NpYmxlIGNoaWxkIGRlY2lzaW9ucyAoY2FydGVzaWFuKVxuICAgICAgICAgICAgICAgIGNoaWxkRGVjaXNpb25zLmZvckVhY2goY2Q9PntcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKGRlY2lzaW9uTm9kZSwgaSk7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9ucy5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4gPSBjZDtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbnM7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY3l7XG4gICAgaWQ7XG4gICAgZGVjaXNpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihpZCwgZGVjaXNpb25zKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyA9IGRlY2lzaW9ucyB8fCBbXTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShwb2xpY3kpe1xuICAgICAgICB2YXIga2V5ID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PmtleSs9KGtleT8gXCImXCI6IFwiXCIpK2Qua2V5KTtcbiAgICAgICAgcmV0dXJuIGtleTtcbiAgICB9XG5cbiAgICBlcXVhbHMocG9saWN5LCBpZ25vcmVJZD10cnVlKXtcbiAgICAgICAgaWYodGhpcy5rZXkgIT0gcG9saWN5LmtleSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWdub3JlSWQgfHwgdGhpcy5pZCA9PT0gcG9saWN5LmlkO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24ocG9saWN5LCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBmb3IodmFyIGk9MDsgaTxwb2xpY3kuZGVjaXNpb25zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IERlY2lzaW9uLmdldERlY2lzaW9uKHBvbGljeS5kZWNpc2lvbnNbaV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHN0YXRpYyB0b1BvbGljeVN0cmluZyhwb2xpY3ksIGV4dGVuZGVkPWZhbHNlLCBwcmVwZW5kSWQ9ZmFsc2Upe1xuXG4gICAgICAgIHZhciByZXMgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYocmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIlxcblwiXG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCwgZXh0ZW5kZWQsICduYW1lJywgJ1xcdCcpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYocHJlcGVuZElkICYmIHBvbGljeS5pZCE9PXVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gcG9saWN5LmlkK1wiIFwiK3JlcztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuXG4gICAgdG9Qb2xpY3lTdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS50b1BvbGljeVN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUGF5b2ZmVmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZS5jb21wYXJlKE51bWJlci5NSU5fU0FGRV9JTlRFR0VSKSA+PSAwICYmIHZhbHVlLmNvbXBhcmUoTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUsIGVkZ2Upe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlLmNvbXBhcmUoMCkgPj0gMCAmJiB2YWx1ZS5jb21wYXJlKDEpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsLCBWYWxpZGF0aW9uUmVzdWx0fSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1Byb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3Byb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQYXlvZmZWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcGF5b2ZmLXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgVHJlZVZhbGlkYXRvciB7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IgPSBuZXcgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvciA9IG5ldyBQYXlvZmZWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShub2Rlcykge1xuXG4gICAgICAgIHZhciB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKTtcblxuICAgICAgICBub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnZhbGlkYXRlTm9kZShuLCB2YWxpZGF0aW9uUmVzdWx0KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVOb2RlKG5vZGUsIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpKSB7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ2luY29tcGxldGVQYXRoJywgbm9kZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgIHZhciB3aXRoSGFzaCA9IGZhbHNlO1xuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgdHJ1ZSk7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3BheW9mZicsIHRydWUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHkgPSBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmKCFFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFByb2JhYmlsaXR5JywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gZS5jb21wdXRlZEJhc2VQYXlvZmYoKTtcbiAgICAgICAgICAgIGlmICghdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQYXlvZmYnLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdpbnZhbGlkUGF5b2ZmJywgZSk7XG4gICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwYXlvZmYnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBpZiAoaXNOYU4ocHJvYmFiaWxpdHlTdW0pIHx8ICFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdwcm9iYWJpbGl0eURvTm90U3VtVXBUbzEnLCBub2RlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9zcmMvaW5kZXgnXG4iXX0=
