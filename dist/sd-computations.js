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

            if (!value && value !== 0 && value !== false && this.minOccurs > 0) {
                return !this.required;
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
                return false;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmMvY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyYy9jb21wdXRhdGlvbnMtbWFuYWdlci5qcyIsInNyYy9jb21wdXRhdGlvbnMtdXRpbHMuanMiLCJzcmMvZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXAuanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9leHRlbmRhYmxlLWVycm9yLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmMvam9icy9lbmdpbmUvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItaW5zdGFuY2UuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWxhdW5jaGVyLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlc3VsdC5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2Itc3RhdHVzLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi5qcyIsInNyYy9qb2JzL2VuZ2luZS9zaW1wbGUtam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAuanMiLCJzcmMvam9icy9pbmRleC5qcyIsInNyYy9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjL2pvYnMvam9iLXdvcmtlci5qcyIsInNyYy9qb2JzL2pvYnMtbWFuYWdlci5qcyIsInNyYy9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvaW5kZXguanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21heC1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWF4LW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1heC1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9taW4tbWF4LXJ1bGUuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21pbi1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbXVsdGktY3JpdGVyaWEtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmMvb3BlcmF0aW9ucy9mbGlwLXN1YnRyZWUuanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb24uanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmMvcG9saWNpZXMvZGVjaXNpb24uanMiLCJzcmMvcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yLmpzIiwic3JjL3BvbGljaWVzL3BvbGljeS5qcyIsInNyYy92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyYy92YWxpZGF0aW9uL3BheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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Z2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVxdWVzdC5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcmVxdWVzdDtcbiAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG4gICAgICBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcblxuICAgIHAucmVxdWVzdCA9IHJlcXVlc3Q7XG4gICAgcmV0dXJuIHA7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsKSB7XG4gICAgICAgICAgdGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcbiAgICB0aGlzLl9pbmRleCA9IGluZGV4O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ211bHRpRW50cnknLFxuICAgICd1bmlxdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdnZXQnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcbiAgICB0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuICAgICdkaXJlY3Rpb24nLFxuICAgICdrZXknLFxuICAgICdwcmltYXJ5S2V5JyxcbiAgICAndmFsdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuICAgICd1cGRhdGUnLFxuICAgICdkZWxldGUnXG4gIF0pO1xuXG4gIC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG4gIFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcbiAgICBpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGN1cnNvciA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICBmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuICAgIHRoaXMuX3N0b3JlID0gc3RvcmU7XG4gIH1cblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnaW5kZXhOYW1lcycsXG4gICAgJ2F1dG9JbmNyZW1lbnQnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdwdXQnLFxuICAgICdhZGQnLFxuICAgICdkZWxldGUnLFxuICAgICdjbGVhcicsXG4gICAgJ2dldCcsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdkZWxldGVJbmRleCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuICAgIHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgVHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuICAgICdvYmplY3RTdG9yZU5hbWVzJyxcbiAgICAnbW9kZSdcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcbiAgICAnYWJvcnQnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICAgIHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG4gICAgdGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG4gIH1cblxuICBVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnZGVsZXRlT2JqZWN0U3RvcmUnLFxuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gREIoZGIpIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICB9XG5cbiAgREIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICAvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuICAvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG4gIFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuICAgIFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZVtmdW5jTmFtZS5yZXBsYWNlKCdvcGVuJywgJ2l0ZXJhdGUnKV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGFyZ3MgPSB0b0FycmF5KGFyZ3VtZW50cyk7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICAgICAgdmFyIG5hdGl2ZU9iamVjdCA9IHRoaXMuX3N0b3JlIHx8IHRoaXMuX2luZGV4O1xuICAgICAgICB2YXIgcmVxdWVzdCA9IG5hdGl2ZU9iamVjdFtmdW5jTmFtZV0uYXBwbHkobmF0aXZlT2JqZWN0LCBhcmdzLnNsaWNlKDAsIC0xKSk7XG4gICAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY2FsbGJhY2socmVxdWVzdC5yZXN1bHQpO1xuICAgICAgICB9O1xuICAgICAgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gcG9seWZpbGwgZ2V0QWxsXG4gIFtJbmRleCwgT2JqZWN0U3RvcmVdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICBpZiAoQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCkgcmV0dXJuO1xuICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwgPSBmdW5jdGlvbihxdWVyeSwgY291bnQpIHtcbiAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICB2YXIgaXRlbXMgPSBbXTtcblxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgaW5zdGFuY2UuaXRlcmF0ZUN1cnNvcihxdWVyeSwgZnVuY3Rpb24oY3Vyc29yKSB7XG4gICAgICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpdGVtcy5wdXNoKGN1cnNvci52YWx1ZSk7XG5cbiAgICAgICAgICBpZiAoY291bnQgIT09IHVuZGVmaW5lZCAmJiBpdGVtcy5sZW5ndGggPT0gY291bnQpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjdXJzb3IuY29udGludWUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICB2YXIgZXhwID0ge1xuICAgIG9wZW46IGZ1bmN0aW9uKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdvcGVuJywgW25hbWUsIHZlcnNpb25dKTtcbiAgICAgIHZhciByZXF1ZXN0ID0gcC5yZXF1ZXN0O1xuXG4gICAgICByZXF1ZXN0Lm9udXBncmFkZW5lZWRlZCA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmICh1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgICAgICB1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKGRiKSB7XG4gICAgICAgIHJldHVybiBuZXcgREIoZGIpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBkZWxldGU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdkZWxldGVEYXRhYmFzZScsIFtuYW1lXSk7XG4gICAgfVxuICB9O1xuXG4gIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZXhwO1xuICAgIG1vZHVsZS5leHBvcnRzLmRlZmF1bHQgPSBtb2R1bGUuZXhwb3J0cztcbiAgfVxuICBlbHNlIHtcbiAgICBzZWxmLmlkYiA9IGV4cDtcbiAgfVxufSgpKTtcbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJDb25maWd9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5cblxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lQ29uZmlnIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ3tcbiAgICBsb2dMZXZlbCA9ICd3YXJuJztcbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vL0VudHJ5IHBvaW50IGNsYXNzIGZvciBzdGFuZGFsb25lIGNvbXB1dGF0aW9uIHdvcmtlcnNcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmUgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2Vye1xuXG4gICAgZ2xvYmFsID0gVXRpbHMuZ2V0R2xvYmFsT2JqZWN0KCk7XG4gICAgaXNXb3JrZXIgPSBVdGlscy5pc1dvcmtlcigpO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhKXtcbiAgICAgICAgc3VwZXIoY29uZmlnLCBkYXRhKTtcblxuICAgICAgICBpZih0aGlzLmlzV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih7XG4gICAgICAgICAgICAgICAgYmVmb3JlSm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdiZWZvcmVKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICBhZnRlckpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYWZ0ZXJKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICAgICAgdGhpcy5xdWVyeWFibGVGdW5jdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcnVuSm9iOiBmdW5jdGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coam9iTmFtZSwgam9iUGFyYW1ldGVycywgc2VyaWFsaXplZERhdGEpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGV4ZWN1dGVKb2I6IGZ1bmN0aW9uKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuam9ic01hbmdlci5leGVjdXRlKGpvYkV4ZWN1dGlvbklkKS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5yZXBseSgnam9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBVdGlscy5nZXRFcnJvckRUTyhlKSk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZWNvbXB1dGU6IGZ1bmN0aW9uKGRhdGFEVE8sIHJ1bGVOYW1lLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdyZWNvbXB1dGVkJywgZGF0YS5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZ2xvYmFsLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKG9FdmVudCkge1xuICAgICAgICAgICAgICAgIGlmIChvRXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2QnKSAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5xdWVyeWFibGVGdW5jdGlvbnNbb0V2ZW50LmRhdGEucXVlcnlNZXRob2RdLmFwcGx5KHNlbGYsIG9FdmVudC5kYXRhLnF1ZXJ5QXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5kZWZhdWx0UmVwbHkob0V2ZW50LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICBzdXBlci5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5zZXRMb2dMZXZlbCh0aGlzLmNvbmZpZy5sb2dMZXZlbCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNldExvZ0xldmVsKGxldmVsKXtcbiAgICAgICAgbG9nLnNldExldmVsKGxldmVsKVxuICAgIH1cblxuICAgIGRlZmF1bHRSZXBseShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMucmVwbHkoJ3Rlc3QnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXBseSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXBseSAtIG5vdCBlbm91Z2ggYXJndW1lbnRzJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5nbG9iYWwucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlNZXRob2RBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlc01hbmFnZXJ9IGZyb20gXCIuL29iamVjdGl2ZS9vYmplY3RpdmUtcnVsZXMtbWFuYWdlclwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge09wZXJhdGlvbnNNYW5hZ2VyfSBmcm9tIFwiLi9vcGVyYXRpb25zL29wZXJhdGlvbnMtbWFuYWdlclwiO1xuaW1wb3J0IHtKb2JzTWFuYWdlcn0gZnJvbSBcIi4vam9icy9qb2JzLW1hbmFnZXJcIjtcbmltcG9ydCB7RXhwcmVzc2lvbnNFdmFsdWF0b3J9IGZyb20gXCIuL2V4cHJlc3Npb25zLWV2YWx1YXRvclwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZU1hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9iLWluc3RhbmNlLW1hbmFnZXJcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7TWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyB7XG5cbiAgICBsb2dMZXZlbCA9IG51bGw7XG5cbiAgICBydWxlTmFtZSA9IG51bGw7XG4gICAgd29ya2VyID0ge1xuICAgICAgICBkZWxlZ2F0ZVJlY29tcHV0YXRpb246IGZhbHNlLFxuICAgICAgICB1cmw6IG51bGxcbiAgICB9O1xuICAgIGpvYlJlcG9zaXRvcnlUeXBlID0gJ2lkYic7XG4gICAgY2xlYXJSZXBvc2l0b3J5ID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlciB7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIG9wZXJhdGlvbnNNYW5hZ2VyO1xuICAgIGpvYnNNYW5nZXI7XG5cbiAgICB0cmVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhID0gbnVsbCkge1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBuZXcgRXhwcmVzc2lvbkVuZ2luZSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gbmV3IEV4cHJlc3Npb25zRXZhbHVhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gbmV3IE9iamVjdGl2ZVJ1bGVzTWFuYWdlcih0aGlzLmV4cHJlc3Npb25FbmdpbmUsIHRoaXMuY29uZmlnLnJ1bGVOYW1lKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zTWFuYWdlciA9IG5ldyBPcGVyYXRpb25zTWFuYWdlcih0aGlzLmRhdGEsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IG5ldyBKb2JzTWFuYWdlcih0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwge1xuICAgICAgICAgICAgd29ya2VyVXJsOiB0aGlzLmNvbmZpZy53b3JrZXIudXJsLFxuICAgICAgICAgICAgcmVwb3NpdG9yeVR5cGU6IHRoaXMuY29uZmlnLmpvYlJlcG9zaXRvcnlUeXBlLFxuICAgICAgICAgICAgY2xlYXJSZXBvc2l0b3J5OiB0aGlzLmNvbmZpZy5jbGVhclJlcG9zaXRvcnlcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMubWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yID0gbmV3IE1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBnZXRDdXJyZW50UnVsZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmN1cnJlbnRSdWxlO1xuICAgIH1cblxuICAgIGZsaXBDcml0ZXJpYShkYXRhKXtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLnJldmVyc2VQYXlvZmZzKCk7XG4gICAgICAgIGxldCB0bXAgPSBkYXRhLndlaWdodExvd2VyQm91bmQ7XG4gICAgICAgIGRhdGEud2VpZ2h0TG93ZXJCb3VuZCA9IHRoaXMuZmxpcChkYXRhLndlaWdodFVwcGVyQm91bmQpO1xuICAgICAgICBkYXRhLndlaWdodFVwcGVyQm91bmQgPSB0aGlzLmZsaXAodG1wKTtcbiAgICAgICAgZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCA9IHRoaXMuZmxpcChkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZmxpcFJ1bGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShmYWxzZSk7XG4gICAgfVxuXG4gICAgZmxpcChhKXtcbiAgICAgICAgaWYoYSA9PSBJbmZpbml0eSl7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGEgPT0gMCl7XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBhKSlcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cbiAgICBydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4obmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhIHx8IHRoaXMuZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpXG4gICAgfVxuXG4gICAgcnVuSm9iV2l0aEluc3RhbmNlTWFuYWdlcihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBKb2JJbnN0YW5jZU1hbmFnZXIodGhpcy5qb2JzTWFuZ2VyLCBqZSwgam9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVzO1xuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5pc1J1bGVOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuY29uZmlnLnJ1bGVOYW1lID0gcnVsZU5hbWU7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBvcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zTWFuYWdlci5vcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCk7XG4gICAgfVxuXG4gICAgY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuY29uZmlnLndvcmtlci5kZWxlZ2F0ZVJlY29tcHV0YXRpb24pIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFyYW1zID0ge1xuICAgICAgICAgICAgICAgICAgICBldmFsQ29kZTogZXZhbENvZGUsXG4gICAgICAgICAgICAgICAgICAgIGV2YWxOdW1lcmljOiBldmFsTnVtZXJpY1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKCFhbGxSdWxlcykge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbXMucnVsZU5hbWUgPSB0aGlzLmdldEN1cnJlbnRSdWxlKCkubmFtZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucnVuSm9iKFwicmVjb21wdXRlXCIsIHBhcmFtcywgdGhpcy5kYXRhLCBmYWxzZSkudGhlbigoam9iRXhlY3V0aW9uKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBqb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRhdGEudXBkYXRlRnJvbShkKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZSh0aGlzLmRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVEaXNwbGF5VmFsdWVzKHRoaXMuZGF0YSk7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBfY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIudXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZiAoZXZhbENvZGUgfHwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgd2VpZ2h0VmFsaWQgPSB0aGlzLm1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgdmFyIG11bHRpQ3JpdGVyaWEgPSB0aGlzLmdldEN1cnJlbnRSdWxlKCkubXVsdGlDcml0ZXJpYTtcblxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKHJvb3Q9PiB7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KSk7XG4gICAgICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLnB1c2godnIpO1xuICAgICAgICAgICAgaWYgKHZyLmlzVmFsaWQoKSAmJiAoIW11bHRpQ3JpdGVyaWEgfHwgd2VpZ2h0VmFsaWQpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vQ2hlY2tzIHZhbGlkaXR5IG9mIGRhdGEgbW9kZWwgd2l0aG91dCByZWNvbXB1dGF0aW9uIGFuZCByZXZhbGlkYXRpb25cbiAgICBpc1ZhbGlkKGRhdGEpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgcmV0dXJuIGRhdGEudmFsaWRhdGlvblJlc3VsdHMuZXZlcnkodnI9PnZyLmlzVmFsaWQoKSk7XG4gICAgfVxuXG4gICAgdXBkYXRlRGlzcGxheVZhbHVlcyhkYXRhLCBwb2xpY3lUb0Rpc3BsYXkgPSBudWxsKSB7XG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgaWYgKHBvbGljeVRvRGlzcGxheSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheVBvbGljeShkYXRhLCBwb2xpY3lUb0Rpc3BsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG4pO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG5vZGUpIHtcbiAgICAgICAgbm9kZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49Pm5vZGUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldE5vZGVEaXNwbGF5VmFsdWUobm9kZSwgbikpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVFZGdlRGlzcGxheVZhbHVlcyhlKSB7XG4gICAgICAgIGUuJERJU1BMQVlfVkFMVUVfTkFNRVMuZm9yRWFjaChuPT5lLmRpc3BsYXlWYWx1ZShuLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXRFZGdlRGlzcGxheVZhbHVlKGUsIG4pKSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeShwb2xpY3lUb0Rpc3BsYXksIGRhdGEpIHtcblxuXG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICBuLmNsZWFyRGlzcGxheVZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICBlLmNsZWFyRGlzcGxheVZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2goKHJvb3QpPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKHJvb3QsIHBvbGljeVRvRGlzcGxheSkpO1xuICAgIH1cblxuICAgIGRpc3BsYXlQb2xpY3lGb3JOb2RlKG5vZGUsIHBvbGljeSkge1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHBvbGljeSwgbm9kZSk7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKGRlY2lzaW9uLCBub2RlLCBwb2xpY3kpO1xuICAgICAgICAgICAgaWYgKGRlY2lzaW9uKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKVxuICAgICAgICAgICAgICAgIHZhciBjaGlsZEVkZ2UgPSBub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICAgICAgY2hpbGRFZGdlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUoY2hpbGRFZGdlLmNoaWxkTm9kZSwgcG9saWN5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+dGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShlLmNoaWxkTm9kZSwgcG9saWN5KSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc1V0aWxze1xuXG4gICAgc3RhdGljIHNlcXVlbmNlKG1pbiwgbWF4LCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGV4dGVudCA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QobWF4LCBtaW4pO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW21pbl07XG4gICAgICAgIHZhciBzdGVwcyA9IGxlbmd0aCAtIDE7XG4gICAgICAgIGlmKCFzdGVwcyl7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoZXh0ZW50LGxlbmd0aCAtIDEpO1xuICAgICAgICB2YXIgY3VyciA9IG1pbjtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgPSBFeHByZXNzaW9uRW5naW5lLmFkZChjdXJyLCBzdGVwKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChjdXJyKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tICdzZC11dGlscydcblxuLypFdmFsdWF0ZXMgY29kZSBhbmQgZXhwcmVzc2lvbnMgaW4gdHJlZXMqL1xuZXhwb3J0IGNsYXNzIEV4cHJlc3Npb25zRXZhbHVhdG9yIHtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIGNsZWFyKGRhdGEpe1xuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgZS5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNsZWFyVHJlZShkYXRhLCByb290KXtcbiAgICAgICAgZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KS5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICAgICAgbi5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIGUuY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGU9dHJ1ZSwgZXZhbE51bWVyaWM9dHJ1ZSwgaW5pdFNjb3Blcz1mYWxzZSl7XG4gICAgICAgIGxvZy5kZWJ1ZygnZXZhbEV4cHJlc3Npb25zIGV2YWxDb2RlOicrZXZhbENvZGUrJyBldmFsTnVtZXJpYzonK2V2YWxOdW1lcmljKTtcbiAgICAgICAgaWYoZXZhbENvZGUpe1xuICAgICAgICAgICAgdGhpcy5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJUcmVlKGRhdGEsIG4pO1xuICAgICAgICAgICAgdGhpcy5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIG4sIGV2YWxDb2RlLCBldmFsTnVtZXJpYyxpbml0U2NvcGVzKTtcbiAgICAgICAgfSk7XG5cbiAgICB9XG5cbiAgICBldmFsR2xvYmFsQ29kZShkYXRhKXtcbiAgICAgICAgZGF0YS5jbGVhckV4cHJlc3Npb25TY29wZSgpO1xuICAgICAgICBkYXRhLiRjb2RlRGlydHkgPSBmYWxzZTtcbiAgICAgICAgdHJ5e1xuICAgICAgICAgICAgZGF0YS4kY29kZUVycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGRhdGEuY29kZSwgZmFsc2UsIGRhdGEuZXhwcmVzc2lvblNjb3BlKTtcbiAgICAgICAgfWNhdGNoIChlKXtcbiAgICAgICAgICAgIGRhdGEuJGNvZGVFcnJvciA9IGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIG5vZGUsIGV2YWxDb2RlPXRydWUsIGV2YWxOdW1lcmljPXRydWUsIGluaXRTY29wZT1mYWxzZSkge1xuICAgICAgICBpZighbm9kZS5leHByZXNzaW9uU2NvcGUgfHwgaW5pdFNjb3BlIHx8IGV2YWxDb2RlKXtcbiAgICAgICAgICAgIHRoaXMuaW5pdFNjb3BlRm9yTm9kZShkYXRhLCBub2RlKTtcbiAgICAgICAgfVxuICAgICAgICBpZihldmFsQ29kZSl7XG4gICAgICAgICAgICBub2RlLiRjb2RlRGlydHkgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmKG5vZGUuY29kZSl7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICBub2RlLiRjb2RlRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChub2RlLmNvZGUsIGZhbHNlLCBub2RlLmV4cHJlc3Npb25TY29wZSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoIChlKXtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS4kY29kZUVycm9yID0gZTtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmRlYnVnKGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgIHZhciBzY29wZSA9IG5vZGUuZXhwcmVzc2lvblNjb3BlO1xuICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtPUV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgICAgICB2YXIgaGFzaEVkZ2VzPSBbXTtcbiAgICAgICAgICAgIHZhciBpbnZhbGlkUHJvYiA9IGZhbHNlO1xuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5wYXlvZmYuZm9yRWFjaCgocmF3UGF5b2ZmLCBwYXlvZmZJbmRleCk9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBwYXRoID0gJ3BheW9mZlsnICsgcGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKHBhdGgsIHRydWUsIGZhbHNlKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsIHBhdGgsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsUGF5b2ZmKGUsIHBheW9mZkluZGV4KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1jYXRjaCAoZXJyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIExlZnQgZW1wdHkgaW50ZW50aW9uYWxseVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cblxuXG4gICAgICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMucHVzaChlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaGFzQXNzaWdubWVudEV4cHJlc3Npb24oZS5wcm9iYWJpbGl0eSkpeyAvL0l0IHNob3VsZCBub3Qgb2NjdXIgaGVyZSFcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiZXZhbEV4cHJlc3Npb25zRm9yTm9kZSBoYXNBc3NpZ25tZW50RXhwcmVzc2lvbiFcIiwgZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKCdwcm9iYWJpbGl0eScsIHRydWUsIGZhbHNlKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByb2IgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChlLnByb2JhYmlsaXR5LCB0cnVlLCBzY29wZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnZhbGlkUHJvYiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH0pO1xuXG5cbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICB2YXIgY29tcHV0ZUhhc2ggPSBoYXNoRWRnZXMubGVuZ3RoICYmICFpbnZhbGlkUHJvYiAmJiAocHJvYmFiaWxpdHlTdW0uY29tcGFyZSgwKSA+PSAwICYmIHByb2JhYmlsaXR5U3VtLmNvbXBhcmUoMSkgPD0gMCk7XG5cbiAgICAgICAgICAgICAgICBpZihjb21wdXRlSGFzaCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaGFzaCA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoMSwgcHJvYmFiaWxpdHlTdW0pLCBoYXNoRWRnZXMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgaGFzaEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncHJvYmFiaWxpdHknLCBoYXNoKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgdGhpcy5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIGUuY2hpbGROb2RlLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsIGluaXRTY29wZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSl7XG4gICAgICAgIHZhciBwYXJlbnQgPSBub2RlLiRwYXJlbnQ7XG4gICAgICAgIHZhciBwYXJlbnRTY29wZSA9IHBhcmVudD9wYXJlbnQuZXhwcmVzc2lvblNjb3BlIDogZGF0YS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgIG5vZGUuZXhwcmVzc2lvblNjb3BlID0gVXRpbHMuY2xvbmVEZWVwKHBhcmVudFNjb3BlKTtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1lbmdpbmUnXG5leHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9leHByZXNzaW9ucy1ldmFsdWF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYnMvaW5kZXgnXG5cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgTGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIndlaWdodExvd2VyQm91bmRcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdiA+PSAwICYmIHYgPD0gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbihhbGxWYWxzWyd3ZWlnaHRVcHBlckJvdW5kJ10pXG4gICAgICAgIH0pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwid2VpZ2h0VXBwZXJCb3VuZFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgKHYsIGFsbFZhbHMpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB2ID49IDAgJiYgdiA+PSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKGFsbFZhbHNbJ3dlaWdodExvd2VyQm91bmQnXSlcbiAgICAgICAgfSkpO1xuXG4gICAgfVxuXG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgbmFtZU9mQ3JpdGVyaW9uMTogJ0Nvc3QnLFxuICAgICAgICAgICAgbmFtZU9mQ3JpdGVyaW9uMjogJ0VmZmVjdCcsXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgd2VpZ2h0TG93ZXJCb3VuZDogMCxcbiAgICAgICAgICAgIHdlaWdodFVwcGVyQm91bmQ6IEluZmluaXR5LFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0xlYWd1ZVRhYmxlSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vbGVhZ3VlLXRhYmxlLWpvYi1wYXJhbWV0ZXJzXCI7XG5cblxuZXhwb3J0IGNsYXNzIExlYWd1ZVRhYmxlSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJsZWFndWUtdGFibGVcIiwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIHRoaXMuaW5pdFN0ZXBzKCk7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCkge1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKHRoaXMuY2FsY3VsYXRlU3RlcCk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycyA9IHRydWUpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICBpZiAod2l0aEhlYWRlcnMpIHtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3lfaWQnLCAncG9saWN5Jywgam9iUmVzdWx0LnBheW9mZk5hbWVzWzBdLCBqb2JSZXN1bHQucGF5b2ZmTmFtZXNbMV0sICdkb21pbmF0ZWRfYnknLCAnZXh0ZW5kZWQtZG9taW5hdGVkX2J5JywgJ2luY3JhdGlvJ107XG4gICAgICAgICAgICByZXN1bHQucHVzaChoZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgIHJvdy5wb2xpY2llcy5mb3JFYWNoKHBvbGljeT0+IHtcbiAgICAgICAgICAgICAgICB2YXIgcm93Q2VsbHMgPSBbXG4gICAgICAgICAgICAgICAgICAgIHJvdy5pZCxcbiAgICAgICAgICAgICAgICAgICAgUG9saWN5LnRvUG9saWN5U3RyaW5nKHBvbGljeSwgam9iUGFyYW1ldGVycy52YWx1ZXMuZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbiksXG4gICAgICAgICAgICAgICAgICAgIHJvdy5wYXlvZmZzWzFdLFxuICAgICAgICAgICAgICAgICAgICByb3cucGF5b2Zmc1swXSxcbiAgICAgICAgICAgICAgICAgICAgcm93LmRvbWluYXRlZEJ5LFxuICAgICAgICAgICAgICAgICAgICByb3cuZXh0ZW5kZWREb21pbmF0ZWRCeSA9PT0gbnVsbCA/IG51bGwgOiByb3cuZXh0ZW5kZWREb21pbmF0ZWRCeVswXSArICcsICcgKyByb3cuZXh0ZW5kZWREb21pbmF0ZWRCeVsxXSxcbiAgICAgICAgICAgICAgICAgICAgcm93LmluY3JhdGlvXG4gICAgICAgICAgICAgICAgXTtcbiAgICAgICAgICAgICAgICByZXN1bHQucHVzaChyb3dDZWxscyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICBsZXQgcnVsZSA9IHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmN1cnJlbnRSdWxlO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgdmFyIHBvbGljaWVzID0gcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXM7XG5cblxuICAgICAgICB2YXIgcGF5b2ZmQ29lZmZzID0gdGhpcy5wYXlvZmZDb2VmZnMgPSBydWxlLnBheW9mZkNvZWZmcztcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhKTtcbiAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcblxuICAgICAgICBpZiAoIXZyLmlzVmFsaWQoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY29tcGFyZSA9IChhLCBiKT0+KC1wYXlvZmZDb2VmZnNbMF0gKiAgKGIucGF5b2Zmc1swXSAtIGEucGF5b2Zmc1swXSkpIHx8ICgtcGF5b2ZmQ29lZmZzWzFdICogIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKTtcblxuICAgICAgICB2YXIgcm93cyA9IHBvbGljaWVzLm1hcChwb2xpY3kgPT4ge1xuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UsIHBvbGljeSk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBbcG9saWN5XSxcbiAgICAgICAgICAgICAgICBwYXlvZmZzOiB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJykuc2xpY2UoKSxcbiAgICAgICAgICAgICAgICBkb21pbmF0ZWRCeTogbnVsbCxcbiAgICAgICAgICAgICAgICBleHRlbmRlZERvbWluYXRlZEJ5OiBudWxsLFxuICAgICAgICAgICAgICAgIGluY3JhdGlvOiBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgcm93cyA9IHJvd3MucmVkdWNlKChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUsIGluZGV4LCBhcnJheSk9PntcbiAgICAgICAgICAgIGlmKCFwcmV2aW91c1ZhbHVlLmxlbmd0aCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFtjdXJyZW50VmFsdWVdXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBwcmV2ID0gcHJldmlvdXNWYWx1ZVtwcmV2aW91c1ZhbHVlLmxlbmd0aC0xXTtcbiAgICAgICAgICAgIGlmKGNvbXBhcmUocHJldiwgY3VycmVudFZhbHVlKSA9PSAwKXtcbiAgICAgICAgICAgICAgICBwcmV2LnBvbGljaWVzLnB1c2goLi4uY3VycmVudFZhbHVlLnBvbGljaWVzKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJldmlvdXNWYWx1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHByZXZpb3VzVmFsdWUuY29uY2F0KGN1cnJlbnRWYWx1ZSlcbiAgICAgICAgfSwgW10pO1xuXG4gICAgICAgIHJvd3Muc29ydCgoYSwgYik9PihwYXlvZmZDb2VmZnNbMF0gKiAgKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpIHx8ICgtcGF5b2ZmQ29lZmZzWzFdICogICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSkpO1xuICAgICAgICByb3dzLmZvckVhY2goKHIsIGkpPT4ge1xuICAgICAgICAgICAgci5pZCA9IGkrMTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHJvd3Muc29ydChjb21wYXJlKTtcbiAgICAgICAgcm93cy5zb3J0KChhLCBiKT0+KC1wYXlvZmZDb2VmZnNbMF0gKiAgKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpIHx8ICgtcGF5b2ZmQ29lZmZzWzFdICogICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSkpO1xuXG4gICAgICAgIGxldCBiZXN0Q29zdCA9IC1wYXlvZmZDb2VmZnNbMV0gKiBJbmZpbml0eSxcbiAgICAgICAgICAgIGJlc3RDb3N0Um93ID0gbnVsbDtcblxuICAgICAgICBsZXQgY21wPSAoYSwgYikgPT4gYSA+IGI7XG4gICAgICAgIGlmKHBheW9mZkNvZWZmc1sxXTwwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9XG5cbiAgICAgICAgcm93cy5mb3JFYWNoKChyLCBpKT0+IHtcbiAgICAgICAgICAgIGlmIChjbXAoci5wYXlvZmZzWzFdLCBiZXN0Q29zdCkpIHtcbiAgICAgICAgICAgICAgICBiZXN0Q29zdCA9IHIucGF5b2Zmc1sxXTtcbiAgICAgICAgICAgICAgICBiZXN0Q29zdFJvdyA9IHI7XG4gICAgICAgICAgICB9IGVsc2UgaWYoYmVzdENvc3RSb3cpIHtcbiAgICAgICAgICAgICAgICByLmRvbWluYXRlZEJ5ID0gYmVzdENvc3RSb3cuaWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICBpZihwYXlvZmZDb2VmZnNbMF0gPiAwICYmIHBheW9mZkNvZWZmc1sxXSA8IDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1lbHNlIGlmKHBheW9mZkNvZWZmc1swXSA8IDAgJiYgcGF5b2ZmQ29lZmZzWzFdID4gMCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfWVsc2UgaWYocGF5b2ZmQ29lZmZzWzFdPDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA+IGI7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJldjJOb3REb21pbmF0ZWQgPSBudWxsO1xuICAgICAgICByb3dzLmZpbHRlcihyPT4hci5kb21pbmF0ZWRCeSkuc29ydCgoYSwgYik9PiggIHBheW9mZkNvZWZmc1swXSAqIChhLnBheW9mZnNbMF0gLSBiLnBheW9mZnNbMF0pKSkuZm9yRWFjaCgociwgaSwgYXJyKT0+IHtcbiAgICAgICAgICAgIGlmIChpID09IDApIHtcbiAgICAgICAgICAgICAgICByLmluY3JhdGlvID0gMDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBwcmV2ID0gYXJyW2kgLSAxXTtcblxuICAgICAgICAgICAgci5pbmNyYXRpbyA9IHRoaXMuY29tcHV0ZUlDRVIociwgcHJldik7XG4gICAgICAgICAgICBpZiAoaSA8IDIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKCFwcmV2Mk5vdERvbWluYXRlZCl7XG4gICAgICAgICAgICAgICAgcHJldjJOb3REb21pbmF0ZWQgPSBhcnJbaSAtIDJdO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihjbXAoci5pbmNyYXRpbyxwcmV2LmluY3JhdGlvKSl7XG4gICAgICAgICAgICAgICAgcHJldi5pbmNyYXRpbyA9IG51bGw7XG4gICAgICAgICAgICAgICAgcHJldi5leHRlbmRlZERvbWluYXRlZEJ5ID0gW3ByZXYyTm90RG9taW5hdGVkLmlkLCByLmlkXSA7XG4gICAgICAgICAgICAgICAgci5pbmNyYXRpbyA9IHRoaXMuY29tcHV0ZUlDRVIociwgcHJldjJOb3REb21pbmF0ZWQpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgcHJldjJOb3REb21pbmF0ZWQgPSBwcmV2O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgd2VpZ2h0TG93ZXJCb3VuZCA9IHBhcmFtcy52YWx1ZShcIndlaWdodExvd2VyQm91bmRcIik7XG4gICAgICAgIGxldCB3ZWlnaHRVcHBlckJvdW5kID0gcGFyYW1zLnZhbHVlKFwid2VpZ2h0VXBwZXJCb3VuZFwiKTtcblxuICAgICAgICAvL21hcmsgb3B0aW1hbCBmb3Igd2VpZ2h0IGluIFt3ZWlnaHRMb3dlckJvdW5kLCB3ZWlnaHRVcHBlckJvdW5kXVxuICAgICAgICBsZXQgbGFzdExFTG93ZXIgPSBudWxsO1xuICAgICAgICByb3dzLnNsaWNlKCkuZmlsdGVyKHI9PiFyLmRvbWluYXRlZEJ5ICYmICFyLmV4dGVuZGVkRG9taW5hdGVkQnkpLnNvcnQoKGEsIGIpID0+IGEuaW5jcmF0aW8gLSBiLmluY3JhdGlvKS5mb3JFYWNoKChyb3csIGksIGFycik9PntcblxuICAgICAgICAgICAgaWYocm93LmluY3JhdGlvIDw9IHdlaWdodExvd2VyQm91bmQpe1xuICAgICAgICAgICAgICAgIGxhc3RMRUxvd2VyICA9IHJvdztcbiAgICAgICAgICAgIH1lbHNlIGlmKHJvdy5pbmNyYXRpbyA9PSB3ZWlnaHRMb3dlckJvdW5kKXtcbiAgICAgICAgICAgICAgICBsYXN0TEVMb3dlciA9IG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvdy5vcHRpbWFsID0gcm93LmluY3JhdGlvID49IHdlaWdodExvd2VyQm91bmQgJiYgcm93LmluY3JhdGlvIDw9IHdlaWdodFVwcGVyQm91bmQ7XG5cbiAgICAgICAgfSk7XG4gICAgICAgIGlmKGxhc3RMRUxvd2VyKXtcbiAgICAgICAgICAgIGxhc3RMRUxvd2VyLm9wdGltYWwgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcm93cy5mb3JFYWNoKHJvdz0+e1xuICAgICAgICAgICAgcm93LnBheW9mZnNbMF0gPSAgRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5wYXlvZmZzWzBdKTtcbiAgICAgICAgICAgIHJvdy5wYXlvZmZzWzFdID0gIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cucGF5b2Zmc1sxXSk7XG4gICAgICAgICAgICByb3cuaW5jcmF0aW8gPSByb3cuaW5jcmF0aW8gPT09IG51bGwgPyBudWxsIDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5pbmNyYXRpbyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhID0ge1xuICAgICAgICAgICAgcGF5b2ZmTmFtZXM6IGRhdGEucGF5b2ZmTmFtZXMuc2xpY2UoKSxcbiAgICAgICAgICAgIHBheW9mZkNvZWZmcyA6IHBheW9mZkNvZWZmcyxcbiAgICAgICAgICAgIHJvd3M6IHJvd3Muc29ydCgoYSwgYik9PihhLmlkIC0gYi5pZCkpLFxuICAgICAgICAgICAgd2VpZ2h0TG93ZXJCb3VuZDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHdlaWdodExvd2VyQm91bmQpLFxuICAgICAgICAgICAgd2VpZ2h0VXBwZXJCb3VuZDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHdlaWdodFVwcGVyQm91bmQpXG4gICAgICAgIH07XG5cblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgY29tcHV0ZUlDRVIociwgcHJldil7XG4gICAgICAgIGxldCBkID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChyLnBheW9mZnNbMF0sIHByZXYucGF5b2Zmc1swXSk7XG4gICAgICAgIGxldCBuID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChyLnBheW9mZnNbMV0sIHByZXYucGF5b2Zmc1sxXSk7XG4gICAgICAgIGlmIChkID09IDApe1xuICAgICAgICAgICAgaWYobjwwKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gLSBJbmZpbml0eTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBJbmZpbml0eTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gTWF0aC5hYnMoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUobiwgZCkpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFJlY29tcHV0ZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsQ29kZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV2YWxOdW1lcmljXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgcnVsZU5hbWU6IG51bGwsIC8vcmVjb21wdXRlIGFsbCBydWxlc1xuICAgICAgICAgICAgZXZhbENvZGU6IHRydWUsXG4gICAgICAgICAgICBldmFsTnVtZXJpYzogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1JlY29tcHV0ZUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iXCI7XG5cbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInJlY29tcHV0ZVwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5pc1Jlc3RhcnRhYmxlID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBleGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgaWYocnVsZU5hbWUpe1xuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgcGFyYW1zLnZhbHVlKFwiZXZhbENvZGVcIiksIHBhcmFtcy52YWx1ZShcImV2YWxOdW1lcmljXCIpKVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYykge1xuICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzID0gW107XG5cbiAgICAgICAgaWYoZXZhbENvZGV8fGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZmFpbE9uSW52YWxpZFRyZWVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMiksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPCB2W1wibWF4XCJdLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuXG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBiYXRjaFNpemU9NSkge1xuICAgICAgICBzdXBlcihcInNlbnNpdGl2aXR5LWFuYWx5c2lzXCIsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmJhdGNoU2l6ZSA9IDU7XG4gICAgICAgIHRoaXMuaW5pdFN0ZXBzKCk7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCl7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcCh0aGlzLmNhbGN1bGF0ZVN0ZXApO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzZXRCYXRjaFNpemUoYmF0Y2hTaXplKXtcbiAgICAgICAgdGhpcy5iYXRjaFNpemUgPSBiYXRjaFNpemU7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcC5jaHVua1NpemUgPSBiYXRjaFNpemU7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycywgd2l0aEhlYWRlcnM9dHJ1ZSl7XG4gICAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgICAgaWYod2l0aEhlYWRlcnMpe1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeV9udW1iZXInLCAncG9saWN5J107XG4gICAgICAgICAgICBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5mb3JFYWNoKG49PmhlYWRlcnMucHVzaChuKSk7XG4gICAgICAgICAgICBoZWFkZXJzLnB1c2goJ3BheW9mZicpO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goaGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcm91bmRWYXJpYWJsZXMgPSAhIWpvYlBhcmFtZXRlcnMudmFsdWVzLnJvdW5kVmFyaWFibGVzO1xuICAgICAgICBpZihyb3VuZFZhcmlhYmxlcyl7XG4gICAgICAgICAgICB0aGlzLnJvdW5kVmFyaWFibGVzKGpvYlJlc3VsdCk7XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICB2YXIgcG9saWN5ID0gam9iUmVzdWx0LnBvbGljaWVzW3Jvdy5wb2xpY3lJbmRleF07XG4gICAgICAgICAgICB2YXIgcm93Q2VsbHMgPSBbcm93LnBvbGljeUluZGV4KzEsIFBvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3ksIGpvYlBhcmFtZXRlcnMudmFsdWVzLmV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb24pXTtcbiAgICAgICAgICAgIHJvdy52YXJpYWJsZXMuZm9yRWFjaCh2PT4gcm93Q2VsbHMucHVzaCh2KSk7XG4gICAgICAgICAgICByb3dDZWxscy5wdXNoKHJvdy5wYXlvZmYpO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2gocm93Q2VsbHMpO1xuXG4gICAgICAgICAgICBpZihyb3cuX3ZhcmlhYmxlcyl7IC8vcmV2ZXJ0IG9yaWdpbmFsIHZhcmlhYmxlc1xuICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZXMgPSByb3cuX3ZhcmlhYmxlcztcbiAgICAgICAgICAgICAgICBkZWxldGUgcm93Ll92YXJpYWJsZXM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcm91bmRWYXJpYWJsZXMoam9iUmVzdWx0KXtcbiAgICAgICAgdmFyIHVuaXF1ZVZhbHVlcyA9IGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLm1hcCgoKT0+bmV3IFNldCgpKTtcblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICByb3cuX3ZhcmlhYmxlcyA9IHJvdy52YXJpYWJsZXMuc2xpY2UoKTsgLy8gc2F2ZSBvcmlnaW5hbCByb3cgdmFyaWFibGVzXG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2goKHYsaSk9PiB7XG4gICAgICAgICAgICAgICAgdW5pcXVlVmFsdWVzW2ldLmFkZCh2KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB1bmlxdWVWYWx1ZXNObyA9IHVuaXF1ZVZhbHVlcy5tYXAoKHMpPT5zLnNpemUpO1xuICAgICAgICB2YXIgbWF4UHJlY2lzaW9uID0gMTQ7XG4gICAgICAgIHZhciBwcmVjaXNpb24gPSAyO1xuICAgICAgICB2YXIgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzID0gam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMubWFwKCh2LGkpPT5pKTtcbiAgICAgICAgd2hpbGUocHJlY2lzaW9uPD1tYXhQcmVjaXNpb24gJiYgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLmxlbmd0aCl7XG4gICAgICAgICAgICB1bmlxdWVWYWx1ZXMgPSBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMubWFwKCgpPT5uZXcgU2V0KCkpO1xuICAgICAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgICAgIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5mb3JFYWNoKCh2YXJpYWJsZUluZGV4LCBub3RSZWFkeUluZGV4KT0+e1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciB2YWwgPSByb3cuX3ZhcmlhYmxlc1t2YXJpYWJsZUluZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgdmFsID0gVXRpbHMucm91bmQodmFsLCBwcmVjaXNpb24pO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVWYWx1ZXNbbm90UmVhZHlJbmRleF0uYWRkKHZhbCk7XG5cbiAgICAgICAgICAgICAgICAgICAgcm93LnZhcmlhYmxlc1t2YXJpYWJsZUluZGV4XSA9IHZhbDtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHZhciBuZXdSZWFkeUluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgIHVuaXF1ZVZhbHVlcy5mb3JFYWNoKCh1bmlxdWVWYWxzLCBub3RSZWFkeUluZGV4KT0+e1xuICAgICAgICAgICAgICAgIHZhciBvcmlnVW5pcXVlQ291bnQgPSB1bmlxdWVWYWx1ZXNOb1tub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXNbbm90UmVhZHlJbmRleF1dIDtcbiAgICAgICAgICAgICAgICBpZihvcmlnVW5pcXVlQ291bnQ9PXVuaXF1ZVZhbHMuc2l6ZSl7IC8vcmVhZHkgaW4gcHJldmlvdXMgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgICAgIG5ld1JlYWR5SW5kZXhlcy5wdXNoKG5vdFJlYWR5SW5kZXgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYobmV3UmVhZHlJbmRleGVzLmxlbmd0aCkgeyAvL3JldmVydCB2YWx1ZXMgdG8gcHJldiBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMucmV2ZXJzZSgpO1xuICAgICAgICAgICAgICAgIG5ld1JlYWR5SW5kZXhlcy5mb3JFYWNoKG5vdFJlYWR5SW5kZXg9PntcbiAgICAgICAgICAgICAgICAgICAgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLnNwbGljZShub3RSZWFkeUluZGV4LCAxKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcHJlY2lzaW9uKys7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbn0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9leGNlcHRpb25zL2pvYi1jb21wdXRhdGlvbi1leGNlcHRpb25cIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSwgYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcblxuXG4gICAgICAgIGlmICgham9iUmVzdWx0LmRhdGEucm93cykge1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMubGVuZ3RoO1xuICAgIH1cblxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZmFpbE9uSW52YWxpZFRyZWUgPSBwYXJhbXMudmFsdWUoXCJmYWlsT25JbnZhbGlkVHJlZVwiKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZU5hbWVzXCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2goKHZhcmlhYmxlTmFtZSwgaSk9PiB7XG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gaXRlbVtpXTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcblxuICAgICAgICB2YXIgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgaWYoIXZhbGlkICYmIGZhaWxPbkludmFsaWRUcmVlKXtcbiAgICAgICAgICAgIGxldCBlcnJvckRhdGEgPSB7XG4gICAgICAgICAgICAgICAgdmFyaWFibGVzOiB7fVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZhcmlhYmxlTmFtZXMuZm9yRWFjaCgodmFyaWFibGVOYW1lLCBpKT0+IHtcbiAgICAgICAgICAgICAgICBlcnJvckRhdGEudmFyaWFibGVzW3ZhcmlhYmxlTmFtZV0gPSBpdGVtW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJjb21wdXRhdGlvbnNcIiwgZXJyb3JEYXRhKVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHBheW9mZnMgPSBbXTtcblxuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKHBvbGljeT0+IHtcbiAgICAgICAgICAgIHZhciBwYXlvZmYgPSAnbi9hJztcbiAgICAgICAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgICAgIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKVswXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBheW9mZnMucHVzaChwYXlvZmYpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzLFxuICAgICAgICAgICAgdmFyaWFibGVzOiBpdGVtLFxuICAgICAgICAgICAgcGF5b2ZmczogcGF5b2Zmc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uID0gcGFyYW1zLnZhbHVlKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW09PiB7XG4gICAgICAgICAgICBpZiAoIWl0ZW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVtLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHZhcmlhYmxlcyA9IGl0ZW0udmFyaWFibGVzLm1hcCh2ID0+IHRoaXMudG9GbG9hdCh2KSk7XG5cbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gaXRlbS5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgICAgIHZhciByb3cgPSB7XG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBpLFxuICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZXM6IHZhcmlhYmxlcyxcbiAgICAgICAgICAgICAgICAgICAgcGF5b2ZmOiBVdGlscy5pc1N0cmluZyhwYXlvZmYpID8gcGF5b2ZmIDogdGhpcy50b0Zsb2F0KHBheW9mZilcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaChyb3cpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgZGVsZXRlIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBJbml0UG9saWNpZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImluaXRfcG9saWNpZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgdmFyIHBvbGljaWVzID0gcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXM7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzKTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGE9e31cbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzID0gcG9saWNpZXM7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc1V0aWxzfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY29tcHV0YXRpb25zLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcblxuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goQ29tcHV0YXRpb25zVXRpbHMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YT17XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlczogdmFyaWFibGVWYWx1ZXNcbiAgICAgICAgfTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm51bWJlck9mUnVuc1wiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPiAwKSk7XG5cbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZvcm11bGFcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7UHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuLi9uLXdheS9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4uL24td2F5L3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtQcm9iQ2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJvYi1jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtDb21wdXRlUG9saWN5U3RhdHNTdGVwfSBmcm9tIFwiLi9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplPTUpIHtcbiAgICAgICAgc3VwZXIoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5uYW1lID0gXCJwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzXCI7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCkge1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBQcm9iQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcCh0aGlzLmNhbGN1bGF0ZVN0ZXApO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENvbXB1dGVQb2xpY3lTdGF0c1N0ZXAodGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5qb2JSZXBvc2l0b3J5KSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbikge1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzFdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1sxXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtsb2csIFV0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGVQb2xpY3lTdGF0c1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJjb21wdXRlX3BvbGljeV9zdGF0c1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucnVsZUJ5TmFtZVtydWxlTmFtZV07XG5cblxuICAgICAgICB2YXIgcGF5b2Zmc1BlclBvbGljeSA9IGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLm1hcCgoKT0+W10pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MuZm9yRWFjaChyb3c9PiB7XG4gICAgICAgICAgICBwYXlvZmZzUGVyUG9saWN5W3Jvdy5wb2xpY3lJbmRleF0ucHVzaChVdGlscy5pc1N0cmluZyhyb3cucGF5b2ZmKSA/IDAgOiByb3cucGF5b2ZmKVxuICAgICAgICB9KTtcblxuICAgICAgICBsb2cuZGVidWcoJ3BheW9mZnNQZXJQb2xpY3knLCBwYXlvZmZzUGVyUG9saWN5LCBqb2JSZXN1bHQuZGF0YS5yb3dzLmxlbmd0aCwgcnVsZS5tYXhpbWl6YXRpb24pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLm1lZGlhbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLm1lZGlhbihwYXlvZmZzKSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnN0YW5kYXJkRGV2aWF0aW9ucyA9IHBheW9mZnNQZXJQb2xpY3kubWFwKHBheW9mZnM9PkV4cHJlc3Npb25FbmdpbmUuc3RkKHBheW9mZnMpKTtcblxuICAgICAgICBpZiAocnVsZS5tYXhpbWl6YXRpb24pIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeUlzQmVzdFByb2JhYmlsaXRpZXMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHYsIG51bWJlck9mUnVucykpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeUlzQmVzdFByb2JhYmlsaXRpZXMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUodiwgbnVtYmVyT2ZSdW5zKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudCA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG5cblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi4vLi4vbi13YXkvc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iQ2FsY3VsYXRlU3RlcCBleHRlbmRzIENhbGN1bGF0ZVN0ZXAge1xuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEucm93cyl7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzID0gW107XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZU5hbWVzID0gdmFyaWFibGVOYW1lcztcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzID0gVXRpbHMuZmlsbChuZXcgQXJyYXkoam9iUmVzdWx0LmRhdGEucG9saWNpZXMubGVuZ3RoKSwgMCk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudCA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudCA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHBhcmFtcy52YWx1ZShcIm51bWJlck9mUnVuc1wiKTtcbiAgICB9XG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIGZvcih2YXIgcnVuSW5kZXg9MDsgcnVuSW5kZXg8Y2h1bmtTaXplOyBydW5JbmRleCsrKXtcbiAgICAgICAgICAgIHZhciBzaW5nbGVSdW5WYXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICAgICAgdmFyIGVycm9ycyA9IFtdO1xuICAgICAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIHZhciBldmFsdWF0ZWQgPSB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUuZXZhbCh2LmZvcm11bGEsIHRydWUsIFV0aWxzLmNsb25lRGVlcChkYXRhLmV4cHJlc3Npb25TY29wZSkpO1xuICAgICAgICAgICAgICAgICAgICBzaW5nbGVSdW5WYXJpYWJsZVZhbHVlcy5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChldmFsdWF0ZWQpKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2goZSl7XG4gICAgICAgICAgICAgICAgICAgIGVycm9ycy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhcmlhYmxlOiB2LFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmKGVycm9ycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgZXJyb3JEYXRhID0ge3ZhcmlhYmxlczogW119O1xuICAgICAgICAgICAgICAgIGVycm9ycy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1tlLnZhcmlhYmxlLm5hbWVdID0gZS5lcnJvci5tZXNzYWdlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbihcInBhcmFtLWNvbXB1dGF0aW9uXCIsIGVycm9yRGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXM7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciByID0gc3VwZXIucHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgam9iUmVzdWx0KTtcblxuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIHRoaXMudXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KTtcblxuICAgICAgICByZXR1cm4gcjtcbiAgICB9XG5cbiAgICB1cGRhdGVQb2xpY3lTdGF0cyhyLCBwb2xpY2llcywgbnVtYmVyT2ZSdW5zLCBqb2JSZXN1bHQpe1xuICAgICAgICB2YXIgaGlnaGVzdFBheW9mZiA9IC1JbmZpbml0eTtcbiAgICAgICAgdmFyIGxvd2VzdFBheW9mZiA9IEluZmluaXR5O1xuICAgICAgICB2YXIgYmVzdFBvbGljeUluZGV4ZXMgPSBbXTtcbiAgICAgICAgdmFyIHdvcnN0UG9saWN5SW5kZXhlcyA9IFtdO1xuXG4gICAgICAgIHZhciB6ZXJvTnVtID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcblxuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksaSk9PntcbiAgICAgICAgICAgIGxldCBwYXlvZmYgPSByLnBheW9mZnNbaV07XG4gICAgICAgICAgICBpZihVdGlscy5pc1N0cmluZyhwYXlvZmYpKXtcbiAgICAgICAgICAgICAgICBwYXlvZmYgPSB6ZXJvTnVtO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocGF5b2ZmIDwgbG93ZXN0UGF5b2ZmKXtcbiAgICAgICAgICAgICAgICBsb3dlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhsb3dlc3RQYXlvZmYpKXtcbiAgICAgICAgICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocGF5b2ZmID4gaGlnaGVzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgaGlnaGVzdFBheW9mZiA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICBiZXN0UG9saWN5SW5kZXhlcyA9IFtpXVxuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhoaWdoZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzW2ldLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwYXlvZmYsIG51bWJlck9mUnVucykpO1xuICAgICAgICB9KTtcblxuICAgICAgICBiZXN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0sIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGJlc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCB3b3JzdFBvbGljeUluZGV4ZXMubGVuZ3RoKSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcy5tYXAodj0+dGhpcy50b0Zsb2F0KHYpKTtcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIDEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JFeGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG5cbiAgICAgICAgdmFyIGRlZmF1bHRWYWx1ZXMgPSB7fTtcbiAgICAgICAgVXRpbHMuZm9yT3duKGRhdGEuZXhwcmVzc2lvblNjb3BlLCAodixrKT0+e1xuICAgICAgICAgICAgZGVmYXVsdFZhbHVlc1trXT10aGlzLnRvRmxvYXQodik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmKCFqb2JSZXN1bHQuZGF0YSl7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5J107XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2gobj0+aGVhZGVycy5wdXNoKG4pKTtcbiAgICAgICAgICAgIGhlYWRlcnMucHVzaCgncGF5b2ZmJyk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YSA9IHtcbiAgICAgICAgICAgICAgICBoZWFkZXJzOmhlYWRlcnMsXG4gICAgICAgICAgICAgICAgcm93czogW10sXG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lczogdmFyaWFibGVOYW1lcyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWVzOiBkZWZhdWx0VmFsdWVzLFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBqb2JFeGVjdXRpb25Db250ZXh0LmdldChcInBvbGljaWVzXCIpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplKSB7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgaXRlbUluZGV4KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZSA9IHZhcmlhYmxlTmFtZXNbaXRlbUluZGV4XTtcblxuXG5cbiAgICAgICAgdmFyIHJlc3VsdHMgPSBbXVxuXG4gICAgICAgIGl0ZW0uZm9yRWFjaCh2YXJpYWJsZVZhbHVlPT57XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG4gICAgICAgICAgICB2YXIgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgICAgIGlmKCF2YWxpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSk7XG4gICAgICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QsIHJ1bGVOYW1lKTtcbiAgICAgICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuXG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpO1xuXG5cbiAgICAgICAgICAgIHZhciByID0ge1xuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZU5hbWU6IHZhcmlhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZUluZGV4OiBpdGVtSW5kZXgsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVWYWx1ZTogdmFyaWFibGVWYWx1ZSxcbiAgICAgICAgICAgICAgICBwYXlvZmY6IHBheW9mZlxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaChyKVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0cztcblxuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG5cbiAgICAgICAgdmFyIHBvbGljeUJ5S2V5ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWN5QnlLZXlcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIGl0ZW1zLmZvckVhY2goaXRlbXNXcmFwcGVyPT57XG4gICAgICAgICAgICBpZighaXRlbXNXcmFwcGVyKXtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGl0ZW1zV3JhcHBlci5mb3JFYWNoKGl0ZW09PntcbiAgICAgICAgICAgICAgICBpdGVtLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSk9PntcblxuICAgICAgICAgICAgICAgICAgICB2YXIgcm93Q2VsbHMgPSBbUG9saWN5LnRvUG9saWN5U3RyaW5nKHBvbGljeSldO1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZU5hbWVzLmZvckVhY2goKHYpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgdmFsdWUgPSBcImRlZmF1bHRcIjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKHYgPT0gaXRlbS52YXJpYWJsZU5hbWUpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlID0gdGhpcy50b0Zsb2F0KGl0ZW0udmFyaWFibGVWYWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9ZWxzZSBpZihqb2JSZXN1bHQuZGF0YS5kZWZhdWx0VmFsdWVzLmhhc093blByb3BlcnR5KHYpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGpvYlJlc3VsdC5kYXRhLmRlZmF1bHRWYWx1ZXNbdl07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICByb3dDZWxscy5wdXNoKHZhbHVlKVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGl0ZW0ucGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICByb3dDZWxscy5wdXNoKFV0aWxzLmlzU3RyaW5nKHBheW9mZik/IHBheW9mZjogdGhpcy50b0Zsb2F0KHBheW9mZikpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2VsbHM6IHJvd0NlbGxzLFxuICAgICAgICAgICAgICAgICAgICAgICAgcG9saWN5SW5kZXg6IHBvbGljaWVzLmluZGV4T2YocG9saWN5QnlLZXlbcG9saWN5LmtleV0pLFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2gocm93KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBJbml0UG9saWNpZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImluaXRfcG9saWNpZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIHJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWNpZXNcIiwgcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXMpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY3lCeUtleVwiLCBVdGlscy5nZXRPYmplY3RCeUlkTWFwKHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzLCBudWxsLCAna2V5JykpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIFByZXBhcmVWYXJpYWJsZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcInByZXBhcmVfdmFyaWFibGVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcblxuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2godGhpcy5zZXF1ZW5jZSh2Lm1pbiwgdi5tYXgsIHYubGVuZ3RoKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyB2YXJpYWJsZVZhbHVlcyA9IFV0aWxzLmNhcnRlc2lhblByb2R1Y3RPZih2YXJpYWJsZVZhbHVlcyk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInZhcmlhYmxlVmFsdWVzXCIsIHZhcmlhYmxlVmFsdWVzKTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gbWF4IC0gbWluO1xuICAgICAgICB2YXIgc3RlcCA9IGV4dGVudCAvIChsZW5ndGggLSAxKTtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFttaW5dO1xuICAgICAgICB2YXIgY3VyciA9IG1pbjtcblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aCAtIDI7IGkrKykge1xuICAgICAgICAgICAgY3VyciArPSBzdGVwO1xuXG4gICAgICAgICAgICByZXN1bHQucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChjdXJyLCAxNikpKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQucHVzaChtYXgpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtaW5cIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1heFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibGVuZ3RoXCIsIFBBUkFNRVRFUl9UWVBFLklOVEVHRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+PSAwKSxcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIHYgPT4gdltcIm1pblwiXSA8PSB2W1wibWF4XCJdLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVyc1wiO1xuXG5leHBvcnQgY2xhc3MgVG9ybmFkb0RpYWdyYW1Kb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInRvcm5hZG8tZGlhZ3JhbVwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBQcmVwYXJlVmFyaWFibGVzU3RlcChqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcChqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgQ2FsY3VsYXRlU3RlcChqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi9zdGVwXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5cbi8qam9iIHN0ZXAgdGhhdCBwcm9jZXNzIGJhdGNoIG9mIGl0ZW1zKi9cbmV4cG9ydCBjbGFzcyBCYXRjaFN0ZXAgZXh0ZW5kcyBTdGVwIHtcblxuICAgIGNodW5rU2l6ZTtcbiAgICBzdGF0aWMgQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1AgPSAnYmF0Y2hfc3RlcF9jdXJyZW50X2l0ZW1fY291bnQnO1xuICAgIHN0YXRpYyBUT1RBTF9JVEVNX0NPVU5UX1BST1AgPSAnYmF0Y2hfc3RlcF90b3RhbF9pdGVtX2NvdW50JztcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGNodW5rU2l6ZSkge1xuICAgICAgICBzdXBlcihuYW1lLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5jaHVua1NpemUgPSBjaHVua1NpemU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gc3RlcCBpbml0aWFsaXphdGlvbi4gU2hvdWxkIHJldHVybiB0b3RhbCBpdGVtIGNvdW50XG4gICAgICovXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAuaW5pdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byByZWFkIGFuZCByZXR1cm4gY2h1bmsgb2YgaXRlbXMgdG8gcHJvY2Vzc1xuICAgICAqL1xuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAucmVhZE5leHRDaHVuayBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm9jZXNzIHNpbmdsZSBpdGVtXG4gICAgICogTXVzdCByZXR1cm4gcHJvY2Vzc2VkIGl0ZW0gd2hpY2ggd2lsbCBiZSBwYXNzZWQgaW4gYSBjaHVuayB0byB3cml0ZUNodW5rIGZ1bmN0aW9uXG4gICAgICovXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnByb2Nlc3NJdGVtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHdyaXRlIGNodW5rIG9mIGl0ZW1zLiBOb3QgcmVxdWlyZWRcbiAgICAgKi9cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcGVyZm9ybSBwb3N0cHJvY2Vzc2luZyBhZnRlciBhbGwgaXRlbXMgaGF2ZSBiZWVuIHByb2Nlc3NlZC4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgfVxuXG5cbiAgICBzZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjb3VudCkge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KEJhdGNoU3RlcC5UT1RBTF9JVEVNX0NPVU5UX1BST1AsIGNvdW50KTtcbiAgICB9XG5cbiAgICBnZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5UT1RBTF9JVEVNX0NPVU5UX1BST1ApO1xuICAgIH1cblxuICAgIHNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1AsIGNvdW50KTtcbiAgICB9XG5cbiAgICBnZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QKSB8fCAwO1xuICAgIH1cblxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIGluaXRpYWxpemUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSkudGhlbih0b3RhbEl0ZW1Db3VudD0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0b3RhbEl0ZW1Db3VudCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgaWYoIShlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIGhhbmRsZSBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBwb3N0UHJvY2VzcyBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgY3VycmVudEl0ZW1Db3VudCA9IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIHRvdGFsSXRlbUNvdW50ID0gdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIGNodW5rU2l6ZSA9IE1hdGgubWluKHRoaXMuY2h1bmtTaXplLCB0b3RhbEl0ZW1Db3VudCAtIGN1cnJlbnRJdGVtQ291bnQpO1xuICAgICAgICBpZiAoY3VycmVudEl0ZW1Db3VudCA+PSB0b3RhbEl0ZW1Db3VudCkge1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tKb2JFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgc29tZW9uZSBpcyB0cnlpbmcgdG8gc3RvcCB1c1xuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24udGVybWluYXRlT25seSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGN1cnJlbnRJdGVtQ291bnQsIGNodW5rU2l6ZSwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcmVhZCBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSkudGhlbihjaHVuaz0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBwcm9jZXNzIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4ocHJvY2Vzc2VkQ2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLndyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgcHJvY2Vzc2VkQ2h1bmssIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHdyaXRlIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKHJlcyk9PiB7XG4gICAgICAgICAgICBjdXJyZW50SXRlbUNvdW50ICs9IGNodW5rU2l6ZTtcbiAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZUpvYlByb2dyZXNzKHN0ZXBFeGVjdXRpb24pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwcm9jZXNzQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgY2h1bmssIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkgeyAvL1RPRE8gcHJvbWlzaWZ5XG4gICAgICAgIHJldHVybiBjaHVuay5tYXAoKGl0ZW0sIGkpPT50aGlzLnByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQraSwgam9iUmVzdWx0KSk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiB0aGlzLmdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pLFxuICAgICAgICAgICAgY3VycmVudDogdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBwcm9ncmVzcyA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSkuZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkLCBwcm9ncmVzcyk7XG4gICAgfVxuXG4gICAgY2hlY2tKb2JFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSkuY2hlY2tFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbik7XG4gICAgfVxufVxuIiwiZXhwb3J0IGNsYXNzIEV4dGVuZGFibGVFcnJvciB7XG4gICAgZGF0YTtcbiAgICBjb25zdHJ1Y3RvcihtZXNzYWdlLCBkYXRhKSB7XG4gICAgICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMubmFtZSA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL2V4dGVuZGFibGUtZXJyb3InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWludGVycnVwdGVkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvbidcblxuXG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iRGF0YUludmFsaWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYlJlc3RhcnRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBFeGVjdXRpb25Db250ZXh0IHtcblxuICAgIGRpcnR5ID0gZmFsc2U7XG4gICAgY29udGV4dCA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoY29udGV4dCkge1xuICAgICAgICBpZiAoY29udGV4dCkge1xuICAgICAgICAgICAgdGhpcy5jb250ZXh0ID0gVXRpbHMuY2xvbmUoY29udGV4dClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1dChrZXksIHZhbHVlKSB7XG4gICAgICAgIHZhciBwcmV2VmFsdWUgPSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICAgICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHZhciByZXN1bHQgPSB0aGlzLmNvbnRleHRba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5kaXJ0eSA9IHByZXZWYWx1ZSA9PSBudWxsIHx8IHByZXZWYWx1ZSAhPSBudWxsICYmIHByZXZWYWx1ZSAhPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICAgICAgICAgIHRoaXMuZGlydHkgPSBwcmV2VmFsdWUgIT0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldChrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dFtrZXldO1xuICAgIH1cblxuICAgIGNvbnRhaW5zS2V5KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb250ZXh0Lmhhc093blByb3BlcnR5KGtleSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKGtleSkge1xuICAgICAgICBkZWxldGUgdGhpcy5jb250ZXh0W2tleV07XG4gICAgfVxuXG4gICAgc2V0RGF0YShkYXRhKSB7IC8vc2V0IGRhdGEgbW9kZWxcbiAgICAgICAgcmV0dXJuIHRoaXMucHV0KFwiZGF0YVwiLCBkYXRhKTtcbiAgICB9XG5cbiAgICBnZXREYXRhKCkgeyAvLyBnZXQgZGF0YSBtb2RlbFxuICAgICAgICByZXR1cm4gdGhpcy5nZXQoXCJkYXRhXCIpO1xuICAgIH1cblxuICAgIGdldERUTygpIHtcbiAgICAgICAgdmFyIGR0byA9IFV0aWxzLmNsb25lRGVlcCh0aGlzKTtcbiAgICAgICAgdmFyIGRhdGEgPSB0aGlzLmdldERhdGEoKTtcbiAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgIGRhdGEgPSBkYXRhLmdldERUTygpO1xuICAgICAgICAgICAgZHRvLmNvbnRleHRbXCJkYXRhXCJdID0gZGF0YTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxufVxuIiwiaW1wb3J0ICogYXMgZXhjZXB0aW9ucyBmcm9tICcuL2V4Y2VwdGlvbnMnXG5cbmV4cG9ydCB7ZXhjZXB0aW9uc31cbmV4cG9ydCAqIGZyb20gJy4vZXhlY3V0aW9uLWNvbnRleHQnXG5leHBvcnQgKiBmcm9tICcuL2pvYidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1mbGFnJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1rZXktZ2VuZXJhdG9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItbGF1bmNoZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlcnMnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1zdGF0dXMnXG5leHBvcnQgKiBmcm9tICcuL3NpbXBsZS1qb2InXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAnXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAtZXhlY3V0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwLWV4ZWN1dGlvbi1saXN0ZW5lcidcblxuXG5cblxuIiwiZXhwb3J0IGNvbnN0IEpPQl9FWEVDVVRJT05fRkxBRyA9IHtcbiAgICBTVE9QOiAnU1RPUCdcbn07XG4iLCJleHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuICAgIC8qQ2FsbGVkIGJlZm9yZSBhIGpvYiBleGVjdXRlcyovXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxuXG4gICAgLypDYWxsZWQgYWZ0ZXIgY29tcGxldGlvbiBvZiBhIGpvYi4gQ2FsbGVkIGFmdGVyIGJvdGggc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV4ZWN1dGlvbnMqL1xuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcblxuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgZXhlY3V0aW9uIG9mIGEgam9iLiovXG5leHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uIHtcbiAgICBpZDtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBqb2JQYXJhbWV0ZXJzO1xuICAgIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5VTktOT1dOO1xuICAgIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuXG4gICAgc3RhcnRUaW1lID0gbnVsbDtcbiAgICBjcmVhdGVUaW1lID0gbmV3IERhdGUoKTtcbiAgICBlbmRUaW1lID0gbnVsbDtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICBmYWlsdXJlRXhjZXB0aW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3Ioam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMsIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlO1xuICAgICAgICB0aGlzLmpvYlBhcmFtZXRlcnMgPSBqb2JQYXJhbWV0ZXJzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyIGEgc3RlcCBleGVjdXRpb24gd2l0aCB0aGUgY3VycmVudCBqb2IgZXhlY3V0aW9uLlxuICAgICAqIEBwYXJhbSBzdGVwTmFtZSB0aGUgbmFtZSBvZiB0aGUgc3RlcCB0aGUgbmV3IGV4ZWN1dGlvbiBpcyBhc3NvY2lhdGVkIHdpdGhcbiAgICAgKi9cbiAgICBjcmVhdGVTdGVwRXhlY3V0aW9uKHN0ZXBOYW1lKSB7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uID0gbmV3IFN0ZXBFeGVjdXRpb24oc3RlcE5hbWUsIHRoaXMpO1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGlzUnVubmluZygpIHtcbiAgICAgICAgcmV0dXJuICF0aGlzLmVuZFRpbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGVzdCBpZiB0aGlzIEpvYkV4ZWN1dGlvbiBoYXMgYmVlbiBzaWduYWxsZWQgdG9cbiAgICAgKiBzdG9wLlxuICAgICAqL1xuICAgIGlzU3RvcHBpbmcoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTaWduYWwgdGhlIEpvYkV4ZWN1dGlvbiB0byBzdG9wLlxuICAgICAqL1xuICAgIHN0b3AoKSB7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzZT0+IHtcbiAgICAgICAgICAgIHNlLnRlcm1pbmF0ZU9ubHkgPSB0cnVlO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgIH1cblxuICAgIGdldERhdGEoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGlvbkNvbnRleHQuZ2V0RGF0YSgpO1xuICAgIH1cblxuICAgIGdldERUTyhmaWx0ZXJlZFByb3BlcnRpZXMgPSBbXSwgZGVlcENsb25lID0gdHJ1ZSkge1xuICAgICAgICB2YXIgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZURlZXBXaXRoO1xuICAgICAgICBpZiAoIWRlZXBDbG9uZSkge1xuICAgICAgICAgICAgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZVdpdGg7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuYXNzaWduKHt9LCBjbG9uZU1ldGhvZCh0aGlzLCAodmFsdWUsIGtleSwgb2JqZWN0LCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoZmlsdGVyZWRQcm9wZXJ0aWVzLmluZGV4T2Yoa2V5KSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChbXCJqb2JQYXJhbWV0ZXJzXCIsIFwiZXhlY3V0aW9uQ29udGV4dFwiXS5pbmRleE9mKGtleSkgPiAtMSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gVXRpbHMuZ2V0RXJyb3JEVE8odmFsdWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTyhbXCJqb2JFeGVjdXRpb25cIl0sIGRlZXBDbG9uZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpXG4gICAgfVxufVxuIiwiLyogb2JqZWN0IHJlcHJlc2VudGluZyBhIHVuaXF1ZWx5IGlkZW50aWZpYWJsZSBqb2IgcnVuLiBKb2JJbnN0YW5jZSBjYW4gYmUgcmVzdGFydGVkIG11bHRpcGxlIHRpbWVzIGluIGNhc2Ugb2YgZXhlY3V0aW9uIGZhaWx1cmUgYW5kIGl0J3MgbGlmZWN5Y2xlIGVuZHMgd2l0aCBmaXJzdCBzdWNjZXNzZnVsIGV4ZWN1dGlvbiovXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2V7XG5cbiAgICBpZDtcbiAgICBqb2JOYW1lO1xuICAgIGNvbnN0cnVjdG9yKGlkLCBqb2JOYW1lKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmpvYk5hbWUgPSBqb2JOYW1lO1xuICAgIH1cblxufVxuIiwiXG5leHBvcnQgY2xhc3MgSm9iS2V5R2VuZXJhdG9yIHtcbiAgICAvKk1ldGhvZCB0byBnZW5lcmF0ZSB0aGUgdW5pcXVlIGtleSB1c2VkIHRvIGlkZW50aWZ5IGEgam9iIGluc3RhbmNlLiovXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFwiXCI7XG4gICAgICAgIGpvYlBhcmFtZXRlcnMuZGVmaW5pdGlvbnMuZm9yRWFjaCgoZCwgaSk9PiB7XG4gICAgICAgICAgICBpZihkLmlkZW50aWZ5aW5nKXtcbiAgICAgICAgICAgICAgICByZXN1bHQgKz0gZC5uYW1lICsgXCI9XCIgKyBqb2JQYXJhbWV0ZXJzLnZhbHVlc1tkLm5hbWVdICsgXCI7XCI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVzdGFydEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcblxuZXhwb3J0IGNsYXNzIEpvYkxhdW5jaGVyIHtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG4gICAgam9iV29ya2VyO1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgam9iV29ya2VyLCBkYXRhTW9kZWxTZXJpYWxpemVyKSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgICAgIHRoaXMuam9iV29ya2VyID0gam9iV29ya2VyO1xuICAgICAgICB0aGlzLmRhdGFNb2RlbFNlcmlhbGl6ZXIgPSBkYXRhTW9kZWxTZXJpYWxpemVyO1xuICAgIH1cblxuXG4gICAgcnVuKGpvYk9yTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHZhciBqb2I7XG4gICAgICAgIHZhciBqb2JQYXJhbWV0ZXJzO1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgaWYgKFV0aWxzLmlzU3RyaW5nKGpvYk9yTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk9yTmFtZSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgam9iID0gam9iT3JOYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFqb2IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIk5vIHN1Y2ggam9iOiBcIiArIGpvYk9yTmFtZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGpvYlBhcmFtZXRlcnMgPSBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzVmFsdWVzKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGUoam9iLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKTtcbiAgICAgICAgfSkudGhlbih2YWxpZD0+e1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5jcmVhdGVKb2JFeGVjdXRpb24oam9iLm5hbWUsIGpvYlBhcmFtZXRlcnMsIGRhdGEpLnRoZW4oam9iRXhlY3V0aW9uPT57XG5cblxuICAgICAgICAgICAgICAgIGlmKHRoaXMuam9iV29ya2VyKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iOiBbXCIgKyBqb2IubmFtZSArIFwiXSBleGVjdXRpb24gW1wiK2pvYkV4ZWN1dGlvbi5pZCtcIl0gZGVsZWdhdGVkIHRvIHdvcmtlclwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5qb2JXb3JrZXIuZXhlY3V0ZUpvYihqb2JFeGVjdXRpb24uaWQpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBleGVjdXRpb25Qcm9taXNlID0gdGhpcy5fZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgaWYocmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uUHJvbWlzZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdmFsaWRhdGUoam9iLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYi5uYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKGxhc3RFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChsYXN0RXhlY3V0aW9uICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWpvYi5pc1Jlc3RhcnRhYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iSW5zdGFuY2UgYWxyZWFkeSBleGlzdHMgYW5kIGlzIG5vdCByZXN0YXJ0YWJsZVwiKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBsYXN0RXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZvckVhY2goZXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlVOS05PV04pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiU3RlcCBbXCIgKyBleGVjdXRpb24uc3RlcE5hbWUgKyBcIl0gaXMgb2Ygc3RhdHVzIFVOS05PV05cIik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChqb2Iuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciAmJiAham9iLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IudmFsaWRhdGUoam9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBwYXJhbWV0ZXJzIGluIGpvYkxhdW5jaGVyLnJ1biBmb3Igam9iOiBcIitqb2IubmFtZSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoam9iLmpvYkRhdGFWYWxpZGF0b3IgJiYgIWpvYi5qb2JEYXRhVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEpKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRGF0YUludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBkYXRhIGluIGpvYkxhdW5jaGVyLnJ1biBmb3Igam9iOiBcIitqb2IubmFtZSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqRXhlY3V0ZSBwcmV2aW91c2x5IGNyZWF0ZWQgam9iIGV4ZWN1dGlvbiovXG4gICAgZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKXtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgaWYoVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpe1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChqb2JFeGVjdXRpb25PcklkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICB9KS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoIWpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gW1wiICsgam9iRXhlY3V0aW9uT3JJZCArIFwiXSBpcyBub3QgZm91bmRcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24uc3RhdHVzICE9PSBKT0JfU1RBVFVTLlNUQVJUSU5HKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gW1wiICsgam9iRXhlY3V0aW9uLmlkICsgXCJdIGFscmVhZHkgc3RhcnRlZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGpvYk5hbWUgPSBqb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZTtcbiAgICAgICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgICAgICAgICAgaWYoIWpvYil7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJObyBzdWNoIGpvYjogXCIgKyBqb2JOYW1lKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuICB0aGlzLl9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBfZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHZhciBqb2JOYW1lID0gam9iLm5hbWU7XG4gICAgICAgIGxvZy5pbmZvKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGxhdW5jaGVkIHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXVwiLCBqb2JFeGVjdXRpb24uZ2V0RGF0YSgpKTtcbiAgICAgICAgcmV0dXJuIGpvYi5leGVjdXRlKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGxvZy5pbmZvKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGNvbXBsZXRlZCB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl0gYW5kIHRoZSBmb2xsb3dpbmcgc3RhdHVzOiBbXCIgKyBqb2JFeGVjdXRpb24uc3RhdHVzICsgXCJdXCIpO1xuICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgfSkuY2F0Y2goZSA9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBmYWlsZWQgdW5leHBlY3RlZGx5IGFuZCBmYXRhbGx5IHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXVwiLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuXG5leHBvcnQgY29uc3QgUEFSQU1FVEVSX1RZUEUgPSB7XG4gICAgU1RSSU5HOiAnU1RSSU5HJyxcbiAgICBEQVRFOiAnREFURScsXG4gICAgSU5URUdFUjogJ0lOVEVHRVInLFxuICAgIE5VTUJFUjogJ0ZMT0FUJyxcbiAgICBCT09MRUFOOiAnQk9PTEVBTicsXG4gICAgTlVNQkVSX0VYUFJFU1NJT046ICdOVU1CRVJfRVhQUkVTU0lPTicsXG4gICAgQ09NUE9TSVRFOiAnQ09NUE9TSVRFJyAvL2NvbXBvc2l0ZSBwYXJhbWV0ZXIgd2l0aCBuZXN0ZWQgc3VicGFyYW1ldGVyc1xufTtcblxuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlckRlZmluaXRpb24ge1xuICAgIG5hbWU7XG4gICAgdHlwZTtcbiAgICBuZXN0ZWRQYXJhbWV0ZXJzID0gW107XG4gICAgbWluT2NjdXJzO1xuICAgIG1heE9jY3VycztcbiAgICByZXF1aXJlZCA9IHRydWU7XG5cbiAgICBpZGVudGlmeWluZztcbiAgICB2YWxpZGF0b3I7XG4gICAgc2luZ2xlVmFsdWVWYWxpZGF0b3I7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnMsIG1pbk9jY3VycyA9IDEsIG1heE9jY3VycyA9IDEsIGlkZW50aWZ5aW5nID0gZmFsc2UsIHNpbmdsZVZhbHVlVmFsaWRhdG9yID0gbnVsbCwgdmFsaWRhdG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICBpZiAoVXRpbHMuaXNBcnJheSh0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnMpKSB7XG4gICAgICAgICAgICB0aGlzLnR5cGUgPSBQQVJBTUVURVJfVFlQRS5DT01QT1NJVEU7XG4gICAgICAgICAgICB0aGlzLm5lc3RlZFBhcmFtZXRlcnMgPSB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnM7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnR5cGUgPSB0eXBlT3JOZXN0ZWRQYXJhbWV0ZXJzRGVmaW5pdGlvbnM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52YWxpZGF0b3IgPSB2YWxpZGF0b3I7XG4gICAgICAgIHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IgPSBzaW5nbGVWYWx1ZVZhbGlkYXRvcjtcbiAgICAgICAgdGhpcy5pZGVudGlmeWluZyA9IGlkZW50aWZ5aW5nO1xuICAgICAgICB0aGlzLm1pbk9jY3VycyA9IG1pbk9jY3VycztcbiAgICAgICAgdGhpcy5tYXhPY2N1cnMgPSBtYXhPY2N1cnM7XG4gICAgfVxuXG4gICAgc2V0KGtleSwgdmFsKSB7XG4gICAgICAgIHRoaXNba2V5XSA9IHZhbDtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUsIGFsbFZhbHVlcykge1xuICAgICAgICB2YXIgaXNBcnJheSA9IFV0aWxzLmlzQXJyYXkodmFsdWUpO1xuXG4gICAgICAgIGlmICh0aGlzLm1heE9jY3VycyA+IDEgJiYgIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaXNBcnJheSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVTaW5nbGVWYWx1ZSh2YWx1ZSwgYWxsVmFsdWVzKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlLmxlbmd0aCA8IHRoaXMubWluT2NjdXJzIHx8IHZhbHVlLmxlbmd0aCA+IHRoaXMubWF4T2NjdXJzKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXZhbHVlLmV2ZXJ5KHY9PnRoaXMudmFsaWRhdGVTaW5nbGVWYWx1ZSh2LCB2YWx1ZSkpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy52YWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRvcih2YWx1ZSwgYWxsVmFsdWVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHN0YXRpYyBjb21wdXRlTnVtYmVyRXhwcmVzc2lvbih2YWwpe1xuICAgICAgICBsZXQgcGFyc2VkID0gcGFyc2VGbG9hdCh2YWwpO1xuICAgICAgICBpZihwYXJzZWQgPT09IEluZmluaXR5IHx8IHBhcnNlZCA9PT0gLUluZmluaXR5KSB7XG4gICAgICAgICAgICByZXR1cm4gcGFyc2VkO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoIUV4cHJlc3Npb25FbmdpbmUudmFsaWRhdGUodmFsLCB7fSwgZmFsc2UpKXtcbiAgICAgICAgICAgIHJldHVybiBudWxsXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5ldmFsKHZhbCwgdHJ1ZSlcbiAgICB9XG5cbiAgICAvLyBhbGxWYWx1ZXMgLSBhbGwgdmFsdWVzIG9uIHRoZSBzYW1lIGxldmVsXG4gICAgdmFsaWRhdGVTaW5nbGVWYWx1ZSh2YWx1ZSwgYWxsVmFsdWVzKSB7XG5cbiAgICAgICAgaWYgKCghdmFsdWUgJiYgdmFsdWUgIT09IDAgJiYgdmFsdWUgIT09IGZhbHNlKSAmJiB0aGlzLm1pbk9jY3VycyA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAhdGhpcy5yZXF1aXJlZFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLlNUUklORyA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc1N0cmluZyh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuREFURSA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLklOVEVHRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNJbnQodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLk5VTUJFUiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc051bWJlcih2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5CT09MRUFOID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzQm9vbGVhbih2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIHZhbHVlID0gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbih2YWx1ZSk7XG4gICAgICAgICAgICBpZih2YWx1ZSA9PT0gbnVsbCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIGlmICghVXRpbHMuaXNPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0aGlzLm5lc3RlZFBhcmFtZXRlcnMuZXZlcnkoKG5lc3RlZERlZiwgaSk9Pm5lc3RlZERlZi52YWxpZGF0ZSh2YWx1ZVtuZXN0ZWREZWYubmFtZV0pKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvcih2YWx1ZSwgYWxsVmFsdWVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHZhbHVlKHZhbHVlKXtcbiAgICAgICAgaWYoUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04gPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgcmV0dXJuIEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24odmFsdWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbn1cbiIsImltcG9ydCB7UEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJze1xuICAgIGRlZmluaXRpb25zID0gW107XG4gICAgdmFsdWVzPXt9O1xuXG4gICAgY29uc3RydWN0b3IodmFsdWVzKXtcbiAgICAgICAgdGhpcy5pbml0RGVmaW5pdGlvbnMoKTtcbiAgICAgICAgdGhpcy5pbml0RGVmYXVsdFZhbHVlcygpO1xuICAgICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMudmFsdWVzLCB2YWx1ZXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdERlZmluaXRpb25zKCl7XG5cbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpe1xuXG4gICAgfVxuXG4gICAgdmFsaWRhdGUoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVmaW5pdGlvbnMuZXZlcnkoKGRlZiwgaSk9PmRlZi52YWxpZGF0ZSh0aGlzLnZhbHVlc1tkZWYubmFtZV0sIHRoaXMudmFsdWVzKSk7XG4gICAgfVxuXG4gICAgZ2V0RGVmaW5pdGlvbihwYXRoKXtcbiAgICAgICAgdmFyIGRlZnMgPXRoaXMuZGVmaW5pdGlvbnM7XG4gICAgICAgIGxldCBkZWYgPSBudWxsO1xuICAgICAgICBpZighcGF0aC5zcGxpdCgpLmV2ZXJ5KG5hbWU9PntcbiAgICAgICAgICAgICAgICBkZWYgPSBVdGlscy5maW5kKGRlZnMsIGQ9PmQubmFtZSA9PSBuYW1lKTtcbiAgICAgICAgICAgICAgICBpZighZGVmKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZnMgPSBkZWYubmVzdGVkUGFyYW1ldGVycztcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSkpe1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGRlZjtcbiAgICB9XG5cbiAgICAvKmdldCBvciBzZXQgdmFsdWUgYnkgcGF0aCovXG4gICAgdmFsdWUocGF0aCwgdmFsdWUpe1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgbGV0IGRlZiA9IHRoaXMuZ2V0RGVmaW5pdGlvbihwYXRoKTtcbiAgICAgICAgICAgIGxldCB2YWwgPSBVdGlscy5nZXQodGhpcy52YWx1ZXMsIHBhdGgsIG51bGwpO1xuICAgICAgICAgICAgaWYoZGVmKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVmLnZhbHVlKHZhbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gIHZhbDtcbiAgICAgICAgfVxuICAgICAgICBVdGlscy5zZXQodGhpcy52YWx1ZXMsIHBhdGgsIHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHRvU3RyaW5nKCl7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIkpvYlBhcmFtZXRlcnNbXCI7XG5cbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcblxuICAgICAgICAgICAgdmFyIHZhbCA9IHRoaXMudmFsdWVzW2QubmFtZV07XG4gICAgICAgICAgICAvLyBpZihVdGlscy5pc0FycmF5KHZhbCkpe1xuICAgICAgICAgICAgLy8gICAgIHZhciB2YWx1ZXMgPSB2YWw7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIC8vIGlmKFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURSA9PSBkLnR5cGUpe1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiK3ZhbCArIFwiO1wiO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVzdWx0Kz1cIl1cIjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBnZXREVE8oKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlczogdGhpcy52YWx1ZXNcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7ZGVmYXVsdCBhcyBpZGJ9IGZyb20gXCJpZGJcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyogSW5kZXhlZERCIGpvYiByZXBvc2l0b3J5Ki9cbmV4cG9ydCBjbGFzcyBJZGJKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBkYlByb21pc2U7XG4gICAgam9iSW5zdGFuY2VEYW87XG4gICAgam9iRXhlY3V0aW9uRGFvO1xuICAgIHN0ZXBFeGVjdXRpb25EYW87XG4gICAgam9iUmVzdWx0RGFvO1xuICAgIGpvYkV4ZWN1dGlvblByb2dyZXNzRGFvO1xuICAgIGpvYkV4ZWN1dGlvbkZsYWdEYW87XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc1Jldml2ZXIsIGRiTmFtZSA9ICdzZC1qb2ItcmVwb3NpdG9yeScsIGRlbGV0ZURCID0gZmFsc2UpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5kYk5hbWUgPSBkYk5hbWU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNSZXZpdmVyID0gZXhwcmVzc2lvbnNSZXZpdmVyO1xuICAgICAgICBpZiAoZGVsZXRlREIpIHtcbiAgICAgICAgICAgIHRoaXMuZGVsZXRlREIoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgICAgIHRoaXMuaW5pdERCKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5pbml0REIoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdERCKCkge1xuICAgICAgICB0aGlzLmRiUHJvbWlzZSA9IGlkYi5vcGVuKHRoaXMuZGJOYW1lLCAyLCB1cGdyYWRlREIgPT4ge1xuICAgICAgICAgICAgLy8gTm90ZTogd2UgZG9uJ3QgdXNlICdicmVhaycgaW4gdGhpcyBzd2l0Y2ggc3RhdGVtZW50LFxuICAgICAgICAgICAgLy8gdGhlIGZhbGwtdGhyb3VnaCBiZWhhdmlvdXIgaXMgd2hhdCB3ZSB3YW50LlxuICAgICAgICAgICAgc3dpdGNoICh1cGdyYWRlREIub2xkVmVyc2lvbikge1xuICAgICAgICAgICAgICAgIGNhc2UgMDpcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItaW5zdGFuY2VzJyk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBqb2JFeGVjdXRpb25zT1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb25zJyk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJjcmVhdGVUaW1lXCIsIFwiY3JlYXRlVGltZVwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJzdGF0dXNcIiwgXCJzdGF0dXNcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJyk7XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbi1mbGFncycpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnNPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnc3RlcC1leGVjdXRpb25zJyk7XG4gICAgICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBcImpvYkV4ZWN1dGlvbklkXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGpvYlJlc3VsdE9TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItcmVzdWx0cycpO1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHRPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7dW5pcXVlOiB0cnVlfSk7XG4gICAgICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIudHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2pvYi1pbnN0YW5jZXMnKS5jcmVhdGVJbmRleChcImlkXCIsIFwiaWRcIiwge3VuaXF1ZTogdHJ1ZX0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1pbnN0YW5jZXMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9ucycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0RhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbi1wcm9ncmVzcycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9uLWZsYWdzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ3N0ZXAtZXhlY3V0aW9ucycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHREYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1yZXN1bHRzJywgdGhpcy5kYlByb21pc2UpO1xuICAgIH1cblxuICAgIGRlbGV0ZURCKCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihfPT5pZGIuZGVsZXRlKHRoaXMuZGJOYW1lKSk7XG4gICAgfVxuXG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLnJlbW92ZShrZXkpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZhbHNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PnsgIC8vICBOb3Qgd2FpdGluZyBmb3IgcHJvbWlzZSByZXNvbHZlc1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKS50aGVuKGpvYlJlc3VsdD0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLnJlbW92ZShqb2JFeGVjdXRpb24uaWQpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb24uaWQsIGZhbHNlKS50aGVuKHN0ZXBFeGVjdXRpb25zPT57ICAvLyBOb3Qgd2FpdGluZyBmb3IgcHJvbWlzZSByZXNvbHZlc1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2godGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnJlbW92ZShzdGVwRXhlY3V0aW9uLmlkKVxuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8ucmVtb3ZlKGpvYlJlc3VsdC5pZCk7XG4gICAgfVxuXG5cblxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXQoam9iUmVzdWx0SWQpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLmdldEJ5SW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIGpvYkluc3RhbmNlLmlkKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uc2V0KGpvYlJlc3VsdC5pZCwgam9iUmVzdWx0KS50aGVuKHI9PmpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8uZ2V0KGtleSkudGhlbihkdG89PmR0byA/IHRoaXMucmV2aXZlSm9iSW5zdGFuY2UoZHRvKSA6IGR0byk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLnNldChrZXksIGpvYkluc3RhbmNlKS50aGVuKHI9PmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IGpvYkV4ZWN1dGlvbi5nZXREVE8oKTtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zRFRPcyA9IGR0by5zdGVwRXhlY3V0aW9ucztcbiAgICAgICAgZHRvLnN0ZXBFeGVjdXRpb25zID0gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLnNldChqb2JFeGVjdXRpb24uaWQsIGR0bykudGhlbihyPT50aGlzLnNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnNEVE9zKSkudGhlbihyPT5qb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcykge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZykge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvLnNldChqb2JFeGVjdXRpb25JZCwgZmxhZylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IHN0ZXBFeGVjdXRpb24uZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSk7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uc2V0KHN0ZXBFeGVjdXRpb24uaWQsIGR0bykudGhlbihyPT5zdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnMgPSBbXSkge1xuICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IHNhdmVkRXhlY3V0aW9ucy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc2F2ZWRFeGVjdXRpb25zKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbkRUTyA9IHN0ZXBFeGVjdXRpb25zW3NhdmVkRXhlY3V0aW9ucy5sZW5ndGhdO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uRFRPLmlkLCBzdGVwRXhlY3V0aW9uRFRPKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc2F2ZWRFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbkRUTyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5nZXQoaWQpLnRoZW4oZHRvPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZHRvKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRFRPLCByZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIGlmICgham9iRXhlY3V0aW9uRFRPKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbkRUTy5pZCwgZmFsc2UpLnRoZW4oc3RlcHM9PiB7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25EVE8uc3RlcEV4ZWN1dGlvbnMgPSBzdGVwcztcbiAgICAgICAgICAgIGlmICghcmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbkRUTztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJldml2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb25EVE8pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0LCByZXZpdmUgPSB0cnVlLCBmZXRjaGVkID0gW10pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbkR0b0xpc3QubGVuZ3RoIDw9IGZldGNoZWQubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZldGNoZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3RbZmV0Y2hlZC5sZW5ndGhdLCByZXZpdmUpLnRoZW4oKGpvYkV4ZWN1dGlvbik9PiB7XG4gICAgICAgICAgICBmZXRjaGVkLnB1c2goam9iRXhlY3V0aW9uKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZSwgZmV0Y2hlZCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25JZCwgcmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBqb2JFeGVjdXRpb25JZCkudGhlbihkdG9zPT4ge1xuICAgICAgICAgICAgaWYgKCFyZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZHRvcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkdG9zLm1hcChkdG89PnRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8pKTtcbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5nZXRBbGxCeUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBqb2JJbnN0YW5jZS5pZCkudGhlbih2YWx1ZXM9PiB7XG4gICAgICAgICAgICB2YXIgc29ydGVkID0gdmFsdWVzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIWZldGNoUmVsYXRpb25zQW5kUmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKHNvcnRlZCwgdHJ1ZSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZhbHNlKS50aGVuKGV4ZWN1dGlvbnM9PnRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtIDFdKSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PiB7XG4gICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+IHtcbiAgICAgICAgICAgICAgICBpZiAobGF0ZXN0ID09IG51bGwgfHwgbGF0ZXN0LnN0YXJ0VGltZS5nZXRUaW1lKCkgPCBzLnN0YXJ0VGltZS5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGF0ZXN0ID0gcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBsYXRlc3Q7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV2aXZlSm9iSW5zdGFuY2UoZHRvKSB7XG4gICAgICAgIHJldHVybiBuZXcgSm9iSW5zdGFuY2UoZHRvLmlkLCBkdG8uam9iTmFtZSk7XG4gICAgfVxuXG4gICAgcmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8pIHtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICBleGVjdXRpb25Db250ZXh0LmNvbnRleHQgPSBkdG8uY29udGV4dDtcbiAgICAgICAgdmFyIGRhdGEgPSBleGVjdXRpb25Db250ZXh0LmdldERhdGEoKTtcbiAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBkYXRhTW9kZWwgPSBuZXcgRGF0YU1vZGVsKCk7XG4gICAgICAgICAgICBkYXRhTW9kZWwubG9hZEZyb21EVE8oZGF0YSwgdGhpcy5leHByZXNzaW9uc1Jldml2ZXIpO1xuICAgICAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5zZXREYXRhKGRhdGFNb2RlbCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHRcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG5cbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuZ2V0Sm9iQnlOYW1lKGR0by5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8uam9iSW5zdGFuY2UpO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGR0by5qb2JQYXJhbWV0ZXJzLnZhbHVlcyk7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoam9iRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iSW5zdGFuY2VcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYlBhcmFtZXRlcnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JFeGVjdXRpb25cIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwic3RlcEV4ZWN1dGlvbnNcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBzcmNWYWx1ZS5tYXAoc3RlcERUTyA9PiB0aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oc3RlcERUTywgam9iRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKGR0by5zdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBkdG8uaWQpO1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IHRoaXMucmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJldHVybiBVdGlscy5tZXJnZVdpdGgoc3RlcEV4ZWN1dGlvbiwgZHRvLCAob2JqVmFsdWUsIHNyY1ZhbHVlLCBrZXksIG9iamVjdCwgc291cmNlLCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiZXhlY3V0aW9uQ29udGV4dFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuXG5cbmNsYXNzIE9iamVjdFN0b3JlRGFvIHtcblxuICAgIG5hbWU7XG4gICAgZGJQcm9taXNlO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgZGJQcm9taXNlKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuZGJQcm9taXNlID0gZGJQcm9taXNlO1xuICAgIH1cblxuICAgIGdldChrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5nZXQoa2V5KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0QWxsQnlJbmRleChpbmRleE5hbWUsIGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmluZGV4KGluZGV4TmFtZSkuZ2V0QWxsKGtleSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0QnlJbmRleChpbmRleE5hbWUsIGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmluZGV4KGluZGV4TmFtZSkuZ2V0KGtleSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2V0KGtleSwgdmFsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLnB1dCh2YWwsIGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuZGVsZXRlKGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNsZWFyKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5jbGVhcigpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBrZXlzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBrZXlzID0gW107XG4gICAgICAgICAgICBjb25zdCBzdG9yZSA9IHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSk7XG5cbiAgICAgICAgICAgIC8vIFRoaXMgd291bGQgYmUgc3RvcmUuZ2V0QWxsS2V5cygpLCBidXQgaXQgaXNuJ3Qgc3VwcG9ydGVkIGJ5IEVkZ2Ugb3IgU2FmYXJpLlxuICAgICAgICAgICAgLy8gb3BlbktleUN1cnNvciBpc24ndCBzdXBwb3J0ZWQgYnkgU2FmYXJpLCBzbyB3ZSBmYWxsIGJhY2tcbiAgICAgICAgICAgIChzdG9yZS5pdGVyYXRlS2V5Q3Vyc29yIHx8IHN0b3JlLml0ZXJhdGVDdXJzb3IpLmNhbGwoc3RvcmUsIGN1cnNvciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFjdXJzb3IpIHJldHVybjtcbiAgICAgICAgICAgICAgICBrZXlzLnB1c2goY3Vyc29yLmtleSk7XG4gICAgICAgICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlLnRoZW4oKCkgPT4ga2V5cyk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iS2V5R2VuZXJhdG9yfSBmcm9tIFwiLi4vam9iLWtleS1nZW5lcmF0b3JcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0pvYlJlc3VsdH0gZnJvbSBcIi4uL2pvYi1yZXN1bHRcIjtcblxuZXhwb3J0IGNsYXNzIEpvYlJlcG9zaXRvcnkge1xuXG4gICAgam9iQnlOYW1lID0ge307XG5cbiAgICByZWdpc3RlckpvYihqb2IpIHtcbiAgICAgICAgdGhpcy5qb2JCeU5hbWVbam9iLm5hbWVdID0gam9iO1xuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkJ5TmFtZVtuYW1lXTtcbiAgICB9XG5cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5IGdldEpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShrZXksIGpvYkluc3RhbmNlKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvblByb2dyZXNzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uRmxhZyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZVN0ZXBFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5maW5kSm9iRXhlY3V0aW9ucyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2V0Sm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZVN0ZXBFeGVjdXRpb24gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypDcmVhdGUgYSBuZXcgSm9iSW5zdGFuY2Ugd2l0aCB0aGUgbmFtZSBhbmQgam9iIHBhcmFtZXRlcnMgcHJvdmlkZWQuIHJldHVybiBwcm9taXNlKi9cbiAgICBjcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IG5ldyBKb2JJbnN0YW5jZShVdGlscy5ndWlkKCksIGpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ2hlY2sgaWYgYW4gaW5zdGFuY2Ugb2YgdGhpcyBqb2IgYWxyZWFkeSBleGlzdHMgd2l0aCB0aGUgcGFyYW1ldGVycyBwcm92aWRlZC4qL1xuICAgIGlzSm9iSW5zdGFuY2VFeGlzdHMoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKHJlc3VsdCA9PiAhIXJlc3VsdCkuY2F0Y2goZXJyb3I9PmZhbHNlKTtcbiAgICB9XG5cbiAgICBnZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIGpvYk5hbWUgKyBcInxcIiArIEpvYktleUdlbmVyYXRvci5nZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIEpvYkV4ZWN1dGlvbiBmb3IgYSBnaXZlbiAgSm9iIGFuZCBKb2JQYXJhbWV0ZXJzLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyxcbiAgICAgKiB0aGUgam9iIG11c3QgYmUgcmVzdGFydGFibGUgYW5kIGl0J3MgbGFzdCBKb2JFeGVjdXRpb24gbXVzdCAqbm90KiBiZVxuICAgICAqIGNvbXBsZXRlZC4gSWYgbWF0Y2hpbmcgSm9iSW5zdGFuY2UgZG9lcyBub3QgZXhpc3QgeWV0IGl0IHdpbGwgYmUgIGNyZWF0ZWQuKi9cblxuICAgIGNyZWF0ZUpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oam9iSW5zdGFuY2U9PntcbiAgICAgICAgICAgIGlmIChqb2JJbnN0YW5jZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oZXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgICAgICAgICBleGVjdXRpb25zLmZvckVhY2goZXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbihcIkEgam9iIGV4ZWN1dGlvbiBmb3IgdGhpcyBqb2IgaXMgYWxyZWFkeSBydW5uaW5nOiBcIiArIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkFCQU5ET05FRCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJBIGpvYiBpbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgY29tcGxldGUgZm9yIHBhcmFtZXRlcnM9XCIgKyBqb2JQYXJhbWV0ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICsgXCIuICBJZiB5b3Ugd2FudCB0byBydW4gdGhpcyBqb2IgYWdhaW4sIGNoYW5nZSB0aGUgcGFyYW1ldGVycy5cIik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtIDFdLmV4ZWN1dGlvbkNvbnRleHQ7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtqb2JJbnN0YW5jZSwgZXhlY3V0aW9uQ29udGV4dF07XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbm8gam9iIGZvdW5kLCBjcmVhdGUgb25lXG4gICAgICAgICAgICBqb2JJbnN0YW5jZSA9IHRoaXMuY3JlYXRlSm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICB2YXIgZGF0YU1vZGVsID0gbmV3IERhdGFNb2RlbCgpO1xuICAgICAgICAgICAgZGF0YU1vZGVsLl9zZXROZXdTdGF0ZShkYXRhLmNyZWF0ZVN0YXRlU25hcHNob3QoKSk7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YU1vZGVsKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbam9iSW5zdGFuY2UsIGV4ZWN1dGlvbkNvbnRleHRdKTtcbiAgICAgICAgfSkudGhlbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHQ9PntcbiAgICAgICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFswXSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFsxXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oKGpvYkluc3RhbmNlKT0+e1xuICAgICAgICAgICAgaWYoIWpvYkluc3RhbmNlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGV4ZWN1dGlvbnM9PmV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLTFdKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zPVtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT57XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGFkZFN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlKG8pe1xuICAgICAgICBvLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IFwiT2JqZWN0IG5vdCB1cGRhdGFibGU6IFwiK29cbiAgICB9XG5cbiAgICByZW1vdmUobyl7XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYlJlc3VsdCl7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JSZXN1bHQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcIk9iamVjdCBub3QgcmVtb3ZhYmxlOiBcIitvKTtcbiAgICB9XG5cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlSm9iRXhlY3V0aW9uKGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZVN0ZXBFeGVjdXRpb24oZHRvLCBqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIFNpbXBsZUpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBKb2JSZXBvc2l0b3J5e1xuICAgIGpvYkluc3RhbmNlc0J5S2V5ID0ge307XG4gICAgam9iRXhlY3V0aW9ucyA9IFtdO1xuICAgIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgZXhlY3V0aW9uUHJvZ3Jlc3MgPSB7fTtcbiAgICBleGVjdXRpb25GbGFncyA9IHt9O1xuICAgIGpvYlJlc3VsdHMgPSBbXTtcblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgVXRpbHMuZm9yT3duKHRoaXMuam9iSW5zdGFuY2VzQnlLZXksICAoamksIGtleSk9PntcbiAgICAgICAgICAgIGlmKGppPT09am9iSW5zdGFuY2Upe1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVKb2JFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMuZmlsdGVyKGpvYlJlc3VsdD0+am9iUmVzdWx0LmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYlJlc3VsdCwgdGhpcyk7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLmpvYkV4ZWN1dGlvbnMuaW5kZXhPZihqb2JFeGVjdXRpb24pO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHN0ZXBFeGVjdXRpb249PnN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkID09PSBqb2JFeGVjdXRpb24uaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLnN0ZXBFeGVjdXRpb25zLmluZGV4T2Yoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuam9iUmVzdWx0cy5pbmRleE9mKGpvYlJlc3VsdCk7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYlJlc3VsdHMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0gPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JJbnN0YW5jZSlcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmlkPT09am9iUmVzdWx0SWQpKVxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmpvYkluc3RhbmNlLmlkPT09am9iSW5zdGFuY2UuaWQpKVxuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5wdXNoKGpvYlJlc3VsdCk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iRXhlY3V0aW9ucywgZXg9PmV4LmlkPT09aWQpKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5wdXNoKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSA9IHByb2dyZXNzO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHByb2dyZXNzKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSlcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdID0gZmxhZztcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmbGFnKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihlPT5lLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgfSkpO1xuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U2ltcGxlSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vc2ltcGxlLWpvYi1yZXBvc2l0b3J5XCI7XG5cblxuXG5leHBvcnQgY2xhc3MgVGltZW91dEpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBTaW1wbGVKb2JSZXBvc2l0b3J5e1xuXG4gICAgY3JlYXRlVGltZW91dFByb21pc2UodmFsdWVUb1Jlc29sdmUsIGRlbGF5PTEpe1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZT0+e1xuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgICAgICAgICAgIHJlc29sdmUodmFsdWVUb1Jlc29sdmUpO1xuICAgICAgICAgICAgfSwgZGVsYXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5pZD09PWpvYlJlc3VsdElkKSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmpvYkluc3RhbmNlLmlkPT09am9iSW5zdGFuY2UuaWQpKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMucHVzaChqb2JSZXN1bHQpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iRXhlY3V0aW9ucywgZXg9PmV4LmlkPT09aWQpKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMucHVzaChqb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdID0gcHJvZ3Jlc3M7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHByb2dyZXNzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdKTtcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdID0gZmxhZztcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoZmxhZyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuZXhlY3V0aW9uRmxhZ3Nbam9iRXhlY3V0aW9uSWRdKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5qb2JFeGVjdXRpb25zLmZpbHRlcihlPT5lLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gYS5jcmVhdGVUaW1lLmdldFRpbWUoKSAtIGIuY3JlYXRlVGltZS5nZXRUaW1lKClcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHJlbW92ZShvYmplY3QpeyAvL1RPRE9cblxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5cbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIHJlc3VsdCBvZiBhIGpvYiBpbnN0YW5jZS4qL1xuZXhwb3J0IGNsYXNzIEpvYlJlc3VsdCB7XG4gICAgaWQ7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgZGF0YTtcblxuICAgIGNvbnN0cnVjdG9yKGpvYkluc3RhbmNlLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZTtcbiAgICB9XG59XG4iLCJleHBvcnQgY29uc3QgSk9CX1NUQVRVUyA9IHtcbiAgICBDT01QTEVURUQ6ICdDT01QTEVURUQnLFxuICAgIFNUQVJUSU5HOiAnU1RBUlRJTkcnLFxuICAgIFNUQVJURUQ6ICdTVEFSVEVEJyxcbiAgICBTVE9QUElORzogJ1NUT1BQSU5HJyxcbiAgICBTVE9QUEVEOiAnU1RPUFBFRCcsXG4gICAgRkFJTEVEOiAnRkFJTEVEJyxcbiAgICBVTktOT1dOOiAnVU5LTk9XTicsXG4gICAgQUJBTkRPTkVEOiAnQUJBTkRPTkVEJyxcbiAgICBFWEVDVVRJTkc6ICdFWEVDVVRJTkcnIC8vZm9yIGV4aXQgc3RhdHVzIG9ubHlcbn07XG4iLCJpbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuaW1wb3J0IHtKb2JSZXN1bHR9IGZyb20gXCIuL2pvYi1yZXN1bHRcIjtcbi8qQmFzZSBjbGFzcyBmb3Igam9icyovXG4vL0EgSm9iIGlzIGFuIGVudGl0eSB0aGF0IGVuY2Fwc3VsYXRlcyBhbiBlbnRpcmUgam9iIHByb2Nlc3MgKCBhbiBhYnN0cmFjdGlvbiByZXByZXNlbnRpbmcgdGhlIGNvbmZpZ3VyYXRpb24gb2YgYSBqb2IpLlxuXG5leHBvcnQgY2xhc3MgSm9iIHtcblxuICAgIGlkO1xuICAgIG5hbWU7XG4gICAgc3RlcHMgPSBbXTtcblxuICAgIGlzUmVzdGFydGFibGU9dHJ1ZTtcbiAgICBleGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcbiAgICBqb2JQYXJhbWV0ZXJzVmFsaWRhdG9yO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yID0gdGhpcy5nZXRKb2JQYXJhbWV0ZXJzVmFsaWRhdG9yKCk7XG4gICAgICAgIHRoaXMuam9iRGF0YVZhbGlkYXRvciA9IHRoaXMuZ2V0Sm9iRGF0YVZhbGlkYXRvcigpO1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIH1cblxuICAgIHNldEpvYlJlcG9zaXRvcnkoam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIGV4ZWN1dGUoZXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gc3RhcnRpbmc6IFwiLCBleGVjdXRpb24pO1xuICAgICAgICB2YXIgam9iUmVzdWx0O1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0V4ZWN1dGlvbkZsYWdzKGV4ZWN1dGlvbikudGhlbihleGVjdXRpb249PntcblxuICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuU1RPUFBJTkcpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGUgam9iIHdhcyBhbHJlYWR5IHN0b3BwZWRcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiB3YXMgc3RvcHBlZDogXCIgKyBleGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgJiYgIXRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvci52YWxpZGF0ZShleGVjdXRpb24uam9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBwYXJhbWV0ZXJzIGluIGpvYiBleGVjdXRlXCIpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHRoaXMuam9iRGF0YVZhbGlkYXRvciAmJiAhdGhpcy5qb2JEYXRhVmFsaWRhdG9yLnZhbGlkYXRlKGV4ZWN1dGlvbi5nZXREYXRhKCkpKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRGF0YUludmFsaWRFeGNlcHRpb24oXCJJbnZhbGlkIGpvYiBkYXRhIGluIGpvYiBleGVjdXRlXCIpXG4gICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMudXBkYXRlU3RhdHVzKGV4ZWN1dGlvbiwgSk9CX1NUQVRVUy5TVEFSVEVEKSwgdGhpcy5nZXRSZXN1bHQoZXhlY3V0aW9uKSwgdGhpcy51cGRhdGVQcm9ncmVzcyhleGVjdXRpb24pXSkudGhlbihyZXM9PntcbiAgICAgICAgICAgICAgICBleGVjdXRpb249cmVzWzBdO1xuICAgICAgICAgICAgICAgIGpvYlJlc3VsdCA9IHJlc1sxXTtcbiAgICAgICAgICAgICAgICBpZigham9iUmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdCA9IG5ldyBKb2JSZXN1bHQoZXhlY3V0aW9uLmpvYkluc3RhbmNlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5iZWZvcmVKb2IoZXhlY3V0aW9uKSk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gY29tcGxldGU6IFwiLGV4ZWN1dGlvbik7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIGlmIChlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pIHtcbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkVuY291bnRlcmVkIGludGVycnVwdGlvbiBleGVjdXRpbmcgam9iXCIsIGUpO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGZhdGFsIGVycm9yIGV4ZWN1dGluZyBqb2JcIiwgZSk7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZihqb2JSZXN1bHQpe1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpLnRoZW4oKCk9PmV4ZWN1dGlvbilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgZmF0YWwgZXJyb3Igc2F2aW5nIGpvYiByZXN1bHRzXCIsIGUpO1xuICAgICAgICAgICAgaWYoZSl7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGV4ZWN1dGlvbi5lbmRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShleGVjdXRpb24pLCB0aGlzLnVwZGF0ZVByb2dyZXNzKGV4ZWN1dGlvbildKS50aGVuKHJlcz0+cmVzWzBdKVxuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5hZnRlckpvYihleGVjdXRpb24pKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gZW5jb3VudGVyZWQgaW4gYWZ0ZXJTdGVwIGNhbGxiYWNrXCIsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIHVwZGF0ZVN0YXR1cyhqb2JFeGVjdXRpb24sIHN0YXR1cykge1xuICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzPXN0YXR1cztcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoam9iRXhlY3V0aW9uKVxuICAgIH1cblxuICAgIHVwZGF0ZVByb2dyZXNzKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uLmlkLCB0aGlzLmdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbikpO1xuICAgIH1cblxuICAgIC8qIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyBhbGxvd2luZyB0aGVtIHRvIGNvbmNlbnRyYXRlIG9uIHByb2Nlc3NpbmcgbG9naWMgYW5kIGlnbm9yZSBsaXN0ZW5lcnMsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93ICdkb0V4ZWN1dGUgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICBnZXRKb2JQYXJhbWV0ZXJzVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChwYXJhbXMpID0+IHBhcmFtcy52YWxpZGF0ZSgpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRTdGVwKHN0ZXApe1xuICAgICAgICB0aGlzLnN0ZXBzLnB1c2goc3RlcCk7XG4gICAgfVxuXG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyl7XG4gICAgICAgIHRocm93ICdjcmVhdGVKb2JQYXJhbWV0ZXJzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAqIGN1cnJlbnRcbiAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgY3VycmVudDogZXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQgPyAxIDogMFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcil7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xuICAgIH1cblxuICAgIGNoZWNrRXhlY3V0aW9uRmxhZ3MoZXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25GbGFnKGV4ZWN1dGlvbi5pZCkudGhlbihmbGFnPT57XG4gICAgICAgICAgICBpZihKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCA9PT0gZmxhZyl7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0b3AoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRSZXN1bHQoZXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShleGVjdXRpb24uam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB0aHJvdyAnam9iUmVzdWx0VG9Dc3ZSb3dzIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxufVxuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYn0gZnJvbSBcIi4vam9iXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5cbi8qIFNpbXBsZSBKb2IgdGhhdCBzZXF1ZW50aWFsbHkgZXhlY3V0ZXMgYSBqb2IgYnkgaXRlcmF0aW5nIHRocm91Z2ggaXRzIGxpc3Qgb2Ygc3RlcHMuICBBbnkgU3RlcCB0aGF0IGZhaWxzIHdpbGwgZmFpbCB0aGUgam9iLiAgVGhlIGpvYiBpc1xuIGNvbnNpZGVyZWQgY29tcGxldGUgd2hlbiBhbGwgc3RlcHMgaGF2ZSBiZWVuIGV4ZWN1dGVkLiovXG5cbmV4cG9ydCBjbGFzcyBTaW1wbGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKVxuICAgIH1cblxuICAgIGdldFN0ZXAoc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIFV0aWxzLmZpbmQodGhpcy5zdGVwcywgcz0+cy5uYW1lID09IHN0ZXBOYW1lKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChleGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgbG9nLmRlYnVnKFwiVXBkYXRpbmcgSm9iRXhlY3V0aW9uIHN0YXR1czogXCIsIGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cztcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaCguLi5sYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGFuZGxlTmV4dFN0ZXAoam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQsIHByZXZTdGVwPW51bGwsIHByZXZTdGVwRXhlY3V0aW9uPW51bGwpe1xuICAgICAgICB2YXIgc3RlcEluZGV4ID0gMDtcbiAgICAgICAgaWYocHJldlN0ZXApe1xuICAgICAgICAgICAgc3RlcEluZGV4ID0gdGhpcy5zdGVwcy5pbmRleE9mKHByZXZTdGVwKSsxO1xuICAgICAgICB9XG4gICAgICAgIGlmKHN0ZXBJbmRleD49dGhpcy5zdGVwcy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcmV2U3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IHRoaXMuc3RlcHNbc3RlcEluZGV4XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZihzdGVwRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5DT01QTEVURUQpeyAvLyBUZXJtaW5hdGUgdGhlIGpvYiBpZiBhIHN0ZXAgZmFpbHNcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBzdGVwLCBzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBoYW5kbGVTdGVwKHN0ZXAsIGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmlzU3RvcHBpbmcoKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwLm5hbWUpXG5cbiAgICAgICAgfSkudGhlbihsYXN0U3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKHRoaXMuc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgbGFzdFN0ZXBFeGVjdXRpb24pKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlIGxhc3QgZXhlY3V0aW9uIG9mIHRoaXMgc3RlcCB3YXMgaW4gdGhlIHNhbWUgam9iLCBpdCdzIHByb2JhYmx5IGludGVudGlvbmFsIHNvIHdlIHdhbnQgdG8gcnVuIGl0IGFnYWluLlxuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRHVwbGljYXRlIHN0ZXAgZGV0ZWN0ZWQgaW4gZXhlY3V0aW9uIG9mIGpvYi4gc3RlcDogXCIgKyBzdGVwLm5hbWUgKyBcIiBqb2JOYW1lOiBcIiwgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgbGFzdFN0ZXBFeGVjdXRpb24gPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBsYXN0U3RlcEV4ZWN1dGlvbjtcblxuICAgICAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0YXJ0KGN1cnJlbnRTdGVwRXhlY3V0aW9uLCBqb2JFeGVjdXRpb24sIHN0ZXApKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbi5jcmVhdGVTdGVwRXhlY3V0aW9uKHN0ZXAubmFtZSk7XG5cbiAgICAgICAgICAgIHZhciBpc0NvbXBsZXRlZCA9IGxhc3RTdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIHZhciBpc1Jlc3RhcnQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmICFpc0NvbXBsZXRlZDtcbiAgICAgICAgICAgIHZhciBza2lwRXhlY3V0aW9uID0gaXNDb21wbGV0ZWQgJiYgc3RlcC5za2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ7XG5cbiAgICAgICAgICAgIGlmIChpc1Jlc3RhcnQpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5jb250YWluc0tleShcImV4ZWN1dGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucmVtb3ZlKFwiZXhlY3V0ZWRcIik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHNraXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInNraXBwZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuYWRkU3RlcEV4ZWN1dGlvbihjdXJyZW50U3RlcEV4ZWN1dGlvbikudGhlbigoX2N1cnJlbnRTdGVwRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uPV9jdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmluZm8oXCJTa2lwcGluZyBjb21wbGV0ZWQgc3RlcCBleGVjdXRpb246IFtcIiArIHN0ZXAubmFtZSArIFwiXVwiKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkV4ZWN1dGluZyBzdGVwOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXAuZXhlY3V0ZShjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwiZXhlY3V0ZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSkuY2F0Y2ggKGUgPT4ge1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57dGhyb3cgZX0pXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKChjdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgIGlmIChjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUElOR1xuICAgICAgICAgICAgICAgIHx8IGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQRUQpIHtcbiAgICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgam9iIGdldHMgdGhlIG1lc3NhZ2UgdGhhdCBpdCBpcyBzdG9wcGluZ1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgICAgICAgICAgICAgIC8vIHRocm93IG5ldyBFcnJvcihcIkpvYiBpbnRlcnJ1cHRlZCBieSBzdGVwIGV4ZWN1dGlvblwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZVByb2dyZXNzKGpvYkV4ZWN1dGlvbikudGhlbigoKT0+Y3VycmVudFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkID09IGpvYkV4ZWN1dGlvbi5pZFxuICAgIH1cblxuICAgIHNob3VsZFN0YXJ0KGxhc3RTdGVwRXhlY3V0aW9uLCBleGVjdXRpb24sIHN0ZXApIHtcbiAgICAgICAgdmFyIHN0ZXBTdGF0dXM7XG4gICAgICAgIGlmIChsYXN0U3RlcEV4ZWN1dGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHN0ZXBTdGF0dXMgPSBsYXN0U3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc3RlcFN0YXR1cyA9PSBKT0JfU1RBVFVTLlVOS05PV04pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiQ2Fubm90IHJlc3RhcnQgc3RlcCBmcm9tIFVOS05PV04gc3RhdHVzXCIpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc3RlcFN0YXR1cyAhPSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBzdGVwLmlzUmVzdGFydGFibGU7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGNvbXBsZXRlZFN0ZXBzID0gZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aDtcbiAgICAgICAgbGV0IHByb2dyZXNzID0ge1xuICAgICAgICAgICAgdG90YWw6IHRoaXMuc3RlcHMubGVuZ3RoLFxuICAgICAgICAgICAgY3VycmVudDogY29tcGxldGVkU3RlcHNcbiAgICAgICAgfTtcbiAgICAgICAgaWYoIWNvbXBsZXRlZFN0ZXBzKXtcbiAgICAgICAgICAgIHJldHVybiBwcm9ncmVzc1xuICAgICAgICB9XG4gICAgICAgIGlmKEpPQl9TVEFUVVMuQ09NUExFVEVEICE9PSBleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aC0xXS5zdGF0dXMpe1xuICAgICAgICAgICAgcHJvZ3Jlc3MuY3VycmVudC0tO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHByb2dyZXNzO1xuICAgIH1cblxuICAgIGFkZFN0ZXAoKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aD09PTEpe1xuICAgICAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoYXJndW1lbnRzWzBdKVxuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gbmV3IFN0ZXAoYXJndW1lbnRzWzBdLCB0aGlzLmpvYlJlcG9zaXRvcnkpO1xuICAgICAgICBzdGVwLmRvRXhlY3V0ZSA9IGFyZ3VtZW50c1sxXTtcbiAgICAgICAgcmV0dXJuIHN1cGVyLmFkZFN0ZXAoc3RlcCk7XG4gICAgfVxuXG59XG4iLCJleHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBzdGVwIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVTdGVwKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxuXG4gICAgLypDYWxsZWQgYWZ0ZXIgY29tcGxldGlvbiBvZiBhIHN0ZXAuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlclN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuL2pvYi1leGVjdXRpb25cIjtcblxuLypcbiByZXByZXNlbnRhdGlvbiBvZiB0aGUgZXhlY3V0aW9uIG9mIGEgc3RlcFxuICovXG5leHBvcnQgY2xhc3MgU3RlcEV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgc3RlcE5hbWU7XG4gICAgam9iRXhlY3V0aW9uO1xuXG4gICAgc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7IC8vZXhlY3V0aW9uIGNvbnRleHQgZm9yIHNpbmdsZSBzdGVwIGxldmVsLFxuXG4gICAgc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICBlbmRUaW1lID0gbnVsbDtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICB0ZXJtaW5hdGVPbmx5ID0gZmFsc2U7IC8vZmxhZyB0byBpbmRpY2F0ZSB0aGF0IGFuIGV4ZWN1dGlvbiBzaG91bGQgaGFsdFxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihzdGVwTmFtZSwgam9iRXhlY3V0aW9uLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc3RlcE5hbWUgPSBzdGVwTmFtZTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uSWQgPSBqb2JFeGVjdXRpb24uaWQ7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVycygpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Db250ZXh0KCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0O1xuICAgIH1cblxuICAgIGdldERhdGEoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzPVtdLCBkZWVwQ2xvbmUgPSB0cnVlKXtcblxuICAgICAgICB2YXIgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZURlZXBXaXRoO1xuICAgICAgICBpZighZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoW1wiZXhlY3V0aW9uQ29udGV4dFwiXS5pbmRleE9mKGtleSk+LTEpe1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYodmFsdWUgaW5zdGFuY2VvZiBFcnJvcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTyhbXCJzdGVwRXhlY3V0aW9uc1wiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcblxuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iIHN0ZXAqL1xuZXhwb3J0IGNsYXNzIFN0ZXAge1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBpc1Jlc3RhcnRhYmxlID0gdHJ1ZTtcbiAgICBza2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ9dHJ1ZTtcbiAgICBzdGVwcyA9IFtdO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICAvKlByb2Nlc3MgdGhlIHN0ZXAgYW5kIGFzc2lnbiBwcm9ncmVzcyBhbmQgc3RhdHVzIG1ldGEgaW5mb3JtYXRpb24gdG8gdGhlIFN0ZXBFeGVjdXRpb24gcHJvdmlkZWQqL1xuICAgIGV4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcIkV4ZWN1dGluZyBzdGVwOiBuYW1lPVwiICsgdGhpcy5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRFRDtcbiAgICAgICAgdmFyIGV4aXRTdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRVhFQ1VUSU5HO1xuXG4gICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5iZWZvcmVTdGVwKHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIHRoaXMub3BlbihzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICB9KS50aGVuKF9zdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uID0gX3N0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBzb21lb25lIGlzIHRyeWluZyB0byBzdG9wIHVzXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi50ZXJtaW5hdGVPbmx5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIE5lZWQgdG8gdXBncmFkZSBoZXJlIG5vdCBzZXQsIGluIGNhc2UgdGhlIGV4ZWN1dGlvbiB3YXMgc3RvcHBlZFxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlN0ZXAgZXhlY3V0aW9uIHN1Y2Nlc3M6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSB0aGlzLmRldGVybWluZUpvYlN0YXR1cyhlKTtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcblxuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBFRCkge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGFuIGVycm9yIGV4ZWN1dGluZyBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gZXhpdFN0YXR1cztcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyPT5saXN0ZW5lci5hZnRlclN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gaW4gYWZ0ZXJTdGVwIGNhbGxiYWNrIGluIHN0ZXAgXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKHN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbG9zZShzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gd2hpbGUgY2xvc2luZyBzdGVwIGV4ZWN1dGlvbiByZXNvdXJjZXMgaW4gc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBkb0V4ZWN1dGlvblJlbGVhc2UoKTtcblxuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gY29tcGxldGU6IFwiICsgc3RlcEV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG5cbiAgICB9XG5cbiAgICBkZXRlcm1pbmVKb2JTdGF0dXMoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIGV4ZWN1dGUgYnVzaW5lc3MgbG9naWMuIFN1YmNsYXNzZXMgc2hvdWxkIHNldCB0aGUgZXhpdFN0YXR1cyBvbiB0aGVcbiAgICAgKiBTdGVwRXhlY3V0aW9uIGJlZm9yZSByZXR1cm5pbmcuIE11c3QgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgKi9cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGJlZ2lubmluZyBvZiBhIHN0ZXAsIHRvIG9wZW4gb3JcbiAgICAgKiBhY3F1aXJlIHJlc291cmNlcy4gRG9lcyBub3RoaW5nIGJ5IGRlZmF1bHQuXG4gICAgICovXG4gICAgb3BlbihleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb3ZpZGUgY2FsbGJhY2tzIHRvIHRoZWlyIGNvbGxhYm9yYXRvcnMgYXQgdGhlIGVuZCBvZiBhIHN0ZXAgKHJpZ2h0IGF0IHRoZSBlbmRcbiAgICAgKiBvZiB0aGUgZmluYWxseSBibG9jayksIHRvIGNsb3NlIG9yIHJlbGVhc2UgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBjbG9zZShleGVjdXRpb25Db250ZXh0KSB7XG4gICAgfVxuXG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQgPyAxIDogMFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0ICogYXMgZW5naW5lIGZyb20gJy4vZW5naW5lL2luZGV4J1xuXG5leHBvcnQge2VuZ2luZX1cbmV4cG9ydCAqIGZyb20gJy4vam9icy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itd29ya2VyJ1xuXG5cblxuIiwiaW1wb3J0IHtKb2JFeGVjdXRpb25MaXN0ZW5lcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXJcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuL2VuZ2luZS9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyB7XG4gICAgb25Kb2JTdGFydGVkID0gKCkgPT4ge307XG4gICAgb25Kb2JDb21wbGV0ZWQgPSByZXN1bHQgPT4ge307XG4gICAgb25Kb2JGYWlsZWQgPSBlcnJvcnMgPT4ge307XG4gICAgb25Kb2JTdG9wcGVkID0gKCkgPT4ge307XG4gICAgb25Kb2JUZXJtaW5hdGVkID0gKCkgPT4ge307XG4gICAgb25Qcm9ncmVzcyA9IChwcm9ncmVzcykgPT4ge307XG4gICAgY2FsbGJhY2tzVGhpc0FyZztcbiAgICB1cGRhdGVJbnRlcnZhbCA9IDEwMDtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qY29udmVuaWVuY2UgY2xhc3MgZm9yIG1hbmFnaW5nIGFuZCB0cmFja2luZyBqb2IgaW5zdGFuY2UgcHJvZ3Jlc3MqL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNlTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuICAgIGpvYnNNYW5nZXI7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgY29uZmlnO1xuXG4gICAgbGFzdEpvYkV4ZWN1dGlvbjtcbiAgICBsYXN0VXBkYXRlVGltZTtcbiAgICBwcm9ncmVzcyA9IG51bGw7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JzTWFuZ2VyLCBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IGpvYnNNYW5nZXI7XG4gICAgICAgIGlmIChqb2JJbnN0YW5jZU9yRXhlY3V0aW9uIGluc3RhbmNlb2YgSm9iSW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JJbnN0YW5jZU9yRXhlY3V0aW9uO1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxhc3RKb2JFeGVjdXRpb24gJiYgIXRoaXMubGFzdEpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgdGhpcy5hZnRlckpvYih0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcbiAgICB9XG5cbiAgICBjaGVja1Byb2dyZXNzKCkge1xuXG4gICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgaWYgKHRoaXMudGVybWluYXRlZCB8fCAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpIHx8IHRoaXMuZ2V0UHJvZ3Jlc3NQZXJjZW50cyh0aGlzLnByb2dyZXNzKSA9PT0gMTAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFByb2dyZXNzKHRoaXMubGFzdEpvYkV4ZWN1dGlvbikudGhlbihwcm9ncmVzcz0+IHtcbiAgICAgICAgICAgIHRoaXMubGFzdFVwZGF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgaWYgKHByb2dyZXNzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHByb2dyZXNzO1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHByb2dyZXNzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9LCB0aGlzLmNvbmZpZy51cGRhdGVJbnRlcnZhbClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgIT09IHRoaXMuam9iSW5zdGFuY2UuaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdGFydGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc1BlcmNlbnRzKHByb2dyZXNzKSB7XG4gICAgICAgIGlmICghcHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9ncmVzcy5jdXJyZW50ICogMTAwIC8gcHJvZ3Jlc3MudG90YWw7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgaWYgKEpPQl9TVEFUVVMuQ09NUExFVEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgICAgICAgICAgdGhpcy5wcm9ncmVzcyA9IHRoaXMuZ2V0UHJvZ3Jlc3NGcm9tRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vblByb2dyZXNzLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLnByb2dyZXNzKTtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5nZXRSZXN1bHQoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlKS50aGVuKHJlc3VsdD0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkNvbXBsZXRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcmVzdWx0LmRhdGEpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLkZBSUxFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JGYWlsZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucyk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChKT0JfU1RBVFVTLlNUT1BQRUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iU3RvcHBlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGZvcmNlVXBkYXRlID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxhc3RKb2JFeGVjdXRpb24gfHwgZm9yY2VVcGRhdGUpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHJldHVybiBqZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzdG9wKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuc3RvcCh0aGlzLmxhc3RKb2JFeGVjdXRpb24pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIucnVuKHRoaXMuam9iSW5zdGFuY2Uuam9iTmFtZSwgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMudmFsdWVzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uZ2V0RGF0YSgpKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGplO1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHRlcm1pbmF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnRlcm1pbmF0ZSh0aGlzLmpvYkluc3RhbmNlKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMudGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JUZXJtaW5hdGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBKb2JXb3JrZXJ7XG5cbiAgICB3b3JrZXI7XG4gICAgbGlzdGVuZXJzID0ge307XG4gICAgZGVmYXVsdExpc3RlbmVyO1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBkZWZhdWx0TGlzdGVuZXIsIG9uRXJyb3Ipe1xuICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICB0aGlzLndvcmtlciA9IG5ldyBXb3JrZXIodXJsKTtcbiAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIgPSBkZWZhdWx0TGlzdGVuZXIgfHwgZnVuY3Rpb24oKSB7fTtcbiAgICAgICAgaWYgKG9uRXJyb3IpIHt0aGlzLndvcmtlci5vbmVycm9yID0gb25FcnJvcjt9XG5cbiAgICAgICAgdGhpcy53b3JrZXIub25tZXNzYWdlID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5kYXRhIGluc3RhbmNlb2YgT2JqZWN0ICYmXG4gICAgICAgICAgICAgICAgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RMaXN0ZW5lcicpICYmIGV2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kQXJndW1lbnRzJykpIHtcbiAgICAgICAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBpbnN0YW5jZS5saXN0ZW5lcnNbZXZlbnQuZGF0YS5xdWVyeU1ldGhvZExpc3RlbmVyXTtcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IGV2ZW50LmRhdGEucXVlcnlNZXRob2RBcmd1bWVudHM7XG4gICAgICAgICAgICAgICAgaWYobGlzdGVuZXIuZGVzZXJpYWxpemVyKXtcbiAgICAgICAgICAgICAgICAgICAgYXJncyA9IGxpc3RlbmVyLmRlc2VyaWFsaXplcihhcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGlzdGVuZXIuZm4uYXBwbHkobGlzdGVuZXIudGhpc0FyZywgYXJncyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuZGVmYXVsdExpc3RlbmVyLmNhbGwoaW5zdGFuY2UsIGV2ZW50LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBzZW5kUXVlcnkoKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSm9iV29ya2VyLnNlbmRRdWVyeSB0YWtlcyBhdCBsZWFzdCBvbmUgYXJndW1lbnQnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAncXVlcnlNZXRob2QnOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3J1bkpvYicsIGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pXG4gICAgfVxuXG4gICAgZXhlY3V0ZUpvYihqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdleGVjdXRlSm9iJywgam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgcmVjb21wdXRlKGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ3JlY29tcHV0ZScsIGRhdGFEVE8sIHJ1bGVOYW1lcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgIH1cblxuICAgIHBvc3RNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICAgICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLndvcmtlci50ZXJtaW5hdGUoKTtcbiAgICB9XG5cbiAgICBhZGRMaXN0ZW5lcihuYW1lLCBsaXN0ZW5lciwgdGhpc0FyZywgZGVzZXJpYWxpemVyKSB7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzW25hbWVdID0ge1xuICAgICAgICAgICAgZm46IGxpc3RlbmVyLFxuICAgICAgICAgICAgdGhpc0FyZzogdGhpc0FyZyB8fCB0aGlzLFxuICAgICAgICAgICAgZGVzZXJpYWxpemVyOiBkZXNlcmlhbGl6ZXJcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZW1vdmVMaXN0ZW5lcihuYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmxpc3RlbmVyc1tuYW1lXTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7Sm9iTGF1bmNoZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItbGF1bmNoZXJcIjtcbmltcG9ydCB7Sm9iV29ya2VyfSBmcm9tIFwiLi9qb2Itd29ya2VyXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7SWRiSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L2lkYi1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7UmVjb21wdXRlSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9yZWNvbXB1dGUvcmVjb21wdXRlLWpvYlwiO1xuaW1wb3J0IHtQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtUaW1lb3V0Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1NpbXBsZUpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9zaW1wbGUtam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7TGVhZ3VlVGFibGVKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyQ29uZmlnIHtcblxuICAgIHdvcmtlclVybCA9IG51bGw7XG4gICAgcmVwb3NpdG9yeVR5cGUgPSAnaWRiJztcbiAgICBjbGVhclJlcG9zaXRvcnkgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBKb2JzTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuXG4gICAgdXNlV29ya2VyO1xuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYkxhdW5jaGVyO1xuXG4gICAgam9iRXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBhZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlcyA9IHt9O1xuICAgIGpvYkluc3RhbmNlc1RvVGVybWluYXRlID0ge307XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcblxuXG4gICAgICAgIHRoaXMudXNlV29ya2VyID0gISF0aGlzLmNvbmZpZy53b3JrZXJVcmw7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5pbml0V29ya2VyKHRoaXMuY29uZmlnLndvcmtlclVybCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmluaXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYnMoKTtcblxuXG5cbiAgICAgICAgdGhpcy5qb2JMYXVuY2hlciA9IG5ldyBKb2JMYXVuY2hlcih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuam9iV29ya2VyLCAoZGF0YSk9PnRoaXMuc2VyaWFsaXplRGF0YShkYXRhKSk7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JzTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBpbml0UmVwb3NpdG9yeSgpIHtcbiAgICAgICAgaWYodGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUgPT09ICdpZGInKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBJZGJKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpLCAnc2Qtam9iLXJlcG9zaXRvcnknLCB0aGlzLmNvbmZpZy5jbGVhclJlcG9zaXRvcnkpO1xuICAgICAgICB9ZWxzZSBpZigndGltZW91dCcpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFRpbWVvdXRKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgfWVsc2UgaWYoJ3NpbXBsZScpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFNpbXBsZUpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxvZy5lcnJvcignSm9ic01hbmFnZXIgY29uZmlndXJhdGlvbiBlcnJvciEgVW5rbm93biByZXBvc2l0b3J5IHR5cGU6ICcrdGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUrJy4gVXNpbmcgZGVmYXVsdDogaWRiJyk7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgICAgICAgICAgdGhpcy5pbml0UmVwb3NpdG9yeSgpXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlcmlhbGl6ZURhdGEoZGF0YSkge1xuICAgICAgICByZXR1cm4gZGF0YS5zZXJpYWxpemUodHJ1ZSwgZmFsc2UsIGZhbHNlLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJlcGxhY2VyKCkpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhpZCk7XG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgcnVuKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JMYXVuY2hlci5ydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkIHx8ICFqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy9qb2Igd2FzIGRlbGVnYXRlZCB0byB3b3JrZXIgYW5kIGlzIHN0aWxsIHJ1bm5pbmdcblxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXSA9IHJlc29sdmU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLmV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgfVxuXG4gICAgc3RvcChqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHZhciBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIGlmICghVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpIHtcbiAgICAgICAgICAgIGlkID0gam9iRXhlY3V0aW9uT3JJZC5pZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGlkKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iIEV4ZWN1dGlvbiBub3QgZm91bmQ6IFwiICsgam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiSm9iIEV4ZWN1dGlvbiBub3QgcnVubmluZywgc3RhdHVzOiBcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIiwgZW5kVGltZTogXCIgKyBqb2JFeGVjdXRpb24uZW5kVGltZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnN0b3Agam9iIGV4ZWN1dGlvbiBpZiBydW5uaW5nIGFuZCBkZWxldGUgam9iIGluc3RhbmNlIGZyb20gcmVwb3NpdG9yeSovXG4gICAgdGVybWluYXRlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIGlmKGpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uLmlkLCBKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCkudGhlbigoKT0+am9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZVtqb2JJbnN0YW5jZS5pZF09am9iSW5zdGFuY2U7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgfVxuXG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzVmFsdWVzKTtcbiAgICB9XG5cblxuICAgIC8qUmV0dXJucyBhIHByb21pc2UqL1xuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICBpZiAodGhpcy51c2VXb3JrZXIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYldvcmtlcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIShqb2JQYXJhbWV0ZXJzIGluc3RhbmNlb2YgSm9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgIGpvYlBhcmFtZXRlcnMgPSB0aGlzLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVycylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgaW5pdFdvcmtlcih3b3JrZXJVcmwpIHtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBuZXcgSm9iV29ya2VyKHdvcmtlclVybCwgKCk9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcignZXJyb3IgaW4gd29ya2VyJywgYXJndW1lbnRzKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBhcmdzRGVzZXJpYWxpemVyID0gKGFyZ3MpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFt0aGlzLmpvYlJlcG9zaXRvcnkucmV2aXZlSm9iRXhlY3V0aW9uKGFyZ3NbMF0pXVxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiYmVmb3JlSm9iXCIsIHRoaXMuYmVmb3JlSm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJhZnRlckpvYlwiLCB0aGlzLmFmdGVySm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJqb2JGYXRhbEVycm9yXCIsIHRoaXMub25Kb2JGYXRhbEVycm9yLCB0aGlzKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYnMoKSB7XG5cbiAgICAgICAgbGV0IHNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgPSBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgbGV0IHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iID0gbmV3IFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICBpZighVXRpbHMuaXNXb3JrZXIoKSl7XG4gICAgICAgICAgICBzZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgICAgIHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2Ioc2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFRvcm5hZG9EaWFncmFtSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihwcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFJlY29tcHV0ZUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IExlYWd1ZVRhYmxlSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYihqb2IpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlZ2lzdGVySm9iKGpvYik7XG4gICAgICAgIGpvYi5yZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpXG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBkZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdmFyIGluZGV4ID0gdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImJlZm9yZUpvYlwiLCB0aGlzLnVzZVdvcmtlciwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsPT5sLmJlZm9yZUpvYihqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiYWZ0ZXJKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5hZnRlckpvYihqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbilcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHRoaXMuam9iSW5zdGFuY2VzVG9UZXJtaW5hdGVbam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkXSl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2Uoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLCBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBvbkpvYkZhdGFsRXJyb3Ioam9iRXhlY3V0aW9uSWQsIGVycm9yKXtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb25JZF07XG4gICAgICAgIGlmIChwcm9taXNlUmVzb2x2ZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uSWQpLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIGlmKGVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICAgICAgcHJvbWlzZVJlc29sdmUoam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgfVxuICAgICAgICBsb2cuZGVidWcoJ29uSm9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBlcnJvcik7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7XG4gICAgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUsXG4gICAgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUsXG4gICAgTWF4aU1pblJ1bGUsXG4gICAgTWF4aU1heFJ1bGUsXG4gICAgTWluaU1pblJ1bGUsXG4gICAgTWluaU1heFJ1bGVcbn0gZnJvbSBcIi4vcnVsZXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCAqIGFzIG1vZGVsIGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtNaW5NYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9taW4tbWF4LXJ1bGVcIjtcbmltcG9ydCB7TWF4TWluUnVsZX0gZnJvbSBcIi4vcnVsZXMvbWF4LW1pbi1ydWxlXCI7XG5pbXBvcnQge01pbk1pblJ1bGV9IGZyb20gXCIuL3J1bGVzL21pbi1taW4tcnVsZVwiO1xuaW1wb3J0IHtNYXhNYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9tYXgtbWF4LXJ1bGVcIjtcblxuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGVzTWFuYWdlcntcblxuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY3VycmVudFJ1bGU7XG4gICAgcnVsZUJ5TmFtZSA9IHt9O1xuICAgIHJ1bGVzID0gW107XG5cblxuICAgIGZsaXBQYWlyID0ge307XG4gICAgcGF5b2ZmSW5kZXggPSAwO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgY3VycmVudFJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNYXhpTWluUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWF4aU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1pbmlNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNaW5pTWF4UnVsZShleHByZXNzaW9uRW5naW5lKSk7XG5cbiAgICAgICAgbGV0IG1pbk1heCA9IG5ldyBNaW5NYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWF4KTtcbiAgICAgICAgbGV0IG1heE1pbiA9IG5ldyBNYXhNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWluKTtcbiAgICAgICAgdGhpcy5hZGRGbGlwUGFpcihtaW5NYXgsIG1heE1pbik7XG5cbiAgICAgICAgbGV0IG1pbk1pbiA9IG5ldyBNaW5NaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWluKTtcbiAgICAgICAgbGV0IG1heE1heCA9IG5ldyBNYXhNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWF4KTtcblxuXG4gICAgICAgIGlmIChjdXJyZW50UnVsZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbY3VycmVudFJ1bGVOYW1lXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVzWzBdO1xuICAgICAgICB9XG5cbiAgICB9XG5cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KXtcbiAgICAgICAgdGhpcy5wYXlvZmZJbmRleCA9IHBheW9mZkluZGV4IHx8IDA7XG4gICAgfVxuXG4gICAgYWRkUnVsZShydWxlKXtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW3J1bGUubmFtZV09cnVsZTtcbiAgICAgICAgdGhpcy5ydWxlcy5wdXNoKHJ1bGUpO1xuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpe1xuICAgICAgICAgcmV0dXJuICEhdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV07XG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIGZsaXBSdWxlKCl7XG4gICAgICAgIHZhciBmbGlwcGVkID0gdGhpcy5mbGlwUGFpclt0aGlzLmN1cnJlbnRSdWxlLm5hbWVdO1xuICAgICAgICBpZihmbGlwcGVkKXtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSBmbGlwcGVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpe1xuICAgICAgICB0aGlzLnJ1bGVzLmZpbHRlcihyPT5yLm11bHRpQ3JpdGVyaWEpLmZvckVhY2gocj0+ci5zZXREZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChkZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCkpO1xuICAgIH1cblxuICAgIHJlY29tcHV0ZShkYXRhTW9kZWwsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMsIGFsbDogJythbGxSdWxlcyk7XG5cbiAgICAgICAgZGF0YU1vZGVsLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLnJlY29tcHV0ZVRyZWUobiwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lLzEwMDApO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGluZyBydWxlcyBmb3IgdHJlZSAuLi4nLCByb290KTtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAgICAgdmFyIHJ1bGVzICA9IFt0aGlzLmN1cnJlbnRSdWxlXTtcbiAgICAgICAgaWYoYWxsUnVsZXMpe1xuICAgICAgICAgICAgcnVsZXMgPSB0aGlzLnJ1bGVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcnVsZXMuZm9yRWFjaChydWxlPT4ge1xuICAgICAgICAgICAgcnVsZS5zZXRQYXlvZmZJbmRleCh0aGlzLnBheW9mZkluZGV4KTtcbiAgICAgICAgICAgIHJ1bGUuc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlUGF5b2ZmKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlT3B0aW1hbChyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY2xlYXJEZWNpc2lvblBvbGljeSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdGltZSAgPSAobmV3IERhdGUoKS5nZXRUaW1lKCkgLSBzdGFydFRpbWUpLzEwMDA7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRhdGlvbiB0b29rICcrdGltZSsncycpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuYW1lKSB7XG4gICAgICAgIHJldHVybiBub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCBuYW1lKVxuXG4gICAgfVxuXG4gICAgZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuYW1lKXtcbiAgICAgICAgaWYobmFtZT09PSdwcm9iYWJpbGl0eScpe1xuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdwcm9iYWJpbGl0eScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J3BheW9mZicpe1xuICAgICAgICAgICAgaWYodGhpcy5jdXJyZW50UnVsZS5tdWx0aUNyaXRlcmlhKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmYnKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3BheW9mZlsnICt0aGlzLnBheW9mZkluZGV4ICsgJ10nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9XG4gICAgICAgIGlmKG5hbWU9PT0nb3B0aW1hbCcpe1xuICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdvcHRpbWFsJylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEZsaXBQYWlyKHJ1bGUxLCBydWxlMikge1xuICAgICAgICB0aGlzLmZsaXBQYWlyW3J1bGUxLm5hbWVdID0gcnVsZTI7XG4gICAgICAgIHRoaXMuZmxpcFBhaXJbcnVsZTIubmFtZV0gPSBydWxlMTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWF4aW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUuTkFNRSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZj0wLCBwcm9iYWJpbGl0eVRvRW50ZXI9MSl7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBpZiAoIHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWluaW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUuTkFNRSwgZmFsc2UsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSkscGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1taW4tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1taW4tcnVsZSdcblxuXG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1heFJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1heFJ1bGUuTkFNRSwgWzEsIDFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1pblJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1pblJ1bGUuTkFNRSwgWzEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNYXhSdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNaW5SdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNaW5NYXhSdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW4tbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5NYXhSdWxlLk5BTUUsIFstMSwgMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWluTWluUnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluTWluUnVsZS5OQU1FLCBbLTEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNYXhSdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPGJlc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvYmVzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5tYXhCeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNaW5SdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSBcIi4vb2JqZWN0aXZlLXJ1bGVcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cblxuZXhwb3J0IGNsYXNzIE11bHRpQ3JpdGVyaWFSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZSB7XG5cbiAgICBjcml0ZXJpb24xV2VpZ2h0ID0gMTtcbiAgICBwYXlvZmZDb2VmZnMgPSBbMSwgLTFdO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgcGF5b2ZmQ29lZmZzLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUsIHRydWUpO1xuICAgICAgICB0aGlzLnBheW9mZkNvZWZmcyA9IHBheW9mZkNvZWZmcztcblxuICAgIH1cblxuICAgIHNldERlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGNyaXRlcmlvbjFXZWlnaHQpIHtcbiAgICAgICAgdGhpcy5jcml0ZXJpb24xV2VpZ2h0ID0gY3JpdGVyaW9uMVdlaWdodDtcbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmYgPSBbMCwgMF0sIGFnZ3JlZ2F0ZWRQYXlvZmYgPSBbMCwgMF0pIHtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gWzAsIDBdO1xuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgYmFzZVBheW9mZnMgPSBbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldO1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIGJhc2VQYXlvZmZzLCBbdGhpcy5hZGQoYmFzZVBheW9mZnNbMF0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMF0pLCB0aGlzLmFkZChiYXNlUGF5b2Zmc1sxXSwgYWdncmVnYXRlZFBheW9mZlsxXSldKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkQ29tYmluZWRQYXlvZmYgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZENvbWJpbmVkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZENvbWJpbmVkUGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJlc3RDaGlsZC5lcXVhbHMoY2hpbGRDb21iaW5lZFBheW9mZikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5kZWNpc2lvblBvbGljeSkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHNlbGVjdGVkSW5kZXhlcy5pbmRleE9mKGkpIDwgMCA/IDAuMCA6IDEuMCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBiYXNlUGF5b2ZmcyA9IFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV07XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgYmFzZVBheW9mZnMsIFt0aGlzLmFkZChiYXNlUGF5b2Zmc1swXSwgYWdncmVnYXRlZFBheW9mZlswXSksIHRoaXMuYWRkKGJhc2VQYXlvZmZzWzFdLCBhZ2dyZWdhdGVkUGF5b2ZmWzFdKV0pO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDA7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodCA9IHRoaXMuYWRkKHN1bXdlaWdodCwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChzdW13ZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmYuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgZXAgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZlsnICsgaSArICddJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZltpXSA9IHRoaXMuYWRkKHAsIHRoaXMubXVsdGlwbHkodGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JyksIGVwKS5kaXYoc3Vtd2VpZ2h0KSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9XG4gICAgICAgIHBheW9mZi5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIHBheW9mZltpXSA9IHRoaXMuYWRkKHAsIGNoaWxkcmVuUGF5b2ZmW2ldKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKG5vZGUpO1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnYWdncmVnYXRlZFBheW9mZicsIGFnZ3JlZ2F0ZWRQYXlvZmYpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIDApOyAvL2luaXRpYWwgdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicsIHRoaXMuY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKHBheW9mZikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJywgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICBjb21wdXRlQ29tYmluZWRQYXlvZmYocGF5b2ZmKXtcbiAgICAgICAgLy8gW2NyaXRlcmlvbiAxIGNvZWZmXSpbY3JpdGVyaW9uIDFdKlt3ZWlnaHRdK1tjcml0ZXJpb24gMiBjb2VmZl0qW2NyaXRlcmlvbiAyXVxuICAgICAgICBpZiAodGhpcy5jcml0ZXJpb24xV2VpZ2h0ID09PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHBheW9mZlswXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuYWRkKHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHRoaXMubXVsdGlwbHkodGhpcy5jcml0ZXJpb24xV2VpZ2h0LCBwYXlvZmZbMF0pKSwgdGhpcy5tdWx0aXBseSh0aGlzLnBheW9mZkNvZWZmc1sxXSwgcGF5b2ZmWzFdKSk7XG4gICAgfVxuXG4gICAgLy8gIGNvbWJpbmVkUGF5b2ZmIC0gcGFyZW50IGVkZ2UgY29tYmluZWRQYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBjb21iaW5lZFBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicpLCBjb21iaW5lZFBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAnY29tYmluZWRQYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5jb21wdXRlQ29tYmluZWRQYXlvZmYoW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuLypCYXNlIGNsYXNzIGZvciBvYmplY3RpdmUgcnVsZXMqL1xuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGUge1xuICAgIG5hbWU7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGRlY2lzaW9uUG9saWN5O1xuICAgIG1heGltaXphdGlvbjtcblxuICAgIHBheW9mZkluZGV4ID0gMDtcbiAgICBtdWx0aUNyaXRlcmlhID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBtYXhpbWl6YXRpb24sIGV4cHJlc3Npb25FbmdpbmUsIG11bHRpQ3JpdGVyaWE9ZmFsc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5tYXhpbWl6YXRpb24gPSBtYXhpbWl6YXRpb247XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMubXVsdGlDcml0ZXJpYSA9IG11bHRpQ3JpdGVyaWE7XG4gICAgfVxuXG4gICAgc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IGRlY2lzaW9uUG9saWN5O1xuICAgIH1cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KSB7XG4gICAgICAgIHRoaXMucGF5b2ZmSW5kZXggPSBwYXlvZmZJbmRleDtcbiAgICB9XG5cbiAgICBjbGVhckRlY2lzaW9uUG9saWN5KCkge1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBzaG91bGQgcmV0dXJuIGFycmF5IG9mIHNlbGVjdGVkIGNoaWxkcmVuIGluZGV4ZXNcbiAgICBtYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpIHtcbiAgICAgICAgdmFyIGJlc3Q7XG4gICAgICAgIGlmICh0aGlzLm1heGltaXphdGlvbikge1xuICAgICAgICAgICAgYmVzdCA9IHRoaXMubWF4KC4uLmNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBiZXN0ID0gdGhpcy5taW4oLi4uY2hpbGRyZW5QYXlvZmZzKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgIGNoaWxkcmVuUGF5b2Zmcy5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIGlmIChFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUoYmVzdCwgcCkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHNlbGVjdGVkSW5kZXhlcztcbiAgICB9XG5cbiAgICBfbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLmRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcy5kZWNpc2lvblBvbGljeSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiBbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMubWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKTtcbiAgICB9XG5cbiAgICAvLyBleHRlbnNpb24gcG9pbnQgZm9yIGNoYW5naW5nIGNvbXB1dGVkIHByb2JhYmlsaXR5IG9mIGVkZ2VzIGluIGEgY2hhbmNlIG5vZGVcbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpIHtcblxuICAgIH1cblxuICAgIC8vIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZiwgYWdncmVnYXRlZFBheW9mZiAtIGFnZ3JlZ2F0ZWQgcGF5b2ZmIGFsb25nIHBhdGhcbiAgICBjb21wdXRlUGF5b2ZmKG5vZGUsIHBheW9mZiA9IDAsIGFnZ3JlZ2F0ZWRQYXlvZmYgPSAwKSB7XG4gICAgICAgIHZhciBjaGlsZHJlblBheW9mZiA9IDA7XG4gICAgICAgIGlmIChub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IHRoaXMuX21ha2VEZWNpc2lvbihub2RlLCBub2RlLmNoaWxkRWRnZXMubWFwKGU9PnRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLmFkZCh0aGlzLmJhc2VQYXlvZmYoZSksIGFnZ3JlZ2F0ZWRQYXlvZmYpKSkpO1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q2hpbGQgPSAtSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q2hpbGQgPSBJbmZpbml0eTtcbiAgICAgICAgICAgICAgICB2YXIgd29yc3RDb3VudCA9IDE7XG5cbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZFBheW9mZiA8IHdvcnN0Q2hpbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNoaWxkUGF5b2ZmLmVxdWFscyh3b3JzdENoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd29yc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hpbGRQYXlvZmYuZXF1YWxzKGJlc3RDaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLm1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KG5vZGUuY2hpbGRFZGdlcywgYmVzdENoaWxkLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGQsIHdvcnN0Q291bnQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgc3Vtd2VpZ2h0ID0gMDtcbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgc3Vtd2VpZ2h0ID0gdGhpcy5hZGQoc3Vtd2VpZ2h0LCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gY29uc29sZS5sb2cocGF5b2ZmLG5vZGUuY2hpbGRFZGdlcywnc3Vtd2VpZ2h0JyxzdW13ZWlnaHQpO1xuICAgICAgICAgICAgaWYgKHN1bXdlaWdodCA+IDApIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZiA9IHRoaXMuYWRkKGNoaWxkcmVuUGF5b2ZmLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkuZGl2KHN1bXdlaWdodCkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHBheW9mZiA9IHRoaXMuYWRkKHBheW9mZiwgY2hpbGRyZW5QYXlvZmYpO1xuICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMobm9kZSk7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJysgJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2NoaWxkcmVuUGF5b2ZmJyArICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUsIHBheW9mZik7XG4gICAgfVxuXG4gICAgLy8ga29sb3J1amUgb3B0eW1hbG5lIMWbY2llxbxraVxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUpIHtcbiAgICAgICAgdGhyb3cgJ2NvbXB1dGVPcHRpbWFsIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3IgcnVsZTogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qIGdldCBvciBzZXQgY29tcHV0ZWQgcGF5b2ZmKi9cbiAgICBjb21wdXRlZFBheW9mZihub2RlLCB2YWx1ZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCB2YWx1ZSlcbiAgICB9XG5cbiAgICAvKkdldCBvciBzZXQgb2JqZWN0J3MgY29tcHV0ZWQgdmFsdWUgZm9yIGN1cnJlbnQgcnVsZSovXG4gICAgY1ZhbHVlKG9iamVjdCwgZmllbGRQYXRoLCB2YWx1ZSkge1xuICAgICAgICAvLyBpZihmaWVsZFBhdGgudHJpbSgpID09PSAncGF5b2ZmJyl7XG4gICAgICAgIC8vICAgICBmaWVsZFBhdGggKz0gJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJztcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIHJldHVybiBvYmplY3QuY29tcHV0ZWRWYWx1ZSh0aGlzLm5hbWUsIGZpZWxkUGF0aCwgdmFsdWUpO1xuICAgIH1cblxuICAgIGJhc2VQcm9iYWJpbGl0eShlZGdlKSB7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgfVxuXG4gICAgYmFzZVBheW9mZihlZGdlLCBwYXlvZmZJbmRleCkge1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCBwYXlvZmZJbmRleCB8fCB0aGlzLnBheW9mZkluZGV4KTtcbiAgICB9XG5cbiAgICBjbGVhckNvbXB1dGVkVmFsdWVzKG9iamVjdCkge1xuICAgICAgICBvYmplY3QuY2xlYXJDb21wdXRlZFZhbHVlcyh0aGlzLm5hbWUpO1xuICAgIH1cblxuICAgIGFkZChhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmFkZChhLCBiKVxuICAgIH1cblxuICAgIHN1YnRyYWN0KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoYSwgYilcbiAgICB9XG5cbiAgICBkaXZpZGUoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoYSwgYilcbiAgICB9XG5cbiAgICBtdWx0aXBseShhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm11bHRpcGx5KGEsIGIpXG4gICAgfVxuXG4gICAgbWF4KCkge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tYXgoLi4uYXJndW1lbnRzKVxuICAgIH1cblxuICAgIG1pbigpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubWluKC4uLmFyZ3VtZW50cylcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge09wZXJhdGlvbn0gZnJvbSBcIi4vb3BlcmF0aW9uXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5cbi8qU3VidHJlZSBmbGlwcGluZyBvcGVyYXRpb24qL1xuZXhwb3J0IGNsYXNzIEZsaXBTdWJ0cmVlIGV4dGVuZHMgT3BlcmF0aW9ue1xuXG4gICAgc3RhdGljICROQU1FID0gJ2ZsaXBTdWJ0cmVlJztcbiAgICBkYXRhO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKEZsaXBTdWJ0cmVlLiROQU1FKTtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgaXNBcHBsaWNhYmxlKG9iamVjdCl7XG4gICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlXG4gICAgfVxuXG4gICAgY2FuUGVyZm9ybShub2RlKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpY2FibGUobm9kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKHRoaXMuZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShub2RlKSkuaXNWYWxpZCgpKSB7IC8vY2hlY2sgaWYgdGhlIHdob2xlIHN1YnRyZWUgaXMgcHJvcGVyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5OdW1iZXIgPSBudWxsO1xuICAgICAgICB2YXIgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMgPSBbXTtcbiAgICAgICAgdmFyIGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoKTtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzU2V0O1xuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5ldmVyeShlPT4ge1xuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gZS5jaGlsZE5vZGU7XG4gICAgICAgICAgICAgICAgaWYgKCEoY2hpbGQgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkcmVuRWRnZUxhYmVsc1NldC5oYXMoZS5uYW1lLnRyaW0oKSkpIHsgLy8gZWRnZSBsYWJlbHMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNoaWxkcmVuRWRnZUxhYmVsc1NldC5hZGQoZS5uYW1lLnRyaW0oKSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuTnVtYmVyID0gY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuTnVtYmVyIDwgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChnZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzLnB1c2goZ2UubmFtZS50cmltKCkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldC5zaXplICE9PSBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5sZW5ndGgpIHsgLy9ncmFuZGNoaWxkcmVuIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZC5jaGlsZEVkZ2VzLmxlbmd0aCAhPSBncmFuZGNoaWxkcmVuTnVtYmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkLmNoaWxkRWRnZXMuZXZlcnkoKGdlLCBpKT0+Z3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNbaV0gPT09IGdlLm5hbWUudHJpbSgpKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG5cbiAgICAgICAgICAgIH0pKSB7XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHBlcmZvcm0ocm9vdCkge1xuXG4gICAgICAgIHZhciByb290Q2xvbmUgPSB0aGlzLmRhdGEuY2xvbmVTdWJ0cmVlKHJvb3QsIHRydWUpO1xuICAgICAgICB2YXIgb2xkQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICB2YXIgb2xkR3JhbmRDaGlsZHJlbk51bWJlciA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlcy5sZW5ndGg7XG5cbiAgICAgICAgdmFyIGNoaWxkcmVuTnVtYmVyID0gb2xkR3JhbmRDaGlsZHJlbk51bWJlcjtcbiAgICAgICAgdmFyIGdyYW5kQ2hpbGRyZW5OdW1iZXIgPSBvbGRDaGlsZHJlbk51bWJlcjtcblxuICAgICAgICB2YXIgY2FsbGJhY2tzRGlzYWJsZWQgPSB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQ7XG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IHRydWU7XG5cblxuICAgICAgICB2YXIgY2hpbGRYID0gcm9vdC5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5sb2NhdGlvbi54O1xuICAgICAgICB2YXIgdG9wWSA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueTtcbiAgICAgICAgdmFyIGJvdHRvbVkgPSByb290LmNoaWxkRWRnZXNbb2xkQ2hpbGRyZW5OdW1iZXIgLSAxXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tvbGRHcmFuZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG5cbiAgICAgICAgdmFyIGV4dGVudFkgPSBib3R0b21ZIC0gdG9wWTtcbiAgICAgICAgdmFyIHN0ZXBZID0gZXh0ZW50WSAvIChjaGlsZHJlbk51bWJlciArIDEpO1xuXG4gICAgICAgIHJvb3QuY2hpbGRFZGdlcy5zbGljZSgpLmZvckVhY2goZT0+IHRoaXMuZGF0YS5yZW1vdmVOb2RlKGUuY2hpbGROb2RlKSk7XG5cblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoaWxkcmVuTnVtYmVyOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IG5ldyBtb2RlbC5DaGFuY2VOb2RlKG5ldyBtb2RlbC5Qb2ludChjaGlsZFgsIHRvcFkgKyAoaSArIDEpICogc3RlcFkpKTtcbiAgICAgICAgICAgIHZhciBlZGdlID0gdGhpcy5kYXRhLmFkZE5vZGUoY2hpbGQsIHJvb3QpO1xuICAgICAgICAgICAgZWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0ubmFtZTtcblxuICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IDA7XG5cbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZ3JhbmRDaGlsZHJlbk51bWJlcjsgaisrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGdyYW5kQ2hpbGQgPSByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jaGlsZE5vZGU7XG5cblxuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkRWRnZSA9IHRoaXMuZGF0YS5hdHRhY2hTdWJ0cmVlKGdyYW5kQ2hpbGQsIGNoaWxkKTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0ubmFtZTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wYXlvZmYgPSBbXG4gICAgICAgICAgICAgICAgICAgIEV4cHJlc3Npb25FbmdpbmUuYWRkKHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDApLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAwKSksXG4gICAgICAgICAgICAgICAgICAgIEV4cHJlc3Npb25FbmdpbmUuYWRkKHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDEpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAxKSksXG4gICAgICAgICAgICAgICAgXTtcblxuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpKTtcbiAgICAgICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoZWRnZS5wcm9iYWJpbGl0eSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocCwgZWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBpZiAoZWRnZS5wcm9iYWJpbGl0eS5lcXVhbHMoMCkpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGdyYW5kQ2hpbGRyZW5OdW1iZXIpO1xuICAgICAgICAgICAgICAgIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IHByb2I7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChncmFuZENoaWxkRWRnZT0+IHtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZC5jaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShlZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAocm9vdC5jaGlsZEVkZ2VzKTtcblxuXG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IGNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuX2ZpcmVOb2RlQWRkZWRDYWxsYmFjaygpO1xuICAgIH1cblxuICAgIF9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgaWYoIXByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgbG9nLmluZm8oJ1N1bSBvZiB0aGUgcHJvYmFiaWxpdGllcyBpbiBjaGlsZCBub2RlcyBpcyBub3QgZXF1YWwgdG8gMSA6ICcsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIHZhciBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIHZhciBjZiA9IDEwMDAwMDAwMDAwMDA7IC8vMTBeMTJcbiAgICAgICAgICAgIHZhciBwcmVjID0gMTI7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gcGFyc2VJbnQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChlLnByb2JhYmlsaXR5LCBwcmVjKSAqIGNmKTtcbiAgICAgICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IG5ld1Byb2JhYmlsaXR5U3VtICsgZS5wcm9iYWJpbGl0eTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdmFyIHJlc3QgPSBjZiAtIG5ld1Byb2JhYmlsaXR5U3VtO1xuICAgICAgICAgICAgbG9nLmluZm8oJ05vcm1hbGl6aW5nIHdpdGggcm91bmRpbmcgdG8gcHJlY2lzaW9uOiAnICsgcHJlYywgcmVzdCk7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocmVzdCwgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHBhcnNlSW50KGUucHJvYmFiaWxpdHkpLCBjZikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiXG4vKkJhc2UgY2xhc3MgZm9yIGNvbXBsZXggb3BlcmF0aW9ucyBvbiB0cmVlIHN0cnVjdHVyZSovXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9ue1xuXG4gICAgbmFtZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUpe1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgb3BlcmF0aW9uIGlzIHBvdGVudGlhbGx5IGFwcGxpY2FibGUgZm9yIG9iamVjdFxuICAgIGlzQXBwbGljYWJsZSgpe1xuICAgICAgICB0aHJvdyAnaXNBcHBsaWNhYmxlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgY2FuIHBlcmZvcm0gb3BlcmF0aW9uIGZvciBhcHBsaWNhYmxlIG9iamVjdFxuICAgIGNhblBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ2NhblBlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgcGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAncGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtGbGlwU3VidHJlZX0gZnJvbSBcIi4vZmxpcC1zdWJ0cmVlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbnNNYW5hZ2VyIHtcblxuICAgIG9wZXJhdGlvbnMgPSBbXTtcbiAgICBvcGVyYXRpb25CeU5hbWUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnJlZ2lzdGVyT3BlcmF0aW9uKG5ldyBGbGlwU3VidHJlZShkYXRhLCBleHByZXNzaW9uRW5naW5lKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJPcGVyYXRpb24ob3BlcmF0aW9uKXtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zLnB1c2gob3BlcmF0aW9uKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25CeU5hbWVbb3BlcmF0aW9uLm5hbWVdID0gb3BlcmF0aW9uO1xuICAgIH1cblxuXG4gICAgZ2V0T3BlcmF0aW9uQnlOYW1lKG5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25CeU5hbWVbbmFtZV07XG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3Qpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zLmZpbHRlcihvcD0+b3AuaXNBcHBsaWNhYmxlKG9iamVjdCkpXG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBEZWNpc2lvbntcbiAgICBub2RlO1xuICAgIGRlY2lzaW9uVmFsdWU7IC8vaW5kZXggb2YgIHNlbGVjdGVkIGVkZ2VcbiAgICBjaGlsZHJlbiA9IFtdO1xuICAgIGtleTtcblxuICAgIGNvbnN0cnVjdG9yKG5vZGUsIGRlY2lzaW9uVmFsdWUpIHtcbiAgICAgICAgdGhpcy5ub2RlID0gbm9kZTtcbiAgICAgICAgdGhpcy5kZWNpc2lvblZhbHVlID0gZGVjaXNpb25WYWx1ZTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5PSckaWQnKXtcbiAgICAgICAgdmFyIGUgPSBkZWNpc2lvbi5ub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgIHZhciBrZXkgPSBkZWNpc2lvbi5ub2RlW2tleVByb3BlcnR5XStcIjpcIisoZVtrZXlQcm9wZXJ0eV0/IGVba2V5UHJvcGVydHldIDogZGVjaXNpb24uZGVjaXNpb25WYWx1ZSsxKTtcbiAgICAgICAgcmV0dXJuIGtleS5yZXBsYWNlKC9cXG4vZywgJyAnKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSlcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24oZGVjaXNpb24sIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGlmKGRlY2lzaW9uLm5vZGU9PT1kZWNpc2lvbk5vZGUgfHwgZGVjaXNpb24ubm9kZS4kaWQgPT09IGRlY2lzaW9uTm9kZS4kaWQpe1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICB9XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkID0gRGVjaXNpb24uZ2V0RGVjaXNpb24oZGVjaXNpb24uY2hpbGRyZW5baV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRpYyB0b0RlY2lzaW9uU3RyaW5nKGRlY2lzaW9uLCBleHRlbmRlZD1mYWxzZSwga2V5UHJvcGVydHk9J25hbWUnLCBpbmRlbnQgPSAnJyl7XG5cbiAgICAgICAgdmFyIHJlcyA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eSk7XG4gICAgICAgIHZhciBjaGlsZHJlblJlcyA9IFwiXCI7XG5cbiAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4uZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihjaGlsZHJlblJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSAnXFxuJytpbmRlbnQ7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLGV4dGVuZGVkLGtleVByb3BlcnR5LCBpbmRlbnQrJ1xcdCcpXG4gICAgICAgIH0pO1xuICAgICAgICBpZihkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGgpe1xuICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gICdcXG4nK2luZGVudCArY2hpbGRyZW5SZXM7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9IFwiIC0gKFwiICsgY2hpbGRyZW5SZXMgKyBcIilcIjtcbiAgICAgICAgICAgIH1cblxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXMrY2hpbGRyZW5SZXM7XG4gICAgfVxuXG4gICAgdG9EZWNpc2lvblN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljeVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWNpZXNDb2xsZWN0b3J7XG4gICAgcG9saWNpZXMgPSBbXTtcbiAgICBydWxlTmFtZT1mYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKHJvb3QsIG9wdGltYWxGb3JSdWxlTmFtZSl7XG4gICAgICAgIHRoaXMucnVsZU5hbWUgPSBvcHRpbWFsRm9yUnVsZU5hbWU7XG4gICAgICAgIHRoaXMuY29sbGVjdChyb290KS5mb3JFYWNoKChkZWNpc2lvbnMsaSk9PntcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXMucHVzaChuZXcgUG9saWN5KFwiI1wiKyhpKzEpLCBkZWNpc2lvbnMpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHRoaXMucG9saWNpZXMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzWzBdLmlkID0gXCJkZWZhdWx0XCJcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbGxlY3Qocm9vdCl7XG4gICAgICAgIHZhciBub2RlUXVldWUgPSBbcm9vdF07XG4gICAgICAgIHZhciBub2RlO1xuICAgICAgICB2YXIgZGVjaXNpb25Ob2RlcyA9IFtdO1xuICAgICAgICB3aGlsZShub2RlUXVldWUubGVuZ3RoKXtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlUXVldWUuc2hpZnQoKTtcblxuICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICBkZWNpc2lvbk5vZGVzLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuICAgICAgICAgICAgICAgIG5vZGVRdWV1ZS5wdXNoKGVkZ2UuY2hpbGROb2RlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YoZGVjaXNpb25Ob2Rlcy5tYXAoKGRlY2lzaW9uTm9kZSk9PntcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbnM9IFtdO1xuICAgICAgICAgICAgZGVjaXNpb25Ob2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcblxuICAgICAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIWVkZ2UuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZERlY2lzaW9ucyA9IHRoaXMuY29sbGVjdChlZGdlLmNoaWxkTm9kZSk7IC8vYWxsIHBvc3NpYmxlIGNoaWxkIGRlY2lzaW9ucyAoY2FydGVzaWFuKVxuICAgICAgICAgICAgICAgIGNoaWxkRGVjaXNpb25zLmZvckVhY2goY2Q9PntcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKGRlY2lzaW9uTm9kZSwgaSk7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9ucy5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4gPSBjZDtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbnM7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY3l7XG4gICAgaWQ7XG4gICAgZGVjaXNpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihpZCwgZGVjaXNpb25zKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyA9IGRlY2lzaW9ucyB8fCBbXTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShwb2xpY3kpe1xuICAgICAgICB2YXIga2V5ID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PmtleSs9KGtleT8gXCImXCI6IFwiXCIpK2Qua2V5KTtcbiAgICAgICAgcmV0dXJuIGtleTtcbiAgICB9XG5cbiAgICBlcXVhbHMocG9saWN5LCBpZ25vcmVJZD10cnVlKXtcbiAgICAgICAgaWYodGhpcy5rZXkgIT0gcG9saWN5LmtleSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWdub3JlSWQgfHwgdGhpcy5pZCA9PT0gcG9saWN5LmlkO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24ocG9saWN5LCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBmb3IodmFyIGk9MDsgaTxwb2xpY3kuZGVjaXNpb25zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IERlY2lzaW9uLmdldERlY2lzaW9uKHBvbGljeS5kZWNpc2lvbnNbaV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHN0YXRpYyB0b1BvbGljeVN0cmluZyhwb2xpY3ksIGV4dGVuZGVkPWZhbHNlLCBwcmVwZW5kSWQ9ZmFsc2Upe1xuXG4gICAgICAgIHZhciByZXMgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYocmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIlxcblwiXG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCwgZXh0ZW5kZWQsICduYW1lJywgJ1xcdCcpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYocHJlcGVuZElkICYmIHBvbGljeS5pZCE9PXVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gcG9saWN5LmlkK1wiIFwiK3JlcztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuXG4gICAgdG9Qb2xpY3lTdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS50b1BvbGljeVN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5leHBvcnQgY2xhc3MgTWNkbVdlaWdodFZhbHVlVmFsaWRhdG9ye1xuXG4gICAgYWRkaXRpb25hbFZhbGlkYXRvciA9IG51bGw7XG5cbiAgICBjb25zdHJ1Y3RvcihhZGRpdGlvbmFsVmFsaWRhdG9yKXtcbiAgICAgICAgdGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yID0gYWRkaXRpb25hbFZhbGlkYXRvcjtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSl7XG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwYXJzZWQgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICAgICAgaWYocGFyc2VkICE9PSBJbmZpbml0eSAmJiAhRXhwcmVzc2lvbkVuZ2luZS52YWxpZGF0ZSh2YWx1ZSwge30sIGZhbHNlKSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHZhciBtYXhTYWZlSW50ZWdlciA9IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIHx8IDkwMDcxOTkyNTQ3NDA5OTE7IC8vIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIGlzIHVuZGVmaW5lZCBpbiBJRVxuICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIDApIDwgMCB8fCAodmFsdWUgIT09IEluZmluaXR5ICYmIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgbWF4U2FmZUludGVnZXIpPiAwKSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmFkZGl0aW9uYWxWYWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmFkZGl0aW9uYWxWYWxpZGF0b3IoRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSkpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUGF5b2ZmVmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuXG5cbiAgICAgICAgaWYodmFsdWU9PT1udWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgdmFyIG1heFNhZmVJbnRlZ2VyID0gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgfHwgOTAwNzE5OTI1NDc0MDk5MTsgLy8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgaW4gdW5kZWZpbmVkIGluIElFXG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIC1tYXhTYWZlSW50ZWdlcikgPj0gMCAmJiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIG1heFNhZmVJbnRlZ2VyKSA8PSAwO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKkNvbXB1dGVkIGJhc2UgdmFsdWUgdmFsaWRhdG9yKi9cbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9ye1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZT1leHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlLCBlZGdlKXtcbiAgICAgICAgaWYodmFsdWU9PT1udWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZS5jb21wYXJlKDApID49IDAgJiYgdmFsdWUuY29tcGFyZSgxKSA8PSAwO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWwsIFZhbGlkYXRpb25SZXN1bHR9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7UHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcHJvYmFiaWxpdHktdmFsdWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BheW9mZlZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi9wYXlvZmYtdmFsdWUtdmFsaWRhdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBUcmVlVmFsaWRhdG9yIHtcblxuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMucHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvciA9IG5ldyBQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLnBheW9mZlZhbHVlVmFsaWRhdG9yID0gbmV3IFBheW9mZlZhbHVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKG5vZGVzKSB7XG5cbiAgICAgICAgdmFyIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpO1xuXG4gICAgICAgIG5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIHRoaXMudmFsaWRhdGVOb2RlKG4sIHZhbGlkYXRpb25SZXN1bHQpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdmFsaWRhdGlvblJlc3VsdDtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZU5vZGUobm9kZSwgdmFsaWRhdGlvblJlc3VsdCA9IG5ldyBWYWxpZGF0aW9uUmVzdWx0KCkpIHtcblxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghbm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcignaW5jb21wbGV0ZVBhdGgnLCBub2RlKVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcbiAgICAgICAgdmFyIHdpdGhIYXNoID0gZmFsc2U7XG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCB0cnVlKTtcblxuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5ID0gZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5wcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yLnZhbGlkYXRlKHByb2JhYmlsaXR5KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIUV4cHJlc3Npb25FbmdpbmUuaXNIYXNoKGUucHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFByb2JhYmlsaXR5JywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGUucGF5b2ZmLmZvckVhY2goKHJhd1BheW9mZiwgcGF5b2ZmSW5kZXgpPT4ge1xuICAgICAgICAgICAgICAgIHZhciBwYXRoID0gJ3BheW9mZlsnICsgcGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KHBhdGgsIHRydWUpO1xuICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBlLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIHBheW9mZkluZGV4KTtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMucGF5b2ZmVmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocGF5b2ZmKSkge1xuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFBheW9mZicsIGRhdGE6IHsnbnVtYmVyJzogaSArIDF9fSwgbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eShwYXRoLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIGlmIChpc05hTihwcm9iYWJpbGl0eVN1bSkgfHwgIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ3Byb2JhYmlsaXR5RG9Ob3RTdW1VcFRvMScsIG5vZGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cblxuICAgICAgICByZXR1cm4gdmFsaWRhdGlvblJlc3VsdDtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL3NyYy9pbmRleCdcbiJdfQ==
