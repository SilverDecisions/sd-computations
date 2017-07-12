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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmMvY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyYy9jb21wdXRhdGlvbnMtbWFuYWdlci5qcyIsInNyYy9jb21wdXRhdGlvbnMtdXRpbHMuanMiLCJzcmMvZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXAuanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9leHRlbmRhYmxlLWVycm9yLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmMvam9icy9lbmdpbmUvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItaW5zdGFuY2UuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWxhdW5jaGVyLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlc3VsdC5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2Itc3RhdHVzLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi5qcyIsInNyYy9qb2JzL2VuZ2luZS9zaW1wbGUtam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAuanMiLCJzcmMvam9icy9pbmRleC5qcyIsInNyYy9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjL2pvYnMvam9iLXdvcmtlci5qcyIsInNyYy9qb2JzL2pvYnMtbWFuYWdlci5qcyIsInNyYy9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvaW5kZXguanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21heC1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWF4LW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1heC1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9taW4tbWF4LXJ1bGUuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21pbi1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbXVsdGktY3JpdGVyaWEtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmMvb3BlcmF0aW9ucy9mbGlwLXN1YnRyZWUuanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb24uanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmMvcG9saWNpZXMvZGVjaXNpb24uanMiLCJzcmMvcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yLmpzIiwic3JjL3BvbGljaWVzL3BvbGljeS5qcyIsInNyYy92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyYy92YWxpZGF0aW9uL3BheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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b3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XG5cbihmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gdG9BcnJheShhcnIpIHtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3QocmVxdWVzdCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUocmVxdWVzdC5yZXN1bHQpO1xuICAgICAgfTtcblxuICAgICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChyZXF1ZXN0LmVycm9yKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciByZXF1ZXN0O1xuICAgIHZhciBwID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0ID0gb2JqW21ldGhvZF0uYXBwbHkob2JqLCBhcmdzKTtcbiAgICAgIHByb21pc2lmeVJlcXVlc3QocmVxdWVzdCkudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgIH0pO1xuXG4gICAgcC5yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgICByZXR1cm4gcDtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncyk7XG4gICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIHAucmVxdWVzdCk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVByb3BlcnRpZXMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoUHJveHlDbGFzcy5wcm90b3R5cGUsIHByb3AsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpc1t0YXJnZXRQcm9wXVtwcm9wXTtcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWwpIHtcbiAgICAgICAgICB0aGlzW3RhcmdldFByb3BdW3Byb3BdID0gdmFsO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UmVxdWVzdE1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwodGhpc1t0YXJnZXRQcm9wXSwgcHJvcCwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eU1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpc1t0YXJnZXRQcm9wXVtwcm9wXS5hcHBseSh0aGlzW3RhcmdldFByb3BdLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwodGhpc1t0YXJnZXRQcm9wXSwgcHJvcCwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBJbmRleChpbmRleCkge1xuICAgIHRoaXMuX2luZGV4ID0gaW5kZXg7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoSW5kZXgsICdfaW5kZXgnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnbXVsdGlFbnRyeScsXG4gICAgJ3VuaXF1ZSdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhJbmRleCwgJ19pbmRleCcsIElEQkluZGV4LCBbXG4gICAgJ2dldCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhJbmRleCwgJ19pbmRleCcsIElEQkluZGV4LCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBmdW5jdGlvbiBDdXJzb3IoY3Vyc29yLCByZXF1ZXN0KSB7XG4gICAgdGhpcy5fY3Vyc29yID0gY3Vyc29yO1xuICAgIHRoaXMuX3JlcXVlc3QgPSByZXF1ZXN0O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEN1cnNvciwgJ19jdXJzb3InLCBbXG4gICAgJ2RpcmVjdGlvbicsXG4gICAgJ2tleScsXG4gICAgJ3ByaW1hcnlLZXknLFxuICAgICd2YWx1ZSdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhDdXJzb3IsICdfY3Vyc29yJywgSURCQ3Vyc29yLCBbXG4gICAgJ3VwZGF0ZScsXG4gICAgJ2RlbGV0ZSdcbiAgXSk7XG5cbiAgLy8gcHJveHkgJ25leHQnIG1ldGhvZHNcbiAgWydhZHZhbmNlJywgJ2NvbnRpbnVlJywgJ2NvbnRpbnVlUHJpbWFyeUtleSddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kTmFtZSkge1xuICAgIGlmICghKG1ldGhvZE5hbWUgaW4gSURCQ3Vyc29yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICBDdXJzb3IucHJvdG90eXBlW21ldGhvZE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgY3Vyc29yID0gdGhpcztcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgIGN1cnNvci5fY3Vyc29yW21ldGhvZE5hbWVdLmFwcGx5KGN1cnNvci5fY3Vyc29yLCBhcmdzKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3QoY3Vyc29yLl9yZXF1ZXN0KS50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgICAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBjdXJzb3IuX3JlcXVlc3QpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIGZ1bmN0aW9uIE9iamVjdFN0b3JlKHN0b3JlKSB7XG4gICAgdGhpcy5fc3RvcmUgPSBzdG9yZTtcbiAgfVxuXG4gIE9iamVjdFN0b3JlLnByb3RvdHlwZS5jcmVhdGVJbmRleCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgSW5kZXgodGhpcy5fc3RvcmUuY3JlYXRlSW5kZXguYXBwbHkodGhpcy5fc3RvcmUsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIE9iamVjdFN0b3JlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgSW5kZXgodGhpcy5fc3RvcmUuaW5kZXguYXBwbHkodGhpcy5fc3RvcmUsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdpbmRleE5hbWVzJyxcbiAgICAnYXV0b0luY3JlbWVudCdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ3B1dCcsXG4gICAgJ2FkZCcsXG4gICAgJ2RlbGV0ZScsXG4gICAgJ2NsZWFyJyxcbiAgICAnZ2V0JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ2RlbGV0ZUluZGV4J1xuICBdKTtcblxuICBmdW5jdGlvbiBUcmFuc2FjdGlvbihpZGJUcmFuc2FjdGlvbikge1xuICAgIHRoaXMuX3R4ID0gaWRiVHJhbnNhY3Rpb247XG4gICAgdGhpcy5jb21wbGV0ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25jb21wbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uYWJvcnQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBUcmFuc2FjdGlvbi5wcm90b3R5cGUub2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX3R4Lm9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX3R4LCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVHJhbnNhY3Rpb24sICdfdHgnLCBbXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnLFxuICAgICdtb2RlJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVHJhbnNhY3Rpb24sICdfdHgnLCBJREJUcmFuc2FjdGlvbiwgW1xuICAgICdhYm9ydCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVXBncmFkZURCKGRiLCBvbGRWZXJzaW9uLCB0cmFuc2FjdGlvbikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gICAgdGhpcy5vbGRWZXJzaW9uID0gb2xkVmVyc2lvbjtcbiAgICB0aGlzLnRyYW5zYWN0aW9uID0gbmV3IFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKTtcbiAgfVxuXG4gIFVwZ3JhZGVEQi5wcm90b3R5cGUuY3JlYXRlT2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX2RiLmNyZWF0ZU9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVXBncmFkZURCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhVcGdyYWRlREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdkZWxldGVPYmplY3RTdG9yZScsXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICBmdW5jdGlvbiBEQihkYikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gIH1cblxuICBEQi5wcm90b3R5cGUudHJhbnNhY3Rpb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFRyYW5zYWN0aW9uKHRoaXMuX2RiLnRyYW5zYWN0aW9uLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKERCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIC8vIEFkZCBjdXJzb3IgaXRlcmF0b3JzXG4gIC8vIFRPRE86IHJlbW92ZSB0aGlzIG9uY2UgYnJvd3NlcnMgZG8gdGhlIHJpZ2h0IHRoaW5nIHdpdGggcHJvbWlzZXNcbiAgWydvcGVuQ3Vyc29yJywgJ29wZW5LZXlDdXJzb3InXS5mb3JFYWNoKGZ1bmN0aW9uKGZ1bmNOYW1lKSB7XG4gICAgW09iamVjdFN0b3JlLCBJbmRleF0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgICAgQ29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuICAgICAgICB2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcbiAgICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICAgIH07XG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBwb2x5ZmlsbCBnZXRBbGxcbiAgW0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgIGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG4gICAgQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgIHZhciBpdGVtcyA9IFtdO1xuXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICBpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcbiAgICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuICAgICAgICAgIGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIHZhciBleHAgPSB7XG4gICAgb3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuICAgICAgdmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cbiAgICAgIHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgaWYgKHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgICAgIHVwZ3JhZGVDYWxsYmFjayhuZXcgVXBncmFkZURCKHJlcXVlc3QucmVzdWx0LCBldmVudC5vbGRWZXJzaW9uLCByZXF1ZXN0LnRyYW5zYWN0aW9uKSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24oZGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEQihkYik7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIGRlbGV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ2RlbGV0ZURhdGFiYXNlJywgW25hbWVdKTtcbiAgICB9XG4gIH07XG5cbiAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBleHA7XG4gICAgbW9kdWxlLmV4cG9ydHMuZGVmYXVsdCA9IG1vZHVsZS5leHBvcnRzO1xuICB9XG4gIGVsc2Uge1xuICAgIHNlbGYuaWRiID0gZXhwO1xuICB9XG59KCkpO1xuIiwiaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zTWFuYWdlcn0gZnJvbSBcIi4vY29tcHV0YXRpb25zLW1hbmFnZXJcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ30gZnJvbSBcIi4vY29tcHV0YXRpb25zLW1hbmFnZXJcIjtcblxuXG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmVDb25maWcgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlne1xuICAgIGxvZ0xldmVsID0gJ3dhcm4nO1xuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vRW50cnkgcG9pbnQgY2xhc3MgZm9yIHN0YW5kYWxvbmUgY29tcHV0YXRpb24gd29ya2Vyc1xuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc0VuZ2luZSBleHRlbmRzIENvbXB1dGF0aW9uc01hbmFnZXJ7XG5cbiAgICBnbG9iYWwgPSBVdGlscy5nZXRHbG9iYWxPYmplY3QoKTtcbiAgICBpc1dvcmtlciA9IFV0aWxzLmlzV29ya2VyKCk7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWcsIGRhdGEpe1xuICAgICAgICBzdXBlcihjb25maWcsIGRhdGEpO1xuXG4gICAgICAgIGlmKHRoaXMuaXNXb3JrZXIpIHtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5yZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHtcbiAgICAgICAgICAgICAgICBiZWZvcmVKb2I6IChqb2JFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ2JlZm9yZUpvYicsIGpvYkV4ZWN1dGlvbi5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIGFmdGVySm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdhZnRlckpvYicsIGpvYkV4ZWN1dGlvbi5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICAgICAgICB0aGlzLnF1ZXJ5YWJsZUZ1bmN0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBydW5Kb2I6IGZ1bmN0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pe1xuICAgICAgICAgICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzLCBzZXJpYWxpemVkRGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkYXRhID0gbmV3IERhdGFNb2RlbChkYXRhRFRPKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucnVuSm9iKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgZXhlY3V0ZUpvYjogZnVuY3Rpb24oam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5qb2JzTWFuZ2VyLmV4ZWN1dGUoam9iRXhlY3V0aW9uSWQpLmNhdGNoKGU9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJlcGx5KCdqb2JGYXRhbEVycm9yJywgam9iRXhlY3V0aW9uSWQsIFV0aWxzLmdldEVycm9yRFRPKGUpKTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlY29tcHV0ZTogZnVuY3Rpb24oZGF0YURUTywgcnVsZU5hbWUsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICAgICAgICAgIGlmKHJ1bGVOYW1lKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdmFyIGFsbFJ1bGVzID0gIXJ1bGVOYW1lO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLl9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ3JlY29tcHV0ZWQnLCBkYXRhLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBnbG9iYWwub25tZXNzYWdlID0gZnVuY3Rpb24ob0V2ZW50KSB7XG4gICAgICAgICAgICAgICAgaWYgKG9FdmVudC5kYXRhIGluc3RhbmNlb2YgT2JqZWN0ICYmIG9FdmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZCcpICYmIG9FdmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeUFyZ3VtZW50cycpKSB7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnF1ZXJ5YWJsZUZ1bmN0aW9uc1tvRXZlbnQuZGF0YS5xdWVyeU1ldGhvZF0uYXBwbHkoc2VsZiwgb0V2ZW50LmRhdGEucXVlcnlBcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLmRlZmF1bHRSZXBseShvRXZlbnQuZGF0YSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHN1cGVyLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLnNldExvZ0xldmVsKHRoaXMuY29uZmlnLmxvZ0xldmVsKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgc2V0TG9nTGV2ZWwobGV2ZWwpe1xuICAgICAgICBsb2cuc2V0TGV2ZWwobGV2ZWwpXG4gICAgfVxuXG4gICAgZGVmYXVsdFJlcGx5KG1lc3NhZ2UpIHtcbiAgICAgICAgdGhpcy5yZXBseSgndGVzdCcsIG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJlcGx5KCkge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcGx5IC0gbm90IGVub3VnaCBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmdsb2JhbC5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAncXVlcnlNZXRob2RMaXN0ZW5lcic6IGFyZ3VtZW50c1swXSxcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZEFyZ3VtZW50cyc6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge09iamVjdGl2ZVJ1bGVzTWFuYWdlcn0gZnJvbSBcIi4vb2JqZWN0aXZlL29iamVjdGl2ZS1ydWxlcy1tYW5hZ2VyXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7T3BlcmF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL29wZXJhdGlvbnMvb3BlcmF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0pvYnNNYW5hZ2VyfSBmcm9tIFwiLi9qb2JzL2pvYnMtbWFuYWdlclwiO1xuaW1wb3J0IHtFeHByZXNzaW9uc0V2YWx1YXRvcn0gZnJvbSBcIi4vZXhwcmVzc2lvbnMtZXZhbHVhdG9yXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlTWFuYWdlcn0gZnJvbSBcIi4vam9icy9qb2ItaW5zdGFuY2UtbWFuYWdlclwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtNY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3ZhbGlkYXRpb24vbWNkbS13ZWlnaHQtdmFsdWUtdmFsaWRhdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnIHtcblxuICAgIGxvZ0xldmVsID0gbnVsbDtcblxuICAgIHJ1bGVOYW1lID0gbnVsbDtcbiAgICB3b3JrZXIgPSB7XG4gICAgICAgIGRlbGVnYXRlUmVjb21wdXRhdGlvbjogZmFsc2UsXG4gICAgICAgIHVybDogbnVsbFxuICAgIH07XG4gICAgam9iUmVwb3NpdG9yeVR5cGUgPSAnaWRiJztcbiAgICBjbGVhclJlcG9zaXRvcnkgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNNYW5hZ2VyIHtcbiAgICBkYXRhO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgb3BlcmF0aW9uc01hbmFnZXI7XG4gICAgam9ic01hbmdlcjtcblxuICAgIHRyZWVWYWxpZGF0b3I7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWcsIGRhdGEgPSBudWxsKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuc2V0Q29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IG5ldyBFeHByZXNzaW9uRW5naW5lKCk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBuZXcgRXhwcmVzc2lvbnNFdmFsdWF0b3IodGhpcy5leHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBuZXcgT2JqZWN0aXZlUnVsZXNNYW5hZ2VyKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5jb25maWcucnVsZU5hbWUpO1xuICAgICAgICB0aGlzLm9wZXJhdGlvbnNNYW5hZ2VyID0gbmV3IE9wZXJhdGlvbnNNYW5hZ2VyKHRoaXMuZGF0YSwgdGhpcy5leHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyID0gbmV3IEpvYnNNYW5hZ2VyKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB7XG4gICAgICAgICAgICB3b3JrZXJVcmw6IHRoaXMuY29uZmlnLndvcmtlci51cmwsXG4gICAgICAgICAgICByZXBvc2l0b3J5VHlwZTogdGhpcy5jb25maWcuam9iUmVwb3NpdG9yeVR5cGUsXG4gICAgICAgICAgICBjbGVhclJlcG9zaXRvcnk6IHRoaXMuY29uZmlnLmNsZWFyUmVwb3NpdG9yeVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IodGhpcy5leHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5tY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3IgPSBuZXcgTWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGdldEN1cnJlbnRSdWxlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuY3VycmVudFJ1bGU7XG4gICAgfVxuXG4gICAgZmxpcENyaXRlcmlhKGRhdGEpe1xuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGRhdGEucmV2ZXJzZVBheW9mZnMoKTtcbiAgICAgICAgbGV0IHRtcCA9IGRhdGEud2VpZ2h0TG93ZXJCb3VuZDtcbiAgICAgICAgZGF0YS53ZWlnaHRMb3dlckJvdW5kID0gdGhpcy5mbGlwKGRhdGEud2VpZ2h0VXBwZXJCb3VuZCk7XG4gICAgICAgIGRhdGEud2VpZ2h0VXBwZXJCb3VuZCA9IHRoaXMuZmxpcCh0bXApO1xuICAgICAgICBkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0ID0gdGhpcy5mbGlwKGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5mbGlwUnVsZSgpO1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGZhbHNlKTtcbiAgICB9XG5cbiAgICBmbGlwKGEpe1xuICAgICAgICBpZihhID09IEluZmluaXR5KXtcbiAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYSA9PSAwKXtcbiAgICAgICAgICAgIHJldHVybiBJbmZpbml0eTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGEpKVxuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShqb2JOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnJ1bihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGRhdGEgfHwgdGhpcy5kYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZClcbiAgICB9XG5cbiAgICBydW5Kb2JXaXRoSW5zdGFuY2VNYW5hZ2VyKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgam9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlTWFuYWdlcih0aGlzLmpvYnNNYW5nZXIsIGplLCBqb2JJbnN0YW5jZU1hbmFnZXJDb25maWcpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucnVsZXM7XG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXRPYmplY3RpdmVSdWxlQnlOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmlzUnVsZU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpIHtcbiAgICAgICAgdGhpcy5jb25maWcucnVsZU5hbWUgPSBydWxlTmFtZTtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIG9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbnNNYW5hZ2VyLm9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KTtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25maWcud29ya2VyLmRlbGVnYXRlUmVjb21wdXRhdGlvbikge1xuICAgICAgICAgICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICAgIGV2YWxDb2RlOiBldmFsQ29kZSxcbiAgICAgICAgICAgICAgICAgICAgZXZhbE51bWVyaWM6IGV2YWxOdW1lcmljXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoIWFsbFJ1bGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIHBhcmFtcy5ydWxlTmFtZSA9IHRoaXMuZ2V0Q3VycmVudFJ1bGUoKS5uYW1lO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5ydW5Kb2IoXCJyZWNvbXB1dGVcIiwgcGFyYW1zLCB0aGlzLmRhdGEsIGZhbHNlKS50aGVuKChqb2JFeGVjdXRpb24pPT4ge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IGpvYkV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGF0YS51cGRhdGVGcm9tKGQpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKHRoaXMuZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZURpc3BsYXlWYWx1ZXModGhpcy5kYXRhKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIF9jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSA9IGZhbHNlLCBldmFsTnVtZXJpYyA9IHRydWUpIHtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci51cGRhdGVEZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cyA9IFtdO1xuXG4gICAgICAgIGlmIChldmFsQ29kZSB8fCBldmFsTnVtZXJpYykge1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB3ZWlnaHRWYWxpZCA9IHRoaXMubWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpO1xuICAgICAgICB2YXIgbXVsdGlDcml0ZXJpYSA9IHRoaXMuZ2V0Q3VycmVudFJ1bGUoKS5tdWx0aUNyaXRlcmlhO1xuXG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gocm9vdD0+IHtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpKTtcbiAgICAgICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMucHVzaCh2cik7XG4gICAgICAgICAgICBpZiAodnIuaXNWYWxpZCgpICYmICghbXVsdGlDcml0ZXJpYSB8fCB3ZWlnaHRWYWxpZCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy9DaGVja3MgdmFsaWRpdHkgb2YgZGF0YSBtb2RlbCB3aXRob3V0IHJlY29tcHV0YXRpb24gYW5kIHJldmFsaWRhdGlvblxuICAgIGlzVmFsaWQoZGF0YSkge1xuICAgICAgICB2YXIgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICByZXR1cm4gZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5ldmVyeSh2cj0+dnIuaXNWYWxpZCgpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVEaXNwbGF5VmFsdWVzKGRhdGEsIHBvbGljeVRvRGlzcGxheSA9IG51bGwpIHtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBpZiAocG9saWN5VG9EaXNwbGF5KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5KGRhdGEsIHBvbGljeVRvRGlzcGxheSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobik7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlRWRnZURpc3BsYXlWYWx1ZXMoZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdXBkYXRlTm9kZURpc3BsYXlWYWx1ZXMobm9kZSkge1xuICAgICAgICBub2RlLiRESVNQTEFZX1ZBTFVFX05BTUVTLmZvckVhY2gobj0+bm9kZS5kaXNwbGF5VmFsdWUobiwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuKSkpO1xuICAgIH1cblxuICAgIHVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpIHtcbiAgICAgICAgZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49PmUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldEVkZ2VEaXNwbGF5VmFsdWUoZSwgbikpKTtcbiAgICB9XG5cbiAgICBkaXNwbGF5UG9saWN5KHBvbGljeVRvRGlzcGxheSwgZGF0YSkge1xuXG5cbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIG4uY2xlYXJEaXNwbGF5VmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIGUuY2xlYXJEaXNwbGF5VmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaCgocm9vdCk9PnRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUocm9vdCwgcG9saWN5VG9EaXNwbGF5KSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeUZvck5vZGUobm9kZSwgcG9saWN5KSB7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSB7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24ocG9saWN5LCBub2RlKTtcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2coZGVjaXNpb24sIG5vZGUsIHBvbGljeSk7XG4gICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICBub2RlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkRWRnZSA9IG5vZGUuY2hpbGRFZGdlc1tkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICBjaGlsZEVkZ2UuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShjaGlsZEVkZ2UuY2hpbGROb2RlLCBwb2xpY3kpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGUuY2hpbGROb2RlLCBwb2xpY3kpKVxuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zVXRpbHN7XG5cbiAgICBzdGF0aWMgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChtYXgsIG1pbik7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIHN0ZXBzID0gbGVuZ3RoIC0gMTtcbiAgICAgICAgaWYoIXN0ZXBzKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShleHRlbnQsbGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciBjdXJyID0gbWluO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aCAtIDI7IGkrKykge1xuICAgICAgICAgICAgY3VyciA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGN1cnIsIHN0ZXApO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KGN1cnIpKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQucHVzaChtYXgpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG4vKkV2YWx1YXRlcyBjb2RlIGFuZCBleHByZXNzaW9ucyBpbiB0cmVlcyovXG5leHBvcnQgY2xhc3MgRXhwcmVzc2lvbnNFdmFsdWF0b3Ige1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgY2xlYXIoZGF0YSl7XG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY2xlYXJUcmVlKGRhdGEsIHJvb3Qpe1xuICAgICAgICBkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICBuLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGVzPWZhbHNlKXtcbiAgICAgICAgbG9nLmRlYnVnKCdldmFsRXhwcmVzc2lvbnMgZXZhbENvZGU6JytldmFsQ29kZSsnIGV2YWxOdW1lcmljOicrZXZhbE51bWVyaWMpO1xuICAgICAgICBpZihldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhclRyZWUoZGF0YSwgbik7XG4gICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbiwgZXZhbENvZGUsIGV2YWxOdW1lcmljLGluaXRTY29wZXMpO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGV2YWxHbG9iYWxDb2RlKGRhdGEpe1xuICAgICAgICBkYXRhLmNsZWFyRXhwcmVzc2lvblNjb3BlKCk7XG4gICAgICAgIGRhdGEuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwoZGF0YS5jb2RlLCBmYWxzZSwgZGF0YS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgZGF0YS4kY29kZUVycm9yID0gZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbm9kZSwgZXZhbENvZGU9dHJ1ZSwgZXZhbE51bWVyaWM9dHJ1ZSwgaW5pdFNjb3BlPWZhbHNlKSB7XG4gICAgICAgIGlmKCFub2RlLmV4cHJlc3Npb25TY29wZSB8fCBpbml0U2NvcGUgfHwgZXZhbENvZGUpe1xuICAgICAgICAgICAgdGhpcy5pbml0U2NvcGVGb3JOb2RlKGRhdGEsIG5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIG5vZGUuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICAgICAgaWYobm9kZS5jb2RlKXtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKG5vZGUuY29kZSwgZmFsc2UsIG5vZGUuZXhwcmVzc2lvblNjb3BlKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgICAgICAgICBub2RlLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgdmFyIHNjb3BlID0gbm9kZS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW09RXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcbiAgICAgICAgICAgIHZhciBoYXNoRWRnZXM9IFtdO1xuICAgICAgICAgICAgdmFyIGludmFsaWRQcm9iID0gZmFsc2U7XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLnBheW9mZi5mb3JFYWNoKChyYXdQYXlvZmYsIHBheW9mZkluZGV4KT0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHBhdGggPSAncGF5b2ZmWycgKyBwYXlvZmZJbmRleCArICddJztcbiAgICAgICAgICAgICAgICAgICAgaWYoZS5pc0ZpZWxkVmFsaWQocGF0aCwgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgcGF0aCwgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWxQYXlvZmYoZSwgcGF5b2ZmSW5kZXgpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgTGVmdCBlbXB0eSBpbnRlbnRpb25hbGx5XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuXG5cbiAgICAgICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaXNIYXNoKGUucHJvYmFiaWxpdHkpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2hFZGdlcy5wdXNoKGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5oYXNBc3NpZ25tZW50RXhwcmVzc2lvbihlLnByb2JhYmlsaXR5KSl7IC8vSXQgc2hvdWxkIG5vdCBvY2N1ciBoZXJlIVxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nLndhcm4oXCJldmFsRXhwcmVzc2lvbnNGb3JOb2RlIGhhc0Fzc2lnbm1lbnRFeHByZXNzaW9uIVwiLCBlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoZS5pc0ZpZWxkVmFsaWQoJ3Byb2JhYmlsaXR5JywgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGUucHJvYmFiaWxpdHksIHRydWUsIHNjb3BlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3Byb2JhYmlsaXR5JywgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9Y2F0Y2ggKGVycil7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW52YWxpZFByb2IgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG5cblxuICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHZhciBjb21wdXRlSGFzaCA9IGhhc2hFZGdlcy5sZW5ndGggJiYgIWludmFsaWRQcm9iICYmIChwcm9iYWJpbGl0eVN1bS5jb21wYXJlKDApID49IDAgJiYgcHJvYmFiaWxpdHlTdW0uY29tcGFyZSgxKSA8PSAwKTtcblxuICAgICAgICAgICAgICAgIGlmKGNvbXB1dGVIYXNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYXNoID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdCgxLCBwcm9iYWJpbGl0eVN1bSksIGhhc2hFZGdlcy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIGhhc2gpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgZS5jaGlsZE5vZGUsIGV2YWxDb2RlLCBldmFsTnVtZXJpYywgaW5pdFNjb3BlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdFNjb3BlRm9yTm9kZShkYXRhLCBub2RlKXtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5vZGUuJHBhcmVudDtcbiAgICAgICAgdmFyIHBhcmVudFNjb3BlID0gcGFyZW50P3BhcmVudC5leHByZXNzaW9uU2NvcGUgOiBkYXRhLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgbm9kZS5leHByZXNzaW9uU2NvcGUgPSBVdGlscy5jbG9uZURlZXAocGFyZW50U2NvcGUpO1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLWVuZ2luZSdcbmV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2V4cHJlc3Npb25zLWV2YWx1YXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9icy9pbmRleCdcblxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwid2VpZ2h0TG93ZXJCb3VuZFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgKHYsIGFsbFZhbHMpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB2ID49IDAgJiYgdiA8PSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKGFsbFZhbHNbJ3dlaWdodFVwcGVyQm91bmQnXSlcbiAgICAgICAgfSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ3ZWlnaHRVcHBlckJvdW5kXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCAodiwgYWxsVmFscykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHYgPj0gMCAmJiB2ID49IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24oYWxsVmFsc1snd2VpZ2h0TG93ZXJCb3VuZCddKVxuICAgICAgICB9KSk7XG5cbiAgICB9XG5cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24xOiAnQ29zdCcsXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24yOiAnRWZmZWN0JyxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWUsXG4gICAgICAgICAgICB3ZWlnaHRMb3dlckJvdW5kOiAwLFxuICAgICAgICAgICAgd2VpZ2h0VXBwZXJCb3VuZDogSW5maW5pdHksXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7TGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9sZWFndWUtdGFibGUtam9iLXBhcmFtZXRlcnNcIjtcblxuXG5leHBvcnQgY2xhc3MgTGVhZ3VlVGFibGVKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImxlYWd1ZS10YWJsZVwiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5pbml0U3RlcHMoKTtcbiAgICB9XG5cbiAgICBpbml0U3RlcHMoKSB7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IExlYWd1ZVRhYmxlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzID0gdHJ1ZSkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmICh3aXRoSGVhZGVycykge1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeV9pZCcsICdwb2xpY3knLCBqb2JSZXN1bHQucGF5b2ZmTmFtZXNbMF0sIGpvYlJlc3VsdC5wYXlvZmZOYW1lc1sxXSwgJ2RvbWluYXRlZF9ieScsICdleHRlbmRlZC1kb21pbmF0ZWRfYnknLCAnaW5jcmF0aW8nXTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93LnBvbGljaWVzLmZvckVhY2gocG9saWN5PT4ge1xuICAgICAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtcbiAgICAgICAgICAgICAgICAgICAgcm93LmlkLFxuICAgICAgICAgICAgICAgICAgICBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgcm93LnBheW9mZnNbMV0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5wYXlvZmZzWzBdLFxuICAgICAgICAgICAgICAgICAgICByb3cuZG9taW5hdGVkQnksXG4gICAgICAgICAgICAgICAgICAgIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5ID09PSBudWxsID8gbnVsbCA6IHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzBdICsgJywgJyArIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzFdLFxuICAgICAgICAgICAgICAgICAgICByb3cuaW5jcmF0aW9cbiAgICAgICAgICAgICAgICBdO1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuY3VycmVudFJ1bGU7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuXG4gICAgICAgIHZhciBwYXlvZmZDb2VmZnMgPSB0aGlzLnBheW9mZkNvZWZmcyA9IHJ1bGUucGF5b2ZmQ29lZmZzO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEpO1xuICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuXG4gICAgICAgIGlmICghdnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjb21wYXJlID0gKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYi5wYXlvZmZzWzBdIC0gYS5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgKGEucGF5b2Zmc1sxXSAtIGIucGF5b2Zmc1sxXSkpO1xuXG4gICAgICAgIHZhciByb3dzID0gcG9saWNpZXMubWFwKHBvbGljeSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IFtwb2xpY3ldLFxuICAgICAgICAgICAgICAgIHBheW9mZnM6IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKS5zbGljZSgpLFxuICAgICAgICAgICAgICAgIGRvbWluYXRlZEJ5OiBudWxsLFxuICAgICAgICAgICAgICAgIGV4dGVuZGVkRG9taW5hdGVkQnk6IG51bGwsXG4gICAgICAgICAgICAgICAgaW5jcmF0aW86IG51bGxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuc29ydChjb21wYXJlKTtcblxuICAgICAgICByb3dzID0gcm93cy5yZWR1Y2UoKHByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZSwgaW5kZXgsIGFycmF5KT0+e1xuICAgICAgICAgICAgaWYoIXByZXZpb3VzVmFsdWUubGVuZ3RoKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2N1cnJlbnRWYWx1ZV1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBwcmV2aW91c1ZhbHVlW3ByZXZpb3VzVmFsdWUubGVuZ3RoLTFdO1xuICAgICAgICAgICAgaWYoY29tcGFyZShwcmV2LCBjdXJyZW50VmFsdWUpID09IDApe1xuICAgICAgICAgICAgICAgIHByZXYucG9saWNpZXMucHVzaCguLi5jdXJyZW50VmFsdWUucG9saWNpZXMpO1xuICAgICAgICAgICAgICAgIHJldHVybiBwcmV2aW91c1ZhbHVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcHJldmlvdXNWYWx1ZS5jb25jYXQoY3VycmVudFZhbHVlKVxuICAgICAgICB9LCBbXSk7XG5cbiAgICAgICAgcm93cy5zb3J0KChhLCBiKT0+KHBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgociwgaSk9PiB7XG4gICAgICAgICAgICByLmlkID0gaSsxO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gcm93cy5zb3J0KGNvbXBhcmUpO1xuICAgICAgICByb3dzLnNvcnQoKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG5cbiAgICAgICAgbGV0IGJlc3RDb3N0ID0gLXBheW9mZkNvZWZmc1sxXSAqIEluZmluaXR5LFxuICAgICAgICAgICAgYmVzdENvc3RSb3cgPSBudWxsO1xuXG4gICAgICAgIGxldCBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgaWYocGF5b2ZmQ29lZmZzWzFdPDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1cblxuICAgICAgICByb3dzLmZvckVhY2goKHIsIGkpPT4ge1xuICAgICAgICAgICAgaWYgKGNtcChyLnBheW9mZnNbMV0sIGJlc3RDb3N0KSkge1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0ID0gci5wYXlvZmZzWzFdO1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0Um93ID0gcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZihiZXN0Q29zdFJvdykge1xuICAgICAgICAgICAgICAgIHIuZG9taW5hdGVkQnkgPSBiZXN0Q29zdFJvdy5pZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIGlmKHBheW9mZkNvZWZmc1swXSA+IDAgJiYgcGF5b2ZmQ29lZmZzWzFdIDwgMCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfWVsc2UgaWYocGF5b2ZmQ29lZmZzWzBdIDwgMCAmJiBwYXlvZmZDb2VmZnNbMV0gPiAwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9ZWxzZSBpZihwYXlvZmZDb2VmZnNbMV08MCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwcmV2Mk5vdERvbWluYXRlZCA9IG51bGw7XG4gICAgICAgIHJvd3MuZmlsdGVyKHI9PiFyLmRvbWluYXRlZEJ5KS5zb3J0KChhLCBiKT0+KCAgcGF5b2ZmQ29lZmZzWzBdICogKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpKS5mb3JFYWNoKChyLCBpLCBhcnIpPT4ge1xuICAgICAgICAgICAgaWYgKGkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHIuaW5jcmF0aW8gPSAwO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBhcnJbaSAtIDFdO1xuXG4gICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2KTtcbiAgICAgICAgICAgIGlmIChpIDwgMikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoIXByZXYyTm90RG9taW5hdGVkKXtcbiAgICAgICAgICAgICAgICBwcmV2Mk5vdERvbWluYXRlZCA9IGFycltpIC0gMl07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGNtcChyLmluY3JhdGlvLHByZXYuaW5jcmF0aW8pKXtcbiAgICAgICAgICAgICAgICBwcmV2LmluY3JhdGlvID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwcmV2LmV4dGVuZGVkRG9taW5hdGVkQnkgPSBbcHJldjJOb3REb21pbmF0ZWQuaWQsIHIuaWRdIDtcbiAgICAgICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2Mk5vdERvbWluYXRlZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBwcmV2Mk5vdERvbWluYXRlZCA9IHByZXY7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCB3ZWlnaHRMb3dlckJvdW5kID0gcGFyYW1zLnZhbHVlKFwid2VpZ2h0TG93ZXJCb3VuZFwiKTtcbiAgICAgICAgbGV0IHdlaWdodFVwcGVyQm91bmQgPSBwYXJhbXMudmFsdWUoXCJ3ZWlnaHRVcHBlckJvdW5kXCIpO1xuXG4gICAgICAgIC8vbWFyayBvcHRpbWFsIGZvciB3ZWlnaHQgaW4gW3dlaWdodExvd2VyQm91bmQsIHdlaWdodFVwcGVyQm91bmRdXG4gICAgICAgIGxldCBsYXN0TEVMb3dlciA9IG51bGw7XG4gICAgICAgIHJvd3Muc2xpY2UoKS5maWx0ZXIocj0+IXIuZG9taW5hdGVkQnkgJiYgIXIuZXh0ZW5kZWREb21pbmF0ZWRCeSkuc29ydCgoYSwgYikgPT4gYS5pbmNyYXRpbyAtIGIuaW5jcmF0aW8pLmZvckVhY2goKHJvdywgaSwgYXJyKT0+e1xuXG4gICAgICAgICAgICBpZihyb3cuaW5jcmF0aW8gPD0gd2VpZ2h0TG93ZXJCb3VuZCl7XG4gICAgICAgICAgICAgICAgbGFzdExFTG93ZXIgID0gcm93O1xuICAgICAgICAgICAgfWVsc2UgaWYocm93LmluY3JhdGlvID09IHdlaWdodExvd2VyQm91bmQpe1xuICAgICAgICAgICAgICAgIGxhc3RMRUxvd2VyID0gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm93Lm9wdGltYWwgPSByb3cuaW5jcmF0aW8gPj0gd2VpZ2h0TG93ZXJCb3VuZCAmJiByb3cuaW5jcmF0aW8gPD0gd2VpZ2h0VXBwZXJCb3VuZDtcblxuICAgICAgICB9KTtcbiAgICAgICAgaWYobGFzdExFTG93ZXIpe1xuICAgICAgICAgICAgbGFzdExFTG93ZXIub3B0aW1hbCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByb3dzLmZvckVhY2gocm93PT57XG4gICAgICAgICAgICByb3cucGF5b2Zmc1swXSA9ICBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LnBheW9mZnNbMF0pO1xuICAgICAgICAgICAgcm93LnBheW9mZnNbMV0gPSAgRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5wYXlvZmZzWzFdKTtcbiAgICAgICAgICAgIHJvdy5pbmNyYXRpbyA9IHJvdy5pbmNyYXRpbyA9PT0gbnVsbCA/IG51bGwgOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LmluY3JhdGlvKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICBwYXlvZmZOYW1lczogZGF0YS5wYXlvZmZOYW1lcy5zbGljZSgpLFxuICAgICAgICAgICAgcGF5b2ZmQ29lZmZzIDogcGF5b2ZmQ29lZmZzLFxuICAgICAgICAgICAgcm93czogcm93cy5zb3J0KChhLCBiKT0+KGEuaWQgLSBiLmlkKSksXG4gICAgICAgICAgICB3ZWlnaHRMb3dlckJvdW5kOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQod2VpZ2h0TG93ZXJCb3VuZCksXG4gICAgICAgICAgICB3ZWlnaHRVcHBlckJvdW5kOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQod2VpZ2h0VXBwZXJCb3VuZClcbiAgICAgICAgfTtcblxuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBjb21wdXRlSUNFUihyLCBwcmV2KXtcbiAgICAgICAgbGV0IGQgPSBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KHIucGF5b2Zmc1swXSwgcHJldi5wYXlvZmZzWzBdKTtcbiAgICAgICAgbGV0IG4gPSBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KHIucGF5b2Zmc1sxXSwgcHJldi5wYXlvZmZzWzFdKTtcbiAgICAgICAgaWYgKGQgPT0gMCl7XG4gICAgICAgICAgICBpZihuPDApe1xuICAgICAgICAgICAgICAgIHJldHVybiAtIEluZmluaXR5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIEluZmluaXR5O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBNYXRoLmFicyhFeHByZXNzaW9uRW5naW5lLmRpdmlkZShuLCBkKSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgUmVjb21wdXRlSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAwKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV2YWxDb2RlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXZhbE51bWVyaWNcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBydWxlTmFtZTogbnVsbCwgLy9yZWNvbXB1dGUgYWxsIHJ1bGVzXG4gICAgICAgICAgICBldmFsQ29kZTogdHJ1ZSxcbiAgICAgICAgICAgIGV2YWxOdW1lcmljOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7UmVjb21wdXRlSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcmVjb21wdXRlLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2JcIjtcblxuZXhwb3J0IGNsYXNzIFJlY29tcHV0ZUpvYiBleHRlbmRzIEpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwicmVjb21wdXRlXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmlzUmVzdGFydGFibGUgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkYXRhID0gZXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IGV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGFsbFJ1bGVzID0gIXJ1bGVOYW1lO1xuICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBwYXJhbXMudmFsdWUoXCJldmFsQ29kZVwiKSwgcGFyYW1zLnZhbHVlKFwiZXZhbE51bWVyaWNcIikpXG4gICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgfVxuXG4gICAgY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKSB7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZihldmFsQ29kZXx8ZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKHJvb3Q9PiB7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KSk7XG4gICAgICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLnB1c2godnIpO1xuICAgICAgICAgICAgaWYgKHZyLmlzVmFsaWQoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFJlY29tcHV0ZUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtaW5cIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1heFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibGVuZ3RoXCIsIFBBUkFNRVRFUl9UWVBFLklOVEVHRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+PSAyKSxcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIHYgPT4gdltcIm1pblwiXSA8IHZbXCJtYXhcIl0sXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWUsXG4gICAgICAgICAgICBmYWlsT25JbnZhbGlkVHJlZTogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7UHJlcGFyZVZhcmlhYmxlc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXBcIjtcbmltcG9ydCB7SW5pdFBvbGljaWVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZT01KSB7XG4gICAgICAgIHN1cGVyKFwic2Vuc2l0aXZpdHktYW5hbHlzaXNcIiwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIHRoaXMuYmF0Y2hTaXplID0gNTtcbiAgICAgICAgdGhpcy5pbml0U3RlcHMoKTtcbiAgICB9XG5cbiAgICBpbml0U3RlcHMoKXtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBQcmVwYXJlVmFyaWFibGVzU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKHRoaXMuY2FsY3VsYXRlU3RlcCk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHNldEJhdGNoU2l6ZShiYXRjaFNpemUpe1xuICAgICAgICB0aGlzLmJhdGNoU2l6ZSA9IGJhdGNoU2l6ZTtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwLmNodW5rU2l6ZSA9IGJhdGNoU2l6ZTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycz10cnVlKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICBpZih3aXRoSGVhZGVycyl7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5X251bWJlcicsICdwb2xpY3knXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLmZvckVhY2gobj0+aGVhZGVycy5wdXNoKG4pKTtcbiAgICAgICAgICAgIGhlYWRlcnMucHVzaCgncGF5b2ZmJyk7XG4gICAgICAgICAgICByZXN1bHQucHVzaChoZWFkZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByb3VuZFZhcmlhYmxlcyA9ICEham9iUGFyYW1ldGVycy52YWx1ZXMucm91bmRWYXJpYWJsZXM7XG4gICAgICAgIGlmKHJvdW5kVmFyaWFibGVzKXtcbiAgICAgICAgICAgIHRoaXMucm91bmRWYXJpYWJsZXMoam9iUmVzdWx0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgIHZhciBwb2xpY3kgPSBqb2JSZXN1bHQucG9saWNpZXNbcm93LnBvbGljeUluZGV4XTtcbiAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtyb3cucG9saWN5SW5kZXgrMSwgUG9saWN5LnRvUG9saWN5U3RyaW5nKHBvbGljeSwgam9iUGFyYW1ldGVycy52YWx1ZXMuZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbildO1xuICAgICAgICAgICAgcm93LnZhcmlhYmxlcy5mb3JFYWNoKHY9PiByb3dDZWxscy5wdXNoKHYpKTtcbiAgICAgICAgICAgIHJvd0NlbGxzLnB1c2gocm93LnBheW9mZik7XG4gICAgICAgICAgICByZXN1bHQucHVzaChyb3dDZWxscyk7XG5cbiAgICAgICAgICAgIGlmKHJvdy5fdmFyaWFibGVzKXsgLy9yZXZlcnQgb3JpZ2luYWwgdmFyaWFibGVzXG4gICAgICAgICAgICAgICAgcm93LnZhcmlhYmxlcyA9IHJvdy5fdmFyaWFibGVzO1xuICAgICAgICAgICAgICAgIGRlbGV0ZSByb3cuX3ZhcmlhYmxlcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICByb3VuZFZhcmlhYmxlcyhqb2JSZXN1bHQpe1xuICAgICAgICB2YXIgdW5pcXVlVmFsdWVzID0gam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMubWFwKCgpPT5uZXcgU2V0KCkpO1xuXG4gICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgIHJvdy5fdmFyaWFibGVzID0gcm93LnZhcmlhYmxlcy5zbGljZSgpOyAvLyBzYXZlIG9yaWdpbmFsIHJvdyB2YXJpYWJsZXNcbiAgICAgICAgICAgIHJvdy52YXJpYWJsZXMuZm9yRWFjaCgodixpKT0+IHtcbiAgICAgICAgICAgICAgICB1bmlxdWVWYWx1ZXNbaV0uYWRkKHYpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHVuaXF1ZVZhbHVlc05vID0gdW5pcXVlVmFsdWVzLm1hcCgocyk9PnMuc2l6ZSk7XG4gICAgICAgIHZhciBtYXhQcmVjaXNpb24gPSAxNDtcbiAgICAgICAgdmFyIHByZWNpc2lvbiA9IDI7XG4gICAgICAgIHZhciBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMgPSBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5tYXAoKHYsaSk9PmkpO1xuICAgICAgICB3aGlsZShwcmVjaXNpb248PW1heFByZWNpc2lvbiAmJiBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMubGVuZ3RoKXtcbiAgICAgICAgICAgIHVuaXF1ZVZhbHVlcyA9IG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5tYXAoKCk9Pm5ldyBTZXQoKSk7XG4gICAgICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICAgICAgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLmZvckVhY2goKHZhcmlhYmxlSW5kZXgsIG5vdFJlYWR5SW5kZXgpPT57XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIHZhbCA9IHJvdy5fdmFyaWFibGVzW3ZhcmlhYmxlSW5kZXhdO1xuICAgICAgICAgICAgICAgICAgICB2YWwgPSBVdGlscy5yb3VuZCh2YWwsIHByZWNpc2lvbik7XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZVZhbHVlc1tub3RSZWFkeUluZGV4XS5hZGQodmFsKTtcblxuICAgICAgICAgICAgICAgICAgICByb3cudmFyaWFibGVzW3ZhcmlhYmxlSW5kZXhdID0gdmFsO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdmFyIG5ld1JlYWR5SW5kZXhlcyA9IFtdO1xuICAgICAgICAgICAgdW5pcXVlVmFsdWVzLmZvckVhY2goKHVuaXF1ZVZhbHMsIG5vdFJlYWR5SW5kZXgpPT57XG4gICAgICAgICAgICAgICAgdmFyIG9yaWdVbmlxdWVDb3VudCA9IHVuaXF1ZVZhbHVlc05vW25vdFJlYWR5VmFyaWFibGVzSW5kZXhlc1tub3RSZWFkeUluZGV4XV0gO1xuICAgICAgICAgICAgICAgIGlmKG9yaWdVbmlxdWVDb3VudD09dW5pcXVlVmFscy5zaXplKXsgLy9yZWFkeSBpbiBwcmV2aW91cyBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICAgICAgbmV3UmVhZHlJbmRleGVzLnB1c2gobm90UmVhZHlJbmRleCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZihuZXdSZWFkeUluZGV4ZXMubGVuZ3RoKSB7IC8vcmV2ZXJ0IHZhbHVlcyB0byBwcmV2IGl0ZXJhdGlvblxuICAgICAgICAgICAgICAgIG5ld1JlYWR5SW5kZXhlcy5yZXZlcnNlKCk7XG4gICAgICAgICAgICAgICAgbmV3UmVhZHlJbmRleGVzLmZvckVhY2gobm90UmVhZHlJbmRleD0+e1xuICAgICAgICAgICAgICAgICAgICBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMuc3BsaWNlKG5vdFJlYWR5SW5kZXgsIDEpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwcmVjaXNpb24rKztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1syXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMl0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge0pvYkNvbXB1dGF0aW9uRXhjZXB0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2V4Y2VwdGlvbnMvam9iLWNvbXB1dGF0aW9uLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIEJhdGNoU3RlcCB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBiYXRjaFNpemUpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCBiYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuXG5cbiAgICAgICAgaWYgKCFqb2JSZXN1bHQuZGF0YS5yb3dzKSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzID0gW107XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZU5hbWVzID0gdmFyaWFibGVOYW1lcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG5cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtKSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBmYWlsT25JbnZhbGlkVHJlZSA9IHBhcmFtcy52YWx1ZShcImZhaWxPbkludmFsaWRUcmVlXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG4gICAgICAgIHZhcmlhYmxlTmFtZXMuZm9yRWFjaCgodmFyaWFibGVOYW1lLCBpKT0+IHtcbiAgICAgICAgICAgIGRhdGEuZXhwcmVzc2lvblNjb3BlW3ZhcmlhYmxlTmFtZV0gPSBpdGVtW2ldO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgdHJlZVJvb3QpO1xuICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuXG4gICAgICAgIHZhciB2YWxpZCA9IHZyLmlzVmFsaWQoKTtcblxuICAgICAgICBpZighdmFsaWQgJiYgZmFpbE9uSW52YWxpZFRyZWUpe1xuICAgICAgICAgICAgbGV0IGVycm9yRGF0YSA9IHtcbiAgICAgICAgICAgICAgICB2YXJpYWJsZXM6IHt9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2YXJpYWJsZU5hbWUsIGkpPT4ge1xuICAgICAgICAgICAgICAgIGVycm9yRGF0YS52YXJpYWJsZXNbdmFyaWFibGVOYW1lXSA9IGl0ZW1baV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbihcImNvbXB1dGF0aW9uc1wiLCBlcnJvckRhdGEpXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcGF5b2ZmcyA9IFtdO1xuXG4gICAgICAgIHBvbGljaWVzLmZvckVhY2gocG9saWN5PT4ge1xuICAgICAgICAgICAgdmFyIHBheW9mZiA9ICduL2EnO1xuICAgICAgICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UsIHBvbGljeSk7XG4gICAgICAgICAgICAgICAgcGF5b2ZmID0gdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpWzBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGF5b2Zmcy5wdXNoKHBheW9mZik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwb2xpY2llczogcG9saWNpZXMsXG4gICAgICAgICAgICB2YXJpYWJsZXM6IGl0ZW0sXG4gICAgICAgICAgICBwYXlvZmZzOiBwYXlvZmZzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb24gPSBwYXJhbXMudmFsdWUoXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIpO1xuXG4gICAgICAgIGl0ZW1zLmZvckVhY2goaXRlbT0+IHtcbiAgICAgICAgICAgIGlmICghaXRlbSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGl0ZW0ucG9saWNpZXMuZm9yRWFjaCgocG9saWN5LCBpKT0+IHtcbiAgICAgICAgICAgICAgICB2YXIgdmFyaWFibGVzID0gaXRlbS52YXJpYWJsZXMubWFwKHYgPT4gdGhpcy50b0Zsb2F0KHYpKTtcblxuICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBpdGVtLnBheW9mZnNbaV07XG4gICAgICAgICAgICAgICAgdmFyIHJvdyA9IHtcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5SW5kZXg6IGksXG4gICAgICAgICAgICAgICAgICAgIHZhcmlhYmxlczogdmFyaWFibGVzLFxuICAgICAgICAgICAgICAgICAgICBwYXlvZmY6IFV0aWxzLmlzU3RyaW5nKHBheW9mZikgPyBwYXlvZmYgOiB0aGlzLnRvRmxvYXQocGF5b2ZmKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKHJvdyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBkZWxldGUgam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcblxuZXhwb3J0IGNsYXNzIEluaXRQb2xpY2llc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiaW5pdF9wb2xpY2llc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWNpZXNcIiwgcG9saWNpZXMpO1xuXG4gICAgICAgIGlmKCFqb2JSZXN1bHQuZGF0YSl7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YT17fVxuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWNpZXMgPSBwb2xpY2llcztcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zVXRpbHN9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9jb21wdXRhdGlvbnMtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIFByZXBhcmVWYXJpYWJsZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihcInByZXBhcmVfdmFyaWFibGVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuXG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXMucHVzaChDb21wdXRhdGlvbnNVdGlscy5zZXF1ZW5jZSh2Lm1pbiwgdi5tYXgsIHYubGVuZ3RoKSk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXJpYWJsZVZhbHVlcyA9IFV0aWxzLmNhcnRlc2lhblByb2R1Y3RPZih2YXJpYWJsZVZhbHVlcyk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhPXtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzOiB2YXJpYWJsZVZhbHVlc1xuICAgICAgICB9O1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZmFpbE9uSW52YWxpZFRyZWVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibnVtYmVyT2ZSdW5zXCIsIFBBUkFNRVRFUl9UWVBFLklOVEVHRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+IDApKTtcblxuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZm9ybXVsYVwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTilcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWUsXG4gICAgICAgICAgICBmYWlsT25JbnZhbGlkVHJlZTogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7SW5pdFBvbGljaWVzU3RlcH0gZnJvbSBcIi4uL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi4vbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge1Byb2JDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0NvbXB1dGVQb2xpY3lTdGF0c1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2NvbXB1dGUtcG9saWN5LXN0YXRzLXN0ZXBcIjtcblxuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iIGV4dGVuZHMgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBiYXRjaFNpemU9NSkge1xuICAgICAgICBzdXBlcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBiYXRjaFNpemUpO1xuICAgICAgICB0aGlzLm5hbWUgPSBcInByb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXNcIjtcbiAgICB9XG5cbiAgICBpbml0U3RlcHMoKSB7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwID0gbmV3IFByb2JDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKHRoaXMuY2FsY3VsYXRlU3RlcCk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgQ29tcHV0ZVBvbGljeVN0YXRzU3RlcCh0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmpvYlJlcG9zaXRvcnkpKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKSB7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMV0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzFdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge2xvZywgVXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuXG5leHBvcnQgY2xhc3MgQ29tcHV0ZVBvbGljeVN0YXRzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImNvbXB1dGVfcG9saWN5X3N0YXRzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIG51bWJlck9mUnVucyA9IHBhcmFtcy52YWx1ZShcIm51bWJlck9mUnVuc1wiKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgbGV0IHJ1bGUgPSB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5ydWxlQnlOYW1lW3J1bGVOYW1lXTtcblxuXG4gICAgICAgIHZhciBwYXlvZmZzUGVyUG9saWN5ID0gam9iUmVzdWx0LmRhdGEucG9saWNpZXMubWFwKCgpPT5bXSk7XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5mb3JFYWNoKHJvdz0+IHtcbiAgICAgICAgICAgIHBheW9mZnNQZXJQb2xpY3lbcm93LnBvbGljeUluZGV4XS5wdXNoKFV0aWxzLmlzU3RyaW5nKHJvdy5wYXlvZmYpID8gMCA6IHJvdy5wYXlvZmYpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxvZy5kZWJ1ZygncGF5b2Zmc1BlclBvbGljeScsIHBheW9mZnNQZXJQb2xpY3ksIGpvYlJlc3VsdC5kYXRhLnJvd3MubGVuZ3RoLCBydWxlLm1heGltaXphdGlvbik7XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEubWVkaWFucyA9IHBheW9mZnNQZXJQb2xpY3kubWFwKHBheW9mZnM9PkV4cHJlc3Npb25FbmdpbmUubWVkaWFuKHBheW9mZnMpKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEuc3RhbmRhcmREZXZpYXRpb25zID0gcGF5b2Zmc1BlclBvbGljeS5tYXAocGF5b2Zmcz0+RXhwcmVzc2lvbkVuZ2luZS5zdGQocGF5b2ZmcykpO1xuXG4gICAgICAgIGlmIChydWxlLm1heGltaXphdGlvbikge1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5SXNCZXN0UHJvYmFiaWxpdGllcyA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUodiwgbnVtYmVyT2ZSdW5zKSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5SXNCZXN0UHJvYmFiaWxpdGllcyA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLmRpdmlkZSh2LCBudW1iZXJPZlJ1bnMpKSk7XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudCA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodikpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50ID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpKTtcblxuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuLi8uLi9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbn0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9leGNlcHRpb25zL2pvYi1jb21wdXRhdGlvbi1leGNlcHRpb25cIjtcblxuZXhwb3J0IGNsYXNzIFByb2JDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQ2FsY3VsYXRlU3RlcCB7XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuXG4gICAgICAgIGlmKCFqb2JSZXN1bHQuZGF0YS5yb3dzKXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MgPSBbXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMgPSB2YXJpYWJsZU5hbWVzO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50ID0gVXRpbHMuZmlsbChuZXcgQXJyYXkoam9iUmVzdWx0LmRhdGEucG9saWNpZXMubGVuZ3RoKSwgMCk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50ID0gVXRpbHMuZmlsbChuZXcgQXJyYXkoam9iUmVzdWx0LmRhdGEucG9saWNpZXMubGVuZ3RoKSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgIH1cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgZm9yKHZhciBydW5JbmRleD0wOyBydW5JbmRleDxjaHVua1NpemU7IHJ1bkluZGV4Kyspe1xuICAgICAgICAgICAgdmFyIHNpbmdsZVJ1blZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgICAgICB2YXIgZXJyb3JzID0gW107XG4gICAgICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGV2YWx1YXRlZCA9IHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKHYuZm9ybXVsYSwgdHJ1ZSwgVXRpbHMuY2xvbmVEZWVwKGRhdGEuZXhwcmVzc2lvblNjb3BlKSk7XG4gICAgICAgICAgICAgICAgICAgIHNpbmdsZVJ1blZhcmlhYmxlVmFsdWVzLnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KGV2YWx1YXRlZCkpO1xuICAgICAgICAgICAgICAgIH1jYXRjaChlKXtcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyaWFibGU6IHYsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogZVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYoZXJyb3JzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBlcnJvckRhdGEgPSB7dmFyaWFibGVzOiBbXX07XG4gICAgICAgICAgICAgICAgZXJyb3JzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgICAgICBlcnJvckRhdGEudmFyaWFibGVzW2UudmFyaWFibGUubmFtZV0gPSBlLmVycm9yLm1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uKFwicGFyYW0tY29tcHV0YXRpb25cIiwgZXJyb3JEYXRhKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXMucHVzaChzaW5nbGVSdW5WYXJpYWJsZVZhbHVlcylcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcztcbiAgICB9XG5cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHIgPSBzdXBlci5wcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBqb2JSZXN1bHQpO1xuXG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIG51bWJlck9mUnVucyA9IHBhcmFtcy52YWx1ZShcIm51bWJlck9mUnVuc1wiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgdGhpcy51cGRhdGVQb2xpY3lTdGF0cyhyLCBwb2xpY2llcywgbnVtYmVyT2ZSdW5zLCBqb2JSZXN1bHQpO1xuXG4gICAgICAgIHJldHVybiByO1xuICAgIH1cblxuICAgIHVwZGF0ZVBvbGljeVN0YXRzKHIsIHBvbGljaWVzLCBudW1iZXJPZlJ1bnMsIGpvYlJlc3VsdCl7XG4gICAgICAgIHZhciBoaWdoZXN0UGF5b2ZmID0gLUluZmluaXR5O1xuICAgICAgICB2YXIgbG93ZXN0UGF5b2ZmID0gSW5maW5pdHk7XG4gICAgICAgIHZhciBiZXN0UG9saWN5SW5kZXhlcyA9IFtdO1xuICAgICAgICB2YXIgd29yc3RQb2xpY3lJbmRleGVzID0gW107XG5cbiAgICAgICAgdmFyIHplcm9OdW0gPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuXG4gICAgICAgIHBvbGljaWVzLmZvckVhY2goKHBvbGljeSxpKT0+e1xuICAgICAgICAgICAgbGV0IHBheW9mZiA9IHIucGF5b2Zmc1tpXTtcbiAgICAgICAgICAgIGlmKFV0aWxzLmlzU3RyaW5nKHBheW9mZikpe1xuICAgICAgICAgICAgICAgIHBheW9mZiA9IHplcm9OdW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihwYXlvZmYgPCBsb3dlc3RQYXlvZmYpe1xuICAgICAgICAgICAgICAgIGxvd2VzdFBheW9mZiA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMgPSBbaV07XG4gICAgICAgICAgICB9ZWxzZSBpZihwYXlvZmYuZXF1YWxzKGxvd2VzdFBheW9mZikpe1xuICAgICAgICAgICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcy5wdXNoKGkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihwYXlvZmYgPiBoaWdoZXN0UGF5b2ZmKXtcbiAgICAgICAgICAgICAgICBoaWdoZXN0UGF5b2ZmID0gcGF5b2ZmO1xuICAgICAgICAgICAgICAgIGJlc3RQb2xpY3lJbmRleGVzID0gW2ldXG4gICAgICAgICAgICB9ZWxzZSBpZihwYXlvZmYuZXF1YWxzKGhpZ2hlc3RQYXlvZmYpKXtcbiAgICAgICAgICAgICAgICBiZXN0UG9saWN5SW5kZXhlcy5wdXNoKGkpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzW2ldID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXNbaV0sIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHBheW9mZiwgbnVtYmVyT2ZSdW5zKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGJlc3RQb2xpY3lJbmRleGVzLmZvckVhY2gocG9saWN5SW5kZXg9PntcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgYmVzdFBvbGljeUluZGV4ZXMubGVuZ3RoKSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzLmZvckVhY2gocG9saWN5SW5kZXg9PntcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0sIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIHdvcnN0UG9saWN5SW5kZXhlcy5sZW5ndGgpKVxuICAgICAgICB9KTtcbiAgICB9XG5cblxuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzLm1hcCh2PT50aGlzLnRvRmxvYXQodikpO1xuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuXG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIEJhdGNoU3RlcCB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSwgMSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYkV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVWYWx1ZXNcIik7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcblxuICAgICAgICB2YXIgZGVmYXVsdFZhbHVlcyA9IHt9O1xuICAgICAgICBVdGlscy5mb3JPd24oZGF0YS5leHByZXNzaW9uU2NvcGUsICh2LGspPT57XG4gICAgICAgICAgICBkZWZhdWx0VmFsdWVzW2tdPXRoaXMudG9GbG9hdCh2KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhKXtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3knXTtcbiAgICAgICAgICAgIHZhcmlhYmxlTmFtZXMuZm9yRWFjaChuPT5oZWFkZXJzLnB1c2gobikpO1xuICAgICAgICAgICAgaGVhZGVycy5wdXNoKCdwYXlvZmYnKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhID0ge1xuICAgICAgICAgICAgICAgIGhlYWRlcnM6aGVhZGVycyxcbiAgICAgICAgICAgICAgICByb3dzOiBbXSxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZU5hbWVzOiB2YXJpYWJsZU5hbWVzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXM6IGRlZmF1bHRWYWx1ZXMsXG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IGpvYkV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwicG9saWNpZXNcIilcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMubGVuZ3RoO1xuICAgIH1cblxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUpIHtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwidmFyaWFibGVWYWx1ZXNcIik7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBpdGVtSW5kZXgpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZU5hbWVzXCIpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lID0gdmFyaWFibGVOYW1lc1tpdGVtSW5kZXhdO1xuXG5cblxuICAgICAgICB2YXIgcmVzdWx0cyA9IFtdXG5cbiAgICAgICAgaXRlbS5mb3JFYWNoKHZhcmlhYmxlVmFsdWU9PntcblxuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG5cbiAgICAgICAgICAgIGRhdGEuZXhwcmVzc2lvblNjb3BlW3ZhcmlhYmxlTmFtZV0gPSB2YXJpYWJsZVZhbHVlO1xuXG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgdHJlZVJvb3QpO1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcbiAgICAgICAgICAgIHZhciB2YWxpZCA9IHZyLmlzVmFsaWQoKTtcblxuICAgICAgICAgICAgaWYoIXZhbGlkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlKTtcbiAgICAgICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCwgcnVsZU5hbWUpO1xuICAgICAgICAgICAgdmFyIHBvbGljaWVzID0gcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXM7XG5cbiAgICAgICAgICAgIHZhciBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJyk7XG5cblxuICAgICAgICAgICAgdmFyIHIgPSB7XG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlTmFtZTogdmFyaWFibGVOYW1lLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlSW5kZXg6IGl0ZW1JbmRleCxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZVZhbHVlOiB2YXJpYWJsZVZhbHVlLFxuICAgICAgICAgICAgICAgIHBheW9mZjogcGF5b2ZmXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHIpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuXG4gICAgfVxuXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcblxuICAgICAgICB2YXIgcG9saWN5QnlLZXkgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY3lCeUtleVwiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtc1dyYXBwZXI9PntcbiAgICAgICAgICAgIGlmKCFpdGVtc1dyYXBwZXIpe1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaXRlbXNXcmFwcGVyLmZvckVhY2goaXRlbT0+e1xuICAgICAgICAgICAgICAgIGl0ZW0ucG9saWNpZXMuZm9yRWFjaCgocG9saWN5KT0+e1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5KV07XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMuZm9yRWFjaCgodik9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciB2YWx1ZSA9IFwiZGVmYXVsdFwiO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYodiA9PSBpdGVtLnZhcmlhYmxlTmFtZSl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSB0aGlzLnRvRmxvYXQoaXRlbS52YXJpYWJsZVZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1lbHNlIGlmKGpvYlJlc3VsdC5kYXRhLmRlZmF1bHRWYWx1ZXMuaGFzT3duUHJvcGVydHkodikpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlID0gam9iUmVzdWx0LmRhdGEuZGVmYXVsdFZhbHVlc1t2XTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJvd0NlbGxzLnB1c2godmFsdWUpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gaXRlbS5wYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgIHJvd0NlbGxzLnB1c2goVXRpbHMuaXNTdHJpbmcocGF5b2ZmKT8gcGF5b2ZmOiB0aGlzLnRvRmxvYXQocGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciByb3cgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjZWxsczogcm93Q2VsbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBwb2xpY3lJbmRleDogcG9saWNpZXMuaW5kZXhPZihwb2xpY3lCeUtleVtwb2xpY3kua2V5XSksXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaChyb3cpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodil7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEluaXRQb2xpY2llc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiaW5pdF9wb2xpY2llc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY2llc1wiLCBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcyk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljeUJ5S2V5XCIsIFV0aWxzLmdldE9iamVjdEJ5SWRNYXAocG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXMsIG51bGwsICdrZXknKSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuXG5leHBvcnQgY2xhc3MgUHJlcGFyZVZhcmlhYmxlc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwicHJlcGFyZV92YXJpYWJsZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuXG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXMucHVzaCh0aGlzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHZhcmlhYmxlVmFsdWVzID0gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwidmFyaWFibGVWYWx1ZXNcIiwgdmFyaWFibGVWYWx1ZXMpO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBzZXF1ZW5jZShtaW4sIG1heCwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBleHRlbnQgPSBtYXggLSBtaW47XG4gICAgICAgIHZhciBzdGVwID0gZXh0ZW50IC8gKGxlbmd0aCAtIDEpO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW21pbl07XG4gICAgICAgIHZhciBjdXJyID0gbWluO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoIC0gMjsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyICs9IHN0ZXA7XG5cbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLnJvdW5kKGN1cnIsIDE2KSkpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdC5wdXNoKG1heCk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDApLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDw9IHZbXCJtYXhcIl0sXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7UHJlcGFyZVZhcmlhYmxlc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXBcIjtcbmltcG9ydCB7SW5pdFBvbGljaWVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge1Rvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vdG9ybmFkby1kaWFncmFtLWpvYi1wYXJhbWV0ZXJzXCI7XG5cbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwidG9ybmFkby1kaWFncmFtXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKGpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKGpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDYWxjdWxhdGVTdGVwKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFRvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1syXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMl0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uL3N0ZXBcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcblxuLypqb2Igc3RlcCB0aGF0IHByb2Nlc3MgYmF0Y2ggb2YgaXRlbXMqL1xuZXhwb3J0IGNsYXNzIEJhdGNoU3RlcCBleHRlbmRzIFN0ZXAge1xuXG4gICAgY2h1bmtTaXplO1xuICAgIHN0YXRpYyBDVVJSRU5UX0lURU1fQ09VTlRfUFJPUCA9ICdiYXRjaF9zdGVwX2N1cnJlbnRfaXRlbV9jb3VudCc7XG4gICAgc3RhdGljIFRPVEFMX0lURU1fQ09VTlRfUFJPUCA9ICdiYXRjaF9zdGVwX3RvdGFsX2l0ZW1fY291bnQnO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgY2h1bmtTaXplKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmNodW5rU2l6ZSA9IGNodW5rU2l6ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcGVyZm9ybSBzdGVwIGluaXRpYWxpemF0aW9uLiBTaG91bGQgcmV0dXJuIHRvdGFsIGl0ZW0gY291bnRcbiAgICAgKi9cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5pbml0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHJlYWQgYW5kIHJldHVybiBjaHVuayBvZiBpdGVtcyB0byBwcm9jZXNzXG4gICAgICovXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5yZWFkTmV4dENodW5rIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb2Nlc3Mgc2luZ2xlIGl0ZW1cbiAgICAgKiBNdXN0IHJldHVybiBwcm9jZXNzZWQgaXRlbSB3aGljaCB3aWxsIGJlIHBhc3NlZCBpbiBhIGNodW5rIHRvIHdyaXRlQ2h1bmsgZnVuY3Rpb25cbiAgICAgKi9cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAucHJvY2Vzc0l0ZW0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gd3JpdGUgY2h1bmsgb2YgaXRlbXMuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHBvc3Rwcm9jZXNzaW5nIGFmdGVyIGFsbCBpdGVtcyBoYXZlIGJlZW4gcHJvY2Vzc2VkLiBOb3QgcmVxdWlyZWRcbiAgICAgKi9cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cblxuICAgIHNldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLlRPVEFMX0lURU1fQ09VTlRfUFJPUCwgY291bnQpO1xuICAgIH1cblxuICAgIGdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoQmF0Y2hTdGVwLlRPVEFMX0lURU1fQ09VTlRfUFJPUCk7XG4gICAgfVxuXG4gICAgc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjb3VudCkge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCwgY291bnQpO1xuICAgIH1cblxuICAgIGdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1ApIHx8IDA7XG4gICAgfVxuXG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gaW5pdGlhbGl6ZSBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KS50aGVuKHRvdGFsSXRlbUNvdW50PT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIHRvdGFsSXRlbUNvdW50KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBpZighKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikpe1xuICAgICAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gaGFuZGxlIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHBvc3RQcm9jZXNzIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBoYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBjdXJyZW50SXRlbUNvdW50ID0gdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB2YXIgdG90YWxJdGVtQ291bnQgPSB0aGlzLmdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB2YXIgY2h1bmtTaXplID0gTWF0aC5taW4odGhpcy5jaHVua1NpemUsIHRvdGFsSXRlbUNvdW50IC0gY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgIGlmIChjdXJyZW50SXRlbUNvdW50ID49IHRvdGFsSXRlbUNvdW50KSB7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0pvYkV4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiBzb21lb25lIGlzIHRyeWluZyB0byBzdG9wIHVzXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi50ZXJtaW5hdGVPbmx5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byByZWFkIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KS50aGVuKGNodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgY2h1bmssIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHByb2Nlc3MgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbihwcm9jZXNzZWRDaHVuaz0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBwcm9jZXNzZWRDaHVuaywgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gd3JpdGUgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigocmVzKT0+IHtcbiAgICAgICAgICAgIGN1cnJlbnRJdGVtQ291bnQgKz0gY2h1bmtTaXplO1xuICAgICAgICAgICAgdGhpcy5zZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGN1cnJlbnRJdGVtQ291bnQpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7IC8vVE9ETyBwcm9taXNpZnlcbiAgICAgICAgcmV0dXJuIGNodW5rLm1hcCgoaXRlbSwgaSk9PnRoaXMucHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCtpLCBqb2JSZXN1bHQpKTtcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiksXG4gICAgICAgICAgICBjdXJyZW50OiB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZUpvYlByb2dyZXNzKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHByb2dyZXNzID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKS5nZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQsIHByb2dyZXNzKTtcbiAgICB9XG5cbiAgICBjaGVja0pvYkV4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKS5jaGVja0V4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICB9XG59XG4iLCJleHBvcnQgY2xhc3MgRXh0ZW5kYWJsZUVycm9yIHtcbiAgICBkYXRhO1xuICAgIGNvbnN0cnVjdG9yKG1lc3NhZ2UsIGRhdGEpIHtcbiAgICAgICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5uYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vZXh0ZW5kYWJsZS1lcnJvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlLWFscmVhZHktY29tcGxldGUtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXJlc3RhcnQtZXhjZXB0aW9uJ1xuXG5cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUmVzdGFydEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEV4ZWN1dGlvbkNvbnRleHQge1xuXG4gICAgZGlydHkgPSBmYWxzZTtcbiAgICBjb250ZXh0ID0ge307XG5cbiAgICBjb25zdHJ1Y3Rvcihjb250ZXh0KSB7XG4gICAgICAgIGlmIChjb250ZXh0KSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRleHQgPSBVdGlscy5jbG9uZShjb250ZXh0KVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHV0KGtleSwgdmFsdWUpIHtcbiAgICAgICAgdmFyIHByZXZWYWx1ZSA9IHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IHRoaXMuY29udGV4dFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlID09IG51bGwgfHwgcHJldlZhbHVlICE9IG51bGwgJiYgcHJldlZhbHVlICE9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICAgICAgdGhpcy5kaXJ0eSA9IHByZXZWYWx1ZSAhPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb250ZXh0W2tleV07XG4gICAgfVxuXG4gICAgY29udGFpbnNLZXkoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoa2V5KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBzZXREYXRhKGRhdGEpIHsgLy9zZXQgZGF0YSBtb2RlbFxuICAgICAgICByZXR1cm4gdGhpcy5wdXQoXCJkYXRhXCIsIGRhdGEpO1xuICAgIH1cblxuICAgIGdldERhdGEoKSB7IC8vIGdldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLmdldChcImRhdGFcIik7XG4gICAgfVxuXG4gICAgZ2V0RFRPKCkge1xuICAgICAgICB2YXIgZHRvID0gVXRpbHMuY2xvbmVEZWVwKHRoaXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHRoaXMuZ2V0RGF0YSgpO1xuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgZGF0YSA9IGRhdGEuZ2V0RFRPKCk7XG4gICAgICAgICAgICBkdG8uY29udGV4dFtcImRhdGFcIl0gPSBkYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG59XG4iLCJpbXBvcnQgKiBhcyBleGNlcHRpb25zIGZyb20gJy4vZXhjZXB0aW9ucydcblxuZXhwb3J0IHtleGNlcHRpb25zfVxuZXhwb3J0ICogZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCdcbmV4cG9ydCAqIGZyb20gJy4vam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWZsYWcnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tbGlzdGVuZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnN0YW5jZSdcbmV4cG9ydCAqIGZyb20gJy4vam9iLWtleS1nZW5lcmF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1sYXVuY2hlcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlci1kZWZpbml0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycydcbmV4cG9ydCAqIGZyb20gJy4vam9iLXN0YXR1cydcbmV4cG9ydCAqIGZyb20gJy4vc2ltcGxlLWpvYidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcCdcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyJ1xuXG5cblxuXG4iLCJleHBvcnQgY29uc3QgSk9CX0VYRUNVVElPTl9GTEFHID0ge1xuICAgIFNUT1A6ICdTVE9QJ1xufTtcbiIsImV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG4gICAgLypDYWxsZWQgYmVmb3JlIGEgam9iIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgam9iLiBDYWxsZWQgYWZ0ZXIgYm90aCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgZXhlY3V0aW9ucyovXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBleGVjdXRpb24gb2YgYSBqb2IuKi9cbmV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb24ge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGpvYlBhcmFtZXRlcnM7XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLlVOS05PV047XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG5cbiAgICBzdGFydFRpbWUgPSBudWxsO1xuICAgIGNyZWF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycywgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVycyA9IGpvYlBhcmFtZXRlcnM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBzdGVwIGV4ZWN1dGlvbiB3aXRoIHRoZSBjdXJyZW50IGpvYiBleGVjdXRpb24uXG4gICAgICogQHBhcmFtIHN0ZXBOYW1lIHRoZSBuYW1lIG9mIHRoZSBzdGVwIHRoZSBuZXcgZXhlY3V0aW9uIGlzIGFzc29jaWF0ZWQgd2l0aFxuICAgICAqL1xuICAgIGNyZWF0ZVN0ZXBFeGVjdXRpb24oc3RlcE5hbWUpIHtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb24gPSBuZXcgU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSwgdGhpcyk7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgaXNSdW5uaW5nKCkge1xuICAgICAgICByZXR1cm4gIXRoaXMuZW5kVGltZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXN0IGlmIHRoaXMgSm9iRXhlY3V0aW9uIGhhcyBiZWVuIHNpZ25hbGxlZCB0b1xuICAgICAqIHN0b3AuXG4gICAgICovXG4gICAgaXNTdG9wcGluZygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNpZ25hbCB0aGUgSm9iRXhlY3V0aW9uIHRvIHN0b3AuXG4gICAgICovXG4gICAgc3RvcCgpIHtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHNlPT4ge1xuICAgICAgICAgICAgc2UudGVybWluYXRlT25seSA9IHRydWU7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgfVxuXG4gICAgZ2V0RFRPKGZpbHRlcmVkUHJvcGVydGllcyA9IFtdLCBkZWVwQ2xvbmUgPSB0cnVlKSB7XG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmICghZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJlZFByb3BlcnRpZXMuaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKFtcImpvYlBhcmFtZXRlcnNcIiwgXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBVdGlscy5nZXRFcnJvckRUTyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCIvKiBvYmplY3QgcmVwcmVzZW50aW5nIGEgdW5pcXVlbHkgaWRlbnRpZmlhYmxlIGpvYiBydW4uIEpvYkluc3RhbmNlIGNhbiBiZSByZXN0YXJ0ZWQgbXVsdGlwbGUgdGltZXMgaW4gY2FzZSBvZiBleGVjdXRpb24gZmFpbHVyZSBhbmQgaXQncyBsaWZlY3ljbGUgZW5kcyB3aXRoIGZpcnN0IHN1Y2Nlc3NmdWwgZXhlY3V0aW9uKi9cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZXtcblxuICAgIGlkO1xuICAgIGpvYk5hbWU7XG4gICAgY29uc3RydWN0b3IoaWQsIGpvYk5hbWUpe1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMuam9iTmFtZSA9IGpvYk5hbWU7XG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBKb2JLZXlHZW5lcmF0b3Ige1xuICAgIC8qTWV0aG9kIHRvIGdlbmVyYXRlIHRoZSB1bmlxdWUga2V5IHVzZWQgdG8gaWRlbnRpZnkgYSBqb2IgaW5zdGFuY2UuKi9cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0gXCJcIjtcbiAgICAgICAgam9iUGFyYW1ldGVycy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcbiAgICAgICAgICAgIGlmKGQuaWRlbnRpZnlpbmcpe1xuICAgICAgICAgICAgICAgIHJlc3VsdCArPSBkLm5hbWUgKyBcIj1cIiArIGpvYlBhcmFtZXRlcnMudmFsdWVzW2QubmFtZV0gKyBcIjtcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgSm9iTGF1bmNoZXIge1xuXG4gICAgam9iUmVwb3NpdG9yeTtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBqb2JXb3JrZXIsIGRhdGFNb2RlbFNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBqb2JXb3JrZXI7XG4gICAgICAgIHRoaXMuZGF0YU1vZGVsU2VyaWFsaXplciA9IGRhdGFNb2RlbFNlcmlhbGl6ZXI7XG4gICAgfVxuXG5cbiAgICBydW4oam9iT3JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgdmFyIGpvYjtcbiAgICAgICAgdmFyIGpvYlBhcmFtZXRlcnM7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAoVXRpbHMuaXNTdHJpbmcoam9iT3JOYW1lKSkge1xuICAgICAgICAgICAgICAgIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iT3JOYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBqb2IgPSBqb2JPck5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iT3JOYW1lKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpO1xuICAgICAgICB9KS50aGVuKHZhbGlkPT57XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmNyZWF0ZUpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycywgZGF0YSkudGhlbihqb2JFeGVjdXRpb249PntcblxuXG4gICAgICAgICAgICAgICAgaWYodGhpcy5qb2JXb3JrZXIpe1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2I6IFtcIiArIGpvYi5uYW1lICsgXCJdIGV4ZWN1dGlvbiBbXCIram9iRXhlY3V0aW9uLmlkK1wiXSBkZWxlZ2F0ZWQgdG8gd29ya2VyXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYldvcmtlci5leGVjdXRlSm9iKGpvYkV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvblByb21pc2UgPSB0aGlzLl9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICBpZihyZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Qcm9taXNlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iLm5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4obGFzdEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGxhc3RFeGVjdXRpb24gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGlmICgham9iLmlzUmVzdGFydGFibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgbm90IHJlc3RhcnRhYmxlXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGxhc3RFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuVU5LTk9XTikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJTdGVwIFtcIiArIGV4ZWN1dGlvbi5zdGVwTmFtZSArIFwiXSBpcyBvZiBzdGF0dXMgVU5LTk9XTlwiKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICFqb2Iuam9iUGFyYW1ldGVyc1ZhbGlkYXRvci52YWxpZGF0ZShqb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihqb2Iuam9iRGF0YVZhbGlkYXRvciAmJiAham9iLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZGF0YSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICAvKipFeGVjdXRlIHByZXZpb3VzbHkgY3JlYXRlZCBqb2IgZXhlY3V0aW9uKi9cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpe1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICBpZihVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIH0pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZigham9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb25PcklkICsgXCJdIGlzIG5vdCBmb3VuZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuU1RBUlRJTkcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb24uaWQgKyBcIl0gYWxyZWFkeSBzdGFydGVkXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgam9iTmFtZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lO1xuICAgICAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgICAgICBpZigham9iKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIk5vIHN1Y2ggam9iOiBcIiArIGpvYk5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gIHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIF9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGpvYk5hbWUgPSBqb2IubmFtZTtcbiAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gbGF1bmNoZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpO1xuICAgICAgICByZXR1cm4gam9iLmV4ZWN1dGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gY29tcGxldGVkIHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXSBhbmQgdGhlIGZvbGxvd2luZyBzdGF0dXM6IFtcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIl1cIik7XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICB9KS5jYXRjaChlID0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGZhaWxlZCB1bmV4cGVjdGVkbHkgYW5kIGZhdGFsbHkgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjb25zdCBQQVJBTUVURVJfVFlQRSA9IHtcbiAgICBTVFJJTkc6ICdTVFJJTkcnLFxuICAgIERBVEU6ICdEQVRFJyxcbiAgICBJTlRFR0VSOiAnSU5URUdFUicsXG4gICAgTlVNQkVSOiAnRkxPQVQnLFxuICAgIEJPT0xFQU46ICdCT09MRUFOJyxcbiAgICBOVU1CRVJfRVhQUkVTU0lPTjogJ05VTUJFUl9FWFBSRVNTSU9OJyxcbiAgICBDT01QT1NJVEU6ICdDT01QT1NJVEUnIC8vY29tcG9zaXRlIHBhcmFtZXRlciB3aXRoIG5lc3RlZCBzdWJwYXJhbWV0ZXJzXG59O1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbiB7XG4gICAgbmFtZTtcbiAgICB0eXBlO1xuICAgIG5lc3RlZFBhcmFtZXRlcnMgPSBbXTtcbiAgICBtaW5PY2N1cnM7XG4gICAgbWF4T2NjdXJzO1xuICAgIHJlcXVpcmVkID0gdHJ1ZTtcblxuICAgIGlkZW50aWZ5aW5nO1xuICAgIHZhbGlkYXRvcjtcbiAgICBzaW5nbGVWYWx1ZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucywgbWluT2NjdXJzID0gMSwgbWF4T2NjdXJzID0gMSwgaWRlbnRpZnlpbmcgPSBmYWxzZSwgc2luZ2xlVmFsdWVWYWxpZGF0b3IgPSBudWxsLCB2YWxpZGF0b3IgPSBudWxsKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIGlmIChVdGlscy5pc0FycmF5KHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucykpIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURTtcbiAgICAgICAgICAgIHRoaXMubmVzdGVkUGFyYW1ldGVycyA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnZhbGlkYXRvciA9IHZhbGlkYXRvcjtcbiAgICAgICAgdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvciA9IHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuICAgICAgICB0aGlzLmlkZW50aWZ5aW5nID0gaWRlbnRpZnlpbmc7XG4gICAgICAgIHRoaXMubWluT2NjdXJzID0gbWluT2NjdXJzO1xuICAgICAgICB0aGlzLm1heE9jY3VycyA9IG1heE9jY3VycztcbiAgICB9XG5cbiAgICBzZXQoa2V5LCB2YWwpIHtcbiAgICAgICAgdGhpc1trZXldID0gdmFsO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSwgYWxsVmFsdWVzKSB7XG4gICAgICAgIHZhciBpc0FycmF5ID0gVXRpbHMuaXNBcnJheSh2YWx1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMubWF4T2NjdXJzID4gMSAmJiAhaXNBcnJheSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVNpbmdsZVZhbHVlKHZhbHVlLCBhbGxWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUubGVuZ3RoIDwgdGhpcy5taW5PY2N1cnMgfHwgdmFsdWUubGVuZ3RoID4gdGhpcy5tYXhPY2N1cnMpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdmFsdWUuZXZlcnkodj0+dGhpcy52YWxpZGF0ZVNpbmdsZVZhbHVlKHYsIHZhbHVlKSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnZhbGlkYXRvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yKHZhbHVlLCBhbGxWYWx1ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgc3RhdGljIGNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbCl7XG4gICAgICAgIGxldCBwYXJzZWQgPSBwYXJzZUZsb2F0KHZhbCk7XG4gICAgICAgIGlmKHBhcnNlZCA9PT0gSW5maW5pdHkgfHwgcGFyc2VkID09PSAtSW5maW5pdHkpIHtcbiAgICAgICAgICAgIHJldHVybiBwYXJzZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZighRXhwcmVzc2lvbkVuZ2luZS52YWxpZGF0ZSh2YWwsIHt9LCBmYWxzZSkpe1xuICAgICAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmV2YWwodmFsLCB0cnVlKVxuICAgIH1cblxuICAgIC8vIGFsbFZhbHVlcyAtIGFsbCB2YWx1ZXMgb24gdGhlIHNhbWUgbGV2ZWxcbiAgICB2YWxpZGF0ZVNpbmdsZVZhbHVlKHZhbHVlLCBhbGxWYWx1ZXMpIHtcblxuICAgICAgICBpZiAoKCF2YWx1ZSAmJiB2YWx1ZSAhPT0gMCAmJiB2YWx1ZSAhPT0gZmFsc2UpICYmIHRoaXMubWluT2NjdXJzID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICF0aGlzLnJlcXVpcmVkXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuU1RSSU5HID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzU3RyaW5nKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5EQVRFID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuSU5URUdFUiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0ludCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuTlVNQkVSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzTnVtYmVyKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4gPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNCb29sZWFuKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04gPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgdmFsdWUgPSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbHVlKTtcbiAgICAgICAgICAgIGlmKHZhbHVlID09PSBudWxsKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5DT01QT1NJVEUgPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgaWYgKCFVdGlscy5pc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMubmVzdGVkUGFyYW1ldGVycy5ldmVyeSgobmVzdGVkRGVmLCBpKT0+bmVzdGVkRGVmLnZhbGlkYXRlKHZhbHVlW25lc3RlZERlZi5uYW1lXSkpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKHZhbHVlLCBhbGxWYWx1ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdmFsdWUodmFsdWUpe1xuICAgICAgICBpZihQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTiA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbih2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4vam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlcnN7XG4gICAgZGVmaW5pdGlvbnMgPSBbXTtcbiAgICB2YWx1ZXM9e307XG5cbiAgICBjb25zdHJ1Y3Rvcih2YWx1ZXMpe1xuICAgICAgICB0aGlzLmluaXREZWZpbml0aW9ucygpO1xuICAgICAgICB0aGlzLmluaXREZWZhdWx0VmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcy52YWx1ZXMsIHZhbHVlcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKXtcblxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCl7XG5cbiAgICB9XG5cbiAgICB2YWxpZGF0ZSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5kZWZpbml0aW9ucy5ldmVyeSgoZGVmLCBpKT0+ZGVmLnZhbGlkYXRlKHRoaXMudmFsdWVzW2RlZi5uYW1lXSwgdGhpcy52YWx1ZXMpKTtcbiAgICB9XG5cbiAgICBnZXREZWZpbml0aW9uKHBhdGgpe1xuICAgICAgICB2YXIgZGVmcyA9dGhpcy5kZWZpbml0aW9ucztcbiAgICAgICAgbGV0IGRlZiA9IG51bGw7XG4gICAgICAgIGlmKCFwYXRoLnNwbGl0KCkuZXZlcnkobmFtZT0+e1xuICAgICAgICAgICAgICAgIGRlZiA9IFV0aWxzLmZpbmQoZGVmcywgZD0+ZC5uYW1lID09IG5hbWUpO1xuICAgICAgICAgICAgICAgIGlmKCFkZWYpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmcyA9IGRlZi5uZXN0ZWRQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KSl7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVmO1xuICAgIH1cblxuICAgIC8qZ2V0IG9yIHNldCB2YWx1ZSBieSBwYXRoKi9cbiAgICB2YWx1ZShwYXRoLCB2YWx1ZSl7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICBsZXQgZGVmID0gdGhpcy5nZXREZWZpbml0aW9uKHBhdGgpO1xuICAgICAgICAgICAgbGV0IHZhbCA9IFV0aWxzLmdldCh0aGlzLnZhbHVlcywgcGF0aCwgbnVsbCk7XG4gICAgICAgICAgICBpZihkZWYpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWYudmFsdWUodmFsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiAgdmFsO1xuICAgICAgICB9XG4gICAgICAgIFV0aWxzLnNldCh0aGlzLnZhbHVlcywgcGF0aCwgdmFsdWUpO1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFwiSm9iUGFyYW1ldGVyc1tcIjtcblxuICAgICAgICB0aGlzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuXG4gICAgICAgICAgICB2YXIgdmFsID0gdGhpcy52YWx1ZXNbZC5uYW1lXTtcbiAgICAgICAgICAgIC8vIGlmKFV0aWxzLmlzQXJyYXkodmFsKSl7XG4gICAgICAgICAgICAvLyAgICAgdmFyIHZhbHVlcyA9IHZhbDtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgLy8gaWYoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09IGQudHlwZSl7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICByZXN1bHQgKz0gZC5uYW1lICsgXCI9XCIrdmFsICsgXCI7XCI7XG4gICAgICAgIH0pO1xuICAgICAgICByZXN1bHQrPVwiXVwiO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGdldERUTygpe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsdWVzOiB0aGlzLnZhbHVlc1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtkZWZhdWx0IGFzIGlkYn0gZnJvbSBcImlkYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4uL2pvYi1leGVjdXRpb25cIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKiBJbmRleGVkREIgam9iIHJlcG9zaXRvcnkqL1xuZXhwb3J0IGNsYXNzIElkYkpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGRiUHJvbWlzZTtcbiAgICBqb2JJbnN0YW5jZURhbztcbiAgICBqb2JFeGVjdXRpb25EYW87XG4gICAgc3RlcEV4ZWN1dGlvbkRhbztcbiAgICBqb2JSZXN1bHREYW87XG4gICAgam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW87XG4gICAgam9iRXhlY3V0aW9uRmxhZ0RhbztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zUmV2aXZlciwgZGJOYW1lID0gJ3NkLWpvYi1yZXBvc2l0b3J5JywgZGVsZXRlREIgPSBmYWxzZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmRiTmFtZSA9IGRiTmFtZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc1Jldml2ZXIgPSBleHByZXNzaW9uc1Jldml2ZXI7XG4gICAgICAgIGlmIChkZWxldGVEQikge1xuICAgICAgICAgICAgdGhpcy5kZWxldGVEQigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbml0REIoKVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5pbml0REIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmluaXREQigpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0REIoKSB7XG4gICAgICAgIHRoaXMuZGJQcm9taXNlID0gaWRiLm9wZW4odGhpcy5kYk5hbWUsIDIsIHVwZ3JhZGVEQiA9PiB7XG4gICAgICAgICAgICAvLyBOb3RlOiB3ZSBkb24ndCB1c2UgJ2JyZWFrJyBpbiB0aGlzIHN3aXRjaCBzdGF0ZW1lbnQsXG4gICAgICAgICAgICAvLyB0aGUgZmFsbC10aHJvdWdoIGJlaGF2aW91ciBpcyB3aGF0IHdlIHdhbnQuXG4gICAgICAgICAgICBzd2l0Y2ggKHVwZ3JhZGVEQi5vbGRWZXJzaW9uKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAwOlxuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1pbnN0YW5jZXMnKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbnNPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBcImpvYkluc3RhbmNlLmlkXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImNyZWF0ZVRpbWVcIiwgXCJjcmVhdGVUaW1lXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcInN0YXR1c1wiLCBcInN0YXR1c1wiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnKTtcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9uLWZsYWdzJyk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdzdGVwLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkV4ZWN1dGlvbklkXCIsIFwiam9iRXhlY3V0aW9uSWRcIiwge3VuaXF1ZTogZmFsc2V9KTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgam9iUmVzdWx0T1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1yZXN1bHRzJyk7XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdE9TLmNyZWF0ZUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBcImpvYkluc3RhbmNlLmlkXCIsIHt1bmlxdWU6IHRydWV9KTtcbiAgICAgICAgICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi50cmFuc2FjdGlvbi5vYmplY3RTdG9yZSgnam9iLWluc3RhbmNlcycpLmNyZWF0ZUluZGV4KFwiaWRcIiwgXCJpZFwiLCB7dW5pcXVlOiB0cnVlfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZURhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWluc3RhbmNlcycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb25zJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tZmxhZ3MnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbkRhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnc3RlcC1leGVjdXRpb25zJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYlJlc3VsdERhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLXJlc3VsdHMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgfVxuXG4gICAgZGVsZXRlREIoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKF89PmlkYi5kZWxldGUodGhpcy5kYk5hbWUpKTtcbiAgICB9XG5cblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8ucmVtb3ZlKGtleSkudGhlbigoKT0+e1xuICAgICAgICAgICAgdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmFsc2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+eyAgLy8gIE5vdCB3YWl0aW5nIGZvciBwcm9taXNlIHJlc29sdmVzXG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLmdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iUmVzdWx0PT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8ucmVtb3ZlKGpvYkV4ZWN1dGlvbi5pZCkudGhlbigoKT0+e1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbi5pZCwgZmFsc2UpLnRoZW4oc3RlcEV4ZWN1dGlvbnM9PnsgIC8vIE5vdCB3YWl0aW5nIGZvciBwcm9taXNlIHJlc29sdmVzXG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaCh0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8ucmVtb3ZlKHN0ZXBFeGVjdXRpb24uaWQpXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5yZW1vdmUoam9iUmVzdWx0LmlkKTtcbiAgICB9XG5cblxuXG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLmdldChqb2JSZXN1bHRJZCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uZ2V0QnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5zZXQoam9iUmVzdWx0LmlkLCBqb2JSZXN1bHQpLnRoZW4ocj0+am9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5nZXQoa2V5KS50aGVuKGR0bz0+ZHRvID8gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8pIDogZHRvKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8uc2V0KGtleSwgam9iSW5zdGFuY2UpLnRoZW4ocj0+am9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZHRvID0gam9iRXhlY3V0aW9uLmdldERUTygpO1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnNEVE9zID0gZHRvLnN0ZXBFeGVjdXRpb25zO1xuICAgICAgICBkdG8uc3RlcEV4ZWN1dGlvbnMgPSBudWxsO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uc2V0KGpvYkV4ZWN1dGlvbi5pZCwgZHRvKS50aGVuKHI9PnRoaXMuc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9uc0RUT3MpKS50aGVuKHI9PmpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvLnNldChqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3MpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBmbGFnKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0Rhby5nZXQoam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZHRvID0gc3RlcEV4ZWN1dGlvbi5nZXREVE8oW1wiam9iRXhlY3V0aW9uXCJdKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5zZXQoc3RlcEV4ZWN1dGlvbi5pZCwgZHRvKS50aGVuKHI9PnN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnMsIHNhdmVkRXhlY3V0aW9ucyA9IFtdKSB7XG4gICAgICAgIGlmIChzdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gc2F2ZWRFeGVjdXRpb25zLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzYXZlZEV4ZWN1dGlvbnMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uRFRPID0gc3RlcEV4ZWN1dGlvbnNbc2F2ZWRFeGVjdXRpb25zLmxlbmd0aF07XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uc2V0KHN0ZXBFeGVjdXRpb25EVE8uaWQsIHN0ZXBFeGVjdXRpb25EVE8pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBzYXZlZEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnMsIHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldChpZCkudGhlbihkdG89PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhkdG8pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhqb2JFeGVjdXRpb25EVE8sIHJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgaWYgKCFqb2JFeGVjdXRpb25EVE8pIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5maW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uRFRPLmlkLCBmYWxzZSkudGhlbihzdGVwcz0+IHtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbkRUTy5zdGVwRXhlY3V0aW9ucyA9IHN0ZXBzO1xuICAgICAgICAgICAgaWYgKCFyZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uRFRPO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmV2aXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbkRUTyk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZSA9IHRydWUsIGZldGNoZWQgPSBbXSkge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uRHRvTGlzdC5sZW5ndGggPD0gZmV0Y2hlZC5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmV0Y2hlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdFtmZXRjaGVkLmxlbmd0aF0sIHJldml2ZSkudGhlbigoam9iRXhlY3V0aW9uKT0+IHtcbiAgICAgICAgICAgIGZldGNoZWQucHVzaChqb2JFeGVjdXRpb24pO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdCwgcmV2aXZlLCBmZXRjaGVkKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbklkLCByZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uZ2V0QWxsQnlJbmRleChcImpvYkV4ZWN1dGlvbklkXCIsIGpvYkV4ZWN1dGlvbklkKS50aGVuKGR0b3M9PiB7XG4gICAgICAgICAgICBpZiAoIXJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBkdG9zO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGR0b3MubWFwKGR0bz0+dGhpcy5yZXZpdmVTdGVwRXhlY3V0aW9uKGR0bykpO1xuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmZXRjaFJlbGF0aW9uc0FuZFJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIGpvYkluc3RhbmNlLmlkKS50aGVuKHZhbHVlcz0+IHtcbiAgICAgICAgICAgIHZhciBzb3J0ZWQgPSB2YWx1ZXMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmICghZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoc29ydGVkLCB0cnVlKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmFsc2UpLnRoZW4oZXhlY3V0aW9ucz0+dGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhleGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0gMV0pKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+IHtcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT4ge1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVKb2JJbnN0YW5jZShkdG8pIHtcbiAgICAgICAgcmV0dXJuIG5ldyBKb2JJbnN0YW5jZShkdG8uaWQsIGR0by5qb2JOYW1lKTtcbiAgICB9XG5cbiAgICByZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0bykge1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuY29udGV4dCA9IGR0by5jb250ZXh0O1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbkNvbnRleHQuZ2V0RGF0YSgpO1xuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGRhdGFNb2RlbCA9IG5ldyBEYXRhTW9kZWwoKTtcbiAgICAgICAgICAgIGRhdGFNb2RlbC5sb2FkRnJvbURUTyhkYXRhLCB0aGlzLmV4cHJlc3Npb25zUmV2aXZlcik7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YU1vZGVsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dFxuICAgIH1cblxuICAgIHJldml2ZUpvYkV4ZWN1dGlvbihkdG8pIHtcblxuICAgICAgICB2YXIgam9iID0gdGhpcy5nZXRKb2JCeU5hbWUoZHRvLmpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0by5qb2JJbnN0YW5jZSk7XG4gICAgICAgIHZhciBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoZHRvLmpvYlBhcmFtZXRlcnMudmFsdWVzKTtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbiA9IG5ldyBKb2JFeGVjdXRpb24oam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMsIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChqb2JFeGVjdXRpb24sIGR0bywgKG9ialZhbHVlLCBzcmNWYWx1ZSwga2V5LCBvYmplY3QsIHNvdXJjZSwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JJbnN0YW5jZVwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkluc3RhbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iUGFyYW1ldGVyc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYlBhcmFtZXRlcnM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJzdGVwRXhlY3V0aW9uc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNyY1ZhbHVlLm1hcChzdGVwRFRPID0+IHRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihzdGVwRFRPLCBqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVTdGVwRXhlY3V0aW9uKGR0bywgam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uID0gbmV3IFN0ZXBFeGVjdXRpb24oZHRvLnN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChzdGVwRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iRXhlY3V0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG5cblxuY2xhc3MgT2JqZWN0U3RvcmVEYW8ge1xuXG4gICAgbmFtZTtcbiAgICBkYlByb21pc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBkYlByb21pc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBkYlByb21pc2U7XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmdldChrZXkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRBbGxCeUluZGV4KGluZGV4TmFtZSwga2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuaW5kZXgoaW5kZXhOYW1lKS5nZXRBbGwoa2V5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRCeUluZGV4KGluZGV4TmFtZSwga2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuaW5kZXgoaW5kZXhOYW1lKS5nZXQoa2V5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBzZXQoa2V5LCB2YWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkucHV0KHZhbCwga2V5KTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5kZWxldGUoa2V5KTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY2xlYXIoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmNsZWFyKCk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGtleXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGtleXMgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHN0b3JlID0gdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKTtcblxuICAgICAgICAgICAgLy8gVGhpcyB3b3VsZCBiZSBzdG9yZS5nZXRBbGxLZXlzKCksIGJ1dCBpdCBpc24ndCBzdXBwb3J0ZWQgYnkgRWRnZSBvciBTYWZhcmkuXG4gICAgICAgICAgICAvLyBvcGVuS2V5Q3Vyc29yIGlzbid0IHN1cHBvcnRlZCBieSBTYWZhcmksIHNvIHdlIGZhbGwgYmFja1xuICAgICAgICAgICAgKHN0b3JlLml0ZXJhdGVLZXlDdXJzb3IgfHwgc3RvcmUuaXRlcmF0ZUN1cnNvcikuY2FsbChzdG9yZSwgY3Vyc29yID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWN1cnNvcikgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGtleXMucHVzaChjdXJzb3Iua2V5KTtcbiAgICAgICAgICAgICAgICBjdXJzb3IuY29udGludWUoKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGUudGhlbigoKSA9PiBrZXlzKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JLZXlHZW5lcmF0b3J9IGZyb20gXCIuLi9qb2Ita2V5LWdlbmVyYXRvclwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4uL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4uL2pvYi1leGVjdXRpb25cIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWluc3RhbmNlLWFscmVhZHktY29tcGxldGUtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7Sm9iUmVzdWx0fSBmcm9tIFwiLi4vam9iLXJlc3VsdFwiO1xuXG5leHBvcnQgY2xhc3MgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBqb2JCeU5hbWUgPSB7fTtcblxuICAgIHJlZ2lzdGVySm9iKGpvYikge1xuICAgICAgICB0aGlzLmpvYkJ5TmFtZVtqb2IubmFtZV0gPSBqb2I7XG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iQnlOYW1lW25hbWVdO1xuICAgIH1cblxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkgZ2V0Sm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGtleSwgam9iSW5zdGFuY2Upe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3MgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25GbGFnIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlU3RlcEV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmZpbmRKb2JFeGVjdXRpb25zIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlU3RlcEV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIG5ldyBKb2JJbnN0YW5jZSB3aXRoIHRoZSBuYW1lIGFuZCBqb2IgcGFyYW1ldGVycyBwcm92aWRlZC4gcmV0dXJuIHByb21pc2UqL1xuICAgIGNyZWF0ZUpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gbmV3IEpvYkluc3RhbmNlKFV0aWxzLmd1aWQoKSwgam9iTmFtZSk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgLypDaGVjayBpZiBhbiBpbnN0YW5jZSBvZiB0aGlzIGpvYiBhbHJlYWR5IGV4aXN0cyB3aXRoIHRoZSBwYXJhbWV0ZXJzIHByb3ZpZGVkLiovXG4gICAgaXNKb2JJbnN0YW5jZUV4aXN0cyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4ocmVzdWx0ID0+ICEhcmVzdWx0KS5jYXRjaChlcnJvcj0+ZmFsc2UpO1xuICAgIH1cblxuICAgIGdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gam9iTmFtZSArIFwifFwiICsgSm9iS2V5R2VuZXJhdG9yLmdlbmVyYXRlS2V5KGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ3JlYXRlIGEgSm9iRXhlY3V0aW9uIGZvciBhIGdpdmVuICBKb2IgYW5kIEpvYlBhcmFtZXRlcnMuIElmIG1hdGNoaW5nIEpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzLFxuICAgICAqIHRoZSBqb2IgbXVzdCBiZSByZXN0YXJ0YWJsZSBhbmQgaXQncyBsYXN0IEpvYkV4ZWN1dGlvbiBtdXN0ICpub3QqIGJlXG4gICAgICogY29tcGxldGVkLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBkb2VzIG5vdCBleGlzdCB5ZXQgaXQgd2lsbCBiZSAgY3JlYXRlZC4qL1xuXG4gICAgY3JlYXRlSm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMsIGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbihqb2JJbnN0YW5jZT0+e1xuICAgICAgICAgICAgaWYgKGpvYkluc3RhbmNlICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT57XG4gICAgICAgICAgICAgICAgICAgIGV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uKFwiQSBqb2IgZXhlY3V0aW9uIGZvciB0aGlzIGpvYiBpcyBhbHJlYWR5IHJ1bm5pbmc6IFwiICsgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuQUJBTkRPTkVEKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIkEgam9iIGluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBjb21wbGV0ZSBmb3IgcGFyYW1ldGVycz1cIiArIGpvYlBhcmFtZXRlcnNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKyBcIi4gIElmIHlvdSB3YW50IHRvIHJ1biB0aGlzIGpvYiBhZ2FpbiwgY2hhbmdlIHRoZSBwYXJhbWV0ZXJzLlwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBleGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0gMV0uZXhlY3V0aW9uQ29udGV4dDtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBubyBqb2IgZm91bmQsIGNyZWF0ZSBvbmVcbiAgICAgICAgICAgIGpvYkluc3RhbmNlID0gdGhpcy5jcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIHZhciBkYXRhTW9kZWwgPSBuZXcgRGF0YU1vZGVsKCk7XG4gICAgICAgICAgICBkYXRhTW9kZWwuX3NldE5ld1N0YXRlKGRhdGEuY3JlYXRlU3RhdGVTbmFwc2hvdCgpKTtcbiAgICAgICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuc2V0RGF0YShkYXRhTW9kZWwpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtqb2JJbnN0YW5jZSwgZXhlY3V0aW9uQ29udGV4dF0pO1xuICAgICAgICB9KS50aGVuKGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dD0+e1xuICAgICAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbiA9IG5ldyBKb2JFeGVjdXRpb24oaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0WzBdLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0WzFdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbigoam9iSW5zdGFuY2UpPT57XG4gICAgICAgICAgICBpZigham9iSW5zdGFuY2Upe1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oZXhlY3V0aW9ucz0+ZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtMV0pO1xuICAgIH1cblxuICAgIGdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb25zPT57XG4gICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnM9W107XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2goam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHM9PnMuc3RlcE5hbWUgPT09IHN0ZXBOYW1lKS5mb3JFYWNoKChzKT0+c3RlcEV4ZWN1dGlvbnMucHVzaChzKSkpO1xuICAgICAgICAgICAgdmFyIGxhdGVzdCA9IG51bGw7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHM9PntcbiAgICAgICAgICAgICAgICBpZiAobGF0ZXN0ID09IG51bGwgfHwgbGF0ZXN0LnN0YXJ0VGltZS5nZXRUaW1lKCkgPCBzLnN0YXJ0VGltZS5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGF0ZXN0ID0gcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBsYXRlc3Q7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgYWRkU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGUobyl7XG4gICAgICAgIG8ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgXCJPYmplY3Qgbm90IHVwZGF0YWJsZTogXCIrb1xuICAgIH1cblxuICAgIHJlbW92ZShvKXtcblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iUmVzdWx0KXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYlJlc3VsdCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFwiT2JqZWN0IG5vdCByZW1vdmFibGU6IFwiK28pO1xuICAgIH1cblxuXG4gICAgcmV2aXZlSm9iSW5zdGFuY2UoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgU2ltcGxlSm9iUmVwb3NpdG9yeSBleHRlbmRzIEpvYlJlcG9zaXRvcnl7XG4gICAgam9iSW5zdGFuY2VzQnlLZXkgPSB7fTtcbiAgICBqb2JFeGVjdXRpb25zID0gW107XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBleGVjdXRpb25Qcm9ncmVzcyA9IHt9O1xuICAgIGV4ZWN1dGlvbkZsYWdzID0ge307XG4gICAgam9iUmVzdWx0cyA9IFtdO1xuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICBVdGlscy5mb3JPd24odGhpcy5qb2JJbnN0YW5jZXNCeUtleSwgIChqaSwga2V5KT0+e1xuICAgICAgICAgICAgaWYoamk9PT1qb2JJbnN0YW5jZSl7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5maWx0ZXIoam9iUmVzdWx0PT5qb2JSZXN1bHQuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iUmVzdWx0LCB0aGlzKTtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuam9iRXhlY3V0aW9ucy5pbmRleE9mKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5maWx0ZXIoc3RlcEV4ZWN1dGlvbj0+c3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQgPT09IGpvYkV4ZWN1dGlvbi5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuc3RlcEV4ZWN1dGlvbnMuaW5kZXhPZihzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5qb2JSZXN1bHRzLmluZGV4T2Yoam9iUmVzdWx0KTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iUmVzdWx0cy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSA9IGpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYkluc3RhbmNlKVxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuaWQ9PT1qb2JSZXN1bHRJZCkpXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuam9iSW5zdGFuY2UuaWQ9PT1qb2JJbnN0YW5jZS5pZCkpXG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnB1c2goam9iUmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JFeGVjdXRpb25zLCBleD0+ZXguaWQ9PT1pZCkpXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnB1c2goam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdID0gcHJvZ3Jlc3M7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocHJvZ3Jlc3MpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdKVxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0gPSBmbGFnO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZsYWcpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0pXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGU9PmUuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICB9KSk7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTaW1wbGVKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9zaW1wbGUtam9iLXJlcG9zaXRvcnlcIjtcblxuXG5cbmV4cG9ydCBjbGFzcyBUaW1lb3V0Sm9iUmVwb3NpdG9yeSBleHRlbmRzIFNpbXBsZUpvYlJlcG9zaXRvcnl7XG5cbiAgICBjcmVhdGVUaW1lb3V0UHJvbWlzZSh2YWx1ZVRvUmVzb2x2ZSwgZGVsYXk9MSl7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlPT57XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh2YWx1ZVRvUmVzb2x2ZSk7XG4gICAgICAgICAgICB9LCBkZWxheSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0gPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmlkPT09am9iUmVzdWx0SWQpKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuam9iSW5zdGFuY2UuaWQ9PT1qb2JJbnN0YW5jZS5pZCkpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5wdXNoKGpvYlJlc3VsdCk7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JFeGVjdXRpb25zLCBleD0+ZXguaWQ9PT1pZCkpO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5wdXNoKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0gPSBwcm9ncmVzcztcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UocHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0gPSBmbGFnO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShmbGFnKTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGU9PmUuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKG9iamVjdCl7IC8vVE9ET1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcblxuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgcmVzdWx0IG9mIGEgam9iIGluc3RhbmNlLiovXG5leHBvcnQgY2xhc3MgSm9iUmVzdWx0IHtcbiAgICBpZDtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICBkYXRhO1xuXG4gICAgY29uc3RydWN0b3Ioam9iSW5zdGFuY2UsIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjb25zdCBKT0JfU1RBVFVTID0ge1xuICAgIENPTVBMRVRFRDogJ0NPTVBMRVRFRCcsXG4gICAgU1RBUlRJTkc6ICdTVEFSVElORycsXG4gICAgU1RBUlRFRDogJ1NUQVJURUQnLFxuICAgIFNUT1BQSU5HOiAnU1RPUFBJTkcnLFxuICAgIFNUT1BQRUQ6ICdTVE9QUEVEJyxcbiAgICBGQUlMRUQ6ICdGQUlMRUQnLFxuICAgIFVOS05PV046ICdVTktOT1dOJyxcbiAgICBBQkFORE9ORUQ6ICdBQkFORE9ORUQnLFxuICAgIEVYRUNVVElORzogJ0VYRUNVVElORycgLy9mb3IgZXhpdCBzdGF0dXMgb25seVxufTtcbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5pbXBvcnQge0pvYlJlc3VsdH0gZnJvbSBcIi4vam9iLXJlc3VsdFwiO1xuLypCYXNlIGNsYXNzIGZvciBqb2JzKi9cbi8vQSBKb2IgaXMgYW4gZW50aXR5IHRoYXQgZW5jYXBzdWxhdGVzIGFuIGVudGlyZSBqb2IgcHJvY2VzcyAoIGFuIGFic3RyYWN0aW9uIHJlcHJlc2VudGluZyB0aGUgY29uZmlndXJhdGlvbiBvZiBhIGpvYikuXG5cbmV4cG9ydCBjbGFzcyBKb2Ige1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBzdGVwcyA9IFtdO1xuXG4gICAgaXNSZXN0YXJ0YWJsZT10cnVlO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuICAgIGpvYlBhcmFtZXRlcnNWYWxpZGF0b3I7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgPSB0aGlzLmdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JEYXRhVmFsaWRhdG9yID0gdGhpcy5nZXRKb2JEYXRhVmFsaWRhdG9yKCk7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgfVxuXG4gICAgc2V0Sm9iUmVwb3NpdG9yeShqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBzdGFydGluZzogXCIsIGV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBqb2JSZXN1bHQ7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3MoZXhlY3V0aW9uKS50aGVuKGV4ZWN1dGlvbj0+e1xuXG4gICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5TVE9QUElORykge1xuICAgICAgICAgICAgICAgIC8vIFRoZSBqb2Igd2FzIGFscmVhZHkgc3RvcHBlZFxuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHdhcyBzdG9wcGVkOiBcIiArIGV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciAmJiAhdGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYodGhpcy5qb2JEYXRhVmFsaWRhdG9yICYmICF0aGlzLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmdldERhdGEoKSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICBleGVjdXRpb24uc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy51cGRhdGVTdGF0dXMoZXhlY3V0aW9uLCBKT0JfU1RBVFVTLlNUQVJURUQpLCB0aGlzLmdldFJlc3VsdChleGVjdXRpb24pLCB0aGlzLnVwZGF0ZVByb2dyZXNzKGV4ZWN1dGlvbildKS50aGVuKHJlcz0+e1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbj1yZXNbMF07XG4gICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gcmVzWzFdO1xuICAgICAgICAgICAgICAgIGlmKCFqb2JSZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gbmV3IEpvYlJlc3VsdChleGVjdXRpb24uam9iSW5zdGFuY2UpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZUpvYihleGVjdXRpb24pKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIsZXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBqb2JcIiwgZSk7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgZmF0YWwgZXJyb3IgZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKGpvYlJlc3VsdCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkudGhlbigoKT0+ZXhlY3V0aW9uKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBzYXZpbmcgam9iIHJlc3VsdHNcIiwgZSk7XG4gICAgICAgICAgICBpZihlKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhlY3V0aW9uLmVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT5yZXNbMF0pXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVySm9iKGV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBlbmNvdW50ZXJlZCBpbiBhZnRlclN0ZXAgY2FsbGJhY2tcIiwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdXBkYXRlU3RhdHVzKGpvYkV4ZWN1dGlvbiwgc3RhdHVzKSB7XG4gICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXM9c3RhdHVzO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pXG4gICAgfVxuXG4gICAgdXBkYXRlUHJvZ3Jlc3Moam9iRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb24uaWQsIHRoaXMuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgLyogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIGFsbG93aW5nIHRoZW0gdG8gY29uY2VudHJhdGUgb24gcHJvY2Vzc2luZyBsb2dpYyBhbmQgaWdub3JlIGxpc3RlbmVycywgcmV0dXJucyBwcm9taXNlKi9cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgJ2RvRXhlY3V0ZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIGdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKHBhcmFtcykgPT4gcGFyYW1zLnZhbGlkYXRlKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IHRydWVcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZFN0ZXAoc3RlcCl7XG4gICAgICAgIHRoaXMuc3RlcHMucHVzaChzdGVwKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKXtcbiAgICAgICAgdGhyb3cgJ2NyZWF0ZUpvYlBhcmFtZXRlcnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICogY3VycmVudFxuICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcoZXhlY3V0aW9uLmlkKS50aGVuKGZsYWc9PntcbiAgICAgICAgICAgIGlmKEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QID09PSBmbGFnKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RvcCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldFJlc3VsdChleGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHRocm93ICdqb2JSZXN1bHRUb0NzdlJvd3MgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG59XG4iLCJpbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9ifSBmcm9tIFwiLi9qb2JcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi9zdGVwXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUmVzdGFydEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcblxuLyogU2ltcGxlIEpvYiB0aGF0IHNlcXVlbnRpYWxseSBleGVjdXRlcyBhIGpvYiBieSBpdGVyYXRpbmcgdGhyb3VnaCBpdHMgbGlzdCBvZiBzdGVwcy4gIEFueSBTdGVwIHRoYXQgZmFpbHMgd2lsbCBmYWlsIHRoZSBqb2IuICBUaGUgam9iIGlzXG4gY29uc2lkZXJlZCBjb21wbGV0ZSB3aGVuIGFsbCBzdGVwcyBoYXZlIGJlZW4gZXhlY3V0ZWQuKi9cblxuZXhwb3J0IGNsYXNzIFNpbXBsZUpvYiBleHRlbmRzIEpvYiB7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpXG4gICAgfVxuXG4gICAgZ2V0U3RlcChzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gVXRpbHMuZmluZCh0aGlzLnN0ZXBzLCBzPT5zLm5hbWUgPT0gc3RlcE5hbWUpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGV4ZWN1dGlvbiwgam9iUmVzdWx0KS50aGVuKGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJVcGRhdGluZyBKb2JFeGVjdXRpb24gc3RhdHVzOiBcIiwgbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKC4uLmxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBoYW5kbGVOZXh0U3RlcChqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCwgcHJldlN0ZXA9bnVsbCwgcHJldlN0ZXBFeGVjdXRpb249bnVsbCl7XG4gICAgICAgIHZhciBzdGVwSW5kZXggPSAwO1xuICAgICAgICBpZihwcmV2U3RlcCl7XG4gICAgICAgICAgICBzdGVwSW5kZXggPSB0aGlzLnN0ZXBzLmluZGV4T2YocHJldlN0ZXApKzE7XG4gICAgICAgIH1cbiAgICAgICAgaWYoc3RlcEluZGV4Pj10aGlzLnN0ZXBzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHByZXZTdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gdGhpcy5zdGVwc1tzdGVwSW5kZXhdO1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVTdGVwKHN0ZXAsIGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKHN0ZXBFeGVjdXRpb24uc3RhdHVzICE9PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCl7IC8vIFRlcm1pbmF0ZSB0aGUgam9iIGlmIGEgc3RlcCBmYWlsc1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dFN0ZXAoam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQsIHN0ZXAsIHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGhhbmRsZVN0ZXAoc3RlcCwgam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0V4ZWN1dGlvbkZsYWdzKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24uaXNTdG9wcGluZygpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXAubmFtZSlcblxuICAgICAgICB9KS50aGVuKGxhc3RTdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAodGhpcy5zdGVwRXhlY3V0aW9uUGFydE9mRXhpc3RpbmdKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uLCBsYXN0U3RlcEV4ZWN1dGlvbikpIHtcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGUgbGFzdCBleGVjdXRpb24gb2YgdGhpcyBzdGVwIHdhcyBpbiB0aGUgc2FtZSBqb2IsIGl0J3MgcHJvYmFibHkgaW50ZW50aW9uYWwgc28gd2Ugd2FudCB0byBydW4gaXQgYWdhaW4uXG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJEdXBsaWNhdGUgc3RlcCBkZXRlY3RlZCBpbiBleGVjdXRpb24gb2Ygam9iLiBzdGVwOiBcIiArIHN0ZXAubmFtZSArIFwiIGpvYk5hbWU6IFwiLCBqb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgICAgICAgICBsYXN0U3RlcEV4ZWN1dGlvbiA9IG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBjdXJyZW50U3RlcEV4ZWN1dGlvbiA9IGxhc3RTdGVwRXhlY3V0aW9uO1xuXG4gICAgICAgICAgICBpZiAoIXRoaXMuc2hvdWxkU3RhcnQoY3VycmVudFN0ZXBFeGVjdXRpb24sIGpvYkV4ZWN1dGlvbiwgc3RlcCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uLmNyZWF0ZVN0ZXBFeGVjdXRpb24oc3RlcC5uYW1lKTtcblxuICAgICAgICAgICAgdmFyIGlzQ29tcGxldGVkID0gbGFzdFN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiBsYXN0U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgdmFyIGlzUmVzdGFydCA9IGxhc3RTdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgIWlzQ29tcGxldGVkO1xuICAgICAgICAgICAgdmFyIHNraXBFeGVjdXRpb24gPSBpc0NvbXBsZXRlZCAmJiBzdGVwLnNraXBPblJlc3RhcnRJZkNvbXBsZXRlZDtcblxuICAgICAgICAgICAgaWYgKGlzUmVzdGFydCkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBsYXN0U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgICAgIGlmIChsYXN0U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmNvbnRhaW5zS2V5KFwiZXhlY3V0ZWRcIikpIHtcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5yZW1vdmUoXCJleGVjdXRlZFwiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoc2tpcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwic2tpcHBlZFwiLCB0cnVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5hZGRTdGVwRXhlY3V0aW9uKGN1cnJlbnRTdGVwRXhlY3V0aW9uKS50aGVuKChfY3VycmVudFN0ZXBFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb249X2N1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIGlmKHNraXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIlNraXBwaW5nIGNvbXBsZXRlZCBzdGVwIGV4ZWN1dGlvbjogW1wiICsgc3RlcC5uYW1lICsgXCJdXCIpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRXhlY3V0aW5nIHN0ZXA6IFtcIiArIHN0ZXAubmFtZSArIFwiXVwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RlcC5leGVjdXRlKGN1cnJlbnRTdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJleGVjdXRlZFwiLCB0cnVlKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9KS5jYXRjaCAoZSA9PiB7XG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249Pnt0aHJvdyBlfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pLnRoZW4oKGN1cnJlbnRTdGVwRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQSU5HXG4gICAgICAgICAgICAgICAgfHwgY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBFRCkge1xuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBqb2IgZ2V0cyB0aGUgbWVzc2FnZSB0aGF0IGl0IGlzIHN0b3BwaW5nXG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgICAgICAgICAgICAgLy8gdGhyb3cgbmV3IEVycm9yKFwiSm9iIGludGVycnVwdGVkIGJ5IHN0ZXAgZXhlY3V0aW9uXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlUHJvZ3Jlc3Moam9iRXhlY3V0aW9uKS50aGVuKCgpPT5jdXJyZW50U3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBzdGVwRXhlY3V0aW9uUGFydE9mRXhpc3RpbmdKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uLCBzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQgPT0gam9iRXhlY3V0aW9uLmlkXG4gICAgfVxuXG4gICAgc2hvdWxkU3RhcnQobGFzdFN0ZXBFeGVjdXRpb24sIGV4ZWN1dGlvbiwgc3RlcCkge1xuICAgICAgICB2YXIgc3RlcFN0YXR1cztcbiAgICAgICAgaWYgKGxhc3RTdGVwRXhlY3V0aW9uID09IG51bGwpIHtcbiAgICAgICAgICAgIHN0ZXBTdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgc3RlcFN0YXR1cyA9IGxhc3RTdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzdGVwU3RhdHVzID09IEpPQl9TVEFUVVMuVU5LTk9XTikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJDYW5ub3QgcmVzdGFydCBzdGVwIGZyb20gVU5LTk9XTiBzdGF0dXNcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzdGVwU3RhdHVzICE9IEpPQl9TVEFUVVMuQ09NUExFVEVEIHx8IHN0ZXAuaXNSZXN0YXJ0YWJsZTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICB2YXIgY29tcGxldGVkU3RlcHMgPSBleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoO1xuICAgICAgICBsZXQgcHJvZ3Jlc3MgPSB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5zdGVwcy5sZW5ndGgsXG4gICAgICAgICAgICBjdXJyZW50OiBjb21wbGV0ZWRTdGVwc1xuICAgICAgICB9O1xuICAgICAgICBpZighY29tcGxldGVkU3RlcHMpe1xuICAgICAgICAgICAgcmV0dXJuIHByb2dyZXNzXG4gICAgICAgIH1cbiAgICAgICAgaWYoSk9CX1NUQVRVUy5DT01QTEVURUQgIT09IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1tleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoLTFdLnN0YXR1cyl7XG4gICAgICAgICAgICBwcm9ncmVzcy5jdXJyZW50LS07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcHJvZ3Jlc3M7XG4gICAgfVxuXG4gICAgYWRkU3RlcCgpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChhcmd1bWVudHNbMF0pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBuZXcgU3RlcChhcmd1bWVudHNbMF0sIHRoaXMuam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHN0ZXAuZG9FeGVjdXRlID0gYXJndW1lbnRzWzFdO1xuICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChzdGVwKTtcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uTGlzdGVuZXIge1xuICAgIC8qQ2FsbGVkIGJlZm9yZSBhIHN0ZXAgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZVN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgc3RlcC4gQ2FsbGVkIGFmdGVyIGJvdGggc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV4ZWN1dGlvbnMqL1xuICAgIGFmdGVyU3RlcChqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4vam9iLWV4ZWN1dGlvblwiO1xuXG4vKlxuIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBleGVjdXRpb24gb2YgYSBzdGVwXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uIHtcbiAgICBpZDtcbiAgICBzdGVwTmFtZTtcbiAgICBqb2JFeGVjdXRpb247XG5cbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkVYRUNVVElORztcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTsgLy9leGVjdXRpb24gY29udGV4dCBmb3Igc2luZ2xlIHN0ZXAgbGV2ZWwsXG5cbiAgICBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIHRlcm1pbmF0ZU9ubHkgPSBmYWxzZTsgLy9mbGFnIHRvIGluZGljYXRlIHRoYXQgYW4gZXhlY3V0aW9uIHNob3VsZCBoYWx0XG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKHN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zdGVwTmFtZSA9IHN0ZXBOYW1lO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25JZCA9IGpvYkV4ZWN1dGlvbi5pZDtcbiAgICB9XG5cbiAgICBnZXRKb2JQYXJhbWV0ZXJzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgIH1cblxuICAgIGdldERUTyhmaWx0ZXJlZFByb3BlcnRpZXM9W10sIGRlZXBDbG9uZSA9IHRydWUpe1xuXG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYoZmlsdGVyZWRQcm9wZXJ0aWVzLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihbXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gVXRpbHMuZ2V0RXJyb3JEVE8odmFsdWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcInN0ZXBFeGVjdXRpb25zXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGNvbmZpZ3VyYXRpb24gb2YgYSBqb2Igc3RlcCovXG5leHBvcnQgY2xhc3MgU3RlcCB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIGlzUmVzdGFydGFibGUgPSB0cnVlO1xuICAgIHNraXBPblJlc3RhcnRJZkNvbXBsZXRlZD10cnVlO1xuICAgIHN0ZXBzID0gW107XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIHNldEpvYlJlcG9zaXRvcnkoam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIC8qUHJvY2VzcyB0aGUgc3RlcCBhbmQgYXNzaWduIHByb2dyZXNzIGFuZCBzdGF0dXMgbWV0YSBpbmZvcm1hdGlvbiB0byB0aGUgU3RlcEV4ZWN1dGlvbiBwcm92aWRlZCovXG4gICAgZXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiRXhlY3V0aW5nIHN0ZXA6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVEVEO1xuICAgICAgICB2YXIgZXhpdFN0YXR1cztcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbikudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG5cbiAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZVN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgdGhpcy5vcGVuKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgIH0pLnRoZW4oX3N0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24gPSBfc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXM7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gTmVlZCB0byB1cGdyYWRlIGhlcmUgbm90IHNldCwgaW4gY2FzZSB0aGUgZXhlY3V0aW9uIHdhcyBzdG9wcGVkXG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gc3VjY2VzczogbmFtZT1cIiArIHRoaXMubmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IHRoaXMuZGV0ZXJtaW5lSm9iU3RhdHVzKGUpO1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IHN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgYW4gZXJyb3IgZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVyU3RlcChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBpbiBhZnRlclN0ZXAgY2FsbGJhY2sgaW4gc3RlcCBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5lbmRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IGV4aXRTdGF0dXM7XG5cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfSkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2Uoc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIHdoaWxlIGNsb3Npbmcgc3RlcCBleGVjdXRpb24gcmVzb3VyY2VzIGluIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGRvRXhlY3V0aW9uUmVsZWFzZSgpO1xuXG4gICAgICAgICAgICBsb2cuZGVidWcoXCJTdGVwIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIgKyBzdGVwRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGRldGVybWluZUpvYlN0YXR1cyhlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gZXhlY3V0ZSBidXNpbmVzcyBsb2dpYy4gU3ViY2xhc3NlcyBzaG91bGQgc2V0IHRoZSBleGl0U3RhdHVzIG9uIHRoZVxuICAgICAqIFN0ZXBFeGVjdXRpb24gYmVmb3JlIHJldHVybmluZy4gTXVzdCByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAqL1xuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgc3RlcCwgdG8gb3BlbiBvclxuICAgICAqIGFjcXVpcmUgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBvcGVuKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgZW5kIG9mIGEgc3RlcCAocmlnaHQgYXQgdGhlIGVuZFxuICAgICAqIG9mIHRoZSBmaW5hbGx5IGJsb2NrKSwgdG8gY2xvc2Ugb3IgcmVsZWFzZSByZXNvdXJjZXMuIERvZXMgbm90aGluZyBieSBkZWZhdWx0LlxuICAgICAqL1xuICAgIGNsb3NlKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQgKiBhcyBlbmdpbmUgZnJvbSAnLi9lbmdpbmUvaW5kZXgnXG5cbmV4cG9ydCB7ZW5naW5lfVxuZXhwb3J0ICogZnJvbSAnLi9qb2JzLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi13b3JrZXInXG5cblxuXG4iLCJpbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4vZW5naW5lL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnIHtcbiAgICBvbkpvYlN0YXJ0ZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYkNvbXBsZXRlZCA9IHJlc3VsdCA9PiB7fTtcbiAgICBvbkpvYkZhaWxlZCA9IGVycm9ycyA9PiB7fTtcbiAgICBvbkpvYlN0b3BwZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYlRlcm1pbmF0ZWQgPSAoKSA9PiB7fTtcbiAgICBvblByb2dyZXNzID0gKHByb2dyZXNzKSA9PiB7fTtcbiAgICBjYWxsYmFja3NUaGlzQXJnO1xuICAgIHVwZGF0ZUludGVydmFsID0gMTAwO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLypjb252ZW5pZW5jZSBjbGFzcyBmb3IgbWFuYWdpbmcgYW5kIHRyYWNraW5nIGpvYiBpbnN0YW5jZSBwcm9ncmVzcyovXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG4gICAgam9ic01hbmdlcjtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBjb25maWc7XG5cbiAgICBsYXN0Sm9iRXhlY3V0aW9uO1xuICAgIGxhc3RVcGRhdGVUaW1lO1xuICAgIHByb2dyZXNzID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKGpvYnNNYW5nZXIsIGpvYkluc3RhbmNlT3JFeGVjdXRpb24sIGNvbmZpZykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JJbnN0YW5jZU1hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyID0gam9ic01hbmdlcjtcbiAgICAgICAgaWYgKGpvYkluc3RhbmNlT3JFeGVjdXRpb24gaW5zdGFuY2VvZiBKb2JJbnN0YW5jZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYkluc3RhbmNlO1xuICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubGFzdEpvYkV4ZWN1dGlvbiAmJiAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICB0aGlzLmFmdGVySm9iKHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgam9ic01hbmdlci5yZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgIH1cblxuICAgIGNoZWNrUHJvZ3Jlc3MoKSB7XG5cbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICBpZiAodGhpcy50ZXJtaW5hdGVkIHx8ICF0aGlzLmxhc3RKb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkgfHwgdGhpcy5nZXRQcm9ncmVzc1BlcmNlbnRzKHRoaXMucHJvZ3Jlc3MpID09PSAxMDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZ2V0UHJvZ3Jlc3ModGhpcy5sYXN0Sm9iRXhlY3V0aW9uKS50aGVuKHByb2dyZXNzPT4ge1xuICAgICAgICAgICAgdGhpcy5sYXN0VXBkYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBpZiAocHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gcHJvZ3Jlc3M7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Qcm9ncmVzcy5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcHJvZ3Jlc3MpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0sIHRoaXMuY29uZmlnLnVwZGF0ZUludGVydmFsKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlN0YXJ0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzUGVyY2VudHMocHJvZ3Jlc3MpIHtcbiAgICAgICAgaWYgKCFwcm9ncmVzcykge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb2dyZXNzLmN1cnJlbnQgKiAxMDAgLyBwcm9ncmVzcy50b3RhbDtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkICE9PSB0aGlzLmpvYkluc3RhbmNlLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICBpZiAoSk9CX1NUQVRVUy5DT01QTEVURUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG4gICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gdGhpcy5nZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMucHJvZ3Jlc3MpO1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFJlc3VsdChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UpLnRoZW4ocmVzdWx0PT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iQ29tcGxldGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCByZXN1bHQuZGF0YSk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuRkFJTEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkZhaWxlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zKTtcblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuU1RPUFBFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdG9wcGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oZm9yY2VVcGRhdGUgPSBmYWxzZSkge1xuICAgICAgICBpZiAoIXRoaXMubGFzdEpvYkV4ZWN1dGlvbiB8fCBmb3JjZVVwZGF0ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGplO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHN0b3AoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5zdG9wKHRoaXMubGFzdEpvYkV4ZWN1dGlvbilcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4odGhpcy5qb2JJbnN0YW5jZS5qb2JOYW1lLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycy52YWx1ZXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIudGVybWluYXRlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy50ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlRlcm1pbmF0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmxhc3RKb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiZXhwb3J0IGNsYXNzIEpvYldvcmtlcntcblxuICAgIHdvcmtlcjtcbiAgICBsaXN0ZW5lcnMgPSB7fTtcbiAgICBkZWZhdWx0TGlzdGVuZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIGRlZmF1bHRMaXN0ZW5lciwgb25FcnJvcil7XG4gICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICAgIHRoaXMud29ya2VyID0gbmV3IFdvcmtlcih1cmwpO1xuICAgICAgICB0aGlzLmRlZmF1bHRMaXN0ZW5lciA9IGRlZmF1bHRMaXN0ZW5lciB8fCBmdW5jdGlvbigpIHt9O1xuICAgICAgICBpZiAob25FcnJvcikge3RoaXMud29ya2VyLm9uZXJyb3IgPSBvbkVycm9yO31cblxuICAgICAgICB0aGlzLndvcmtlci5vbm1lc3NhZ2UgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmRhdGEgaW5zdGFuY2VvZiBPYmplY3QgJiZcbiAgICAgICAgICAgICAgICBldmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZExpc3RlbmVyJykgJiYgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IGluc3RhbmNlLmxpc3RlbmVyc1tldmVudC5kYXRhLnF1ZXJ5TWV0aG9kTGlzdGVuZXJdO1xuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gZXZlbnQuZGF0YS5xdWVyeU1ldGhvZEFyZ3VtZW50cztcbiAgICAgICAgICAgICAgICBpZihsaXN0ZW5lci5kZXNlcmlhbGl6ZXIpe1xuICAgICAgICAgICAgICAgICAgICBhcmdzID0gbGlzdGVuZXIuZGVzZXJpYWxpemVyKGFyZ3MpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsaXN0ZW5lci5mbi5hcHBseShsaXN0ZW5lci50aGlzQXJnLCBhcmdzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIuY2FsbChpbnN0YW5jZSwgZXZlbnQuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlbmRRdWVyeSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdKb2JXb3JrZXIuc2VuZFF1ZXJ5IHRha2VzIGF0IGxlYXN0IG9uZSBhcmd1bWVudCcpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZCc6IGFyZ3VtZW50c1swXSxcbiAgICAgICAgICAgICdxdWVyeUFyZ3VtZW50cyc6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcnVuSm9iKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncnVuSm9iJywgam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTylcbiAgICB9XG5cbiAgICBleGVjdXRlSm9iKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ2V4ZWN1dGVKb2InLCBqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICByZWNvbXB1dGUoZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncmVjb21wdXRlJywgZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpXG4gICAgfVxuXG4gICAgcG9zdE1lc3NhZ2UobWVzc2FnZSkge1xuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG5cbiAgICB0ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMud29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgIH1cblxuICAgIGFkZExpc3RlbmVyKG5hbWUsIGxpc3RlbmVyLCB0aGlzQXJnLCBkZXNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnNbbmFtZV0gPSB7XG4gICAgICAgICAgICBmbjogbGlzdGVuZXIsXG4gICAgICAgICAgICB0aGlzQXJnOiB0aGlzQXJnIHx8IHRoaXMsXG4gICAgICAgICAgICBkZXNlcmlhbGl6ZXI6IGRlc2VyaWFsaXplclxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKG5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMubGlzdGVuZXJzW25hbWVdO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtKb2JMYXVuY2hlcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1sYXVuY2hlclwiO1xuaW1wb3J0IHtKb2JXb3JrZXJ9IGZyb20gXCIuL2pvYi13b3JrZXJcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9uTGlzdGVuZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJZGJKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvaWRiLWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iXCI7XG5pbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge1RpbWVvdXRKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvdGltZW91dC1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtUb3JuYWRvRGlhZ3JhbUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2JcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U2ltcGxlSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L3NpbXBsZS1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtMZWFndWVUYWJsZUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2JcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9ic01hbmFnZXJDb25maWcge1xuXG4gICAgd29ya2VyVXJsID0gbnVsbDtcbiAgICByZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgIGNsZWFyUmVwb3NpdG9yeSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG5cbiAgICB1c2VXb3JrZXI7XG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIGpvYldvcmtlcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG4gICAgam9iTGF1bmNoZXI7XG5cbiAgICBqb2JFeGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcblxuICAgIGFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzID0ge307XG4gICAgam9iSW5zdGFuY2VzVG9UZXJtaW5hdGUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGNvbmZpZykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuXG5cbiAgICAgICAgdGhpcy51c2VXb3JrZXIgPSAhIXRoaXMuY29uZmlnLndvcmtlclVybDtcbiAgICAgICAgaWYgKHRoaXMudXNlV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmluaXRXb3JrZXIodGhpcy5jb25maWcud29ya2VyVXJsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuaW5pdFJlcG9zaXRvcnkoKTtcblxuICAgICAgICB0aGlzLnJlZ2lzdGVySm9icygpO1xuXG5cblxuICAgICAgICB0aGlzLmpvYkxhdW5jaGVyID0gbmV3IEpvYkxhdW5jaGVyKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5qb2JXb3JrZXIsIChkYXRhKT0+dGhpcy5zZXJpYWxpemVEYXRhKGRhdGEpKTtcbiAgICB9XG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IEpvYnNNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGluaXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZih0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSA9PT0gJ2lkYicpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IElkYkpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCksICdzZC1qb2ItcmVwb3NpdG9yeScsIHRoaXMuY29uZmlnLmNsZWFyUmVwb3NpdG9yeSk7XG4gICAgICAgIH1lbHNlIGlmKCd0aW1lb3V0Jyl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgVGltZW91dEpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB9ZWxzZSBpZignc2ltcGxlJyl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgU2ltcGxlSm9iUmVwb3NpdG9yeSh0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJldml2ZXIoKSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgbG9nLmVycm9yKCdKb2JzTWFuYWdlciBjb25maWd1cmF0aW9uIGVycm9yISBVbmtub3duIHJlcG9zaXRvcnkgdHlwZTogJyt0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSsnLiBVc2luZyBkZWZhdWx0OiBpZGInKTtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLnJlcG9zaXRvcnlUeXBlID0gJ2lkYic7XG4gICAgICAgICAgICB0aGlzLmluaXRSZXBvc2l0b3J5KClcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc2VyaWFsaXplRGF0YShkYXRhKSB7XG4gICAgICAgIHJldHVybiBkYXRhLnNlcmlhbGl6ZSh0cnVlLCBmYWxzZSwgZmFsc2UsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmVwbGFjZXIoKSk7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICB2YXIgaWQgPSBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICBpZiAoIVV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKSB7XG4gICAgICAgICAgICBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQuaWRcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGlkKTtcbiAgICB9XG5cbiAgICBnZXRSZXN1bHQoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLnJ1bihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgfHwgIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2pvYiB3YXMgZGVsZWdhdGVkIHRvIHdvcmtlciBhbmQgaXMgc3RpbGwgcnVubmluZ1xuXG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdID0gcmVzb2x2ZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iTGF1bmNoZXIuZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKTtcbiAgICB9XG5cbiAgICBzdG9wKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKCFqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2IgRXhlY3V0aW9uIG5vdCBmb3VuZDogXCIgKyBqb2JFeGVjdXRpb25PcklkKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgbG9nLndhcm4oXCJKb2IgRXhlY3V0aW9uIG5vdCBydW5uaW5nLCBzdGF0dXM6IFwiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiLCBlbmRUaW1lOiBcIiArIGpvYkV4ZWN1dGlvbi5lbmRUaW1lKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbi5pZCwgSk9CX0VYRUNVVElPTl9GTEFHLlNUT1ApLnRoZW4oKCk9PmpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qc3RvcCBqb2IgZXhlY3V0aW9uIGlmIHJ1bm5pbmcgYW5kIGRlbGV0ZSBqb2IgaW5zdGFuY2UgZnJvbSByZXBvc2l0b3J5Ki9cbiAgICB0ZXJtaW5hdGUoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgaWYoam9iRXhlY3V0aW9uLmlzUnVubmluZygpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KS50aGVuKCgpPT57XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkluc3RhbmNlLmlkXT1qb2JJbnN0YW5jZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcykge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuICAgIH1cblxuXG4gICAgLypSZXR1cm5zIGEgcHJvbWlzZSovXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iV29ya2VyO1xuICAgICAgICB9XG4gICAgICAgIGlmICghKGpvYlBhcmFtZXRlcnMgaW5zdGFuY2VvZiBKb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IHRoaXMuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICBpbml0V29ya2VyKHdvcmtlclVybCkge1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IG5ldyBKb2JXb3JrZXIod29ya2VyVXJsLCAoKT0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKCdlcnJvciBpbiB3b3JrZXInLCBhcmd1bWVudHMpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIGFyZ3NEZXNlcmlhbGl6ZXIgPSAoYXJncyk9PiB7XG4gICAgICAgICAgICByZXR1cm4gW3RoaXMuam9iUmVwb3NpdG9yeS5yZXZpdmVKb2JFeGVjdXRpb24oYXJnc1swXSldXG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJiZWZvcmVKb2JcIiwgdGhpcy5iZWZvcmVKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImFmdGVySm9iXCIsIHRoaXMuYWZ0ZXJKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImpvYkZhdGFsRXJyb3JcIiwgdGhpcy5vbkpvYkZhdGFsRXJyb3IsIHRoaXMpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVySm9icygpIHtcblxuICAgICAgICBsZXQgc2Vuc2l0aXZpdHlBbmFseXNpc0pvYiA9IG5ldyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICBsZXQgcHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgPSBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIGlmKCFVdGlscy5pc1dvcmtlcigpKXtcbiAgICAgICAgICAgIHNlbnNpdGl2aXR5QW5hbHlzaXNKb2Iuc2V0QmF0Y2hTaXplKDEpO1xuICAgICAgICAgICAgcHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2Iuc2V0QmF0Y2hTaXplKDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihzZW5zaXRpdml0eUFuYWx5c2lzSm9iKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgVG9ybmFkb0RpYWdyYW1Kb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgUmVjb21wdXRlSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgTGVhZ3VlVGFibGVKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVySm9iKGpvYikge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkucmVnaXN0ZXJKb2Ioam9iKTtcbiAgICAgICAgam9iLnJlZ2lzdGVyRXhlY3V0aW9uTGlzdGVuZXIodGhpcylcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xuICAgIH1cblxuICAgIGRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xuICAgICAgICB2YXIgaW5kZXggPSB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5pbmRleE9mKGxpc3RlbmVyKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiYmVmb3JlSm9iXCIsIHRoaXMudXNlV29ya2VyLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGw9PmwuYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikpO1xuICAgIH1cblxuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJhZnRlckpvYlwiLCB0aGlzLnVzZVdvcmtlciwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsPT5sLmFmdGVySm9iKGpvYkV4ZWN1dGlvbikpO1xuICAgICAgICB2YXIgcHJvbWlzZVJlc29sdmUgPSB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbi5pZF07XG4gICAgICAgIGlmIChwcm9taXNlUmVzb2x2ZSkge1xuICAgICAgICAgICAgcHJvbWlzZVJlc29sdmUoam9iRXhlY3V0aW9uKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYodGhpcy5qb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZVtqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWRdKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZShqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UsIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIG9uSm9iRmF0YWxFcnJvcihqb2JFeGVjdXRpb25JZCwgZXJyb3Ipe1xuICAgICAgICB2YXIgcHJvbWlzZVJlc29sdmUgPSB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbklkXTtcbiAgICAgICAgaWYgKHByb21pc2VSZXNvbHZlKSB7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChqb2JFeGVjdXRpb25JZCkudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgaWYoZXJyb3Ipe1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlcnJvcik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgICAgICBwcm9taXNlUmVzb2x2ZShqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcblxuICAgICAgICB9XG4gICAgICAgIGxvZy5kZWJ1Zygnb25Kb2JGYXRhbEVycm9yJywgam9iRXhlY3V0aW9uSWQsIGVycm9yKTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtcbiAgICBFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZSxcbiAgICBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZSxcbiAgICBNYXhpTWluUnVsZSxcbiAgICBNYXhpTWF4UnVsZSxcbiAgICBNaW5pTWluUnVsZSxcbiAgICBNaW5pTWF4UnVsZVxufSBmcm9tIFwiLi9ydWxlc1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0ICogYXMgbW9kZWwgZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge01pbk1heFJ1bGV9IGZyb20gXCIuL3J1bGVzL21pbi1tYXgtcnVsZVwiO1xuaW1wb3J0IHtNYXhNaW5SdWxlfSBmcm9tIFwiLi9ydWxlcy9tYXgtbWluLXJ1bGVcIjtcbmltcG9ydCB7TWluTWluUnVsZX0gZnJvbSBcIi4vcnVsZXMvbWluLW1pbi1ydWxlXCI7XG5pbXBvcnQge01heE1heFJ1bGV9IGZyb20gXCIuL3J1bGVzL21heC1tYXgtcnVsZVwiO1xuXG5leHBvcnQgY2xhc3MgT2JqZWN0aXZlUnVsZXNNYW5hZ2Vye1xuXG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjdXJyZW50UnVsZTtcbiAgICBydWxlQnlOYW1lID0ge307XG4gICAgcnVsZXMgPSBbXTtcblxuXG4gICAgZmxpcFBhaXIgPSB7fTtcbiAgICBwYXlvZmZJbmRleCA9IDA7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lLCBjdXJyZW50UnVsZU5hbWUpIHtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1heGlNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNYXhpTWF4UnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWluaU1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1pbmlNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcblxuICAgICAgICBsZXQgbWluTWF4ID0gbmV3IE1pbk1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShtaW5NYXgpO1xuICAgICAgICBsZXQgbWF4TWluID0gbmV3IE1heE1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShtYXhNaW4pO1xuICAgICAgICB0aGlzLmFkZEZsaXBQYWlyKG1pbk1heCwgbWF4TWluKTtcblxuICAgICAgICBsZXQgbWluTWluID0gbmV3IE1pbk1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShtaW5NaW4pO1xuICAgICAgICBsZXQgbWF4TWF4ID0gbmV3IE1heE1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShtYXhNYXgpO1xuXG5cbiAgICAgICAgaWYgKGN1cnJlbnRSdWxlTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtjdXJyZW50UnVsZU5hbWVdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZXNbMF07XG4gICAgICAgIH1cblxuICAgIH1cblxuXG4gICAgc2V0UGF5b2ZmSW5kZXgocGF5b2ZmSW5kZXgpe1xuICAgICAgICB0aGlzLnBheW9mZkluZGV4ID0gcGF5b2ZmSW5kZXggfHwgMDtcbiAgICB9XG5cbiAgICBhZGRSdWxlKHJ1bGUpe1xuICAgICAgICB0aGlzLnJ1bGVCeU5hbWVbcnVsZS5uYW1lXT1ydWxlO1xuICAgICAgICB0aGlzLnJ1bGVzLnB1c2gocnVsZSk7XG4gICAgfVxuXG4gICAgaXNSdWxlTmFtZShydWxlTmFtZSl7XG4gICAgICAgICByZXR1cm4gISF0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdXG4gICAgfVxuXG4gICAgc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpe1xuICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXTtcbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV07XG4gICAgfVxuXG4gICAgZmxpcFJ1bGUoKXtcbiAgICAgICAgdmFyIGZsaXBwZWQgPSB0aGlzLmZsaXBQYWlyW3RoaXMuY3VycmVudFJ1bGUubmFtZV07XG4gICAgICAgIGlmKGZsaXBwZWQpe1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IGZsaXBwZWQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1cGRhdGVEZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChkZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCl7XG4gICAgICAgIHRoaXMucnVsZXMuZmlsdGVyKHI9PnIubXVsdGlDcml0ZXJpYSkuZm9yRWFjaChyPT5yLnNldERlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KSk7XG4gICAgfVxuXG4gICAgcmVjb21wdXRlKGRhdGFNb2RlbCwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5PW51bGwpe1xuXG4gICAgICAgIHZhciBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGluZyBydWxlcywgYWxsOiAnK2FsbFJ1bGVzKTtcblxuICAgICAgICBkYXRhTW9kZWwuZ2V0Um9vdHMoKS5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIHRoaXMucmVjb21wdXRlVHJlZShuLCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3kpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdGltZSAgPSAobmV3IERhdGUoKS5nZXRUaW1lKCkgLSBzdGFydFRpbWUvMTAwMCk7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRhdGlvbiB0b29rICcrdGltZSsncycpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5PW51bGwpe1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0aW5nIHJ1bGVzIGZvciB0cmVlIC4uLicsIHJvb3QpO1xuXG4gICAgICAgIHZhciBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcblxuICAgICAgICB2YXIgcnVsZXMgID0gW3RoaXMuY3VycmVudFJ1bGVdO1xuICAgICAgICBpZihhbGxSdWxlcyl7XG4gICAgICAgICAgICBydWxlcyA9IHRoaXMucnVsZXM7XG4gICAgICAgIH1cblxuICAgICAgICBydWxlcy5mb3JFYWNoKHJ1bGU9PiB7XG4gICAgICAgICAgICBydWxlLnNldFBheW9mZkluZGV4KHRoaXMucGF5b2ZmSW5kZXgpO1xuICAgICAgICAgICAgcnVsZS5zZXREZWNpc2lvblBvbGljeShkZWNpc2lvblBvbGljeSk7XG4gICAgICAgICAgICBydWxlLmNvbXB1dGVQYXlvZmYocm9vdCk7XG4gICAgICAgICAgICBydWxlLmNvbXB1dGVPcHRpbWFsKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jbGVhckRlY2lzaW9uUG9saWN5KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB0aW1lICA9IChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIHN0YXJ0VGltZSkvMTAwMDtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGF0aW9uIHRvb2sgJyt0aW1lKydzJyk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG5cbiAgICBnZXROb2RlRGlzcGxheVZhbHVlKG5vZGUsIG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIG5vZGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsIG5hbWUpXG5cbiAgICB9XG5cbiAgICBnZXRFZGdlRGlzcGxheVZhbHVlKGUsIG5hbWUpe1xuICAgICAgICBpZihuYW1lPT09J3Byb2JhYmlsaXR5Jyl7XG4gICAgICAgICAgICBpZihlLnBhcmVudE5vZGUgaW5zdGFuY2VvZiBtb2RlbC5kb21haW4uRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgJ3Byb2JhYmlsaXR5Jyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihlLnBhcmVudE5vZGUgaW5zdGFuY2VvZiBtb2RlbC5kb21haW4uQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIGlmKG5hbWU9PT0ncGF5b2ZmJyl7XG4gICAgICAgICAgICBpZih0aGlzLmN1cnJlbnRSdWxlLm11bHRpQ3JpdGVyaWEpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3BheW9mZicpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncGF5b2ZmWycgK3RoaXMucGF5b2ZmSW5kZXggKyAnXScpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICAgICAgaWYobmFtZT09PSdvcHRpbWFsJyl7XG4gICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgJ29wdGltYWwnKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkRmxpcFBhaXIocnVsZTEsIHJ1bGUyKSB7XG4gICAgICAgIHRoaXMuZmxpcFBhaXJbcnVsZTEubmFtZV0gPSBydWxlMjtcbiAgICAgICAgdGhpcy5mbGlwUGFpcltydWxlMi5uYW1lXSA9IHJ1bGUxO1xuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcblxuLypleHBlY3RlZCB2YWx1ZSBtYXhpbWl6YXRpb24gcnVsZSovXG5leHBvcnQgY2xhc3MgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnZXhwZWN0ZWQtdmFsdWUtbWF4aW1pemF0aW9uJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmPTAsIHByb2JhYmlsaXR5VG9FbnRlcj0xKXtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSl7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGlmICggdGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpICkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypleHBlY3RlZCB2YWx1ZSBtaW5pbWl6YXRpb24gcnVsZSovXG5leHBvcnQgY2xhc3MgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZj0wLCBwcm9iYWJpbGl0eVRvRW50ZXI9MSl7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBpZiAoIHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vZXhwZWN0ZWQtdmFsdWUtbWF4aW1pemF0aW9uLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL2V4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9tYXhpLW1heC1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9tYXhpLW1pbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9taW5pLW1heC1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9taW5pLW1pbi1ydWxlJ1xuXG5cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWF4TWF4UnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4LW1heCc7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWF4TWF4UnVsZS5OQU1FLCBbMSwgMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWF4TWluUnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4LW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWF4TWluUnVsZS5OQU1FLCBbMSwgLTFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyptYXhpLW1heCBydWxlKi9cbmV4cG9ydCBjbGFzcyBNYXhpTWF4UnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXhpLW1heCc7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWF4aU1heFJ1bGUuTkFNRSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPGJlc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvYmVzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5tYXhCeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyptYXhpLW1pbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBNYXhpTWluUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXhpLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWF4aU1pblJ1bGUuTkFNRSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKT53b3JzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC93b3JzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5taW5CeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1pbk1heFJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbi1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbk1heFJ1bGUuTkFNRSwgWy0xLCAxXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNaW5NaW5SdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW4tbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5NaW5SdWxlLk5BTUUsIFstMSwgLTFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyptaW5pLW1heCBydWxlKi9cbmV4cG9ydCBjbGFzcyBNaW5pTWF4UnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW5pLW1heCc7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluaU1heFJ1bGUuTkFNRSwgZmFsc2UsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk8YmVzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC9iZXN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1heEJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLyptaW5pLW1pbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBNaW5pTWluUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW5pLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluaU1pblJ1bGUuTkFNRSwgZmFsc2UsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tIFwiLi9vYmplY3RpdmUtcnVsZVwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuXG5leHBvcnQgY2xhc3MgTXVsdGlDcml0ZXJpYVJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxlIHtcblxuICAgIGNyaXRlcmlvbjFXZWlnaHQgPSAxO1xuICAgIHBheW9mZkNvZWZmcyA9IFsxLCAtMV07XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBwYXlvZmZDb2VmZnMsIGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSwgdHJ1ZSk7XG4gICAgICAgIHRoaXMucGF5b2ZmQ29lZmZzID0gcGF5b2ZmQ29lZmZzO1xuXG4gICAgfVxuXG4gICAgc2V0RGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoY3JpdGVyaW9uMVdlaWdodCkge1xuICAgICAgICB0aGlzLmNyaXRlcmlvbjFXZWlnaHQgPSBjcml0ZXJpb24xV2VpZ2h0O1xuICAgIH1cblxuICAgIC8vIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZiwgYWdncmVnYXRlZFBheW9mZiAtIGFnZ3JlZ2F0ZWQgcGF5b2ZmIGFsb25nIHBhdGhcbiAgICBjb21wdXRlUGF5b2ZmKG5vZGUsIHBheW9mZiA9IFswLCAwXSwgYWdncmVnYXRlZFBheW9mZiA9IFswLCAwXSkge1xuICAgICAgICB2YXIgY2hpbGRyZW5QYXlvZmYgPSBbMCwgMF07XG4gICAgICAgIGlmIChub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IFtdO1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q2hpbGQgPSAtSW5maW5pdHk7XG5cbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBiYXNlUGF5b2ZmcyA9IFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV07XG4gICAgICAgICAgICAgICAgICAgIHZhciBjaGlsZFBheW9mZiA9IHRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgYmFzZVBheW9mZnMsIFt0aGlzLmFkZChiYXNlUGF5b2Zmc1swXSwgYWdncmVnYXRlZFBheW9mZlswXSksIHRoaXMuYWRkKGJhc2VQYXlvZmZzWzFdLCBhZ2dyZWdhdGVkUGF5b2ZmWzFdKV0pO1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRDb21iaW5lZFBheW9mZiA9IHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAnY29tYmluZWRQYXlvZmYnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkQ29tYmluZWRQYXlvZmYgPiBiZXN0Q2hpbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDaGlsZCA9IGNoaWxkQ29tYmluZWRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbaV07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmVzdENoaWxkLmVxdWFscyhjaGlsZENvbWJpbmVkUGF5b2ZmKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzLnB1c2goaSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcy5kZWNpc2lvblBvbGljeSwgbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5Jywgc2VsZWN0ZWRJbmRleGVzLmluZGV4T2YoaSkgPCAwID8gMC4wIDogMS4wKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGJhc2VQYXlvZmZzID0gW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCBiYXNlUGF5b2ZmcywgW3RoaXMuYWRkKGJhc2VQYXlvZmZzWzBdLCBhZ2dyZWdhdGVkUGF5b2ZmWzBdKSwgdGhpcy5hZGQoYmFzZVBheW9mZnNbMV0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMV0pXSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5iYXNlUHJvYmFiaWxpdHkoZSkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgc3Vtd2VpZ2h0ID0gMDtcbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgc3Vtd2VpZ2h0ID0gdGhpcy5hZGQoc3Vtd2VpZ2h0LCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKHN1bXdlaWdodCA+IDApIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZi5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBlcCA9IHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmWycgKyBpICsgJ10nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUGF5b2ZmW2ldID0gdGhpcy5hZGQocCwgdGhpcy5tdWx0aXBseSh0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSwgZXApLmRpdihzdW13ZWlnaHQpKVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cbiAgICAgICAgcGF5b2ZmLmZvckVhY2goKHAsIGkpPT4ge1xuICAgICAgICAgICAgcGF5b2ZmW2ldID0gdGhpcy5hZGQocCwgY2hpbGRyZW5QYXlvZmZbaV0pO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMobm9kZSk7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2NoaWxkcmVuUGF5b2ZmJywgY2hpbGRyZW5QYXlvZmYpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJywgdGhpcy5jb21wdXRlQ29tYmluZWRQYXlvZmYocGF5b2ZmKSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuY1ZhbHVlKG5vZGUsICdwYXlvZmYnLCBwYXlvZmYpO1xuICAgIH1cblxuICAgIGNvbXB1dGVDb21iaW5lZFBheW9mZihwYXlvZmYpe1xuICAgICAgICAvLyBbY3JpdGVyaW9uIDEgY29lZmZdKltjcml0ZXJpb24gMV0qW3dlaWdodF0rW2NyaXRlcmlvbiAyIGNvZWZmXSpbY3JpdGVyaW9uIDJdXG4gICAgICAgIGlmICh0aGlzLmNyaXRlcmlvbjFXZWlnaHQgPT09IEluZmluaXR5KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5tdWx0aXBseSh0aGlzLnBheW9mZkNvZWZmc1swXSwgcGF5b2ZmWzBdKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5hZGQodGhpcy5tdWx0aXBseSh0aGlzLnBheW9mZkNvZWZmc1swXSwgdGhpcy5tdWx0aXBseSh0aGlzLmNyaXRlcmlvbjFXZWlnaHQsIHBheW9mZlswXSkpLCB0aGlzLm11bHRpcGx5KHRoaXMucGF5b2ZmQ29lZmZzWzFdLCBwYXlvZmZbMV0pKTtcbiAgICB9XG5cbiAgICAvLyAgY29tYmluZWRQYXlvZmYgLSBwYXJlbnQgZWRnZSBjb21iaW5lZFBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIGNvbWJpbmVkUGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3VidHJhY3QodGhpcy5jVmFsdWUobm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJyksIGNvbWJpbmVkUGF5b2ZmKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdjb21iaW5lZFBheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmNvbXB1dGVDb21iaW5lZFBheW9mZihbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG4vKkJhc2UgY2xhc3MgZm9yIG9iamVjdGl2ZSBydWxlcyovXG5leHBvcnQgY2xhc3MgT2JqZWN0aXZlUnVsZSB7XG4gICAgbmFtZTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgZGVjaXNpb25Qb2xpY3k7XG4gICAgbWF4aW1pemF0aW9uO1xuXG4gICAgcGF5b2ZmSW5kZXggPSAwO1xuICAgIG11bHRpQ3JpdGVyaWEgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIG1heGltaXphdGlvbiwgZXhwcmVzc2lvbkVuZ2luZSwgbXVsdGlDcml0ZXJpYT1mYWxzZSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLm1heGltaXphdGlvbiA9IG1heGltaXphdGlvbjtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5tdWx0aUNyaXRlcmlhID0gbXVsdGlDcml0ZXJpYTtcbiAgICB9XG5cbiAgICBzZXREZWNpc2lvblBvbGljeShkZWNpc2lvblBvbGljeSkge1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5ID0gZGVjaXNpb25Qb2xpY3k7XG4gICAgfVxuXG4gICAgc2V0UGF5b2ZmSW5kZXgocGF5b2ZmSW5kZXgpIHtcbiAgICAgICAgdGhpcy5wYXlvZmZJbmRleCA9IHBheW9mZkluZGV4O1xuICAgIH1cblxuICAgIGNsZWFyRGVjaXNpb25Qb2xpY3koKSB7XG4gICAgICAgIHRoaXMuZGVjaXNpb25Qb2xpY3kgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIHNob3VsZCByZXR1cm4gYXJyYXkgb2Ygc2VsZWN0ZWQgY2hpbGRyZW4gaW5kZXhlc1xuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcykge1xuICAgICAgICB2YXIgYmVzdDtcbiAgICAgICAgaWYgKHRoaXMubWF4aW1pemF0aW9uKSB7XG4gICAgICAgICAgICBiZXN0ID0gdGhpcy5tYXgoLi4uY2hpbGRyZW5QYXlvZmZzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJlc3QgPSB0aGlzLm1pbiguLi5jaGlsZHJlblBheW9mZnMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgY2hpbGRyZW5QYXlvZmZzLmZvckVhY2goKHAsIGkpPT4ge1xuICAgICAgICAgICAgaWYgKEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZShiZXN0LCBwKSA9PSAwKSB7XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzLnB1c2goaSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gc2VsZWN0ZWRJbmRleGVzO1xuICAgIH1cblxuICAgIF9tYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpIHtcbiAgICAgICAgaWYgKHRoaXMuZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbih0aGlzLmRlY2lzaW9uUG9saWN5LCBkZWNpc2lvbk5vZGUpO1xuICAgICAgICAgICAgaWYgKGRlY2lzaW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5tYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpO1xuICAgIH1cblxuICAgIC8vIGV4dGVuc2lvbiBwb2ludCBmb3IgY2hhbmdpbmcgY29tcHV0ZWQgcHJvYmFiaWxpdHkgb2YgZWRnZXMgaW4gYSBjaGFuY2Ugbm9kZVxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCkge1xuXG4gICAgfVxuXG4gICAgLy8gcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmLCBhZ2dyZWdhdGVkUGF5b2ZmIC0gYWdncmVnYXRlZCBwYXlvZmYgYWxvbmcgcGF0aFxuICAgIGNvbXB1dGVQYXlvZmYobm9kZSwgcGF5b2ZmID0gMCwgYWdncmVnYXRlZFBheW9mZiA9IDApIHtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gMDtcbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSB7XG5cbiAgICAgICAgICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gdGhpcy5fbWFrZURlY2lzaW9uKG5vZGUsIG5vZGUuY2hpbGRFZGdlcy5tYXAoZT0+dGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMuYWRkKHRoaXMuYmFzZVBheW9mZihlKSwgYWdncmVnYXRlZFBheW9mZikpKSk7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHNlbGVjdGVkSW5kZXhlcy5pbmRleE9mKGkpIDwgMCA/IDAuMCA6IDEuMCk7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDaGlsZCA9IC1JbmZpbml0eTtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENvdW50ID0gMTtcbiAgICAgICAgICAgICAgICB2YXIgd29yc3RDaGlsZCA9IEluZmluaXR5O1xuICAgICAgICAgICAgICAgIHZhciB3b3JzdENvdW50ID0gMTtcblxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjaGlsZFBheW9mZiA9IHRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLmFkZCh0aGlzLmJhc2VQYXlvZmYoZSksIGFnZ3JlZ2F0ZWRQYXlvZmYpKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkUGF5b2ZmIDwgd29yc3RDaGlsZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd29yc3RDaGlsZCA9IGNoaWxkUGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICAgICAgd29yc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hpbGRQYXlvZmYuZXF1YWxzKHdvcnN0Q2hpbGQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50KytcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGRQYXlvZmYgPiBiZXN0Q2hpbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDaGlsZCA9IGNoaWxkUGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENvdW50ID0gMTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjaGlsZFBheW9mZi5lcXVhbHMoYmVzdENoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENvdW50KytcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5iYXNlUHJvYmFiaWxpdHkoZSkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMubW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkobm9kZS5jaGlsZEVkZ2VzLCBiZXN0Q2hpbGQsIGJlc3RDb3VudCwgd29yc3RDaGlsZCwgd29yc3RDb3VudCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBzdW13ZWlnaHQgPSAwO1xuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBzdW13ZWlnaHQgPSB0aGlzLmFkZChzdW13ZWlnaHQsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhwYXlvZmYsbm9kZS5jaGlsZEVkZ2VzLCdzdW13ZWlnaHQnLHN1bXdlaWdodCk7XG4gICAgICAgICAgICBpZiAoc3Vtd2VpZ2h0ID4gMCkge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUGF5b2ZmID0gdGhpcy5hZGQoY2hpbGRyZW5QYXlvZmYsIHRoaXMubXVsdGlwbHkodGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JyksIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKS5kaXYoc3Vtd2VpZ2h0KSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9XG5cbiAgICAgICAgcGF5b2ZmID0gdGhpcy5hZGQocGF5b2ZmLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhub2RlKTtcblxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2FnZ3JlZ2F0ZWRQYXlvZmYnKyAnWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCBhZ2dyZWdhdGVkUGF5b2ZmKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCAwKTsgLy9pbml0aWFsIHZhbHVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnY2hpbGRyZW5QYXlvZmYnICsgJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgY2hpbGRyZW5QYXlvZmYpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSwgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICAvLyBrb2xvcnVqZSBvcHR5bWFsbmUgxZtjaWXFvGtpXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSkge1xuICAgICAgICB0aHJvdyAnY29tcHV0ZU9wdGltYWwgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBydWxlOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLyogZ2V0IG9yIHNldCBjb21wdXRlZCBwYXlvZmYqL1xuICAgIGNvbXB1dGVkUGF5b2ZmKG5vZGUsIHZhbHVlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY1ZhbHVlKG5vZGUsICdwYXlvZmZbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIHZhbHVlKVxuICAgIH1cblxuICAgIC8qR2V0IG9yIHNldCBvYmplY3QncyBjb21wdXRlZCB2YWx1ZSBmb3IgY3VycmVudCBydWxlKi9cbiAgICBjVmFsdWUob2JqZWN0LCBmaWVsZFBhdGgsIHZhbHVlKSB7XG4gICAgICAgIC8vIGlmKGZpZWxkUGF0aC50cmltKCkgPT09ICdwYXlvZmYnKXtcbiAgICAgICAgLy8gICAgIGZpZWxkUGF0aCArPSAnWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgcmV0dXJuIG9iamVjdC5jb21wdXRlZFZhbHVlKHRoaXMubmFtZSwgZmllbGRQYXRoLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgYmFzZVByb2JhYmlsaXR5KGVkZ2UpIHtcbiAgICAgICAgcmV0dXJuIGVkZ2UuY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKTtcbiAgICB9XG5cbiAgICBiYXNlUGF5b2ZmKGVkZ2UsIHBheW9mZkluZGV4KSB7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIHBheW9mZkluZGV4IHx8IHRoaXMucGF5b2ZmSW5kZXgpO1xuICAgIH1cblxuICAgIGNsZWFyQ29tcHV0ZWRWYWx1ZXMob2JqZWN0KSB7XG4gICAgICAgIG9iamVjdC5jbGVhckNvbXB1dGVkVmFsdWVzKHRoaXMubmFtZSk7XG4gICAgfVxuXG4gICAgYWRkKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuYWRkKGEsIGIpXG4gICAgfVxuXG4gICAgc3VidHJhY3QoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChhLCBiKVxuICAgIH1cblxuICAgIGRpdmlkZShhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShhLCBiKVxuICAgIH1cblxuICAgIG11bHRpcGx5KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubXVsdGlwbHkoYSwgYilcbiAgICB9XG5cbiAgICBtYXgoKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1heCguLi5hcmd1bWVudHMpXG4gICAgfVxuXG4gICAgbWluKCkge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5taW4oLi4uYXJndW1lbnRzKVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7T3BlcmF0aW9ufSBmcm9tIFwiLi9vcGVyYXRpb25cIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcblxuLypTdWJ0cmVlIGZsaXBwaW5nIG9wZXJhdGlvbiovXG5leHBvcnQgY2xhc3MgRmxpcFN1YnRyZWUgZXh0ZW5kcyBPcGVyYXRpb257XG5cbiAgICBzdGF0aWMgJE5BTUUgPSAnZmxpcFN1YnRyZWUnO1xuICAgIGRhdGE7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgc3VwZXIoRmxpcFN1YnRyZWUuJE5BTUUpO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBpc0FwcGxpY2FibGUob2JqZWN0KXtcbiAgICAgICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGVcbiAgICB9XG5cbiAgICBjYW5QZXJmb3JtKG5vZGUpIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGljYWJsZShub2RlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUodGhpcy5kYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKG5vZGUpKS5pc1ZhbGlkKCkpIHsgLy9jaGVjayBpZiB0aGUgd2hvbGUgc3VidHJlZSBpcyBwcm9wZXJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlLmNoaWxkRWRnZXMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cblxuICAgICAgICB2YXIgZ3JhbmRjaGlsZHJlbk51bWJlciA9IG51bGw7XG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuRWRnZUxhYmVscyA9IFtdO1xuICAgICAgICB2YXIgY2hpbGRyZW5FZGdlTGFiZWxzU2V0ID0gbmV3IFNldCgpO1xuICAgICAgICB2YXIgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQ7XG4gICAgICAgIGlmICghbm9kZS5jaGlsZEVkZ2VzLmV2ZXJ5KGU9PiB7XG5cbiAgICAgICAgICAgICAgICB2YXIgY2hpbGQgPSBlLmNoaWxkTm9kZTtcbiAgICAgICAgICAgICAgICBpZiAoIShjaGlsZCBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGRyZW5FZGdlTGFiZWxzU2V0LmhhcyhlLm5hbWUudHJpbSgpKSkgeyAvLyBlZGdlIGxhYmVscyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2hpbGRyZW5FZGdlTGFiZWxzU2V0LmFkZChlLm5hbWUudHJpbSgpKTtcblxuICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuTnVtYmVyID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGdyYW5kY2hpbGRyZW5OdW1iZXIgPSBjaGlsZC5jaGlsZEVkZ2VzLmxlbmd0aDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5OdW1iZXIgPCAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY2hpbGQuY2hpbGRFZGdlcy5mb3JFYWNoKGdlPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMucHVzaChnZS5uYW1lLnRyaW0oKSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzU2V0ID0gbmV3IFNldChncmFuZGNoaWxkcmVuRWRnZUxhYmVscyk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzU2V0LnNpemUgIT09IGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzLmxlbmd0aCkgeyAvL2dyYW5kY2hpbGRyZW4gZWRnZSBsYWJlbHMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkLmNoaWxkRWRnZXMubGVuZ3RoICE9IGdyYW5kY2hpbGRyZW5OdW1iZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghY2hpbGQuY2hpbGRFZGdlcy5ldmVyeSgoZ2UsIGkpPT5ncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1tpXSA9PT0gZ2UubmFtZS50cmltKCkpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcblxuICAgICAgICAgICAgfSkpIHtcblxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcGVyZm9ybShyb290KSB7XG5cbiAgICAgICAgdmFyIHJvb3RDbG9uZSA9IHRoaXMuZGF0YS5jbG9uZVN1YnRyZWUocm9vdCwgdHJ1ZSk7XG4gICAgICAgIHZhciBvbGRDaGlsZHJlbk51bWJlciA9IHJvb3QuY2hpbGRFZGdlcy5sZW5ndGg7XG4gICAgICAgIHZhciBvbGRHcmFuZENoaWxkcmVuTnVtYmVyID0gcm9vdC5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzLmxlbmd0aDtcblxuICAgICAgICB2YXIgY2hpbGRyZW5OdW1iZXIgPSBvbGRHcmFuZENoaWxkcmVuTnVtYmVyO1xuICAgICAgICB2YXIgZ3JhbmRDaGlsZHJlbk51bWJlciA9IG9sZENoaWxkcmVuTnVtYmVyO1xuXG4gICAgICAgIHZhciBjYWxsYmFja3NEaXNhYmxlZCA9IHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZDtcbiAgICAgICAgdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkID0gdHJ1ZTtcblxuXG4gICAgICAgIHZhciBjaGlsZFggPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmxvY2F0aW9uLng7XG4gICAgICAgIHZhciB0b3BZID0gcm9vdC5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5sb2NhdGlvbi55O1xuICAgICAgICB2YXIgYm90dG9tWSA9IHJvb3QuY2hpbGRFZGdlc1tvbGRDaGlsZHJlbk51bWJlciAtIDFdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW29sZEdyYW5kQ2hpbGRyZW5OdW1iZXIgLSAxXS5jaGlsZE5vZGUubG9jYXRpb24ueTtcblxuICAgICAgICB2YXIgZXh0ZW50WSA9IGJvdHRvbVkgLSB0b3BZO1xuICAgICAgICB2YXIgc3RlcFkgPSBleHRlbnRZIC8gKGNoaWxkcmVuTnVtYmVyICsgMSk7XG5cbiAgICAgICAgcm9vdC5jaGlsZEVkZ2VzLnNsaWNlKCkuZm9yRWFjaChlPT4gdGhpcy5kYXRhLnJlbW92ZU5vZGUoZS5jaGlsZE5vZGUpKTtcblxuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hpbGRyZW5OdW1iZXI7IGkrKykge1xuICAgICAgICAgICAgdmFyIGNoaWxkID0gbmV3IG1vZGVsLkNoYW5jZU5vZGUobmV3IG1vZGVsLlBvaW50KGNoaWxkWCwgdG9wWSArIChpICsgMSkgKiBzdGVwWSkpO1xuICAgICAgICAgICAgdmFyIGVkZ2UgPSB0aGlzLmRhdGEuYWRkTm9kZShjaGlsZCwgcm9vdCk7XG4gICAgICAgICAgICBlZGdlLm5hbWUgPSByb290Q2xvbmUuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5uYW1lO1xuXG4gICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gMDtcblxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBncmFuZENoaWxkcmVuTnVtYmVyOyBqKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgZ3JhbmRDaGlsZCA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNoaWxkTm9kZTtcblxuXG4gICAgICAgICAgICAgICAgdmFyIGdyYW5kQ2hpbGRFZGdlID0gdGhpcy5kYXRhLmF0dGFjaFN1YnRyZWUoZ3JhbmRDaGlsZCwgY2hpbGQpO1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLm5hbWUgPSByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5uYW1lO1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnBheW9mZiA9IFtcbiAgICAgICAgICAgICAgICAgICAgRXhwcmVzc2lvbkVuZ2luZS5hZGQocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMCksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDApKSxcbiAgICAgICAgICAgICAgICAgICAgRXhwcmVzc2lvbkVuZ2luZS5hZGQocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMSksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDEpKSxcbiAgICAgICAgICAgICAgICBdO1xuXG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLm11bHRpcGx5KHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCkpO1xuICAgICAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLmFkZChlZGdlLnByb2JhYmlsaXR5LCBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5ID0gcCA9PiBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwLCBlZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIGlmIChlZGdlLnByb2JhYmlsaXR5LmVxdWFscygwKSkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9iID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgZ3JhbmRDaGlsZHJlbk51bWJlcik7XG4gICAgICAgICAgICAgICAgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gcHJvYjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGQuY2hpbGRFZGdlcy5mb3JFYWNoKGdyYW5kQ2hpbGRFZGdlPT4ge1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eShncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLl9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkLmNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKGVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChyb290LmNoaWxkRWRnZXMpO1xuXG5cbiAgICAgICAgdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkID0gY2FsbGJhY2tzRGlzYWJsZWQ7XG4gICAgICAgIHRoaXMuZGF0YS5fZmlyZU5vZGVBZGRlZENhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAoY2hpbGRFZGdlcywgcHJvYmFiaWxpdHlTdW0pe1xuICAgICAgICBpZighcHJvYmFiaWxpdHlTdW0pe1xuICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcHJvYmFiaWxpdHlTdW0uZXF1YWxzKDEpKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygnU3VtIG9mIHRoZSBwcm9iYWJpbGl0aWVzIGluIGNoaWxkIG5vZGVzIGlzIG5vdCBlcXVhbCB0byAxIDogJywgcHJvYmFiaWxpdHlTdW0pO1xuICAgICAgICAgICAgdmFyIG5ld1Byb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgdmFyIGNmID0gMTAwMDAwMDAwMDAwMDsgLy8xMF4xMlxuICAgICAgICAgICAgdmFyIHByZWMgPSAxMjtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSBwYXJzZUludChFeHByZXNzaW9uRW5naW5lLnJvdW5kKGUucHJvYmFiaWxpdHksIHByZWMpICogY2YpO1xuICAgICAgICAgICAgICAgIG5ld1Byb2JhYmlsaXR5U3VtID0gbmV3UHJvYmFiaWxpdHlTdW0gKyBlLnByb2JhYmlsaXR5O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB2YXIgcmVzdCA9IGNmIC0gbmV3UHJvYmFiaWxpdHlTdW07XG4gICAgICAgICAgICBsb2cuaW5mbygnTm9ybWFsaXppbmcgd2l0aCByb3VuZGluZyB0byBwcmVjaXNpb246ICcgKyBwcmVjLCByZXN0KTtcbiAgICAgICAgICAgIGNoaWxkRWRnZXNbMF0ucHJvYmFiaWxpdHkgPSBFeHByZXNzaW9uRW5naW5lLmFkZChyZXN0LCBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIG5ld1Byb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocGFyc2VJbnQoZS5wcm9iYWJpbGl0eSksIGNmKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJcbi8qQmFzZSBjbGFzcyBmb3IgY29tcGxleCBvcGVyYXRpb25zIG9uIHRyZWUgc3RydWN0dXJlKi9cbmV4cG9ydCBjbGFzcyBPcGVyYXRpb257XG5cbiAgICBuYW1lO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSl7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgfVxuXG4gICAgLy9jaGVjayBpZiBvcGVyYXRpb24gaXMgcG90ZW50aWFsbHkgYXBwbGljYWJsZSBmb3Igb2JqZWN0XG4gICAgaXNBcHBsaWNhYmxlKCl7XG4gICAgICAgIHRocm93ICdpc0FwcGxpY2FibGUgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLy9jaGVjayBpZiBjYW4gcGVyZm9ybSBvcGVyYXRpb24gZm9yIGFwcGxpY2FibGUgb2JqZWN0XG4gICAgY2FuUGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAnY2FuUGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cbiAgICBwZXJmb3JtKG9iamVjdCl7XG4gICAgICAgIHRocm93ICdwZXJmb3JtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0ZsaXBTdWJ0cmVlfSBmcm9tIFwiLi9mbGlwLXN1YnRyZWVcIjtcblxuXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9uc01hbmFnZXIge1xuXG4gICAgb3BlcmF0aW9ucyA9IFtdO1xuICAgIG9wZXJhdGlvbkJ5TmFtZSA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJPcGVyYXRpb24obmV3IEZsaXBTdWJ0cmVlKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICB9XG5cbiAgICByZWdpc3Rlck9wZXJhdGlvbihvcGVyYXRpb24pe1xuICAgICAgICB0aGlzLm9wZXJhdGlvbnMucHVzaChvcGVyYXRpb24pO1xuICAgICAgICB0aGlzLm9wZXJhdGlvbkJ5TmFtZVtvcGVyYXRpb24ubmFtZV0gPSBvcGVyYXRpb247XG4gICAgfVxuXG5cbiAgICBnZXRPcGVyYXRpb25CeU5hbWUobmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbkJ5TmFtZVtuYW1lXTtcbiAgICB9XG5cbiAgICBvcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCl7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZXJhdGlvbnMuZmlsdGVyKG9wPT5vcC5pc0FwcGxpY2FibGUob2JqZWN0KSlcbiAgICB9XG5cbn1cbiIsIlxuZXhwb3J0IGNsYXNzIERlY2lzaW9ue1xuICAgIG5vZGU7XG4gICAgZGVjaXNpb25WYWx1ZTsgLy9pbmRleCBvZiAgc2VsZWN0ZWQgZWRnZVxuICAgIGNoaWxkcmVuID0gW107XG4gICAga2V5O1xuXG4gICAgY29uc3RydWN0b3Iobm9kZSwgZGVjaXNpb25WYWx1ZSkge1xuICAgICAgICB0aGlzLm5vZGUgPSBub2RlO1xuICAgICAgICB0aGlzLmRlY2lzaW9uVmFsdWUgPSBkZWNpc2lvblZhbHVlO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShkZWNpc2lvbiwga2V5UHJvcGVydHk9JyRpZCcpe1xuICAgICAgICB2YXIgZSA9IGRlY2lzaW9uLm5vZGUuY2hpbGRFZGdlc1tkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgdmFyIGtleSA9IGRlY2lzaW9uLm5vZGVba2V5UHJvcGVydHldK1wiOlwiKyhlW2tleVByb3BlcnR5XT8gZVtrZXlQcm9wZXJ0eV0gOiBkZWNpc2lvbi5kZWNpc2lvblZhbHVlKzEpO1xuICAgICAgICByZXR1cm4ga2V5LnJlcGxhY2UoL1xcbi9nLCAnICcpO1xuICAgIH1cblxuICAgIGFkZERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpe1xuICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSk7XG4gICAgICAgIHRoaXMuY2hpbGRyZW4ucHVzaChkZWNpc2lvbik7XG4gICAgICAgIHRoaXMua2V5ID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICB9XG5cbiAgICBnZXREZWNpc2lvbihkZWNpc2lvbk5vZGUpe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24uZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKVxuICAgIH1cblxuICAgIHN0YXRpYyBnZXREZWNpc2lvbihkZWNpc2lvbiwgZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgaWYoZGVjaXNpb24ubm9kZT09PWRlY2lzaW9uTm9kZSB8fCBkZWNpc2lvbi5ub2RlLiRpZCA9PT0gZGVjaXNpb25Ob2RlLiRpZCl7XG4gICAgICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgICAgIH1cbiAgICAgICAgZm9yKHZhciBpPTA7IGk8ZGVjaXNpb24uY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgdmFyIGQgPSBEZWNpc2lvbi5nZXREZWNpc2lvbihkZWNpc2lvbi5jaGlsZHJlbltpXSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmKGQpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhdGljIHRvRGVjaXNpb25TdHJpbmcoZGVjaXNpb24sIGV4dGVuZGVkPWZhbHNlLCBrZXlQcm9wZXJ0eT0nbmFtZScsIGluZGVudCA9ICcnKXtcblxuICAgICAgICB2YXIgcmVzID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5KTtcbiAgICAgICAgdmFyIGNoaWxkcmVuUmVzID0gXCJcIjtcblxuICAgICAgICBkZWNpc2lvbi5jaGlsZHJlbi5mb3JFYWNoKGQ9PntcbiAgICAgICAgICAgIGlmKGNoaWxkcmVuUmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9ICdcXG4nK2luZGVudDtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gXCIsIFwiXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZHJlblJlcyArPSBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKGQsZXh0ZW5kZWQsa2V5UHJvcGVydHksIGluZGVudCsnXFx0JylcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aCl7XG4gICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgPSAgJ1xcbicraW5kZW50ICtjaGlsZHJlblJlcztcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gXCIgLSAoXCIgKyBjaGlsZHJlblJlcyArIFwiKVwiO1xuICAgICAgICAgICAgfVxuXG5cblxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcytjaGlsZHJlblJlcztcbiAgICB9XG5cbiAgICB0b0RlY2lzaW9uU3RyaW5nKGluZGVudD1mYWxzZSl7XG4gICAgICAgIHJldHVybiBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKHRoaXMsIGluZGVudClcbiAgICB9XG59XG4iLCJpbXBvcnQge1BvbGljeX0gZnJvbSBcIi4vcG9saWN5XCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY2llc0NvbGxlY3RvcntcbiAgICBwb2xpY2llcyA9IFtdO1xuICAgIHJ1bGVOYW1lPWZhbHNlO1xuXG4gICAgY29uc3RydWN0b3Iocm9vdCwgb3B0aW1hbEZvclJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5ydWxlTmFtZSA9IG9wdGltYWxGb3JSdWxlTmFtZTtcbiAgICAgICAgdGhpcy5jb2xsZWN0KHJvb3QpLmZvckVhY2goKGRlY2lzaW9ucyxpKT0+e1xuICAgICAgICAgICAgdGhpcy5wb2xpY2llcy5wdXNoKG5ldyBQb2xpY3koXCIjXCIrKGkrMSksIGRlY2lzaW9ucykpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYodGhpcy5wb2xpY2llcy5sZW5ndGg9PT0xKXtcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXNbMF0uaWQgPSBcImRlZmF1bHRcIlxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29sbGVjdChyb290KXtcbiAgICAgICAgdmFyIG5vZGVRdWV1ZSA9IFtyb290XTtcbiAgICAgICAgdmFyIG5vZGU7XG4gICAgICAgIHZhciBkZWNpc2lvbk5vZGVzID0gW107XG4gICAgICAgIHdoaWxlKG5vZGVRdWV1ZS5sZW5ndGgpe1xuICAgICAgICAgICAgbm9kZSA9IG5vZGVRdWV1ZS5zaGlmdCgpO1xuXG4gICAgICAgICAgICBpZih0aGlzLnJ1bGVOYW1lICYmICFub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5ydWxlTmFtZSwgJ29wdGltYWwnKSl7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpe1xuICAgICAgICAgICAgICAgIGRlY2lzaW9uTm9kZXMucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGVkZ2UsIGkpPT57XG4gICAgICAgICAgICAgICAgbm9kZVF1ZXVlLnB1c2goZWRnZS5jaGlsZE5vZGUpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmNhcnRlc2lhblByb2R1Y3RPZihkZWNpc2lvbk5vZGVzLm1hcCgoZGVjaXNpb25Ob2RlKT0+e1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9ucz0gW107XG4gICAgICAgICAgICBkZWNpc2lvbk5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuXG4gICAgICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhZWRnZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkRGVjaXNpb25zID0gdGhpcy5jb2xsZWN0KGVkZ2UuY2hpbGROb2RlKTsgLy9hbGwgcG9zc2libGUgY2hpbGQgZGVjaXNpb25zIChjYXJ0ZXNpYW4pXG4gICAgICAgICAgICAgICAgY2hpbGREZWNpc2lvbnMuZm9yRWFjaChjZD0+e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBpKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb25zLnB1c2goZGVjaXNpb24pO1xuICAgICAgICAgICAgICAgICAgICBkZWNpc2lvbi5jaGlsZHJlbiA9IGNkO1xuICAgICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9ucztcbiAgICAgICAgfSkpO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtEZWNpc2lvbn0gZnJvbSBcIi4vZGVjaXNpb25cIjtcblxuZXhwb3J0IGNsYXNzIFBvbGljeXtcbiAgICBpZDtcbiAgICBkZWNpc2lvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGlkLCBkZWNpc2lvbnMpe1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMuZGVjaXNpb25zID0gZGVjaXNpb25zIHx8IFtdO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyAucHVzaChkZWNpc2lvbik7XG4gICAgICAgIHRoaXMua2V5ID0gUG9saWN5LmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KHBvbGljeSl7XG4gICAgICAgIHZhciBrZXkgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+a2V5Kz0oa2V5PyBcIiZcIjogXCJcIikrZC5rZXkpO1xuICAgICAgICByZXR1cm4ga2V5O1xuICAgIH1cblxuICAgIGVxdWFscyhwb2xpY3ksIGlnbm9yZUlkPXRydWUpe1xuICAgICAgICBpZih0aGlzLmtleSAhPSBwb2xpY3kua2V5KXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpZ25vcmVJZCB8fCB0aGlzLmlkID09PSBwb2xpY3kuaWQ7XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS5nZXREZWNpc2lvbih0aGlzLCBkZWNpc2lvbk5vZGUpO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZXREZWNpc2lvbihwb2xpY3ksIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPHBvbGljeS5kZWNpc2lvbnMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gRGVjaXNpb24uZ2V0RGVjaXNpb24ocG9saWN5LmRlY2lzaW9uc1tpXSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmKGRlY2lzaW9uKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgc3RhdGljIHRvUG9saWN5U3RyaW5nKHBvbGljeSwgZXh0ZW5kZWQ9ZmFsc2UsIHByZXBlbmRJZD1mYWxzZSl7XG5cbiAgICAgICAgdmFyIHJlcyA9IFwiXCI7XG4gICAgICAgIHBvbGljeS5kZWNpc2lvbnMuZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihyZXMpe1xuICAgICAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICAgICAgcmVzICs9IFwiXFxuXCJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLCBleHRlbmRlZCwgJ25hbWUnLCAnXFx0Jyk7XG4gICAgICAgIH0pO1xuICAgICAgICBpZihwcmVwZW5kSWQgJiYgcG9saWN5LmlkIT09dW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBwb2xpY3kuaWQrXCIgXCIrcmVzO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfVxuXG5cbiAgICB0b1BvbGljeVN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gUG9saWN5LnRvUG9saWN5U3RyaW5nKHRoaXMsIGluZGVudClcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBNY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3J7XG5cbiAgICBhZGRpdGlvbmFsVmFsaWRhdG9yID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKGFkZGl0aW9uYWxWYWxpZGF0b3Ipe1xuICAgICAgICB0aGlzLmFkZGl0aW9uYWxWYWxpZGF0b3IgPSBhZGRpdGlvbmFsVmFsaWRhdG9yO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlKXtcbiAgICAgICAgaWYodmFsdWU9PT1udWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHBhcnNlZCA9IHBhcnNlRmxvYXQodmFsdWUpO1xuICAgICAgICBpZihwYXJzZWQgIT09IEluZmluaXR5ICYmICFFeHByZXNzaW9uRW5naW5lLnZhbGlkYXRlKHZhbHVlLCB7fSwgZmFsc2UpKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgdmFyIG1heFNhZmVJbnRlZ2VyID0gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgfHwgOTAwNzE5OTI1NDc0MDk5MTsgLy8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgaXMgdW5kZWZpbmVkIGluIElFXG4gICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgMCkgPCAwIHx8ICh2YWx1ZSAhPT0gSW5maW5pdHkgJiYgRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCBtYXhTYWZlSW50ZWdlcik+IDApKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHRoaXMuYWRkaXRpb25hbFZhbGlkYXRvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRkaXRpb25hbFZhbGlkYXRvcihFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKkNvbXB1dGVkIGJhc2UgdmFsdWUgdmFsaWRhdG9yKi9cbmV4cG9ydCBjbGFzcyBQYXlvZmZWYWx1ZVZhbGlkYXRvcntcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmU9ZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSl7XG5cblxuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICB2YXIgbWF4U2FmZUludGVnZXIgPSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiB8fCA5MDA3MTk5MjU0NzQwOTkxOyAvLyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiBpbiB1bmRlZmluZWQgaW4gSUVcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgLW1heFNhZmVJbnRlZ2VyKSA+PSAwICYmIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgbWF4U2FmZUludGVnZXIpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUsIGVkZ2Upe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlLmNvbXBhcmUoMCkgPj0gMCAmJiB2YWx1ZS5jb21wYXJlKDEpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbCwgVmFsaWRhdGlvblJlc3VsdH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UGF5b2ZmVmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3BheW9mZi12YWx1ZS12YWxpZGF0b3JcIjtcblxuZXhwb3J0IGNsYXNzIFRyZWVWYWxpZGF0b3Ige1xuXG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5wcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yID0gbmV3IFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMucGF5b2ZmVmFsdWVWYWxpZGF0b3IgPSBuZXcgUGF5b2ZmVmFsdWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUobm9kZXMpIHtcblxuICAgICAgICB2YXIgdmFsaWRhdGlvblJlc3VsdCA9IG5ldyBWYWxpZGF0aW9uUmVzdWx0KCk7XG5cbiAgICAgICAgbm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgdGhpcy52YWxpZGF0ZU5vZGUobiwgdmFsaWRhdGlvblJlc3VsdCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB2YWxpZGF0aW9uUmVzdWx0O1xuICAgIH1cblxuICAgIHZhbGlkYXRlTm9kZShub2RlLCB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKSkge1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdpbmNvbXBsZXRlUGF0aCcsIG5vZGUpXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuICAgICAgICB2YXIgd2l0aEhhc2ggPSBmYWxzZTtcbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwcm9iYWJpbGl0eScsIHRydWUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHkgPSBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghRXhwcmVzc2lvbkVuZ2luZS5pc0hhc2goZS5wcm9iYWJpbGl0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3Ioe25hbWU6ICdpbnZhbGlkUHJvYmFiaWxpdHknLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwcm9iYWJpbGl0eScsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgcHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZS5wYXlvZmYuZm9yRWFjaCgocmF3UGF5b2ZmLCBwYXlvZmZJbmRleCk9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHBhdGggPSAncGF5b2ZmWycgKyBwYXlvZmZJbmRleCArICddJztcbiAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkocGF0aCwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGUuY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgcGF5b2ZmSW5kZXgpO1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3Ioe25hbWU6ICdpbnZhbGlkUGF5b2ZmJywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KHBhdGgsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuXG5cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgaWYgKGlzTmFOKHByb2JhYmlsaXR5U3VtKSB8fCAhcHJvYmFiaWxpdHlTdW0uZXF1YWxzKDEpKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcigncHJvYmFiaWxpdHlEb05vdFN1bVVwVG8xJywgbm9kZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuXG4gICAgICAgIHJldHVybiB2YWxpZGF0aW9uUmVzdWx0O1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vc3JjL2luZGV4J1xuIl19
