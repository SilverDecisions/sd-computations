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
    module.exports.default = module.exports;
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

var _mcdmWeightValueValidator = require("./validation/mcdm-weight-value-validator");

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
        this.mcdmWeightValueValidator = new _mcdmWeightValueValidator.McdmWeightValueValidator();
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

            return this.expressionEngine.serialize(_sdExpressionEngine.ExpressionEngine.divide(1, a));
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

            var weightValid = this.mcdmWeightValueValidator.validate(data.defaultCriterion1Weight);
            var multiCriteria = this.getCurrentRule().multiCriteria;

            data.getRoots().forEach(function (root) {
                var vr = _this3.treeValidator.validate(data.getAllNodesInSubtree(root));
                data.validationResults.push(vr);
                if (vr.isValid() && (!multiCriteria || weightValid)) {
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

},{"./expressions-evaluator":5,"./jobs/job-instance-manager":58,"./jobs/jobs-manager":60,"./objective/objective-rules-manager":61,"./operations/operations-manager":77,"./policies/policy":80,"./validation/mcdm-weight-value-validator":81,"./validation/tree-validator":84,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],4:[function(require,module,exports){
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
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("weightLowerBound", _jobParameterDefinition.PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", function (v, allVals) {
                return v >= 0 && v <= _jobParameterDefinition.JobParameterDefinition.computeNumberExpression(allVals['weightUpperBound']);
            }));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("weightUpperBound", _jobParameterDefinition.PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", function (v, allVals) {
                return v >= 0 && v >= _jobParameterDefinition.JobParameterDefinition.computeNumberExpression(allVals['weightLowerBound']);
            }));
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

            var prev2NotDominated = null;
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

                if (!prev2NotDominated) {
                    prev2NotDominated = arr[i - 2];
                }

                if (cmp(r.incratio, prev.incratio)) {
                    prev.incratio = null;
                    prev.extendedDominatedBy = [prev2NotDominated.id, r.id];
                    r.incratio = _this2.computeICER(r, prev2NotDominated);
                } else {
                    prev2NotDominated = prev;
                }
            });

            var weightLowerBound = params.value("weightLowerBound");
            var weightUpperBound = params.value("weightUpperBound");

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
                }),
                weightLowerBound: _sdExpressionEngine.ExpressionEngine.toFloat(weightLowerBound),
                weightUpperBound: _sdExpressionEngine.ExpressionEngine.toFloat(weightUpperBound)
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

},{"../../../../policies/policies-collector":79,"../../../../policies/policy":80,"../../../../validation/tree-validator":84,"../../../engine/job-status":51,"../../../engine/step":56,"sd-expression-engine":"sd-expression-engine"}],10:[function(require,module,exports){
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

},{"../../../validation/tree-validator":84,"../../engine/batch/batch-step":26,"../../engine/job":52,"../../engine/job-status":51,"../../engine/simple-job":53,"../../engine/step":56,"./recompute-job-parameters":10}],12:[function(require,module,exports){
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

},{"../../../../../policies/policy":80,"../../../../../validation/tree-validator":84,"../../../../engine/batch/batch-step":26,"../../../../engine/exceptions/job-computation-exception":29,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],15:[function(require,module,exports){
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

},{"../../../../../policies/policies-collector":79,"../../../../../policies/policy":80,"../../../../../validation/tree-validator":84,"../../../../engine/batch/batch-step":26,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],22:[function(require,module,exports){
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
"use strict";

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

var _sdUtils = require("sd-utils");

var _sdExpressionEngine = require("sd-expression-engine");

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

var JobParameterDefinition = function () {
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
        key: "set",
        value: function set(key, val) {
            this[key] = val;
            return this;
        }
    }, {
        key: "validate",
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
    }, {
        key: "validateSingleValue",

        // allValues - all values on the same level
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

            if (PARAMETER_TYPE.BOOLEAN === this.type && !_sdUtils.Utils.isBoolean(value)) {
                return false;
            }

            if (PARAMETER_TYPE.NUMBER_EXPRESSION === this.type) {
                value = JobParameterDefinition.computeNumberExpression(value);
                if (value === null) {
                    return false;
                }
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
    }, {
        key: "value",
        value: function value(_value) {
            if (PARAMETER_TYPE.NUMBER_EXPRESSION === this.type) {
                return JobParameterDefinition.computeNumberExpression(_value);
            }

            return _value;
        }
    }], [{
        key: "computeNumberExpression",
        value: function computeNumberExpression(val) {
            var parsed = parseFloat(val);
            if (parsed === Infinity || parsed === -Infinity) {
                return parsed;
            }

            if (!_sdExpressionEngine.ExpressionEngine.validate(val, {}, false)) {
                return null;
            }

            return _sdExpressionEngine.ExpressionEngine.eval(val, true);
        }
    }]);

    return JobParameterDefinition;
}();

exports.JobParameterDefinition = JobParameterDefinition;

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],45:[function(require,module,exports){
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
    }, {
        key: "getDefinition",
        value: function getDefinition(path) {
            var defs = this.definitions;
            var def = null;
            if (!path.split().every(function (name) {
                def = _sdUtils.Utils.find(defs, function (d) {
                    return d.name == name;
                });
                if (!def) {
                    return false;
                }
                defs = def.nestedParameters;
                return true;
            })) {
                return null;
            }
            return def;
        }

        /*get or set value by path*/

    }, {
        key: "value",
        value: function value(path, _value) {
            if (arguments.length === 1) {
                var def = this.getDefinition(path);
                var val = _sdUtils.Utils.get(this.values, path, null);
                if (def) {
                    return def.value(val);
                }
                return val;
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
                return r.setDefaultCriterion1Weight(defaultCriterion1Weight);
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
                    grandChildEdge.payoff = [_sdExpressionEngine.ExpressionEngine.add(rootClone.childEdges[j].computedBasePayoff(undefined, 0), rootClone.childEdges[j].childNode.childEdges[i].computedBasePayoff(undefined, 0)), _sdExpressionEngine.ExpressionEngine.add(rootClone.childEdges[j].computedBasePayoff(undefined, 1), rootClone.childEdges[j].childNode.childEdges[i].computedBasePayoff(undefined, 1))];

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

},{"../validation/tree-validator":84,"./operation":76,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],76:[function(require,module,exports){
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
exports.McdmWeightValueValidator = undefined;

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

var McdmWeightValueValidator = exports.McdmWeightValueValidator = function () {
    function McdmWeightValueValidator(additionalValidator) {
        _classCallCheck(this, McdmWeightValueValidator);

        this.additionalValidator = null;

        this.additionalValidator = additionalValidator;
    }

    _createClass(McdmWeightValueValidator, [{
        key: "validate",
        value: function validate(value) {
            if (value === null || value === undefined) {
                return false;
            }

            var parsed = parseFloat(value);
            if (parsed !== Infinity && !_sdExpressionEngine.ExpressionEngine.validate(value, {}, false)) {
                return false;
            }

            value = _sdExpressionEngine.ExpressionEngine.toNumber(value);
            var maxSafeInteger = Number.MAX_SAFE_INTEGER || 9007199254740991; // Number.MAX_SAFE_INTEGER is undefined in IE
            if (_sdExpressionEngine.ExpressionEngine.compare(value, 0) < 0 || value !== Infinity && _sdExpressionEngine.ExpressionEngine.compare(value, maxSafeInteger) > 0) {
                return false;
            }

            if (this.additionalValidator) {
                return this.additionalValidator(_sdExpressionEngine.ExpressionEngine.toNumber(value));
            }

            return true;
        }
    }]);

    return McdmWeightValueValidator;
}();

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],82:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],83:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],84:[function(require,module,exports){
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

},{"./payoff-value-validator":82,"./probability-value-validator":83,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],"sd-computations":[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmMvY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyYy9jb21wdXRhdGlvbnMtbWFuYWdlci5qcyIsInNyYy9jb21wdXRhdGlvbnMtdXRpbHMuanMiLCJzcmMvZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXAuanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9leHRlbmRhYmxlLWVycm9yLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmMvam9icy9lbmdpbmUvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItaW5zdGFuY2UuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWxhdW5jaGVyLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlc3VsdC5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2Itc3RhdHVzLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi5qcyIsInNyYy9qb2JzL2VuZ2luZS9zaW1wbGUtam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAuanMiLCJzcmMvam9icy9pbmRleC5qcyIsInNyYy9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjL2pvYnMvam9iLXdvcmtlci5qcyIsInNyYy9qb2JzL2pvYnMtbWFuYWdlci5qcyIsInNyYy9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvaW5kZXguanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21heC1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWF4LW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1heC1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9taW4tbWF4LXJ1bGUuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21pbi1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbXVsdGktY3JpdGVyaWEtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmMvb3BlcmF0aW9ucy9mbGlwLXN1YnRyZWUuanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb24uanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmMvcG9saWNpZXMvZGVjaXNpb24uanMiLCJzcmMvcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yLmpzIiwic3JjL3BvbGljaWVzL3BvbGljeS5qcyIsInNyYy92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyYy92YWxpZGF0aW9uL3BheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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OztBQ3pFTCwyQ0FBQTtpREFBQTs7Z0JBQUE7d0JBQUE7b0JBQUE7QUFBQTtBQUFBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiB0b0FycmF5KGFycikge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHJlcXVlc3Q7XG4gICAgdmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuICAgICAgcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG5cbiAgICBwLnJlcXVlc3QgPSByZXF1ZXN0O1xuICAgIHJldHVybiBwO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcbiAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgICAgICAgIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG4gICAgdGhpcy5faW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdtdWx0aUVudHJ5JyxcbiAgICAndW5pcXVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnZ2V0JyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcbiAgICB0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcbiAgICAnZGlyZWN0aW9uJyxcbiAgICAna2V5JyxcbiAgICAncHJpbWFyeUtleScsXG4gICAgJ3ZhbHVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcbiAgICAndXBkYXRlJyxcbiAgICAnZGVsZXRlJ1xuICBdKTtcblxuICAvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuICBbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgIEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjdXJzb3IgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgY3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcbiAgICB0aGlzLl9zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ2luZGV4TmFtZXMnLFxuICAgICdhdXRvSW5jcmVtZW50J1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAncHV0JyxcbiAgICAnYWRkJyxcbiAgICAnZGVsZXRlJyxcbiAgICAnY2xlYXInLFxuICAgICdnZXQnLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnZGVsZXRlSW5kZXgnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcbiAgICB0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcbiAgICAnb2JqZWN0U3RvcmVOYW1lcycsXG4gICAgJ21vZGUnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG4gICAgJ2Fib3J0J1xuICBdKTtcblxuICBmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgICB0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuICAgIHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICB9XG5cbiAgVXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2RlbGV0ZU9iamVjdFN0b3JlJyxcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIERCKGRiKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgfVxuXG4gIERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgLy8gQWRkIGN1cnNvciBpdGVyYXRvcnNcbiAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuICBbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcbiAgICBbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGVbZnVuY05hbWUucmVwbGFjZSgnb3BlbicsICdpdGVyYXRlJyldID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAgIHZhciBuYXRpdmVPYmplY3QgPSB0aGlzLl9zdG9yZSB8fCB0aGlzLl9pbmRleDtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuYXRpdmVPYmplY3RbZnVuY05hbWVdLmFwcGx5KG5hdGl2ZU9iamVjdCwgYXJncy5zbGljZSgwLCAtMSkpO1xuICAgICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIHBvbHlmaWxsIGdldEFsbFxuICBbSW5kZXgsIE9iamVjdFN0b3JlXS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgaWYgKENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwpIHJldHVybjtcbiAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsID0gZnVuY3Rpb24ocXVlcnksIGNvdW50KSB7XG4gICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgdmFyIGl0ZW1zID0gW107XG5cbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgIGluc3RhbmNlLml0ZXJhdGVDdXJzb3IocXVlcnksIGZ1bmN0aW9uKGN1cnNvcikge1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaXRlbXMucHVzaChjdXJzb3IudmFsdWUpO1xuXG4gICAgICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQgJiYgaXRlbXMubGVuZ3RoID09IGNvdW50KSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgdmFyIGV4cCA9IHtcbiAgICBvcGVuOiBmdW5jdGlvbihuYW1lLCB2ZXJzaW9uLCB1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnb3BlbicsIFtuYW1lLCB2ZXJzaW9uXSk7XG4gICAgICB2YXIgcmVxdWVzdCA9IHAucmVxdWVzdDtcblxuICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgdXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgICBtb2R1bGUuZXhwb3J0cy5kZWZhdWx0ID0gbW9kdWxlLmV4cG9ydHM7XG4gIH1cbiAgZWxzZSB7XG4gICAgc2VsZi5pZGIgPSBleHA7XG4gIH1cbn0oKSk7XG4iLCJpbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNNYW5hZ2VyfSBmcm9tIFwiLi9jb21wdXRhdGlvbnMtbWFuYWdlclwiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnfSBmcm9tIFwiLi9jb21wdXRhdGlvbnMtbWFuYWdlclwiO1xuXG5cblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc0VuZ2luZUNvbmZpZyBleHRlbmRzIENvbXB1dGF0aW9uc01hbmFnZXJDb25maWd7XG4gICAgbG9nTGV2ZWwgPSAnd2Fybic7XG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy9FbnRyeSBwb2ludCBjbGFzcyBmb3Igc3RhbmRhbG9uZSBjb21wdXRhdGlvbiB3b3JrZXJzXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlcntcblxuICAgIGdsb2JhbCA9IFV0aWxzLmdldEdsb2JhbE9iamVjdCgpO1xuICAgIGlzV29ya2VyID0gVXRpbHMuaXNXb3JrZXIoKTtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZywgZGF0YSl7XG4gICAgICAgIHN1cGVyKGNvbmZpZywgZGF0YSk7XG5cbiAgICAgICAgaWYodGhpcy5pc1dvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLnJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIoe1xuICAgICAgICAgICAgICAgIGJlZm9yZUpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYmVmb3JlSm9iJywgam9iRXhlY3V0aW9uLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAgICAgYWZ0ZXJKb2I6IChqb2JFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ2FmdGVySm9iJywgam9iRXhlY3V0aW9uLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgICAgICAgIHRoaXMucXVlcnlhYmxlRnVuY3Rpb25zID0ge1xuICAgICAgICAgICAgICAgIHJ1bkpvYjogZnVuY3Rpb24oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTyl7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMsIHNlcmlhbGl6ZWREYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5ydW5Kb2Ioam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBleGVjdXRlSm9iOiBmdW5jdGlvbihqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLmpvYnNNYW5nZXIuZXhlY3V0ZShqb2JFeGVjdXRpb25JZCkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucmVwbHkoJ2pvYkZhdGFsRXJyb3InLCBqb2JFeGVjdXRpb25JZCwgVXRpbHMuZ2V0RXJyb3JEVE8oZSkpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVjb21wdXRlOiBmdW5jdGlvbihkYXRhRFRPLCBydWxlTmFtZSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgICAgICAgICAgaWYocnVsZU5hbWUpe1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB2YXIgYWxsUnVsZXMgPSAhcnVsZU5hbWU7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkYXRhID0gbmV3IERhdGFNb2RlbChkYXRhRFRPKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UuX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYylcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgncmVjb21wdXRlZCcsIGRhdGEuZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGdsb2JhbC5vbm1lc3NhZ2UgPSBmdW5jdGlvbihvRXZlbnQpIHtcbiAgICAgICAgICAgICAgICBpZiAob0V2ZW50LmRhdGEgaW5zdGFuY2VvZiBPYmplY3QgJiYgb0V2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kJykgJiYgb0V2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5QXJndW1lbnRzJykpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucXVlcnlhYmxlRnVuY3Rpb25zW29FdmVudC5kYXRhLnF1ZXJ5TWV0aG9kXS5hcHBseShzZWxmLCBvRXZlbnQuZGF0YS5xdWVyeUFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UuZGVmYXVsdFJlcGx5KG9FdmVudC5kYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG5cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgc3VwZXIuc2V0Q29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuc2V0TG9nTGV2ZWwodGhpcy5jb25maWcubG9nTGV2ZWwpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBzZXRMb2dMZXZlbChsZXZlbCl7XG4gICAgICAgIGxvZy5zZXRMZXZlbChsZXZlbClcbiAgICB9XG5cbiAgICBkZWZhdWx0UmVwbHkobWVzc2FnZSkge1xuICAgICAgICB0aGlzLnJlcGx5KCd0ZXN0JywgbWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcmVwbHkoKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVwbHkgLSBub3QgZW5vdWdoIGFyZ3VtZW50cycpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZ2xvYmFsLnBvc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZExpc3RlbmVyJzogYXJndW1lbnRzWzBdLFxuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kQXJndW1lbnRzJzogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZXNNYW5hZ2VyfSBmcm9tIFwiLi9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXJcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtPcGVyYXRpb25zTWFuYWdlcn0gZnJvbSBcIi4vb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXJcIjtcbmltcG9ydCB7Sm9ic01hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9icy1tYW5hZ2VyXCI7XG5pbXBvcnQge0V4cHJlc3Npb25zRXZhbHVhdG9yfSBmcm9tIFwiLi9leHByZXNzaW9ucy1ldmFsdWF0b3JcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VNYW5hZ2VyfSBmcm9tIFwiLi9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge01jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vdmFsaWRhdGlvbi9tY2RtLXdlaWdodC12YWx1ZS12YWxpZGF0b3JcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcge1xuXG4gICAgbG9nTGV2ZWwgPSBudWxsO1xuXG4gICAgcnVsZU5hbWUgPSBudWxsO1xuICAgIHdvcmtlciA9IHtcbiAgICAgICAgZGVsZWdhdGVSZWNvbXB1dGF0aW9uOiBmYWxzZSxcbiAgICAgICAgdXJsOiBudWxsXG4gICAgfTtcbiAgICBqb2JSZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgIGNsZWFyUmVwb3NpdG9yeSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXIge1xuICAgIGRhdGE7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBvcGVyYXRpb25zTWFuYWdlcjtcbiAgICBqb2JzTWFuZ2VyO1xuXG4gICAgdHJlZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZywgZGF0YSA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gbmV3IEV4cHJlc3Npb25FbmdpbmUoKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IG5ldyBFeHByZXNzaW9uc0V2YWx1YXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG5ldyBPYmplY3RpdmVSdWxlc01hbmFnZXIodGhpcy5leHByZXNzaW9uRW5naW5lLCB0aGlzLmNvbmZpZy5ydWxlTmFtZSk7XG4gICAgICAgIHRoaXMub3BlcmF0aW9uc01hbmFnZXIgPSBuZXcgT3BlcmF0aW9uc01hbmFnZXIodGhpcy5kYXRhLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmpvYnNNYW5nZXIgPSBuZXcgSm9ic01hbmFnZXIodGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHtcbiAgICAgICAgICAgIHdvcmtlclVybDogdGhpcy5jb25maWcud29ya2VyLnVybCxcbiAgICAgICAgICAgIHJlcG9zaXRvcnlUeXBlOiB0aGlzLmNvbmZpZy5qb2JSZXBvc2l0b3J5VHlwZSxcbiAgICAgICAgICAgIGNsZWFyUmVwb3NpdG9yeTogdGhpcy5jb25maWcuY2xlYXJSZXBvc2l0b3J5XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvciA9IG5ldyBNY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudFJ1bGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5jdXJyZW50UnVsZTtcbiAgICB9XG5cbiAgICBmbGlwQ3JpdGVyaWEoZGF0YSl7XG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5yZXZlcnNlUGF5b2ZmcygpO1xuICAgICAgICBsZXQgdG1wID0gZGF0YS53ZWlnaHRMb3dlckJvdW5kO1xuICAgICAgICBkYXRhLndlaWdodExvd2VyQm91bmQgPSB0aGlzLmZsaXAoZGF0YS53ZWlnaHRVcHBlckJvdW5kKTtcbiAgICAgICAgZGF0YS53ZWlnaHRVcHBlckJvdW5kID0gdGhpcy5mbGlwKHRtcCk7XG4gICAgICAgIGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQgPSB0aGlzLmZsaXAoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmZsaXBSdWxlKCk7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZmFsc2UpO1xuICAgIH1cblxuICAgIGZsaXAoYSl7XG4gICAgICAgIGlmKGEgPT0gSW5maW5pdHkpe1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cblxuICAgICAgICBpZihhID09IDApe1xuICAgICAgICAgICAgcmV0dXJuIEluZmluaXR5O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgYSkpXG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgfVxuXG4gICAgcnVuSm9iKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIucnVuKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgZGF0YSB8fCB0aGlzLmRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKVxuICAgIH1cblxuICAgIHJ1bkpvYldpdGhJbnN0YW5jZU1hbmFnZXIobmFtZSwgam9iUGFyYW1zVmFsdWVzLCBqb2JJbnN0YW5jZU1hbmFnZXJDb25maWcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuSm9iKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcykudGhlbihqZT0+IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyKHRoaXMuam9ic01hbmdlciwgamUsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5ydWxlcztcbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgaXNSdWxlTmFtZShydWxlTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuaXNSdWxlTmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSkge1xuICAgICAgICB0aGlzLmNvbmZpZy5ydWxlTmFtZSA9IHJ1bGVOYW1lO1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3QpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9uc01hbmFnZXIub3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3QpO1xuICAgIH1cblxuICAgIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoYWxsUnVsZXMsIGV2YWxDb2RlID0gZmFsc2UsIGV2YWxOdW1lcmljID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbmZpZy53b3JrZXIuZGVsZWdhdGVSZWNvbXB1dGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgZXZhbENvZGU6IGV2YWxDb2RlLFxuICAgICAgICAgICAgICAgICAgICBldmFsTnVtZXJpYzogZXZhbE51bWVyaWNcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmICghYWxsUnVsZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnJ1bGVOYW1lID0gdGhpcy5nZXRDdXJyZW50UnVsZSgpLm5hbWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihcInJlY29tcHV0ZVwiLCBwYXJhbXMsIHRoaXMuZGF0YSwgZmFsc2UpLnRoZW4oKGpvYkV4ZWN1dGlvbik9PiB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkID0gam9iRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kYXRhLnVwZGF0ZUZyb20oZClcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUodGhpcy5kYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlRGlzcGxheVZhbHVlcyh0aGlzLmRhdGEpO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlID0gZmFsc2UsIGV2YWxOdW1lcmljID0gdHJ1ZSkge1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnVwZGF0ZURlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpO1xuICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzID0gW107XG5cbiAgICAgICAgaWYgKGV2YWxDb2RlIHx8IGV2YWxOdW1lcmljKSB7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHdlaWdodFZhbGlkID0gdGhpcy5tY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIHZhciBtdWx0aUNyaXRlcmlhID0gdGhpcy5nZXRDdXJyZW50UnVsZSgpLm11bHRpQ3JpdGVyaWE7XG5cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkgJiYgKCFtdWx0aUNyaXRlcmlhIHx8IHdlaWdodFZhbGlkKSkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvL0NoZWNrcyB2YWxpZGl0eSBvZiBkYXRhIG1vZGVsIHdpdGhvdXQgcmVjb21wdXRhdGlvbiBhbmQgcmV2YWxpZGF0aW9uXG4gICAgaXNWYWxpZChkYXRhKSB7XG4gICAgICAgIHZhciBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIHJldHVybiBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLmV2ZXJ5KHZyPT52ci5pc1ZhbGlkKCkpO1xuICAgIH1cblxuICAgIHVwZGF0ZURpc3BsYXlWYWx1ZXMoZGF0YSwgcG9saWN5VG9EaXNwbGF5ID0gbnVsbCkge1xuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGlmIChwb2xpY3lUb0Rpc3BsYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRpc3BsYXlQb2xpY3koZGF0YSwgcG9saWN5VG9EaXNwbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVOb2RlRGlzcGxheVZhbHVlcyhuKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVFZGdlRGlzcGxheVZhbHVlcyhlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB1cGRhdGVOb2RlRGlzcGxheVZhbHVlcyhub2RlKSB7XG4gICAgICAgIG5vZGUuJERJU1BMQVlfVkFMVUVfTkFNRVMuZm9yRWFjaChuPT5ub2RlLmRpc3BsYXlWYWx1ZShuLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXROb2RlRGlzcGxheVZhbHVlKG5vZGUsIG4pKSk7XG4gICAgfVxuXG4gICAgdXBkYXRlRWRnZURpc3BsYXlWYWx1ZXMoZSkge1xuICAgICAgICBlLiRESVNQTEFZX1ZBTFVFX05BTUVTLmZvckVhY2gobj0+ZS5kaXNwbGF5VmFsdWUobiwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuKSkpO1xuICAgIH1cblxuICAgIGRpc3BsYXlQb2xpY3kocG9saWN5VG9EaXNwbGF5LCBkYXRhKSB7XG5cblxuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgbi5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgZS5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKChyb290KT0+dGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShyb290LCBwb2xpY3lUb0Rpc3BsYXkpKTtcbiAgICB9XG5cbiAgICBkaXNwbGF5UG9saWN5Rm9yTm9kZShub2RlLCBwb2xpY3kpIHtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbihwb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhkZWNpc2lvbiwgbm9kZSwgcG9saWN5KTtcbiAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgIG5vZGUuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICB2YXIgY2hpbGRFZGdlID0gbm9kZS5jaGlsZEVkZ2VzW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgICAgIGNoaWxkRWRnZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGNoaWxkRWRnZS5jaGlsZE5vZGUsIHBvbGljeSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PnRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUoZS5jaGlsZE5vZGUsIHBvbGljeSkpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNVdGlsc3tcblxuICAgIHN0YXRpYyBzZXF1ZW5jZShtaW4sIG1heCwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBleHRlbnQgPSBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KG1heCwgbWluKTtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFttaW5dO1xuICAgICAgICB2YXIgc3RlcHMgPSBsZW5ndGggLSAxO1xuICAgICAgICBpZighc3RlcHMpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGV4dGVudCxsZW5ndGggLSAxKTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoIC0gMjsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoY3Vyciwgc3RlcCk7XG4gICAgICAgICAgICByZXN1bHQucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoY3VycikpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdC5wdXNoKG1heCk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qRXZhbHVhdGVzIGNvZGUgYW5kIGV4cHJlc3Npb25zIGluIHRyZWVzKi9cbmV4cG9ydCBjbGFzcyBFeHByZXNzaW9uc0V2YWx1YXRvciB7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBjbGVhcihkYXRhKXtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGUuY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhclRyZWUoZGF0YSwgcm9vdCl7XG4gICAgICAgIGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIG4uY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlPXRydWUsIGV2YWxOdW1lcmljPXRydWUsIGluaXRTY29wZXM9ZmFsc2Upe1xuICAgICAgICBsb2cuZGVidWcoJ2V2YWxFeHByZXNzaW9ucyBldmFsQ29kZTonK2V2YWxDb2RlKycgZXZhbE51bWVyaWM6JytldmFsTnVtZXJpYyk7XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIHRoaXMuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyVHJlZShkYXRhLCBuKTtcbiAgICAgICAgICAgIHRoaXMuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBuLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsaW5pdFNjb3Blcyk7XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgZXZhbEdsb2JhbENvZGUoZGF0YSl7XG4gICAgICAgIGRhdGEuY2xlYXJFeHByZXNzaW9uU2NvcGUoKTtcbiAgICAgICAgZGF0YS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgIHRyeXtcbiAgICAgICAgICAgIGRhdGEuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChkYXRhLmNvZGUsIGZhbHNlLCBkYXRhLmV4cHJlc3Npb25TY29wZSk7XG4gICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBub2RlLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGU9ZmFsc2UpIHtcbiAgICAgICAgaWYoIW5vZGUuZXhwcmVzc2lvblNjb3BlIHx8IGluaXRTY29wZSB8fCBldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoZXZhbENvZGUpe1xuICAgICAgICAgICAgbm9kZS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgICAgICBpZihub2RlLmNvZGUpe1xuICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS4kY29kZUVycm9yID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwobm9kZS5jb2RlLCBmYWxzZSwgbm9kZS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICAgICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IGU7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZihldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB2YXIgc2NvcGUgPSBub2RlLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bT1FeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuICAgICAgICAgICAgdmFyIGhhc2hFZGdlcz0gW107XG4gICAgICAgICAgICB2YXIgaW52YWxpZFByb2IgPSBmYWxzZTtcblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIGUucGF5b2ZmLmZvckVhY2goKHJhd1BheW9mZiwgcGF5b2ZmSW5kZXgpPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgcGF0aCA9ICdwYXlvZmZbJyArIHBheW9mZkluZGV4ICsgJ10nO1xuICAgICAgICAgICAgICAgICAgICBpZihlLmlzRmllbGRWYWxpZChwYXRoLCB0cnVlLCBmYWxzZSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCBwYXRoLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbFBheW9mZihlLCBwYXlvZmZJbmRleCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9Y2F0Y2ggKGVycil7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBMZWZ0IGVtcHR5IGludGVudGlvbmFsbHlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG5cblxuICAgICAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5pc0hhc2goZS5wcm9iYWJpbGl0eSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFzaEVkZ2VzLnB1c2goZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmhhc0Fzc2lnbm1lbnRFeHByZXNzaW9uKGUucHJvYmFiaWxpdHkpKXsgLy9JdCBzaG91bGQgbm90IG9jY3VyIGhlcmUhXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2cud2FybihcImV2YWxFeHByZXNzaW9uc0Zvck5vZGUgaGFzQXNzaWdubWVudEV4cHJlc3Npb24hXCIsIGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBpZihlLmlzRmllbGRWYWxpZCgncHJvYmFiaWxpdHknLCB0cnVlLCBmYWxzZSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBwcm9iID0gdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwoZS5wcm9iYWJpbGl0eSwgdHJ1ZSwgc2NvcGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncHJvYmFiaWxpdHknLCBwcm9iKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBwcm9iKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1jYXRjaCAoZXJyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnZhbGlkUHJvYiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICAgICAgaW52YWxpZFByb2IgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9KTtcblxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgdmFyIGNvbXB1dGVIYXNoID0gaGFzaEVkZ2VzLmxlbmd0aCAmJiAhaW52YWxpZFByb2IgJiYgKHByb2JhYmlsaXR5U3VtLmNvbXBhcmUoMCkgPj0gMCAmJiBwcm9iYWJpbGl0eVN1bS5jb21wYXJlKDEpIDw9IDApO1xuXG4gICAgICAgICAgICAgICAgaWYoY29tcHV0ZUhhc2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhhc2ggPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KDEsIHByb2JhYmlsaXR5U3VtKSwgaGFzaEVkZ2VzLmxlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgIGhhc2hFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3Byb2JhYmlsaXR5JywgaGFzaCk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBlLmNoaWxkTm9kZSwgZXZhbENvZGUsIGV2YWxOdW1lcmljLCBpbml0U2NvcGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0U2NvcGVGb3JOb2RlKGRhdGEsIG5vZGUpe1xuICAgICAgICB2YXIgcGFyZW50ID0gbm9kZS4kcGFyZW50O1xuICAgICAgICB2YXIgcGFyZW50U2NvcGUgPSBwYXJlbnQ/cGFyZW50LmV4cHJlc3Npb25TY29wZSA6IGRhdGEuZXhwcmVzc2lvblNjb3BlO1xuICAgICAgICBub2RlLmV4cHJlc3Npb25TY29wZSA9IFV0aWxzLmNsb25lRGVlcChwYXJlbnRTY29wZSk7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9jb21wdXRhdGlvbnMtZW5naW5lJ1xuZXhwb3J0ICogZnJvbSAnLi9jb21wdXRhdGlvbnMtbWFuYWdlcidcbmV4cG9ydCAqIGZyb20gJy4vZXhwcmVzc2lvbnMtZXZhbHVhdG9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2JzL2luZGV4J1xuXG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcblxuZXhwb3J0IGNsYXNzIExlYWd1ZVRhYmxlSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ3ZWlnaHRMb3dlckJvdW5kXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCAodiwgYWxsVmFscykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHYgPj0gMCAmJiB2IDw9IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24oYWxsVmFsc1snd2VpZ2h0VXBwZXJCb3VuZCddKVxuICAgICAgICB9KSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIndlaWdodFVwcGVyQm91bmRcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdiA+PSAwICYmIHYgPj0gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbihhbGxWYWxzWyd3ZWlnaHRMb3dlckJvdW5kJ10pXG4gICAgICAgIH0pKTtcblxuICAgIH1cblxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIG5hbWVPZkNyaXRlcmlvbjE6ICdDb3N0JyxcbiAgICAgICAgICAgIG5hbWVPZkNyaXRlcmlvbjI6ICdFZmZlY3QnLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIHdlaWdodExvd2VyQm91bmQ6IDAsXG4gICAgICAgICAgICB3ZWlnaHRVcHBlckJvdW5kOiBJbmZpbml0eSxcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVyc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBMZWFndWVUYWJsZUpvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwibGVhZ3VlLXRhYmxlXCIsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmluaXRTdGVwcygpO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpIHtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwID0gbmV3IENhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIHRoaXMuYWRkU3RlcCh0aGlzLmNhbGN1bGF0ZVN0ZXApO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgTGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycywgd2l0aEhlYWRlcnMgPSB0cnVlKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgICAgaWYgKHdpdGhIZWFkZXJzKSB7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5X2lkJywgJ3BvbGljeScsIGpvYlJlc3VsdC5wYXlvZmZOYW1lc1swXSwgam9iUmVzdWx0LnBheW9mZk5hbWVzWzFdLCAnZG9taW5hdGVkX2J5JywgJ2V4dGVuZGVkLWRvbWluYXRlZF9ieScsICdpbmNyYXRpbyddO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goaGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICByb3cucG9saWNpZXMuZm9yRWFjaChwb2xpY3k9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW1xuICAgICAgICAgICAgICAgICAgICByb3cuaWQsXG4gICAgICAgICAgICAgICAgICAgIFBvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3ksIGpvYlBhcmFtZXRlcnMudmFsdWVzLmV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb24pLFxuICAgICAgICAgICAgICAgICAgICByb3cucGF5b2Zmc1sxXSxcbiAgICAgICAgICAgICAgICAgICAgcm93LnBheW9mZnNbMF0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5kb21pbmF0ZWRCeSxcbiAgICAgICAgICAgICAgICAgICAgcm93LmV4dGVuZGVkRG9taW5hdGVkQnkgPT09IG51bGwgPyBudWxsIDogcm93LmV4dGVuZGVkRG9taW5hdGVkQnlbMF0gKyAnLCAnICsgcm93LmV4dGVuZGVkRG9taW5hdGVkQnlbMV0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5pbmNyYXRpb1xuICAgICAgICAgICAgICAgIF07XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2gocm93Q2VsbHMpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgbGV0IHJ1bGUgPSB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5jdXJyZW50UnVsZTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuXG5cbiAgICAgICAgdmFyIHBheW9mZkNvZWZmcyA9IHRoaXMucGF5b2ZmQ29lZmZzID0gcnVsZS5wYXlvZmZDb2VmZnM7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSk7XG4gICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG5cbiAgICAgICAgaWYgKCF2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGNvbXBhcmUgPSAoYSwgYik9PigtcGF5b2ZmQ29lZmZzWzBdICogIChiLnBheW9mZnNbMF0gLSBhLnBheW9mZnNbMF0pKSB8fCAoLXBheW9mZkNvZWZmc1sxXSAqICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSk7XG5cbiAgICAgICAgdmFyIHJvd3MgPSBwb2xpY2llcy5tYXAocG9saWN5ID0+IHtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBwb2xpY2llczogW3BvbGljeV0sXG4gICAgICAgICAgICAgICAgcGF5b2ZmczogdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpLnNsaWNlKCksXG4gICAgICAgICAgICAgICAgZG9taW5hdGVkQnk6IG51bGwsXG4gICAgICAgICAgICAgICAgZXh0ZW5kZWREb21pbmF0ZWRCeTogbnVsbCxcbiAgICAgICAgICAgICAgICBpbmNyYXRpbzogbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICB9KS5zb3J0KGNvbXBhcmUpO1xuXG4gICAgICAgIHJvd3MgPSByb3dzLnJlZHVjZSgocHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlLCBpbmRleCwgYXJyYXkpPT57XG4gICAgICAgICAgICBpZighcHJldmlvdXNWYWx1ZS5sZW5ndGgpe1xuICAgICAgICAgICAgICAgIHJldHVybiBbY3VycmVudFZhbHVlXVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgcHJldiA9IHByZXZpb3VzVmFsdWVbcHJldmlvdXNWYWx1ZS5sZW5ndGgtMV07XG4gICAgICAgICAgICBpZihjb21wYXJlKHByZXYsIGN1cnJlbnRWYWx1ZSkgPT0gMCl7XG4gICAgICAgICAgICAgICAgcHJldi5wb2xpY2llcy5wdXNoKC4uLmN1cnJlbnRWYWx1ZS5wb2xpY2llcyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByZXZpb3VzVmFsdWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBwcmV2aW91c1ZhbHVlLmNvbmNhdChjdXJyZW50VmFsdWUpXG4gICAgICAgIH0sIFtdKTtcblxuICAgICAgICByb3dzLnNvcnQoKGEsIGIpPT4ocGF5b2ZmQ29lZmZzWzBdICogIChhLnBheW9mZnNbMF0gLSBiLnBheW9mZnNbMF0pKSB8fCAoLXBheW9mZkNvZWZmc1sxXSAqICAgKGEucGF5b2Zmc1sxXSAtIGIucGF5b2Zmc1sxXSkpKTtcbiAgICAgICAgcm93cy5mb3JFYWNoKChyLCBpKT0+IHtcbiAgICAgICAgICAgIHIuaWQgPSBpKzE7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyByb3dzLnNvcnQoY29tcGFyZSk7XG4gICAgICAgIHJvd3Muc29ydCgoYSwgYik9PigtcGF5b2ZmQ29lZmZzWzBdICogIChhLnBheW9mZnNbMF0gLSBiLnBheW9mZnNbMF0pKSB8fCAoLXBheW9mZkNvZWZmc1sxXSAqICAgKGEucGF5b2Zmc1sxXSAtIGIucGF5b2Zmc1sxXSkpKTtcblxuICAgICAgICBsZXQgYmVzdENvc3QgPSAtcGF5b2ZmQ29lZmZzWzFdICogSW5maW5pdHksXG4gICAgICAgICAgICBiZXN0Q29zdFJvdyA9IG51bGw7XG5cbiAgICAgICAgbGV0IGNtcD0gKGEsIGIpID0+IGEgPiBiO1xuICAgICAgICBpZihwYXlvZmZDb2VmZnNbMV08MCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgociwgaSk9PiB7XG4gICAgICAgICAgICBpZiAoY21wKHIucGF5b2Zmc1sxXSwgYmVzdENvc3QpKSB7XG4gICAgICAgICAgICAgICAgYmVzdENvc3QgPSByLnBheW9mZnNbMV07XG4gICAgICAgICAgICAgICAgYmVzdENvc3RSb3cgPSByO1xuICAgICAgICAgICAgfSBlbHNlIGlmKGJlc3RDb3N0Um93KSB7XG4gICAgICAgICAgICAgICAgci5kb21pbmF0ZWRCeSA9IGJlc3RDb3N0Um93LmlkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgaWYocGF5b2ZmQ29lZmZzWzBdID4gMCAmJiBwYXlvZmZDb2VmZnNbMV0gPCAwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9ZWxzZSBpZihwYXlvZmZDb2VmZnNbMF0gPCAwICYmIHBheW9mZkNvZWZmc1sxXSA+IDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1lbHNlIGlmKHBheW9mZkNvZWZmc1sxXTwwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPiBiO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZXYyTm90RG9taW5hdGVkID0gbnVsbDtcbiAgICAgICAgcm93cy5maWx0ZXIocj0+IXIuZG9taW5hdGVkQnkpLnNvcnQoKGEsIGIpPT4oICBwYXlvZmZDb2VmZnNbMF0gKiAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkpLmZvckVhY2goKHIsIGksIGFycik9PiB7XG4gICAgICAgICAgICBpZiAoaSA9PSAwKSB7XG4gICAgICAgICAgICAgICAgci5pbmNyYXRpbyA9IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgcHJldiA9IGFycltpIC0gMV07XG5cbiAgICAgICAgICAgIHIuaW5jcmF0aW8gPSB0aGlzLmNvbXB1dGVJQ0VSKHIsIHByZXYpO1xuICAgICAgICAgICAgaWYgKGkgPCAyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZighcHJldjJOb3REb21pbmF0ZWQpe1xuICAgICAgICAgICAgICAgIHByZXYyTm90RG9taW5hdGVkID0gYXJyW2kgLSAyXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoY21wKHIuaW5jcmF0aW8scHJldi5pbmNyYXRpbykpe1xuICAgICAgICAgICAgICAgIHByZXYuaW5jcmF0aW8gPSBudWxsO1xuICAgICAgICAgICAgICAgIHByZXYuZXh0ZW5kZWREb21pbmF0ZWRCeSA9IFtwcmV2Mk5vdERvbWluYXRlZC5pZCwgci5pZF0gO1xuICAgICAgICAgICAgICAgIHIuaW5jcmF0aW8gPSB0aGlzLmNvbXB1dGVJQ0VSKHIsIHByZXYyTm90RG9taW5hdGVkKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHByZXYyTm90RG9taW5hdGVkID0gcHJldjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHdlaWdodExvd2VyQm91bmQgPSBwYXJhbXMudmFsdWUoXCJ3ZWlnaHRMb3dlckJvdW5kXCIpO1xuICAgICAgICBsZXQgd2VpZ2h0VXBwZXJCb3VuZCA9IHBhcmFtcy52YWx1ZShcIndlaWdodFVwcGVyQm91bmRcIik7XG5cbiAgICAgICAgLy9tYXJrIG9wdGltYWwgZm9yIHdlaWdodCBpbiBbd2VpZ2h0TG93ZXJCb3VuZCwgd2VpZ2h0VXBwZXJCb3VuZF1cbiAgICAgICAgbGV0IGxhc3RMRUxvd2VyID0gbnVsbDtcbiAgICAgICAgcm93cy5zbGljZSgpLmZpbHRlcihyPT4hci5kb21pbmF0ZWRCeSAmJiAhci5leHRlbmRlZERvbWluYXRlZEJ5KS5zb3J0KChhLCBiKSA9PiBhLmluY3JhdGlvIC0gYi5pbmNyYXRpbykuZm9yRWFjaCgocm93LCBpLCBhcnIpPT57XG5cbiAgICAgICAgICAgIGlmKHJvdy5pbmNyYXRpbyA8PSB3ZWlnaHRMb3dlckJvdW5kKXtcbiAgICAgICAgICAgICAgICBsYXN0TEVMb3dlciAgPSByb3c7XG4gICAgICAgICAgICB9ZWxzZSBpZihyb3cuaW5jcmF0aW8gPT0gd2VpZ2h0TG93ZXJCb3VuZCl7XG4gICAgICAgICAgICAgICAgbGFzdExFTG93ZXIgPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb3cub3B0aW1hbCA9IHJvdy5pbmNyYXRpbyA+PSB3ZWlnaHRMb3dlckJvdW5kICYmIHJvdy5pbmNyYXRpbyA8PSB3ZWlnaHRVcHBlckJvdW5kO1xuXG4gICAgICAgIH0pO1xuICAgICAgICBpZihsYXN0TEVMb3dlcil7XG4gICAgICAgICAgICBsYXN0TEVMb3dlci5vcHRpbWFsID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJvd3MuZm9yRWFjaChyb3c9PntcbiAgICAgICAgICAgIHJvdy5wYXlvZmZzWzBdID0gIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cucGF5b2Zmc1swXSk7XG4gICAgICAgICAgICByb3cucGF5b2Zmc1sxXSA9ICBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LnBheW9mZnNbMV0pO1xuICAgICAgICAgICAgcm93LmluY3JhdGlvID0gcm93LmluY3JhdGlvID09PSBudWxsID8gbnVsbCA6IEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cuaW5jcmF0aW8pO1xuICAgICAgICB9KTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YSA9IHtcbiAgICAgICAgICAgIHBheW9mZk5hbWVzOiBkYXRhLnBheW9mZk5hbWVzLnNsaWNlKCksXG4gICAgICAgICAgICBwYXlvZmZDb2VmZnMgOiBwYXlvZmZDb2VmZnMsXG4gICAgICAgICAgICByb3dzOiByb3dzLnNvcnQoKGEsIGIpPT4oYS5pZCAtIGIuaWQpKSxcbiAgICAgICAgICAgIHdlaWdodExvd2VyQm91bmQ6IEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh3ZWlnaHRMb3dlckJvdW5kKSxcbiAgICAgICAgICAgIHdlaWdodFVwcGVyQm91bmQ6IEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh3ZWlnaHRVcHBlckJvdW5kKVxuICAgICAgICB9O1xuXG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNvbXB1dGVJQ0VSKHIsIHByZXYpe1xuICAgICAgICBsZXQgZCA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzBdLCBwcmV2LnBheW9mZnNbMF0pO1xuICAgICAgICBsZXQgbiA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzFdLCBwcmV2LnBheW9mZnNbMV0pO1xuICAgICAgICBpZiAoZCA9PSAwKXtcbiAgICAgICAgICAgIGlmKG48MCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0gSW5maW5pdHk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE1hdGguYWJzKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKG4sIGQpKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDApKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXZhbENvZGVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsTnVtZXJpY1wiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIHJ1bGVOYW1lOiBudWxsLCAvL3JlY29tcHV0ZSBhbGwgcnVsZXNcbiAgICAgICAgICAgIGV2YWxDb2RlOiB0cnVlLFxuICAgICAgICAgICAgZXZhbE51bWVyaWM6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9yZWNvbXB1dGUtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYlwiO1xuXG5leHBvcnQgY2xhc3MgUmVjb21wdXRlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJyZWNvbXB1dGVcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuaXNSZXN0YXJ0YWJsZSA9IGZhbHNlO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGRhdGEgPSBleGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnM7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgYWxsUnVsZXMgPSAhcnVsZU5hbWU7XG4gICAgICAgIGlmKHJ1bGVOYW1lKXtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIHBhcmFtcy52YWx1ZShcImV2YWxDb2RlXCIpLCBwYXJhbXMudmFsdWUoXCJldmFsTnVtZXJpY1wiKSlcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cyA9IFtdO1xuXG4gICAgICAgIGlmKGV2YWxDb2RlfHxldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gocm9vdD0+IHtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpKTtcbiAgICAgICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMucHVzaCh2cik7XG4gICAgICAgICAgICBpZiAodnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUmVjb21wdXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDIpLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDwgdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cblxuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplPTUpIHtcbiAgICAgICAgc3VwZXIoXCJzZW5zaXRpdml0eS1hbmFseXNpc1wiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5iYXRjaFNpemUgPSA1O1xuICAgICAgICB0aGlzLmluaXRTdGVwcygpO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpe1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwID0gbmV3IENhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc2V0QmF0Y2hTaXplKGJhdGNoU2l6ZSl7XG4gICAgICAgIHRoaXMuYmF0Y2hTaXplID0gYmF0Y2hTaXplO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAuY2h1bmtTaXplID0gYmF0Y2hTaXplO1xuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzPXRydWUpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmKHdpdGhIZWFkZXJzKXtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3lfbnVtYmVyJywgJ3BvbGljeSddO1xuICAgICAgICAgICAgam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMuZm9yRWFjaChuPT5oZWFkZXJzLnB1c2gobikpO1xuICAgICAgICAgICAgaGVhZGVycy5wdXNoKCdwYXlvZmYnKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJvdW5kVmFyaWFibGVzID0gISFqb2JQYXJhbWV0ZXJzLnZhbHVlcy5yb3VuZFZhcmlhYmxlcztcbiAgICAgICAgaWYocm91bmRWYXJpYWJsZXMpe1xuICAgICAgICAgICAgdGhpcy5yb3VuZFZhcmlhYmxlcyhqb2JSZXN1bHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgdmFyIHBvbGljeSA9IGpvYlJlc3VsdC5wb2xpY2llc1tyb3cucG9saWN5SW5kZXhdO1xuICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW3Jvdy5wb2xpY3lJbmRleCsxLCBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKV07XG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2godj0+IHJvd0NlbGxzLnB1c2godikpO1xuICAgICAgICAgICAgcm93Q2VsbHMucHVzaChyb3cucGF5b2ZmKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcblxuICAgICAgICAgICAgaWYocm93Ll92YXJpYWJsZXMpeyAvL3JldmVydCBvcmlnaW5hbCB2YXJpYWJsZXNcbiAgICAgICAgICAgICAgICByb3cudmFyaWFibGVzID0gcm93Ll92YXJpYWJsZXM7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHJvdy5fdmFyaWFibGVzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJvdW5kVmFyaWFibGVzKGpvYlJlc3VsdCl7XG4gICAgICAgIHZhciB1bmlxdWVWYWx1ZXMgPSBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5tYXAoKCk9Pm5ldyBTZXQoKSk7XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93Ll92YXJpYWJsZXMgPSByb3cudmFyaWFibGVzLnNsaWNlKCk7IC8vIHNhdmUgb3JpZ2luYWwgcm93IHZhcmlhYmxlc1xuICAgICAgICAgICAgcm93LnZhcmlhYmxlcy5mb3JFYWNoKCh2LGkpPT4ge1xuICAgICAgICAgICAgICAgIHVuaXF1ZVZhbHVlc1tpXS5hZGQodilcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdW5pcXVlVmFsdWVzTm8gPSB1bmlxdWVWYWx1ZXMubWFwKChzKT0+cy5zaXplKTtcbiAgICAgICAgdmFyIG1heFByZWNpc2lvbiA9IDE0O1xuICAgICAgICB2YXIgcHJlY2lzaW9uID0gMjtcbiAgICAgICAgdmFyIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcyA9IGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLm1hcCgodixpKT0+aSk7XG4gICAgICAgIHdoaWxlKHByZWNpc2lvbjw9bWF4UHJlY2lzaW9uICYmIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdW5pcXVlVmFsdWVzID0gbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLm1hcCgoKT0+bmV3IFNldCgpKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgICAgICBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMuZm9yRWFjaCgodmFyaWFibGVJbmRleCwgbm90UmVhZHlJbmRleCk9PntcblxuICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gcm93Ll92YXJpYWJsZXNbdmFyaWFibGVJbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHZhbCA9IFV0aWxzLnJvdW5kKHZhbCwgcHJlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlVmFsdWVzW25vdFJlYWR5SW5kZXhdLmFkZCh2YWwpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZXNbdmFyaWFibGVJbmRleF0gPSB2YWw7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgbmV3UmVhZHlJbmRleGVzID0gW107XG4gICAgICAgICAgICB1bmlxdWVWYWx1ZXMuZm9yRWFjaCgodW5pcXVlVmFscywgbm90UmVhZHlJbmRleCk9PntcbiAgICAgICAgICAgICAgICB2YXIgb3JpZ1VuaXF1ZUNvdW50ID0gdW5pcXVlVmFsdWVzTm9bbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzW25vdFJlYWR5SW5kZXhdXSA7XG4gICAgICAgICAgICAgICAgaWYob3JpZ1VuaXF1ZUNvdW50PT11bmlxdWVWYWxzLnNpemUpeyAvL3JlYWR5IGluIHByZXZpb3VzIGl0ZXJhdGlvblxuICAgICAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMucHVzaChub3RSZWFkeUluZGV4KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmKG5ld1JlYWR5SW5kZXhlcy5sZW5ndGgpIHsgLy9yZXZlcnQgdmFsdWVzIHRvIHByZXYgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgbmV3UmVhZHlJbmRleGVzLnJldmVyc2UoKTtcbiAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMuZm9yRWFjaChub3RSZWFkeUluZGV4PT57XG4gICAgICAgICAgICAgICAgICAgIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5zcGxpY2Uobm90UmVhZHlJbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHByZWNpc2lvbisrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSkge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cblxuICAgICAgICBpZiAoIWpvYlJlc3VsdC5kYXRhLnJvd3MpIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MgPSBbXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMgPSB2YXJpYWJsZU5hbWVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0pIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGZhaWxPbkludmFsaWRUcmVlID0gcGFyYW1zLnZhbHVlKFwiZmFpbE9uSW52YWxpZFRyZWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2YXJpYWJsZU5hbWUsIGkpPT4ge1xuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IGl0ZW1baV07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG5cbiAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgIGlmKCF2YWxpZCAmJiBmYWlsT25JbnZhbGlkVHJlZSl7XG4gICAgICAgICAgICBsZXQgZXJyb3JEYXRhID0ge1xuICAgICAgICAgICAgICAgIHZhcmlhYmxlczoge31cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2goKHZhcmlhYmxlTmFtZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1t2YXJpYWJsZU5hbWVdID0gaXRlbVtpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uKFwiY29tcHV0YXRpb25zXCIsIGVycm9yRGF0YSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwYXlvZmZzID0gW107XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaChwb2xpY3k9PiB7XG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gJ24vYSc7XG4gICAgICAgICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgICAgICBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJylbMF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXlvZmZzLnB1c2gocGF5b2ZmKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgIHZhcmlhYmxlczogaXRlbSxcbiAgICAgICAgICAgIHBheW9mZnM6IHBheW9mZnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbiA9IHBhcmFtcy52YWx1ZShcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIik7XG5cbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtPT4ge1xuICAgICAgICAgICAgaWYgKCFpdGVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksIGkpPT4ge1xuICAgICAgICAgICAgICAgIHZhciB2YXJpYWJsZXMgPSBpdGVtLnZhcmlhYmxlcy5tYXAodiA9PiB0aGlzLnRvRmxvYXQodikpO1xuXG4gICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGl0ZW0ucGF5b2Zmc1tpXTtcbiAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICBwb2xpY3lJbmRleDogaSxcbiAgICAgICAgICAgICAgICAgICAgdmFyaWFibGVzOiB2YXJpYWJsZXMsXG4gICAgICAgICAgICAgICAgICAgIHBheW9mZjogVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSA/IHBheW9mZiA6IHRoaXMudG9GbG9hdChwYXlvZmYpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2gocm93KTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGRlbGV0ZSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY2llc1wiLCBwb2xpY2llcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhKXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhPXt9XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcyA9IHBvbGljaWVzO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNVdGlsc30gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NvbXB1dGF0aW9ucy11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJlcGFyZVZhcmlhYmxlc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKFwicHJlcGFyZV92YXJpYWJsZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKENvbXB1dGF0aW9uc1V0aWxzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhcmlhYmxlVmFsdWVzID0gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGE9e1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXM6IHZhcmlhYmxlVmFsdWVzXG4gICAgICAgIH07XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJudW1iZXJPZlJ1bnNcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID4gMCkpO1xuXG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmb3JtdWxhXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKVxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi4vbi13YXkvc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuLi9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7UHJvYkNhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL3Byb2ItY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Q29tcHV0ZVBvbGljeVN0YXRzU3RlcH0gZnJvbSBcIi4vc3RlcHMvY29tcHV0ZS1wb2xpY3ktc3RhdHMtc3RlcFwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZT01KSB7XG4gICAgICAgIHN1cGVyKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMubmFtZSA9IFwicHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1wiO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpIHtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgUHJvYkNhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDb21wdXRlUG9saWN5U3RhdHNTdGVwKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pIHtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1sxXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMV0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nLCBVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRlUG9saWN5U3RhdHNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiY29tcHV0ZV9wb2xpY3lfc3RhdHNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICBsZXQgcnVsZSA9IHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuXG5cbiAgICAgICAgdmFyIHBheW9mZnNQZXJQb2xpY3kgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5tYXAoKCk9PltdKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLmZvckVhY2gocm93PT4ge1xuICAgICAgICAgICAgcGF5b2Zmc1BlclBvbGljeVtyb3cucG9saWN5SW5kZXhdLnB1c2goVXRpbHMuaXNTdHJpbmcocm93LnBheW9mZikgPyAwIDogcm93LnBheW9mZilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9nLmRlYnVnKCdwYXlvZmZzUGVyUG9saWN5JywgcGF5b2Zmc1BlclBvbGljeSwgam9iUmVzdWx0LmRhdGEucm93cy5sZW5ndGgsIHJ1bGUubWF4aW1pemF0aW9uKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5tZWRpYW5zID0gcGF5b2Zmc1BlclBvbGljeS5tYXAocGF5b2Zmcz0+RXhwcmVzc2lvbkVuZ2luZS5tZWRpYW4ocGF5b2ZmcykpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5zdGFuZGFyZERldmlhdGlvbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLnN0ZChwYXlvZmZzKSk7XG5cbiAgICAgICAgaWYgKHJ1bGUubWF4aW1pemF0aW9uKSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLmRpdmlkZSh2LCBudW1iZXJPZlJ1bnMpKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHYsIG51bWJlck9mUnVucykpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50ID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodikpO1xuXG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4uLy4uL24td2F5L3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0pvYkNvbXB1dGF0aW9uRXhjZXB0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2V4Y2VwdGlvbnMvam9iLWNvbXB1dGF0aW9uLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYkNhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBDYWxjdWxhdGVTdGVwIHtcblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhLnJvd3Mpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcyA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgfVxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICBmb3IodmFyIHJ1bkluZGV4PTA7IHJ1bkluZGV4PGNodW5rU2l6ZTsgcnVuSW5kZXgrKyl7XG4gICAgICAgICAgICB2YXIgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgICAgIHZhciBlcnJvcnMgPSBbXTtcbiAgICAgICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZXZhbHVhdGVkID0gdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLmV2YWwodi5mb3JtdWxhLCB0cnVlLCBVdGlscy5jbG9uZURlZXAoZGF0YS5leHByZXNzaW9uU2NvcGUpKTtcbiAgICAgICAgICAgICAgICAgICAgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZXZhbHVhdGVkKSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoKGUpe1xuICAgICAgICAgICAgICAgICAgICBlcnJvcnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZTogdixcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZihlcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGVycm9yRGF0YSA9IHt2YXJpYWJsZXM6IFtdfTtcbiAgICAgICAgICAgICAgICBlcnJvcnMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgICAgIGVycm9yRGF0YS52YXJpYWJsZXNbZS52YXJpYWJsZS5uYW1lXSA9IGUuZXJyb3IubWVzc2FnZTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJwYXJhbS1jb21wdXRhdGlvblwiLCBlcnJvckRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHNpbmdsZVJ1blZhcmlhYmxlVmFsdWVzKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgciA9IHN1cGVyLnByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICB0aGlzLnVwZGF0ZVBvbGljeVN0YXRzKHIsIHBvbGljaWVzLCBudW1iZXJPZlJ1bnMsIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgcmV0dXJuIHI7XG4gICAgfVxuXG4gICAgdXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KXtcbiAgICAgICAgdmFyIGhpZ2hlc3RQYXlvZmYgPSAtSW5maW5pdHk7XG4gICAgICAgIHZhciBsb3dlc3RQYXlvZmYgPSBJbmZpbml0eTtcbiAgICAgICAgdmFyIGJlc3RQb2xpY3lJbmRleGVzID0gW107XG4gICAgICAgIHZhciB3b3JzdFBvbGljeUluZGV4ZXMgPSBbXTtcblxuICAgICAgICB2YXIgemVyb051bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaCgocG9saWN5LGkpPT57XG4gICAgICAgICAgICBsZXQgcGF5b2ZmID0gci5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgaWYoVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgcGF5b2ZmID0gemVyb051bTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA8IGxvd2VzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgbG93ZXN0UGF5b2ZmID0gcGF5b2ZmO1xuICAgICAgICAgICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcyA9IFtpXTtcbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMobG93ZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA+IGhpZ2hlc3RQYXlvZmYpe1xuICAgICAgICAgICAgICAgIGhpZ2hlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMgPSBbaV1cbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMoaGlnaGVzdFBheW9mZikpe1xuICAgICAgICAgICAgICAgIGJlc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXNbaV0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocGF5b2ZmLCBudW1iZXJPZlJ1bnMpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBiZXN0UG9saWN5SW5kZXhlcy5sZW5ndGgpKVxuICAgICAgICB9KTtcblxuICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgd29yc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzID0gam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMubWFwKHY9PnRoaXMudG9GbG9hdCh2KSk7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCAxKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG4gICAgICAgIHZhciBkZWZhdWx0VmFsdWVzID0ge307XG4gICAgICAgIFV0aWxzLmZvck93bihkYXRhLmV4cHJlc3Npb25TY29wZSwgKHYsayk9PntcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXNba109dGhpcy50b0Zsb2F0KHYpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeSddO1xuICAgICAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKG49PmhlYWRlcnMucHVzaChuKSk7XG4gICAgICAgICAgICBoZWFkZXJzLnB1c2goJ3BheW9mZicpO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICAgICAgaGVhZGVyczpoZWFkZXJzLFxuICAgICAgICAgICAgICAgIHJvd3M6IFtdLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlTmFtZXM6IHZhcmlhYmxlTmFtZXMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlczogZGVmYXVsdFZhbHVlcyxcbiAgICAgICAgICAgICAgICBwb2xpY2llczogam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJwb2xpY2llc1wiKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSkge1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGl0ZW1JbmRleCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWUgPSB2YXJpYWJsZU5hbWVzW2l0ZW1JbmRleF07XG5cblxuXG4gICAgICAgIHZhciByZXN1bHRzID0gW11cblxuICAgICAgICBpdGVtLmZvckVhY2godmFyaWFibGVWYWx1ZT0+e1xuXG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcblxuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IHZhcmlhYmxlVmFsdWU7XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuICAgICAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgICAgICBpZighdmFsaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UpO1xuICAgICAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290LCBydWxlTmFtZSk7XG4gICAgICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuICAgICAgICAgICAgdmFyIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcblxuXG4gICAgICAgICAgICB2YXIgciA9IHtcbiAgICAgICAgICAgICAgICBwb2xpY2llczogcG9saWNpZXMsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lOiB2YXJpYWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVJbmRleDogaXRlbUluZGV4LFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlVmFsdWU6IHZhcmlhYmxlVmFsdWUsXG4gICAgICAgICAgICAgICAgcGF5b2ZmOiBwYXlvZmZcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICByZXN1bHRzLnB1c2gocilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG5cbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuXG4gICAgICAgIHZhciBwb2xpY3lCeUtleSA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljeUJ5S2V5XCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW1zV3JhcHBlcj0+e1xuICAgICAgICAgICAgaWYoIWl0ZW1zV3JhcHBlcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpdGVtc1dyYXBwZXIuZm9yRWFjaChpdGVtPT57XG4gICAgICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3kpPT57XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW1BvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3kpXTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2KT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbHVlID0gXCJkZWZhdWx0XCI7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZih2ID09IGl0ZW0udmFyaWFibGVOYW1lKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHRoaXMudG9GbG9hdChpdGVtLnZhcmlhYmxlVmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWVsc2UgaWYoam9iUmVzdWx0LmRhdGEuZGVmYXVsdFZhbHVlcy5oYXNPd25Qcm9wZXJ0eSh2KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBqb2JSZXN1bHQuZGF0YS5kZWZhdWx0VmFsdWVzW3ZdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaCh2YWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBpdGVtLnBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgcm93Q2VsbHMucHVzaChVdGlscy5pc1N0cmluZyhwYXlvZmYpPyBwYXlvZmY6IHRoaXMudG9GbG9hdChwYXlvZmYpKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJvdyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNlbGxzOiByb3dDZWxscyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBwb2xpY2llcy5pbmRleE9mKHBvbGljeUJ5S2V5W3BvbGljeS5rZXldKSxcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKHJvdyk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCByZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWN5QnlLZXlcIiwgVXRpbHMuZ2V0T2JqZWN0QnlJZE1hcChwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcywgbnVsbCwgJ2tleScpKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHRoaXMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJ2YXJpYWJsZVZhbHVlc1wiLCB2YXJpYWJsZVZhbHVlcyk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIHNlcXVlbmNlKG1pbiwgbWF4LCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGV4dGVudCA9IG1heCAtIG1pbjtcbiAgICAgICAgdmFyIHN0ZXAgPSBleHRlbnQgLyAobGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgKz0gc3RlcDtcblxuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUucm91bmQoY3VyciwgMTYpKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPD0gdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi90b3JuYWRvLWRpYWdyYW0tam9iLXBhcmFtZXRlcnNcIjtcblxuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJ0b3JuYWRvLWRpYWdyYW1cIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENhbGN1bGF0ZVN0ZXAoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuXG4vKmpvYiBzdGVwIHRoYXQgcHJvY2VzcyBiYXRjaCBvZiBpdGVtcyovXG5leHBvcnQgY2xhc3MgQmF0Y2hTdGVwIGV4dGVuZHMgU3RlcCB7XG5cbiAgICBjaHVua1NpemU7XG4gICAgc3RhdGljIENVUlJFTlRfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfY3VycmVudF9pdGVtX2NvdW50JztcbiAgICBzdGF0aWMgVE9UQUxfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfdG90YWxfaXRlbV9jb3VudCc7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBjaHVua1NpemUpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuY2h1bmtTaXplID0gY2h1bmtTaXplO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHN0ZXAgaW5pdGlhbGl6YXRpb24uIFNob3VsZCByZXR1cm4gdG90YWwgaXRlbSBjb3VudFxuICAgICAqL1xuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLmluaXQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcmVhZCBhbmQgcmV0dXJuIGNodW5rIG9mIGl0ZW1zIHRvIHByb2Nlc3NcbiAgICAgKi9cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnJlYWROZXh0Q2h1bmsgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvY2VzcyBzaW5nbGUgaXRlbVxuICAgICAqIE11c3QgcmV0dXJuIHByb2Nlc3NlZCBpdGVtIHdoaWNoIHdpbGwgYmUgcGFzc2VkIGluIGEgY2h1bmsgdG8gd3JpdGVDaHVuayBmdW5jdGlvblxuICAgICAqL1xuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5wcm9jZXNzSXRlbSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byB3cml0ZSBjaHVuayBvZiBpdGVtcy4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gcG9zdHByb2Nlc3NpbmcgYWZ0ZXIgYWxsIGl0ZW1zIGhhdmUgYmVlbiBwcm9jZXNzZWQuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuXG4gICAgc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QKTtcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCkgfHwgMDtcbiAgICB9XG5cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBpbml0aWFsaXplIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pLnRoZW4odG90YWxJdGVtQ291bnQ9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdG90YWxJdGVtQ291bnQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGlmKCEoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSl7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcG9zdFByb2Nlc3MgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIGhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGN1cnJlbnRJdGVtQ291bnQgPSB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciB0b3RhbEl0ZW1Db3VudCA9IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBjaHVua1NpemUgPSBNYXRoLm1pbih0aGlzLmNodW5rU2l6ZSwgdG90YWxJdGVtQ291bnQgLSBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgaWYgKGN1cnJlbnRJdGVtQ291bnQgPj0gdG90YWxJdGVtQ291bnQpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50LCBjaHVua1NpemUsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHJlYWQgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pLnRoZW4oY2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcHJvY2VzcyBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKHByb2Nlc3NlZENodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIHByb2Nlc3NlZENodW5rLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byB3cml0ZSBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKChyZXMpPT4ge1xuICAgICAgICAgICAgY3VycmVudEl0ZW1Db3VudCArPSBjaHVua1NpemU7XG4gICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHsgLy9UT0RPIHByb21pc2lmeVxuICAgICAgICByZXR1cm4gY2h1bmsubWFwKChpdGVtLCBpKT0+dGhpcy5wcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50K2ksIGpvYlJlc3VsdCkpO1xuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCwgcHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmNoZWNrRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjbGFzcyBFeHRlbmRhYmxlRXJyb3Ige1xuICAgIGRhdGE7XG4gICAgY29uc3RydWN0b3IobWVzc2FnZSwgZGF0YSkge1xuICAgICAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9leHRlbmRhYmxlLWVycm9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcmVzdGFydC1leGNlcHRpb24nXG5cblxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkludGVycnVwdGVkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JSZXN0YXJ0RXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgRXhlY3V0aW9uQ29udGV4dCB7XG5cbiAgICBkaXJ0eSA9IGZhbHNlO1xuICAgIGNvbnRleHQgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGNvbnRleHQpIHtcbiAgICAgICAgaWYgKGNvbnRleHQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udGV4dCA9IFV0aWxzLmNsb25lKGNvbnRleHQpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdXQoa2V5LCB2YWx1ZSkge1xuICAgICAgICB2YXIgcHJldlZhbHVlID0gdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gdGhpcy5jb250ZXh0W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMuZGlydHkgPSBwcmV2VmFsdWUgPT0gbnVsbCB8fCBwcmV2VmFsdWUgIT0gbnVsbCAmJiBwcmV2VmFsdWUgIT0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlICE9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXQoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBjb250YWluc0tleShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5oYXNPd25Qcm9wZXJ0eShrZXkpO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgIH1cblxuICAgIHNldERhdGEoZGF0YSkgeyAvL3NldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLnB1dChcImRhdGFcIiwgZGF0YSk7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHsgLy8gZ2V0IGRhdGEgbW9kZWxcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0KFwiZGF0YVwiKTtcbiAgICB9XG5cbiAgICBnZXREVE8oKSB7XG4gICAgICAgIHZhciBkdG8gPSBVdGlscy5jbG9uZURlZXAodGhpcyk7XG4gICAgICAgIHZhciBkYXRhID0gdGhpcy5nZXREYXRhKCk7XG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBkYXRhID0gZGF0YS5nZXREVE8oKTtcbiAgICAgICAgICAgIGR0by5jb250ZXh0W1wiZGF0YVwiXSA9IGRhdGE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbn1cbiIsImltcG9ydCAqIGFzIGV4Y2VwdGlvbnMgZnJvbSAnLi9leGNlcHRpb25zJ1xuXG5leHBvcnQge2V4Y2VwdGlvbnN9XG5leHBvcnQgKiBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0J1xuZXhwb3J0ICogZnJvbSAnLi9qb2InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tZmxhZydcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1saXN0ZW5lcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Ita2V5LWdlbmVyYXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWxhdW5jaGVyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itc3RhdHVzJ1xuZXhwb3J0ICogZnJvbSAnLi9zaW1wbGUtam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwLWV4ZWN1dGlvbidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24tbGlzdGVuZXInXG5cblxuXG5cbiIsImV4cG9ydCBjb25zdCBKT0JfRVhFQ1VUSU9OX0ZMQUcgPSB7XG4gICAgU1RPUDogJ1NUT1AnXG59O1xuIiwiZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBqb2IgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cblxuICAgIC8qQ2FsbGVkIGFmdGVyIGNvbXBsZXRpb24gb2YgYSBqb2IuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5cbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGV4ZWN1dGlvbiBvZiBhIGpvYi4qL1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgam9iUGFyYW1ldGVycztcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIHN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuVU5LTk9XTjtcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcblxuICAgIHN0YXJ0VGltZSA9IG51bGw7XG4gICAgY3JlYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgZW5kVGltZSA9IG51bGw7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgdGhpcy5qb2JQYXJhbWV0ZXJzID0gam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBhIHN0ZXAgZXhlY3V0aW9uIHdpdGggdGhlIGN1cnJlbnQgam9iIGV4ZWN1dGlvbi5cbiAgICAgKiBAcGFyYW0gc3RlcE5hbWUgdGhlIG5hbWUgb2YgdGhlIHN0ZXAgdGhlIG5ldyBleGVjdXRpb24gaXMgYXNzb2NpYXRlZCB3aXRoXG4gICAgICovXG4gICAgY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSkge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKHN0ZXBOYW1lLCB0aGlzKTtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBpc1J1bm5pbmcoKSB7XG4gICAgICAgIHJldHVybiAhdGhpcy5lbmRUaW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlc3QgaWYgdGhpcyBKb2JFeGVjdXRpb24gaGFzIGJlZW4gc2lnbmFsbGVkIHRvXG4gICAgICogc3RvcC5cbiAgICAgKi9cbiAgICBpc1N0b3BwaW5nKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0dXMgPT09IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2lnbmFsIHRoZSBKb2JFeGVjdXRpb24gdG8gc3RvcC5cbiAgICAgKi9cbiAgICBzdG9wKCkge1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLmZvckVhY2goc2U9PiB7XG4gICAgICAgICAgICBzZS50ZXJtaW5hdGVPbmx5ID0gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICB9XG5cbiAgICBnZXREYXRhKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRpb25Db250ZXh0LmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzID0gW10sIGRlZXBDbG9uZSA9IHRydWUpIHtcbiAgICAgICAgdmFyIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVEZWVwV2l0aDtcbiAgICAgICAgaWYgKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSkgPiAtMSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoW1wiam9iUGFyYW1ldGVyc1wiLCBcImV4ZWN1dGlvbkNvbnRleHRcIl0uaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oW1wiam9iRXhlY3V0aW9uXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsIi8qIG9iamVjdCByZXByZXNlbnRpbmcgYSB1bmlxdWVseSBpZGVudGlmaWFibGUgam9iIHJ1bi4gSm9iSW5zdGFuY2UgY2FuIGJlIHJlc3RhcnRlZCBtdWx0aXBsZSB0aW1lcyBpbiBjYXNlIG9mIGV4ZWN1dGlvbiBmYWlsdXJlIGFuZCBpdCdzIGxpZmVjeWNsZSBlbmRzIHdpdGggZmlyc3Qgc3VjY2Vzc2Z1bCBleGVjdXRpb24qL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNle1xuXG4gICAgaWQ7XG4gICAgam9iTmFtZTtcbiAgICBjb25zdHJ1Y3RvcihpZCwgam9iTmFtZSl7XG4gICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgdGhpcy5qb2JOYW1lID0gam9iTmFtZTtcbiAgICB9XG5cbn1cbiIsIlxuZXhwb3J0IGNsYXNzIEpvYktleUdlbmVyYXRvciB7XG4gICAgLypNZXRob2QgdG8gZ2VuZXJhdGUgdGhlIHVuaXF1ZSBrZXkgdXNlZCB0byBpZGVudGlmeSBhIGpvYiBpbnN0YW5jZS4qL1xuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIlwiO1xuICAgICAgICBqb2JQYXJhbWV0ZXJzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuICAgICAgICAgICAgaWYoZC5pZGVudGlmeWluZyl7XG4gICAgICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiICsgam9iUGFyYW1ldGVycy52YWx1ZXNbZC5uYW1lXSArIFwiO1wiO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JMYXVuY2hlciB7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYldvcmtlcjtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGpvYldvcmtlciwgZGF0YU1vZGVsU2VyaWFsaXplcikge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IGpvYldvcmtlcjtcbiAgICAgICAgdGhpcy5kYXRhTW9kZWxTZXJpYWxpemVyID0gZGF0YU1vZGVsU2VyaWFsaXplcjtcbiAgICB9XG5cblxuICAgIHJ1bihqb2JPck5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICB2YXIgam9iO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycztcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIGlmIChVdGlscy5pc1N0cmluZyhqb2JPck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JPck5hbWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGpvYiA9IGpvYk9yTmFtZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJObyBzdWNoIGpvYjogXCIgKyBqb2JPck5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVyc1ZhbHVlcyk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSk7XG4gICAgICAgIH0pLnRoZW4odmFsaWQ9PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuY3JlYXRlSm9iRXhlY3V0aW9uKGpvYi5uYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuXG5cbiAgICAgICAgICAgICAgICBpZih0aGlzLmpvYldvcmtlcil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYjogW1wiICsgam9iLm5hbWUgKyBcIl0gZXhlY3V0aW9uIFtcIitqb2JFeGVjdXRpb24uaWQrXCJdIGRlbGVnYXRlZCB0byB3b3JrZXJcIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9iV29ya2VyLmV4ZWN1dGVKb2Ioam9iRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgZXhlY3V0aW9uUHJvbWlzZSA9IHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGlmKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblByb21pc2U7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycykudGhlbihsYXN0RXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFqb2IuaXNSZXN0YXJ0YWJsZSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBub3QgcmVzdGFydGFibGVcIik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbGFzdEV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKGV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIlN0ZXAgW1wiICsgZXhlY3V0aW9uLnN0ZXBOYW1lICsgXCJdIGlzIG9mIHN0YXR1cyBVTktOT1dOXCIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoam9iLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgJiYgIWpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGpvYi5qb2JEYXRhVmFsaWRhdG9yICYmICFqb2Iuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShkYXRhKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIC8qKkV4ZWN1dGUgcHJldmlvdXNseSBjcmVhdGVkIGpvYiBleGVjdXRpb24qL1xuICAgIGV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCl7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIGlmKFV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgfSkudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKCFqb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbk9ySWQgKyBcIl0gaXMgbm90IGZvdW5kXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5TVEFSVElORykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbi5pZCArIFwiXSBhbHJlYWR5IHN0YXJ0ZWRcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBqb2JOYW1lID0gam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWU7XG4gICAgICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgICAgIGlmKCFqb2Ipe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iTmFtZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiAgdGhpcy5fZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pe1xuICAgICAgICB2YXIgam9iTmFtZSA9IGpvYi5uYW1lO1xuICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBsYXVuY2hlZCB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgam9iRXhlY3V0aW9uLmdldERhdGEoKSk7XG4gICAgICAgIHJldHVybiBqb2IuZXhlY3V0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBjb21wbGV0ZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdIGFuZCB0aGUgZm9sbG93aW5nIHN0YXR1czogW1wiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiXVwiKTtcbiAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgIH0pLmNhdGNoKGUgPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gZmFpbGVkIHVuZXhwZWN0ZWRseSBhbmQgZmF0YWxseSB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgZSk7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNvbnN0IFBBUkFNRVRFUl9UWVBFID0ge1xuICAgIFNUUklORzogJ1NUUklORycsXG4gICAgREFURTogJ0RBVEUnLFxuICAgIElOVEVHRVI6ICdJTlRFR0VSJyxcbiAgICBOVU1CRVI6ICdGTE9BVCcsXG4gICAgQk9PTEVBTjogJ0JPT0xFQU4nLFxuICAgIE5VTUJFUl9FWFBSRVNTSU9OOiAnTlVNQkVSX0VYUFJFU1NJT04nLFxuICAgIENPTVBPU0lURTogJ0NPTVBPU0lURScgLy9jb21wb3NpdGUgcGFyYW1ldGVyIHdpdGggbmVzdGVkIHN1YnBhcmFtZXRlcnNcbn07XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uIHtcbiAgICBuYW1lO1xuICAgIHR5cGU7XG4gICAgbmVzdGVkUGFyYW1ldGVycyA9IFtdO1xuICAgIG1pbk9jY3VycztcbiAgICBtYXhPY2N1cnM7XG4gICAgcmVxdWlyZWQgPSB0cnVlO1xuXG4gICAgaWRlbnRpZnlpbmc7XG4gICAgdmFsaWRhdG9yO1xuICAgIHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zLCBtaW5PY2N1cnMgPSAxLCBtYXhPY2N1cnMgPSAxLCBpZGVudGlmeWluZyA9IGZhbHNlLCBzaW5nbGVWYWx1ZVZhbGlkYXRvciA9IG51bGwsIHZhbGlkYXRvciA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgaWYgKFV0aWxzLmlzQXJyYXkodHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zKSkge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFO1xuICAgICAgICAgICAgdGhpcy5uZXN0ZWRQYXJhbWV0ZXJzID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudmFsaWRhdG9yID0gdmFsaWRhdG9yO1xuICAgICAgICB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yID0gc2luZ2xlVmFsdWVWYWxpZGF0b3I7XG4gICAgICAgIHRoaXMuaWRlbnRpZnlpbmcgPSBpZGVudGlmeWluZztcbiAgICAgICAgdGhpcy5taW5PY2N1cnMgPSBtaW5PY2N1cnM7XG4gICAgICAgIHRoaXMubWF4T2NjdXJzID0gbWF4T2NjdXJzO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICB0aGlzW2tleV0gPSB2YWw7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlLCBhbGxWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGlzQXJyYXkgPSBVdGlscy5pc0FycmF5KHZhbHVlKTtcblxuICAgICAgICBpZiAodGhpcy5tYXhPY2N1cnMgPiAxICYmICFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcylcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPCB0aGlzLm1pbk9jY3VycyB8fCB2YWx1ZS5sZW5ndGggPiB0aGlzLm1heE9jY3Vycykge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWx1ZS5ldmVyeSh2PT50aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodiwgdmFsdWUpKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMudmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IodmFsdWUsIGFsbFZhbHVlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBzdGF0aWMgY29tcHV0ZU51bWJlckV4cHJlc3Npb24odmFsKXtcbiAgICAgICAgbGV0IHBhcnNlZCA9IHBhcnNlRmxvYXQodmFsKTtcbiAgICAgICAgaWYocGFyc2VkID09PSBJbmZpbml0eSB8fCBwYXJzZWQgPT09IC1JbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHBhcnNlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFFeHByZXNzaW9uRW5naW5lLnZhbGlkYXRlKHZhbCwge30sIGZhbHNlKSl7XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZXZhbCh2YWwsIHRydWUpXG4gICAgfVxuXG4gICAgLy8gYWxsVmFsdWVzIC0gYWxsIHZhbHVlcyBvbiB0aGUgc2FtZSBsZXZlbFxuICAgIHZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcykge1xuICAgICAgICBpZiAoKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpICYmIHRoaXMubWluT2NjdXJzID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCAmJiAoIXZhbHVlICYmIHZhbHVlICE9PSAwICYmIHZhbHVlICE9PSBmYWxzZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5TVFJJTkcgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkRBVEUgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5JTlRFR0VSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzSW50KHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNOdW1iZXIodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuQk9PTEVBTiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0Jvb2xlYW4odmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTiA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24odmFsdWUpO1xuICAgICAgICAgICAgaWYodmFsdWUgPT09IG51bGwpe1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURSA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICBpZiAoIVV0aWxzLmlzT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5uZXN0ZWRQYXJhbWV0ZXJzLmV2ZXJ5KChuZXN0ZWREZWYsIGkpPT5uZXN0ZWREZWYudmFsaWRhdGUodmFsdWVbbmVzdGVkRGVmLm5hbWVdKSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IodmFsdWUsIGFsbFZhbHVlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YWx1ZSh2YWx1ZSl7XG4gICAgICAgIGlmKFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1BBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc3tcbiAgICBkZWZpbml0aW9ucyA9IFtdO1xuICAgIHZhbHVlcz17fTtcblxuICAgIGNvbnN0cnVjdG9yKHZhbHVlcyl7XG4gICAgICAgIHRoaXMuaW5pdERlZmluaXRpb25zKCk7XG4gICAgICAgIHRoaXMuaW5pdERlZmF1bHRWYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLnZhbHVlcywgdmFsdWVzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXREZWZpbml0aW9ucygpe1xuXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKXtcblxuICAgIH1cblxuICAgIHZhbGlkYXRlKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmRlZmluaXRpb25zLmV2ZXJ5KChkZWYsIGkpPT5kZWYudmFsaWRhdGUodGhpcy52YWx1ZXNbZGVmLm5hbWVdLCB0aGlzLnZhbHVlcykpO1xuICAgIH1cblxuICAgIGdldERlZmluaXRpb24ocGF0aCl7XG4gICAgICAgIHZhciBkZWZzID10aGlzLmRlZmluaXRpb25zO1xuICAgICAgICBsZXQgZGVmID0gbnVsbDtcbiAgICAgICAgaWYoIXBhdGguc3BsaXQoKS5ldmVyeShuYW1lPT57XG4gICAgICAgICAgICAgICAgZGVmID0gVXRpbHMuZmluZChkZWZzLCBkPT5kLm5hbWUgPT0gbmFtZSk7XG4gICAgICAgICAgICAgICAgaWYoIWRlZil7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWZzID0gZGVmLm5lc3RlZFBhcmFtZXRlcnM7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pKXtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWY7XG4gICAgfVxuXG4gICAgLypnZXQgb3Igc2V0IHZhbHVlIGJ5IHBhdGgqL1xuICAgIHZhbHVlKHBhdGgsIHZhbHVlKXtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIGxldCBkZWYgPSB0aGlzLmdldERlZmluaXRpb24ocGF0aCk7XG4gICAgICAgICAgICBsZXQgdmFsID0gVXRpbHMuZ2V0KHRoaXMudmFsdWVzLCBwYXRoLCBudWxsKTtcbiAgICAgICAgICAgIGlmKGRlZil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlZi52YWx1ZSh2YWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuICB2YWw7XG4gICAgICAgIH1cbiAgICAgICAgVXRpbHMuc2V0KHRoaXMudmFsdWVzLCBwYXRoLCB2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICB0b1N0cmluZygpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gXCJKb2JQYXJhbWV0ZXJzW1wiO1xuXG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMuZm9yRWFjaCgoZCwgaSk9PiB7XG5cbiAgICAgICAgICAgIHZhciB2YWwgPSB0aGlzLnZhbHVlc1tkLm5hbWVdO1xuICAgICAgICAgICAgLy8gaWYoVXRpbHMuaXNBcnJheSh2YWwpKXtcbiAgICAgICAgICAgIC8vICAgICB2YXIgdmFsdWVzID0gdmFsO1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICAvLyBpZihQQVJBTUVURVJfVFlQRS5DT01QT1NJVEUgPT0gZC50eXBlKXtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyB9XG5cbiAgICAgICAgICAgIHJlc3VsdCArPSBkLm5hbWUgKyBcIj1cIit2YWwgKyBcIjtcIjtcbiAgICAgICAgfSk7XG4gICAgICAgIHJlc3VsdCs9XCJdXCI7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZ2V0RFRPKCl7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWx1ZXM6IHRoaXMudmFsdWVzXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge2RlZmF1bHQgYXMgaWRifSBmcm9tIFwiaWRiXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi4vam9iLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4uL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge2xvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qIEluZGV4ZWREQiBqb2IgcmVwb3NpdG9yeSovXG5leHBvcnQgY2xhc3MgSWRiSm9iUmVwb3NpdG9yeSBleHRlbmRzIEpvYlJlcG9zaXRvcnkge1xuXG4gICAgZGJQcm9taXNlO1xuICAgIGpvYkluc3RhbmNlRGFvO1xuICAgIGpvYkV4ZWN1dGlvbkRhbztcbiAgICBzdGVwRXhlY3V0aW9uRGFvO1xuICAgIGpvYlJlc3VsdERhbztcbiAgICBqb2JFeGVjdXRpb25Qcm9ncmVzc0RhbztcbiAgICBqb2JFeGVjdXRpb25GbGFnRGFvO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbnNSZXZpdmVyLCBkYk5hbWUgPSAnc2Qtam9iLXJlcG9zaXRvcnknLCBkZWxldGVEQiA9IGZhbHNlKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuZGJOYW1lID0gZGJOYW1lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zUmV2aXZlciA9IGV4cHJlc3Npb25zUmV2aXZlcjtcbiAgICAgICAgaWYgKGRlbGV0ZURCKSB7XG4gICAgICAgICAgICB0aGlzLmRlbGV0ZURCKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmluaXREQigpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmluaXREQigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXREQigpIHtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBpZGIub3Blbih0aGlzLmRiTmFtZSwgMiwgdXBncmFkZURCID0+IHtcbiAgICAgICAgICAgIC8vIE5vdGU6IHdlIGRvbid0IHVzZSAnYnJlYWsnIGluIHRoaXMgc3dpdGNoIHN0YXRlbWVudCxcbiAgICAgICAgICAgIC8vIHRoZSBmYWxsLXRocm91Z2ggYmVoYXZpb3VyIGlzIHdoYXQgd2Ugd2FudC5cbiAgICAgICAgICAgIHN3aXRjaCAodXBncmFkZURCLm9sZFZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICBjYXNlIDA6XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWluc3RhbmNlcycpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIFwiam9iSW5zdGFuY2UuaWRcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiY3JlYXRlVGltZVwiLCBcImNyZWF0ZVRpbWVcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwic3RhdHVzXCIsIFwic3RhdHVzXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbi1wcm9ncmVzcycpO1xuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tZmxhZ3MnKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zT1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ3N0ZXAtZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiam9iRXhlY3V0aW9uSWRcIiwgXCJqb2JFeGVjdXRpb25JZFwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBqb2JSZXN1bHRPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLXJlc3VsdHMnKTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0T1MuY3JlYXRlSW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIFwiam9iSW5zdGFuY2UuaWRcIiwge3VuaXF1ZTogdHJ1ZX0pO1xuICAgICAgICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLnRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdqb2ItaW5zdGFuY2VzJykuY3JlYXRlSW5kZXgoXCJpZFwiLCBcImlkXCIsIHt1bmlxdWU6IHRydWV9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItaW5zdGFuY2VzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkRhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0RhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbi1mbGFncycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9uRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdzdGVwLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0RGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItcmVzdWx0cycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICB9XG5cbiAgICBkZWxldGVEQigpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oXz0+aWRiLmRlbGV0ZSh0aGlzLmRiTmFtZSkpO1xuICAgIH1cblxuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5yZW1vdmUoa2V5KS50aGVuKCgpPT57XG4gICAgICAgICAgICB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmYWxzZSkudGhlbihqb2JFeGVjdXRpb25zPT57ICAvLyAgTm90IHdhaXRpbmcgZm9yIHByb21pc2UgcmVzb2x2ZXNcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2godGhpcy5yZW1vdmVKb2JFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSkudGhlbihqb2JSZXN1bHQ9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5yZW1vdmUoam9iRXhlY3V0aW9uLmlkKS50aGVuKCgpPT57XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5maW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uLmlkLCBmYWxzZSkudGhlbihzdGVwRXhlY3V0aW9ucz0+eyAgLy8gTm90IHdhaXRpbmcgZm9yIHByb21pc2UgcmVzb2x2ZXNcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5yZW1vdmUoc3RlcEV4ZWN1dGlvbi5pZClcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLnJlbW92ZShqb2JSZXN1bHQuaWQpO1xuICAgIH1cblxuXG5cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uZ2V0KGpvYlJlc3VsdElkKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXRCeUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBqb2JJbnN0YW5jZS5pZCk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLnNldChqb2JSZXN1bHQuaWQsIGpvYlJlc3VsdCkudGhlbihyPT5qb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLmdldChrZXkpLnRoZW4oZHRvPT5kdG8gPyB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0bykgOiBkdG8pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5zZXQoa2V5LCBqb2JJbnN0YW5jZSkudGhlbihyPT5qb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBqb2JFeGVjdXRpb24uZ2V0RFRPKCk7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc0RUT3MgPSBkdG8uc3RlcEV4ZWN1dGlvbnM7XG4gICAgICAgIGR0by5zdGVwRXhlY3V0aW9ucyA9IG51bGw7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5zZXQoam9iRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+dGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zRFRPcykpLnRoZW4ocj0+am9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3MpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0Rhby5nZXQoam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIGZsYWcpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBzdGVwRXhlY3V0aW9uLmdldERUTyhbXCJqb2JFeGVjdXRpb25cIl0pO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+c3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9ucywgc2F2ZWRFeGVjdXRpb25zID0gW10pIHtcbiAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSBzYXZlZEV4ZWN1dGlvbnMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25EVE8gPSBzdGVwRXhlY3V0aW9uc1tzYXZlZEV4ZWN1dGlvbnMubGVuZ3RoXTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5zZXQoc3RlcEV4ZWN1dGlvbkRUTy5pZCwgc3RlcEV4ZWN1dGlvbkRUTykudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHNhdmVkRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb25EVE8pO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9ucywgc2F2ZWRFeGVjdXRpb25zKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0KGlkKS50aGVuKGR0bz0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGR0byk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkRUTywgcmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbkRUTykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25EVE8uaWQsIGZhbHNlKS50aGVuKHN0ZXBzPT4ge1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uRFRPLnN0ZXBFeGVjdXRpb25zID0gc3RlcHM7XG4gICAgICAgICAgICBpZiAoIXJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb25EVE87XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXZpdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBmZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdCwgcmV2aXZlID0gdHJ1ZSwgZmV0Y2hlZCA9IFtdKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb25EdG9MaXN0Lmxlbmd0aCA8PSBmZXRjaGVkLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmZXRjaGVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0W2ZldGNoZWQubGVuZ3RoXSwgcmV2aXZlKS50aGVuKChqb2JFeGVjdXRpb24pPT4ge1xuICAgICAgICAgICAgZmV0Y2hlZC5wdXNoKGpvYkV4ZWN1dGlvbik7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0LCByZXZpdmUsIGZldGNoZWQpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmaW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uSWQsIHJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5nZXRBbGxCeUluZGV4KFwiam9iRXhlY3V0aW9uSWRcIiwgam9iRXhlY3V0aW9uSWQpLnRoZW4oZHRvcz0+IHtcbiAgICAgICAgICAgIGlmICghcmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGR0b3M7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZHRvcy5tYXAoZHRvPT50aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oZHRvKSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZldGNoUmVsYXRpb25zQW5kUmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0QWxsQnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpLnRoZW4odmFsdWVzPT4ge1xuICAgICAgICAgICAgdmFyIHNvcnRlZCA9IHZhbHVlcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKCFmZXRjaFJlbGF0aW9uc0FuZFJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhzb3J0ZWQsIHRydWUpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmYWxzZSkudGhlbihleGVjdXRpb25zPT50aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLSAxXSkpO1xuICAgIH1cblxuICAgIGdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb25zPT4ge1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2goam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHM9PnMuc3RlcE5hbWUgPT09IHN0ZXBOYW1lKS5mb3JFYWNoKChzKT0+c3RlcEV4ZWN1dGlvbnMucHVzaChzKSkpO1xuICAgICAgICAgICAgdmFyIGxhdGVzdCA9IG51bGw7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHM9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlKGR0by5pZCwgZHRvLmpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5jb250ZXh0ID0gZHRvLmNvbnRleHQ7XG4gICAgICAgIHZhciBkYXRhID0gZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICB2YXIgZGF0YU1vZGVsID0gbmV3IERhdGFNb2RlbCgpO1xuICAgICAgICAgICAgZGF0YU1vZGVsLmxvYWRGcm9tRFRPKGRhdGEsIHRoaXMuZXhwcmVzc2lvbnNSZXZpdmVyKTtcbiAgICAgICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuc2V0RGF0YShkYXRhTW9kZWwpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0XG4gICAgfVxuXG4gICAgcmV2aXZlSm9iRXhlY3V0aW9uKGR0bykge1xuXG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmdldEpvYkJ5TmFtZShkdG8uam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IHRoaXMucmV2aXZlSm9iSW5zdGFuY2UoZHRvLmpvYkluc3RhbmNlKTtcbiAgICAgICAgdmFyIGpvYlBhcmFtZXRlcnMgPSBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhkdG8uam9iUGFyYW1ldGVycy52YWx1ZXMpO1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uID0gbmV3IEpvYkV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycywgZHRvLmlkKTtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSB0aGlzLnJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXR1cm4gVXRpbHMubWVyZ2VXaXRoKGpvYkV4ZWN1dGlvbiwgZHRvLCAob2JqVmFsdWUsIHNyY1ZhbHVlLCBrZXksIG9iamVjdCwgc291cmNlLCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkluc3RhbmNlXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iSW5zdGFuY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImV4ZWN1dGlvbkNvbnRleHRcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JQYXJhbWV0ZXJzXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iUGFyYW1ldGVycztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iRXhlY3V0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcInN0ZXBFeGVjdXRpb25zXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3JjVmFsdWUubWFwKHN0ZXBEVE8gPT4gdGhpcy5yZXZpdmVTdGVwRXhlY3V0aW9uKHN0ZXBEVE8sIGpvYkV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJldml2ZVN0ZXBFeGVjdXRpb24oZHRvLCBqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb24gPSBuZXcgU3RlcEV4ZWN1dGlvbihkdG8uc3RlcE5hbWUsIGpvYkV4ZWN1dGlvbiwgZHRvLmlkKTtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSB0aGlzLnJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXR1cm4gVXRpbHMubWVyZ2VXaXRoKHN0ZXBFeGVjdXRpb24sIGR0bywgKG9ialZhbHVlLCBzcmNWYWx1ZSwga2V5LCBvYmplY3QsIHNvdXJjZSwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JFeGVjdXRpb25cIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImV4ZWN1dGlvbkNvbnRleHRcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cblxuXG5jbGFzcyBPYmplY3RTdG9yZURhbyB7XG5cbiAgICBuYW1lO1xuICAgIGRiUHJvbWlzZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGRiUHJvbWlzZSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmRiUHJvbWlzZSA9IGRiUHJvbWlzZTtcbiAgICB9XG5cbiAgICBnZXQoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuZ2V0KGtleSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEFsbEJ5SW5kZXgoaW5kZXhOYW1lLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldEFsbChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEJ5SW5kZXgoaW5kZXhOYW1lLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5wdXQodmFsLCBrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmRlbGV0ZShrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhcigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuY2xlYXIoKTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAga2V5cygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpO1xuICAgICAgICAgICAgY29uc3Qga2V5cyA9IFtdO1xuICAgICAgICAgICAgY29uc3Qgc3RvcmUgPSB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpO1xuXG4gICAgICAgICAgICAvLyBUaGlzIHdvdWxkIGJlIHN0b3JlLmdldEFsbEtleXMoKSwgYnV0IGl0IGlzbid0IHN1cHBvcnRlZCBieSBFZGdlIG9yIFNhZmFyaS5cbiAgICAgICAgICAgIC8vIG9wZW5LZXlDdXJzb3IgaXNuJ3Qgc3VwcG9ydGVkIGJ5IFNhZmFyaSwgc28gd2UgZmFsbCBiYWNrXG4gICAgICAgICAgICAoc3RvcmUuaXRlcmF0ZUtleUN1cnNvciB8fCBzdG9yZS5pdGVyYXRlQ3Vyc29yKS5jYWxsKHN0b3JlLCBjdXJzb3IgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghY3Vyc29yKSByZXR1cm47XG4gICAgICAgICAgICAgICAga2V5cy5wdXNoKGN1cnNvci5rZXkpO1xuICAgICAgICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZS50aGVuKCgpID0+IGtleXMpO1xuICAgICAgICB9KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYktleUdlbmVyYXRvcn0gZnJvbSBcIi4uL2pvYi1rZXktZ2VuZXJhdG9yXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi4vam9iLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb25cIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtKb2JSZXN1bHR9IGZyb20gXCIuLi9qb2ItcmVzdWx0XCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGpvYkJ5TmFtZSA9IHt9O1xuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iQnlOYW1lW2pvYi5uYW1lXSA9IGpvYjtcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JCeU5hbWVbbmFtZV07XG4gICAgfVxuXG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeSBnZXRKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoa2V5LCBqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVTdGVwRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZmluZEpvYkV4ZWN1dGlvbnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVTdGVwRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qQ3JlYXRlIGEgbmV3IEpvYkluc3RhbmNlIHdpdGggdGhlIG5hbWUgYW5kIGpvYiBwYXJhbWV0ZXJzIHByb3ZpZGVkLiByZXR1cm4gcHJvbWlzZSovXG4gICAgY3JlYXRlSm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSBuZXcgSm9iSW5zdGFuY2UoVXRpbHMuZ3VpZCgpLCBqb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICAvKkNoZWNrIGlmIGFuIGluc3RhbmNlIG9mIHRoaXMgam9iIGFscmVhZHkgZXhpc3RzIHdpdGggdGhlIHBhcmFtZXRlcnMgcHJvdmlkZWQuKi9cbiAgICBpc0pvYkluc3RhbmNlRXhpc3RzKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbihyZXN1bHQgPT4gISFyZXN1bHQpLmNhdGNoKGVycm9yPT5mYWxzZSk7XG4gICAgfVxuXG4gICAgZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiBqb2JOYW1lICsgXCJ8XCIgKyBKb2JLZXlHZW5lcmF0b3IuZ2VuZXJhdGVLZXkoam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgLypDcmVhdGUgYSBKb2JFeGVjdXRpb24gZm9yIGEgZ2l2ZW4gIEpvYiBhbmQgSm9iUGFyYW1ldGVycy4gSWYgbWF0Y2hpbmcgSm9iSW5zdGFuY2UgYWxyZWFkeSBleGlzdHMsXG4gICAgICogdGhlIGpvYiBtdXN0IGJlIHJlc3RhcnRhYmxlIGFuZCBpdCdzIGxhc3QgSm9iRXhlY3V0aW9uIG11c3QgKm5vdCogYmVcbiAgICAgKiBjb21wbGV0ZWQuIElmIG1hdGNoaW5nIEpvYkluc3RhbmNlIGRvZXMgbm90IGV4aXN0IHlldCBpdCB3aWxsIGJlICBjcmVhdGVkLiovXG5cbiAgICBjcmVhdGVKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycywgZGF0YSkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKGpvYkluc3RhbmNlPT57XG4gICAgICAgICAgICBpZiAoam9iSW5zdGFuY2UgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgICAgICAgICAgZXhlY3V0aW9ucy5mb3JFYWNoKGV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb24oXCJBIGpvYiBleGVjdXRpb24gZm9yIHRoaXMgam9iIGlzIGFscmVhZHkgcnVubmluZzogXCIgKyBqb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuQ09NUExFVEVEIHx8IGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5BQkFORE9ORUQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiQSBqb2IgaW5zdGFuY2UgYWxyZWFkeSBleGlzdHMgYW5kIGlzIGNvbXBsZXRlIGZvciBwYXJhbWV0ZXJzPVwiICsgam9iUGFyYW1ldGVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICArIFwiLiAgSWYgeW91IHdhbnQgdG8gcnVuIHRoaXMgam9iIGFnYWluLCBjaGFuZ2UgdGhlIHBhcmFtZXRlcnMuXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IGV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLSAxXS5leGVjdXRpb25Db250ZXh0O1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbam9iSW5zdGFuY2UsIGV4ZWN1dGlvbkNvbnRleHRdO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIG5vIGpvYiBmb3VuZCwgY3JlYXRlIG9uZVxuICAgICAgICAgICAgam9iSW5zdGFuY2UgPSB0aGlzLmNyZWF0ZUpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICAgICAgdmFyIGRhdGFNb2RlbCA9IG5ldyBEYXRhTW9kZWwoKTtcbiAgICAgICAgICAgIGRhdGFNb2RlbC5fc2V0TmV3U3RhdGUoZGF0YS5jcmVhdGVTdGF0ZVNuYXBzaG90KCkpO1xuICAgICAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5zZXREYXRhKGRhdGFNb2RlbCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XSk7XG4gICAgICAgIH0pLnRoZW4oaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0PT57XG4gICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uID0gbmV3IEpvYkV4ZWN1dGlvbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMF0sIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMV07XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKChqb2JJbnN0YW5jZSk9PntcbiAgICAgICAgICAgIGlmKCFqb2JJbnN0YW5jZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT5leGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0xXSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucz1bXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+e1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBhZGRTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZShvKXtcbiAgICAgICAgby5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBcIk9iamVjdCBub3QgdXBkYXRhYmxlOiBcIitvXG4gICAgfVxuXG4gICAgcmVtb3ZlKG8pe1xuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JSZXN1bHQpe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iUmVzdWx0KCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXCJPYmplY3Qgbm90IHJlbW92YWJsZTogXCIrbyk7XG4gICAgfVxuXG5cbiAgICByZXZpdmVKb2JJbnN0YW5jZShkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZUpvYkV4ZWN1dGlvbihkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVTdGVwRXhlY3V0aW9uKGR0bywgam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBTaW1wbGVKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeXtcbiAgICBqb2JJbnN0YW5jZXNCeUtleSA9IHt9O1xuICAgIGpvYkV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIGV4ZWN1dGlvblByb2dyZXNzID0ge307XG4gICAgZXhlY3V0aW9uRmxhZ3MgPSB7fTtcbiAgICBqb2JSZXN1bHRzID0gW107XG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIFV0aWxzLmZvck93bih0aGlzLmpvYkluc3RhbmNlc0J5S2V5LCAgKGppLCBrZXkpPT57XG4gICAgICAgICAgICBpZihqaT09PWpvYkluc3RhbmNlKXtcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLmZpbHRlcihqb2JSZXN1bHQ9PmpvYlJlc3VsdC5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVKb2JSZXN1bHQsIHRoaXMpO1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5qb2JFeGVjdXRpb25zLmluZGV4T2Yoam9iRXhlY3V0aW9uKTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzdGVwRXhlY3V0aW9uPT5zdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCA9PT0gam9iRXhlY3V0aW9uLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5zdGVwRXhlY3V0aW9ucy5pbmRleE9mKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLmpvYlJlc3VsdHMuaW5kZXhPZihqb2JSZXN1bHQpO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iSW5zdGFuY2UpXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5pZD09PWpvYlJlc3VsdElkKSlcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5qb2JJbnN0YW5jZS5pZD09PWpvYkluc3RhbmNlLmlkKSlcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMucHVzaChqb2JSZXN1bHQpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYkV4ZWN1dGlvbnMsIGV4PT5leC5pZD09PWlkKSlcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMucHVzaChqb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0gPSBwcm9ncmVzcztcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcm9ncmVzcylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0pXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSA9IGZsYWc7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmxhZylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSlcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoZT0+ZS5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgIH0pKTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1NpbXBsZUpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL3NpbXBsZS1qb2ItcmVwb3NpdG9yeVwiO1xuXG5cblxuZXhwb3J0IGNsYXNzIFRpbWVvdXRKb2JSZXBvc2l0b3J5IGV4dGVuZHMgU2ltcGxlSm9iUmVwb3NpdG9yeXtcblxuICAgIGNyZWF0ZVRpbWVvdXRQcm9taXNlKHZhbHVlVG9SZXNvbHZlLCBkZWxheT0xKXtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmU9PntcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHZhbHVlVG9SZXNvbHZlKTtcbiAgICAgICAgICAgIH0sIGRlbGF5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSA9IGpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuaWQ9PT1qb2JSZXN1bHRJZCkpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5qb2JJbnN0YW5jZS5pZD09PWpvYkluc3RhbmNlLmlkKSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnB1c2goam9iUmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYkV4ZWN1dGlvbnMsIGV4PT5leC5pZD09PWlkKSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnB1c2goam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSA9IHByb2dyZXNzO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShwcm9ncmVzcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSA9IGZsYWc7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGZsYWcpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoZT0+ZS5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICByZW1vdmUob2JqZWN0KXsgLy9UT0RPXG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSByZXN1bHQgb2YgYSBqb2IgaW5zdGFuY2UuKi9cbmV4cG9ydCBjbGFzcyBKb2JSZXN1bHQge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGRhdGE7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgfVxufVxuIiwiZXhwb3J0IGNvbnN0IEpPQl9TVEFUVVMgPSB7XG4gICAgQ09NUExFVEVEOiAnQ09NUExFVEVEJyxcbiAgICBTVEFSVElORzogJ1NUQVJUSU5HJyxcbiAgICBTVEFSVEVEOiAnU1RBUlRFRCcsXG4gICAgU1RPUFBJTkc6ICdTVE9QUElORycsXG4gICAgU1RPUFBFRDogJ1NUT1BQRUQnLFxuICAgIEZBSUxFRDogJ0ZBSUxFRCcsXG4gICAgVU5LTk9XTjogJ1VOS05PV04nLFxuICAgIEFCQU5ET05FRDogJ0FCQU5ET05FRCcsXG4gICAgRVhFQ1VUSU5HOiAnRVhFQ1VUSU5HJyAvL2ZvciBleGl0IHN0YXR1cyBvbmx5XG59O1xuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7Sm9iUmVzdWx0fSBmcm9tIFwiLi9qb2ItcmVzdWx0XCI7XG4vKkJhc2UgY2xhc3MgZm9yIGpvYnMqL1xuLy9BIEpvYiBpcyBhbiBlbnRpdHkgdGhhdCBlbmNhcHN1bGF0ZXMgYW4gZW50aXJlIGpvYiBwcm9jZXNzICggYW4gYWJzdHJhY3Rpb24gcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iKS5cblxuZXhwb3J0IGNsYXNzIEpvYiB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIHN0ZXBzID0gW107XG5cbiAgICBpc1Jlc3RhcnRhYmxlPXRydWU7XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG4gICAgam9iUGFyYW1ldGVyc1ZhbGlkYXRvcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciA9IHRoaXMuZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpO1xuICAgICAgICB0aGlzLmpvYkRhdGFWYWxpZGF0b3IgPSB0aGlzLmdldEpvYkRhdGFWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHN0YXJ0aW5nOiBcIiwgZXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIGpvYlJlc3VsdDtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pLnRoZW4oZXhlY3V0aW9uPT57XG5cbiAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HKSB7XG4gICAgICAgICAgICAgICAgLy8gVGhlIGpvYiB3YXMgYWxyZWFkeSBzdG9wcGVkXG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gd2FzIHN0b3BwZWQ6IFwiICsgZXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICF0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih0aGlzLmpvYkRhdGFWYWxpZGF0b3IgJiYgIXRoaXMuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShleGVjdXRpb24uZ2V0RGF0YSgpKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLnVwZGF0ZVN0YXR1cyhleGVjdXRpb24sIEpPQl9TVEFUVVMuU1RBUlRFRCksIHRoaXMuZ2V0UmVzdWx0KGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT57XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uPXJlc1swXTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSByZXNbMV07XG4gICAgICAgICAgICAgICAgaWYoIWpvYlJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSBuZXcgSm9iUmVzdWx0KGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYmVmb3JlSm9iKGV4ZWN1dGlvbikpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIGNvbXBsZXRlOiBcIixleGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBleGVjdXRpbmcgam9iXCIsIGUpO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoam9iUmVzdWx0KXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KS50aGVuKCgpPT5leGVjdXRpb24pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGZhdGFsIGVycm9yIHNhdmluZyBqb2IgcmVzdWx0c1wiLCBlKTtcbiAgICAgICAgICAgIGlmKGUpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoZXhlY3V0aW9uKSwgdGhpcy51cGRhdGVQcm9ncmVzcyhleGVjdXRpb24pXSkudGhlbihyZXM9PnJlc1swXSlcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYWZ0ZXJKb2IoZXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIGVuY291bnRlcmVkIGluIGFmdGVyU3RlcCBjYWxsYmFja1wiLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICB1cGRhdGVTdGF0dXMoam9iRXhlY3V0aW9uLCBzdGF0dXMpIHtcbiAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cz1zdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGpvYkV4ZWN1dGlvbilcbiAgICB9XG5cbiAgICB1cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbi5pZCwgdGhpcy5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICAvKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgYWxsb3dpbmcgdGhlbSB0byBjb25jZW50cmF0ZSBvbiBwcm9jZXNzaW5nIGxvZ2ljIGFuZCBpZ25vcmUgbGlzdGVuZXJzLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyAnZG9FeGVjdXRlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAocGFyYW1zKSA9PiBwYXJhbXMudmFsaWRhdGUoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gdHJ1ZVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkU3RlcChzdGVwKXtcbiAgICAgICAgdGhpcy5zdGVwcy5wdXNoKHN0ZXApO1xuICAgIH1cblxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpe1xuICAgICAgICB0aHJvdyAnY3JlYXRlSm9iUGFyYW1ldGVycyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgKiBjdXJyZW50XG4gICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IGV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEID8gMSA6IDBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBjaGVja0V4ZWN1dGlvbkZsYWdzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uRmxhZyhleGVjdXRpb24uaWQpLnRoZW4oZmxhZz0+e1xuICAgICAgICAgICAgaWYoSk9CX0VYRUNVVElPTl9GTEFHLlNUT1AgPT09IGZsYWcpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdG9wKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UoZXhlY3V0aW9uLmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdGhyb3cgJ2pvYlJlc3VsdFRvQ3N2Um93cyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuL2pvYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuL3N0ZXBcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuXG4vKiBTaW1wbGUgSm9iIHRoYXQgc2VxdWVudGlhbGx5IGV4ZWN1dGVzIGEgam9iIGJ5IGl0ZXJhdGluZyB0aHJvdWdoIGl0cyBsaXN0IG9mIHN0ZXBzLiAgQW55IFN0ZXAgdGhhdCBmYWlscyB3aWxsIGZhaWwgdGhlIGpvYi4gIFRoZSBqb2IgaXNcbiBjb25zaWRlcmVkIGNvbXBsZXRlIHdoZW4gYWxsIHN0ZXBzIGhhdmUgYmVlbiBleGVjdXRlZC4qL1xuXG5leHBvcnQgY2xhc3MgU2ltcGxlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcilcbiAgICB9XG5cbiAgICBnZXRTdGVwKHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiBVdGlscy5maW5kKHRoaXMuc3RlcHMsIHM9PnMubmFtZSA9PSBzdGVwTmFtZSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dFN0ZXAoZXhlY3V0aW9uLCBqb2JSZXN1bHQpLnRoZW4obGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlVwZGF0aW5nIEpvYkV4ZWN1dGlvbiBzdGF0dXM6IFwiLCBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXM7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goLi4ubGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBwcmV2U3RlcD1udWxsLCBwcmV2U3RlcEV4ZWN1dGlvbj1udWxsKXtcbiAgICAgICAgdmFyIHN0ZXBJbmRleCA9IDA7XG4gICAgICAgIGlmKHByZXZTdGVwKXtcbiAgICAgICAgICAgIHN0ZXBJbmRleCA9IHRoaXMuc3RlcHMuaW5kZXhPZihwcmV2U3RlcCkrMTtcbiAgICAgICAgfVxuICAgICAgICBpZihzdGVwSW5kZXg+PXRoaXMuc3RlcHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocHJldlN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSB0aGlzLnN0ZXBzW3N0ZXBJbmRleF07XG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVN0ZXAoc3RlcCwgam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQpLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuQ09NUExFVEVEKXsgLy8gVGVybWluYXRlIHRoZSBqb2IgaWYgYSBzdGVwIGZhaWxzXG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCwgc3RlcCwgc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSBqb2JFeGVjdXRpb24uam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3Moam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5pc1N0b3BwaW5nKCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcC5uYW1lKVxuXG4gICAgICAgIH0pLnRoZW4obGFzdFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmICh0aGlzLnN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIGxhc3RTdGVwRXhlY3V0aW9uKSkge1xuICAgICAgICAgICAgICAgIC8vIElmIHRoZSBsYXN0IGV4ZWN1dGlvbiBvZiB0aGlzIHN0ZXAgd2FzIGluIHRoZSBzYW1lIGpvYiwgaXQncyBwcm9iYWJseSBpbnRlbnRpb25hbCBzbyB3ZSB3YW50IHRvIHJ1biBpdCBhZ2Fpbi5cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkR1cGxpY2F0ZSBzdGVwIGRldGVjdGVkIGluIGV4ZWN1dGlvbiBvZiBqb2IuIHN0ZXA6IFwiICsgc3RlcC5uYW1lICsgXCIgam9iTmFtZTogXCIsIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgIGxhc3RTdGVwRXhlY3V0aW9uID0gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGN1cnJlbnRTdGVwRXhlY3V0aW9uID0gbGFzdFN0ZXBFeGVjdXRpb247XG5cbiAgICAgICAgICAgIGlmICghdGhpcy5zaG91bGRTdGFydChjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iRXhlY3V0aW9uLCBzdGVwKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBqb2JFeGVjdXRpb24uY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwLm5hbWUpO1xuXG4gICAgICAgICAgICB2YXIgaXNDb21wbGV0ZWQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIGxhc3RTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICB2YXIgaXNSZXN0YXJ0ID0gbGFzdFN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiAhaXNDb21wbGV0ZWQ7XG4gICAgICAgICAgICB2YXIgc2tpcEV4ZWN1dGlvbiA9IGlzQ29tcGxldGVkICYmIHN0ZXAuc2tpcE9uUmVzdGFydElmQ29tcGxldGVkO1xuXG4gICAgICAgICAgICBpZiAoaXNSZXN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuY29udGFpbnNLZXkoXCJleGVjdXRlZFwiKSkge1xuICAgICAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnJlbW92ZShcImV4ZWN1dGVkXCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJza2lwcGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmFkZFN0ZXBFeGVjdXRpb24oY3VycmVudFN0ZXBFeGVjdXRpb24pLnRoZW4oKF9jdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbj1fY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgaWYoc2tpcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiU2tpcHBpbmcgY29tcGxldGVkIHN0ZXAgZXhlY3V0aW9uOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFeGVjdXRpbmcgc3RlcDogW1wiICsgc3RlcC5uYW1lICsgXCJdXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGVwLmV4ZWN1dGUoY3VycmVudFN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcImV4ZWN1dGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH0pLmNhdGNoIChlID0+IHtcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e3Rocm93IGV9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSkudGhlbigoY3VycmVudFN0ZXBFeGVjdXRpb24pPT57XG4gICAgICAgICAgICBpZiAoY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBJTkdcbiAgICAgICAgICAgICAgICB8fCBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIGpvYiBnZXRzIHRoZSBtZXNzYWdlIHRoYXQgaXQgaXMgc3RvcHBpbmdcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICAgICAgICAgICAgICAvLyB0aHJvdyBuZXcgRXJyb3IoXCJKb2IgaW50ZXJydXB0ZWQgYnkgc3RlcCBleGVjdXRpb25cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pLnRoZW4oKCk9PmN1cnJlbnRTdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIHN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCA9PSBqb2JFeGVjdXRpb24uaWRcbiAgICB9XG5cbiAgICBzaG91bGRTdGFydChsYXN0U3RlcEV4ZWN1dGlvbiwgZXhlY3V0aW9uLCBzdGVwKSB7XG4gICAgICAgIHZhciBzdGVwU3RhdHVzO1xuICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24gPT0gbnVsbCkge1xuICAgICAgICAgICAgc3RlcFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHN0ZXBTdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkNhbm5vdCByZXN0YXJ0IHN0ZXAgZnJvbSBVTktOT1dOIHN0YXR1c1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHN0ZXBTdGF0dXMgIT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgc3RlcC5pc1Jlc3RhcnRhYmxlO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHZhciBjb21wbGV0ZWRTdGVwcyA9IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGg7XG4gICAgICAgIGxldCBwcm9ncmVzcyA9IHtcbiAgICAgICAgICAgIHRvdGFsOiB0aGlzLnN0ZXBzLmxlbmd0aCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IGNvbXBsZXRlZFN0ZXBzXG4gICAgICAgIH07XG4gICAgICAgIGlmKCFjb21wbGV0ZWRTdGVwcyl7XG4gICAgICAgICAgICByZXR1cm4gcHJvZ3Jlc3NcbiAgICAgICAgfVxuICAgICAgICBpZihKT0JfU1RBVFVTLkNPTVBMRVRFRCAhPT0gZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zW2V4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGgtMV0uc3RhdHVzKXtcbiAgICAgICAgICAgIHByb2dyZXNzLmN1cnJlbnQtLTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwcm9ncmVzcztcbiAgICB9XG5cbiAgICBhZGRTdGVwKCl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGg9PT0xKXtcbiAgICAgICAgICAgIHJldHVybiBzdXBlci5hZGRTdGVwKGFyZ3VtZW50c1swXSlcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IG5ldyBTdGVwKGFyZ3VtZW50c1swXSwgdGhpcy5qb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgc3RlcC5kb0V4ZWN1dGUgPSBhcmd1bWVudHNbMV07XG4gICAgICAgIHJldHVybiBzdXBlci5hZGRTdGVwKHN0ZXApO1xuICAgIH1cblxufVxuIiwiZXhwb3J0IGNsYXNzIFN0ZXBFeGVjdXRpb25MaXN0ZW5lciB7XG4gICAgLypDYWxsZWQgYmVmb3JlIGEgc3RlcCBleGVjdXRlcyovXG4gICAgYmVmb3JlU3RlcChqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cblxuICAgIC8qQ2FsbGVkIGFmdGVyIGNvbXBsZXRpb24gb2YgYSBzdGVwLiBDYWxsZWQgYWZ0ZXIgYm90aCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgZXhlY3V0aW9ucyovXG4gICAgYWZ0ZXJTdGVwKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uXCI7XG5cbi8qXG4gcmVwcmVzZW50YXRpb24gb2YgdGhlIGV4ZWN1dGlvbiBvZiBhIHN0ZXBcbiAqL1xuZXhwb3J0IGNsYXNzIFN0ZXBFeGVjdXRpb24ge1xuICAgIGlkO1xuICAgIHN0ZXBOYW1lO1xuICAgIGpvYkV4ZWN1dGlvbjtcblxuICAgIHN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRVhFQ1VUSU5HO1xuICAgIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpOyAvL2V4ZWN1dGlvbiBjb250ZXh0IGZvciBzaW5nbGUgc3RlcCBsZXZlbCxcblxuICAgIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgZW5kVGltZSA9IG51bGw7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgdGVybWluYXRlT25seSA9IGZhbHNlOyAvL2ZsYWcgdG8gaW5kaWNhdGUgdGhhdCBhbiBleGVjdXRpb24gc2hvdWxkIGhhbHRcbiAgICBmYWlsdXJlRXhjZXB0aW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3Ioc3RlcE5hbWUsIGpvYkV4ZWN1dGlvbiwgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnN0ZXBOYW1lID0gc3RlcE5hbWU7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbklkID0gam9iRXhlY3V0aW9uLmlkO1xuICAgIH1cblxuICAgIGdldEpvYlBhcmFtZXRlcnMoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnM7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dDtcbiAgICB9XG5cbiAgICBnZXREYXRhKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgfVxuXG4gICAgZ2V0RFRPKGZpbHRlcmVkUHJvcGVydGllcz1bXSwgZGVlcENsb25lID0gdHJ1ZSl7XG5cbiAgICAgICAgdmFyIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVEZWVwV2l0aDtcbiAgICAgICAgaWYoIWRlZXBDbG9uZSkge1xuICAgICAgICAgICAgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZVdpdGg7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuYXNzaWduKHt9LCBjbG9uZU1ldGhvZCh0aGlzLCAodmFsdWUsIGtleSwgb2JqZWN0LCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZihmaWx0ZXJlZFByb3BlcnRpZXMuaW5kZXhPZihrZXkpPi0xKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKFtcImV4ZWN1dGlvbkNvbnRleHRcIl0uaW5kZXhPZihrZXkpPi0xKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHZhbHVlIGluc3RhbmNlb2YgRXJyb3Ipe1xuICAgICAgICAgICAgICAgIHJldHVybiBVdGlscy5nZXRFcnJvckRUTyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oW1wic3RlcEV4ZWN1dGlvbnNcIl0sIGRlZXBDbG9uZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5cbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgY29uZmlndXJhdGlvbiBvZiBhIGpvYiBzdGVwKi9cbmV4cG9ydCBjbGFzcyBTdGVwIHtcblxuICAgIGlkO1xuICAgIG5hbWU7XG4gICAgaXNSZXN0YXJ0YWJsZSA9IHRydWU7XG4gICAgc2tpcE9uUmVzdGFydElmQ29tcGxldGVkPXRydWU7XG4gICAgc3RlcHMgPSBbXTtcbiAgICBleGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgc2V0Sm9iUmVwb3NpdG9yeShqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgLypQcm9jZXNzIHRoZSBzdGVwIGFuZCBhc3NpZ24gcHJvZ3Jlc3MgYW5kIHN0YXR1cyBtZXRhIGluZm9ybWF0aW9uIHRvIHRoZSBTdGVwRXhlY3V0aW9uIHByb3ZpZGVkKi9cbiAgICBleGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBsb2cuZGVidWcoXCJFeGVjdXRpbmcgc3RlcDogbmFtZT1cIiArIHRoaXMubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJURUQ7XG4gICAgICAgIHZhciBleGl0U3RhdHVzO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShzdGVwRXhlY3V0aW9uKS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkVYRUNVVElORztcblxuICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYmVmb3JlU3RlcChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB0aGlzLm9wZW4oc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkudGhlbihfc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbiA9IF9zdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cztcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgc29tZW9uZSBpcyB0cnlpbmcgdG8gc3RvcCB1c1xuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24udGVybWluYXRlT25seSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBOZWVkIHRvIHVwZ3JhZGUgaGVyZSBub3Qgc2V0LCBpbiBjYXNlIHRoZSBleGVjdXRpb24gd2FzIHN0b3BwZWRcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICBsb2cuZGVidWcoXCJTdGVwIGV4ZWN1dGlvbiBzdWNjZXNzOiBuYW1lPVwiICsgdGhpcy5uYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gdGhpcy5kZXRlcm1pbmVKb2JTdGF0dXMoZSk7XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gc3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG5cbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQRUQpIHtcbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkVuY291bnRlcmVkIGludGVycnVwdGlvbiBleGVjdXRpbmcgc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBhbiBlcnJvciBleGVjdXRpbmcgc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IGV4aXRTdGF0dXM7XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYWZ0ZXJTdGVwKHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIGluIGFmdGVyU3RlcCBjYWxsYmFjayBpbiBzdGVwIFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gZXhpdFN0YXR1cztcblxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbG9zZShzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gd2hpbGUgY2xvc2luZyBzdGVwIGV4ZWN1dGlvbiByZXNvdXJjZXMgaW4gc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2Uoc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIHdoaWxlIGNsb3Npbmcgc3RlcCBleGVjdXRpb24gcmVzb3VyY2VzIGluIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZG9FeGVjdXRpb25SZWxlYXNlKCk7XG5cbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlN0ZXAgZXhlY3V0aW9uIGNvbXBsZXRlOiBcIiArIHN0ZXBFeGVjdXRpb24uaWQpO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgZGV0ZXJtaW5lSm9iU3RhdHVzKGUpIHtcbiAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBleGVjdXRlIGJ1c2luZXNzIGxvZ2ljLiBTdWJjbGFzc2VzIHNob3VsZCBzZXQgdGhlIGV4aXRTdGF0dXMgb24gdGhlXG4gICAgICogU3RlcEV4ZWN1dGlvbiBiZWZvcmUgcmV0dXJuaW5nLiBNdXN0IHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICovXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm92aWRlIGNhbGxiYWNrcyB0byB0aGVpciBjb2xsYWJvcmF0b3JzIGF0IHRoZSBiZWdpbm5pbmcgb2YgYSBzdGVwLCB0byBvcGVuIG9yXG4gICAgICogYWNxdWlyZSByZXNvdXJjZXMuIERvZXMgbm90aGluZyBieSBkZWZhdWx0LlxuICAgICAqL1xuICAgIG9wZW4oZXhlY3V0aW9uQ29udGV4dCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm92aWRlIGNhbGxiYWNrcyB0byB0aGVpciBjb2xsYWJvcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBzdGVwIChyaWdodCBhdCB0aGUgZW5kXG4gICAgICogb2YgdGhlIGZpbmFsbHkgYmxvY2spLCB0byBjbG9zZSBvciByZWxlYXNlIHJlc291cmNlcy4gRG9lcyBub3RoaW5nIGJ5IGRlZmF1bHQuXG4gICAgICovXG4gICAgY2xvc2UoZXhlY3V0aW9uQ29udGV4dCkge1xuICAgIH1cblxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgY3VycmVudDogc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEID8gMSA6IDBcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCAqIGFzIGVuZ2luZSBmcm9tICcuL2VuZ2luZS9pbmRleCdcblxuZXhwb3J0IHtlbmdpbmV9XG5leHBvcnQgKiBmcm9tICcuL2pvYnMtbWFuYWdlcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXdvcmtlcidcblxuXG5cbiIsImltcG9ydCB7Sm9iRXhlY3V0aW9uTGlzdGVuZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi9lbmdpbmUvam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZU1hbmFnZXJDb25maWcge1xuICAgIG9uSm9iU3RhcnRlZCA9ICgpID0+IHt9O1xuICAgIG9uSm9iQ29tcGxldGVkID0gcmVzdWx0ID0+IHt9O1xuICAgIG9uSm9iRmFpbGVkID0gZXJyb3JzID0+IHt9O1xuICAgIG9uSm9iU3RvcHBlZCA9ICgpID0+IHt9O1xuICAgIG9uSm9iVGVybWluYXRlZCA9ICgpID0+IHt9O1xuICAgIG9uUHJvZ3Jlc3MgPSAocHJvZ3Jlc3MpID0+IHt9O1xuICAgIGNhbGxiYWNrc1RoaXNBcmc7XG4gICAgdXBkYXRlSW50ZXJ2YWwgPSAxMDA7XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKmNvbnZlbmllbmNlIGNsYXNzIGZvciBtYW5hZ2luZyBhbmQgdHJhY2tpbmcgam9iIGluc3RhbmNlIHByb2dyZXNzKi9cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZU1hbmFnZXIgZXh0ZW5kcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG5cbiAgICBqb2JzTWFuZ2VyO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGNvbmZpZztcblxuICAgIGxhc3RKb2JFeGVjdXRpb247XG4gICAgbGFzdFVwZGF0ZVRpbWU7XG4gICAgcHJvZ3Jlc3MgPSBudWxsO1xuXG4gICAgY29uc3RydWN0b3Ioam9ic01hbmdlciwgam9iSW5zdGFuY2VPckV4ZWN1dGlvbiwgY29uZmlnKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IEpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmpvYnNNYW5nZXIgPSBqb2JzTWFuZ2VyO1xuICAgICAgICBpZiAoam9iSW5zdGFuY2VPckV4ZWN1dGlvbiBpbnN0YW5jZW9mIEpvYkluc3RhbmNlKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2VPckV4ZWN1dGlvbjtcbiAgICAgICAgICAgIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iSW5zdGFuY2VPckV4ZWN1dGlvbjtcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSB0aGlzLmxhc3RKb2JFeGVjdXRpb24uam9iSW5zdGFuY2U7XG4gICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sYXN0Sm9iRXhlY3V0aW9uICYmICF0aGlzLmxhc3RKb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgIHRoaXMuYWZ0ZXJKb2IodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBqb2JzTWFuZ2VyLnJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG4gICAgfVxuXG4gICAgY2hlY2tQcm9ncmVzcygpIHtcblxuICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgIGlmICh0aGlzLnRlcm1pbmF0ZWQgfHwgIXRoaXMubGFzdEpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSB8fCB0aGlzLmdldFByb2dyZXNzUGVyY2VudHModGhpcy5wcm9ncmVzcykgPT09IDEwMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuam9ic01hbmdlci5nZXRQcm9ncmVzcyh0aGlzLmxhc3RKb2JFeGVjdXRpb24pLnRoZW4ocHJvZ3Jlc3M9PiB7XG4gICAgICAgICAgICB0aGlzLmxhc3RVcGRhdGVUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIGlmIChwcm9ncmVzcykge1xuICAgICAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3MgPSBwcm9ncmVzcztcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vblByb2dyZXNzLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCBwcm9ncmVzcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHNlbGYuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSwgdGhpcy5jb25maWcudXBkYXRlSW50ZXJ2YWwpXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkICE9PSB0aGlzLmpvYkluc3RhbmNlLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIHRoaXMuY29uZmlnLm9uSm9iU3RhcnRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcyk7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3NQZXJjZW50cyhwcm9ncmVzcykge1xuICAgICAgICBpZiAoIXByb2dyZXNzKSB7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvZ3Jlc3MuY3VycmVudCAqIDEwMCAvIHByb2dyZXNzLnRvdGFsO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzRnJvbUV4ZWN1dGlvbihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9ic01hbmdlci5nZXRKb2JCeU5hbWUoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gam9iLmdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgIT09IHRoaXMuam9iSW5zdGFuY2UuaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIGlmIChKT0JfU1RBVFVTLkNPTVBMRVRFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcbiAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3MgPSB0aGlzLmdldFByb2dyZXNzRnJvbUV4ZWN1dGlvbihqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Qcm9ncmVzcy5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgdGhpcy5wcm9ncmVzcyk7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZ2V0UmVzdWx0KGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZSkudGhlbihyZXN1bHQ9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JDb21wbGV0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHJlc3VsdC5kYXRhKTtcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0gZWxzZSBpZiAoSk9CX1NUQVRVUy5GQUlMRUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iRmFpbGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCBqb2JFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoSk9CX1NUQVRVUy5TVE9QUEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlN0b3BwZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihmb3JjZVVwZGF0ZSA9IGZhbHNlKSB7XG4gICAgICAgIGlmICghdGhpcy5sYXN0Sm9iRXhlY3V0aW9uIHx8IGZvcmNlVXBkYXRlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2UodGhpcy5qb2JJbnN0YW5jZSkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gamU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgc3RvcCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnN0b3AodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnJ1bih0aGlzLmpvYkluc3RhbmNlLmpvYk5hbWUsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzLnZhbHVlcywgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmdldERhdGEoKSkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqZTtcbiAgICAgICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB0ZXJtaW5hdGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci50ZXJtaW5hdGUodGhpcy5qb2JJbnN0YW5jZSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnRlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iVGVybWluYXRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMubGFzdEpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJleHBvcnQgY2xhc3MgSm9iV29ya2Vye1xuXG4gICAgd29ya2VyO1xuICAgIGxpc3RlbmVycyA9IHt9O1xuICAgIGRlZmF1bHRMaXN0ZW5lcjtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgZGVmYXVsdExpc3RlbmVyLCBvbkVycm9yKXtcbiAgICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgICAgdGhpcy53b3JrZXIgPSBuZXcgV29ya2VyKHVybCk7XG4gICAgICAgIHRoaXMuZGVmYXVsdExpc3RlbmVyID0gZGVmYXVsdExpc3RlbmVyIHx8IGZ1bmN0aW9uKCkge307XG4gICAgICAgIGlmIChvbkVycm9yKSB7dGhpcy53b3JrZXIub25lcnJvciA9IG9uRXJyb3I7fVxuXG4gICAgICAgIHRoaXMud29ya2VyLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJlxuICAgICAgICAgICAgICAgIGV2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInKSAmJiBldmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZEFyZ3VtZW50cycpKSB7XG4gICAgICAgICAgICAgICAgdmFyIGxpc3RlbmVyID0gaW5zdGFuY2UubGlzdGVuZXJzW2V2ZW50LmRhdGEucXVlcnlNZXRob2RMaXN0ZW5lcl07XG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBldmVudC5kYXRhLnF1ZXJ5TWV0aG9kQXJndW1lbnRzO1xuICAgICAgICAgICAgICAgIGlmKGxpc3RlbmVyLmRlc2VyaWFsaXplcil7XG4gICAgICAgICAgICAgICAgICAgIGFyZ3MgPSBsaXN0ZW5lci5kZXNlcmlhbGl6ZXIoYXJncyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmZuLmFwcGx5KGxpc3RlbmVyLnRoaXNBcmcsIGFyZ3MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmRlZmF1bHRMaXN0ZW5lci5jYWxsKGluc3RhbmNlLCBldmVudC5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc2VuZFF1ZXJ5KCkge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0pvYldvcmtlci5zZW5kUXVlcnkgdGFrZXMgYXQgbGVhc3Qgb25lIGFyZ3VtZW50Jyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kJzogYXJndW1lbnRzWzBdLFxuICAgICAgICAgICAgJ3F1ZXJ5QXJndW1lbnRzJzogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBydW5Kb2Ioam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTyl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdydW5Kb2InLCBqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKVxuICAgIH1cblxuICAgIGV4ZWN1dGVKb2Ioam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgnZXhlY3V0ZUpvYicsIGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIHJlY29tcHV0ZShkYXRhRFRPLCBydWxlTmFtZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdyZWNvbXB1dGUnLCBkYXRhRFRPLCBydWxlTmFtZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYylcbiAgICB9XG5cbiAgICBwb3N0TWVzc2FnZShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHRlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy53b3JrZXIudGVybWluYXRlKCk7XG4gICAgfVxuXG4gICAgYWRkTGlzdGVuZXIobmFtZSwgbGlzdGVuZXIsIHRoaXNBcmcsIGRlc2VyaWFsaXplcikge1xuICAgICAgICB0aGlzLmxpc3RlbmVyc1tuYW1lXSA9IHtcbiAgICAgICAgICAgIGZuOiBsaXN0ZW5lcixcbiAgICAgICAgICAgIHRoaXNBcmc6IHRoaXNBcmcgfHwgdGhpcyxcbiAgICAgICAgICAgIGRlc2VyaWFsaXplcjogZGVzZXJpYWxpemVyXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmVtb3ZlTGlzdGVuZXIobmFtZSkge1xuICAgICAgICBkZWxldGUgdGhpcy5saXN0ZW5lcnNbbmFtZV07XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge0pvYkxhdW5jaGVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWxhdW5jaGVyXCI7XG5pbXBvcnQge0pvYldvcmtlcn0gZnJvbSBcIi4vam9iLXdvcmtlclwiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb25MaXN0ZW5lcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXJcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0lkYkpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5pbXBvcnQge1JlY29tcHV0ZUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2JcIjtcbmltcG9ydCB7UHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Byb2JhYmlsaXN0aWMvcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7VGltZW91dEpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS90aW1lb3V0LWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1Rvcm5hZG9EaWFncmFtSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy90b3JuYWRvLWRpYWdyYW0vdG9ybmFkby1kaWFncmFtLWpvYlwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTaW1wbGVKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge0xlYWd1ZVRhYmxlSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9sZWFndWUtdGFibGUvbGVhZ3VlLXRhYmxlLWpvYlwiO1xuXG5cbmV4cG9ydCBjbGFzcyBKb2JzTWFuYWdlckNvbmZpZyB7XG5cbiAgICB3b3JrZXJVcmwgPSBudWxsO1xuICAgIHJlcG9zaXRvcnlUeXBlID0gJ2lkYic7XG4gICAgY2xlYXJSZXBvc2l0b3J5ID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgSm9ic01hbmFnZXIgZXh0ZW5kcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG5cblxuICAgIHVzZVdvcmtlcjtcbiAgICBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgam9iV29ya2VyO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcbiAgICBqb2JMYXVuY2hlcjtcblxuICAgIGpvYkV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuXG4gICAgYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXMgPSB7fTtcbiAgICBqb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZSA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgY29uZmlnKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuc2V0Q29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG5cblxuICAgICAgICB0aGlzLnVzZVdvcmtlciA9ICEhdGhpcy5jb25maWcud29ya2VyVXJsO1xuICAgICAgICBpZiAodGhpcy51c2VXb3JrZXIpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdFdvcmtlcih0aGlzLmNvbmZpZy53b3JrZXJVcmwpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5pbml0UmVwb3NpdG9yeSgpO1xuXG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2JzKCk7XG5cblxuXG4gICAgICAgIHRoaXMuam9iTGF1bmNoZXIgPSBuZXcgSm9iTGF1bmNoZXIodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmpvYldvcmtlciwgKGRhdGEpPT50aGlzLnNlcmlhbGl6ZURhdGEoZGF0YSkpO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgSm9ic01hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgaW5pdFJlcG9zaXRvcnkoKSB7XG4gICAgICAgIGlmKHRoaXMuY29uZmlnLnJlcG9zaXRvcnlUeXBlID09PSAnaWRiJyl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgSWRiSm9iUmVwb3NpdG9yeSh0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJldml2ZXIoKSwgJ3NkLWpvYi1yZXBvc2l0b3J5JywgdGhpcy5jb25maWcuY2xlYXJSZXBvc2l0b3J5KTtcbiAgICAgICAgfWVsc2UgaWYoJ3RpbWVvdXQnKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBUaW1lb3V0Sm9iUmVwb3NpdG9yeSh0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJldml2ZXIoKSk7XG4gICAgICAgIH1lbHNlIGlmKCdzaW1wbGUnKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBTaW1wbGVKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBsb2cuZXJyb3IoJ0pvYnNNYW5hZ2VyIGNvbmZpZ3VyYXRpb24gZXJyb3IhIFVua25vd24gcmVwb3NpdG9yeSB0eXBlOiAnK3RoaXMuY29uZmlnLnJlcG9zaXRvcnlUeXBlKycuIFVzaW5nIGRlZmF1bHQ6IGlkYicpO1xuICAgICAgICAgICAgdGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUgPSAnaWRiJztcbiAgICAgICAgICAgIHRoaXMuaW5pdFJlcG9zaXRvcnkoKVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzZXJpYWxpemVEYXRhKGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGRhdGEuc2VyaWFsaXplKHRydWUsIGZhbHNlLCBmYWxzZSwgdGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXBsYWNlcigpKTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzcyhqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHZhciBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIGlmICghVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpIHtcbiAgICAgICAgICAgIGlkID0gam9iRXhlY3V0aW9uT3JJZC5pZFxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3MoaWQpO1xuICAgIH1cblxuICAgIGdldFJlc3VsdChqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIHJ1bihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iTGF1bmNoZXIucnVuKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCB8fCAham9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vam9iIHdhcyBkZWxlZ2F0ZWQgdG8gd29ya2VyIGFuZCBpcyBzdGlsbCBydW5uaW5nXG5cbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbi5pZF0gPSByZXNvbHZlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JMYXVuY2hlci5leGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgIH1cblxuICAgIHN0b3Aoam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICB2YXIgaWQgPSBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICBpZiAoIVV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKSB7XG4gICAgICAgICAgICBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQuaWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkpvYiBFeGVjdXRpb24gbm90IGZvdW5kOiBcIiArIGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICBsb2cud2FybihcIkpvYiBFeGVjdXRpb24gbm90IHJ1bm5pbmcsIHN0YXR1czogXCIgKyBqb2JFeGVjdXRpb24uc3RhdHVzICsgXCIsIGVuZFRpbWU6IFwiICsgam9iRXhlY3V0aW9uLmVuZFRpbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uLmlkLCBKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCkudGhlbigoKT0+am9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLypzdG9wIGpvYiBleGVjdXRpb24gaWYgcnVubmluZyBhbmQgZGVsZXRlIGpvYiBpbnN0YW5jZSBmcm9tIHJlcG9zaXRvcnkqL1xuICAgIHRlcm1pbmF0ZShqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICBpZihqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbi5pZCwgSk9CX0VYRUNVVElPTl9GTEFHLlNUT1ApLnRoZW4oKCk9PmpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2VzVG9UZXJtaW5hdGVbam9iSW5zdGFuY2UuaWRdPWpvYkluc3RhbmNlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShqb2JOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgIH1cblxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzKSB7XG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVyc1ZhbHVlcyk7XG4gICAgfVxuXG5cbiAgICAvKlJldHVybnMgYSBwcm9taXNlKi9cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgaWYgKHRoaXMudXNlV29ya2VyKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JXb3JrZXI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEoam9iUGFyYW1ldGVycyBpbnN0YW5jZW9mIEpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICBqb2JQYXJhbWV0ZXJzID0gdGhpcy5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIGluaXRXb3JrZXIod29ya2VyVXJsKSB7XG4gICAgICAgIHRoaXMuam9iV29ya2VyID0gbmV3IEpvYldvcmtlcih3b3JrZXJVcmwsICgpPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoJ2Vycm9yIGluIHdvcmtlcicsIGFyZ3VtZW50cyk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgYXJnc0Rlc2VyaWFsaXplciA9IChhcmdzKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBbdGhpcy5qb2JSZXBvc2l0b3J5LnJldml2ZUpvYkV4ZWN1dGlvbihhcmdzWzBdKV1cbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImJlZm9yZUpvYlwiLCB0aGlzLmJlZm9yZUpvYiwgdGhpcywgYXJnc0Rlc2VyaWFsaXplcik7XG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiYWZ0ZXJKb2JcIiwgdGhpcy5hZnRlckpvYiwgdGhpcywgYXJnc0Rlc2VyaWFsaXplcik7XG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiam9iRmF0YWxFcnJvclwiLCB0aGlzLm9uSm9iRmF0YWxFcnJvciwgdGhpcyk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2JzKCkge1xuXG4gICAgICAgIGxldCBzZW5zaXRpdml0eUFuYWx5c2lzSm9iID0gbmV3IFNlbnNpdGl2aXR5QW5hbHlzaXNKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIGxldCBwcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiA9IG5ldyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgaWYoIVV0aWxzLmlzV29ya2VyKCkpe1xuICAgICAgICAgICAgc2Vuc2l0aXZpdHlBbmFseXNpc0pvYi5zZXRCYXRjaFNpemUoMSk7XG4gICAgICAgICAgICBwcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYi5zZXRCYXRjaFNpemUoMSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKHNlbnNpdGl2aXR5QW5hbHlzaXNKb2IpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBUb3JuYWRvRGlhZ3JhbUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IocHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBSZWNvbXB1dGVKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBMZWFndWVUYWJsZUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5yZWdpc3RlckpvYihqb2IpO1xuICAgICAgICBqb2IucmVnaXN0ZXJFeGVjdXRpb25MaXN0ZW5lcih0aGlzKVxuICAgIH1cblxuICAgIHJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKSB7XG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJiZWZvcmVKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5iZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImFmdGVySm9iXCIsIHRoaXMudXNlV29ya2VyLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGw9PmwuYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXTtcbiAgICAgICAgaWYgKHByb21pc2VSZXNvbHZlKSB7XG4gICAgICAgICAgICBwcm9taXNlUmVzb2x2ZShqb2JFeGVjdXRpb24pXG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZF0pe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZSwgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgb25Kb2JGYXRhbEVycm9yKGpvYkV4ZWN1dGlvbklkLCBlcnJvcil7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uSWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbklkKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBpZihlcnJvcil7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgIH1cbiAgICAgICAgbG9nLmRlYnVnKCdvbkpvYkZhdGFsRXJyb3InLCBqb2JFeGVjdXRpb25JZCwgZXJyb3IpO1xuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge1xuICAgIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlLFxuICAgIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLFxuICAgIE1heGlNaW5SdWxlLFxuICAgIE1heGlNYXhSdWxlLFxuICAgIE1pbmlNaW5SdWxlLFxuICAgIE1pbmlNYXhSdWxlXG59IGZyb20gXCIuL3J1bGVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQgKiBhcyBtb2RlbCBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7TWluTWF4UnVsZX0gZnJvbSBcIi4vcnVsZXMvbWluLW1heC1ydWxlXCI7XG5pbXBvcnQge01heE1pblJ1bGV9IGZyb20gXCIuL3J1bGVzL21heC1taW4tcnVsZVwiO1xuaW1wb3J0IHtNaW5NaW5SdWxlfSBmcm9tIFwiLi9ydWxlcy9taW4tbWluLXJ1bGVcIjtcbmltcG9ydCB7TWF4TWF4UnVsZX0gZnJvbSBcIi4vcnVsZXMvbWF4LW1heC1ydWxlXCI7XG5cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxlc01hbmFnZXJ7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGN1cnJlbnRSdWxlO1xuICAgIHJ1bGVCeU5hbWUgPSB7fTtcbiAgICBydWxlcyA9IFtdO1xuXG5cbiAgICBmbGlwUGFpciA9IHt9O1xuICAgIHBheW9mZkluZGV4ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUsIGN1cnJlbnRSdWxlTmFtZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWF4aU1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1heGlNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNaW5pTWluUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWluaU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuXG4gICAgICAgIGxldCBtaW5NYXggPSBuZXcgTWluTWF4UnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1pbk1heCk7XG4gICAgICAgIGxldCBtYXhNaW4gPSBuZXcgTWF4TWluUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1heE1pbik7XG4gICAgICAgIHRoaXMuYWRkRmxpcFBhaXIobWluTWF4LCBtYXhNaW4pO1xuXG4gICAgICAgIGxldCBtaW5NaW4gPSBuZXcgTWluTWluUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1pbk1pbik7XG4gICAgICAgIGxldCBtYXhNYXggPSBuZXcgTWF4TWF4UnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1heE1heCk7XG5cblxuICAgICAgICBpZiAoY3VycmVudFJ1bGVOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlQnlOYW1lW2N1cnJlbnRSdWxlTmFtZV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlc1swXTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG5cbiAgICBzZXRQYXlvZmZJbmRleChwYXlvZmZJbmRleCl7XG4gICAgICAgIHRoaXMucGF5b2ZmSW5kZXggPSBwYXlvZmZJbmRleCB8fCAwO1xuICAgIH1cblxuICAgIGFkZFJ1bGUocnVsZSl7XG4gICAgICAgIHRoaXMucnVsZUJ5TmFtZVtydWxlLm5hbWVdPXJ1bGU7XG4gICAgICAgIHRoaXMucnVsZXMucHVzaChydWxlKTtcbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgIHJldHVybiAhIXRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV1cbiAgICB9XG5cbiAgICBzZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXTtcbiAgICB9XG5cbiAgICBmbGlwUnVsZSgpe1xuICAgICAgICB2YXIgZmxpcHBlZCA9IHRoaXMuZmxpcFBhaXJbdGhpcy5jdXJyZW50UnVsZS5uYW1lXTtcbiAgICAgICAgaWYoZmxpcHBlZCl7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gZmxpcHBlZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZURlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KXtcbiAgICAgICAgdGhpcy5ydWxlcy5maWx0ZXIocj0+ci5tdWx0aUNyaXRlcmlhKS5mb3JFYWNoKHI9PnIuc2V0RGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpKTtcbiAgICB9XG5cbiAgICByZWNvbXB1dGUoZGF0YU1vZGVsLCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0aW5nIHJ1bGVzLCBhbGw6ICcrYWxsUnVsZXMpO1xuXG4gICAgICAgIGRhdGFNb2RlbC5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5yZWNvbXB1dGVUcmVlKG4sIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB0aW1lICA9IChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIHN0YXJ0VGltZS8xMDAwKTtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGF0aW9uIHRvb2sgJyt0aW1lKydzJyk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMgZm9yIHRyZWUgLi4uJywgcm9vdCk7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuXG4gICAgICAgIHZhciBydWxlcyAgPSBbdGhpcy5jdXJyZW50UnVsZV07XG4gICAgICAgIGlmKGFsbFJ1bGVzKXtcbiAgICAgICAgICAgIHJ1bGVzID0gdGhpcy5ydWxlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJ1bGVzLmZvckVhY2gocnVsZT0+IHtcbiAgICAgICAgICAgIHJ1bGUuc2V0UGF5b2ZmSW5kZXgodGhpcy5wYXlvZmZJbmRleCk7XG4gICAgICAgICAgICBydWxlLnNldERlY2lzaW9uUG9saWN5KGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgICAgIHJ1bGUuY29tcHV0ZVBheW9mZihyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY29tcHV0ZU9wdGltYWwocm9vdCk7XG4gICAgICAgICAgICBydWxlLmNsZWFyRGVjaXNpb25Qb2xpY3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lKS8xMDAwO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cblxuICAgIGdldE5vZGVEaXNwbGF5VmFsdWUobm9kZSwgbmFtZSkge1xuICAgICAgICByZXR1cm4gbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgbmFtZSlcblxuICAgIH1cblxuICAgIGdldEVkZ2VEaXNwbGF5VmFsdWUoZSwgbmFtZSl7XG4gICAgICAgIGlmKG5hbWU9PT0ncHJvYmFiaWxpdHknKXtcbiAgICAgICAgICAgIGlmKGUucGFyZW50Tm9kZSBpbnN0YW5jZW9mIG1vZGVsLmRvbWFpbi5EZWNpc2lvbk5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCAncHJvYmFiaWxpdHknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGUucGFyZW50Tm9kZSBpbnN0YW5jZW9mIG1vZGVsLmRvbWFpbi5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgaWYobmFtZT09PSdwYXlvZmYnKXtcbiAgICAgICAgICAgIGlmKHRoaXMuY3VycmVudFJ1bGUubXVsdGlDcml0ZXJpYSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncGF5b2ZmJyk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmZbJyArdGhpcy5wYXlvZmZJbmRleCArICddJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J29wdGltYWwnKXtcbiAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCAnb3B0aW1hbCcpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRGbGlwUGFpcihydWxlMSwgcnVsZTIpIHtcbiAgICAgICAgdGhpcy5mbGlwUGFpcltydWxlMS5uYW1lXSA9IHJ1bGUyO1xuICAgICAgICB0aGlzLmZsaXBQYWlyW3J1bGUyLm5hbWVdID0gcnVsZTE7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gJ3NkLXV0aWxzJ1xuXG4vKmV4cGVjdGVkIHZhbHVlIG1heGltaXphdGlvbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdleHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSkscGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKmV4cGVjdGVkIHZhbHVlIG1pbmltaXphdGlvbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdleHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmPTAsIHByb2JhYmlsaXR5VG9FbnRlcj0xKXtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSl7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGlmICggdGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpICkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJleHBvcnQgKiBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWluLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWluLXJ1bGUnXG5cblxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNYXhNYXhSdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXgtbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhNYXhSdWxlLk5BTUUsIFsxLCAxXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNYXhNaW5SdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXgtbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhNaW5SdWxlLk5BTUUsIFsxLCAtMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWF4UnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk8YmVzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC9iZXN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1heEJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWluUnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWluTWF4UnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluLW1heCc7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluTWF4UnVsZS5OQU1FLCBbLTEsIDFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1pbk1pblJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbi1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbk1pblJ1bGUuTkFNRSwgWy0xLCAtMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWF4UnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWluUnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKT53b3JzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC93b3JzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5taW5CeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gXCIuL29iamVjdGl2ZS1ydWxlXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNdWx0aUNyaXRlcmlhUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGUge1xuXG4gICAgY3JpdGVyaW9uMVdlaWdodCA9IDE7XG4gICAgcGF5b2ZmQ29lZmZzID0gWzEsIC0xXTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIHBheW9mZkNvZWZmcywgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihuYW1lLCB0cnVlLCBleHByZXNzaW9uRW5naW5lLCB0cnVlKTtcbiAgICAgICAgdGhpcy5wYXlvZmZDb2VmZnMgPSBwYXlvZmZDb2VmZnM7XG5cbiAgICB9XG5cbiAgICBzZXREZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChjcml0ZXJpb24xV2VpZ2h0KSB7XG4gICAgICAgIHRoaXMuY3JpdGVyaW9uMVdlaWdodCA9IGNyaXRlcmlvbjFXZWlnaHQ7XG4gICAgfVxuXG4gICAgLy8gcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmLCBhZ2dyZWdhdGVkUGF5b2ZmIC0gYWdncmVnYXRlZCBwYXlvZmYgYWxvbmcgcGF0aFxuICAgIGNvbXB1dGVQYXlvZmYobm9kZSwgcGF5b2ZmID0gWzAsIDBdLCBhZ2dyZWdhdGVkUGF5b2ZmID0gWzAsIDBdKSB7XG4gICAgICAgIHZhciBjaGlsZHJlblBheW9mZiA9IFswLCAwXTtcbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSB7XG5cbiAgICAgICAgICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDaGlsZCA9IC1JbmZpbml0eTtcblxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGJhc2VQYXlvZmZzID0gW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkUGF5b2ZmID0gdGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCBiYXNlUGF5b2ZmcywgW3RoaXMuYWRkKGJhc2VQYXlvZmZzWzBdLCBhZ2dyZWdhdGVkUGF5b2ZmWzBdKSwgdGhpcy5hZGQoYmFzZVBheW9mZnNbMV0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMV0pXSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjaGlsZENvbWJpbmVkUGF5b2ZmID0gdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdjb21iaW5lZFBheW9mZicpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGRDb21iaW5lZFBheW9mZiA+IGJlc3RDaGlsZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENoaWxkID0gY2hpbGRDb21iaW5lZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtpXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChiZXN0Q2hpbGQuZXF1YWxzKGNoaWxkQ29tYmluZWRQYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgICAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbih0aGlzLmRlY2lzaW9uUG9saWN5LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRlY2lzaW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgYmFzZVBheW9mZnMgPSBbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIGJhc2VQYXlvZmZzLCBbdGhpcy5hZGQoYmFzZVBheW9mZnNbMF0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMF0pLCB0aGlzLmFkZChiYXNlUGF5b2Zmc1sxXSwgYWdncmVnYXRlZFBheW9mZlsxXSldKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBzdW13ZWlnaHQgPSAwO1xuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBzdW13ZWlnaHQgPSB0aGlzLmFkZChzdW13ZWlnaHQsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoc3Vtd2VpZ2h0ID4gMCkge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUGF5b2ZmLmZvckVhY2goKHAsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGVwID0gdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmZbJyArIGkgKyAnXScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmZbaV0gPSB0aGlzLmFkZChwLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLCBlcCkuZGl2KHN1bXdlaWdodCkpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgfVxuICAgICAgICBwYXlvZmYuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICBwYXlvZmZbaV0gPSB0aGlzLmFkZChwLCBjaGlsZHJlblBheW9mZltpXSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhub2RlKTtcblxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2FnZ3JlZ2F0ZWRQYXlvZmYnLCBhZ2dyZWdhdGVkUGF5b2ZmKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCAwKTsgLy9pbml0aWFsIHZhbHVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnY2hpbGRyZW5QYXlvZmYnLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnY29tYmluZWRQYXlvZmYnLCB0aGlzLmNvbXB1dGVDb21iaW5lZFBheW9mZihwYXlvZmYpKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZicsIHBheW9mZik7XG4gICAgfVxuXG4gICAgY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKHBheW9mZil7XG4gICAgICAgIC8vIFtjcml0ZXJpb24gMSBjb2VmZl0qW2NyaXRlcmlvbiAxXSpbd2VpZ2h0XStbY3JpdGVyaW9uIDIgY29lZmZdKltjcml0ZXJpb24gMl1cbiAgICAgICAgaWYgKHRoaXMuY3JpdGVyaW9uMVdlaWdodCA9PT0gSW5maW5pdHkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm11bHRpcGx5KHRoaXMucGF5b2ZmQ29lZmZzWzBdLCBwYXlvZmZbMF0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmFkZCh0aGlzLm11bHRpcGx5KHRoaXMucGF5b2ZmQ29lZmZzWzBdLCB0aGlzLm11bHRpcGx5KHRoaXMuY3JpdGVyaW9uMVdlaWdodCwgcGF5b2ZmWzBdKSksIHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMV0sIHBheW9mZlsxXSkpO1xuICAgIH1cblxuICAgIC8vICBjb21iaW5lZFBheW9mZiAtIHBhcmVudCBlZGdlIGNvbWJpbmVkUGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgY29tYmluZWRQYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCAnY29tYmluZWRQYXlvZmYnKSwgY29tYmluZWRQYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV0pLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cbi8qQmFzZSBjbGFzcyBmb3Igb2JqZWN0aXZlIHJ1bGVzKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxlIHtcbiAgICBuYW1lO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBkZWNpc2lvblBvbGljeTtcbiAgICBtYXhpbWl6YXRpb247XG5cbiAgICBwYXlvZmZJbmRleCA9IDA7XG4gICAgbXVsdGlDcml0ZXJpYSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgbWF4aW1pemF0aW9uLCBleHByZXNzaW9uRW5naW5lLCBtdWx0aUNyaXRlcmlhPWZhbHNlKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMubWF4aW1pemF0aW9uID0gbWF4aW1pemF0aW9uO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLm11bHRpQ3JpdGVyaWEgPSBtdWx0aUNyaXRlcmlhO1xuICAgIH1cblxuICAgIHNldERlY2lzaW9uUG9saWN5KGRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgIHRoaXMuZGVjaXNpb25Qb2xpY3kgPSBkZWNpc2lvblBvbGljeTtcbiAgICB9XG5cbiAgICBzZXRQYXlvZmZJbmRleChwYXlvZmZJbmRleCkge1xuICAgICAgICB0aGlzLnBheW9mZkluZGV4ID0gcGF5b2ZmSW5kZXg7XG4gICAgfVxuXG4gICAgY2xlYXJEZWNpc2lvblBvbGljeSgpIHtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IG51bGw7XG4gICAgfVxuXG4gICAgLy8gc2hvdWxkIHJldHVybiBhcnJheSBvZiBzZWxlY3RlZCBjaGlsZHJlbiBpbmRleGVzXG4gICAgbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKSB7XG4gICAgICAgIHZhciBiZXN0O1xuICAgICAgICBpZiAodGhpcy5tYXhpbWl6YXRpb24pIHtcbiAgICAgICAgICAgIGJlc3QgPSB0aGlzLm1heCguLi5jaGlsZHJlblBheW9mZnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYmVzdCA9IHRoaXMubWluKC4uLmNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IFtdO1xuICAgICAgICBjaGlsZHJlblBheW9mZnMuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICBpZiAoRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKGJlc3QsIHApID09IDApIHtcbiAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBzZWxlY3RlZEluZGV4ZXM7XG4gICAgfVxuXG4gICAgX21ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcykge1xuICAgICAgICBpZiAodGhpcy5kZWNpc2lvblBvbGljeSkge1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLm1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgfVxuXG4gICAgLy8gZXh0ZW5zaW9uIHBvaW50IGZvciBjaGFuZ2luZyBjb21wdXRlZCBwcm9iYWJpbGl0eSBvZiBlZGdlcyBpbiBhIGNoYW5jZSBub2RlXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KSB7XG5cbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmYgPSAwLCBhZ2dyZWdhdGVkUGF5b2ZmID0gMCkge1xuICAgICAgICB2YXIgY2hpbGRyZW5QYXlvZmYgPSAwO1xuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSB0aGlzLl9tYWtlRGVjaXNpb24obm9kZSwgbm9kZS5jaGlsZEVkZ2VzLm1hcChlPT50aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSkpKTtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5Jywgc2VsZWN0ZWRJbmRleGVzLmluZGV4T2YoaSkgPCAwID8gMC4wIDogMS4wKTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgIHZhciB3b3JzdENoaWxkID0gSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q291bnQgPSAxO1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkUGF5b2ZmID0gdGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMuYWRkKHRoaXMuYmFzZVBheW9mZihlKSwgYWdncmVnYXRlZFBheW9mZikpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGRQYXlvZmYgPCB3b3JzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50ID0gMTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjaGlsZFBheW9mZi5lcXVhbHMod29yc3RDaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZFBheW9mZiA+IGJlc3RDaGlsZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNoaWxkUGF5b2ZmLmVxdWFscyhiZXN0Q2hpbGQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5tb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShub2RlLmNoaWxkRWRnZXMsIGJlc3RDaGlsZCwgYmVzdENvdW50LCB3b3JzdENoaWxkLCB3b3JzdENvdW50KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDA7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodCA9IHRoaXMuYWRkKHN1bXdlaWdodCwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKHBheW9mZixub2RlLmNoaWxkRWRnZXMsJ3N1bXdlaWdodCcsc3Vtd2VpZ2h0KTtcbiAgICAgICAgICAgIGlmIChzdW13ZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmYgPSB0aGlzLmFkZChjaGlsZHJlblBheW9mZiwgdGhpcy5tdWx0aXBseSh0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSwgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpLmRpdihzdW13ZWlnaHQpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cblxuICAgICAgICBwYXlvZmYgPSB0aGlzLmFkZChwYXlvZmYsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKG5vZGUpO1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnYWdncmVnYXRlZFBheW9mZicrICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIGFnZ3JlZ2F0ZWRQYXlvZmYpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIDApOyAvL2luaXRpYWwgdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicgKyAnWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5jb21wdXRlZFBheW9mZihub2RlLCBwYXlvZmYpO1xuICAgIH1cblxuICAgIC8vIGtvbG9ydWplIG9wdHltYWxuZSDFm2NpZcW8a2lcbiAgICBjb21wdXRlT3B0aW1hbChub2RlKSB7XG4gICAgICAgIHRocm93ICdjb21wdXRlT3B0aW1hbCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHJ1bGU6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvKiBnZXQgb3Igc2V0IGNvbXB1dGVkIHBheW9mZiovXG4gICAgY29tcHV0ZWRQYXlvZmYobm9kZSwgdmFsdWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZlsnICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgdmFsdWUpXG4gICAgfVxuXG4gICAgLypHZXQgb3Igc2V0IG9iamVjdCdzIGNvbXB1dGVkIHZhbHVlIGZvciBjdXJyZW50IHJ1bGUqL1xuICAgIGNWYWx1ZShvYmplY3QsIGZpZWxkUGF0aCwgdmFsdWUpIHtcbiAgICAgICAgLy8gaWYoZmllbGRQYXRoLnRyaW0oKSA9PT0gJ3BheW9mZicpe1xuICAgICAgICAvLyAgICAgZmllbGRQYXRoICs9ICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgIC8vIH1cblxuICAgICAgICByZXR1cm4gb2JqZWN0LmNvbXB1dGVkVmFsdWUodGhpcy5uYW1lLCBmaWVsZFBhdGgsIHZhbHVlKTtcbiAgICB9XG5cbiAgICBiYXNlUHJvYmFiaWxpdHkoZWRnZSkge1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgIH1cblxuICAgIGJhc2VQYXlvZmYoZWRnZSwgcGF5b2ZmSW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGVkZ2UuY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgcGF5b2ZmSW5kZXggfHwgdGhpcy5wYXlvZmZJbmRleCk7XG4gICAgfVxuXG4gICAgY2xlYXJDb21wdXRlZFZhbHVlcyhvYmplY3QpIHtcbiAgICAgICAgb2JqZWN0LmNsZWFyQ29tcHV0ZWRWYWx1ZXModGhpcy5uYW1lKTtcbiAgICB9XG5cbiAgICBhZGQoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5hZGQoYSwgYilcbiAgICB9XG5cbiAgICBzdWJ0cmFjdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KGEsIGIpXG4gICAgfVxuXG4gICAgZGl2aWRlKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGEsIGIpXG4gICAgfVxuXG4gICAgbXVsdGlwbHkoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShhLCBiKVxuICAgIH1cblxuICAgIG1heCgpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubWF4KC4uLmFyZ3VtZW50cylcbiAgICB9XG5cbiAgICBtaW4oKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1pbiguLi5hcmd1bWVudHMpXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtPcGVyYXRpb259IGZyb20gXCIuL29wZXJhdGlvblwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuXG4vKlN1YnRyZWUgZmxpcHBpbmcgb3BlcmF0aW9uKi9cbmV4cG9ydCBjbGFzcyBGbGlwU3VidHJlZSBleHRlbmRzIE9wZXJhdGlvbntcblxuICAgIHN0YXRpYyAkTkFNRSA9ICdmbGlwU3VidHJlZSc7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihGbGlwU3VidHJlZS4kTkFNRSk7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIGlzQXBwbGljYWJsZShvYmplY3Qpe1xuICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZVxuICAgIH1cblxuICAgIGNhblBlcmZvcm0obm9kZSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWNhYmxlKG5vZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZSh0aGlzLmRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUobm9kZSkpLmlzVmFsaWQoKSkgeyAvL2NoZWNrIGlmIHRoZSB3aG9sZSBzdWJ0cmVlIGlzIHByb3BlclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuTnVtYmVyID0gbnVsbDtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzID0gW107XG4gICAgICAgIHZhciBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KCk7XG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldDtcbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMuZXZlcnkoZT0+IHtcblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IGUuY2hpbGROb2RlO1xuICAgICAgICAgICAgICAgIGlmICghKGNoaWxkIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuaGFzKGUubmFtZS50cmltKCkpKSB7IC8vIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuYWRkKGUubmFtZS50cmltKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5OdW1iZXIgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbk51bWJlciA9IGNoaWxkLmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA8IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ2U9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5wdXNoKGdlLm5hbWUudHJpbSgpKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuc2l6ZSAhPT0gZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMubGVuZ3RoKSB7IC8vZ3JhbmRjaGlsZHJlbiBlZGdlIGxhYmVscyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGggIT0gZ3JhbmRjaGlsZHJlbk51bWJlcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFjaGlsZC5jaGlsZEVkZ2VzLmV2ZXJ5KChnZSwgaSk9PmdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzW2ldID09PSBnZS5uYW1lLnRyaW0oKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICB9KSkge1xuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBwZXJmb3JtKHJvb3QpIHtcblxuICAgICAgICB2YXIgcm9vdENsb25lID0gdGhpcy5kYXRhLmNsb25lU3VidHJlZShyb290LCB0cnVlKTtcbiAgICAgICAgdmFyIG9sZENoaWxkcmVuTnVtYmVyID0gcm9vdC5jaGlsZEVkZ2VzLmxlbmd0aDtcbiAgICAgICAgdmFyIG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXMubGVuZ3RoO1xuXG4gICAgICAgIHZhciBjaGlsZHJlbk51bWJlciA9IG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXI7XG4gICAgICAgIHZhciBncmFuZENoaWxkcmVuTnVtYmVyID0gb2xkQ2hpbGRyZW5OdW1iZXI7XG5cbiAgICAgICAgdmFyIGNhbGxiYWNrc0Rpc2FibGVkID0gdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSB0cnVlO1xuXG5cbiAgICAgICAgdmFyIGNoaWxkWCA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueDtcbiAgICAgICAgdmFyIHRvcFkgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG4gICAgICAgIHZhciBib3R0b21ZID0gcm9vdC5jaGlsZEVkZ2VzW29sZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmNoaWxkRWRnZXNbb2xkR3JhbmRDaGlsZHJlbk51bWJlciAtIDFdLmNoaWxkTm9kZS5sb2NhdGlvbi55O1xuXG4gICAgICAgIHZhciBleHRlbnRZID0gYm90dG9tWSAtIHRvcFk7XG4gICAgICAgIHZhciBzdGVwWSA9IGV4dGVudFkgLyAoY2hpbGRyZW5OdW1iZXIgKyAxKTtcblxuICAgICAgICByb290LmNoaWxkRWRnZXMuc2xpY2UoKS5mb3JFYWNoKGU9PiB0aGlzLmRhdGEucmVtb3ZlTm9kZShlLmNoaWxkTm9kZSkpO1xuXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZHJlbk51bWJlcjsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBuZXcgbW9kZWwuQ2hhbmNlTm9kZShuZXcgbW9kZWwuUG9pbnQoY2hpbGRYLCB0b3BZICsgKGkgKyAxKSAqIHN0ZXBZKSk7XG4gICAgICAgICAgICB2YXIgZWRnZSA9IHRoaXMuZGF0YS5hZGROb2RlKGNoaWxkLCByb290KTtcbiAgICAgICAgICAgIGVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLm5hbWU7XG5cbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSAwO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGdyYW5kQ2hpbGRyZW5OdW1iZXI7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY2hpbGROb2RlO1xuXG5cbiAgICAgICAgICAgICAgICB2YXIgZ3JhbmRDaGlsZEVkZ2UgPSB0aGlzLmRhdGEuYXR0YWNoU3VidHJlZShncmFuZENoaWxkLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLm5hbWU7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucGF5b2ZmID0gW1xuICAgICAgICAgICAgICAgICAgICBFeHByZXNzaW9uRW5naW5lLmFkZChyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAwKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMCkpLFxuICAgICAgICAgICAgICAgICAgICBFeHByZXNzaW9uRW5naW5lLmFkZChyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAxKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMSkpLFxuICAgICAgICAgICAgICAgIF07XG5cbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUubXVsdGlwbHkocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKSk7XG4gICAgICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGVkZ2UucHJvYmFiaWxpdHksIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHAsIGVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgaWYgKGVkZ2UucHJvYmFiaWxpdHkuZXF1YWxzKDApKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb2IgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBncmFuZENoaWxkcmVuTnVtYmVyKTtcbiAgICAgICAgICAgICAgICBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5ID0gcCA9PiBwcm9iO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ3JhbmRDaGlsZEVkZ2U9PiB7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5KGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAoY2hpbGQuY2hpbGRFZGdlcywgcHJvYmFiaWxpdHlTdW0pO1xuICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZWRnZS5wcm9iYWJpbGl0eSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKHJvb3QuY2hpbGRFZGdlcyk7XG5cblxuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSBjYWxsYmFja3NEaXNhYmxlZDtcbiAgICAgICAgdGhpcy5kYXRhLl9maXJlTm9kZUFkZGVkQ2FsbGJhY2soKTtcbiAgICB9XG5cbiAgICBfbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSl7XG4gICAgICAgIGlmKCFwcm9iYWJpbGl0eVN1bSl7XG4gICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGUucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgIGxvZy5pbmZvKCdTdW0gb2YgdGhlIHByb2JhYmlsaXRpZXMgaW4gY2hpbGQgbm9kZXMgaXMgbm90IGVxdWFsIHRvIDEgOiAnLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICB2YXIgbmV3UHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICB2YXIgY2YgPSAxMDAwMDAwMDAwMDAwOyAvLzEwXjEyXG4gICAgICAgICAgICB2YXIgcHJlYyA9IDEyO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgZS5wcm9iYWJpbGl0eSA9IHBhcnNlSW50KEV4cHJlc3Npb25FbmdpbmUucm91bmQoZS5wcm9iYWJpbGl0eSwgcHJlYykgKiBjZik7XG4gICAgICAgICAgICAgICAgbmV3UHJvYmFiaWxpdHlTdW0gPSBuZXdQcm9iYWJpbGl0eVN1bSArIGUucHJvYmFiaWxpdHk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHZhciByZXN0ID0gY2YgLSBuZXdQcm9iYWJpbGl0eVN1bTtcbiAgICAgICAgICAgIGxvZy5pbmZvKCdOb3JtYWxpemluZyB3aXRoIHJvdW5kaW5nIHRvIHByZWNpc2lvbjogJyArIHByZWMsIHJlc3QpO1xuICAgICAgICAgICAgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHJlc3QsIGNoaWxkRWRnZXNbMF0ucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgbmV3UHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwYXJzZUludChlLnByb2JhYmlsaXR5KSwgY2YpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsIlxuLypCYXNlIGNsYXNzIGZvciBjb21wbGV4IG9wZXJhdGlvbnMgb24gdHJlZSBzdHJ1Y3R1cmUqL1xuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbntcblxuICAgIG5hbWU7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lKXtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB9XG5cbiAgICAvL2NoZWNrIGlmIG9wZXJhdGlvbiBpcyBwb3RlbnRpYWxseSBhcHBsaWNhYmxlIGZvciBvYmplY3RcbiAgICBpc0FwcGxpY2FibGUoKXtcbiAgICAgICAgdGhyb3cgJ2lzQXBwbGljYWJsZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvL2NoZWNrIGlmIGNhbiBwZXJmb3JtIG9wZXJhdGlvbiBmb3IgYXBwbGljYWJsZSBvYmplY3RcbiAgICBjYW5QZXJmb3JtKG9iamVjdCl7XG4gICAgICAgIHRocm93ICdjYW5QZXJmb3JtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIHBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ3BlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RmxpcFN1YnRyZWV9IGZyb20gXCIuL2ZsaXAtc3VidHJlZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBPcGVyYXRpb25zTWFuYWdlciB7XG5cbiAgICBvcGVyYXRpb25zID0gW107XG4gICAgb3BlcmF0aW9uQnlOYW1lID0ge307XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5yZWdpc3Rlck9wZXJhdGlvbihuZXcgRmxpcFN1YnRyZWUoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVyT3BlcmF0aW9uKG9wZXJhdGlvbil7XG4gICAgICAgIHRoaXMub3BlcmF0aW9ucy5wdXNoKG9wZXJhdGlvbik7XG4gICAgICAgIHRoaXMub3BlcmF0aW9uQnlOYW1lW29wZXJhdGlvbi5uYW1lXSA9IG9wZXJhdGlvbjtcbiAgICB9XG5cblxuICAgIGdldE9wZXJhdGlvbkJ5TmFtZShuYW1lKXtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9uQnlOYW1lW25hbWVdO1xuICAgIH1cblxuICAgIG9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KXtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9ucy5maWx0ZXIob3A9Pm9wLmlzQXBwbGljYWJsZShvYmplY3QpKVxuICAgIH1cblxufVxuIiwiXG5leHBvcnQgY2xhc3MgRGVjaXNpb257XG4gICAgbm9kZTtcbiAgICBkZWNpc2lvblZhbHVlOyAvL2luZGV4IG9mICBzZWxlY3RlZCBlZGdlXG4gICAgY2hpbGRyZW4gPSBbXTtcbiAgICBrZXk7XG5cbiAgICBjb25zdHJ1Y3Rvcihub2RlLCBkZWNpc2lvblZhbHVlKSB7XG4gICAgICAgIHRoaXMubm9kZSA9IG5vZGU7XG4gICAgICAgIHRoaXMuZGVjaXNpb25WYWx1ZSA9IGRlY2lzaW9uVmFsdWU7XG4gICAgICAgIHRoaXMua2V5ID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eT0nJGlkJyl7XG4gICAgICAgIHZhciBlID0gZGVjaXNpb24ubm9kZS5jaGlsZEVkZ2VzW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICB2YXIga2V5ID0gZGVjaXNpb24ubm9kZVtrZXlQcm9wZXJ0eV0rXCI6XCIrKGVba2V5UHJvcGVydHldPyBlW2tleVByb3BlcnR5XSA6IGRlY2lzaW9uLmRlY2lzaW9uVmFsdWUrMSk7XG4gICAgICAgIHJldHVybiBrZXkucmVwbGFjZSgvXFxuL2csICcgJyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5jaGlsZHJlbi5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBEZWNpc2lvbi5nZXREZWNpc2lvbih0aGlzLCBkZWNpc2lvbk5vZGUpXG4gICAgfVxuXG4gICAgc3RhdGljIGdldERlY2lzaW9uKGRlY2lzaW9uLCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBpZihkZWNpc2lvbi5ub2RlPT09ZGVjaXNpb25Ob2RlIHx8IGRlY2lzaW9uLm5vZGUuJGlkID09PSBkZWNpc2lvbk5vZGUuJGlkKXtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICAgICAgfVxuICAgICAgICBmb3IodmFyIGk9MDsgaTxkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICB2YXIgZCA9IERlY2lzaW9uLmdldERlY2lzaW9uKGRlY2lzaW9uLmNoaWxkcmVuW2ldLCBkZWNpc2lvbk5vZGUpO1xuICAgICAgICAgICAgaWYoZCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0aWMgdG9EZWNpc2lvblN0cmluZyhkZWNpc2lvbiwgZXh0ZW5kZWQ9ZmFsc2UsIGtleVByb3BlcnR5PSduYW1lJywgaW5kZW50ID0gJycpe1xuXG4gICAgICAgIHZhciByZXMgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleShkZWNpc2lvbiwga2V5UHJvcGVydHkpO1xuICAgICAgICB2YXIgY2hpbGRyZW5SZXMgPSBcIlwiO1xuXG4gICAgICAgIGRlY2lzaW9uLmNoaWxkcmVuLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYoY2hpbGRyZW5SZXMpe1xuICAgICAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gJ1xcbicraW5kZW50O1xuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCxleHRlbmRlZCxrZXlQcm9wZXJ0eSwgaW5kZW50KydcXHQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYoZGVjaXNpb24uY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9ICAnXFxuJytpbmRlbnQgK2NoaWxkcmVuUmVzO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgPSBcIiAtIChcIiArIGNoaWxkcmVuUmVzICsgXCIpXCI7XG4gICAgICAgICAgICB9XG5cblxuXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzK2NoaWxkcmVuUmVzO1xuICAgIH1cblxuICAgIHRvRGVjaXNpb25TdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcodGhpcywgaW5kZW50KVxuICAgIH1cbn1cbiIsImltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi9wb2xpY3lcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7VXRpbHN9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtEZWNpc2lvbn0gZnJvbSBcIi4vZGVjaXNpb25cIjtcblxuZXhwb3J0IGNsYXNzIFBvbGljaWVzQ29sbGVjdG9ye1xuICAgIHBvbGljaWVzID0gW107XG4gICAgcnVsZU5hbWU9ZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3Rvcihyb290LCBvcHRpbWFsRm9yUnVsZU5hbWUpe1xuICAgICAgICB0aGlzLnJ1bGVOYW1lID0gb3B0aW1hbEZvclJ1bGVOYW1lO1xuICAgICAgICB0aGlzLmNvbGxlY3Qocm9vdCkuZm9yRWFjaCgoZGVjaXNpb25zLGkpPT57XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzLnB1c2gobmV3IFBvbGljeShcIiNcIisoaSsxKSwgZGVjaXNpb25zKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBpZih0aGlzLnBvbGljaWVzLmxlbmd0aD09PTEpe1xuICAgICAgICAgICAgdGhpcy5wb2xpY2llc1swXS5pZCA9IFwiZGVmYXVsdFwiXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb2xsZWN0KHJvb3Qpe1xuICAgICAgICB2YXIgbm9kZVF1ZXVlID0gW3Jvb3RdO1xuICAgICAgICB2YXIgbm9kZTtcbiAgICAgICAgdmFyIGRlY2lzaW9uTm9kZXMgPSBbXTtcbiAgICAgICAgd2hpbGUobm9kZVF1ZXVlLmxlbmd0aCl7XG4gICAgICAgICAgICBub2RlID0gbm9kZVF1ZXVlLnNoaWZ0KCk7XG5cbiAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIW5vZGUuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgZGVjaXNpb25Ob2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcbiAgICAgICAgICAgICAgICBub2RlUXVldWUucHVzaChlZGdlLmNoaWxkTm9kZSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKGRlY2lzaW9uTm9kZXMubWFwKChkZWNpc2lvbk5vZGUpPT57XG4gICAgICAgICAgICB2YXIgZGVjaXNpb25zPSBbXTtcbiAgICAgICAgICAgIGRlY2lzaW9uTm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGVkZ2UsIGkpPT57XG5cbiAgICAgICAgICAgICAgICBpZih0aGlzLnJ1bGVOYW1lICYmICFlZGdlLmNvbXB1dGVkVmFsdWUodGhpcy5ydWxlTmFtZSwgJ29wdGltYWwnKSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgY2hpbGREZWNpc2lvbnMgPSB0aGlzLmNvbGxlY3QoZWRnZS5jaGlsZE5vZGUpOyAvL2FsbCBwb3NzaWJsZSBjaGlsZCBkZWNpc2lvbnMgKGNhcnRlc2lhbilcbiAgICAgICAgICAgICAgICBjaGlsZERlY2lzaW9ucy5mb3JFYWNoKGNkPT57XG4gICAgICAgICAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGkpO1xuICAgICAgICAgICAgICAgICAgICBkZWNpc2lvbnMucHVzaChkZWNpc2lvbik7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9uLmNoaWxkcmVuID0gY2Q7XG4gICAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gZGVjaXNpb25zO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWN5e1xuICAgIGlkO1xuICAgIGRlY2lzaW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3IoaWQsIGRlY2lzaW9ucyl7XG4gICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgPSBkZWNpc2lvbnMgfHwgW107XG4gICAgICAgIHRoaXMua2V5ID0gUG9saWN5LmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgIH1cblxuICAgIGFkZERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpe1xuICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSk7XG4gICAgICAgIHRoaXMuZGVjaXNpb25zIC5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkocG9saWN5KXtcbiAgICAgICAgdmFyIGtleSA9IFwiXCI7XG4gICAgICAgIHBvbGljeS5kZWNpc2lvbnMuZm9yRWFjaChkPT5rZXkrPShrZXk/IFwiJlwiOiBcIlwiKStkLmtleSk7XG4gICAgICAgIHJldHVybiBrZXk7XG4gICAgfVxuXG4gICAgZXF1YWxzKHBvbGljeSwgaWdub3JlSWQ9dHJ1ZSl7XG4gICAgICAgIGlmKHRoaXMua2V5ICE9IHBvbGljeS5rZXkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGlnbm9yZUlkIHx8IHRoaXMuaWQgPT09IHBvbGljeS5pZDtcbiAgICB9XG5cbiAgICBnZXREZWNpc2lvbihkZWNpc2lvbk5vZGUpe1xuICAgICAgICByZXR1cm4gUG9saWN5LmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSk7XG4gICAgfVxuXG4gICAgc3RhdGljIGdldERlY2lzaW9uKHBvbGljeSwgZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgZm9yKHZhciBpPTA7IGk8cG9saWN5LmRlY2lzaW9ucy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBEZWNpc2lvbi5nZXREZWNpc2lvbihwb2xpY3kuZGVjaXNpb25zW2ldLCBkZWNpc2lvbk5vZGUpO1xuICAgICAgICAgICAgaWYoZGVjaXNpb24pe1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBzdGF0aWMgdG9Qb2xpY3lTdHJpbmcocG9saWN5LCBleHRlbmRlZD1mYWxzZSwgcHJlcGVuZElkPWZhbHNlKXtcblxuICAgICAgICB2YXIgcmVzID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PntcbiAgICAgICAgICAgIGlmKHJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICByZXMgKz0gXCJcXG5cIlxuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICByZXMgKz0gXCIsIFwiXG4gICAgICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlcyArPSBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKGQsIGV4dGVuZGVkLCAnbmFtZScsICdcXHQnKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHByZXBlbmRJZCAmJiBwb2xpY3kuaWQhPT11bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIHBvbGljeS5pZCtcIiBcIityZXM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG5cblxuICAgIHRvUG9saWN5U3RyaW5nKGluZGVudD1mYWxzZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kudG9Qb2xpY3lTdHJpbmcodGhpcywgaW5kZW50KVxuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcntcblxuICAgIGFkZGl0aW9uYWxWYWxpZGF0b3IgPSBudWxsO1xuXG4gICAgY29uc3RydWN0b3IoYWRkaXRpb25hbFZhbGlkYXRvcil7XG4gICAgICAgIHRoaXMuYWRkaXRpb25hbFZhbGlkYXRvciA9IGFkZGl0aW9uYWxWYWxpZGF0b3I7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcGFyc2VkID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgICAgIGlmKHBhcnNlZCAhPT0gSW5maW5pdHkgJiYgIUV4cHJlc3Npb25FbmdpbmUudmFsaWRhdGUodmFsdWUsIHt9LCBmYWxzZSkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICB2YXIgbWF4U2FmZUludGVnZXIgPSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiB8fCA5MDA3MTk5MjU0NzQwOTkxOyAvLyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiBpcyB1bmRlZmluZWQgaW4gSUVcbiAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCAwKSA8IDAgfHwgKHZhbHVlICE9PSBJbmZpbml0eSAmJiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIG1heFNhZmVJbnRlZ2VyKT4gMCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYodGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yKEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFBheW9mZlZhbHVlVmFsaWRhdG9ye1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZT1leHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlKXtcblxuXG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHZhciBtYXhTYWZlSW50ZWdlciA9IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIHx8IDkwMDcxOTkyNTQ3NDA5OTE7IC8vIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIGluIHVuZGVmaW5lZCBpbiBJRVxuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCAtbWF4U2FmZUludGVnZXIpID49IDAgJiYgRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCBtYXhTYWZlSW50ZWdlcikgPD0gMDtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcntcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmU9ZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSwgZWRnZSl7XG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICByZXR1cm4gdmFsdWUuY29tcGFyZSgwKSA+PSAwICYmIHZhbHVlLmNvbXBhcmUoMSkgPD0gMDtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsLCBWYWxpZGF0aW9uUmVzdWx0fSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1Byb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3Byb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQYXlvZmZWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcGF5b2ZmLXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgVHJlZVZhbGlkYXRvciB7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IgPSBuZXcgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvciA9IG5ldyBQYXlvZmZWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShub2Rlcykge1xuXG4gICAgICAgIHZhciB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKTtcblxuICAgICAgICBub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnZhbGlkYXRlTm9kZShuLCB2YWxpZGF0aW9uUmVzdWx0KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVOb2RlKG5vZGUsIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpKSB7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ2luY29tcGxldGVQYXRoJywgbm9kZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgIHZhciB3aXRoSGFzaCA9IGZhbHNlO1xuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgdHJ1ZSk7XG5cbiAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eSA9IGUuY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKTtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMucHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwcm9iYWJpbGl0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQcm9iYWJpbGl0eScsIGRhdGE6IHsnbnVtYmVyJzogaSArIDF9fSwgbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBwcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBlLnBheW9mZi5mb3JFYWNoKChyYXdQYXlvZmYsIHBheW9mZkluZGV4KT0+IHtcbiAgICAgICAgICAgICAgICB2YXIgcGF0aCA9ICdwYXlvZmZbJyArIHBheW9mZkluZGV4ICsgJ10nO1xuICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eShwYXRoLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gZS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCBwYXlvZmZJbmRleCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnBheW9mZlZhbHVlVmFsaWRhdG9yLnZhbGlkYXRlKHBheW9mZikpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQYXlvZmYnLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkocGF0aCwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBpZiAoaXNOYU4ocHJvYmFiaWxpdHlTdW0pIHx8ICFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdwcm9iYWJpbGl0eURvTm90U3VtVXBUbzEnLCBub2RlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9zcmMvaW5kZXgnXG4iXX0=
