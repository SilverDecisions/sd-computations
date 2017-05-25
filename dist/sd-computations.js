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
    this.jobRepositoryType = 'idb';
    this.clearRepository = false;

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
        this.objectiveRulesManager = new _objectiveRulesManager.ObjectiveRulesManager(this.expressionEngine, this.config.ruleName);
        this.operationsManager = new _operationsManager.OperationsManager(this.data, this.expressionEngine);
        this.jobsManger = new _jobsManager.JobsManager(this.expressionsEvaluator, this.objectiveRulesManager, {
            workerUrl: this.config.worker.url,
            repositoryType: this.config.jobRepositoryType,
            clearRepository: this.config.clearRepository
        });
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
        key: "flipCriteria",
        value: function flipCriteria(data) {
            data = data || this.data;
            data.reversePayoffs();
            var tmp = data.weightLowerBound;
            data.weightLowerBound = this.flip(data.weightUpperBound);
            data.weightUpperBound = this.flip(tmp);
            data.defaultCriterion1Weight = this.flip(data.defaultCriterion1Weight);
            this.objectiveRulesManager.flipRule();
            return this.checkValidityAndRecomputeObjective(false);
        }
    }, {
        key: "flip",
        value: function flip(a) {
            if (a == Infinity) {
                return 0;
            }

            if (a == 0) {
                return Infinity;
            }

            return _sdExpressionEngine.ExpressionEngine.divide(1, a);
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
        key: "getObjectiveRuleByName",
        value: function getObjectiveRuleByName(ruleName) {
            return this.objectiveRulesManager.getObjectiveRuleByName(ruleName);
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

            this.objectiveRulesManager.updateDefaultCriterion1Weight(data.defaultCriterion1Weight);
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

},{"./expressions-evaluator":5,"./jobs/job-instance-manager":58,"./jobs/jobs-manager":60,"./objective/objective-rules-manager":61,"./operations/operations-manager":77,"./policies/policy":80,"./validation/tree-validator":83,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],4:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ComputationsUtils = undefined;

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

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var ComputationsUtils = exports.ComputationsUtils = function () {
    function ComputationsUtils() {
        _classCallCheck(this, ComputationsUtils);
    }

    _createClass(ComputationsUtils, null, [{
        key: "sequence",
        value: function sequence(min, max, length) {
            var extent = _sdExpressionEngine.ExpressionEngine.subtract(max, min);
            var result = [min];
            var steps = length - 1;
            if (!steps) {
                return result;
            }
            var step = _sdExpressionEngine.ExpressionEngine.divide(extent, length - 1);
            var curr = min;
            for (var i = 0; i < length - 2; i++) {
                curr = _sdExpressionEngine.ExpressionEngine.add(curr, step);
                result.push(_sdExpressionEngine.ExpressionEngine.toFloat(curr));
            }
            result.push(max);
            return result;
        }
    }]);

    return ComputationsUtils;
}();

},{"sd-expression-engine":"sd-expression-engine"}],5:[function(require,module,exports){
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
                    e.payoff.forEach(function (rawPayoff, payoffIndex) {
                        var path = 'payoff[' + payoffIndex + ']';
                        if (e.isFieldValid(path, true, false)) {
                            try {
                                e.computedValue(null, path, _this2.expressionEngine.evalPayoff(e, payoffIndex));
                            } catch (err) {
                                //   Left empty intentionally
                            }
                        }
                    });

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

},{"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],6:[function(require,module,exports){
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

},{"./computations-engine":2,"./computations-manager":3,"./expressions-evaluator":5,"./jobs/index":57}],7:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.LeagueTableJobParameters = undefined;

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

var LeagueTableJobParameters = exports.LeagueTableJobParameters = function (_JobParameters) {
    _inherits(LeagueTableJobParameters, _JobParameters);

    function LeagueTableJobParameters() {
        _classCallCheck(this, LeagueTableJobParameters);

        return _possibleConstructorReturn(this, (LeagueTableJobParameters.__proto__ || Object.getPrototypeOf(LeagueTableJobParameters)).apply(this, arguments));
    }

    _createClass(LeagueTableJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("extendedPolicyDescription", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
            // this.definitions.push(new JobParameterDefinition("weightLowerBound", PARAMETER_TYPE.NUMBER).set("singleValueValidator", (v, allVals) => v >= 0 && v <= allVals['weightUpperBound']));
            // this.definitions.push(new JobParameterDefinition("weightUpperBound", PARAMETER_TYPE.NUMBER).set("singleValueValidator", (v, allVals) => v >= 0 && v >= allVals['weightLowerBound']));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                nameOfCriterion1: 'Cost',
                nameOfCriterion2: 'Effect',
                extendedPolicyDescription: true,
                weightLowerBound: 0,
                weightUpperBound: Infinity
            };
        }
    }]);

    return LeagueTableJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":44,"../../engine/job-parameters":45,"sd-utils":"sd-utils"}],8:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.LeagueTableJob = undefined;

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

var _policy = require("../../../policies/policy");

var _sdExpressionEngine = require("sd-expression-engine");

var _calculateStep = require("./steps/calculate-step");

var _leagueTableJobParameters = require("./league-table-job-parameters");

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

var LeagueTableJob = exports.LeagueTableJob = function (_SimpleJob) {
    _inherits(LeagueTableJob, _SimpleJob);

    function LeagueTableJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, LeagueTableJob);

        var _this = _possibleConstructorReturn(this, (LeagueTableJob.__proto__ || Object.getPrototypeOf(LeagueTableJob)).call(this, "league-table", jobRepository, expressionsEvaluator, objectiveRulesManager));

        _this.initSteps();
        return _this;
    }

    _createClass(LeagueTableJob, [{
        key: "initSteps",
        value: function initSteps() {
            this.calculateStep = new _calculateStep.CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
            this.addStep(this.calculateStep);
        }
    }, {
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _leagueTableJobParameters.LeagueTableJobParameters(values);
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
    }, {
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            var withHeaders = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var result = [];
            if (withHeaders) {
                var headers = ['policy_id', 'policy', jobResult.payoffNames[0], jobResult.payoffNames[1], 'dominated_by', 'extended-dominated_by', 'incratio'];
                result.push(headers);
            }

            jobResult.rows.forEach(function (row) {
                row.policies.forEach(function (policy) {
                    var rowCells = [row.id, _policy.Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription), row.payoffs[1], row.payoffs[0], row.dominatedBy, row.extendedDominatedBy === null ? null : row.extendedDominatedBy[0] + ', ' + row.extendedDominatedBy[1], row.incratio];
                    result.push(rowCells);
                });
            });

            return result;
        }
    }]);

    return LeagueTableJob;
}(_simpleJob.SimpleJob);

},{"../../../policies/policy":80,"../../engine/simple-job":53,"./league-table-job-parameters":7,"./steps/calculate-step":9,"sd-expression-engine":"sd-expression-engine"}],9:[function(require,module,exports){
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

var _step = require("../../../engine/step");

var _jobStatus = require("../../../engine/job-status");

var _policiesCollector = require("../../../../policies/policies-collector");

var _sdExpressionEngine = require("sd-expression-engine");

var _treeValidator = require("../../../../validation/tree-validator");

var _policy = require("../../../../policies/policy");

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

var CalculateStep = exports.CalculateStep = function (_Step) {
    _inherits(CalculateStep, _Step);

    function CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, CalculateStep);

        var _this = _possibleConstructorReturn(this, (CalculateStep.__proto__ || Object.getPrototypeOf(CalculateStep)).call(this, "calculate_step", jobRepository));

        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;
        _this.treeValidator = new _treeValidator.TreeValidator();
        return _this;
    }

    _createClass(CalculateStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var _this2 = this;

            var data = stepExecution.getData();
            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            var rule = this.objectiveRulesManager.currentRule;
            var treeRoot = data.getRoots()[0];
            var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot);

            var policies = policiesCollector.policies;

            var payoffCoeffs = this.payoffCoeffs = rule.payoffCoeffs;

            this.expressionsEvaluator.evalExpressions(data);
            var vr = this.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));

            if (!vr.isValid()) {
                return stepExecution;
            }

            var compare = function compare(a, b) {
                return -payoffCoeffs[0] * (b.payoffs[0] - a.payoffs[0]) || -payoffCoeffs[1] * (a.payoffs[1] - b.payoffs[1]);
            };

            var rows = policies.map(function (policy) {
                _this2.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                return {
                    policies: [policy],
                    payoffs: treeRoot.computedValue(ruleName, 'payoff').slice(),
                    dominatedBy: null,
                    extendedDominatedBy: null,
                    incratio: null
                };
            }).sort(compare);

            rows = rows.reduce(function (previousValue, currentValue, index, array) {
                if (!previousValue.length) {
                    return [currentValue];
                }

                var prev = previousValue[previousValue.length - 1];
                if (compare(prev, currentValue) == 0) {
                    var _prev$policies;

                    (_prev$policies = prev.policies).push.apply(_prev$policies, _toConsumableArray(currentValue.policies));
                    return previousValue;
                }
                return previousValue.concat(currentValue);
            }, []);

            rows.sort(function (a, b) {
                return payoffCoeffs[0] * (a.payoffs[0] - b.payoffs[0]) || -payoffCoeffs[1] * (a.payoffs[1] - b.payoffs[1]);
            });
            rows.forEach(function (r, i) {
                r.id = i + 1;
            });
            // rows.sort(compare);
            rows.sort(function (a, b) {
                return -payoffCoeffs[0] * (a.payoffs[0] - b.payoffs[0]) || -payoffCoeffs[1] * (a.payoffs[1] - b.payoffs[1]);
            });

            var bestCost = -payoffCoeffs[1] * Infinity,
                bestCostRow = null;

            var cmp = function cmp(a, b) {
                return a > b;
            };
            if (payoffCoeffs[1] < 0) {
                cmp = function cmp(a, b) {
                    return a < b;
                };
            }

            rows.forEach(function (r, i) {
                if (cmp(r.payoffs[1], bestCost)) {
                    bestCost = r.payoffs[1];
                    bestCostRow = r;
                } else if (bestCostRow) {
                    r.dominatedBy = bestCostRow.id;
                }
            });

            cmp = function cmp(a, b) {
                return a < b;
            };
            if (payoffCoeffs[0] > 0 && payoffCoeffs[1] < 0) {
                cmp = function cmp(a, b) {
                    return a < b;
                };
            } else if (payoffCoeffs[0] < 0 && payoffCoeffs[1] > 0) {
                cmp = function cmp(a, b) {
                    return a < b;
                };
            } else if (payoffCoeffs[1] < 0) {
                cmp = function cmp(a, b) {
                    return a > b;
                };
            }

            rows.filter(function (r) {
                return !r.dominatedBy;
            }).sort(function (a, b) {
                return payoffCoeffs[0] * (a.payoffs[0] - b.payoffs[0]);
            }).forEach(function (r, i, arr) {
                if (i == 0) {
                    r.incratio = 0;
                    return;
                }

                var prev = arr[i - 1];

                r.incratio = _this2.computeICER(r, prev);
                if (i < 2) {
                    return;
                }

                var prev2 = arr[i - 2];
                if (prev2.extendedDominatedBy !== null) {
                    return;
                }

                if (cmp(r.incratio, prev.incratio)) {
                    prev.incratio = null;
                    prev.extendedDominatedBy = [prev2.id, r.id];

                    r.incratio = _this2.computeICER(r, prev2);
                }
            });

            var weightLowerBound = data.weightLowerBound;
            var weightUpperBound = data.weightUpperBound;
            //mark optimal for weight in [weightLowerBound, weightUpperBound]
            var lastLELower = null;
            rows.slice().filter(function (r) {
                return !r.dominatedBy && !r.extendedDominatedBy;
            }).sort(function (a, b) {
                return a.incratio - b.incratio;
            }).forEach(function (row, i, arr) {

                if (row.incratio <= weightLowerBound) {
                    lastLELower = row;
                } else if (row.incratio == weightLowerBound) {
                    lastLELower = null;
                }

                row.optimal = row.incratio >= weightLowerBound && row.incratio <= weightUpperBound;
            });
            if (lastLELower) {
                lastLELower.optimal = true;
            }

            rows.forEach(function (row) {
                row.payoffs[0] = _sdExpressionEngine.ExpressionEngine.toFloat(row.payoffs[0]);
                row.payoffs[1] = _sdExpressionEngine.ExpressionEngine.toFloat(row.payoffs[1]);
                row.incratio = row.incratio === null ? null : _sdExpressionEngine.ExpressionEngine.toFloat(row.incratio);
            });

            jobResult.data = {
                payoffNames: data.payoffNames.slice(),
                payoffCoeffs: payoffCoeffs,
                rows: rows.sort(function (a, b) {
                    return a.id - b.id;
                })
            };

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }, {
        key: "computeICER",
        value: function computeICER(r, prev) {
            var d = _sdExpressionEngine.ExpressionEngine.subtract(r.payoffs[0], prev.payoffs[0]);
            var n = _sdExpressionEngine.ExpressionEngine.subtract(r.payoffs[1], prev.payoffs[1]);
            if (d == 0) {
                if (n < 0) {
                    return -Infinity;
                }
                return Infinity;
            }
            return Math.abs(_sdExpressionEngine.ExpressionEngine.divide(n, d));
        }
    }]);

    return CalculateStep;
}(_step.Step);

},{"../../../../policies/policies-collector":79,"../../../../policies/policy":80,"../../../../validation/tree-validator":83,"../../../engine/job-status":51,"../../../engine/step":56,"sd-expression-engine":"sd-expression-engine"}],10:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":44,"../../engine/job-parameters":45,"sd-utils":"sd-utils"}],11:[function(require,module,exports){
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

},{"../../../validation/tree-validator":83,"../../engine/batch/batch-step":26,"../../engine/job":52,"../../engine/job-status":51,"../../engine/simple-job":53,"../../engine/step":56,"./recompute-job-parameters":10}],12:[function(require,module,exports){
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

var _jobParameters = require("../../../engine/job-parameters");

var _jobParameterDefinition = require("../../../engine/job-parameter-definition");

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
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("failOnInvalidTree", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("variables", [new _jobParameterDefinition.JobParameterDefinition("name", _jobParameterDefinition.PARAMETER_TYPE.STRING), new _jobParameterDefinition.JobParameterDefinition("min", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("max", _jobParameterDefinition.PARAMETER_TYPE.NUMBER), new _jobParameterDefinition.JobParameterDefinition("length", _jobParameterDefinition.PARAMETER_TYPE.INTEGER).set("singleValueValidator", function (v) {
                return v >= 2;
            })], 1, Infinity, false, function (v) {
                return v["min"] < v["max"];
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
                extendedPolicyDescription: true,
                failOnInvalidTree: true
            };
        }
    }]);

    return SensitivityAnalysisJobParameters;
}(_jobParameters.JobParameters);

},{"../../../engine/job-parameter-definition":44,"../../../engine/job-parameters":45,"sd-utils":"sd-utils"}],13:[function(require,module,exports){
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

var _simpleJob = require("../../../engine/simple-job");

var _sensitivityAnalysisJobParameters = require("./sensitivity-analysis-job-parameters");

var _prepareVariablesStep = require("./steps/prepare-variables-step");

var _initPoliciesStep = require("./steps/init-policies-step");

var _calculateStep = require("./steps/calculate-step");

var _policy = require("../../../../policies/policy");

var _sdUtils = require("sd-utils");

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

var SensitivityAnalysisJob = exports.SensitivityAnalysisJob = function (_SimpleJob) {
    _inherits(SensitivityAnalysisJob, _SimpleJob);

    function SensitivityAnalysisJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        var batchSize = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 5;

        _classCallCheck(this, SensitivityAnalysisJob);

        var _this = _possibleConstructorReturn(this, (SensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(SensitivityAnalysisJob)).call(this, "sensitivity-analysis", jobRepository, expressionsEvaluator, objectiveRulesManager));

        _this.batchSize = 5;
        _this.initSteps();
        return _this;
    }

    _createClass(SensitivityAnalysisJob, [{
        key: "initSteps",
        value: function initSteps() {
            this.addStep(new _prepareVariablesStep.PrepareVariablesStep(this.jobRepository, this.expressionsEvaluator.expressionEngine));
            this.addStep(new _initPoliciesStep.InitPoliciesStep(this.jobRepository));
            this.calculateStep = new _calculateStep.CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager, this.batchSize);
            this.addStep(this.calculateStep);
        }
    }, {
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
    }, {
        key: "setBatchSize",
        value: function setBatchSize(batchSize) {
            this.batchSize = batchSize;
            this.calculateStep.chunkSize = batchSize;
        }
    }, {
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            var withHeaders = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var result = [];
            if (withHeaders) {
                var headers = ['policy_number', 'policy'];
                jobResult.variableNames.forEach(function (n) {
                    return headers.push(n);
                });
                headers.push('payoff');
                result.push(headers);
            }

            var roundVariables = !!jobParameters.values.roundVariables;
            if (roundVariables) {
                this.roundVariables(jobResult);
            }

            jobResult.rows.forEach(function (row) {
                var policy = jobResult.policies[row.policyIndex];
                var rowCells = [row.policyIndex + 1, _policy.Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription)];
                row.variables.forEach(function (v) {
                    return rowCells.push(v);
                });
                rowCells.push(row.payoff);
                result.push(rowCells);

                if (row._variables) {
                    //revert original variables
                    row.variables = row._variables;
                    delete row._variables;
                }
            });

            return result;
        }
    }, {
        key: "roundVariables",
        value: function roundVariables(jobResult) {
            var uniqueValues = jobResult.variableNames.map(function () {
                return new Set();
            });

            jobResult.rows.forEach(function (row) {
                row._variables = row.variables.slice(); // save original row variables
                row.variables.forEach(function (v, i) {
                    uniqueValues[i].add(v);
                });
            });

            var uniqueValuesNo = uniqueValues.map(function (s) {
                return s.size;
            });
            var maxPrecision = 14;
            var precision = 2;
            var notReadyVariablesIndexes = jobResult.variableNames.map(function (v, i) {
                return i;
            });
            while (precision <= maxPrecision && notReadyVariablesIndexes.length) {
                uniqueValues = notReadyVariablesIndexes.map(function () {
                    return new Set();
                });
                jobResult.rows.forEach(function (row) {
                    notReadyVariablesIndexes.forEach(function (variableIndex, notReadyIndex) {

                        var val = row._variables[variableIndex];
                        val = _sdUtils.Utils.round(val, precision);
                        uniqueValues[notReadyIndex].add(val);

                        row.variables[variableIndex] = val;
                    });
                });

                var newReadyIndexes = [];
                uniqueValues.forEach(function (uniqueVals, notReadyIndex) {
                    var origUniqueCount = uniqueValuesNo[notReadyVariablesIndexes[notReadyIndex]];
                    if (origUniqueCount == uniqueVals.size) {
                        //ready in previous iteration
                        newReadyIndexes.push(notReadyIndex);
                    }
                });
                if (newReadyIndexes.length) {
                    //revert values to prev iteration
                    newReadyIndexes.reverse();
                    newReadyIndexes.forEach(function (notReadyIndex) {
                        notReadyVariablesIndexes.splice(notReadyIndex, 1);
                    });
                }
                precision++;
            }
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

},{"../../../../policies/policy":80,"../../../engine/simple-job":53,"./sensitivity-analysis-job-parameters":12,"./steps/calculate-step":14,"./steps/init-policies-step":15,"./steps/prepare-variables-step":16,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],14:[function(require,module,exports){
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

var _batchStep = require("../../../../engine/batch/batch-step");

var _treeValidator = require("../../../../../validation/tree-validator");

var _policy = require("../../../../../policies/policy");

var _jobComputationException = require("../../../../engine/exceptions/job-computation-exception");

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

    function CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager, batchSize) {
        _classCallCheck(this, CalculateStep);

        var _this = _possibleConstructorReturn(this, (CalculateStep.__proto__ || Object.getPrototypeOf(CalculateStep)).call(this, "calculate_step", jobRepository, batchSize));

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

            if (!jobResult.data.rows) {
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
            var failOnInvalidTree = params.value("failOnInvalidTree");
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

            if (!valid && failOnInvalidTree) {
                var errorData = {
                    variables: {}
                };
                variableNames.forEach(function (variableName, i) {
                    errorData.variables[variableName] = item[i];
                });
                throw new _jobComputationException.JobComputationException("computations", errorData);
            }

            var payoffs = [];

            policies.forEach(function (policy) {
                var payoff = 'n/a';
                if (valid) {
                    _this2.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                    payoff = treeRoot.computedValue(ruleName, 'payoff')[0];
                }
                payoffs.push(payoff);
            });

            return {
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
                    var variables = item.variables.map(function (v) {
                        return _this3.toFloat(v);
                    });

                    var payoff = item.payoffs[i];
                    var row = {
                        policyIndex: i,
                        variables: variables,
                        payoff: _sdUtils.Utils.isString(payoff) ? payoff : _this3.toFloat(payoff)
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

},{"../../../../../policies/policy":80,"../../../../../validation/tree-validator":83,"../../../../engine/batch/batch-step":26,"../../../../engine/exceptions/job-computation-exception":29,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],15:[function(require,module,exports){
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

var _step = require("../../../../engine/step");

var _jobStatus = require("../../../../engine/job-status");

var _policiesCollector = require("../../../../../policies/policies-collector");

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

            if (!jobResult.data) {
                jobResult.data = {};
            }

            jobResult.data.policies = policies;

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return InitPoliciesStep;
}(_step.Step);

},{"../../../../../policies/policies-collector":79,"../../../../engine/job-status":51,"../../../../engine/step":56}],16:[function(require,module,exports){
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

var _step = require("../../../../engine/step");

var _jobStatus = require("../../../../engine/job-status");

var _computationsUtils = require("../../../../../computations-utils");

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
            var params = stepExecution.getJobParameters();
            var variables = params.value("variables");

            var variableValues = [];
            variables.forEach(function (v) {
                variableValues.push(_computationsUtils.ComputationsUtils.sequence(v.min, v.max, v.length));
            });
            variableValues = _sdUtils.Utils.cartesianProductOf(variableValues);
            jobResult.data = {
                variableValues: variableValues
            };
            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return PrepareVariablesStep;
}(_step.Step);

},{"../../../../../computations-utils":4,"../../../../engine/job-status":51,"../../../../engine/step":56,"sd-utils":"sd-utils"}],17:[function(require,module,exports){
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

var _jobParameters = require("../../../engine/job-parameters");

var _jobParameterDefinition = require("../../../engine/job-parameter-definition");

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
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("failOnInvalidTree", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
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
                extendedPolicyDescription: true,
                failOnInvalidTree: true
            };
        }
    }]);

    return ProbabilisticSensitivityAnalysisJobParameters;
}(_jobParameters.JobParameters);

},{"../../../engine/job-parameter-definition":44,"../../../engine/job-parameters":45,"sd-utils":"sd-utils"}],18:[function(require,module,exports){
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

var _probabilisticSensitivityAnalysisJobParameters = require("./probabilistic-sensitivity-analysis-job-parameters");

var _initPoliciesStep = require("../n-way/steps/init-policies-step");

var _sensitivityAnalysisJob = require("../n-way/sensitivity-analysis-job");

var _probCalculateStep = require("./steps/prob-calculate-step");

var _computePolicyStatsStep = require("./steps/compute-policy-stats-step");

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

var ProbabilisticSensitivityAnalysisJob = exports.ProbabilisticSensitivityAnalysisJob = function (_SensitivityAnalysisJ) {
    _inherits(ProbabilisticSensitivityAnalysisJob, _SensitivityAnalysisJ);

    function ProbabilisticSensitivityAnalysisJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        var batchSize = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 5;

        _classCallCheck(this, ProbabilisticSensitivityAnalysisJob);

        var _this = _possibleConstructorReturn(this, (ProbabilisticSensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(ProbabilisticSensitivityAnalysisJob)).call(this, jobRepository, expressionsEvaluator, objectiveRulesManager, batchSize));

        _this.name = "probabilistic-sensitivity-analysis";
        return _this;
    }

    _createClass(ProbabilisticSensitivityAnalysisJob, [{
        key: "initSteps",
        value: function initSteps() {
            this.addStep(new _initPoliciesStep.InitPoliciesStep(this.jobRepository));
            this.calculateStep = new _probCalculateStep.ProbCalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager, this.batchSize);
            this.addStep(this.calculateStep);
            this.addStep(new _computePolicyStatsStep.ComputePolicyStatsStep(this.expressionsEvaluator.expressionEngine, this.objectiveRulesManager, this.jobRepository));
        }
    }, {
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _probabilisticSensitivityAnalysisJobParameters.ProbabilisticSensitivityAnalysisJobParameters(values);
        }

        /*Should return progress object with fields:
         * current
         * total */

    }, {
        key: "getProgress",
        value: function getProgress(execution) {

            if (execution.stepExecutions.length <= 1) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[1].getProgress(execution.stepExecutions[1]);
        }
    }]);

    return ProbabilisticSensitivityAnalysisJob;
}(_sensitivityAnalysisJob.SensitivityAnalysisJob);

},{"../n-way/sensitivity-analysis-job":13,"../n-way/steps/init-policies-step":15,"./probabilistic-sensitivity-analysis-job-parameters":17,"./steps/compute-policy-stats-step":19,"./steps/prob-calculate-step":20}],19:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ComputePolicyStatsStep = undefined;

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

var _step = require("../../../../engine/step");

var _jobStatus = require("../../../../engine/job-status");

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

var ComputePolicyStatsStep = exports.ComputePolicyStatsStep = function (_Step) {
    _inherits(ComputePolicyStatsStep, _Step);

    function ComputePolicyStatsStep(expressionEngine, objectiveRulesManager, jobRepository) {
        _classCallCheck(this, ComputePolicyStatsStep);

        var _this = _possibleConstructorReturn(this, (ComputePolicyStatsStep.__proto__ || Object.getPrototypeOf(ComputePolicyStatsStep)).call(this, "compute_policy_stats", jobRepository));

        _this.expressionEngine = expressionEngine;
        _this.objectiveRulesManager = objectiveRulesManager;
        return _this;
    }

    _createClass(ComputePolicyStatsStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution, jobResult) {
            var params = stepExecution.getJobParameters();
            var numberOfRuns = params.value("numberOfRuns");
            var ruleName = params.value("ruleName");

            var rule = this.objectiveRulesManager.ruleByName[ruleName];

            var payoffsPerPolicy = jobResult.data.policies.map(function () {
                return [];
            });

            jobResult.data.rows.forEach(function (row) {
                payoffsPerPolicy[row.policyIndex].push(_sdUtils.Utils.isString(row.payoff) ? 0 : row.payoff);
            });

            _sdUtils.log.debug('payoffsPerPolicy', payoffsPerPolicy, jobResult.data.rows.length, rule.maximization);

            jobResult.data.medians = payoffsPerPolicy.map(function (payoffs) {
                return _sdExpressionEngine.ExpressionEngine.median(payoffs);
            });
            jobResult.data.standardDeviations = payoffsPerPolicy.map(function (payoffs) {
                return _sdExpressionEngine.ExpressionEngine.std(payoffs);
            });

            if (rule.maximization) {
                jobResult.data.policyIsBestProbabilities = jobResult.data.policyToHighestPayoffCount.map(function (v) {
                    return _sdExpressionEngine.ExpressionEngine.toFloat(_sdExpressionEngine.ExpressionEngine.divide(v, numberOfRuns));
                });
            } else {
                jobResult.data.policyIsBestProbabilities = jobResult.data.policyToLowestPayoffCount.map(function (v) {
                    return _sdExpressionEngine.ExpressionEngine.toFloat(_sdExpressionEngine.ExpressionEngine.divide(v, numberOfRuns));
                });
            }

            jobResult.data.policyToHighestPayoffCount = jobResult.data.policyToHighestPayoffCount.map(function (v) {
                return _sdExpressionEngine.ExpressionEngine.toFloat(v);
            });
            jobResult.data.policyToLowestPayoffCount = jobResult.data.policyToLowestPayoffCount.map(function (v) {
                return _sdExpressionEngine.ExpressionEngine.toFloat(v);
            });

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return ComputePolicyStatsStep;
}(_step.Step);

},{"../../../../engine/job-status":51,"../../../../engine/step":56,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],20:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.ProbCalculateStep = undefined;

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

var _sdExpressionEngine = require("sd-expression-engine");

var _calculateStep = require("../../n-way/steps/calculate-step");

var _jobComputationException = require("../../../../engine/exceptions/job-computation-exception");

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

var ProbCalculateStep = exports.ProbCalculateStep = function (_CalculateStep) {
    _inherits(ProbCalculateStep, _CalculateStep);

    function ProbCalculateStep() {
        _classCallCheck(this, ProbCalculateStep);

        return _possibleConstructorReturn(this, (ProbCalculateStep.__proto__ || Object.getPrototypeOf(ProbCalculateStep)).apply(this, arguments));
    }

    _createClass(ProbCalculateStep, [{
        key: "init",
        value: function init(stepExecution, jobResult) {
            var jobExecutionContext = stepExecution.getJobExecutionContext();
            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");

            this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            var variableNames = params.value("variables").map(function (v) {
                return v.name;
            });
            stepExecution.executionContext.put("variableNames", variableNames);

            if (!jobResult.data.rows) {
                jobResult.data.rows = [];
                jobResult.data.variableNames = variableNames;
                jobResult.data.expectedValues = _sdUtils.Utils.fill(new Array(jobResult.data.policies.length), 0);
                jobResult.data.policyToHighestPayoffCount = _sdUtils.Utils.fill(new Array(jobResult.data.policies.length), 0);
                jobResult.data.policyToLowestPayoffCount = _sdUtils.Utils.fill(new Array(jobResult.data.policies.length), 0);
            }

            return params.value("numberOfRuns");
        }
    }, {
        key: "readNextChunk",
        value: function readNextChunk(stepExecution, startIndex, chunkSize, jobResult) {
            var _this2 = this;

            var params = stepExecution.getJobParameters();
            var variables = params.value("variables");
            var data = stepExecution.getData();
            var variableValues = [];
            for (var runIndex = 0; runIndex < chunkSize; runIndex++) {
                var singleRunVariableValues = [];
                var errors = [];
                variables.forEach(function (v) {
                    try {
                        var evaluated = _this2.expressionsEvaluator.expressionEngine.eval(v.formula, true, _sdUtils.Utils.cloneDeep(data.expressionScope));
                        singleRunVariableValues.push(_sdExpressionEngine.ExpressionEngine.toFloat(evaluated));
                    } catch (e) {
                        errors.push({
                            variable: v,
                            error: e
                        });
                    }
                });
                if (errors.length) {
                    var errorData = { variables: [] };
                    errors.forEach(function (e) {
                        errorData.variables[e.variable.name] = e.error.message;
                    });
                    throw new _jobComputationException.JobComputationException("param-computation", errorData);
                }
                variableValues.push(singleRunVariableValues);
            }

            return variableValues;
        }
    }, {
        key: "processItem",
        value: function processItem(stepExecution, item, currentItemCount, jobResult) {
            var r = _get(ProbCalculateStep.prototype.__proto__ || Object.getPrototypeOf(ProbCalculateStep.prototype), "processItem", this).call(this, stepExecution, item, jobResult);

            var params = stepExecution.getJobParameters();
            var numberOfRuns = params.value("numberOfRuns");
            var policies = stepExecution.getJobExecutionContext().get("policies");

            this.updatePolicyStats(r, policies, numberOfRuns, jobResult);

            return r;
        }
    }, {
        key: "updatePolicyStats",
        value: function updatePolicyStats(r, policies, numberOfRuns, jobResult) {
            var highestPayoff = -Infinity;
            var lowestPayoff = Infinity;
            var bestPolicyIndexes = [];
            var worstPolicyIndexes = [];

            var zeroNum = _sdExpressionEngine.ExpressionEngine.toNumber(0);

            policies.forEach(function (policy, i) {
                var payoff = r.payoffs[i];
                if (_sdUtils.Utils.isString(payoff)) {
                    payoff = zeroNum;
                }
                if (payoff < lowestPayoff) {
                    lowestPayoff = payoff;
                    worstPolicyIndexes = [i];
                } else if (payoff.equals(lowestPayoff)) {
                    worstPolicyIndexes.push(i);
                }
                if (payoff > highestPayoff) {
                    highestPayoff = payoff;
                    bestPolicyIndexes = [i];
                } else if (payoff.equals(highestPayoff)) {
                    bestPolicyIndexes.push(i);
                }

                jobResult.data.expectedValues[i] = _sdExpressionEngine.ExpressionEngine.add(jobResult.data.expectedValues[i], _sdExpressionEngine.ExpressionEngine.divide(payoff, numberOfRuns));
            });

            bestPolicyIndexes.forEach(function (policyIndex) {
                jobResult.data.policyToHighestPayoffCount[policyIndex] = _sdExpressionEngine.ExpressionEngine.add(jobResult.data.policyToHighestPayoffCount[policyIndex], _sdExpressionEngine.ExpressionEngine.divide(1, bestPolicyIndexes.length));
            });

            worstPolicyIndexes.forEach(function (policyIndex) {
                jobResult.data.policyToLowestPayoffCount[policyIndex] = _sdExpressionEngine.ExpressionEngine.add(jobResult.data.policyToLowestPayoffCount[policyIndex], _sdExpressionEngine.ExpressionEngine.divide(1, worstPolicyIndexes.length));
            });
        }
    }, {
        key: "postProcess",
        value: function postProcess(stepExecution, jobResult) {
            var _this3 = this;

            jobResult.data.expectedValues = jobResult.data.expectedValues.map(function (v) {
                return _this3.toFloat(v);
            });
        }
    }, {
        key: "toFloat",
        value: function toFloat(v) {
            return _sdExpressionEngine.ExpressionEngine.toFloat(v);
        }
    }]);

    return ProbCalculateStep;
}(_calculateStep.CalculateStep);

},{"../../../../engine/exceptions/job-computation-exception":29,"../../n-way/steps/calculate-step":14,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],21:[function(require,module,exports){
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

var _batchStep = require("../../../../engine/batch/batch-step");

var _treeValidator = require("../../../../../validation/tree-validator");

var _policy = require("../../../../../policies/policy");

var _policiesCollector = require("../../../../../policies/policies-collector");

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

},{"../../../../../policies/policies-collector":79,"../../../../../policies/policy":80,"../../../../../validation/tree-validator":83,"../../../../engine/batch/batch-step":26,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],22:[function(require,module,exports){
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

var _step = require("../../../../engine/step");

var _jobStatus = require("../../../../engine/job-status");

var _policiesCollector = require("../../../../../policies/policies-collector");

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

},{"../../../../../policies/policies-collector":79,"../../../../engine/job-status":51,"../../../../engine/step":56,"sd-utils":"sd-utils"}],23:[function(require,module,exports){
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

var _step = require("../../../../engine/step");

var _jobStatus = require("../../../../engine/job-status");

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

},{"../../../../engine/job-status":51,"../../../../engine/step":56,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],24:[function(require,module,exports){
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

var _jobParameters = require("../../../engine/job-parameters");

var _jobParameterDefinition = require("../../../engine/job-parameter-definition");

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

},{"../../../engine/job-parameter-definition":44,"../../../engine/job-parameters":45,"sd-utils":"sd-utils"}],25:[function(require,module,exports){
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

var _simpleJob = require("../../../engine/simple-job");

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

},{"../../../engine/simple-job":53,"./steps/calculate-step":21,"./steps/init-policies-step":22,"./steps/prepare-variables-step":23,"./tornado-diagram-job-parameters":24}],26:[function(require,module,exports){
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
        value: function processItem(stepExecution, item, currentItemCount, jobResult) {
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

},{"../exceptions/job-interrupted-exception":33,"../job-status":51,"../step":56,"sd-utils":"sd-utils"}],27:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

var ExtendableError = exports.ExtendableError = function ExtendableError(message, data) {
    _classCallCheck(this, ExtendableError);

    this.message = message;
    this.data = data;
    this.name = this.constructor.name;
};

},{}],28:[function(require,module,exports){
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

},{"./extendable-error":27,"./job-data-invalid-exception":30,"./job-execution-already-running-exception":31,"./job-instance-already-complete-exception":32,"./job-interrupted-exception":33,"./job-parameters-invalid-exception":34,"./job-restart-exception":35}],29:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.JobComputationException = undefined;

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

var JobComputationException = exports.JobComputationException = function (_ExtendableError) {
  _inherits(JobComputationException, _ExtendableError);

  function JobComputationException() {
    _classCallCheck(this, JobComputationException);

    return _possibleConstructorReturn(this, (JobComputationException.__proto__ || Object.getPrototypeOf(JobComputationException)).apply(this, arguments));
  }

  return JobComputationException;
}(_extendableError.ExtendableError);

},{"./extendable-error":27}],30:[function(require,module,exports){
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

},{"./extendable-error":27}],31:[function(require,module,exports){
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

},{"./extendable-error":27}],32:[function(require,module,exports){
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

},{"./extendable-error":27}],33:[function(require,module,exports){
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

},{"./extendable-error":27}],34:[function(require,module,exports){
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

},{"./extendable-error":27}],35:[function(require,module,exports){
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

},{"./extendable-error":27}],36:[function(require,module,exports){
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

},{"sd-utils":"sd-utils"}],37:[function(require,module,exports){
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

},{"./exceptions":28,"./execution-context":36,"./job":52,"./job-execution":40,"./job-execution-flag":38,"./job-execution-listener":39,"./job-instance":41,"./job-key-generator":42,"./job-launcher":43,"./job-parameter-definition":44,"./job-parameters":45,"./job-status":51,"./simple-job":53,"./step":56,"./step-execution":55,"./step-execution-listener":54}],38:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
var JOB_EXECUTION_FLAG = exports.JOB_EXECUTION_FLAG = {
    STOP: 'STOP'
};

},{}],39:[function(require,module,exports){
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

},{}],40:[function(require,module,exports){
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

},{"./execution-context":36,"./job-status":51,"./step-execution":55,"sd-utils":"sd-utils"}],41:[function(require,module,exports){
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

},{}],42:[function(require,module,exports){
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

},{}],43:[function(require,module,exports){
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

},{"./exceptions/job-data-invalid-exception":30,"./exceptions/job-parameters-invalid-exception":34,"./exceptions/job-restart-exception":35,"./job-status":51,"sd-utils":"sd-utils"}],44:[function(require,module,exports){
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
        value: function validate(value, allValues) {
            var _this = this;

            var isArray = _sdUtils.Utils.isArray(value);

            if (this.maxOccurs > 1 && !isArray) {
                return false;
            }

            if (!isArray) {
                return this.validateSingleValue(value, allValues);
            }

            if (value.length < this.minOccurs || value.length > this.maxOccurs) {
                return false;
            }

            if (!value.every(function (v) {
                return _this.validateSingleValue(v, value);
            })) {
                return false;
            }

            if (this.validator) {
                return this.validator(value, allValues);
            }

            return true;
        }
        // allValues - all values on the same level

    }, {
        key: 'validateSingleValue',
        value: function validateSingleValue(value, allValues) {
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
                return this.singleValueValidator(value, allValues);
            }

            return true;
        }
    }]);

    return JobParameterDefinition;
}();

},{"sd-utils":"sd-utils"}],45:[function(require,module,exports){
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
                return def.validate(_this.values[def.name], _this.values);
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

},{"./job-parameter-definition":44,"sd-utils":"sd-utils"}],46:[function(require,module,exports){
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
            }).catch(function (e) {
                _sdUtils.log.error(e);
                _this.initDB();
            });
        } else {
            _this.initDB();
        }
        return _this;
    }

    _createClass(IdbJobRepository, [{
        key: "initDB",
        value: function initDB() {
            this.dbPromise = _idb2.default.open(this.dbName, 2, function (upgradeDB) {
                // Note: we don't use 'break' in this switch statement,
                // the fall-through behaviour is what we want.
                switch (upgradeDB.oldVersion) {
                    case 0:
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
                    case 1:
                        upgradeDB.transaction.objectStore('job-instances').createIndex("id", "id", { unique: true });
                }
            });

            this.jobInstanceDao = new ObjectStoreDao('job-instances', this.dbPromise);
            this.jobExecutionDao = new ObjectStoreDao('job-executions', this.dbPromise);
            this.jobExecutionProgressDao = new ObjectStoreDao('job-execution-progress', this.dbPromise);
            this.jobExecutionFlagDao = new ObjectStoreDao('job-execution-flags', this.dbPromise);
            this.stepExecutionDao = new ObjectStoreDao('step-executions', this.dbPromise);
            this.jobResultDao = new ObjectStoreDao('job-results', this.dbPromise);
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
        key: "removeJobInstance",
        value: function removeJobInstance(jobInstance, jobParameters) {
            var _this3 = this;

            var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
            return this.jobInstanceDao.remove(key).then(function () {
                _this3.findJobExecutions(jobInstance, false).then(function (jobExecutions) {
                    //  Not waiting for promise resolves
                    jobExecutions.forEach(_this3.removeJobExecution, _this3);
                });

                _this3.getJobResultByInstance(jobInstance).then(function (jobResult) {
                    return _this3.removeJobResult(jobResult);
                });
            });
        }
    }, {
        key: "removeJobExecution",
        value: function removeJobExecution(jobExecution) {
            var _this4 = this;

            return this.jobExecutionDao.remove(jobExecution.id).then(function () {
                return _this4.findStepExecutions(jobExecution.id, false).then(function (stepExecutions) {
                    // Not waiting for promise resolves
                    stepExecutions.forEach(_this4.removeStepExecution, _this4);
                });
            });
        }
    }, {
        key: "removeStepExecution",
        value: function removeStepExecution(stepExecution) {
            return this.stepExecutionDao.remove(stepExecution.id);
        }
    }, {
        key: "removeJobResult",
        value: function removeJobResult(jobResult) {
            return this.jobResultDao.remove(jobResult.id);
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
            var _this5 = this;

            var key = this.generateJobInstanceKey(jobName, jobParameters);
            return this.jobInstanceDao.get(key).then(function (dto) {
                return dto ? _this5.reviveJobInstance(dto) : dto;
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
            var _this6 = this;

            var dto = jobExecution.getDTO();
            var stepExecutionsDTOs = dto.stepExecutions;
            dto.stepExecutions = null;
            return this.jobExecutionDao.set(jobExecution.id, dto).then(function (r) {
                return _this6.saveStepExecutionsDTOS(stepExecutionsDTOs);
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
            var _this7 = this;

            var savedExecutions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

            if (stepExecutions.length <= savedExecutions.length) {
                return Promise.resolve(savedExecutions);
            }
            var stepExecutionDTO = stepExecutions[savedExecutions.length];
            return this.stepExecutionDao.set(stepExecutionDTO.id, stepExecutionDTO).then(function () {
                savedExecutions.push(stepExecutionDTO);
                return _this7.saveStepExecutionsDTOS(stepExecutions, savedExecutions);
            });
        }
    }, {
        key: "getJobExecutionById",
        value: function getJobExecutionById(id) {
            var _this8 = this;

            return this.jobExecutionDao.get(id).then(function (dto) {
                return _this8.fetchJobExecutionRelations(dto);
            });
        }
    }, {
        key: "fetchJobExecutionRelations",
        value: function fetchJobExecutionRelations(jobExecutionDTO) {
            var _this9 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            if (!jobExecutionDTO) {
                return Promise.resolve(null);
            }
            return this.findStepExecutions(jobExecutionDTO.id, false).then(function (steps) {
                jobExecutionDTO.stepExecutions = steps;
                if (!revive) {
                    return jobExecutionDTO;
                }
                return _this9.reviveJobExecution(jobExecutionDTO);
            });
        }
    }, {
        key: "fetchJobExecutionsRelations",
        value: function fetchJobExecutionsRelations(jobExecutionDtoList) {
            var _this10 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
            var fetched = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

            if (jobExecutionDtoList.length <= fetched.length) {
                return Promise.resolve(fetched);
            }
            return this.fetchJobExecutionRelations(jobExecutionDtoList[fetched.length], revive).then(function (jobExecution) {
                fetched.push(jobExecution);

                return _this10.fetchJobExecutionsRelations(jobExecutionDtoList, revive, fetched);
            });
        }
    }, {
        key: "findStepExecutions",
        value: function findStepExecutions(jobExecutionId) {
            var _this11 = this;

            var revive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            return this.stepExecutionDao.getAllByIndex("jobExecutionId", jobExecutionId).then(function (dtos) {
                if (!revive) {
                    return dtos;
                }
                return dtos.map(function (dto) {
                    return _this11.reviveStepExecution(dto);
                });
            });
        }

        /*find job executions sorted by createTime, returns promise*/

    }, {
        key: "findJobExecutions",
        value: function findJobExecutions(jobInstance) {
            var _this12 = this;

            var fetchRelationsAndRevive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

            return this.jobExecutionDao.getAllByIndex("jobInstanceId", jobInstance.id).then(function (values) {
                var sorted = values.sort(function (a, b) {
                    return a.createTime.getTime() - b.createTime.getTime();
                });

                if (!fetchRelationsAndRevive) {
                    return sorted;
                }

                return _this12.fetchJobExecutionsRelations(sorted, true);
            });
        }
    }, {
        key: "getLastJobExecutionByInstance",
        value: function getLastJobExecutionByInstance(jobInstance) {
            var _this13 = this;

            return this.findJobExecutions(jobInstance, false).then(function (executions) {
                return _this13.fetchJobExecutionRelations(executions[executions.length - 1]);
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
            var _this14 = this;

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
                        return _this14.reviveStepExecution(stepDTO, jobExecution);
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
            var _this15 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this15.name).objectStore(_this15.name).get(key);
            });
        }
    }, {
        key: "getAllByIndex",
        value: function getAllByIndex(indexName, key) {
            var _this16 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this16.name).objectStore(_this16.name).index(indexName).getAll(key);
            });
        }
    }, {
        key: "getByIndex",
        value: function getByIndex(indexName, key) {
            var _this17 = this;

            return this.dbPromise.then(function (db) {
                return db.transaction(_this17.name).objectStore(_this17.name).index(indexName).get(key);
            });
        }
    }, {
        key: "set",
        value: function set(key, val) {
            var _this18 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this18.name, 'readwrite');
                tx.objectStore(_this18.name).put(val, key);
                return tx.complete;
            });
        }
    }, {
        key: "remove",
        value: function remove(key) {
            var _this19 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this19.name, 'readwrite');
                tx.objectStore(_this19.name).delete(key);
                return tx.complete;
            });
        }
    }, {
        key: "clear",
        value: function clear() {
            var _this20 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this20.name, 'readwrite');
                tx.objectStore(_this20.name).clear();
                return tx.complete;
            });
        }
    }, {
        key: "keys",
        value: function keys() {
            var _this21 = this;

            return this.dbPromise.then(function (db) {
                var tx = db.transaction(_this21.name);
                var keys = [];
                var store = tx.objectStore(_this21.name);

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

},{"../execution-context":36,"../job-execution":40,"../job-instance":41,"../step-execution":55,"./job-repository":47,"idb":1,"sd-model":"sd-model","sd-utils":"sd-utils"}],47:[function(require,module,exports){
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

var _sdModel = require("sd-model");

var _jobResult = require("../job-result");

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
    }, {
        key: "removeJobInstance",
        value: function removeJobInstance(jobInstance, jobParameters) {
            throw "JobRepository.removeJobInstance function not implemented!";
        }
    }, {
        key: "removeJobExecution",
        value: function removeJobExecution(jobExecution) {
            throw "JobRepository.removeJobExecution function not implemented!";
        }
    }, {
        key: "removeStepExecution",
        value: function removeStepExecution(stepExecution) {
            throw "JobRepository.removeStepExecution function not implemented!";
        }
    }, {
        key: "removeJobResult",
        value: function removeJobResult(jobResult) {
            throw "JobRepository.removeJobResult function not implemented!";
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
                var dataModel = new _sdModel.DataModel();
                dataModel._setNewState(data.createStateSnapshot());
                executionContext.setData(dataModel);
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
        value: function remove(o) {

            if (o instanceof _jobExecution.JobExecution) {
                return this.removeJobExecution(o);
            }

            if (o instanceof _stepExecution.StepExecution) {
                return this.removeStepExecution(o);
            }

            if (o instanceof _jobResult.JobResult) {
                return this.removeJobResult();
            }

            return Promise.reject("Object not removable: " + o);
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

},{"../exceptions/job-execution-already-running-exception":31,"../exceptions/job-instance-already-complete-exception":32,"../execution-context":36,"../job-execution":40,"../job-instance":41,"../job-key-generator":42,"../job-result":50,"../job-status":51,"../step-execution":55,"sd-model":"sd-model","sd-utils":"sd-utils"}],48:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SimpleJobRepository = undefined;

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

var SimpleJobRepository = exports.SimpleJobRepository = function (_JobRepository) {
    _inherits(SimpleJobRepository, _JobRepository);

    function SimpleJobRepository() {
        var _ref;

        var _temp, _this, _ret;

        _classCallCheck(this, SimpleJobRepository);

        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        return _ret = (_temp = (_this = _possibleConstructorReturn(this, (_ref = SimpleJobRepository.__proto__ || Object.getPrototypeOf(SimpleJobRepository)).call.apply(_ref, [this].concat(args))), _this), _this.jobInstancesByKey = {}, _this.jobExecutions = [], _this.stepExecutions = [], _this.executionProgress = {}, _this.executionFlags = {}, _this.jobResults = [], _temp), _possibleConstructorReturn(_this, _ret);
    }

    _createClass(SimpleJobRepository, [{
        key: "removeJobInstance",
        value: function removeJobInstance(jobInstance) {
            var _this2 = this;

            _sdUtils.Utils.forOwn(this.jobInstancesByKey, function (ji, key) {
                if (ji === jobInstance) {
                    delete _this2.jobInstancesByKey[key];
                }
            });

            this.jobExecutions.filter(function (jobExecution) {
                return jobExecution.jobInstance.id == jobInstance.id;
            }).reverse().forEach(this.removeJobExecution, this);
            this.jobResults.filter(function (jobResult) {
                return jobResult.jobInstance.id == jobInstance.id;
            }).reverse().forEach(this.removeJobResult, this);

            return Promise.resolve();
        }
    }, {
        key: "removeJobExecution",
        value: function removeJobExecution(jobExecution) {
            var index = this.jobExecutions.indexOf(jobExecution);
            if (index > -1) {
                this.jobExecutions.splice(index, 1);
            }

            this.stepExecutions.filter(function (stepExecution) {
                return stepExecution.jobExecution.id === jobExecution.id;
            }).reverse().forEach(this.removeStepExecution, this);
            return Promise.resolve();
        }
    }, {
        key: "removeStepExecution",
        value: function removeStepExecution(stepExecution) {
            var index = this.stepExecutions.indexOf(stepExecution);
            if (index > -1) {
                this.stepExecutions.splice(index, 1);
            }
            return Promise.resolve();
        }
    }, {
        key: "removeJobResult",
        value: function removeJobResult(jobResult) {
            var index = this.jobResults.indexOf(jobResult);
            if (index > -1) {
                this.jobResults.splice(index, 1);
            }
            return Promise.resolve();
        }

        /*returns promise*/

    }, {
        key: "getJobInstance",
        value: function getJobInstance(jobName, jobParameters) {
            var key = this.generateJobInstanceKey(jobName, jobParameters);
            return Promise.resolve(this.jobInstancesByKey[key]);
        }

        /*should return promise that resolves to saved instance*/

    }, {
        key: "saveJobInstance",
        value: function saveJobInstance(jobInstance, jobParameters) {
            var key = this.generateJobInstanceKey(jobInstance.jobName, jobParameters);
            this.jobInstancesByKey[key] = jobInstance;
            return Promise.resolve(jobInstance);
        }
    }, {
        key: "getJobResult",
        value: function getJobResult(jobResultId) {
            return Promise.resolve(_sdUtils.Utils.find(this.jobResults, function (r) {
                return r.id === jobResultId;
            }));
        }
    }, {
        key: "getJobResultByInstance",
        value: function getJobResultByInstance(jobInstance) {
            return Promise.resolve(_sdUtils.Utils.find(this.jobResults, function (r) {
                return r.jobInstance.id === jobInstance.id;
            }));
        }
    }, {
        key: "saveJobResult",
        value: function saveJobResult(jobResult) {
            this.jobResults.push(jobResult);
            return Promise.resolve(jobResult);
        }
    }, {
        key: "getJobExecutionById",
        value: function getJobExecutionById(id) {
            return Promise.resolve(_sdUtils.Utils.find(this.jobExecutions, function (ex) {
                return ex.id === id;
            }));
        }

        /*should return promise that resolves to saved jobExecution*/

    }, {
        key: "saveJobExecution",
        value: function saveJobExecution(jobExecution) {
            this.jobExecutions.push(jobExecution);
            return Promise.resolve(jobExecution);
        }
    }, {
        key: "updateJobExecutionProgress",
        value: function updateJobExecutionProgress(jobExecutionId, progress) {
            this.executionProgress[jobExecutionId] = progress;
            return Promise.resolve(progress);
        }
    }, {
        key: "getJobExecutionProgress",
        value: function getJobExecutionProgress(jobExecutionId) {
            return Promise.resolve(this.executionProgress[jobExecutionId]);
        }
    }, {
        key: "saveJobExecutionFlag",
        value: function saveJobExecutionFlag(jobExecutionId, flag) {
            this.executionFlags[jobExecutionId] = flag;
            return Promise.resolve(flag);
        }
    }, {
        key: "getJobExecutionFlag",
        value: function getJobExecutionFlag(jobExecutionId) {
            return Promise.resolve(this.executionFlags[jobExecutionId]);
        }

        /*should return promise which resolves to saved stepExecution*/

    }, {
        key: "saveStepExecution",
        value: function saveStepExecution(stepExecution) {
            this.stepExecutions.push(stepExecution);
            return Promise.resolve(stepExecution);
        }

        /*find job executions sorted by createTime, returns promise*/

    }, {
        key: "findJobExecutions",
        value: function findJobExecutions(jobInstance) {
            return Promise.resolve(this.jobExecutions.filter(function (e) {
                return e.jobInstance.id == jobInstance.id;
            }).sort(function (a, b) {
                return a.createTime.getTime() - b.createTime.getTime();
            }));
        }
    }]);

    return SimpleJobRepository;
}(_jobRepository.JobRepository);

},{"./job-repository":47,"sd-utils":"sd-utils"}],49:[function(require,module,exports){
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

var _simpleJobRepository = require("./simple-job-repository");

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

var TimeoutJobRepository = exports.TimeoutJobRepository = function (_SimpleJobRepository) {
    _inherits(TimeoutJobRepository, _SimpleJobRepository);

    function TimeoutJobRepository() {
        _classCallCheck(this, TimeoutJobRepository);

        return _possibleConstructorReturn(this, (TimeoutJobRepository.__proto__ || Object.getPrototypeOf(TimeoutJobRepository)).apply(this, arguments));
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
}(_simpleJobRepository.SimpleJobRepository);

},{"./job-repository":47,"./simple-job-repository":48,"sd-utils":"sd-utils"}],50:[function(require,module,exports){
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

},{"./execution-context":36,"./job-status":51,"./step-execution":55,"sd-utils":"sd-utils"}],51:[function(require,module,exports){
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

},{}],52:[function(require,module,exports){
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
    function Job(name, jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, Job);

        this.steps = [];
        this.isRestartable = true;
        this.executionListeners = [];

        this.name = name;
        this.jobParametersValidator = this.getJobParametersValidator();
        this.jobDataValidator = this.getJobDataValidator();
        this.jobRepository = jobRepository;
        this.expressionsEvaluator = expressionsEvaluator;
        this.objectiveRulesManager = objectiveRulesManager;
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
    }, {
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            throw 'jobResultToCsvRows function not implemented for job: ' + this.name;
        }
    }]);

    return Job;
}();

},{"./exceptions/job-data-invalid-exception":30,"./exceptions/job-interrupted-exception":33,"./exceptions/job-parameters-invalid-exception":34,"./job-execution-flag":38,"./job-result":50,"./job-status":51,"sd-utils":"sd-utils"}],53:[function(require,module,exports){
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

/* Simple Job that sequentially executes a job by iterating through its list of steps.  Any Step that fails will fail the job.  The job is
 considered complete when all steps have been executed.*/

var SimpleJob = exports.SimpleJob = function (_Job) {
    _inherits(SimpleJob, _Job);

    function SimpleJob(name, jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, SimpleJob);

        return _possibleConstructorReturn(this, (SimpleJob.__proto__ || Object.getPrototypeOf(SimpleJob)).call(this, name, jobRepository, expressionsEvaluator, objectiveRulesManager));
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
                    var _execution$failureExc;

                    _sdUtils.log.debug("Updating JobExecution status: ", lastExecutedStepExecution);
                    execution.status = lastExecutedStepExecution.status;
                    execution.exitStatus = lastExecutedStepExecution.exitStatus;
                    (_execution$failureExc = execution.failureExceptions).push.apply(_execution$failureExc, _toConsumableArray(lastExecutedStepExecution.failureExceptions));
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
            var progress = {
                total: this.steps.length,
                current: completedSteps
            };
            if (!completedSteps) {
                return progress;
            }
            if (_jobStatus.JOB_STATUS.COMPLETED !== execution.stepExecutions[execution.stepExecutions.length - 1].status) {
                progress.current--;
            }

            return progress;
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

},{"./exceptions/job-interrupted-exception":33,"./exceptions/job-restart-exception":35,"./execution-context":36,"./job":52,"./job-execution-flag":38,"./job-status":51,"./step":56,"sd-utils":"sd-utils"}],54:[function(require,module,exports){
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

},{}],55:[function(require,module,exports){
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

},{"./execution-context":36,"./job-execution":40,"./job-status":51,"sd-utils":"sd-utils"}],56:[function(require,module,exports){
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

},{"./exceptions/job-interrupted-exception":33,"./job-status":51,"sd-utils":"sd-utils"}],57:[function(require,module,exports){
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

},{"./engine/index":37,"./job-worker":59,"./jobs-manager":60}],58:[function(require,module,exports){
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

},{"./engine/job-execution-listener":39,"./engine/job-instance":41,"./engine/job-status":51,"sd-utils":"sd-utils"}],59:[function(require,module,exports){
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

},{}],60:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.JobsManager = exports.JobsManagerConfig = undefined;

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

var _sensitivityAnalysisJob = require("./configurations/sensitivity-analysis/n-way/sensitivity-analysis-job");

var _jobLauncher = require("./engine/job-launcher");

var _jobWorker = require("./job-worker");

var _jobExecutionListener = require("./engine/job-execution-listener");

var _jobParameters = require("./engine/job-parameters");

var _idbJobRepository = require("./engine/job-repository/idb-job-repository");

var _jobExecutionFlag = require("./engine/job-execution-flag");

var _recomputeJob = require("./configurations/recompute/recompute-job");

var _probabilisticSensitivityAnalysisJob = require("./configurations/sensitivity-analysis/probabilistic/probabilistic-sensitivity-analysis-job");

var _timeoutJobRepository = require("./engine/job-repository/timeout-job-repository");

var _tornadoDiagramJob = require("./configurations/sensitivity-analysis/tornado-diagram/tornado-diagram-job");

var _jobStatus = require("./engine/job-status");

var _simpleJobRepository = require("./engine/job-repository/simple-job-repository");

var _leagueTableJob = require("./configurations/league-table/league-table-job");

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

var JobsManagerConfig = exports.JobsManagerConfig = function JobsManagerConfig(custom) {
    _classCallCheck(this, JobsManagerConfig);

    this.workerUrl = null;
    this.repositoryType = 'idb';
    this.clearRepository = false;

    if (custom) {
        _sdUtils.Utils.deepExtend(this, custom);
    }
};

var JobsManager = exports.JobsManager = function (_JobExecutionListener) {
    _inherits(JobsManager, _JobExecutionListener);

    function JobsManager(expressionsEvaluator, objectiveRulesManager, config) {
        _classCallCheck(this, JobsManager);

        var _this = _possibleConstructorReturn(this, (JobsManager.__proto__ || Object.getPrototypeOf(JobsManager)).call(this));

        _this.jobExecutionListeners = [];
        _this.afterJobExecutionPromiseResolves = {};
        _this.jobInstancesToTerminate = {};

        _this.setConfig(config);
        _this.expressionEngine = expressionsEvaluator.expressionEngine;
        _this.expressionsEvaluator = expressionsEvaluator;
        _this.objectiveRulesManager = objectiveRulesManager;

        _this.useWorker = !!_this.config.workerUrl;
        if (_this.useWorker) {
            _this.initWorker(_this.config.workerUrl);
        }

        _this.initRepository();

        _this.registerJobs();

        _this.jobLauncher = new _jobLauncher.JobLauncher(_this.jobRepository, _this.jobWorker, function (data) {
            return _this.serializeData(data);
        });
        return _this;
    }

    _createClass(JobsManager, [{
        key: "setConfig",
        value: function setConfig(config) {
            this.config = new JobsManagerConfig(config);
            return this;
        }
    }, {
        key: "initRepository",
        value: function initRepository() {
            if (this.config.repositoryType === 'idb') {
                this.jobRepository = new _idbJobRepository.IdbJobRepository(this.expressionEngine.getJsonReviver(), 'sd-job-repository', this.config.clearRepository);
            } else if ('timeout') {
                this.jobRepository = new _timeoutJobRepository.TimeoutJobRepository(this.expressionEngine.getJsonReviver());
            } else if ('simple') {
                this.jobRepository = new _simpleJobRepository.SimpleJobRepository(this.expressionEngine.getJsonReviver());
            } else {
                _sdUtils.log.error('JobsManager configuration error! Unknown repository type: ' + this.config.repositoryType + '. Using default: idb');
                this.config.repositoryType = 'idb';
                this.initRepository();
            }
        }
    }, {
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
                if (jobExecution) {
                    if (jobExecution.isRunning()) {
                        return _this4.jobRepository.saveJobExecutionFlag(jobExecution.id, _jobExecutionFlag.JOB_EXECUTION_FLAG.STOP).then(function () {
                            return jobExecution;
                        });
                    } else {
                        return _this4.jobRepository.removeJobInstance(jobInstance, jobExecution.jobParameters);
                    }
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

            var sensitivityAnalysisJob = new _sensitivityAnalysisJob.SensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
            var probabilisticSensitivityAnalysisJob = new _probabilisticSensitivityAnalysisJob.ProbabilisticSensitivityAnalysisJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager);
            if (!_sdUtils.Utils.isWorker()) {
                sensitivityAnalysisJob.setBatchSize(1);
                probabilisticSensitivityAnalysisJob.setBatchSize(1);
            }

            this.registerJob(sensitivityAnalysisJob);
            this.registerJob(new _tornadoDiagramJob.TornadoDiagramJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
            this.registerJob(probabilisticSensitivityAnalysisJob);
            this.registerJob(new _recomputeJob.RecomputeJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
            this.registerJob(new _leagueTableJob.LeagueTableJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
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
                this.jobRepository.removeJobInstance(jobExecution.jobInstance, jobExecution.jobParameters);
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

},{"./configurations/league-table/league-table-job":8,"./configurations/recompute/recompute-job":11,"./configurations/sensitivity-analysis/n-way/sensitivity-analysis-job":13,"./configurations/sensitivity-analysis/probabilistic/probabilistic-sensitivity-analysis-job":18,"./configurations/sensitivity-analysis/tornado-diagram/tornado-diagram-job":25,"./engine/job-execution-flag":38,"./engine/job-execution-listener":39,"./engine/job-launcher":43,"./engine/job-parameters":45,"./engine/job-repository/idb-job-repository":46,"./engine/job-repository/simple-job-repository":48,"./engine/job-repository/timeout-job-repository":49,"./engine/job-status":51,"./job-worker":59,"sd-utils":"sd-utils"}],61:[function(require,module,exports){
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

var _minMaxRule = require("./rules/min-max-rule");

var _maxMinRule = require("./rules/max-min-rule");

var _minMinRule = require("./rules/min-min-rule");

var _maxMaxRule = require("./rules/max-max-rule");

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
    function ObjectiveRulesManager(expressionEngine, currentRuleName) {
        _classCallCheck(this, ObjectiveRulesManager);

        this.ruleByName = {};
        this.rules = [];
        this.flipPair = {};
        this.payoffIndex = 0;

        this.expressionEngine = expressionEngine;
        this.addRule(new _rules.ExpectedValueMaximizationRule(expressionEngine));
        this.addRule(new _rules.ExpectedValueMinimizationRule(expressionEngine));
        this.addRule(new _rules.MaxiMinRule(expressionEngine));
        this.addRule(new _rules.MaxiMaxRule(expressionEngine));
        this.addRule(new _rules.MiniMinRule(expressionEngine));
        this.addRule(new _rules.MiniMaxRule(expressionEngine));

        var minMax = new _minMaxRule.MinMaxRule(expressionEngine);
        this.addRule(minMax);
        var maxMin = new _maxMinRule.MaxMinRule(expressionEngine);
        this.addRule(maxMin);
        this.addFlipPair(minMax, maxMin);

        var minMin = new _minMinRule.MinMinRule(expressionEngine);
        this.addRule(minMin);
        var maxMax = new _maxMaxRule.MaxMaxRule(expressionEngine);
        this.addRule(maxMax);

        if (currentRuleName) {
            this.currentRule = this.ruleByName[currentRuleName];
        } else {
            this.currentRule = this.rules[0];
        }
    }

    _createClass(ObjectiveRulesManager, [{
        key: "setPayoffIndex",
        value: function setPayoffIndex(payoffIndex) {
            this.payoffIndex = payoffIndex || 0;
        }
    }, {
        key: "addRule",
        value: function addRule(rule) {
            this.ruleByName[rule.name] = rule;
            this.rules.push(rule);
        }
    }, {
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
        key: "getObjectiveRuleByName",
        value: function getObjectiveRuleByName(ruleName) {
            return this.ruleByName[ruleName];
        }
    }, {
        key: "flipRule",
        value: function flipRule() {
            var flipped = this.flipPair[this.currentRule.name];
            if (flipped) {
                this.currentRule = flipped;
            }
        }
    }, {
        key: "updateDefaultCriterion1Weight",
        value: function updateDefaultCriterion1Weight(defaultCriterion1Weight) {
            this.rules.filter(function (r) {
                return r.multiCriteria;
            }).forEach(function (r) {
                return r.setDefaultCriterion1Weight(parseFloat(defaultCriterion1Weight));
            });
        }
    }, {
        key: "recompute",
        value: function recompute(dataModel, allRules) {
            var _this = this;

            var decisionPolicy = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

            var startTime = new Date().getTime();
            _sdUtils.log.trace('recomputing rules, all: ' + allRules);

            dataModel.getRoots().forEach(function (n) {
                _this.recomputeTree(n, allRules, decisionPolicy);
            });

            var time = new Date().getTime() - startTime / 1000;
            _sdUtils.log.trace('recomputation took ' + time + 's');

            return this;
        }
    }, {
        key: "recomputeTree",
        value: function recomputeTree(root, allRules) {
            var _this2 = this;

            var decisionPolicy = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

            _sdUtils.log.trace('recomputing rules for tree ...', root);

            var startTime = new Date().getTime();

            var rules = [this.currentRule];
            if (allRules) {
                rules = this.rules;
            }

            rules.forEach(function (rule) {
                rule.setPayoffIndex(_this2.payoffIndex);
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
                if (this.currentRule.multiCriteria) {
                    return e.computedValue(null, 'payoff');
                } else {
                    return e.computedValue(null, 'payoff[' + this.payoffIndex + ']');
                }
            }
            if (name === 'optimal') {
                return e.computedValue(this.currentRule.name, 'optimal');
            }
        }
    }, {
        key: "addFlipPair",
        value: function addFlipPair(rule1, rule2) {
            this.flipPair[rule1.name] = rule2;
            this.flipPair[rule2.name] = rule1;
        }
    }]);

    return ObjectiveRulesManager;
}();

},{"./rules":64,"./rules/max-max-rule":65,"./rules/max-min-rule":66,"./rules/min-max-rule":69,"./rules/min-min-rule":70,"sd-model":"sd-model","sd-utils":"sd-utils"}],62:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (ExpectedValueMaximizationRule.__proto__ || Object.getPrototypeOf(ExpectedValueMaximizationRule)).call(this, ExpectedValueMaximizationRule.NAME, true, expressionEngine));
    }

    //  payoff - parent edge payoff


    _createClass(ExpectedValueMaximizationRule, [{
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
                if (_this2.subtract(_this2.computedPayoff(node), payoff).equals(_this2.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode)) {
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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],63:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (ExpectedValueMinimizationRule.__proto__ || Object.getPrototypeOf(ExpectedValueMinimizationRule)).call(this, ExpectedValueMinimizationRule.NAME, false, expressionEngine));
    }

    //  payoff - parent edge payoff


    _createClass(ExpectedValueMinimizationRule, [{
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
                if (_this2.subtract(_this2.computedPayoff(node), payoff).equals(_this2.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode)) {
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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],64:[function(require,module,exports){
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

},{"./expected-value-maximization-rule":62,"./expected-value-minimization-rule":63,"./maxi-max-rule":67,"./maxi-min-rule":68,"./mini-max-rule":71,"./mini-min-rule":72,"./objective-rule":74}],65:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MaxMaxRule = undefined;

var _multiCriteriaRule = require("./multi-criteria-rule");

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

var MaxMaxRule = exports.MaxMaxRule = function (_MultiCriteriaRule) {
    _inherits(MaxMaxRule, _MultiCriteriaRule);

    function MaxMaxRule(expressionEngine) {
        _classCallCheck(this, MaxMaxRule);

        return _possibleConstructorReturn(this, (MaxMaxRule.__proto__ || Object.getPrototypeOf(MaxMaxRule)).call(this, MaxMaxRule.NAME, [1, 1], expressionEngine));
    }

    return MaxMaxRule;
}(_multiCriteriaRule.MultiCriteriaRule);

MaxMaxRule.NAME = 'max-max';

},{"./multi-criteria-rule":73}],66:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MaxMinRule = undefined;

var _multiCriteriaRule = require("./multi-criteria-rule");

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

var MaxMinRule = exports.MaxMinRule = function (_MultiCriteriaRule) {
    _inherits(MaxMinRule, _MultiCriteriaRule);

    function MaxMinRule(expressionEngine) {
        _classCallCheck(this, MaxMinRule);

        return _possibleConstructorReturn(this, (MaxMinRule.__proto__ || Object.getPrototypeOf(MaxMinRule)).call(this, MaxMinRule.NAME, [1, -1], expressionEngine));
    }

    return MaxMinRule;
}(_multiCriteriaRule.MultiCriteriaRule);

MaxMinRule.NAME = 'max-min';

},{"./multi-criteria-rule":73}],67:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (MaxiMaxRule.__proto__ || Object.getPrototypeOf(MaxiMaxRule)).call(this, MaxiMaxRule.NAME, true, expressionEngine));
    }

    _createClass(MaxiMaxRule, [{
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.computedPayoff(e.childNode) < bestChildPayoff ? 0.0 : 1.0 / bestCount);
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
                    return _this3.computedPayoff(e.childNode);
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.computedPayoff(optimalEdge.childNode).equals(_this3.computedPayoff(e.childNode));
                } else isOptimal = !!(_this3.subtract(_this3.computedPayoff(node), payoff).equals(_this3.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode));

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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],68:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (MaxiMinRule.__proto__ || Object.getPrototypeOf(MaxiMinRule)).call(this, MaxiMinRule.NAME, true, expressionEngine));
    }

    _createClass(MaxiMinRule, [{
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.computedPayoff(e.childNode) > worstChildPayoff ? 0.0 : 1.0 / worstCount);
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
                    return _this3.computedPayoff(e.childNode);
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.computedPayoff(optimalEdge.childNode).equals(_this3.computedPayoff(e.childNode));
                } else isOptimal = !!(_this3.subtract(_this3.computedPayoff(node), payoff).equals(_this3.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode));

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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],69:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MinMaxRule = undefined;

var _multiCriteriaRule = require("./multi-criteria-rule");

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

var MinMaxRule = exports.MinMaxRule = function (_MultiCriteriaRule) {
    _inherits(MinMaxRule, _MultiCriteriaRule);

    function MinMaxRule(expressionEngine) {
        _classCallCheck(this, MinMaxRule);

        return _possibleConstructorReturn(this, (MinMaxRule.__proto__ || Object.getPrototypeOf(MinMaxRule)).call(this, MinMaxRule.NAME, [-1, 1], expressionEngine));
    }

    return MinMaxRule;
}(_multiCriteriaRule.MultiCriteriaRule);

MinMaxRule.NAME = 'min-max';

},{"./multi-criteria-rule":73}],70:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MinMinRule = undefined;

var _multiCriteriaRule = require("./multi-criteria-rule");

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

var MinMinRule = exports.MinMinRule = function (_MultiCriteriaRule) {
    _inherits(MinMinRule, _MultiCriteriaRule);

    function MinMinRule(expressionEngine) {
        _classCallCheck(this, MinMinRule);

        return _possibleConstructorReturn(this, (MinMinRule.__proto__ || Object.getPrototypeOf(MinMinRule)).call(this, MinMinRule.NAME, [-1, -1], expressionEngine));
    }

    return MinMinRule;
}(_multiCriteriaRule.MultiCriteriaRule);

MinMinRule.NAME = 'min-min';

},{"./multi-criteria-rule":73}],71:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (MiniMaxRule.__proto__ || Object.getPrototypeOf(MiniMaxRule)).call(this, MiniMaxRule.NAME, false, expressionEngine));
    }

    _createClass(MiniMaxRule, [{
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.computedPayoff(e.childNode) < bestChildPayoff ? 0.0 : 1.0 / bestCount);
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
                    return _this3.computedPayoff(e.childNode);
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.computedPayoff(optimalEdge.childNode).equals(_this3.computedPayoff(e.childNode));
                } else isOptimal = !!(_this3.subtract(_this3.computedPayoff(node), payoff).equals(_this3.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode));

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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],72:[function(require,module,exports){
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

        return _possibleConstructorReturn(this, (MiniMinRule.__proto__ || Object.getPrototypeOf(MiniMinRule)).call(this, MiniMinRule.NAME, false, expressionEngine));
    }

    _createClass(MiniMinRule, [{
        key: 'modifyChanceProbability',
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {
            var _this2 = this;

            edges.forEach(function (e) {
                _this2.clearComputedValues(e);
                _this2.cValue(e, 'probability', _this2.computedPayoff(e.childNode) > worstChildPayoff ? 0.0 : 1.0 / worstCount);
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
                    return _this3.computedPayoff(e.childNode);
                });
            }

            node.childEdges.forEach(function (e) {
                var isOptimal = false;
                if (optimalEdge) {
                    isOptimal = _this3.computedPayoff(optimalEdge.childNode).equals(_this3.computedPayoff(e.childNode));
                } else isOptimal = !!(_this3.subtract(_this3.computedPayoff(node), payoff).equals(_this3.computedPayoff(e.childNode)) || !(node instanceof _sdModel.domain.DecisionNode));

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

},{"./objective-rule":74,"sd-model":"sd-model","sd-utils":"sd-utils"}],73:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.MultiCriteriaRule = undefined;

var _createClass = function () {
    function defineProperties(target, props) {
        for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
        }
    }return function (Constructor, protoProps, staticProps) {
        if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
    };
}();

var _sdModel = require("sd-model");

var _objectiveRule = require("./objective-rule");

var _policy = require("../../policies/policy");

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

var MultiCriteriaRule = exports.MultiCriteriaRule = function (_ObjectiveRule) {
    _inherits(MultiCriteriaRule, _ObjectiveRule);

    function MultiCriteriaRule(name, payoffCoeffs, expressionEngine) {
        _classCallCheck(this, MultiCriteriaRule);

        var _this = _possibleConstructorReturn(this, (MultiCriteriaRule.__proto__ || Object.getPrototypeOf(MultiCriteriaRule)).call(this, name, true, expressionEngine, true));

        _this.criterion1Weight = 1;
        _this.payoffCoeffs = [1, -1];

        _this.payoffCoeffs = payoffCoeffs;

        return _this;
    }

    _createClass(MultiCriteriaRule, [{
        key: "setDefaultCriterion1Weight",
        value: function setDefaultCriterion1Weight(criterion1Weight) {
            this.criterion1Weight = criterion1Weight;
        }

        // payoff - parent edge payoff, aggregatedPayoff - aggregated payoff along path

    }, {
        key: "computePayoff",
        value: function computePayoff(node) {
            var _this2 = this;

            var payoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [0, 0];
            var aggregatedPayoff = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [0, 0];

            var childrenPayoff = [0, 0];
            if (node.childEdges.length) {
                if (node instanceof _sdModel.domain.DecisionNode) {

                    var selectedIndexes = [];
                    var bestChild = -Infinity;

                    node.childEdges.forEach(function (e, i) {
                        var basePayoffs = [_this2.basePayoff(e, 0), _this2.basePayoff(e, 1)];
                        var childPayoff = _this2.computePayoff(e.childNode, basePayoffs, [_this2.add(basePayoffs[0], aggregatedPayoff[0]), _this2.add(basePayoffs[1], aggregatedPayoff[1])]);
                        var childCombinedPayoff = _this2.cValue(e.childNode, 'combinedPayoff');
                        if (childCombinedPayoff > bestChild) {
                            bestChild = childCombinedPayoff;
                            selectedIndexes = [i];
                        } else if (bestChild.equals(childCombinedPayoff)) {
                            selectedIndexes.push(i);
                        }
                    });

                    if (this.decisionPolicy) {
                        selectedIndexes = [];
                        var decision = _policy.Policy.getDecision(this.decisionPolicy, node);
                        if (decision) {
                            selectedIndexes = [decision.decisionValue];
                        }
                    }

                    node.childEdges.forEach(function (e, i) {
                        _this2.clearComputedValues(e);
                        _this2.cValue(e, 'probability', selectedIndexes.indexOf(i) < 0 ? 0.0 : 1.0);
                    });
                } else {
                    node.childEdges.forEach(function (e) {
                        var basePayoffs = [_this2.basePayoff(e, 0), _this2.basePayoff(e, 1)];
                        _this2.computePayoff(e.childNode, basePayoffs, [_this2.add(basePayoffs[0], aggregatedPayoff[0]), _this2.add(basePayoffs[1], aggregatedPayoff[1])]);
                        _this2.clearComputedValues(e);
                        _this2.cValue(e, 'probability', _this2.baseProbability(e));
                    });
                }

                var sumweight = 0;
                node.childEdges.forEach(function (e) {
                    sumweight = _this2.add(sumweight, _this2.cValue(e, 'probability'));
                });

                if (sumweight > 0) {
                    node.childEdges.forEach(function (e) {
                        childrenPayoff.forEach(function (p, i) {
                            var ep = _this2.cValue(e.childNode, 'payoff[' + i + ']');
                            childrenPayoff[i] = _this2.add(p, _this2.multiply(_this2.cValue(e, 'probability'), ep).div(sumweight));
                        });
                    });
                }
            }
            payoff.forEach(function (p, i) {
                payoff[i] = _this2.add(p, childrenPayoff[i]);
            });

            this.clearComputedValues(node);

            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'aggregatedPayoff', aggregatedPayoff);
                this.cValue(node, 'probabilityToEnter', 0); //initial value
            } else {
                this.cValue(node, 'childrenPayoff', childrenPayoff);
            }

            this.cValue(node, 'combinedPayoff', this.computeCombinedPayoff(payoff));

            return this.cValue(node, 'payoff', payoff);
        }
    }, {
        key: "computeCombinedPayoff",
        value: function computeCombinedPayoff(payoff) {
            // [criterion 1 coeff]*[criterion 1]*[weight]+[criterion 2 coeff]*[criterion 2]
            if (this.criterion1Weight === Infinity) {
                return this.multiply(this.payoffCoeffs[0], payoff[0]);
            }
            return this.add(this.multiply(this.payoffCoeffs[0], this.multiply(this.criterion1Weight, payoff[0])), this.multiply(this.payoffCoeffs[1], payoff[1]));
        }

        //  combinedPayoff - parent edge combinedPayoff

    }, {
        key: "computeOptimal",
        value: function computeOptimal(node) {
            var _this3 = this;

            var combinedPayoff = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
            var probabilityToEnter = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;

            this.cValue(node, 'optimal', true);
            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'probabilityToEnter', probabilityToEnter);
            }

            node.childEdges.forEach(function (e) {
                if (_this3.subtract(_this3.cValue(node, 'combinedPayoff'), combinedPayoff).equals(_this3.cValue(e.childNode, 'combinedPayoff')) || !(node instanceof _sdModel.domain.DecisionNode)) {
                    _this3.cValue(e, 'optimal', true);
                    _this3.computeOptimal(e.childNode, _this3.computeCombinedPayoff([_this3.basePayoff(e, 0), _this3.basePayoff(e, 1)]), _this3.multiply(probabilityToEnter, _this3.cValue(e, 'probability')));
                } else {
                    _this3.cValue(e, 'optimal', false);
                }
            });
        }
    }]);

    return MultiCriteriaRule;
}(_objectiveRule.ObjectiveRule);

},{"../../policies/policy":80,"./objective-rule":74,"sd-model":"sd-model"}],74:[function(require,module,exports){
"use strict";

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

var _sdExpressionEngine = require("sd-expression-engine");

var _sdModel = require("sd-model");

var _policy = require("../../policies/policy");

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

/*Base class for objective rules*/
var ObjectiveRule = exports.ObjectiveRule = function () {
    function ObjectiveRule(name, maximization, expressionEngine) {
        var multiCriteria = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

        _classCallCheck(this, ObjectiveRule);

        this.payoffIndex = 0;
        this.multiCriteria = false;

        this.name = name;
        this.maximization = maximization;
        this.expressionEngine = expressionEngine;
        this.multiCriteria = multiCriteria;
    }

    _createClass(ObjectiveRule, [{
        key: "setDecisionPolicy",
        value: function setDecisionPolicy(decisionPolicy) {
            this.decisionPolicy = decisionPolicy;
        }
    }, {
        key: "setPayoffIndex",
        value: function setPayoffIndex(payoffIndex) {
            this.payoffIndex = payoffIndex;
        }
    }, {
        key: "clearDecisionPolicy",
        value: function clearDecisionPolicy() {
            this.decisionPolicy = null;
        }

        // should return array of selected children indexes

    }, {
        key: "makeDecision",
        value: function makeDecision(decisionNode, childrenPayoffs) {
            var best;
            if (this.maximization) {
                best = this.max.apply(this, _toConsumableArray(childrenPayoffs));
            } else {
                best = this.min.apply(this, _toConsumableArray(childrenPayoffs));
            }
            var selectedIndexes = [];
            childrenPayoffs.forEach(function (p, i) {
                if (_sdExpressionEngine.ExpressionEngine.compare(best, p) == 0) {
                    selectedIndexes.push(i);
                }
            });
            return selectedIndexes;
        }
    }, {
        key: "_makeDecision",
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
        key: "modifyChanceProbability",
        value: function modifyChanceProbability(edges, bestChildPayoff, bestCount, worstChildPayoff, worstCount) {}

        // payoff - parent edge payoff, aggregatedPayoff - aggregated payoff along path

    }, {
        key: "computePayoff",
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
                        childrenPayoff = _this.add(childrenPayoff, _this.multiply(_this.cValue(e, 'probability'), _this.computedPayoff(e.childNode)).div(sumweight));
                    });
                }
            }

            payoff = this.add(payoff, childrenPayoff);
            this.clearComputedValues(node);

            if (node instanceof _sdModel.domain.TerminalNode) {
                this.cValue(node, 'aggregatedPayoff' + '[' + this.payoffIndex + ']', aggregatedPayoff);
                this.cValue(node, 'probabilityToEnter', 0); //initial value
            } else {
                this.cValue(node, 'childrenPayoff' + '[' + this.payoffIndex + ']', childrenPayoff);
            }

            return this.computedPayoff(node, payoff);
        }

        // koloruje optymalne ścieżki

    }, {
        key: "computeOptimal",
        value: function computeOptimal(node) {
            throw 'computeOptimal function not implemented for rule: ' + this.name;
        }

        /* get or set computed payoff*/

    }, {
        key: "computedPayoff",
        value: function computedPayoff(node, value) {
            return this.cValue(node, 'payoff[' + this.payoffIndex + ']', value);
        }

        /*Get or set object's computed value for current rule*/

    }, {
        key: "cValue",
        value: function cValue(object, fieldPath, value) {
            // if(fieldPath.trim() === 'payoff'){
            //     fieldPath += '[' + this.payoffIndex + ']';
            // }

            return object.computedValue(this.name, fieldPath, value);
        }
    }, {
        key: "baseProbability",
        value: function baseProbability(edge) {
            return edge.computedBaseProbability();
        }
    }, {
        key: "basePayoff",
        value: function basePayoff(edge, payoffIndex) {
            return edge.computedBasePayoff(undefined, payoffIndex || this.payoffIndex);
        }
    }, {
        key: "clearComputedValues",
        value: function clearComputedValues(object) {
            object.clearComputedValues(this.name);
        }
    }, {
        key: "add",
        value: function add(a, b) {
            return _sdExpressionEngine.ExpressionEngine.add(a, b);
        }
    }, {
        key: "subtract",
        value: function subtract(a, b) {
            return _sdExpressionEngine.ExpressionEngine.subtract(a, b);
        }
    }, {
        key: "divide",
        value: function divide(a, b) {
            return _sdExpressionEngine.ExpressionEngine.divide(a, b);
        }
    }, {
        key: "multiply",
        value: function multiply(a, b) {
            return _sdExpressionEngine.ExpressionEngine.multiply(a, b);
        }
    }, {
        key: "max",
        value: function max() {
            return _sdExpressionEngine.ExpressionEngine.max.apply(_sdExpressionEngine.ExpressionEngine, arguments);
        }
    }, {
        key: "min",
        value: function min() {
            return _sdExpressionEngine.ExpressionEngine.min.apply(_sdExpressionEngine.ExpressionEngine, arguments);
        }
    }]);

    return ObjectiveRule;
}();

},{"../../policies/policy":80,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],75:[function(require,module,exports){
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

},{"../validation/tree-validator":83,"./operation":76,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],76:[function(require,module,exports){
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

},{}],77:[function(require,module,exports){
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

},{"./flip-subtree":75}],78:[function(require,module,exports){
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

},{}],79:[function(require,module,exports){
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

},{"./decision":78,"./policy":80,"sd-model":"sd-model","sd-utils":"sd-utils"}],80:[function(require,module,exports){
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

},{"./decision":78}],81:[function(require,module,exports){
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

            value = _sdExpressionEngine.ExpressionEngine.toNumber(value);
            var maxSafeInteger = Number.MAX_SAFE_INTEGER || 9007199254740991; // Number.MAX_SAFE_INTEGER in undefined in IE
            return _sdExpressionEngine.ExpressionEngine.compare(value, -maxSafeInteger) >= 0 && _sdExpressionEngine.ExpressionEngine.compare(value, maxSafeInteger) <= 0;
        }
    }]);

    return PayoffValueValidator;
}();

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],82:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],83:[function(require,module,exports){
"use strict";

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

var _sdModel = require("sd-model");

var _sdExpressionEngine = require("sd-expression-engine");

var _probabilityValueValidator = require("./probability-value-validator");

var _payoffValueValidator = require("./payoff-value-validator");

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
        key: "validate",
        value: function validate(nodes) {
            var _this = this;

            var validationResult = new _sdModel.ValidationResult();

            nodes.forEach(function (n) {
                _this.validateNode(n, validationResult);
            });

            return validationResult;
        }
    }, {
        key: "validateNode",
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

                e.payoff.forEach(function (rawPayoff, payoffIndex) {
                    var path = 'payoff[' + payoffIndex + ']';
                    e.setValueValidity(path, true);
                    var payoff = e.computedBasePayoff(undefined, payoffIndex);
                    if (!_this2.payoffValueValidator.validate(payoff)) {
                        validationResult.addError({ name: 'invalidPayoff', data: { 'number': i + 1 } }, node);
                        e.setValueValidity(path, false);
                    }
                });
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

},{"./payoff-value-validator":81,"./probability-value-validator":82,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],"sd-computations":[function(require,module,exports){
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

},{"./src/index":6}]},{},[])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmNcXHNyY1xcY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyY1xcY29tcHV0YXRpb25zLW1hbmFnZXIuanMiLCJzcmNcXGNvbXB1dGF0aW9ucy11dGlscy5qcyIsInNyY1xcZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjXFxpbmRleC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXGxlYWd1ZS10YWJsZVxcbGVhZ3VlLXRhYmxlLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcbGVhZ3VlLXRhYmxlXFxsZWFndWUtdGFibGUtam9iLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcbGVhZ3VlLXRhYmxlXFxzdGVwc1xcY2FsY3VsYXRlLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxyZWNvbXB1dGVcXHJlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHJlY29tcHV0ZVxccmVjb21wdXRlLWpvYi5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxuLXdheVxcc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxzZW5zaXRpdml0eS1hbmFseXNpc1xcbi13YXlcXHNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxuLXdheVxcc3RlcHNcXGNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXG4td2F5XFxzdGVwc1xcaW5pdC1wb2xpY2llcy1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXG4td2F5XFxzdGVwc1xccHJlcGFyZS12YXJpYWJsZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxwcm9iYWJpbGlzdGljXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHByb2JhYmlsaXN0aWNcXHByb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHByb2JhYmlsaXN0aWNcXHN0ZXBzXFxjb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHByb2JhYmlsaXN0aWNcXHN0ZXBzXFxwcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHRvcm5hZG8tZGlhZ3JhbVxcc3RlcHNcXGNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHRvcm5hZG8tZGlhZ3JhbVxcc3RlcHNcXGluaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFx0b3JuYWRvLWRpYWdyYW1cXHN0ZXBzXFxwcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHRvcm5hZG8tZGlhZ3JhbVxcdG9ybmFkby1kaWFncmFtLWpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHRvcm5hZG8tZGlhZ3JhbVxcdG9ybmFkby1kaWFncmFtLWpvYi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxiYXRjaFxcYmF0Y2gtc3RlcC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxleHRlbmRhYmxlLWVycm9yLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGluZGV4LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1jb21wdXRhdGlvbi1leGNlcHRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxqb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1yZXN0YXJ0LWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGVjdXRpb24tY29udGV4dC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxpbmRleC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItZXhlY3V0aW9uLWZsYWcuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWV4ZWN1dGlvbi1saXN0ZW5lci5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItZXhlY3V0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1pbnN0YW5jZS5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2Ita2V5LWdlbmVyYXRvci5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItbGF1bmNoZXIuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXBhcmFtZXRlci1kZWZpbml0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1wYXJhbWV0ZXJzLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXBvc2l0b3J5XFxpZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXJlcG9zaXRvcnlcXGpvYi1yZXBvc2l0b3J5LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXBvc2l0b3J5XFxzaW1wbGUtam9iLXJlcG9zaXRvcnkuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXJlcG9zaXRvcnlcXHRpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLXJlc3VsdC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2Itc3RhdHVzLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxzaW1wbGUtam9iLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXHN0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXHN0ZXAtZXhlY3V0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXHN0ZXAuanMiLCJzcmNcXGpvYnNcXGluZGV4LmpzIiwic3JjXFxqb2JzXFxqb2ItaW5zdGFuY2UtbWFuYWdlci5qcyIsInNyY1xcam9ic1xcam9iLXdvcmtlci5qcyIsInNyY1xcam9ic1xcam9icy1tYW5hZ2VyLmpzIiwic3JjXFxvYmplY3RpdmVcXG9iamVjdGl2ZS1ydWxlcy1tYW5hZ2VyLmpzIiwic3JjXFxvYmplY3RpdmVcXHJ1bGVzXFxleHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXGluZGV4LmpzIiwic3JjXFxvYmplY3RpdmVcXHJ1bGVzXFxtYXgtbWF4LXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1heC1taW4tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWF4aS1tYXgtcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWF4aS1taW4tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcbWluLW1heC1ydWxlLmpzIiwic3JjXFxvYmplY3RpdmVcXHJ1bGVzXFxtaW4tbWluLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1pbmktbWF4LXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1pbmktbWluLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG11bHRpLWNyaXRlcmlhLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG9iamVjdGl2ZS1ydWxlLmpzIiwic3JjXFxvcGVyYXRpb25zXFxmbGlwLXN1YnRyZWUuanMiLCJzcmNcXG9wZXJhdGlvbnNcXG9wZXJhdGlvbi5qcyIsInNyY1xcb3BlcmF0aW9uc1xcb3BlcmF0aW9ucy1tYW5hZ2VyLmpzIiwic3JjXFxwb2xpY2llc1xcZGVjaXNpb24uanMiLCJzcmNcXHBvbGljaWVzXFxwb2xpY2llcy1jb2xsZWN0b3IuanMiLCJzcmNcXHBvbGljaWVzXFxwb2xpY3kuanMiLCJzcmNcXHZhbGlkYXRpb25cXHBheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmNcXHZhbGlkYXRpb25cXHByb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyY1xcdmFsaWRhdGlvblxcdHJlZS12YWxpZGF0b3IuanMiLCJpbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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QUN6RDtBQUNKO0FBR0Q7O21CQUFBLEFBQU8sQUFDVjs7Ozs7Ozs7Ozs7Ozs7OztBQ3pFTCwyQ0FBQTtpREFBQTs7Z0JBQUE7d0JBQUE7b0JBQUE7QUFBQTtBQUFBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiB0b0FycmF5KGFycikge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHJlcXVlc3Q7XG4gICAgdmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuICAgICAgcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG5cbiAgICBwLnJlcXVlc3QgPSByZXF1ZXN0O1xuICAgIHJldHVybiBwO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcbiAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgICAgICAgIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG4gICAgdGhpcy5faW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdtdWx0aUVudHJ5JyxcbiAgICAndW5pcXVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnZ2V0JyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcbiAgICB0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcbiAgICAnZGlyZWN0aW9uJyxcbiAgICAna2V5JyxcbiAgICAncHJpbWFyeUtleScsXG4gICAgJ3ZhbHVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcbiAgICAndXBkYXRlJyxcbiAgICAnZGVsZXRlJ1xuICBdKTtcblxuICAvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuICBbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgIEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjdXJzb3IgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgY3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcbiAgICB0aGlzLl9zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ2luZGV4TmFtZXMnLFxuICAgICdhdXRvSW5jcmVtZW50J1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAncHV0JyxcbiAgICAnYWRkJyxcbiAgICAnZGVsZXRlJyxcbiAgICAnY2xlYXInLFxuICAgICdnZXQnLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnZGVsZXRlSW5kZXgnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcbiAgICB0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcbiAgICAnb2JqZWN0U3RvcmVOYW1lcycsXG4gICAgJ21vZGUnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG4gICAgJ2Fib3J0J1xuICBdKTtcblxuICBmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgICB0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuICAgIHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICB9XG5cbiAgVXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2RlbGV0ZU9iamVjdFN0b3JlJyxcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIERCKGRiKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgfVxuXG4gIERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgLy8gQWRkIGN1cnNvciBpdGVyYXRvcnNcbiAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuICBbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcbiAgICBbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGVbZnVuY05hbWUucmVwbGFjZSgnb3BlbicsICdpdGVyYXRlJyldID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAgIHZhciBuYXRpdmVPYmplY3QgPSB0aGlzLl9zdG9yZSB8fCB0aGlzLl9pbmRleDtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuYXRpdmVPYmplY3RbZnVuY05hbWVdLmFwcGx5KG5hdGl2ZU9iamVjdCwgYXJncy5zbGljZSgwLCAtMSkpO1xuICAgICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIHBvbHlmaWxsIGdldEFsbFxuICBbSW5kZXgsIE9iamVjdFN0b3JlXS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgaWYgKENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwpIHJldHVybjtcbiAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsID0gZnVuY3Rpb24ocXVlcnksIGNvdW50KSB7XG4gICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgdmFyIGl0ZW1zID0gW107XG5cbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgIGluc3RhbmNlLml0ZXJhdGVDdXJzb3IocXVlcnksIGZ1bmN0aW9uKGN1cnNvcikge1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaXRlbXMucHVzaChjdXJzb3IudmFsdWUpO1xuXG4gICAgICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQgJiYgaXRlbXMubGVuZ3RoID09IGNvdW50KSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgdmFyIGV4cCA9IHtcbiAgICBvcGVuOiBmdW5jdGlvbihuYW1lLCB2ZXJzaW9uLCB1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnb3BlbicsIFtuYW1lLCB2ZXJzaW9uXSk7XG4gICAgICB2YXIgcmVxdWVzdCA9IHAucmVxdWVzdDtcblxuICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgdXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgfVxuICBlbHNlIHtcbiAgICBzZWxmLmlkYiA9IGV4cDtcbiAgfVxufSgpKTtcbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJDb25maWd9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5cblxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lQ29uZmlnIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ3tcbiAgICBsb2dMZXZlbCA9ICd3YXJuJztcbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vL0VudHJ5IHBvaW50IGNsYXNzIGZvciBzdGFuZGFsb25lIGNvbXB1dGF0aW9uIHdvcmtlcnNcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmUgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2Vye1xuXG4gICAgZ2xvYmFsID0gVXRpbHMuZ2V0R2xvYmFsT2JqZWN0KCk7XG4gICAgaXNXb3JrZXIgPSBVdGlscy5pc1dvcmtlcigpO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhKXtcbiAgICAgICAgc3VwZXIoY29uZmlnLCBkYXRhKTtcblxuICAgICAgICBpZih0aGlzLmlzV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih7XG4gICAgICAgICAgICAgICAgYmVmb3JlSm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdiZWZvcmVKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICBhZnRlckpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYWZ0ZXJKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICAgICAgdGhpcy5xdWVyeWFibGVGdW5jdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcnVuSm9iOiBmdW5jdGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coam9iTmFtZSwgam9iUGFyYW1ldGVycywgc2VyaWFsaXplZERhdGEpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGV4ZWN1dGVKb2I6IGZ1bmN0aW9uKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuam9ic01hbmdlci5leGVjdXRlKGpvYkV4ZWN1dGlvbklkKS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5yZXBseSgnam9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBVdGlscy5nZXRFcnJvckRUTyhlKSk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZWNvbXB1dGU6IGZ1bmN0aW9uKGRhdGFEVE8sIHJ1bGVOYW1lLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdyZWNvbXB1dGVkJywgZGF0YS5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZ2xvYmFsLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKG9FdmVudCkge1xuICAgICAgICAgICAgICAgIGlmIChvRXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2QnKSAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5xdWVyeWFibGVGdW5jdGlvbnNbb0V2ZW50LmRhdGEucXVlcnlNZXRob2RdLmFwcGx5KHNlbGYsIG9FdmVudC5kYXRhLnF1ZXJ5QXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5kZWZhdWx0UmVwbHkob0V2ZW50LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICBzdXBlci5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5zZXRMb2dMZXZlbCh0aGlzLmNvbmZpZy5sb2dMZXZlbCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNldExvZ0xldmVsKGxldmVsKXtcbiAgICAgICAgbG9nLnNldExldmVsKGxldmVsKVxuICAgIH1cblxuICAgIGRlZmF1bHRSZXBseShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMucmVwbHkoJ3Rlc3QnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXBseSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXBseSAtIG5vdCBlbm91Z2ggYXJndW1lbnRzJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5nbG9iYWwucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlNZXRob2RBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlc01hbmFnZXJ9IGZyb20gXCIuL29iamVjdGl2ZS9vYmplY3RpdmUtcnVsZXMtbWFuYWdlclwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge09wZXJhdGlvbnNNYW5hZ2VyfSBmcm9tIFwiLi9vcGVyYXRpb25zL29wZXJhdGlvbnMtbWFuYWdlclwiO1xuaW1wb3J0IHtKb2JzTWFuYWdlcn0gZnJvbSBcIi4vam9icy9qb2JzLW1hbmFnZXJcIjtcbmltcG9ydCB7RXhwcmVzc2lvbnNFdmFsdWF0b3J9IGZyb20gXCIuL2V4cHJlc3Npb25zLWV2YWx1YXRvclwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZU1hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9iLWluc3RhbmNlLW1hbmFnZXJcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcge1xuXG4gICAgbG9nTGV2ZWwgPSBudWxsO1xuXG4gICAgcnVsZU5hbWUgPSBudWxsO1xuICAgIHdvcmtlciA9IHtcbiAgICAgICAgZGVsZWdhdGVSZWNvbXB1dGF0aW9uOiBmYWxzZSxcbiAgICAgICAgdXJsOiBudWxsXG4gICAgfTtcbiAgICBqb2JSZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgIGNsZWFyUmVwb3NpdG9yeSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXIge1xuICAgIGRhdGE7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBvcGVyYXRpb25zTWFuYWdlcjtcbiAgICBqb2JzTWFuZ2VyO1xuXG4gICAgdHJlZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZywgZGF0YSA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gbmV3IEV4cHJlc3Npb25FbmdpbmUoKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IG5ldyBFeHByZXNzaW9uc0V2YWx1YXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG5ldyBPYmplY3RpdmVSdWxlc01hbmFnZXIodGhpcy5leHByZXNzaW9uRW5naW5lLCB0aGlzLmNvbmZpZy5ydWxlTmFtZSk7XG4gICAgICAgIHRoaXMub3BlcmF0aW9uc01hbmFnZXIgPSBuZXcgT3BlcmF0aW9uc01hbmFnZXIodGhpcy5kYXRhLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmpvYnNNYW5nZXIgPSBuZXcgSm9ic01hbmFnZXIodGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHtcbiAgICAgICAgICAgIHdvcmtlclVybDogdGhpcy5jb25maWcud29ya2VyLnVybCxcbiAgICAgICAgICAgIHJlcG9zaXRvcnlUeXBlOiB0aGlzLmNvbmZpZy5qb2JSZXBvc2l0b3J5VHlwZSxcbiAgICAgICAgICAgIGNsZWFyUmVwb3NpdG9yeTogdGhpcy5jb25maWcuY2xlYXJSZXBvc2l0b3J5XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBnZXRDdXJyZW50UnVsZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmN1cnJlbnRSdWxlO1xuICAgIH1cblxuICAgIGZsaXBDcml0ZXJpYShkYXRhKXtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLnJldmVyc2VQYXlvZmZzKCk7XG4gICAgICAgIGxldCB0bXAgPSBkYXRhLndlaWdodExvd2VyQm91bmQ7XG4gICAgICAgIGRhdGEud2VpZ2h0TG93ZXJCb3VuZCA9IHRoaXMuZmxpcChkYXRhLndlaWdodFVwcGVyQm91bmQpO1xuICAgICAgICBkYXRhLndlaWdodFVwcGVyQm91bmQgPSB0aGlzLmZsaXAodG1wKTtcbiAgICAgICAgZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCA9IHRoaXMuZmxpcChkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZmxpcFJ1bGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShmYWxzZSk7XG4gICAgfVxuXG4gICAgZmxpcChhKXtcbiAgICAgICAgaWYoYSA9PSBJbmZpbml0eSl7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGEgPT0gMCl7XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgYSlcblxuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShqb2JOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnJ1bihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEgfHwgdGhpcy5kYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZClcbiAgICB9XG5cbiAgICBydW5Kb2JXaXRoSW5zdGFuY2VNYW5hZ2VyKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgam9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlTWFuYWdlcih0aGlzLmpvYnNNYW5nZXIsIGplLCBqb2JJbnN0YW5jZU1hbmFnZXJDb25maWcpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucnVsZXM7XG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXRPYmplY3RpdmVSdWxlQnlOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmlzUnVsZU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgdGhpcy5jb25maWcucnVsZU5hbWUgPSBydWxlTmFtZTtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIG9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbnNNYW5hZ2VyLm9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KTtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25maWcud29ya2VyLmRlbGVnYXRlUmVjb21wdXRhdGlvbikge1xuICAgICAgICAgICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICAgIGV2YWxDb2RlOiBldmFsQ29kZSxcbiAgICAgICAgICAgICAgICAgICAgZXZhbE51bWVyaWM6IGV2YWxOdW1lcmljXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoIWFsbFJ1bGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIHBhcmFtcy5ydWxlTmFtZSA9IHRoaXMuZ2V0Q3VycmVudFJ1bGUoKS5uYW1lO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5ydW5Kb2IoXCJyZWNvbXB1dGVcIiwgcGFyYW1zLCB0aGlzLmRhdGEsIGZhbHNlKS50aGVuKChqb2JFeGVjdXRpb24pPT4ge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IGpvYkV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGF0YS51cGRhdGVGcm9tKGQpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKHRoaXMuZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZURpc3BsYXlWYWx1ZXModGhpcy5kYXRhKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIF9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIudXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZiAoZXZhbENvZGUgfHwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy9DaGVja3MgdmFsaWRpdHkgb2YgZGF0YSBtb2RlbCB3aXRob3V0IHJlY29tcHV0YXRpb24gYW5kIHJldmFsaWRhdGlvblxuICAgIGlzVmFsaWQoZGF0YSkge1xuICAgICAgICB2YXIgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICByZXR1cm4gZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5ldmVyeSh2cj0+dnIuaXNWYWxpZCgpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVEaXNwbGF5VmFsdWVzKGRhdGEsIHBvbGljeVRvRGlzcGxheSA9IG51bGwpIHtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBpZiAocG9saWN5VG9EaXNwbGF5KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5KGRhdGEsIHBvbGljeVRvRGlzcGxheSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobik7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlRWRnZURpc3BsYXlWYWx1ZXMoZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobm9kZSkge1xuICAgICAgICBub2RlLiRESVNQTEFZX1ZBTFVFX05BTUVTLmZvckVhY2gobj0+bm9kZS5kaXNwbGF5VmFsdWUobiwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuKSkpO1xuICAgIH1cblxuICAgIHVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpIHtcbiAgICAgICAgZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49PmUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldEVkZ2VEaXNwbGF5VmFsdWUoZSwgbikpKTtcbiAgICB9XG5cbiAgICBkaXNwbGF5UG9saWN5KHBvbGljeVRvRGlzcGxheSwgZGF0YSkge1xuXG5cbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIG4uY2xlYXJEaXNwbGF5VmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIGUuY2xlYXJEaXNwbGF5VmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaCgocm9vdCk9PnRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUocm9vdCwgcG9saWN5VG9EaXNwbGF5KSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeUZvck5vZGUobm9kZSwgcG9saWN5KSB7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSB7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24ocG9saWN5LCBub2RlKTtcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2coZGVjaXNpb24sIG5vZGUsIHBvbGljeSk7XG4gICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICBub2RlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkRWRnZSA9IG5vZGUuY2hpbGRFZGdlc1tkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICBjaGlsZEVkZ2UuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShjaGlsZEVkZ2UuY2hpbGROb2RlLCBwb2xpY3kpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGUuY2hpbGROb2RlLCBwb2xpY3kpKVxuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zVXRpbHN7XG5cbiAgICBzdGF0aWMgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChtYXgsIG1pbik7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIHN0ZXBzID0gbGVuZ3RoIC0gMTtcbiAgICAgICAgaWYoIXN0ZXBzKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShleHRlbnQsbGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciBjdXJyID0gbWluO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aCAtIDI7IGkrKykge1xuICAgICAgICAgICAgY3VyciA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGN1cnIsIHN0ZXApO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KGN1cnIpKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQucHVzaChtYXgpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG4vKkV2YWx1YXRlcyBjb2RlIGFuZCBleHByZXNzaW9ucyBpbiB0cmVlcyovXG5leHBvcnQgY2xhc3MgRXhwcmVzc2lvbnNFdmFsdWF0b3Ige1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgY2xlYXIoZGF0YSl7XG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY2xlYXJUcmVlKGRhdGEsIHJvb3Qpe1xuICAgICAgICBkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICBuLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGVzPWZhbHNlKXtcbiAgICAgICAgbG9nLmRlYnVnKCdldmFsRXhwcmVzc2lvbnMgZXZhbENvZGU6JytldmFsQ29kZSsnIGV2YWxOdW1lcmljOicrZXZhbE51bWVyaWMpO1xuICAgICAgICBpZihldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhclRyZWUoZGF0YSwgbik7XG4gICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbiwgZXZhbENvZGUsIGV2YWxOdW1lcmljLGluaXRTY29wZXMpO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGV2YWxHbG9iYWxDb2RlKGRhdGEpe1xuICAgICAgICBkYXRhLmNsZWFyRXhwcmVzc2lvblNjb3BlKCk7XG4gICAgICAgIGRhdGEuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwoZGF0YS5jb2RlLCBmYWxzZSwgZGF0YS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgZGF0YS4kY29kZUVycm9yID0gZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbm9kZSwgZXZhbENvZGU9dHJ1ZSwgZXZhbE51bWVyaWM9dHJ1ZSwgaW5pdFNjb3BlPWZhbHNlKSB7XG4gICAgICAgIGlmKCFub2RlLmV4cHJlc3Npb25TY29wZSB8fCBpbml0U2NvcGUgfHwgZXZhbENvZGUpe1xuICAgICAgICAgICAgdGhpcy5pbml0U2NvcGVGb3JOb2RlKGRhdGEsIG5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIG5vZGUuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICAgICAgaWYobm9kZS5jb2RlKXtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKG5vZGUuY29kZSwgZmFsc2UsIG5vZGUuZXhwcmVzc2lvblNjb3BlKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgICAgICAgICBub2RlLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgdmFyIHNjb3BlID0gbm9kZS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW09RXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcbiAgICAgICAgICAgIHZhciBoYXNoRWRnZXM9IFtdO1xuICAgICAgICAgICAgdmFyIGludmFsaWRQcm9iID0gZmFsc2U7XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLnBheW9mZi5mb3JFYWNoKChyYXdQYXlvZmYsIHBheW9mZkluZGV4KT0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHBhdGggPSAncGF5b2ZmWycgKyBwYXlvZmZJbmRleCArICddJztcbiAgICAgICAgICAgICAgICAgICAgaWYoZS5pc0ZpZWxkVmFsaWQocGF0aCwgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgcGF0aCwgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWxQYXlvZmYoZSwgcGF5b2ZmSW5kZXgpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgTGVmdCBlbXB0eSBpbnRlbnRpb25hbGx5XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuXG5cbiAgICAgICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaXNIYXNoKGUucHJvYmFiaWxpdHkpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2hFZGdlcy5wdXNoKGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5oYXNBc3NpZ25tZW50RXhwcmVzc2lvbihlLnByb2JhYmlsaXR5KSl7IC8vSXQgc2hvdWxkIG5vdCBvY2N1ciBoZXJlIVxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nLndhcm4oXCJldmFsRXhwcmVzc2lvbnNGb3JOb2RlIGhhc0Fzc2lnbm1lbnRFeHByZXNzaW9uIVwiLCBlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoZS5pc0ZpZWxkVmFsaWQoJ3Byb2JhYmlsaXR5JywgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGUucHJvYmFiaWxpdHksIHRydWUsIHNjb3BlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3Byb2JhYmlsaXR5JywgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9Y2F0Y2ggKGVycil7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW52YWxpZFByb2IgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG5cblxuICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHZhciBjb21wdXRlSGFzaCA9IGhhc2hFZGdlcy5sZW5ndGggJiYgIWludmFsaWRQcm9iICYmIChwcm9iYWJpbGl0eVN1bS5jb21wYXJlKDApID49IDAgJiYgcHJvYmFiaWxpdHlTdW0uY29tcGFyZSgxKSA8PSAwKTtcblxuICAgICAgICAgICAgICAgIGlmKGNvbXB1dGVIYXNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYXNoID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdCgxLCBwcm9iYWJpbGl0eVN1bSksIGhhc2hFZGdlcy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIGhhc2gpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgZS5jaGlsZE5vZGUsIGV2YWxDb2RlLCBldmFsTnVtZXJpYywgaW5pdFNjb3BlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdFNjb3BlRm9yTm9kZShkYXRhLCBub2RlKXtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5vZGUuJHBhcmVudDtcbiAgICAgICAgdmFyIHBhcmVudFNjb3BlID0gcGFyZW50P3BhcmVudC5leHByZXNzaW9uU2NvcGUgOiBkYXRhLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgbm9kZS5leHByZXNzaW9uU2NvcGUgPSBVdGlscy5jbG9uZURlZXAocGFyZW50U2NvcGUpO1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLWVuZ2luZSdcbmV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2V4cHJlc3Npb25zLWV2YWx1YXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9icy9pbmRleCdcblxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgLy8gdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwid2VpZ2h0TG93ZXJCb3VuZFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB2ID49IDAgJiYgdiA8PSBhbGxWYWxzWyd3ZWlnaHRVcHBlckJvdW5kJ10pKTtcbiAgICAgICAgLy8gdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwid2VpZ2h0VXBwZXJCb3VuZFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB2ID49IDAgJiYgdiA+PSBhbGxWYWxzWyd3ZWlnaHRMb3dlckJvdW5kJ10pKTtcblxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24xOiAnQ29zdCcsXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24yOiAnRWZmZWN0JyxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWUsXG4gICAgICAgICAgICB3ZWlnaHRMb3dlckJvdW5kOiAwLFxuICAgICAgICAgICAgd2VpZ2h0VXBwZXJCb3VuZDogSW5maW5pdHksXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7TGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9sZWFndWUtdGFibGUtam9iLXBhcmFtZXRlcnNcIjtcblxuXG5leHBvcnQgY2xhc3MgTGVhZ3VlVGFibGVKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImxlYWd1ZS10YWJsZVwiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5pbml0U3RlcHMoKTtcbiAgICB9XG5cbiAgICBpbml0U3RlcHMoKSB7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IExlYWd1ZVRhYmxlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzID0gdHJ1ZSkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmICh3aXRoSGVhZGVycykge1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeV9pZCcsICdwb2xpY3knLCBqb2JSZXN1bHQucGF5b2ZmTmFtZXNbMF0sIGpvYlJlc3VsdC5wYXlvZmZOYW1lc1sxXSwgJ2RvbWluYXRlZF9ieScsICdleHRlbmRlZC1kb21pbmF0ZWRfYnknLCAnaW5jcmF0aW8nXTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93LnBvbGljaWVzLmZvckVhY2gocG9saWN5PT4ge1xuICAgICAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtcbiAgICAgICAgICAgICAgICAgICAgcm93LmlkLFxuICAgICAgICAgICAgICAgICAgICBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgcm93LnBheW9mZnNbMV0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5wYXlvZmZzWzBdLFxuICAgICAgICAgICAgICAgICAgICByb3cuZG9taW5hdGVkQnksXG4gICAgICAgICAgICAgICAgICAgIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5ID09PSBudWxsID8gbnVsbCA6IHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzBdICsgJywgJyArIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzFdLFxuICAgICAgICAgICAgICAgICAgICByb3cuaW5jcmF0aW9cbiAgICAgICAgICAgICAgICBdO1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuY3VycmVudFJ1bGU7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuXG4gICAgICAgIHZhciBwYXlvZmZDb2VmZnMgPSB0aGlzLnBheW9mZkNvZWZmcyA9IHJ1bGUucGF5b2ZmQ29lZmZzO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEpO1xuICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuXG4gICAgICAgIGlmICghdnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjb21wYXJlID0gKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYi5wYXlvZmZzWzBdIC0gYS5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgKGEucGF5b2Zmc1sxXSAtIGIucGF5b2Zmc1sxXSkpO1xuXG4gICAgICAgIHZhciByb3dzID0gcG9saWNpZXMubWFwKHBvbGljeSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IFtwb2xpY3ldLFxuICAgICAgICAgICAgICAgIHBheW9mZnM6IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKS5zbGljZSgpLFxuICAgICAgICAgICAgICAgIGRvbWluYXRlZEJ5OiBudWxsLFxuICAgICAgICAgICAgICAgIGV4dGVuZGVkRG9taW5hdGVkQnk6IG51bGwsXG4gICAgICAgICAgICAgICAgaW5jcmF0aW86IG51bGxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuc29ydChjb21wYXJlKTtcblxuICAgICAgICByb3dzID0gcm93cy5yZWR1Y2UoKHByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZSwgaW5kZXgsIGFycmF5KT0+e1xuICAgICAgICAgICAgaWYoIXByZXZpb3VzVmFsdWUubGVuZ3RoKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2N1cnJlbnRWYWx1ZV1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBwcmV2aW91c1ZhbHVlW3ByZXZpb3VzVmFsdWUubGVuZ3RoLTFdO1xuICAgICAgICAgICAgaWYoY29tcGFyZShwcmV2LCBjdXJyZW50VmFsdWUpID09IDApe1xuICAgICAgICAgICAgICAgIHByZXYucG9saWNpZXMucHVzaCguLi5jdXJyZW50VmFsdWUucG9saWNpZXMpO1xuICAgICAgICAgICAgICAgIHJldHVybiBwcmV2aW91c1ZhbHVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcHJldmlvdXNWYWx1ZS5jb25jYXQoY3VycmVudFZhbHVlKVxuICAgICAgICB9LCBbXSk7XG5cbiAgICAgICAgcm93cy5zb3J0KChhLCBiKT0+KHBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgociwgaSk9PiB7XG4gICAgICAgICAgICByLmlkID0gaSsxO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gcm93cy5zb3J0KGNvbXBhcmUpO1xuICAgICAgICByb3dzLnNvcnQoKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG5cbiAgICAgICAgbGV0IGJlc3RDb3N0ID0gLXBheW9mZkNvZWZmc1sxXSAqIEluZmluaXR5LFxuICAgICAgICAgICAgYmVzdENvc3RSb3cgPSBudWxsO1xuXG4gICAgICAgIGxldCBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgaWYocGF5b2ZmQ29lZmZzWzFdPDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1cblxuICAgICAgICByb3dzLmZvckVhY2goKHIsIGkpPT4ge1xuICAgICAgICAgICAgaWYgKGNtcChyLnBheW9mZnNbMV0sIGJlc3RDb3N0KSkge1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0ID0gci5wYXlvZmZzWzFdO1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0Um93ID0gcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZihiZXN0Q29zdFJvdykge1xuICAgICAgICAgICAgICAgIHIuZG9taW5hdGVkQnkgPSBiZXN0Q29zdFJvdy5pZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIGlmKHBheW9mZkNvZWZmc1swXSA+IDAgJiYgcGF5b2ZmQ29lZmZzWzFdIDwgMCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfWVsc2UgaWYocGF5b2ZmQ29lZmZzWzBdIDwgMCAmJiBwYXlvZmZDb2VmZnNbMV0gPiAwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9ZWxzZSBpZihwYXlvZmZDb2VmZnNbMV08MCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJvd3MuZmlsdGVyKHI9PiFyLmRvbWluYXRlZEJ5KS5zb3J0KChhLCBiKT0+KCAgcGF5b2ZmQ29lZmZzWzBdICogKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpKS5mb3JFYWNoKChyLCBpLCBhcnIpPT4ge1xuICAgICAgICAgICAgaWYgKGkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHIuaW5jcmF0aW8gPSAwO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBhcnJbaSAtIDFdO1xuXG4gICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2KTtcbiAgICAgICAgICAgIGlmIChpIDwgMikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYyID0gYXJyW2kgLSAyXTtcbiAgICAgICAgICAgIGlmIChwcmV2Mi5leHRlbmRlZERvbWluYXRlZEJ5ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihjbXAoci5pbmNyYXRpbyxwcmV2LmluY3JhdGlvKSl7XG4gICAgICAgICAgICAgICAgcHJldi5pbmNyYXRpbyA9IG51bGw7XG4gICAgICAgICAgICAgICAgcHJldi5leHRlbmRlZERvbWluYXRlZEJ5ID0gW3ByZXYyLmlkLCByLmlkXSA7XG5cbiAgICAgICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2Mik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCB3ZWlnaHRMb3dlckJvdW5kID0gZGF0YS53ZWlnaHRMb3dlckJvdW5kO1xuICAgICAgICBsZXQgd2VpZ2h0VXBwZXJCb3VuZCA9IGRhdGEud2VpZ2h0VXBwZXJCb3VuZDtcbiAgICAgICAgLy9tYXJrIG9wdGltYWwgZm9yIHdlaWdodCBpbiBbd2VpZ2h0TG93ZXJCb3VuZCwgd2VpZ2h0VXBwZXJCb3VuZF1cbiAgICAgICAgbGV0IGxhc3RMRUxvd2VyID0gbnVsbDtcbiAgICAgICAgcm93cy5zbGljZSgpLmZpbHRlcihyPT4hci5kb21pbmF0ZWRCeSAmJiAhci5leHRlbmRlZERvbWluYXRlZEJ5KS5zb3J0KChhLCBiKSA9PiBhLmluY3JhdGlvIC0gYi5pbmNyYXRpbykuZm9yRWFjaCgocm93LCBpLCBhcnIpPT57XG5cbiAgICAgICAgICAgIGlmKHJvdy5pbmNyYXRpbyA8PSB3ZWlnaHRMb3dlckJvdW5kKXtcbiAgICAgICAgICAgICAgICBsYXN0TEVMb3dlciAgPSByb3c7XG4gICAgICAgICAgICB9ZWxzZSBpZihyb3cuaW5jcmF0aW8gPT0gd2VpZ2h0TG93ZXJCb3VuZCl7XG4gICAgICAgICAgICAgICAgbGFzdExFTG93ZXIgPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb3cub3B0aW1hbCA9IHJvdy5pbmNyYXRpbyA+PSB3ZWlnaHRMb3dlckJvdW5kICYmIHJvdy5pbmNyYXRpbyA8PSB3ZWlnaHRVcHBlckJvdW5kO1xuXG4gICAgICAgIH0pO1xuICAgICAgICBpZihsYXN0TEVMb3dlcil7XG4gICAgICAgICAgICBsYXN0TEVMb3dlci5vcHRpbWFsID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJvd3MuZm9yRWFjaChyb3c9PntcbiAgICAgICAgICAgIHJvdy5wYXlvZmZzWzBdID0gIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cucGF5b2Zmc1swXSk7XG4gICAgICAgICAgICByb3cucGF5b2Zmc1sxXSA9ICBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LnBheW9mZnNbMV0pO1xuICAgICAgICAgICAgcm93LmluY3JhdGlvID0gcm93LmluY3JhdGlvID09PSBudWxsID8gbnVsbCA6IEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cuaW5jcmF0aW8pO1xuICAgICAgICB9KTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YSA9IHtcbiAgICAgICAgICAgIHBheW9mZk5hbWVzOiBkYXRhLnBheW9mZk5hbWVzLnNsaWNlKCksXG4gICAgICAgICAgICBwYXlvZmZDb2VmZnMgOiBwYXlvZmZDb2VmZnMsXG4gICAgICAgICAgICByb3dzOiByb3dzLnNvcnQoKGEsIGIpPT4oYS5pZCAtIGIuaWQpKVxuICAgICAgICB9O1xuXG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNvbXB1dGVJQ0VSKHIsIHByZXYpe1xuICAgICAgICBsZXQgZCA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzBdLCBwcmV2LnBheW9mZnNbMF0pO1xuICAgICAgICBsZXQgbiA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzFdLCBwcmV2LnBheW9mZnNbMV0pO1xuICAgICAgICBpZiAoZCA9PSAwKXtcbiAgICAgICAgICAgIGlmKG48MCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0gSW5maW5pdHk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE1hdGguYWJzKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKG4sIGQpKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDApKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXZhbENvZGVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsTnVtZXJpY1wiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIHJ1bGVOYW1lOiBudWxsLCAvL3JlY29tcHV0ZSBhbGwgcnVsZXNcbiAgICAgICAgICAgIGV2YWxDb2RlOiB0cnVlLFxuICAgICAgICAgICAgZXZhbE51bWVyaWM6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9yZWNvbXB1dGUtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYlwiO1xuXG5leHBvcnQgY2xhc3MgUmVjb21wdXRlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJyZWNvbXB1dGVcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuaXNSZXN0YXJ0YWJsZSA9IGZhbHNlO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGRhdGEgPSBleGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnM7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgYWxsUnVsZXMgPSAhcnVsZU5hbWU7XG4gICAgICAgIGlmKHJ1bGVOYW1lKXtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIHBhcmFtcy52YWx1ZShcImV2YWxDb2RlXCIpLCBwYXJhbXMudmFsdWUoXCJldmFsTnVtZXJpY1wiKSlcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cyA9IFtdO1xuXG4gICAgICAgIGlmKGV2YWxDb2RlfHxldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gocm9vdD0+IHtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpKTtcbiAgICAgICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMucHVzaCh2cik7XG4gICAgICAgICAgICBpZiAodnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUmVjb21wdXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDIpLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDwgdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cblxuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplPTUpIHtcbiAgICAgICAgc3VwZXIoXCJzZW5zaXRpdml0eS1hbmFseXNpc1wiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5iYXRjaFNpemUgPSA1O1xuICAgICAgICB0aGlzLmluaXRTdGVwcygpO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpe1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwID0gbmV3IENhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc2V0QmF0Y2hTaXplKGJhdGNoU2l6ZSl7XG4gICAgICAgIHRoaXMuYmF0Y2hTaXplID0gYmF0Y2hTaXplO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAuY2h1bmtTaXplID0gYmF0Y2hTaXplO1xuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzPXRydWUpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmKHdpdGhIZWFkZXJzKXtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3lfbnVtYmVyJywgJ3BvbGljeSddO1xuICAgICAgICAgICAgam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMuZm9yRWFjaChuPT5oZWFkZXJzLnB1c2gobikpO1xuICAgICAgICAgICAgaGVhZGVycy5wdXNoKCdwYXlvZmYnKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJvdW5kVmFyaWFibGVzID0gISFqb2JQYXJhbWV0ZXJzLnZhbHVlcy5yb3VuZFZhcmlhYmxlcztcbiAgICAgICAgaWYocm91bmRWYXJpYWJsZXMpe1xuICAgICAgICAgICAgdGhpcy5yb3VuZFZhcmlhYmxlcyhqb2JSZXN1bHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgdmFyIHBvbGljeSA9IGpvYlJlc3VsdC5wb2xpY2llc1tyb3cucG9saWN5SW5kZXhdO1xuICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW3Jvdy5wb2xpY3lJbmRleCsxLCBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKV07XG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2godj0+IHJvd0NlbGxzLnB1c2godikpO1xuICAgICAgICAgICAgcm93Q2VsbHMucHVzaChyb3cucGF5b2ZmKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcblxuICAgICAgICAgICAgaWYocm93Ll92YXJpYWJsZXMpeyAvL3JldmVydCBvcmlnaW5hbCB2YXJpYWJsZXNcbiAgICAgICAgICAgICAgICByb3cudmFyaWFibGVzID0gcm93Ll92YXJpYWJsZXM7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHJvdy5fdmFyaWFibGVzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJvdW5kVmFyaWFibGVzKGpvYlJlc3VsdCl7XG4gICAgICAgIHZhciB1bmlxdWVWYWx1ZXMgPSBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5tYXAoKCk9Pm5ldyBTZXQoKSk7XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93Ll92YXJpYWJsZXMgPSByb3cudmFyaWFibGVzLnNsaWNlKCk7IC8vIHNhdmUgb3JpZ2luYWwgcm93IHZhcmlhYmxlc1xuICAgICAgICAgICAgcm93LnZhcmlhYmxlcy5mb3JFYWNoKCh2LGkpPT4ge1xuICAgICAgICAgICAgICAgIHVuaXF1ZVZhbHVlc1tpXS5hZGQodilcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdW5pcXVlVmFsdWVzTm8gPSB1bmlxdWVWYWx1ZXMubWFwKChzKT0+cy5zaXplKTtcbiAgICAgICAgdmFyIG1heFByZWNpc2lvbiA9IDE0O1xuICAgICAgICB2YXIgcHJlY2lzaW9uID0gMjtcbiAgICAgICAgdmFyIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcyA9IGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLm1hcCgodixpKT0+aSk7XG4gICAgICAgIHdoaWxlKHByZWNpc2lvbjw9bWF4UHJlY2lzaW9uICYmIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdW5pcXVlVmFsdWVzID0gbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLm1hcCgoKT0+bmV3IFNldCgpKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgICAgICBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMuZm9yRWFjaCgodmFyaWFibGVJbmRleCwgbm90UmVhZHlJbmRleCk9PntcblxuICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gcm93Ll92YXJpYWJsZXNbdmFyaWFibGVJbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHZhbCA9IFV0aWxzLnJvdW5kKHZhbCwgcHJlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlVmFsdWVzW25vdFJlYWR5SW5kZXhdLmFkZCh2YWwpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZXNbdmFyaWFibGVJbmRleF0gPSB2YWw7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgbmV3UmVhZHlJbmRleGVzID0gW107XG4gICAgICAgICAgICB1bmlxdWVWYWx1ZXMuZm9yRWFjaCgodW5pcXVlVmFscywgbm90UmVhZHlJbmRleCk9PntcbiAgICAgICAgICAgICAgICB2YXIgb3JpZ1VuaXF1ZUNvdW50ID0gdW5pcXVlVmFsdWVzTm9bbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzW25vdFJlYWR5SW5kZXhdXSA7XG4gICAgICAgICAgICAgICAgaWYob3JpZ1VuaXF1ZUNvdW50PT11bmlxdWVWYWxzLnNpemUpeyAvL3JlYWR5IGluIHByZXZpb3VzIGl0ZXJhdGlvblxuICAgICAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMucHVzaChub3RSZWFkeUluZGV4KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmKG5ld1JlYWR5SW5kZXhlcy5sZW5ndGgpIHsgLy9yZXZlcnQgdmFsdWVzIHRvIHByZXYgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgbmV3UmVhZHlJbmRleGVzLnJldmVyc2UoKTtcbiAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMuZm9yRWFjaChub3RSZWFkeUluZGV4PT57XG4gICAgICAgICAgICAgICAgICAgIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5zcGxpY2Uobm90UmVhZHlJbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHByZWNpc2lvbisrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSkge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cblxuICAgICAgICBpZiAoIWpvYlJlc3VsdC5kYXRhLnJvd3MpIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MgPSBbXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMgPSB2YXJpYWJsZU5hbWVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0pIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGZhaWxPbkludmFsaWRUcmVlID0gcGFyYW1zLnZhbHVlKFwiZmFpbE9uSW52YWxpZFRyZWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2YXJpYWJsZU5hbWUsIGkpPT4ge1xuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IGl0ZW1baV07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG5cbiAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgIGlmKCF2YWxpZCAmJiBmYWlsT25JbnZhbGlkVHJlZSl7XG4gICAgICAgICAgICBsZXQgZXJyb3JEYXRhID0ge1xuICAgICAgICAgICAgICAgIHZhcmlhYmxlczoge31cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2goKHZhcmlhYmxlTmFtZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1t2YXJpYWJsZU5hbWVdID0gaXRlbVtpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uKFwiY29tcHV0YXRpb25zXCIsIGVycm9yRGF0YSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwYXlvZmZzID0gW107XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaChwb2xpY3k9PiB7XG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gJ24vYSc7XG4gICAgICAgICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgICAgICBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJylbMF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXlvZmZzLnB1c2gocGF5b2ZmKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgIHZhcmlhYmxlczogaXRlbSxcbiAgICAgICAgICAgIHBheW9mZnM6IHBheW9mZnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbiA9IHBhcmFtcy52YWx1ZShcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIik7XG5cbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtPT4ge1xuICAgICAgICAgICAgaWYgKCFpdGVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksIGkpPT4ge1xuICAgICAgICAgICAgICAgIHZhciB2YXJpYWJsZXMgPSBpdGVtLnZhcmlhYmxlcy5tYXAodiA9PiB0aGlzLnRvRmxvYXQodikpO1xuXG4gICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGl0ZW0ucGF5b2Zmc1tpXTtcbiAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICBwb2xpY3lJbmRleDogaSxcbiAgICAgICAgICAgICAgICAgICAgdmFyaWFibGVzOiB2YXJpYWJsZXMsXG4gICAgICAgICAgICAgICAgICAgIHBheW9mZjogVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSA/IHBheW9mZiA6IHRoaXMudG9GbG9hdChwYXlvZmYpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2gocm93KTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGRlbGV0ZSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY2llc1wiLCBwb2xpY2llcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhKXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhPXt9XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcyA9IHBvbGljaWVzO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNVdGlsc30gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NvbXB1dGF0aW9ucy11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJlcGFyZVZhcmlhYmxlc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKFwicHJlcGFyZV92YXJpYWJsZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKENvbXB1dGF0aW9uc1V0aWxzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhcmlhYmxlVmFsdWVzID0gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGE9e1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXM6IHZhcmlhYmxlVmFsdWVzXG4gICAgICAgIH07XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJudW1iZXJPZlJ1bnNcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID4gMCkpO1xuXG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmb3JtdWxhXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKVxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi4vbi13YXkvc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuLi9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7UHJvYkNhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL3Byb2ItY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Q29tcHV0ZVBvbGljeVN0YXRzU3RlcH0gZnJvbSBcIi4vc3RlcHMvY29tcHV0ZS1wb2xpY3ktc3RhdHMtc3RlcFwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZT01KSB7XG4gICAgICAgIHN1cGVyKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMubmFtZSA9IFwicHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1wiO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpIHtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgUHJvYkNhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDb21wdXRlUG9saWN5U3RhdHNTdGVwKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pIHtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1sxXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMV0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nLCBVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRlUG9saWN5U3RhdHNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiY29tcHV0ZV9wb2xpY3lfc3RhdHNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICBsZXQgcnVsZSA9IHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuXG5cbiAgICAgICAgdmFyIHBheW9mZnNQZXJQb2xpY3kgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5tYXAoKCk9PltdKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLmZvckVhY2gocm93PT4ge1xuICAgICAgICAgICAgcGF5b2Zmc1BlclBvbGljeVtyb3cucG9saWN5SW5kZXhdLnB1c2goVXRpbHMuaXNTdHJpbmcocm93LnBheW9mZikgPyAwIDogcm93LnBheW9mZilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9nLmRlYnVnKCdwYXlvZmZzUGVyUG9saWN5JywgcGF5b2Zmc1BlclBvbGljeSwgam9iUmVzdWx0LmRhdGEucm93cy5sZW5ndGgsIHJ1bGUubWF4aW1pemF0aW9uKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5tZWRpYW5zID0gcGF5b2Zmc1BlclBvbGljeS5tYXAocGF5b2Zmcz0+RXhwcmVzc2lvbkVuZ2luZS5tZWRpYW4ocGF5b2ZmcykpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5zdGFuZGFyZERldmlhdGlvbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLnN0ZChwYXlvZmZzKSk7XG5cbiAgICAgICAgaWYgKHJ1bGUubWF4aW1pemF0aW9uKSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLmRpdmlkZSh2LCBudW1iZXJPZlJ1bnMpKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHYsIG51bWJlck9mUnVucykpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50ID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodikpO1xuXG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4uLy4uL24td2F5L3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0pvYkNvbXB1dGF0aW9uRXhjZXB0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2V4Y2VwdGlvbnMvam9iLWNvbXB1dGF0aW9uLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYkNhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBDYWxjdWxhdGVTdGVwIHtcblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhLnJvd3Mpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcyA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgfVxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICBmb3IodmFyIHJ1bkluZGV4PTA7IHJ1bkluZGV4PGNodW5rU2l6ZTsgcnVuSW5kZXgrKyl7XG4gICAgICAgICAgICB2YXIgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgICAgIHZhciBlcnJvcnMgPSBbXTtcbiAgICAgICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZXZhbHVhdGVkID0gdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLmV2YWwodi5mb3JtdWxhLCB0cnVlLCBVdGlscy5jbG9uZURlZXAoZGF0YS5leHByZXNzaW9uU2NvcGUpKTtcbiAgICAgICAgICAgICAgICAgICAgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZXZhbHVhdGVkKSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoKGUpe1xuICAgICAgICAgICAgICAgICAgICBlcnJvcnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZTogdixcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZihlcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGVycm9yRGF0YSA9IHt2YXJpYWJsZXM6IFtdfTtcbiAgICAgICAgICAgICAgICBlcnJvcnMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgICAgIGVycm9yRGF0YS52YXJpYWJsZXNbZS52YXJpYWJsZS5uYW1lXSA9IGUuZXJyb3IubWVzc2FnZTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJwYXJhbS1jb21wdXRhdGlvblwiLCBlcnJvckRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHNpbmdsZVJ1blZhcmlhYmxlVmFsdWVzKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgciA9IHN1cGVyLnByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICB0aGlzLnVwZGF0ZVBvbGljeVN0YXRzKHIsIHBvbGljaWVzLCBudW1iZXJPZlJ1bnMsIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgcmV0dXJuIHI7XG4gICAgfVxuXG4gICAgdXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KXtcbiAgICAgICAgdmFyIGhpZ2hlc3RQYXlvZmYgPSAtSW5maW5pdHk7XG4gICAgICAgIHZhciBsb3dlc3RQYXlvZmYgPSBJbmZpbml0eTtcbiAgICAgICAgdmFyIGJlc3RQb2xpY3lJbmRleGVzID0gW107XG4gICAgICAgIHZhciB3b3JzdFBvbGljeUluZGV4ZXMgPSBbXTtcblxuICAgICAgICB2YXIgemVyb051bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaCgocG9saWN5LGkpPT57XG4gICAgICAgICAgICBsZXQgcGF5b2ZmID0gci5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgaWYoVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgcGF5b2ZmID0gemVyb051bTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA8IGxvd2VzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgbG93ZXN0UGF5b2ZmID0gcGF5b2ZmO1xuICAgICAgICAgICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcyA9IFtpXTtcbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMobG93ZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA+IGhpZ2hlc3RQYXlvZmYpe1xuICAgICAgICAgICAgICAgIGhpZ2hlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMgPSBbaV1cbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMoaGlnaGVzdFBheW9mZikpe1xuICAgICAgICAgICAgICAgIGJlc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXNbaV0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocGF5b2ZmLCBudW1iZXJPZlJ1bnMpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBiZXN0UG9saWN5SW5kZXhlcy5sZW5ndGgpKVxuICAgICAgICB9KTtcblxuICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgd29yc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzID0gam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMubWFwKHY9PnRoaXMudG9GbG9hdCh2KSk7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCAxKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG4gICAgICAgIHZhciBkZWZhdWx0VmFsdWVzID0ge307XG4gICAgICAgIFV0aWxzLmZvck93bihkYXRhLmV4cHJlc3Npb25TY29wZSwgKHYsayk9PntcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXNba109dGhpcy50b0Zsb2F0KHYpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeSddO1xuICAgICAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKG49PmhlYWRlcnMucHVzaChuKSk7XG4gICAgICAgICAgICBoZWFkZXJzLnB1c2goJ3BheW9mZicpO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICAgICAgaGVhZGVyczpoZWFkZXJzLFxuICAgICAgICAgICAgICAgIHJvd3M6IFtdLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlTmFtZXM6IHZhcmlhYmxlTmFtZXMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlczogZGVmYXVsdFZhbHVlcyxcbiAgICAgICAgICAgICAgICBwb2xpY2llczogam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJwb2xpY2llc1wiKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSkge1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGl0ZW1JbmRleCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWUgPSB2YXJpYWJsZU5hbWVzW2l0ZW1JbmRleF07XG5cblxuXG4gICAgICAgIHZhciByZXN1bHRzID0gW11cblxuICAgICAgICBpdGVtLmZvckVhY2godmFyaWFibGVWYWx1ZT0+e1xuXG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcblxuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IHZhcmlhYmxlVmFsdWU7XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuICAgICAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgICAgICBpZighdmFsaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UpO1xuICAgICAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290LCBydWxlTmFtZSk7XG4gICAgICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuICAgICAgICAgICAgdmFyIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcblxuXG4gICAgICAgICAgICB2YXIgciA9IHtcbiAgICAgICAgICAgICAgICBwb2xpY2llczogcG9saWNpZXMsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lOiB2YXJpYWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVJbmRleDogaXRlbUluZGV4LFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlVmFsdWU6IHZhcmlhYmxlVmFsdWUsXG4gICAgICAgICAgICAgICAgcGF5b2ZmOiBwYXlvZmZcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXN1bHRzLnB1c2gocilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG5cbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuXG4gICAgICAgIHZhciBwb2xpY3lCeUtleSA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljeUJ5S2V5XCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW1zV3JhcHBlcj0+e1xuICAgICAgICAgICAgaWYoIWl0ZW1zV3JhcHBlcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpdGVtc1dyYXBwZXIuZm9yRWFjaChpdGVtPT57XG4gICAgICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3kpPT57XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW1BvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3kpXTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2KT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbHVlID0gXCJkZWZhdWx0XCI7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZih2ID09IGl0ZW0udmFyaWFibGVOYW1lKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHRoaXMudG9GbG9hdChpdGVtLnZhcmlhYmxlVmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWVsc2UgaWYoam9iUmVzdWx0LmRhdGEuZGVmYXVsdFZhbHVlcy5oYXNPd25Qcm9wZXJ0eSh2KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBqb2JSZXN1bHQuZGF0YS5kZWZhdWx0VmFsdWVzW3ZdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaCh2YWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBpdGVtLnBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaChVdGlscy5pc1N0cmluZyhwYXlvZmYpPyBwYXlvZmY6IHRoaXMudG9GbG9hdChwYXlvZmYpKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvdyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNlbGxzOiByb3dDZWxscyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBwb2xpY2llcy5pbmRleE9mKHBvbGljeUJ5S2V5W3BvbGljeS5rZXldKSxcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKHJvdyk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCByZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWN5QnlLZXlcIiwgVXRpbHMuZ2V0T2JqZWN0QnlJZE1hcChwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcywgbnVsbCwgJ2tleScpKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHRoaXMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJ2YXJpYWJsZVZhbHVlc1wiLCB2YXJpYWJsZVZhbHVlcyk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIHNlcXVlbmNlKG1pbiwgbWF4LCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGV4dGVudCA9IG1heCAtIG1pbjtcbiAgICAgICAgdmFyIHN0ZXAgPSBleHRlbnQgLyAobGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgKz0gc3RlcDtcblxuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUucm91bmQoY3VyciwgMTYpKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPD0gdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi90b3JuYWRvLWRpYWdyYW0tam9iLXBhcmFtZXRlcnNcIjtcblxuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJ0b3JuYWRvLWRpYWdyYW1cIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENhbGN1bGF0ZVN0ZXAoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuXG4vKmpvYiBzdGVwIHRoYXQgcHJvY2VzcyBiYXRjaCBvZiBpdGVtcyovXG5leHBvcnQgY2xhc3MgQmF0Y2hTdGVwIGV4dGVuZHMgU3RlcCB7XG5cbiAgICBjaHVua1NpemU7XG4gICAgc3RhdGljIENVUlJFTlRfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfY3VycmVudF9pdGVtX2NvdW50JztcbiAgICBzdGF0aWMgVE9UQUxfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfdG90YWxfaXRlbV9jb3VudCc7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBjaHVua1NpemUpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuY2h1bmtTaXplID0gY2h1bmtTaXplO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHN0ZXAgaW5pdGlhbGl6YXRpb24uIFNob3VsZCByZXR1cm4gdG90YWwgaXRlbSBjb3VudFxuICAgICAqL1xuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLmluaXQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcmVhZCBhbmQgcmV0dXJuIGNodW5rIG9mIGl0ZW1zIHRvIHByb2Nlc3NcbiAgICAgKi9cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnJlYWROZXh0Q2h1bmsgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvY2VzcyBzaW5nbGUgaXRlbVxuICAgICAqIE11c3QgcmV0dXJuIHByb2Nlc3NlZCBpdGVtIHdoaWNoIHdpbGwgYmUgcGFzc2VkIGluIGEgY2h1bmsgdG8gd3JpdGVDaHVuayBmdW5jdGlvblxuICAgICAqL1xuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5wcm9jZXNzSXRlbSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byB3cml0ZSBjaHVuayBvZiBpdGVtcy4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gcG9zdHByb2Nlc3NpbmcgYWZ0ZXIgYWxsIGl0ZW1zIGhhdmUgYmVlbiBwcm9jZXNzZWQuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuXG4gICAgc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QKTtcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCkgfHwgMDtcbiAgICB9XG5cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBpbml0aWFsaXplIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pLnRoZW4odG90YWxJdGVtQ291bnQ9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdG90YWxJdGVtQ291bnQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGlmKCEoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSl7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcG9zdFByb2Nlc3MgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIGhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGN1cnJlbnRJdGVtQ291bnQgPSB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciB0b3RhbEl0ZW1Db3VudCA9IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBjaHVua1NpemUgPSBNYXRoLm1pbih0aGlzLmNodW5rU2l6ZSwgdG90YWxJdGVtQ291bnQgLSBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgaWYgKGN1cnJlbnRJdGVtQ291bnQgPj0gdG90YWxJdGVtQ291bnQpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50LCBjaHVua1NpemUsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHJlYWQgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pLnRoZW4oY2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcHJvY2VzcyBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKHByb2Nlc3NlZENodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIHByb2Nlc3NlZENodW5rLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byB3cml0ZSBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKChyZXMpPT4ge1xuICAgICAgICAgICAgY3VycmVudEl0ZW1Db3VudCArPSBjaHVua1NpemU7XG4gICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHsgLy9UT0RPIHByb21pc2lmeVxuICAgICAgICByZXR1cm4gY2h1bmsubWFwKChpdGVtLCBpKT0+dGhpcy5wcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50K2ksIGpvYlJlc3VsdCkpO1xuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCwgcHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmNoZWNrRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjbGFzcyBFeHRlbmRhYmxlRXJyb3Ige1xuICAgIGRhdGE7XG4gICAgY29uc3RydWN0b3IobWVzc2FnZSwgZGF0YSkge1xuICAgICAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9leHRlbmRhYmxlLWVycm9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcmVzdGFydC1leGNlcHRpb24nXG5cblxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkludGVycnVwdGVkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JSZXN0YXJ0RXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgRXhlY3V0aW9uQ29udGV4dCB7XG5cbiAgICBkaXJ0eSA9IGZhbHNlO1xuICAgIGNvbnRleHQgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGNvbnRleHQpIHtcbiAgICAgICAgaWYgKGNvbnRleHQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udGV4dCA9IFV0aWxzLmNsb25lKGNvbnRleHQpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdXQoa2V5LCB2YWx1ZSkge1xuICAgICAgICB2YXIgcHJldlZhbHVlID0gdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gdGhpcy5jb250ZXh0W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMuZGlydHkgPSBwcmV2VmFsdWUgPT0gbnVsbCB8fCBwcmV2VmFsdWUgIT0gbnVsbCAmJiBwcmV2VmFsdWUgIT0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlICE9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXQoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBjb250YWluc0tleShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5oYXNPd25Qcm9wZXJ0eShrZXkpO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgIH1cblxuICAgIHNldERhdGEoZGF0YSkgeyAvL3NldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLnB1dChcImRhdGFcIiwgZGF0YSk7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHsgLy8gZ2V0IGRhdGEgbW9kZWxcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0KFwiZGF0YVwiKTtcbiAgICB9XG5cbiAgICBnZXREVE8oKSB7XG4gICAgICAgIHZhciBkdG8gPSBVdGlscy5jbG9uZURlZXAodGhpcyk7XG4gICAgICAgIHZhciBkYXRhID0gdGhpcy5nZXREYXRhKCk7XG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBkYXRhID0gZGF0YS5nZXREVE8oKTtcbiAgICAgICAgICAgIGR0by5jb250ZXh0W1wiZGF0YVwiXSA9IGRhdGE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbn1cbiIsImltcG9ydCAqIGFzIGV4Y2VwdGlvbnMgZnJvbSAnLi9leGNlcHRpb25zJ1xuXG5leHBvcnQge2V4Y2VwdGlvbnN9XG5leHBvcnQgKiBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0J1xuZXhwb3J0ICogZnJvbSAnLi9qb2InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tZmxhZydcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1saXN0ZW5lcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Ita2V5LWdlbmVyYXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWxhdW5jaGVyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itc3RhdHVzJ1xuZXhwb3J0ICogZnJvbSAnLi9zaW1wbGUtam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwLWV4ZWN1dGlvbidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24tbGlzdGVuZXInXG5cblxuXG5cbiIsImV4cG9ydCBjb25zdCBKT0JfRVhFQ1VUSU9OX0ZMQUcgPSB7XG4gICAgU1RPUDogJ1NUT1AnXG59O1xuIiwiZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBqb2IgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cblxuICAgIC8qQ2FsbGVkIGFmdGVyIGNvbXBsZXRpb24gb2YgYSBqb2IuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5cbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGV4ZWN1dGlvbiBvZiBhIGpvYi4qL1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgam9iUGFyYW1ldGVycztcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIHN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuVU5LTk9XTjtcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcblxuICAgIHN0YXJ0VGltZSA9IG51bGw7XG4gICAgY3JlYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgZW5kVGltZSA9IG51bGw7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgdGhpcy5qb2JQYXJhbWV0ZXJzID0gam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBhIHN0ZXAgZXhlY3V0aW9uIHdpdGggdGhlIGN1cnJlbnQgam9iIGV4ZWN1dGlvbi5cbiAgICAgKiBAcGFyYW0gc3RlcE5hbWUgdGhlIG5hbWUgb2YgdGhlIHN0ZXAgdGhlIG5ldyBleGVjdXRpb24gaXMgYXNzb2NpYXRlZCB3aXRoXG4gICAgICovXG4gICAgY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSkge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKHN0ZXBOYW1lLCB0aGlzKTtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBpc1J1bm5pbmcoKSB7XG4gICAgICAgIHJldHVybiAhdGhpcy5lbmRUaW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlc3QgaWYgdGhpcyBKb2JFeGVjdXRpb24gaGFzIGJlZW4gc2lnbmFsbGVkIHRvXG4gICAgICogc3RvcC5cbiAgICAgKi9cbiAgICBpc1N0b3BwaW5nKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0dXMgPT09IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2lnbmFsIHRoZSBKb2JFeGVjdXRpb24gdG8gc3RvcC5cbiAgICAgKi9cbiAgICBzdG9wKCkge1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLmZvckVhY2goc2U9PiB7XG4gICAgICAgICAgICBzZS50ZXJtaW5hdGVPbmx5ID0gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICB9XG5cbiAgICBnZXREYXRhKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRpb25Db250ZXh0LmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzID0gW10sIGRlZXBDbG9uZSA9IHRydWUpIHtcbiAgICAgICAgdmFyIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVEZWVwV2l0aDtcbiAgICAgICAgaWYgKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSkgPiAtMSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoW1wiam9iUGFyYW1ldGVyc1wiLCBcImV4ZWN1dGlvbkNvbnRleHRcIl0uaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oW1wiam9iRXhlY3V0aW9uXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsIi8qIG9iamVjdCByZXByZXNlbnRpbmcgYSB1bmlxdWVseSBpZGVudGlmaWFibGUgam9iIHJ1bi4gSm9iSW5zdGFuY2UgY2FuIGJlIHJlc3RhcnRlZCBtdWx0aXBsZSB0aW1lcyBpbiBjYXNlIG9mIGV4ZWN1dGlvbiBmYWlsdXJlIGFuZCBpdCdzIGxpZmVjeWNsZSBlbmRzIHdpdGggZmlyc3Qgc3VjY2Vzc2Z1bCBleGVjdXRpb24qL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNle1xuXG4gICAgaWQ7XG4gICAgam9iTmFtZTtcbiAgICBjb25zdHJ1Y3RvcihpZCwgam9iTmFtZSl7XG4gICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgdGhpcy5qb2JOYW1lID0gam9iTmFtZTtcbiAgICB9XG5cbn1cbiIsIlxuZXhwb3J0IGNsYXNzIEpvYktleUdlbmVyYXRvciB7XG4gICAgLypNZXRob2QgdG8gZ2VuZXJhdGUgdGhlIHVuaXF1ZSBrZXkgdXNlZCB0byBpZGVudGlmeSBhIGpvYiBpbnN0YW5jZS4qL1xuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIlwiO1xuICAgICAgICBqb2JQYXJhbWV0ZXJzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuICAgICAgICAgICAgaWYoZC5pZGVudGlmeWluZyl7XG4gICAgICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiICsgam9iUGFyYW1ldGVycy52YWx1ZXNbZC5uYW1lXSArIFwiO1wiO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JMYXVuY2hlciB7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYldvcmtlcjtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGpvYldvcmtlciwgZGF0YU1vZGVsU2VyaWFsaXplcikge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IGpvYldvcmtlcjtcbiAgICAgICAgdGhpcy5kYXRhTW9kZWxTZXJpYWxpemVyID0gZGF0YU1vZGVsU2VyaWFsaXplcjtcbiAgICB9XG5cblxuICAgIHJ1bihqb2JPck5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICB2YXIgam9iO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycztcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIGlmIChVdGlscy5pc1N0cmluZyhqb2JPck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JPck5hbWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGpvYiA9IGpvYk9yTmFtZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJObyBzdWNoIGpvYjogXCIgKyBqb2JPck5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVyc1ZhbHVlcyk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSk7XG4gICAgICAgIH0pLnRoZW4odmFsaWQ9PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuY3JlYXRlSm9iRXhlY3V0aW9uKGpvYi5uYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuXG5cbiAgICAgICAgICAgICAgICBpZih0aGlzLmpvYldvcmtlcil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYjogW1wiICsgam9iLm5hbWUgKyBcIl0gZXhlY3V0aW9uIFtcIitqb2JFeGVjdXRpb24uaWQrXCJdIGRlbGVnYXRlZCB0byB3b3JrZXJcIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9iV29ya2VyLmV4ZWN1dGVKb2Ioam9iRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgZXhlY3V0aW9uUHJvbWlzZSA9IHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGlmKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblByb21pc2U7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycykudGhlbihsYXN0RXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFqb2IuaXNSZXN0YXJ0YWJsZSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBub3QgcmVzdGFydGFibGVcIik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbGFzdEV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKGV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIlN0ZXAgW1wiICsgZXhlY3V0aW9uLnN0ZXBOYW1lICsgXCJdIGlzIG9mIHN0YXR1cyBVTktOT1dOXCIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoam9iLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgJiYgIWpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGpvYi5qb2JEYXRhVmFsaWRhdG9yICYmICFqb2Iuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShkYXRhKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIC8qKkV4ZWN1dGUgcHJldmlvdXNseSBjcmVhdGVkIGpvYiBleGVjdXRpb24qL1xuICAgIGV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCl7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIGlmKFV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgfSkudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKCFqb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbk9ySWQgKyBcIl0gaXMgbm90IGZvdW5kXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5TVEFSVElORykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbi5pZCArIFwiXSBhbHJlYWR5IHN0YXJ0ZWRcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBqb2JOYW1lID0gam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWU7XG4gICAgICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgICAgIGlmKCFqb2Ipe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iTmFtZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiAgdGhpcy5fZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pe1xuICAgICAgICB2YXIgam9iTmFtZSA9IGpvYi5uYW1lO1xuICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBsYXVuY2hlZCB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgam9iRXhlY3V0aW9uLmdldERhdGEoKSk7XG4gICAgICAgIHJldHVybiBqb2IuZXhlY3V0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBjb21wbGV0ZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdIGFuZCB0aGUgZm9sbG93aW5nIHN0YXR1czogW1wiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiXVwiKTtcbiAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgIH0pLmNhdGNoKGUgPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gZmFpbGVkIHVuZXhwZWN0ZWRseSBhbmQgZmF0YWxseSB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgZSk7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuZXhwb3J0IGNvbnN0IFBBUkFNRVRFUl9UWVBFID0ge1xuICAgIFNUUklORzogJ1NUUklORycsXG4gICAgREFURTogJ0RBVEUnLFxuICAgIElOVEVHRVI6ICdJTlRFR0VSJyxcbiAgICBOVU1CRVI6ICdGTE9BVCcsXG4gICAgQk9PTEVBTjogJ0JPT0xFQU4nLFxuICAgIE5VTUJFUl9FWFBSRVNTSU9OOiAnTlVNQkVSX0VYUFJFU1NJT04nLFxuICAgIENPTVBPU0lURTogJ0NPTVBPU0lURScgLy9jb21wb3NpdGUgcGFyYW1ldGVyIHdpdGggbmVzdGVkIHN1YnBhcmFtZXRlcnNcbn07XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uIHtcbiAgICBuYW1lO1xuICAgIHR5cGU7XG4gICAgbmVzdGVkUGFyYW1ldGVycyA9IFtdO1xuICAgIG1pbk9jY3VycztcbiAgICBtYXhPY2N1cnM7XG4gICAgcmVxdWlyZWQgPSB0cnVlO1xuXG4gICAgaWRlbnRpZnlpbmc7XG4gICAgdmFsaWRhdG9yO1xuICAgIHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zLCBtaW5PY2N1cnMgPSAxLCBtYXhPY2N1cnMgPSAxLCBpZGVudGlmeWluZyA9IGZhbHNlLCBzaW5nbGVWYWx1ZVZhbGlkYXRvciA9IG51bGwsIHZhbGlkYXRvciA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgaWYgKFV0aWxzLmlzQXJyYXkodHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zKSkge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFO1xuICAgICAgICAgICAgdGhpcy5uZXN0ZWRQYXJhbWV0ZXJzID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudmFsaWRhdG9yID0gdmFsaWRhdG9yO1xuICAgICAgICB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yID0gc2luZ2xlVmFsdWVWYWxpZGF0b3I7XG4gICAgICAgIHRoaXMuaWRlbnRpZnlpbmcgPSBpZGVudGlmeWluZztcbiAgICAgICAgdGhpcy5taW5PY2N1cnMgPSBtaW5PY2N1cnM7XG4gICAgICAgIHRoaXMubWF4T2NjdXJzID0gbWF4T2NjdXJzO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICB0aGlzW2tleV0gPSB2YWw7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlLCBhbGxWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGlzQXJyYXkgPSBVdGlscy5pc0FycmF5KHZhbHVlKTtcblxuICAgICAgICBpZiAodGhpcy5tYXhPY2N1cnMgPiAxICYmICFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcylcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPCB0aGlzLm1pbk9jY3VycyB8fCB2YWx1ZS5sZW5ndGggPiB0aGlzLm1heE9jY3Vycykge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWx1ZS5ldmVyeSh2PT50aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodiwgdmFsdWUpKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMudmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IodmFsdWUsIGFsbFZhbHVlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gYWxsVmFsdWVzIC0gYWxsIHZhbHVlcyBvbiB0aGUgc2FtZSBsZXZlbFxuICAgIHZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcykge1xuICAgICAgICBpZiAoKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpICYmIHRoaXMubWluT2NjdXJzID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCAmJiAoIXZhbHVlICYmIHZhbHVlICE9PSAwICYmIHZhbHVlICE9PSBmYWxzZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5TVFJJTkcgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkRBVEUgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5JTlRFR0VSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzSW50KHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNOdW1iZXIodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIGlmICghVXRpbHMuaXNPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLm5lc3RlZFBhcmFtZXRlcnMuZXZlcnkoKG5lc3RlZERlZiwgaSk9Pm5lc3RlZERlZi52YWxpZGF0ZSh2YWx1ZVtuZXN0ZWREZWYubmFtZV0pKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvcih2YWx1ZSwgYWxsVmFsdWVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cbiIsImltcG9ydCB7UEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJze1xuICAgIGRlZmluaXRpb25zID0gW107XG4gICAgdmFsdWVzPXt9O1xuXG4gICAgY29uc3RydWN0b3IodmFsdWVzKXtcbiAgICAgICAgdGhpcy5pbml0RGVmaW5pdGlvbnMoKTtcbiAgICAgICAgdGhpcy5pbml0RGVmYXVsdFZhbHVlcygpO1xuICAgICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMudmFsdWVzLCB2YWx1ZXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdERlZmluaXRpb25zKCl7XG5cbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpe1xuXG4gICAgfVxuXG4gICAgdmFsaWRhdGUoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVmaW5pdGlvbnMuZXZlcnkoKGRlZiwgaSk9PmRlZi52YWxpZGF0ZSh0aGlzLnZhbHVlc1tkZWYubmFtZV0sIHRoaXMudmFsdWVzKSk7XG4gICAgfVxuXG4gICAgLypnZXQgb3Igc2V0IHZhbHVlIGJ5IHBhdGgqL1xuICAgIHZhbHVlKHBhdGgsIHZhbHVlKXtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiAgVXRpbHMuZ2V0KHRoaXMudmFsdWVzLCBwYXRoLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBVdGlscy5zZXQodGhpcy52YWx1ZXMsIHBhdGgsIHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHRvU3RyaW5nKCl7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIkpvYlBhcmFtZXRlcnNbXCI7XG5cbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcblxuICAgICAgICAgICAgdmFyIHZhbCA9IHRoaXMudmFsdWVzW2QubmFtZV07XG4gICAgICAgICAgICAvLyBpZihVdGlscy5pc0FycmF5KHZhbCkpe1xuICAgICAgICAgICAgLy8gICAgIHZhciB2YWx1ZXMgPSB2YWw7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIC8vIGlmKFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURSA9PSBkLnR5cGUpe1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiK3ZhbCArIFwiO1wiO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVzdWx0Kz1cIl1cIjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBnZXREVE8oKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlczogdGhpcy52YWx1ZXNcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7ZGVmYXVsdCBhcyBpZGJ9IGZyb20gXCJpZGJcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyogSW5kZXhlZERCIGpvYiByZXBvc2l0b3J5Ki9cbmV4cG9ydCBjbGFzcyBJZGJKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBkYlByb21pc2U7XG4gICAgam9iSW5zdGFuY2VEYW87XG4gICAgam9iRXhlY3V0aW9uRGFvO1xuICAgIHN0ZXBFeGVjdXRpb25EYW87XG4gICAgam9iUmVzdWx0RGFvO1xuICAgIGpvYkV4ZWN1dGlvblByb2dyZXNzRGFvO1xuICAgIGpvYkV4ZWN1dGlvbkZsYWdEYW87XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc1Jldml2ZXIsIGRiTmFtZSA9ICdzZC1qb2ItcmVwb3NpdG9yeScsIGRlbGV0ZURCID0gZmFsc2UpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5kYk5hbWUgPSBkYk5hbWU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNSZXZpdmVyID0gZXhwcmVzc2lvbnNSZXZpdmVyO1xuICAgICAgICBpZiAoZGVsZXRlREIpIHtcbiAgICAgICAgICAgIHRoaXMuZGVsZXRlREIoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgICAgIHRoaXMuaW5pdERCKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5pbml0REIoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdERCKCkge1xuICAgICAgICB0aGlzLmRiUHJvbWlzZSA9IGlkYi5vcGVuKHRoaXMuZGJOYW1lLCAyLCB1cGdyYWRlREIgPT4ge1xuICAgICAgICAgICAgLy8gTm90ZTogd2UgZG9uJ3QgdXNlICdicmVhaycgaW4gdGhpcyBzd2l0Y2ggc3RhdGVtZW50LFxuICAgICAgICAgICAgLy8gdGhlIGZhbGwtdGhyb3VnaCBiZWhhdmlvdXIgaXMgd2hhdCB3ZSB3YW50LlxuICAgICAgICAgICAgc3dpdGNoICh1cGdyYWRlREIub2xkVmVyc2lvbikge1xuICAgICAgICAgICAgICAgIGNhc2UgMDpcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItaW5zdGFuY2VzJyk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBqb2JFeGVjdXRpb25zT1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb25zJyk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJjcmVhdGVUaW1lXCIsIFwiY3JlYXRlVGltZVwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJzdGF0dXNcIiwgXCJzdGF0dXNcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJyk7XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbi1mbGFncycpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnNPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnc3RlcC1leGVjdXRpb25zJyk7XG4gICAgICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBcImpvYkV4ZWN1dGlvbklkXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGpvYlJlc3VsdE9TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItcmVzdWx0cycpO1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHRPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7dW5pcXVlOiB0cnVlfSk7XG4gICAgICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIudHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2pvYi1pbnN0YW5jZXMnKS5jcmVhdGVJbmRleChcImlkXCIsIFwiaWRcIiwge3VuaXF1ZTogdHJ1ZX0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1pbnN0YW5jZXMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9ucycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0RhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbi1wcm9ncmVzcycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9uLWZsYWdzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ3N0ZXAtZXhlY3V0aW9ucycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHREYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1yZXN1bHRzJywgdGhpcy5kYlByb21pc2UpO1xuICAgIH1cblxuICAgIGRlbGV0ZURCKCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihfPT5pZGIuZGVsZXRlKHRoaXMuZGJOYW1lKSk7XG4gICAgfVxuXG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLnJlbW92ZShrZXkpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZhbHNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PnsgIC8vICBOb3Qgd2FpdGluZyBmb3IgcHJvbWlzZSByZXNvbHZlc1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKS50aGVuKGpvYlJlc3VsdD0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLnJlbW92ZShqb2JFeGVjdXRpb24uaWQpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb24uaWQsIGZhbHNlKS50aGVuKHN0ZXBFeGVjdXRpb25zPT57ICAvLyBOb3Qgd2FpdGluZyBmb3IgcHJvbWlzZSByZXNvbHZlc1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2godGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnJlbW92ZShzdGVwRXhlY3V0aW9uLmlkKVxuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8ucmVtb3ZlKGpvYlJlc3VsdC5pZCk7XG4gICAgfVxuXG5cblxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXQoam9iUmVzdWx0SWQpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLmdldEJ5SW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIGpvYkluc3RhbmNlLmlkKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uc2V0KGpvYlJlc3VsdC5pZCwgam9iUmVzdWx0KS50aGVuKHI9PmpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8uZ2V0KGtleSkudGhlbihkdG89PmR0byA/IHRoaXMucmV2aXZlSm9iSW5zdGFuY2UoZHRvKSA6IGR0byk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLnNldChrZXksIGpvYkluc3RhbmNlKS50aGVuKHI9PmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IGpvYkV4ZWN1dGlvbi5nZXREVE8oKTtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zRFRPcyA9IGR0by5zdGVwRXhlY3V0aW9ucztcbiAgICAgICAgZHRvLnN0ZXBFeGVjdXRpb25zID0gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLnNldChqb2JFeGVjdXRpb24uaWQsIGR0bykudGhlbihyPT50aGlzLnNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnNEVE9zKSkudGhlbihyPT5qb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcykge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZykge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvLnNldChqb2JFeGVjdXRpb25JZCwgZmxhZylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IHN0ZXBFeGVjdXRpb24uZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSk7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uc2V0KHN0ZXBFeGVjdXRpb24uaWQsIGR0bykudGhlbihyPT5zdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnMgPSBbXSkge1xuICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IHNhdmVkRXhlY3V0aW9ucy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc2F2ZWRFeGVjdXRpb25zKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbkRUTyA9IHN0ZXBFeGVjdXRpb25zW3NhdmVkRXhlY3V0aW9ucy5sZW5ndGhdO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uRFRPLmlkLCBzdGVwRXhlY3V0aW9uRFRPKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc2F2ZWRFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbkRUTyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5nZXQoaWQpLnRoZW4oZHRvPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZHRvKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRFRPLCByZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIGlmICgham9iRXhlY3V0aW9uRFRPKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbkRUTy5pZCwgZmFsc2UpLnRoZW4oc3RlcHM9PiB7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25EVE8uc3RlcEV4ZWN1dGlvbnMgPSBzdGVwcztcbiAgICAgICAgICAgIGlmICghcmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbkRUTztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJldml2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb25EVE8pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0LCByZXZpdmUgPSB0cnVlLCBmZXRjaGVkID0gW10pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbkR0b0xpc3QubGVuZ3RoIDw9IGZldGNoZWQubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZldGNoZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3RbZmV0Y2hlZC5sZW5ndGhdLCByZXZpdmUpLnRoZW4oKGpvYkV4ZWN1dGlvbik9PiB7XG4gICAgICAgICAgICBmZXRjaGVkLnB1c2goam9iRXhlY3V0aW9uKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZSwgZmV0Y2hlZCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25JZCwgcmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBqb2JFeGVjdXRpb25JZCkudGhlbihkdG9zPT4ge1xuICAgICAgICAgICAgaWYgKCFyZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZHRvcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkdG9zLm1hcChkdG89PnRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8pKTtcbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5nZXRBbGxCeUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBqb2JJbnN0YW5jZS5pZCkudGhlbih2YWx1ZXM9PiB7XG4gICAgICAgICAgICB2YXIgc29ydGVkID0gdmFsdWVzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIWZldGNoUmVsYXRpb25zQW5kUmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKHNvcnRlZCwgdHJ1ZSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZhbHNlKS50aGVuKGV4ZWN1dGlvbnM9PnRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtIDFdKSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PiB7XG4gICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+IHtcbiAgICAgICAgICAgICAgICBpZiAobGF0ZXN0ID09IG51bGwgfHwgbGF0ZXN0LnN0YXJ0VGltZS5nZXRUaW1lKCkgPCBzLnN0YXJ0VGltZS5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGF0ZXN0ID0gcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBsYXRlc3Q7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV2aXZlSm9iSW5zdGFuY2UoZHRvKSB7XG4gICAgICAgIHJldHVybiBuZXcgSm9iSW5zdGFuY2UoZHRvLmlkLCBkdG8uam9iTmFtZSk7XG4gICAgfVxuXG4gICAgcmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8pIHtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICBleGVjdXRpb25Db250ZXh0LmNvbnRleHQgPSBkdG8uY29udGV4dDtcbiAgICAgICAgdmFyIGRhdGEgPSBleGVjdXRpb25Db250ZXh0LmdldERhdGEoKTtcbiAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBkYXRhTW9kZWwgPSBuZXcgRGF0YU1vZGVsKCk7XG4gICAgICAgICAgICBkYXRhTW9kZWwubG9hZEZyb21EVE8oZGF0YSwgdGhpcy5leHByZXNzaW9uc1Jldml2ZXIpO1xuICAgICAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5zZXREYXRhKGRhdGFNb2RlbCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHRcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG5cbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuZ2V0Sm9iQnlOYW1lKGR0by5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8uam9iSW5zdGFuY2UpO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGR0by5qb2JQYXJhbWV0ZXJzLnZhbHVlcyk7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoam9iRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iSW5zdGFuY2VcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYlBhcmFtZXRlcnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JFeGVjdXRpb25cIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwic3RlcEV4ZWN1dGlvbnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBzcmNWYWx1ZS5tYXAoc3RlcERUTyA9PiB0aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oc3RlcERUTywgam9iRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKGR0by5zdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoc3RlcEV4ZWN1dGlvbiwgZHRvLCAob2JqVmFsdWUsIHNyY1ZhbHVlLCBrZXksIG9iamVjdCwgc291cmNlLCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuXG5cbmNsYXNzIE9iamVjdFN0b3JlRGFvIHtcblxuICAgIG5hbWU7XG4gICAgZGJQcm9taXNlO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgZGJQcm9taXNlKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuZGJQcm9taXNlID0gZGJQcm9taXNlO1xuICAgIH1cblxuICAgIGdldChrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5nZXQoa2V5KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0QWxsQnlJbmRleChpbmRleE5hbWUsIGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmluZGV4KGluZGV4TmFtZSkuZ2V0QWxsKGtleSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0QnlJbmRleChpbmRleE5hbWUsIGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmluZGV4KGluZGV4TmFtZSkuZ2V0KGtleSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2V0KGtleSwgdmFsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLnB1dCh2YWwsIGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuZGVsZXRlKGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNsZWFyKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5jbGVhcigpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBrZXlzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBrZXlzID0gW107XG4gICAgICAgICAgICBjb25zdCBzdG9yZSA9IHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSk7XG5cbiAgICAgICAgICAgIC8vIFRoaXMgd291bGQgYmUgc3RvcmUuZ2V0QWxsS2V5cygpLCBidXQgaXQgaXNuJ3Qgc3VwcG9ydGVkIGJ5IEVkZ2Ugb3IgU2FmYXJpLlxuICAgICAgICAgICAgLy8gb3BlbktleUN1cnNvciBpc24ndCBzdXBwb3J0ZWQgYnkgU2FmYXJpLCBzbyB3ZSBmYWxsIGJhY2tcbiAgICAgICAgICAgIChzdG9yZS5pdGVyYXRlS2V5Q3Vyc29yIHx8IHN0b3JlLml0ZXJhdGVDdXJzb3IpLmNhbGwoc3RvcmUsIGN1cnNvciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFjdXJzb3IpIHJldHVybjtcbiAgICAgICAgICAgICAgICBrZXlzLnB1c2goY3Vyc29yLmtleSk7XG4gICAgICAgICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlLnRoZW4oKCkgPT4ga2V5cyk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iS2V5R2VuZXJhdG9yfSBmcm9tIFwiLi4vam9iLWtleS1nZW5lcmF0b3JcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0pvYlJlc3VsdH0gZnJvbSBcIi4uL2pvYi1yZXN1bHRcIjtcblxuZXhwb3J0IGNsYXNzIEpvYlJlcG9zaXRvcnkge1xuXG4gICAgam9iQnlOYW1lID0ge307XG5cbiAgICByZWdpc3RlckpvYihqb2IpIHtcbiAgICAgICAgdGhpcy5qb2JCeU5hbWVbam9iLm5hbWVdID0gam9iO1xuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkJ5TmFtZVtuYW1lXTtcbiAgICB9XG5cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5IGdldEpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShrZXksIGpvYkluc3RhbmNlKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvblByb2dyZXNzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uRmxhZyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZVN0ZXBFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5maW5kSm9iRXhlY3V0aW9ucyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2V0Sm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZVN0ZXBFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypDcmVhdGUgYSBuZXcgSm9iSW5zdGFuY2Ugd2l0aCB0aGUgbmFtZSBhbmQgam9iIHBhcmFtZXRlcnMgcHJvdmlkZWQuIHJldHVybiBwcm9taXNlKi9cbiAgICBjcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IG5ldyBKb2JJbnN0YW5jZShVdGlscy5ndWlkKCksIGpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ2hlY2sgaWYgYW4gaW5zdGFuY2Ugb2YgdGhpcyBqb2IgYWxyZWFkeSBleGlzdHMgd2l0aCB0aGUgcGFyYW1ldGVycyBwcm92aWRlZC4qL1xuICAgIGlzSm9iSW5zdGFuY2VFeGlzdHMoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKHJlc3VsdCA9PiAhIXJlc3VsdCkuY2F0Y2goZXJyb3I9PmZhbHNlKTtcbiAgICB9XG5cbiAgICBnZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIGpvYk5hbWUgKyBcInxcIiArIEpvYktleUdlbmVyYXRvci5nZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIEpvYkV4ZWN1dGlvbiBmb3IgYSBnaXZlbiAgSm9iIGFuZCBKb2JQYXJhbWV0ZXJzLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyxcbiAgICAgKiB0aGUgam9iIG11c3QgYmUgcmVzdGFydGFibGUgYW5kIGl0J3MgbGFzdCBKb2JFeGVjdXRpb24gbXVzdCAqbm90KiBiZVxuICAgICAqIGNvbXBsZXRlZC4gSWYgbWF0Y2hpbmcgSm9iSW5zdGFuY2UgZG9lcyBub3QgZXhpc3QgeWV0IGl0IHdpbGwgYmUgIGNyZWF0ZWQuKi9cblxuICAgIGNyZWF0ZUpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oam9iSW5zdGFuY2U9PntcbiAgICAgICAgICAgIGlmIChqb2JJbnN0YW5jZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oZXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgICAgICAgICBleGVjdXRpb25zLmZvckVhY2goZXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbihcIkEgam9iIGV4ZWN1dGlvbiBmb3IgdGhpcyBqb2IgaXMgYWxyZWFkeSBydW5uaW5nOiBcIiArIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkFCQU5ET05FRCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJBIGpvYiBpbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgY29tcGxldGUgZm9yIHBhcmFtZXRlcnM9XCIgKyBqb2JQYXJhbWV0ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICsgXCIuICBJZiB5b3Ugd2FudCB0byBydW4gdGhpcyBqb2IgYWdhaW4sIGNoYW5nZSB0aGUgcGFyYW1ldGVycy5cIik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtIDFdLmV4ZWN1dGlvbkNvbnRleHQ7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtqb2JJbnN0YW5jZSwgZXhlY3V0aW9uQ29udGV4dF07XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbm8gam9iIGZvdW5kLCBjcmVhdGUgb25lXG4gICAgICAgICAgICBqb2JJbnN0YW5jZSA9IHRoaXMuY3JlYXRlSm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICB2YXIgZGF0YU1vZGVsID0gbmV3IERhdGFNb2RlbCgpO1xuICAgICAgICAgICAgZGF0YU1vZGVsLl9zZXROZXdTdGF0ZShkYXRhLmNyZWF0ZVN0YXRlU25hcHNob3QoKSk7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YU1vZGVsKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbam9iSW5zdGFuY2UsIGV4ZWN1dGlvbkNvbnRleHRdKTtcbiAgICAgICAgfSkudGhlbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHQ9PntcbiAgICAgICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFswXSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFsxXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oKGpvYkluc3RhbmNlKT0+e1xuICAgICAgICAgICAgaWYoIWpvYkluc3RhbmNlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGV4ZWN1dGlvbnM9PmV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLTFdKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zPVtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT57XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGFkZFN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlKG8pe1xuICAgICAgICBvLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IFwiT2JqZWN0IG5vdCB1cGRhdGFibGU6IFwiK29cbiAgICB9XG5cbiAgICByZW1vdmUobyl7XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYlJlc3VsdCl7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JSZXN1bHQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcIk9iamVjdCBub3QgcmVtb3ZhYmxlOiBcIitvKTtcbiAgICB9XG5cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlSm9iRXhlY3V0aW9uKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZVN0ZXBFeGVjdXRpb24oZHRvLCBqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIFNpbXBsZUpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBKb2JSZXBvc2l0b3J5e1xuICAgIGpvYkluc3RhbmNlc0J5S2V5ID0ge307XG4gICAgam9iRXhlY3V0aW9ucyA9IFtdO1xuICAgIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgZXhlY3V0aW9uUHJvZ3Jlc3MgPSB7fTtcbiAgICBleGVjdXRpb25GbGFncyA9IHt9O1xuICAgIGpvYlJlc3VsdHMgPSBbXTtcblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgVXRpbHMuZm9yT3duKHRoaXMuam9iSW5zdGFuY2VzQnlLZXksICAoamksIGtleSk9PntcbiAgICAgICAgICAgIGlmKGppPT09am9iSW5zdGFuY2Upe1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVKb2JFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMuZmlsdGVyKGpvYlJlc3VsdD0+am9iUmVzdWx0LmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYlJlc3VsdCwgdGhpcyk7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLmpvYkV4ZWN1dGlvbnMuaW5kZXhPZihqb2JFeGVjdXRpb24pO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHN0ZXBFeGVjdXRpb249PnN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkID09PSBqb2JFeGVjdXRpb24uaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLnN0ZXBFeGVjdXRpb25zLmluZGV4T2Yoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuam9iUmVzdWx0cy5pbmRleE9mKGpvYlJlc3VsdCk7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYlJlc3VsdHMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0gPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JJbnN0YW5jZSlcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmlkPT09am9iUmVzdWx0SWQpKVxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmpvYkluc3RhbmNlLmlkPT09am9iSW5zdGFuY2UuaWQpKVxuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5wdXNoKGpvYlJlc3VsdCk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iRXhlY3V0aW9ucywgZXg9PmV4LmlkPT09aWQpKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5wdXNoKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSA9IHByb2dyZXNzO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHByb2dyZXNzKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSlcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdID0gZmxhZztcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmbGFnKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihlPT5lLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgfSkpO1xuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U2ltcGxlSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vc2ltcGxlLWpvYi1yZXBvc2l0b3J5XCI7XG5cblxuXG5leHBvcnQgY2xhc3MgVGltZW91dEpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBTaW1wbGVKb2JSZXBvc2l0b3J5e1xuXG4gICAgY3JlYXRlVGltZW91dFByb21pc2UodmFsdWVUb1Jlc29sdmUsIGRlbGF5PTEpe1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZT0+e1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgICAgICAgICAgIHJlc29sdmUodmFsdWVUb1Jlc29sdmUpO1xuICAgICAgICAgICAgfSwgZGVsYXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5pZD09PWpvYlJlc3VsdElkKSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmpvYkluc3RhbmNlLmlkPT09am9iSW5zdGFuY2UuaWQpKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMucHVzaChqb2JSZXN1bHQpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iRXhlY3V0aW9ucywgZXg9PmV4LmlkPT09aWQpKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMucHVzaChqb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdID0gcHJvZ3Jlc3M7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHByb2dyZXNzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdID0gZmxhZztcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoZmxhZyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihlPT5lLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHJlbW92ZShvYmplY3QpeyAvL1RPRE9cblxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5cbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIHJlc3VsdCBvZiBhIGpvYiBpbnN0YW5jZS4qL1xuZXhwb3J0IGNsYXNzIEpvYlJlc3VsdCB7XG4gICAgaWQ7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgZGF0YTtcblxuICAgIGNvbnN0cnVjdG9yKGpvYkluc3RhbmNlLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZTtcbiAgICB9XG59XG4iLCJleHBvcnQgY29uc3QgSk9CX1NUQVRVUyA9IHtcbiAgICBDT01QTEVURUQ6ICdDT01QTEVURUQnLFxuICAgIFNUQVJUSU5HOiAnU1RBUlRJTkcnLFxuICAgIFNUQVJURUQ6ICdTVEFSVEVEJyxcbiAgICBTVE9QUElORzogJ1NUT1BQSU5HJyxcbiAgICBTVE9QUEVEOiAnU1RPUFBFRCcsXG4gICAgRkFJTEVEOiAnRkFJTEVEJyxcbiAgICBVTktOT1dOOiAnVU5LTk9XTicsXG4gICAgQUJBTkRPTkVEOiAnQUJBTkRPTkVEJyxcbiAgICBFWEVDVVRJTkc6ICdFWEVDVVRJTkcnIC8vZm9yIGV4aXQgc3RhdHVzIG9ubHlcbn07XG4iLCJpbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuaW1wb3J0IHtKb2JSZXN1bHR9IGZyb20gXCIuL2pvYi1yZXN1bHRcIjtcbi8qQmFzZSBjbGFzcyBmb3Igam9icyovXG4vL0EgSm9iIGlzIGFuIGVudGl0eSB0aGF0IGVuY2Fwc3VsYXRlcyBhbiBlbnRpcmUgam9iIHByb2Nlc3MgKCBhbiBhYnN0cmFjdGlvbiByZXByZXNlbnRpbmcgdGhlIGNvbmZpZ3VyYXRpb24gb2YgYSBqb2IpLlxuXG5leHBvcnQgY2xhc3MgSm9iIHtcblxuICAgIGlkO1xuICAgIG5hbWU7XG4gICAgc3RlcHMgPSBbXTtcblxuICAgIGlzUmVzdGFydGFibGU9dHJ1ZTtcbiAgICBleGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcbiAgICBqb2JQYXJhbWV0ZXJzVmFsaWRhdG9yO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yID0gdGhpcy5nZXRKb2JQYXJhbWV0ZXJzVmFsaWRhdG9yKCk7XG4gICAgICAgIHRoaXMuam9iRGF0YVZhbGlkYXRvciA9IHRoaXMuZ2V0Sm9iRGF0YVZhbGlkYXRvcigpO1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIH1cblxuICAgIHNldEpvYlJlcG9zaXRvcnkoam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIGV4ZWN1dGUoZXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gc3RhcnRpbmc6IFwiLCBleGVjdXRpb24pO1xuICAgICAgICB2YXIgam9iUmVzdWx0O1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0V4ZWN1dGlvbkZsYWdzKGV4ZWN1dGlvbikudGhlbihleGVjdXRpb249PntcblxuICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuU1RPUFBJTkcpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGUgam9iIHdhcyBhbHJlYWR5IHN0b3BwZWRcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiB3YXMgc3RvcHBlZDogXCIgKyBleGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgJiYgIXRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvci52YWxpZGF0ZShleGVjdXRpb24uam9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBwYXJhbWV0ZXJzIGluIGpvYiBleGVjdXRlXCIpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHRoaXMuam9iRGF0YVZhbGlkYXRvciAmJiAhdGhpcy5qb2JEYXRhVmFsaWRhdG9yLnZhbGlkYXRlKGV4ZWN1dGlvbi5nZXREYXRhKCkpKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRGF0YUludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBkYXRhIGluIGpvYiBleGVjdXRlXCIpXG4gICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMudXBkYXRlU3RhdHVzKGV4ZWN1dGlvbiwgSk9CX1NUQVRVUy5TVEFSVEVEKSwgdGhpcy5nZXRSZXN1bHQoZXhlY3V0aW9uKSwgdGhpcy51cGRhdGVQcm9ncmVzcyhleGVjdXRpb24pXSkudGhlbihyZXM9PntcbiAgICAgICAgICAgICAgICBleGVjdXRpb249cmVzWzBdO1xuICAgICAgICAgICAgICAgIGpvYlJlc3VsdCA9IHJlc1sxXTtcbiAgICAgICAgICAgICAgICBpZigham9iUmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdCA9IG5ldyBKb2JSZXN1bHQoZXhlY3V0aW9uLmpvYkluc3RhbmNlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5iZWZvcmVKb2IoZXhlY3V0aW9uKSk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gY29tcGxldGU6IFwiLGV4ZWN1dGlvbik7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIGlmIChlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pIHtcbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkVuY291bnRlcmVkIGludGVycnVwdGlvbiBleGVjdXRpbmcgam9iXCIsIGUpO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGZhdGFsIGVycm9yIGV4ZWN1dGluZyBqb2JcIiwgZSk7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZihqb2JSZXN1bHQpe1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpLnRoZW4oKCk9PmV4ZWN1dGlvbilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgZmF0YWwgZXJyb3Igc2F2aW5nIGpvYiByZXN1bHRzXCIsIGUpO1xuICAgICAgICAgICAgaWYoZSl7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGV4ZWN1dGlvbi5lbmRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShleGVjdXRpb24pLCB0aGlzLnVwZGF0ZVByb2dyZXNzKGV4ZWN1dGlvbildKS50aGVuKHJlcz0+cmVzWzBdKVxuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5hZnRlckpvYihleGVjdXRpb24pKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gZW5jb3VudGVyZWQgaW4gYWZ0ZXJTdGVwIGNhbGxiYWNrXCIsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIHVwZGF0ZVN0YXR1cyhqb2JFeGVjdXRpb24sIHN0YXR1cykge1xuICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzPXN0YXR1cztcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoam9iRXhlY3V0aW9uKVxuICAgIH1cblxuICAgIHVwZGF0ZVByb2dyZXNzKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uLmlkLCB0aGlzLmdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbikpO1xuICAgIH1cblxuICAgIC8qIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyBhbGxvd2luZyB0aGVtIHRvIGNvbmNlbnRyYXRlIG9uIHByb2Nlc3NpbmcgbG9naWMgYW5kIGlnbm9yZSBsaXN0ZW5lcnMsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93ICdkb0V4ZWN1dGUgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICBnZXRKb2JQYXJhbWV0ZXJzVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChwYXJhbXMpID0+IHBhcmFtcy52YWxpZGF0ZSgpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRTdGVwKHN0ZXApe1xuICAgICAgICB0aGlzLnN0ZXBzLnB1c2goc3RlcCk7XG4gICAgfVxuXG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyl7XG4gICAgICAgIHRocm93ICdjcmVhdGVKb2JQYXJhbWV0ZXJzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAqIGN1cnJlbnRcbiAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgY3VycmVudDogZXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQgPyAxIDogMFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcil7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xuICAgIH1cblxuICAgIGNoZWNrRXhlY3V0aW9uRmxhZ3MoZXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25GbGFnKGV4ZWN1dGlvbi5pZCkudGhlbihmbGFnPT57XG4gICAgICAgICAgICBpZihKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCA9PT0gZmxhZyl7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0b3AoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRSZXN1bHQoZXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShleGVjdXRpb24uam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB0aHJvdyAnam9iUmVzdWx0VG9Dc3ZSb3dzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxufVxuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYn0gZnJvbSBcIi4vam9iXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5cbi8qIFNpbXBsZSBKb2IgdGhhdCBzZXF1ZW50aWFsbHkgZXhlY3V0ZXMgYSBqb2IgYnkgaXRlcmF0aW5nIHRocm91Z2ggaXRzIGxpc3Qgb2Ygc3RlcHMuICBBbnkgU3RlcCB0aGF0IGZhaWxzIHdpbGwgZmFpbCB0aGUgam9iLiAgVGhlIGpvYiBpc1xuIGNvbnNpZGVyZWQgY29tcGxldGUgd2hlbiBhbGwgc3RlcHMgaGF2ZSBiZWVuIGV4ZWN1dGVkLiovXG5cbmV4cG9ydCBjbGFzcyBTaW1wbGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKVxuICAgIH1cblxuICAgIGdldFN0ZXAoc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIFV0aWxzLmZpbmQodGhpcy5zdGVwcywgcz0+cy5uYW1lID09IHN0ZXBOYW1lKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChleGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiVXBkYXRpbmcgSm9iRXhlY3V0aW9uIHN0YXR1czogXCIsIGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cztcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaCguLi5sYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGFuZGxlTmV4dFN0ZXAoam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQsIHByZXZTdGVwPW51bGwsIHByZXZTdGVwRXhlY3V0aW9uPW51bGwpe1xuICAgICAgICB2YXIgc3RlcEluZGV4ID0gMDtcbiAgICAgICAgaWYocHJldlN0ZXApe1xuICAgICAgICAgICAgc3RlcEluZGV4ID0gdGhpcy5zdGVwcy5pbmRleE9mKHByZXZTdGVwKSsxO1xuICAgICAgICB9XG4gICAgICAgIGlmKHN0ZXBJbmRleD49dGhpcy5zdGVwcy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcmV2U3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IHRoaXMuc3RlcHNbc3RlcEluZGV4XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZihzdGVwRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5DT01QTEVURUQpeyAvLyBUZXJtaW5hdGUgdGhlIGpvYiBpZiBhIHN0ZXAgZmFpbHNcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBzdGVwLCBzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBoYW5kbGVTdGVwKHN0ZXAsIGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmlzU3RvcHBpbmcoKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwLm5hbWUpXG5cbiAgICAgICAgfSkudGhlbihsYXN0U3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKHRoaXMuc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgbGFzdFN0ZXBFeGVjdXRpb24pKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlIGxhc3QgZXhlY3V0aW9uIG9mIHRoaXMgc3RlcCB3YXMgaW4gdGhlIHNhbWUgam9iLCBpdCdzIHByb2JhYmx5IGludGVudGlvbmFsIHNvIHdlIHdhbnQgdG8gcnVuIGl0IGFnYWluLlxuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRHVwbGljYXRlIHN0ZXAgZGV0ZWN0ZWQgaW4gZXhlY3V0aW9uIG9mIGpvYi4gc3RlcDogXCIgKyBzdGVwLm5hbWUgKyBcIiBqb2JOYW1lOiBcIiwgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgbGFzdFN0ZXBFeGVjdXRpb24gPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBsYXN0U3RlcEV4ZWN1dGlvbjtcblxuICAgICAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0YXJ0KGN1cnJlbnRTdGVwRXhlY3V0aW9uLCBqb2JFeGVjdXRpb24sIHN0ZXApKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbi5jcmVhdGVTdGVwRXhlY3V0aW9uKHN0ZXAubmFtZSk7XG5cbiAgICAgICAgICAgIHZhciBpc0NvbXBsZXRlZCA9IGxhc3RTdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIHZhciBpc1Jlc3RhcnQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmICFpc0NvbXBsZXRlZDtcbiAgICAgICAgICAgIHZhciBza2lwRXhlY3V0aW9uID0gaXNDb21wbGV0ZWQgJiYgc3RlcC5za2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ7XG5cbiAgICAgICAgICAgIGlmIChpc1Jlc3RhcnQpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5jb250YWluc0tleShcImV4ZWN1dGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucmVtb3ZlKFwiZXhlY3V0ZWRcIik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHNraXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInNraXBwZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuYWRkU3RlcEV4ZWN1dGlvbihjdXJyZW50U3RlcEV4ZWN1dGlvbikudGhlbigoX2N1cnJlbnRTdGVwRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uPV9jdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmluZm8oXCJTa2lwcGluZyBjb21wbGV0ZWQgc3RlcCBleGVjdXRpb246IFtcIiArIHN0ZXAubmFtZSArIFwiXVwiKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkV4ZWN1dGluZyBzdGVwOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXAuZXhlY3V0ZShjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwiZXhlY3V0ZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSkuY2F0Y2ggKGUgPT4ge1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57dGhyb3cgZX0pXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKChjdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgIGlmIChjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUElOR1xuICAgICAgICAgICAgICAgIHx8IGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQRUQpIHtcbiAgICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgam9iIGdldHMgdGhlIG1lc3NhZ2UgdGhhdCBpdCBpcyBzdG9wcGluZ1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgICAgICAgICAgICAgIC8vIHRocm93IG5ldyBFcnJvcihcIkpvYiBpbnRlcnJ1cHRlZCBieSBzdGVwIGV4ZWN1dGlvblwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZVByb2dyZXNzKGpvYkV4ZWN1dGlvbikudGhlbigoKT0+Y3VycmVudFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkID09IGpvYkV4ZWN1dGlvbi5pZFxuICAgIH1cblxuICAgIHNob3VsZFN0YXJ0KGxhc3RTdGVwRXhlY3V0aW9uLCBleGVjdXRpb24sIHN0ZXApIHtcbiAgICAgICAgdmFyIHN0ZXBTdGF0dXM7XG4gICAgICAgIGlmIChsYXN0U3RlcEV4ZWN1dGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHN0ZXBTdGF0dXMgPSBsYXN0U3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc3RlcFN0YXR1cyA9PSBKT0JfU1RBVFVTLlVOS05PV04pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiQ2Fubm90IHJlc3RhcnQgc3RlcCBmcm9tIFVOS05PV04gc3RhdHVzXCIpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc3RlcFN0YXR1cyAhPSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBzdGVwLmlzUmVzdGFydGFibGU7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGNvbXBsZXRlZFN0ZXBzID0gZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aDtcbiAgICAgICAgbGV0IHByb2dyZXNzID0ge1xuICAgICAgICAgICAgdG90YWw6IHRoaXMuc3RlcHMubGVuZ3RoLFxuICAgICAgICAgICAgY3VycmVudDogY29tcGxldGVkU3RlcHNcbiAgICAgICAgfTtcbiAgICAgICAgaWYoIWNvbXBsZXRlZFN0ZXBzKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9ncmVzc1xuICAgICAgICB9XG4gICAgICAgIGlmKEpPQl9TVEFUVVMuQ09NUExFVEVEICE9PSBleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aC0xXS5zdGF0dXMpe1xuICAgICAgICAgICAgcHJvZ3Jlc3MuY3VycmVudC0tO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb2dyZXNzO1xuICAgIH1cblxuICAgIGFkZFN0ZXAoKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aD09PTEpe1xuICAgICAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoYXJndW1lbnRzWzBdKVxuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gbmV3IFN0ZXAoYXJndW1lbnRzWzBdLCB0aGlzLmpvYlJlcG9zaXRvcnkpO1xuICAgICAgICBzdGVwLmRvRXhlY3V0ZSA9IGFyZ3VtZW50c1sxXTtcbiAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoc3RlcCk7XG4gICAgfVxuXG59XG4iLCJleHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBzdGVwIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVTdGVwKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxuXG4gICAgLypDYWxsZWQgYWZ0ZXIgY29tcGxldGlvbiBvZiBhIHN0ZXAuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlclN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuL2pvYi1leGVjdXRpb25cIjtcblxuLypcbiByZXByZXNlbnRhdGlvbiBvZiB0aGUgZXhlY3V0aW9uIG9mIGEgc3RlcFxuICovXG5leHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgc3RlcE5hbWU7XG4gICAgam9iRXhlY3V0aW9uO1xuXG4gICAgc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7IC8vZXhlY3V0aW9uIGNvbnRleHQgZm9yIHNpbmdsZSBzdGVwIGxldmVsLFxuXG4gICAgc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICBlbmRUaW1lID0gbnVsbDtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICB0ZXJtaW5hdGVPbmx5ID0gZmFsc2U7IC8vZmxhZyB0byBpbmRpY2F0ZSB0aGF0IGFuIGV4ZWN1dGlvbiBzaG91bGQgaGFsdFxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihzdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc3RlcE5hbWUgPSBzdGVwTmFtZTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uSWQgPSBqb2JFeGVjdXRpb24uaWQ7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVycygpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Db250ZXh0KCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0O1xuICAgIH1cblxuICAgIGdldERhdGEoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzPVtdLCBkZWVwQ2xvbmUgPSB0cnVlKXtcblxuICAgICAgICB2YXIgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZURlZXBXaXRoO1xuICAgICAgICBpZighZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoW1wiZXhlY3V0aW9uQ29udGV4dFwiXS5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYodmFsdWUgaW5zdGFuY2VvZiBFcnJvcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTyhbXCJzdGVwRXhlY3V0aW9uc1wiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcblxuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iIHN0ZXAqL1xuZXhwb3J0IGNsYXNzIFN0ZXAge1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBpc1Jlc3RhcnRhYmxlID0gdHJ1ZTtcbiAgICBza2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ9dHJ1ZTtcbiAgICBzdGVwcyA9IFtdO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICAvKlByb2Nlc3MgdGhlIHN0ZXAgYW5kIGFzc2lnbiBwcm9ncmVzcyBhbmQgc3RhdHVzIG1ldGEgaW5mb3JtYXRpb24gdG8gdGhlIFN0ZXBFeGVjdXRpb24gcHJvdmlkZWQqL1xuICAgIGV4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcIkV4ZWN1dGluZyBzdGVwOiBuYW1lPVwiICsgdGhpcy5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRFRDtcbiAgICAgICAgdmFyIGV4aXRTdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRVhFQ1VUSU5HO1xuXG4gICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5iZWZvcmVTdGVwKHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIHRoaXMub3BlbihzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICB9KS50aGVuKF9zdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uID0gX3N0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBzb21lb25lIGlzIHRyeWluZyB0byBzdG9wIHVzXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi50ZXJtaW5hdGVPbmx5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIE5lZWQgdG8gdXBncmFkZSBoZXJlIG5vdCBzZXQsIGluIGNhc2UgdGhlIGV4ZWN1dGlvbiB3YXMgc3RvcHBlZFxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlN0ZXAgZXhlY3V0aW9uIHN1Y2Nlc3M6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSB0aGlzLmRldGVybWluZUpvYlN0YXR1cyhlKTtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcblxuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBFRCkge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGFuIGVycm9yIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gZXhpdFN0YXR1cztcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5hZnRlclN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gaW4gYWZ0ZXJTdGVwIGNhbGxiYWNrIGluIHN0ZXAgXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbG9zZShzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gd2hpbGUgY2xvc2luZyBzdGVwIGV4ZWN1dGlvbiByZXNvdXJjZXMgaW4gc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBkb0V4ZWN1dGlvblJlbGVhc2UoKTtcblxuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gY29tcGxldGU6IFwiICsgc3RlcEV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG5cbiAgICB9XG5cbiAgICBkZXRlcm1pbmVKb2JTdGF0dXMoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIGV4ZWN1dGUgYnVzaW5lc3MgbG9naWMuIFN1YmNsYXNzZXMgc2hvdWxkIHNldCB0aGUgZXhpdFN0YXR1cyBvbiB0aGVcbiAgICAgKiBTdGVwRXhlY3V0aW9uIGJlZm9yZSByZXR1cm5pbmcuIE11c3QgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgKi9cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGJlZ2lubmluZyBvZiBhIHN0ZXAsIHRvIG9wZW4gb3JcbiAgICAgKiBhY3F1aXJlIHJlc291cmNlcy4gRG9lcyBub3RoaW5nIGJ5IGRlZmF1bHQuXG4gICAgICovXG4gICAgb3BlbihleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGVuZCBvZiBhIHN0ZXAgKHJpZ2h0IGF0IHRoZSBlbmRcbiAgICAgKiBvZiB0aGUgZmluYWxseSBibG9jayksIHRvIGNsb3NlIG9yIHJlbGVhc2UgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBjbG9zZShleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQgPyAxIDogMFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0ICogYXMgZW5naW5lIGZyb20gJy4vZW5naW5lL2luZGV4J1xuXG5leHBvcnQge2VuZ2luZX1cbmV4cG9ydCAqIGZyb20gJy4vam9icy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itd29ya2VyJ1xuXG5cblxuIiwiaW1wb3J0IHtKb2JFeGVjdXRpb25MaXN0ZW5lcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXJcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuL2VuZ2luZS9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyB7XG4gICAgb25Kb2JTdGFydGVkID0gKCkgPT4ge307XG4gICAgb25Kb2JDb21wbGV0ZWQgPSByZXN1bHQgPT4ge307XG4gICAgb25Kb2JGYWlsZWQgPSBlcnJvcnMgPT4ge307XG4gICAgb25Kb2JTdG9wcGVkID0gKCkgPT4ge307XG4gICAgb25Kb2JUZXJtaW5hdGVkID0gKCkgPT4ge307XG4gICAgb25Qcm9ncmVzcyA9IChwcm9ncmVzcykgPT4ge307XG4gICAgY2FsbGJhY2tzVGhpc0FyZztcbiAgICB1cGRhdGVJbnRlcnZhbCA9IDEwMDtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qY29udmVuaWVuY2UgY2xhc3MgZm9yIG1hbmFnaW5nIGFuZCB0cmFja2luZyBqb2IgaW5zdGFuY2UgcHJvZ3Jlc3MqL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuICAgIGpvYnNNYW5nZXI7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgY29uZmlnO1xuXG4gICAgbGFzdEpvYkV4ZWN1dGlvbjtcbiAgICBsYXN0VXBkYXRlVGltZTtcbiAgICBwcm9ncmVzcyA9IG51bGw7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JzTWFuZ2VyLCBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IGpvYnNNYW5nZXI7XG4gICAgICAgIGlmIChqb2JJbnN0YW5jZU9yRXhlY3V0aW9uIGluc3RhbmNlb2YgSm9iSW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxhc3RKb2JFeGVjdXRpb24gJiYgIXRoaXMubGFzdEpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgdGhpcy5hZnRlckpvYih0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcbiAgICB9XG5cbiAgICBjaGVja1Byb2dyZXNzKCkge1xuXG4gICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgaWYgKHRoaXMudGVybWluYXRlZCB8fCAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpIHx8IHRoaXMuZ2V0UHJvZ3Jlc3NQZXJjZW50cyh0aGlzLnByb2dyZXNzKSA9PT0gMTAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFByb2dyZXNzKHRoaXMubGFzdEpvYkV4ZWN1dGlvbikudGhlbihwcm9ncmVzcz0+IHtcbiAgICAgICAgICAgIHRoaXMubGFzdFVwZGF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgaWYgKHByb2dyZXNzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHByb2dyZXNzO1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHByb2dyZXNzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9LCB0aGlzLmNvbmZpZy51cGRhdGVJbnRlcnZhbClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgIT09IHRoaXMuam9iSW5zdGFuY2UuaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdGFydGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc1BlcmNlbnRzKHByb2dyZXNzKSB7XG4gICAgICAgIGlmICghcHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9ncmVzcy5jdXJyZW50ICogMTAwIC8gcHJvZ3Jlc3MudG90YWw7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgaWYgKEpPQl9TVEFUVVMuQ09NUExFVEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHRoaXMuZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vblByb2dyZXNzLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLnByb2dyZXNzKTtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5nZXRSZXN1bHQoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlKS50aGVuKHJlc3VsdD0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkNvbXBsZXRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcmVzdWx0LmRhdGEpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLkZBSUxFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JGYWlsZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucyk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLlNUT1BQRUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iU3RvcHBlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGZvcmNlVXBkYXRlID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxhc3RKb2JFeGVjdXRpb24gfHwgZm9yY2VVcGRhdGUpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHJldHVybiBqZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzdG9wKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuc3RvcCh0aGlzLmxhc3RKb2JFeGVjdXRpb24pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIucnVuKHRoaXMuam9iSW5zdGFuY2Uuam9iTmFtZSwgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMudmFsdWVzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uZ2V0RGF0YSgpKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHRlcm1pbmF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnRlcm1pbmF0ZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMudGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JUZXJtaW5hdGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBKb2JXb3JrZXJ7XG5cbiAgICB3b3JrZXI7XG4gICAgbGlzdGVuZXJzID0ge307XG4gICAgZGVmYXVsdExpc3RlbmVyO1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBkZWZhdWx0TGlzdGVuZXIsIG9uRXJyb3Ipe1xuICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICB0aGlzLndvcmtlciA9IG5ldyBXb3JrZXIodXJsKTtcbiAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIgPSBkZWZhdWx0TGlzdGVuZXIgfHwgZnVuY3Rpb24oKSB7fTtcbiAgICAgICAgaWYgKG9uRXJyb3IpIHt0aGlzLndvcmtlci5vbmVycm9yID0gb25FcnJvcjt9XG5cbiAgICAgICAgdGhpcy53b3JrZXIub25tZXNzYWdlID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5kYXRhIGluc3RhbmNlb2YgT2JqZWN0ICYmXG4gICAgICAgICAgICAgICAgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RMaXN0ZW5lcicpICYmIGV2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kQXJndW1lbnRzJykpIHtcbiAgICAgICAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBpbnN0YW5jZS5saXN0ZW5lcnNbZXZlbnQuZGF0YS5xdWVyeU1ldGhvZExpc3RlbmVyXTtcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IGV2ZW50LmRhdGEucXVlcnlNZXRob2RBcmd1bWVudHM7XG4gICAgICAgICAgICAgICAgaWYobGlzdGVuZXIuZGVzZXJpYWxpemVyKXtcbiAgICAgICAgICAgICAgICAgICAgYXJncyA9IGxpc3RlbmVyLmRlc2VyaWFsaXplcihhcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGlzdGVuZXIuZm4uYXBwbHkobGlzdGVuZXIudGhpc0FyZywgYXJncyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuZGVmYXVsdExpc3RlbmVyLmNhbGwoaW5zdGFuY2UsIGV2ZW50LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzZW5kUXVlcnkoKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSm9iV29ya2VyLnNlbmRRdWVyeSB0YWtlcyBhdCBsZWFzdCBvbmUgYXJndW1lbnQnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAncXVlcnlNZXRob2QnOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3J1bkpvYicsIGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pXG4gICAgfVxuXG4gICAgZXhlY3V0ZUpvYihqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdleGVjdXRlSm9iJywgam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgcmVjb21wdXRlKGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3JlY29tcHV0ZScsIGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgIH1cblxuICAgIHBvc3RNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICAgICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLndvcmtlci50ZXJtaW5hdGUoKTtcbiAgICB9XG5cbiAgICBhZGRMaXN0ZW5lcihuYW1lLCBsaXN0ZW5lciwgdGhpc0FyZywgZGVzZXJpYWxpemVyKSB7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzW25hbWVdID0ge1xuICAgICAgICAgICAgZm46IGxpc3RlbmVyLFxuICAgICAgICAgICAgdGhpc0FyZzogdGhpc0FyZyB8fCB0aGlzLFxuICAgICAgICAgICAgZGVzZXJpYWxpemVyOiBkZXNlcmlhbGl6ZXJcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZW1vdmVMaXN0ZW5lcihuYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmxpc3RlbmVyc1tuYW1lXTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7Sm9iTGF1bmNoZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItbGF1bmNoZXJcIjtcbmltcG9ydCB7Sm9iV29ya2VyfSBmcm9tIFwiLi9qb2Itd29ya2VyXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7SWRiSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L2lkYi1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7UmVjb21wdXRlSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9yZWNvbXB1dGUvcmVjb21wdXRlLWpvYlwiO1xuaW1wb3J0IHtQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtUaW1lb3V0Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1NpbXBsZUpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9zaW1wbGUtam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7TGVhZ3VlVGFibGVKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyQ29uZmlnIHtcblxuICAgIHdvcmtlclVybCA9IG51bGw7XG4gICAgcmVwb3NpdG9yeVR5cGUgPSAnaWRiJztcbiAgICBjbGVhclJlcG9zaXRvcnkgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBKb2JzTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuXG4gICAgdXNlV29ya2VyO1xuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYkxhdW5jaGVyO1xuXG4gICAgam9iRXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBhZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlcyA9IHt9O1xuICAgIGpvYkluc3RhbmNlc1RvVGVybWluYXRlID0ge307XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcblxuXG4gICAgICAgIHRoaXMudXNlV29ya2VyID0gISF0aGlzLmNvbmZpZy53b3JrZXJVcmw7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5pbml0V29ya2VyKHRoaXMuY29uZmlnLndvcmtlclVybCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmluaXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYnMoKTtcblxuXG5cbiAgICAgICAgdGhpcy5qb2JMYXVuY2hlciA9IG5ldyBKb2JMYXVuY2hlcih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuam9iV29ya2VyLCAoZGF0YSk9PnRoaXMuc2VyaWFsaXplRGF0YShkYXRhKSk7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JzTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBpbml0UmVwb3NpdG9yeSgpIHtcbiAgICAgICAgaWYodGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUgPT09ICdpZGInKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBJZGJKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpLCAnc2Qtam9iLXJlcG9zaXRvcnknLCB0aGlzLmNvbmZpZy5jbGVhclJlcG9zaXRvcnkpO1xuICAgICAgICB9ZWxzZSBpZigndGltZW91dCcpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFRpbWVvdXRKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgfWVsc2UgaWYoJ3NpbXBsZScpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFNpbXBsZUpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxvZy5lcnJvcignSm9ic01hbmFnZXIgY29uZmlndXJhdGlvbiBlcnJvciEgVW5rbm93biByZXBvc2l0b3J5IHR5cGU6ICcrdGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUrJy4gVXNpbmcgZGVmYXVsdDogaWRiJyk7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgICAgICAgICAgdGhpcy5pbml0UmVwb3NpdG9yeSgpXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlcmlhbGl6ZURhdGEoZGF0YSkge1xuICAgICAgICByZXR1cm4gZGF0YS5zZXJpYWxpemUodHJ1ZSwgZmFsc2UsIGZhbHNlLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJlcGxhY2VyKCkpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhpZCk7XG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgcnVuKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JMYXVuY2hlci5ydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkIHx8ICFqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy9qb2Igd2FzIGRlbGVnYXRlZCB0byB3b3JrZXIgYW5kIGlzIHN0aWxsIHJ1bm5pbmdcblxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXSA9IHJlc29sdmU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLmV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgfVxuXG4gICAgc3RvcChqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHZhciBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIGlmICghVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpIHtcbiAgICAgICAgICAgIGlkID0gam9iRXhlY3V0aW9uT3JJZC5pZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGlkKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iIEV4ZWN1dGlvbiBub3QgZm91bmQ6IFwiICsgam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiSm9iIEV4ZWN1dGlvbiBub3QgcnVubmluZywgc3RhdHVzOiBcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIiwgZW5kVGltZTogXCIgKyBqb2JFeGVjdXRpb24uZW5kVGltZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnN0b3Agam9iIGV4ZWN1dGlvbiBpZiBydW5uaW5nIGFuZCBkZWxldGUgam9iIGluc3RhbmNlIGZyb20gcmVwb3NpdG9yeSovXG4gICAgdGVybWluYXRlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIGlmKGpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uLmlkLCBKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCkudGhlbigoKT0+am9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZVtqb2JJbnN0YW5jZS5pZF09am9iSW5zdGFuY2U7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgfVxuXG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzVmFsdWVzKTtcbiAgICB9XG5cblxuICAgIC8qUmV0dXJucyBhIHByb21pc2UqL1xuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICBpZiAodGhpcy51c2VXb3JrZXIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYldvcmtlcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIShqb2JQYXJhbWV0ZXJzIGluc3RhbmNlb2YgSm9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgIGpvYlBhcmFtZXRlcnMgPSB0aGlzLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVycylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgaW5pdFdvcmtlcih3b3JrZXJVcmwpIHtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBuZXcgSm9iV29ya2VyKHdvcmtlclVybCwgKCk9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcignZXJyb3IgaW4gd29ya2VyJywgYXJndW1lbnRzKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBhcmdzRGVzZXJpYWxpemVyID0gKGFyZ3MpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFt0aGlzLmpvYlJlcG9zaXRvcnkucmV2aXZlSm9iRXhlY3V0aW9uKGFyZ3NbMF0pXVxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiYmVmb3JlSm9iXCIsIHRoaXMuYmVmb3JlSm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJhZnRlckpvYlwiLCB0aGlzLmFmdGVySm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJqb2JGYXRhbEVycm9yXCIsIHRoaXMub25Kb2JGYXRhbEVycm9yLCB0aGlzKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYnMoKSB7XG5cbiAgICAgICAgbGV0IHNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgPSBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgbGV0IHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iID0gbmV3IFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICBpZighVXRpbHMuaXNXb3JrZXIoKSl7XG4gICAgICAgICAgICBzZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgICAgIHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2Ioc2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFRvcm5hZG9EaWFncmFtSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihwcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFJlY29tcHV0ZUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IExlYWd1ZVRhYmxlSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYihqb2IpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlZ2lzdGVySm9iKGpvYik7XG4gICAgICAgIGpvYi5yZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpXG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBkZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdmFyIGluZGV4ID0gdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImJlZm9yZUpvYlwiLCB0aGlzLnVzZVdvcmtlciwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsPT5sLmJlZm9yZUpvYihqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiYWZ0ZXJKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5hZnRlckpvYihqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbilcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHRoaXMuam9iSW5zdGFuY2VzVG9UZXJtaW5hdGVbam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkXSl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2Uoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLCBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBvbkpvYkZhdGFsRXJyb3Ioam9iRXhlY3V0aW9uSWQsIGVycm9yKXtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb25JZF07XG4gICAgICAgIGlmIChwcm9taXNlUmVzb2x2ZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uSWQpLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIGlmKGVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICAgICAgcHJvbWlzZVJlc29sdmUoam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgfVxuICAgICAgICBsb2cuZGVidWcoJ29uSm9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBlcnJvcik7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7XG4gICAgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUsXG4gICAgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUsXG4gICAgTWF4aU1pblJ1bGUsXG4gICAgTWF4aU1heFJ1bGUsXG4gICAgTWluaU1pblJ1bGUsXG4gICAgTWluaU1heFJ1bGVcbn0gZnJvbSBcIi4vcnVsZXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCAqIGFzIG1vZGVsIGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtNaW5NYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9taW4tbWF4LXJ1bGVcIjtcbmltcG9ydCB7TWF4TWluUnVsZX0gZnJvbSBcIi4vcnVsZXMvbWF4LW1pbi1ydWxlXCI7XG5pbXBvcnQge01pbk1pblJ1bGV9IGZyb20gXCIuL3J1bGVzL21pbi1taW4tcnVsZVwiO1xuaW1wb3J0IHtNYXhNYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9tYXgtbWF4LXJ1bGVcIjtcblxuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGVzTWFuYWdlcntcblxuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY3VycmVudFJ1bGU7XG4gICAgcnVsZUJ5TmFtZSA9IHt9O1xuICAgIHJ1bGVzID0gW107XG5cblxuICAgIGZsaXBQYWlyID0ge307XG4gICAgcGF5b2ZmSW5kZXggPSAwO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgY3VycmVudFJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNYXhpTWluUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWF4aU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1pbmlNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNaW5pTWF4UnVsZShleHByZXNzaW9uRW5naW5lKSk7XG5cbiAgICAgICAgbGV0IG1pbk1heCA9IG5ldyBNaW5NYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWF4KTtcbiAgICAgICAgbGV0IG1heE1pbiA9IG5ldyBNYXhNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWluKTtcbiAgICAgICAgdGhpcy5hZGRGbGlwUGFpcihtaW5NYXgsIG1heE1pbik7XG5cbiAgICAgICAgbGV0IG1pbk1pbiA9IG5ldyBNaW5NaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWluKTtcbiAgICAgICAgbGV0IG1heE1heCA9IG5ldyBNYXhNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWF4KTtcblxuXG4gICAgICAgIGlmIChjdXJyZW50UnVsZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbY3VycmVudFJ1bGVOYW1lXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVzWzBdO1xuICAgICAgICB9XG5cbiAgICB9XG5cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KXtcbiAgICAgICAgdGhpcy5wYXlvZmZJbmRleCA9IHBheW9mZkluZGV4IHx8IDA7XG4gICAgfVxuXG4gICAgYWRkUnVsZShydWxlKXtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW3J1bGUubmFtZV09cnVsZTtcbiAgICAgICAgdGhpcy5ydWxlcy5wdXNoKHJ1bGUpO1xuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpe1xuICAgICAgICAgcmV0dXJuICEhdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV07XG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIGZsaXBSdWxlKCl7XG4gICAgICAgIHZhciBmbGlwcGVkID0gdGhpcy5mbGlwUGFpclt0aGlzLmN1cnJlbnRSdWxlLm5hbWVdO1xuICAgICAgICBpZihmbGlwcGVkKXtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSBmbGlwcGVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpe1xuICAgICAgICB0aGlzLnJ1bGVzLmZpbHRlcihyPT5yLm11bHRpQ3JpdGVyaWEpLmZvckVhY2gocj0+ci5zZXREZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChwYXJzZUZsb2F0KGRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KSkpO1xuICAgIH1cblxuICAgIHJlY29tcHV0ZShkYXRhTW9kZWwsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMsIGFsbDogJythbGxSdWxlcyk7XG5cbiAgICAgICAgZGF0YU1vZGVsLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLnJlY29tcHV0ZVRyZWUobiwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lLzEwMDApO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGluZyBydWxlcyBmb3IgdHJlZSAuLi4nLCByb290KTtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAgICAgdmFyIHJ1bGVzICA9IFt0aGlzLmN1cnJlbnRSdWxlXTtcbiAgICAgICAgaWYoYWxsUnVsZXMpe1xuICAgICAgICAgICAgcnVsZXMgPSB0aGlzLnJ1bGVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcnVsZXMuZm9yRWFjaChydWxlPT4ge1xuICAgICAgICAgICAgcnVsZS5zZXRQYXlvZmZJbmRleCh0aGlzLnBheW9mZkluZGV4KTtcbiAgICAgICAgICAgIHJ1bGUuc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlUGF5b2ZmKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlT3B0aW1hbChyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY2xlYXJEZWNpc2lvblBvbGljeSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdGltZSAgPSAobmV3IERhdGUoKS5nZXRUaW1lKCkgLSBzdGFydFRpbWUpLzEwMDA7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRhdGlvbiB0b29rICcrdGltZSsncycpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuYW1lKSB7XG4gICAgICAgIHJldHVybiBub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCBuYW1lKVxuXG4gICAgfVxuXG4gICAgZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuYW1lKXtcbiAgICAgICAgaWYobmFtZT09PSdwcm9iYWJpbGl0eScpe1xuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdwcm9iYWJpbGl0eScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J3BheW9mZicpe1xuICAgICAgICAgICAgaWYodGhpcy5jdXJyZW50UnVsZS5tdWx0aUNyaXRlcmlhKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmYnKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3BheW9mZlsnICt0aGlzLnBheW9mZkluZGV4ICsgJ10nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9XG4gICAgICAgIGlmKG5hbWU9PT0nb3B0aW1hbCcpe1xuICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdvcHRpbWFsJylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEZsaXBQYWlyKHJ1bGUxLCBydWxlMikge1xuICAgICAgICB0aGlzLmZsaXBQYWlyW3J1bGUxLm5hbWVdID0gcnVsZTI7XG4gICAgICAgIHRoaXMuZmxpcFBhaXJbcnVsZTIubmFtZV0gPSBydWxlMTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWF4aW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUuTkFNRSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZj0wLCBwcm9iYWJpbGl0eVRvRW50ZXI9MSl7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBpZiAoIHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWluaW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUuTkFNRSwgZmFsc2UsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSkscGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1taW4tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1taW4tcnVsZSdcblxuXG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1heFJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1heFJ1bGUuTkFNRSwgWzEsIDFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1pblJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1pblJ1bGUuTkFNRSwgWzEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNYXhSdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNaW5SdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNaW5NYXhSdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW4tbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5NYXhSdWxlLk5BTUUsIFstMSwgMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWluTWluUnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluTWluUnVsZS5OQU1FLCBbLTEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNYXhSdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPGJlc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvYmVzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5tYXhCeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNaW5SdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSBcIi4vb2JqZWN0aXZlLXJ1bGVcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cblxuZXhwb3J0IGNsYXNzIE11bHRpQ3JpdGVyaWFSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZSB7XG5cbiAgICBjcml0ZXJpb24xV2VpZ2h0ID0gMTtcbiAgICBwYXlvZmZDb2VmZnMgPSBbMSwgLTFdO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgcGF5b2ZmQ29lZmZzLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUsIHRydWUpO1xuICAgICAgICB0aGlzLnBheW9mZkNvZWZmcyA9IHBheW9mZkNvZWZmcztcblxuICAgIH1cblxuICAgIHNldERlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGNyaXRlcmlvbjFXZWlnaHQpIHtcbiAgICAgICAgdGhpcy5jcml0ZXJpb24xV2VpZ2h0ID0gY3JpdGVyaW9uMVdlaWdodDtcbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmYgPSBbMCwgMF0sIGFnZ3JlZ2F0ZWRQYXlvZmYgPSBbMCwgMF0pIHtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gWzAsIDBdO1xuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgYmFzZVBheW9mZnMgPSBbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldO1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIGJhc2VQYXlvZmZzLCBbdGhpcy5hZGQoYmFzZVBheW9mZnNbMF0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMF0pLCB0aGlzLmFkZChiYXNlUGF5b2Zmc1sxXSwgYWdncmVnYXRlZFBheW9mZlsxXSldKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkQ29tYmluZWRQYXlvZmYgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZENvbWJpbmVkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZENvbWJpbmVkUGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJlc3RDaGlsZC5lcXVhbHMoY2hpbGRDb21iaW5lZFBheW9mZikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5kZWNpc2lvblBvbGljeSkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHNlbGVjdGVkSW5kZXhlcy5pbmRleE9mKGkpIDwgMCA/IDAuMCA6IDEuMCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBiYXNlUGF5b2ZmcyA9IFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV07XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgYmFzZVBheW9mZnMsIFt0aGlzLmFkZChiYXNlUGF5b2Zmc1swXSwgYWdncmVnYXRlZFBheW9mZlswXSksIHRoaXMuYWRkKGJhc2VQYXlvZmZzWzFdLCBhZ2dyZWdhdGVkUGF5b2ZmWzFdKV0pO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDA7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodCA9IHRoaXMuYWRkKHN1bXdlaWdodCwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChzdW13ZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmYuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgZXAgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZlsnICsgaSArICddJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZltpXSA9IHRoaXMuYWRkKHAsIHRoaXMubXVsdGlwbHkodGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JyksIGVwKS5kaXYoc3Vtd2VpZ2h0KSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9XG4gICAgICAgIHBheW9mZi5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIHBheW9mZltpXSA9IHRoaXMuYWRkKHAsIGNoaWxkcmVuUGF5b2ZmW2ldKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKG5vZGUpO1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnYWdncmVnYXRlZFBheW9mZicsIGFnZ3JlZ2F0ZWRQYXlvZmYpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIDApOyAvL2luaXRpYWwgdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicsIHRoaXMuY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKHBheW9mZikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJywgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICBjb21wdXRlQ29tYmluZWRQYXlvZmYocGF5b2ZmKXtcbiAgICAgICAgLy8gW2NyaXRlcmlvbiAxIGNvZWZmXSpbY3JpdGVyaW9uIDFdKlt3ZWlnaHRdK1tjcml0ZXJpb24gMiBjb2VmZl0qW2NyaXRlcmlvbiAyXVxuICAgICAgICBpZiAodGhpcy5jcml0ZXJpb24xV2VpZ2h0ID09PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHBheW9mZlswXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuYWRkKHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHRoaXMubXVsdGlwbHkodGhpcy5jcml0ZXJpb24xV2VpZ2h0LCBwYXlvZmZbMF0pKSwgdGhpcy5tdWx0aXBseSh0aGlzLnBheW9mZkNvZWZmc1sxXSwgcGF5b2ZmWzFdKSk7XG4gICAgfVxuXG4gICAgLy8gIGNvbWJpbmVkUGF5b2ZmIC0gcGFyZW50IGVkZ2UgY29tYmluZWRQYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBjb21iaW5lZFBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicpLCBjb21iaW5lZFBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAnY29tYmluZWRQYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5jb21wdXRlQ29tYmluZWRQYXlvZmYoW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuLypCYXNlIGNsYXNzIGZvciBvYmplY3RpdmUgcnVsZXMqL1xuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGUge1xuICAgIG5hbWU7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGRlY2lzaW9uUG9saWN5O1xuICAgIG1heGltaXphdGlvbjtcblxuICAgIHBheW9mZkluZGV4ID0gMDtcbiAgICBtdWx0aUNyaXRlcmlhID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBtYXhpbWl6YXRpb24sIGV4cHJlc3Npb25FbmdpbmUsIG11bHRpQ3JpdGVyaWE9ZmFsc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5tYXhpbWl6YXRpb24gPSBtYXhpbWl6YXRpb247XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMubXVsdGlDcml0ZXJpYSA9IG11bHRpQ3JpdGVyaWE7XG4gICAgfVxuXG4gICAgc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IGRlY2lzaW9uUG9saWN5O1xuICAgIH1cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KSB7XG4gICAgICAgIHRoaXMucGF5b2ZmSW5kZXggPSBwYXlvZmZJbmRleDtcbiAgICB9XG5cbiAgICBjbGVhckRlY2lzaW9uUG9saWN5KCkge1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBzaG91bGQgcmV0dXJuIGFycmF5IG9mIHNlbGVjdGVkIGNoaWxkcmVuIGluZGV4ZXNcbiAgICBtYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpIHtcbiAgICAgICAgdmFyIGJlc3Q7XG4gICAgICAgIGlmICh0aGlzLm1heGltaXphdGlvbikge1xuICAgICAgICAgICAgYmVzdCA9IHRoaXMubWF4KC4uLmNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBiZXN0ID0gdGhpcy5taW4oLi4uY2hpbGRyZW5QYXlvZmZzKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgIGNoaWxkcmVuUGF5b2Zmcy5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIGlmIChFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUoYmVzdCwgcCkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHNlbGVjdGVkSW5kZXhlcztcbiAgICB9XG5cbiAgICBfbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLmRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcy5kZWNpc2lvblBvbGljeSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiBbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMubWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKTtcbiAgICB9XG5cbiAgICAvLyBleHRlbnNpb24gcG9pbnQgZm9yIGNoYW5naW5nIGNvbXB1dGVkIHByb2JhYmlsaXR5IG9mIGVkZ2VzIGluIGEgY2hhbmNlIG5vZGVcbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpIHtcblxuICAgIH1cblxuICAgIC8vIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZiwgYWdncmVnYXRlZFBheW9mZiAtIGFnZ3JlZ2F0ZWQgcGF5b2ZmIGFsb25nIHBhdGhcbiAgICBjb21wdXRlUGF5b2ZmKG5vZGUsIHBheW9mZiA9IDAsIGFnZ3JlZ2F0ZWRQYXlvZmYgPSAwKSB7XG4gICAgICAgIHZhciBjaGlsZHJlblBheW9mZiA9IDA7XG4gICAgICAgIGlmIChub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IHRoaXMuX21ha2VEZWNpc2lvbihub2RlLCBub2RlLmNoaWxkRWRnZXMubWFwKGU9PnRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLmFkZCh0aGlzLmJhc2VQYXlvZmYoZSksIGFnZ3JlZ2F0ZWRQYXlvZmYpKSkpO1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q2hpbGQgPSAtSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q2hpbGQgPSBJbmZpbml0eTtcbiAgICAgICAgICAgICAgICB2YXIgd29yc3RDb3VudCA9IDE7XG5cbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZFBheW9mZiA8IHdvcnN0Q2hpbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNoaWxkUGF5b2ZmLmVxdWFscyh3b3JzdENoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd29yc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hpbGRQYXlvZmYuZXF1YWxzKGJlc3RDaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLm1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KG5vZGUuY2hpbGRFZGdlcywgYmVzdENoaWxkLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGQsIHdvcnN0Q291bnQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgc3Vtd2VpZ2h0ID0gMDtcbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgc3Vtd2VpZ2h0ID0gdGhpcy5hZGQoc3Vtd2VpZ2h0LCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gY29uc29sZS5sb2cocGF5b2ZmLG5vZGUuY2hpbGRFZGdlcywnc3Vtd2VpZ2h0JyxzdW13ZWlnaHQpO1xuICAgICAgICAgICAgaWYgKHN1bXdlaWdodCA+IDApIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZiA9IHRoaXMuYWRkKGNoaWxkcmVuUGF5b2ZmLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkuZGl2KHN1bXdlaWdodCkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHBheW9mZiA9IHRoaXMuYWRkKHBheW9mZiwgY2hpbGRyZW5QYXlvZmYpO1xuICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMobm9kZSk7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJysgJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2NoaWxkcmVuUGF5b2ZmJyArICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUsIHBheW9mZik7XG4gICAgfVxuXG4gICAgLy8ga29sb3J1amUgb3B0eW1hbG5lIMWbY2llxbxraVxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUpIHtcbiAgICAgICAgdGhyb3cgJ2NvbXB1dGVPcHRpbWFsIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3IgcnVsZTogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qIGdldCBvciBzZXQgY29tcHV0ZWQgcGF5b2ZmKi9cbiAgICBjb21wdXRlZFBheW9mZihub2RlLCB2YWx1ZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCB2YWx1ZSlcbiAgICB9XG5cbiAgICAvKkdldCBvciBzZXQgb2JqZWN0J3MgY29tcHV0ZWQgdmFsdWUgZm9yIGN1cnJlbnQgcnVsZSovXG4gICAgY1ZhbHVlKG9iamVjdCwgZmllbGRQYXRoLCB2YWx1ZSkge1xuICAgICAgICAvLyBpZihmaWVsZFBhdGgudHJpbSgpID09PSAncGF5b2ZmJyl7XG4gICAgICAgIC8vICAgICBmaWVsZFBhdGggKz0gJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJztcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIHJldHVybiBvYmplY3QuY29tcHV0ZWRWYWx1ZSh0aGlzLm5hbWUsIGZpZWxkUGF0aCwgdmFsdWUpO1xuICAgIH1cblxuICAgIGJhc2VQcm9iYWJpbGl0eShlZGdlKSB7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgfVxuXG4gICAgYmFzZVBheW9mZihlZGdlLCBwYXlvZmZJbmRleCkge1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCBwYXlvZmZJbmRleCB8fCB0aGlzLnBheW9mZkluZGV4KTtcbiAgICB9XG5cbiAgICBjbGVhckNvbXB1dGVkVmFsdWVzKG9iamVjdCkge1xuICAgICAgICBvYmplY3QuY2xlYXJDb21wdXRlZFZhbHVlcyh0aGlzLm5hbWUpO1xuICAgIH1cblxuICAgIGFkZChhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmFkZChhLCBiKVxuICAgIH1cblxuICAgIHN1YnRyYWN0KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoYSwgYilcbiAgICB9XG5cbiAgICBkaXZpZGUoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoYSwgYilcbiAgICB9XG5cbiAgICBtdWx0aXBseShhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm11bHRpcGx5KGEsIGIpXG4gICAgfVxuXG4gICAgbWF4KCkge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tYXgoLi4uYXJndW1lbnRzKVxuICAgIH1cblxuICAgIG1pbigpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubWluKC4uLmFyZ3VtZW50cylcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge09wZXJhdGlvbn0gZnJvbSBcIi4vb3BlcmF0aW9uXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5cbi8qU3VidHJlZSBmbGlwcGluZyBvcGVyYXRpb24qL1xuZXhwb3J0IGNsYXNzIEZsaXBTdWJ0cmVlIGV4dGVuZHMgT3BlcmF0aW9ue1xuXG4gICAgc3RhdGljICROQU1FID0gJ2ZsaXBTdWJ0cmVlJztcbiAgICBkYXRhO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKEZsaXBTdWJ0cmVlLiROQU1FKTtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgaXNBcHBsaWNhYmxlKG9iamVjdCl7XG4gICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlXG4gICAgfVxuXG4gICAgY2FuUGVyZm9ybShub2RlKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpY2FibGUobm9kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKHRoaXMuZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShub2RlKSkuaXNWYWxpZCgpKSB7IC8vY2hlY2sgaWYgdGhlIHdob2xlIHN1YnRyZWUgaXMgcHJvcGVyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5OdW1iZXIgPSBudWxsO1xuICAgICAgICB2YXIgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMgPSBbXTtcbiAgICAgICAgdmFyIGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoKTtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzU2V0O1xuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5ldmVyeShlPT4ge1xuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gZS5jaGlsZE5vZGU7XG4gICAgICAgICAgICAgICAgaWYgKCEoY2hpbGQgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkcmVuRWRnZUxhYmVsc1NldC5oYXMoZS5uYW1lLnRyaW0oKSkpIHsgLy8gZWRnZSBsYWJlbHMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNoaWxkcmVuRWRnZUxhYmVsc1NldC5hZGQoZS5uYW1lLnRyaW0oKSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuTnVtYmVyID0gY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuTnVtYmVyIDwgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChnZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzLnB1c2goZ2UubmFtZS50cmltKCkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldC5zaXplICE9PSBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5sZW5ndGgpIHsgLy9ncmFuZGNoaWxkcmVuIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZC5jaGlsZEVkZ2VzLmxlbmd0aCAhPSBncmFuZGNoaWxkcmVuTnVtYmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkLmNoaWxkRWRnZXMuZXZlcnkoKGdlLCBpKT0+Z3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNbaV0gPT09IGdlLm5hbWUudHJpbSgpKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG5cbiAgICAgICAgICAgIH0pKSB7XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHBlcmZvcm0ocm9vdCkge1xuXG4gICAgICAgIHZhciByb290Q2xvbmUgPSB0aGlzLmRhdGEuY2xvbmVTdWJ0cmVlKHJvb3QsIHRydWUpO1xuICAgICAgICB2YXIgb2xkQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICB2YXIgb2xkR3JhbmRDaGlsZHJlbk51bWJlciA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlcy5sZW5ndGg7XG5cbiAgICAgICAgdmFyIGNoaWxkcmVuTnVtYmVyID0gb2xkR3JhbmRDaGlsZHJlbk51bWJlcjtcbiAgICAgICAgdmFyIGdyYW5kQ2hpbGRyZW5OdW1iZXIgPSBvbGRDaGlsZHJlbk51bWJlcjtcblxuICAgICAgICB2YXIgY2FsbGJhY2tzRGlzYWJsZWQgPSB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQ7XG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IHRydWU7XG5cblxuICAgICAgICB2YXIgY2hpbGRYID0gcm9vdC5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5sb2NhdGlvbi54O1xuICAgICAgICB2YXIgdG9wWSA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueTtcbiAgICAgICAgdmFyIGJvdHRvbVkgPSByb290LmNoaWxkRWRnZXNbb2xkQ2hpbGRyZW5OdW1iZXIgLSAxXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tvbGRHcmFuZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG5cbiAgICAgICAgdmFyIGV4dGVudFkgPSBib3R0b21ZIC0gdG9wWTtcbiAgICAgICAgdmFyIHN0ZXBZID0gZXh0ZW50WSAvIChjaGlsZHJlbk51bWJlciArIDEpO1xuXG4gICAgICAgIHJvb3QuY2hpbGRFZGdlcy5zbGljZSgpLmZvckVhY2goZT0+IHRoaXMuZGF0YS5yZW1vdmVOb2RlKGUuY2hpbGROb2RlKSk7XG5cblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoaWxkcmVuTnVtYmVyOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IG5ldyBtb2RlbC5DaGFuY2VOb2RlKG5ldyBtb2RlbC5Qb2ludChjaGlsZFgsIHRvcFkgKyAoaSArIDEpICogc3RlcFkpKTtcbiAgICAgICAgICAgIHZhciBlZGdlID0gdGhpcy5kYXRhLmFkZE5vZGUoY2hpbGQsIHJvb3QpO1xuICAgICAgICAgICAgZWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0ubmFtZTtcblxuICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IDA7XG5cbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZ3JhbmRDaGlsZHJlbk51bWJlcjsgaisrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGdyYW5kQ2hpbGQgPSByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jaGlsZE5vZGU7XG5cblxuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkRWRnZSA9IHRoaXMuZGF0YS5hdHRhY2hTdWJ0cmVlKGdyYW5kQ2hpbGQsIGNoaWxkKTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0ubmFtZTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wYXlvZmYgPSBFeHByZXNzaW9uRW5naW5lLmFkZChyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQYXlvZmYoKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUGF5b2ZmKCkpO1xuXG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLm11bHRpcGx5KHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCkpO1xuICAgICAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLmFkZChlZGdlLnByb2JhYmlsaXR5LCBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5ID0gcCA9PiBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwLCBlZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIGlmIChlZGdlLnByb2JhYmlsaXR5LmVxdWFscygwKSkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9iID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgZ3JhbmRDaGlsZHJlbk51bWJlcik7XG4gICAgICAgICAgICAgICAgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gcHJvYjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGQuY2hpbGRFZGdlcy5mb3JFYWNoKGdyYW5kQ2hpbGRFZGdlPT4ge1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eShncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLl9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkLmNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKGVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChyb290LmNoaWxkRWRnZXMpO1xuXG5cbiAgICAgICAgdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkID0gY2FsbGJhY2tzRGlzYWJsZWQ7XG4gICAgICAgIHRoaXMuZGF0YS5fZmlyZU5vZGVBZGRlZENhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAoY2hpbGRFZGdlcywgcHJvYmFiaWxpdHlTdW0pe1xuICAgICAgICBpZighcHJvYmFiaWxpdHlTdW0pe1xuICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcHJvYmFiaWxpdHlTdW0uZXF1YWxzKDEpKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygnU3VtIG9mIHRoZSBwcm9iYWJpbGl0aWVzIGluIGNoaWxkIG5vZGVzIGlzIG5vdCBlcXVhbCB0byAxIDogJywgcHJvYmFiaWxpdHlTdW0pO1xuICAgICAgICAgICAgdmFyIG5ld1Byb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgdmFyIGNmID0gMTAwMDAwMDAwMDAwMDsgLy8xMF4xMlxuICAgICAgICAgICAgdmFyIHByZWMgPSAxMjtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSBwYXJzZUludChFeHByZXNzaW9uRW5naW5lLnJvdW5kKGUucHJvYmFiaWxpdHksIHByZWMpICogY2YpO1xuICAgICAgICAgICAgICAgIG5ld1Byb2JhYmlsaXR5U3VtID0gbmV3UHJvYmFiaWxpdHlTdW0gKyBlLnByb2JhYmlsaXR5O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB2YXIgcmVzdCA9IGNmIC0gbmV3UHJvYmFiaWxpdHlTdW07XG4gICAgICAgICAgICBsb2cuaW5mbygnTm9ybWFsaXppbmcgd2l0aCByb3VuZGluZyB0byBwcmVjaXNpb246ICcgKyBwcmVjLCByZXN0KTtcbiAgICAgICAgICAgIGNoaWxkRWRnZXNbMF0ucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLmFkZChyZXN0LCBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIG5ld1Byb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocGFyc2VJbnQoZS5wcm9iYWJpbGl0eSksIGNmKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJcbi8qQmFzZSBjbGFzcyBmb3IgY29tcGxleCBvcGVyYXRpb25zIG9uIHRyZWUgc3RydWN0dXJlKi9cbmV4cG9ydCBjbGFzcyBPcGVyYXRpb257XG5cbiAgICBuYW1lO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSl7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgfVxuXG4gICAgLy9jaGVjayBpZiBvcGVyYXRpb24gaXMgcG90ZW50aWFsbHkgYXBwbGljYWJsZSBmb3Igb2JqZWN0XG4gICAgaXNBcHBsaWNhYmxlKCl7XG4gICAgICAgIHRocm93ICdpc0FwcGxpY2FibGUgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLy9jaGVjayBpZiBjYW4gcGVyZm9ybSBvcGVyYXRpb24gZm9yIGFwcGxpY2FibGUgb2JqZWN0XG4gICAgY2FuUGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAnY2FuUGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cbiAgICBwZXJmb3JtKG9iamVjdCl7XG4gICAgICAgIHRocm93ICdwZXJmb3JtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0ZsaXBTdWJ0cmVlfSBmcm9tIFwiLi9mbGlwLXN1YnRyZWVcIjtcblxuXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9uc01hbmFnZXIge1xuXG4gICAgb3BlcmF0aW9ucyA9IFtdO1xuICAgIG9wZXJhdGlvbkJ5TmFtZSA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJPcGVyYXRpb24obmV3IEZsaXBTdWJ0cmVlKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICB9XG5cbiAgICByZWdpc3Rlck9wZXJhdGlvbihvcGVyYXRpb24pe1xuICAgICAgICB0aGlzLm9wZXJhdGlvbnMucHVzaChvcGVyYXRpb24pO1xuICAgICAgICB0aGlzLm9wZXJhdGlvbkJ5TmFtZVtvcGVyYXRpb24ubmFtZV0gPSBvcGVyYXRpb247XG4gICAgfVxuXG5cbiAgICBnZXRPcGVyYXRpb25CeU5hbWUobmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbkJ5TmFtZVtuYW1lXTtcbiAgICB9XG5cbiAgICBvcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCl7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbnMuZmlsdGVyKG9wPT5vcC5pc0FwcGxpY2FibGUob2JqZWN0KSlcbiAgICB9XG5cbn1cbiIsIlxuZXhwb3J0IGNsYXNzIERlY2lzaW9ue1xuICAgIG5vZGU7XG4gICAgZGVjaXNpb25WYWx1ZTsgLy9pbmRleCBvZiAgc2VsZWN0ZWQgZWRnZVxuICAgIGNoaWxkcmVuID0gW107XG4gICAga2V5O1xuXG4gICAgY29uc3RydWN0b3Iobm9kZSwgZGVjaXNpb25WYWx1ZSkge1xuICAgICAgICB0aGlzLm5vZGUgPSBub2RlO1xuICAgICAgICB0aGlzLmRlY2lzaW9uVmFsdWUgPSBkZWNpc2lvblZhbHVlO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShkZWNpc2lvbiwga2V5UHJvcGVydHk9JyRpZCcpe1xuICAgICAgICB2YXIgZSA9IGRlY2lzaW9uLm5vZGUuY2hpbGRFZGdlc1tkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgdmFyIGtleSA9IGRlY2lzaW9uLm5vZGVba2V5UHJvcGVydHldK1wiOlwiKyhlW2tleVByb3BlcnR5XT8gZVtrZXlQcm9wZXJ0eV0gOiBkZWNpc2lvbi5kZWNpc2lvblZhbHVlKzEpO1xuICAgICAgICByZXR1cm4ga2V5LnJlcGxhY2UoL1xcbi9nLCAnICcpO1xuICAgIH1cblxuICAgIGFkZERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpe1xuICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSk7XG4gICAgICAgIHRoaXMuY2hpbGRyZW4ucHVzaChkZWNpc2lvbik7XG4gICAgICAgIHRoaXMua2V5ID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICB9XG5cbiAgICBnZXREZWNpc2lvbihkZWNpc2lvbk5vZGUpe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24uZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKVxuICAgIH1cblxuICAgIHN0YXRpYyBnZXREZWNpc2lvbihkZWNpc2lvbiwgZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgaWYoZGVjaXNpb24ubm9kZT09PWRlY2lzaW9uTm9kZSB8fCBkZWNpc2lvbi5ub2RlLiRpZCA9PT0gZGVjaXNpb25Ob2RlLiRpZCl7XG4gICAgICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgICAgIH1cbiAgICAgICAgZm9yKHZhciBpPTA7IGk8ZGVjaXNpb24uY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgdmFyIGQgPSBEZWNpc2lvbi5nZXREZWNpc2lvbihkZWNpc2lvbi5jaGlsZHJlbltpXSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmKGQpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhdGljIHRvRGVjaXNpb25TdHJpbmcoZGVjaXNpb24sIGV4dGVuZGVkPWZhbHNlLCBrZXlQcm9wZXJ0eT0nbmFtZScsIGluZGVudCA9ICcnKXtcblxuICAgICAgICB2YXIgcmVzID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5KTtcbiAgICAgICAgdmFyIGNoaWxkcmVuUmVzID0gXCJcIjtcblxuICAgICAgICBkZWNpc2lvbi5jaGlsZHJlbi5mb3JFYWNoKGQ9PntcbiAgICAgICAgICAgIGlmKGNoaWxkcmVuUmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9ICdcXG4nK2luZGVudDtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gXCIsIFwiXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZHJlblJlcyArPSBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKGQsZXh0ZW5kZWQsa2V5UHJvcGVydHksIGluZGVudCsnXFx0JylcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aCl7XG4gICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgPSAgJ1xcbicraW5kZW50ICtjaGlsZHJlblJlcztcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gXCIgLSAoXCIgKyBjaGlsZHJlblJlcyArIFwiKVwiO1xuICAgICAgICAgICAgfVxuXG5cblxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcytjaGlsZHJlblJlcztcbiAgICB9XG5cbiAgICB0b0RlY2lzaW9uU3RyaW5nKGluZGVudD1mYWxzZSl7XG4gICAgICAgIHJldHVybiBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKHRoaXMsIGluZGVudClcbiAgICB9XG59XG4iLCJpbXBvcnQge1BvbGljeX0gZnJvbSBcIi4vcG9saWN5XCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY2llc0NvbGxlY3RvcntcbiAgICBwb2xpY2llcyA9IFtdO1xuICAgIHJ1bGVOYW1lPWZhbHNlO1xuXG4gICAgY29uc3RydWN0b3Iocm9vdCwgb3B0aW1hbEZvclJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5ydWxlTmFtZSA9IG9wdGltYWxGb3JSdWxlTmFtZTtcbiAgICAgICAgdGhpcy5jb2xsZWN0KHJvb3QpLmZvckVhY2goKGRlY2lzaW9ucyxpKT0+e1xuICAgICAgICAgICAgdGhpcy5wb2xpY2llcy5wdXNoKG5ldyBQb2xpY3koXCIjXCIrKGkrMSksIGRlY2lzaW9ucykpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYodGhpcy5wb2xpY2llcy5sZW5ndGg9PT0xKXtcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXNbMF0uaWQgPSBcImRlZmF1bHRcIlxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29sbGVjdChyb290KXtcbiAgICAgICAgdmFyIG5vZGVRdWV1ZSA9IFtyb290XTtcbiAgICAgICAgdmFyIG5vZGU7XG4gICAgICAgIHZhciBkZWNpc2lvbk5vZGVzID0gW107XG4gICAgICAgIHdoaWxlKG5vZGVRdWV1ZS5sZW5ndGgpe1xuICAgICAgICAgICAgbm9kZSA9IG5vZGVRdWV1ZS5zaGlmdCgpO1xuXG4gICAgICAgICAgICBpZih0aGlzLnJ1bGVOYW1lICYmICFub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5ydWxlTmFtZSwgJ29wdGltYWwnKSl7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpe1xuICAgICAgICAgICAgICAgIGRlY2lzaW9uTm9kZXMucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGVkZ2UsIGkpPT57XG4gICAgICAgICAgICAgICAgbm9kZVF1ZXVlLnB1c2goZWRnZS5jaGlsZE5vZGUpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmNhcnRlc2lhblByb2R1Y3RPZihkZWNpc2lvbk5vZGVzLm1hcCgoZGVjaXNpb25Ob2RlKT0+e1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9ucz0gW107XG4gICAgICAgICAgICBkZWNpc2lvbk5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuXG4gICAgICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhZWRnZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkRGVjaXNpb25zID0gdGhpcy5jb2xsZWN0KGVkZ2UuY2hpbGROb2RlKTsgLy9hbGwgcG9zc2libGUgY2hpbGQgZGVjaXNpb25zIChjYXJ0ZXNpYW4pXG4gICAgICAgICAgICAgICAgY2hpbGREZWNpc2lvbnMuZm9yRWFjaChjZD0+e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBpKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb25zLnB1c2goZGVjaXNpb24pO1xuICAgICAgICAgICAgICAgICAgICBkZWNpc2lvbi5jaGlsZHJlbiA9IGNkO1xuICAgICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9ucztcbiAgICAgICAgfSkpO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtEZWNpc2lvbn0gZnJvbSBcIi4vZGVjaXNpb25cIjtcblxuZXhwb3J0IGNsYXNzIFBvbGljeXtcbiAgICBpZDtcbiAgICBkZWNpc2lvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGlkLCBkZWNpc2lvbnMpe1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMuZGVjaXNpb25zID0gZGVjaXNpb25zIHx8IFtdO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyAucHVzaChkZWNpc2lvbik7XG4gICAgICAgIHRoaXMua2V5ID0gUG9saWN5LmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KHBvbGljeSl7XG4gICAgICAgIHZhciBrZXkgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+a2V5Kz0oa2V5PyBcIiZcIjogXCJcIikrZC5rZXkpO1xuICAgICAgICByZXR1cm4ga2V5O1xuICAgIH1cblxuICAgIGVxdWFscyhwb2xpY3ksIGlnbm9yZUlkPXRydWUpe1xuICAgICAgICBpZih0aGlzLmtleSAhPSBwb2xpY3kua2V5KXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpZ25vcmVJZCB8fCB0aGlzLmlkID09PSBwb2xpY3kuaWQ7XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS5nZXREZWNpc2lvbih0aGlzLCBkZWNpc2lvbk5vZGUpO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZXREZWNpc2lvbihwb2xpY3ksIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPHBvbGljeS5kZWNpc2lvbnMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gRGVjaXNpb24uZ2V0RGVjaXNpb24ocG9saWN5LmRlY2lzaW9uc1tpXSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmKGRlY2lzaW9uKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgc3RhdGljIHRvUG9saWN5U3RyaW5nKHBvbGljeSwgZXh0ZW5kZWQ9ZmFsc2UsIHByZXBlbmRJZD1mYWxzZSl7XG5cbiAgICAgICAgdmFyIHJlcyA9IFwiXCI7XG4gICAgICAgIHBvbGljeS5kZWNpc2lvbnMuZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihyZXMpe1xuICAgICAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICAgICAgcmVzICs9IFwiXFxuXCJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLCBleHRlbmRlZCwgJ25hbWUnLCAnXFx0Jyk7XG4gICAgICAgIH0pO1xuICAgICAgICBpZihwcmVwZW5kSWQgJiYgcG9saWN5LmlkIT09dW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBwb2xpY3kuaWQrXCIgXCIrcmVzO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfVxuXG5cbiAgICB0b1BvbGljeVN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gUG9saWN5LnRvUG9saWN5U3RyaW5nKHRoaXMsIGluZGVudClcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKkNvbXB1dGVkIGJhc2UgdmFsdWUgdmFsaWRhdG9yKi9cbmV4cG9ydCBjbGFzcyBQYXlvZmZWYWx1ZVZhbGlkYXRvcntcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmU9ZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSl7XG5cblxuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICB2YXIgbWF4U2FmZUludGVnZXIgPSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiB8fCA5MDA3MTk5MjU0NzQwOTkxOyAvLyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiBpbiB1bmRlZmluZWQgaW4gSUVcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgLW1heFNhZmVJbnRlZ2VyKSA+PSAwICYmIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgbWF4U2FmZUludGVnZXIpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUsIGVkZ2Upe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlLmNvbXBhcmUoMCkgPj0gMCAmJiB2YWx1ZS5jb21wYXJlKDEpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbCwgVmFsaWRhdGlvblJlc3VsdH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UGF5b2ZmVmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3BheW9mZi12YWx1ZS12YWxpZGF0b3JcIjtcblxuZXhwb3J0IGNsYXNzIFRyZWVWYWxpZGF0b3Ige1xuXG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5wcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yID0gbmV3IFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMucGF5b2ZmVmFsdWVWYWxpZGF0b3IgPSBuZXcgUGF5b2ZmVmFsdWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUobm9kZXMpIHtcblxuICAgICAgICB2YXIgdmFsaWRhdGlvblJlc3VsdCA9IG5ldyBWYWxpZGF0aW9uUmVzdWx0KCk7XG5cbiAgICAgICAgbm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgdGhpcy52YWxpZGF0ZU5vZGUobiwgdmFsaWRhdGlvblJlc3VsdCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB2YWxpZGF0aW9uUmVzdWx0O1xuICAgIH1cblxuICAgIHZhbGlkYXRlTm9kZShub2RlLCB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKSkge1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdpbmNvbXBsZXRlUGF0aCcsIG5vZGUpXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuICAgICAgICB2YXIgd2l0aEhhc2ggPSBmYWxzZTtcbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwcm9iYWJpbGl0eScsIHRydWUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHkgPSBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghRXhwcmVzc2lvbkVuZ2luZS5pc0hhc2goZS5wcm9iYWJpbGl0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3Ioe25hbWU6ICdpbnZhbGlkUHJvYmFiaWxpdHknLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwcm9iYWJpbGl0eScsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgcHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZS5wYXlvZmYuZm9yRWFjaCgocmF3UGF5b2ZmLCBwYXlvZmZJbmRleCk9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHBhdGggPSAncGF5b2ZmWycgKyBwYXlvZmZJbmRleCArICddJztcbiAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkocGF0aCwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGUuY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgcGF5b2ZmSW5kZXgpO1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3Ioe25hbWU6ICdpbnZhbGlkUGF5b2ZmJywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KHBhdGgsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgaWYgKGlzTmFOKHByb2JhYmlsaXR5U3VtKSB8fCAhcHJvYmFiaWxpdHlTdW0uZXF1YWxzKDEpKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcigncHJvYmFiaWxpdHlEb05vdFN1bVVwVG8xJywgbm9kZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuXG4gICAgICAgIHJldHVybiB2YWxpZGF0aW9uUmVzdWx0O1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vc3JjL2luZGV4J1xuIl19
