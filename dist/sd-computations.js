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

        /* alias function for checkValidityAndRecomputeObjective*/

    }, {
        key: "recompute",
        value: function recompute() {
            return this.checkValidityAndRecomputeObjective.apply(this, arguments);
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
            } else if (node instanceof _sdModel.domain.ChanceNode) {
                node.displayValue('optimal', true);
                node.childEdges.forEach(function (e) {
                    e.displayValue('optimal', true);
                    _this8.displayPolicyForNode(e.childNode, policy);
                });
            } else if (node instanceof _sdModel.domain.TerminalNode) {
                node.displayValue('optimal', true);
            }
        }
    }]);

    return ComputationsManager;
}();

},{"./expressions-evaluator":5,"./jobs/job-instance-manager":60,"./jobs/jobs-manager":62,"./objective/objective-rules-manager":63,"./operations/operations-manager":79,"./policies/policy":82,"./validation/mcdm-weight-value-validator":83,"./validation/tree-validator":86,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],4:[function(require,module,exports){
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
        key: 'evalPayoff',
        value: function evalPayoff(edge) {
            var index = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;

            if (_sdExpressionEngine.ExpressionEngine.hasAssignmentExpression(edge.payoff[index])) {
                return null;
            }
            return this.expressionEngine.eval(edge.payoff[index], true, edge.parentNode.expressionScope);
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
                                e.computedValue(null, path, _this2.evalPayoff(e, payoffIndex));
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

},{"./computations-engine":2,"./computations-manager":3,"./expressions-evaluator":5,"./jobs/index":59}],7:[function(require,module,exports){
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
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("defaultWeight", _jobParameterDefinition.PARAMETER_TYPE.NUMBER_EXPRESSION).set("singleValueValidator", function (v, allVals) {
                return v >= 0 && v >= _jobParameterDefinition.JobParameterDefinition.computeNumberExpression(allVals['weightLowerBound']) && v <= _jobParameterDefinition.JobParameterDefinition.computeNumberExpression(allVals['weightUpperBound']);
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
                defaultWeight: 0,
                weightUpperBound: Infinity
            };
        }
    }]);

    return LeagueTableJobParameters;
}(_jobParameters.JobParameters);

},{"../../engine/job-parameter-definition":46,"../../engine/job-parameters":47,"sd-utils":"sd-utils"}],8:[function(require,module,exports){
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
                var headers = ['policy_id', 'policy', jobResult.payoffNames[0], jobResult.payoffNames[1], 'dominated_by', 'extended-dominated_by', 'incratio', 'optimal', 'optimal_for_default_weight'];
                result.push(headers);
            }

            jobResult.rows.forEach(function (row) {
                row.policies.forEach(function (policy) {
                    var rowCells = [row.id, _policy.Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription), row.payoffs[1], row.payoffs[0], row.dominatedBy, row.extendedDominatedBy === null ? null : row.extendedDominatedBy[0] + ', ' + row.extendedDominatedBy[1], row.incratio, row.optimal, row.optimalForDefaultWeight];
                    result.push(rowCells);
                });
            });

            return result;
        }
    }]);

    return LeagueTableJob;
}(_simpleJob.SimpleJob);

},{"../../../policies/policy":82,"../../engine/simple-job":55,"./league-table-job-parameters":7,"./steps/calculate-step":9,"sd-expression-engine":"sd-expression-engine"}],9:[function(require,module,exports){
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
                    incratio: null,
                    optimal: false,
                    optimalForDefaultWeight: false
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
            var defaultWeight = params.value("defaultWeight");
            var weightUpperBound = params.value("weightUpperBound");

            //mark optimal for weight in [weightLowerBound, weightUpperBound] and optimal for default Weight
            var lastLELower = null;
            var lastLELowerDef = null;
            rows.slice().filter(function (r) {
                return !r.dominatedBy && !r.extendedDominatedBy;
            }).sort(function (a, b) {
                return a.incratio - b.incratio;
            }).forEach(function (row, i, arr) {

                if (row.incratio < weightLowerBound) {
                    lastLELower = row;
                }
                if (row.incratio < defaultWeight) {
                    lastLELowerDef = row;
                }

                row.optimal = row.incratio >= weightLowerBound && row.incratio <= weightUpperBound;
                row.optimalForDefaultWeight = row.incratio == defaultWeight;
            });
            if (lastLELower) {
                lastLELower.optimal = true;
            }

            if (lastLELowerDef) {
                lastLELowerDef.optimalForDefaultWeight = true;
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
                defaultWeight: _sdExpressionEngine.ExpressionEngine.toFloat(defaultWeight),
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

},{"../../../../policies/policies-collector":81,"../../../../policies/policy":82,"../../../../validation/tree-validator":86,"../../../engine/job-status":53,"../../../engine/step":58,"sd-expression-engine":"sd-expression-engine"}],10:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":46,"../../engine/job-parameters":47,"sd-utils":"sd-utils"}],11:[function(require,module,exports){
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

},{"../../../validation/tree-validator":86,"../../engine/batch/batch-step":28,"../../engine/job":54,"../../engine/job-status":53,"../../engine/simple-job":55,"../../engine/step":58,"./recompute-job-parameters":10}],12:[function(require,module,exports){
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

},{"../../../engine/job-parameter-definition":46,"../../../engine/job-parameters":47,"sd-utils":"sd-utils"}],13:[function(require,module,exports){
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

},{"../../../../policies/policy":82,"../../../engine/simple-job":55,"./sensitivity-analysis-job-parameters":12,"./steps/calculate-step":14,"./steps/init-policies-step":15,"./steps/prepare-variables-step":16,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],14:[function(require,module,exports){
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

},{"../../../../../policies/policy":82,"../../../../../validation/tree-validator":86,"../../../../engine/batch/batch-step":28,"../../../../engine/exceptions/job-computation-exception":31,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],15:[function(require,module,exports){
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

},{"../../../../../policies/policies-collector":81,"../../../../engine/job-status":53,"../../../../engine/step":58}],16:[function(require,module,exports){
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

},{"../../../../../computations-utils":4,"../../../../engine/job-status":53,"../../../../engine/step":58,"sd-utils":"sd-utils"}],17:[function(require,module,exports){
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

},{"../../../engine/job-parameter-definition":46,"../../../engine/job-parameters":47,"sd-utils":"sd-utils"}],18:[function(require,module,exports){
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

},{"../../../../engine/job-status":53,"../../../../engine/step":58,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],20:[function(require,module,exports){
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

},{"../../../../engine/exceptions/job-computation-exception":31,"../../n-way/steps/calculate-step":14,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],21:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SpiderPlotJobParameters = undefined;

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

var SpiderPlotJobParameters = exports.SpiderPlotJobParameters = function (_JobParameters) {
    _inherits(SpiderPlotJobParameters, _JobParameters);

    function SpiderPlotJobParameters() {
        _classCallCheck(this, SpiderPlotJobParameters);

        return _possibleConstructorReturn(this, (SpiderPlotJobParameters.__proto__ || Object.getPrototypeOf(SpiderPlotJobParameters)).apply(this, arguments));
    }

    _createClass(SpiderPlotJobParameters, [{
        key: "initDefinitions",
        value: function initDefinitions() {
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("id", _jobParameterDefinition.PARAMETER_TYPE.STRING, 1, 1, true));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("ruleName", _jobParameterDefinition.PARAMETER_TYPE.STRING));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("percentageChangeRange", _jobParameterDefinition.PARAMETER_TYPE.NUMBER).set("singleValueValidator", function (v) {
                return v > 0 && v <= 100;
            }));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("length", _jobParameterDefinition.PARAMETER_TYPE.INTEGER).set("singleValueValidator", function (v) {
                return v >= 0;
            }));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("variables", [new _jobParameterDefinition.JobParameterDefinition("name", _jobParameterDefinition.PARAMETER_TYPE.STRING)], 1, Infinity, false, null, function (values) {
                return _sdUtils.Utils.isUnique(values, function (v) {
                    return v["name"];
                });
            } //Variable names should be unique
            ));
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("failOnInvalidTree", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                failOnInvalidTree: true
            };
        }
    }]);

    return SpiderPlotJobParameters;
}(_jobParameters.JobParameters);

},{"../../../engine/job-parameter-definition":46,"../../../engine/job-parameters":47,"sd-utils":"sd-utils"}],22:[function(require,module,exports){
"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.SpiderPlotJob = undefined;

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

var _calculateStep = require("./steps/calculate-step");

var _spiderPlotJobParameters = require("./spider-plot-job-parameters");

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

var SpiderPlotJob = exports.SpiderPlotJob = function (_SimpleJob) {
    _inherits(SpiderPlotJob, _SimpleJob);

    function SpiderPlotJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, SpiderPlotJob);

        var _this = _possibleConstructorReturn(this, (SpiderPlotJob.__proto__ || Object.getPrototypeOf(SpiderPlotJob)).call(this, "spider-plot", jobRepository));

        _this.addStep(new _calculateStep.CalculateStep(jobRepository, expressionsEvaluator, objectiveRulesManager));
        return _this;
    }

    _createClass(SpiderPlotJob, [{
        key: "createJobParameters",
        value: function createJobParameters(values) {
            return new _spiderPlotJobParameters.SpiderPlotJobParameters(values);
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
            if (execution.stepExecutions.length < 1) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[0].getProgress(execution.stepExecutions[0]);
        }
    }, {
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            var withHeaders = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var result = [];
            if (withHeaders) {
                result.push(['variable_name', 'policy_no'].concat(jobResult.percentageRangeValues));
            }

            jobResult.rows.forEach(function (row, index) {

                result.push.apply(result, _toConsumableArray(row.payoffs.map(function (payoffs, policyIndex) {
                    return [row.variableName, policyIndex + 1].concat(_toConsumableArray(payoffs));
                })));
            });

            return result;
        }
    }]);

    return SpiderPlotJob;
}(_simpleJob.SimpleJob);

},{"../../../engine/simple-job":55,"./spider-plot-job-parameters":21,"./steps/calculate-step":23}],23:[function(require,module,exports){
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

var _jobComputationException = require("../../../../engine/exceptions/job-computation-exception");

var _batchStep = require("../../../../engine/batch/batch-step");

var _treeValidator = require("../../../../../validation/tree-validator");

var _policy = require("../../../../../policies/policy");

var _policiesCollector = require("../../../../../policies/policies-collector");

var _computationsUtils = require("../../../../../computations-utils");

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
            var percentageChangeRange = params.value("percentageChangeRange");
            var length = params.value("length");
            var variables = params.value("variables");

            this.objectiveRulesManager.setCurrentRuleByName(ruleName);
            var variableNames = params.value("variables").map(function (v) {
                return v.name;
            });
            stepExecution.executionContext.put("variableNames", variableNames);
            var data = stepExecution.getData();

            var treeRoot = data.getRoots()[0];
            var payoff = treeRoot.computedValue(ruleName, 'payoff');

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalExpressions(data);

            this.objectiveRulesManager.recomputeTree(treeRoot, false);

            var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot, ruleName);

            var defaultValues = {};
            _sdUtils.Utils.forOwn(data.expressionScope, function (v, k) {
                defaultValues[k] = _this2.toFloat(v);
            });

            var percentageRangeValues = _computationsUtils.ComputationsUtils.sequence(-percentageChangeRange, percentageChangeRange, 2 * length + 1);

            var variableValues = [];

            variables.forEach(function (v) {
                var defVal = defaultValues[v.name];
                variableValues.push(percentageRangeValues.map(function (p) {
                    return _this2.toFloat(_sdExpressionEngine.ExpressionEngine.add(defVal, _sdExpressionEngine.ExpressionEngine.multiply(_sdExpressionEngine.ExpressionEngine.divide(p, 100), defVal)));
                }));
            });

            if (!jobResult.data) {
                jobResult.data = {
                    variableNames: variableNames,
                    defaultValues: defaultValues,
                    percentageRangeValues: percentageRangeValues,
                    defaultPayoff: this.toFloat(payoff)[0],
                    policies: policiesCollector.policies,
                    rows: []
                };
            }

            stepExecution.getJobExecutionContext().put("variableValues", variableValues);
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
        value: function processItem(stepExecution, item, itemIndex, jobResult) {
            var _this3 = this;

            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            var failOnInvalidTree = params.value("failOnInvalidTree");
            var data = stepExecution.getData();
            var treeRoot = data.getRoots()[0];
            var variableNames = stepExecution.executionContext.get("variableNames");
            var variableName = variableNames[itemIndex];

            var payoffs = jobResult.data.policies.map(function (policy) {
                return [];
            });

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalGlobalCode(data);

            item.forEach(function (variableValue) {

                data.expressionScope[variableName] = variableValue;

                _this3.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
                var vr = _this3.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));
                var valid = vr.isValid();

                if (!valid && failOnInvalidTree) {
                    var errorData = {
                        variables: {}
                    };
                    errorData.variables[variableName] = variableValue;

                    throw new _jobComputationException.JobComputationException("computations", errorData);
                }

                jobResult.data.policies.forEach(function (policy, policyIndex) {
                    _this3.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                    var payoff = treeRoot.computedValue(ruleName, 'payoff')[0];
                    payoffs[policyIndex].push(_this3.toFloat(payoff));
                });
            });

            return {
                variableName: variableName,
                variableIndex: itemIndex,
                variableValues: item,
                payoffs: payoffs
            };
        }
    }, {
        key: "writeChunk",
        value: function writeChunk(stepExecution, items, jobResult) {
            var _jobResult$data$rows;

            (_jobResult$data$rows = jobResult.data.rows).push.apply(_jobResult$data$rows, _toConsumableArray(items));
        }
    }, {
        key: "toFloat",
        value: function toFloat(v) {
            return _sdExpressionEngine.ExpressionEngine.toFloat(v);
        }
    }]);

    return CalculateStep;
}(_batchStep.BatchStep);

},{"../../../../../computations-utils":4,"../../../../../policies/policies-collector":81,"../../../../../policies/policy":82,"../../../../../validation/tree-validator":86,"../../../../engine/batch/batch-step":28,"../../../../engine/exceptions/job-computation-exception":31,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],24:[function(require,module,exports){
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

var _jobComputationException = require("../../../../engine/exceptions/job-computation-exception");

var _batchStep = require("../../../../engine/batch/batch-step");

var _treeValidator = require("../../../../../validation/tree-validator");

var _policy = require("../../../../../policies/policy");

var _policiesCollector = require("../../../../../policies/policies-collector");

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

            var treeRoot = data.getRoots()[0];
            var payoff = treeRoot.computedValue(ruleName, 'payoff');

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalExpressions(data);

            this.objectiveRulesManager.recomputeTree(treeRoot, false);

            var policiesCollector = new _policiesCollector.PoliciesCollector(treeRoot, ruleName);

            var defaultValues = {};
            _sdUtils.Utils.forOwn(data.expressionScope, function (v, k) {
                defaultValues[k] = _this2.toFloat(v);
            });

            if (!jobResult.data) {
                jobResult.data = {
                    variableNames: variableNames,
                    defaultValues: defaultValues,
                    variableExtents: variableValues.map(function (v) {
                        return [v[0], v[v.length - 1]];
                    }),
                    defaultPayoff: this.toFloat(payoff)[0],
                    policies: policiesCollector.policies,
                    rows: []
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
        value: function processItem(stepExecution, item, itemIndex, jobResult) {
            var _this3 = this;

            var params = stepExecution.getJobParameters();
            var ruleName = params.value("ruleName");
            var failOnInvalidTree = params.value("failOnInvalidTree");
            var data = stepExecution.getData();
            var treeRoot = data.getRoots()[0];
            var variableNames = stepExecution.executionContext.get("variableNames");
            var variableName = variableNames[itemIndex];

            var extents = jobResult.data.policies.map(function (policy) {
                return {
                    min: Infinity,
                    max: -Infinity
                };
            });

            var values = jobResult.data.policies.map(function (policy) {
                return {
                    min: null,
                    max: null
                };
            });

            this.expressionsEvaluator.clear(data);
            this.expressionsEvaluator.evalGlobalCode(data);

            item.forEach(function (variableValue) {

                data.expressionScope[variableName] = variableValue;

                _this3.expressionsEvaluator.evalExpressionsForNode(data, treeRoot);
                var vr = _this3.treeValidator.validate(data.getAllNodesInSubtree(treeRoot));
                var valid = vr.isValid();

                if (!valid && failOnInvalidTree) {
                    var errorData = {
                        variables: {}
                    };
                    errorData.variables[variableName] = variableValue;

                    throw new _jobComputationException.JobComputationException("computations", errorData);
                }

                jobResult.data.policies.forEach(function (policy, policyIndex) {
                    _this3.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                    var payoff = treeRoot.computedValue(ruleName, 'payoff')[0];

                    if (payoff < extents[policyIndex].min) {
                        extents[policyIndex].min = payoff;
                        values[policyIndex].min = variableValue;
                    }

                    if (payoff > extents[policyIndex].max) {
                        extents[policyIndex].max = payoff;
                        values[policyIndex].max = variableValue;
                    }
                });
            });

            return {
                variableName: variableName,
                variableIndex: itemIndex,
                extents: extents.map(function (e) {
                    return [_this3.toFloat(e.min), _this3.toFloat(e.max)];
                }),
                extentVariableValues: values.map(function (v) {
                    return [_this3.toFloat(v.min), _this3.toFloat(v.max)];
                })
            };
        }
    }, {
        key: "writeChunk",
        value: function writeChunk(stepExecution, items, jobResult) {
            var _jobResult$data$rows;

            (_jobResult$data$rows = jobResult.data.rows).push.apply(_jobResult$data$rows, _toConsumableArray(items));
        }
    }, {
        key: "postProcess",
        value: function postProcess(stepExecution, jobResult) {
            jobResult.data.rows.sort(function (a, b) {
                return b.extents[0][1] - b.extents[0][0] - (a.extents[0][1] - a.extents[0][0]);
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

},{"../../../../../policies/policies-collector":81,"../../../../../policies/policy":82,"../../../../../validation/tree-validator":86,"../../../../engine/batch/batch-step":28,"../../../../engine/exceptions/job-computation-exception":31,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],25:[function(require,module,exports){
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

    function PrepareVariablesStep(jobRepository) {
        _classCallCheck(this, PrepareVariablesStep);

        return _possibleConstructorReturn(this, (PrepareVariablesStep.__proto__ || Object.getPrototypeOf(PrepareVariablesStep)).call(this, "prepare_variables", jobRepository));
    }

    _createClass(PrepareVariablesStep, [{
        key: "doExecute",
        value: function doExecute(stepExecution) {
            var params = stepExecution.getJobParameters();
            var variables = params.value("variables");

            var variableValues = [];
            variables.forEach(function (v) {
                variableValues.push(_computationsUtils.ComputationsUtils.sequence(v.min, v.max, v.length));
            });
            stepExecution.getJobExecutionContext().put("variableValues", variableValues);

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return PrepareVariablesStep;
}(_step.Step);

},{"../../../../../computations-utils":4,"../../../../engine/job-status":53,"../../../../engine/step":58,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],26:[function(require,module,exports){
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
            this.definitions.push(new _jobParameterDefinition.JobParameterDefinition("failOnInvalidTree", _jobParameterDefinition.PARAMETER_TYPE.BOOLEAN));
        }
    }, {
        key: "initDefaultValues",
        value: function initDefaultValues() {
            this.values = {
                id: _sdUtils.Utils.guid(),
                failOnInvalidTree: true
            };
        }
    }]);

    return TornadoDiagramJobParameters;
}(_jobParameters.JobParameters);

},{"../../../engine/job-parameter-definition":46,"../../../engine/job-parameters":47,"sd-utils":"sd-utils"}],27:[function(require,module,exports){
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

var _calculateStep = require("./steps/calculate-step");

var _tornadoDiagramJobParameters = require("./tornado-diagram-job-parameters");

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

var TornadoDiagramJob = exports.TornadoDiagramJob = function (_SimpleJob) {
    _inherits(TornadoDiagramJob, _SimpleJob);

    function TornadoDiagramJob(jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, TornadoDiagramJob);

        var _this = _possibleConstructorReturn(this, (TornadoDiagramJob.__proto__ || Object.getPrototypeOf(TornadoDiagramJob)).call(this, "tornado-diagram", jobRepository));

        _this.addStep(new _prepareVariablesStep.PrepareVariablesStep(jobRepository));
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

            if (execution.stepExecutions.length <= 1) {
                return {
                    total: 1,
                    current: 0
                };
            }

            return this.steps[1].getProgress(execution.stepExecutions[1]);
        }
    }, {
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            var withHeaders = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var result = [];
            if (withHeaders) {
                result.push(['variable_name', 'default_var_value', "min_var_value", "max_var_value", 'default_payoff', "min_payoff", "max_payoff", "policy_no"]);
            }

            jobResult.rows.forEach(function (row, index) {

                result.push.apply(result, _toConsumableArray(row.extents.map(function (extent, policyIndex) {
                    return [row.variableName, jobResult.defaultValues[row.variableName], row.extentVariableValues[policyIndex][0], row.extentVariableValues[policyIndex][1], jobResult.defaultPayoff, extent[0], extent[1], policyIndex + 1];
                })));
            });

            return result;
        }
    }]);

    return TornadoDiagramJob;
}(_simpleJob.SimpleJob);

},{"../../../engine/simple-job":55,"./steps/calculate-step":24,"./steps/prepare-variables-step":25,"./tornado-diagram-job-parameters":26}],28:[function(require,module,exports){
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

},{"../exceptions/job-interrupted-exception":35,"../job-status":53,"../step":58,"sd-utils":"sd-utils"}],29:[function(require,module,exports){
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

},{}],30:[function(require,module,exports){
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

},{"./extendable-error":29,"./job-data-invalid-exception":32,"./job-execution-already-running-exception":33,"./job-instance-already-complete-exception":34,"./job-interrupted-exception":35,"./job-parameters-invalid-exception":36,"./job-restart-exception":37}],31:[function(require,module,exports){
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

},{"./extendable-error":29}],32:[function(require,module,exports){
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

},{"./extendable-error":29}],33:[function(require,module,exports){
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

},{"./extendable-error":29}],34:[function(require,module,exports){
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

},{"./extendable-error":29}],35:[function(require,module,exports){
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

},{"./extendable-error":29}],36:[function(require,module,exports){
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

},{"./extendable-error":29}],37:[function(require,module,exports){
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

},{"./extendable-error":29}],38:[function(require,module,exports){
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

},{"sd-utils":"sd-utils"}],39:[function(require,module,exports){
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

},{"./exceptions":30,"./execution-context":38,"./job":54,"./job-execution":42,"./job-execution-flag":40,"./job-execution-listener":41,"./job-instance":43,"./job-key-generator":44,"./job-launcher":45,"./job-parameter-definition":46,"./job-parameters":47,"./job-status":53,"./simple-job":55,"./step":58,"./step-execution":57,"./step-execution-listener":56}],40:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
var JOB_EXECUTION_FLAG = exports.JOB_EXECUTION_FLAG = {
    STOP: 'STOP'
};

},{}],41:[function(require,module,exports){
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

},{}],42:[function(require,module,exports){
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

},{"./execution-context":38,"./job-status":53,"./step-execution":57,"sd-utils":"sd-utils"}],43:[function(require,module,exports){
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

},{}],44:[function(require,module,exports){
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

},{}],45:[function(require,module,exports){
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

},{"./exceptions/job-data-invalid-exception":32,"./exceptions/job-parameters-invalid-exception":36,"./exceptions/job-restart-exception":37,"./job-status":53,"sd-utils":"sd-utils"}],46:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],47:[function(require,module,exports){
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

},{"./job-parameter-definition":46,"sd-utils":"sd-utils"}],48:[function(require,module,exports){
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

},{"../execution-context":38,"../job-execution":42,"../job-instance":43,"../step-execution":57,"./job-repository":49,"idb":1,"sd-model":"sd-model","sd-utils":"sd-utils"}],49:[function(require,module,exports){
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

},{"../exceptions/job-execution-already-running-exception":33,"../exceptions/job-instance-already-complete-exception":34,"../execution-context":38,"../job-execution":42,"../job-instance":43,"../job-key-generator":44,"../job-result":52,"../job-status":53,"../step-execution":57,"sd-model":"sd-model","sd-utils":"sd-utils"}],50:[function(require,module,exports){
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

},{"./job-repository":49,"sd-utils":"sd-utils"}],51:[function(require,module,exports){
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

},{"./job-repository":49,"./simple-job-repository":50,"sd-utils":"sd-utils"}],52:[function(require,module,exports){
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

},{"./execution-context":38,"./job-status":53,"./step-execution":57,"sd-utils":"sd-utils"}],53:[function(require,module,exports){
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

},{}],54:[function(require,module,exports){
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

},{"./exceptions/job-data-invalid-exception":32,"./exceptions/job-interrupted-exception":35,"./exceptions/job-parameters-invalid-exception":36,"./job-execution-flag":40,"./job-result":52,"./job-status":53,"sd-utils":"sd-utils"}],55:[function(require,module,exports){
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

},{"./exceptions/job-interrupted-exception":35,"./exceptions/job-restart-exception":37,"./execution-context":38,"./job":54,"./job-execution-flag":40,"./job-status":53,"./step":58,"sd-utils":"sd-utils"}],56:[function(require,module,exports){
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

},{}],57:[function(require,module,exports){
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

},{"./execution-context":38,"./job-execution":42,"./job-status":53,"sd-utils":"sd-utils"}],58:[function(require,module,exports){
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

},{"./exceptions/job-interrupted-exception":35,"./job-status":53,"sd-utils":"sd-utils"}],59:[function(require,module,exports){
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

},{"./engine/index":39,"./job-worker":61,"./jobs-manager":62}],60:[function(require,module,exports){
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

},{"./engine/job-execution-listener":41,"./engine/job-instance":43,"./engine/job-status":53,"sd-utils":"sd-utils"}],61:[function(require,module,exports){
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

},{}],62:[function(require,module,exports){
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

var _spiderPlotJob = require("./configurations/sensitivity-analysis/spider-plot/spider-plot-job");

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
            this.registerJob(new _spiderPlotJob.SpiderPlotJob(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
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

},{"./configurations/league-table/league-table-job":8,"./configurations/recompute/recompute-job":11,"./configurations/sensitivity-analysis/n-way/sensitivity-analysis-job":13,"./configurations/sensitivity-analysis/probabilistic/probabilistic-sensitivity-analysis-job":18,"./configurations/sensitivity-analysis/spider-plot/spider-plot-job":22,"./configurations/sensitivity-analysis/tornado-diagram/tornado-diagram-job":27,"./engine/job-execution-flag":40,"./engine/job-execution-listener":41,"./engine/job-launcher":45,"./engine/job-parameters":47,"./engine/job-repository/idb-job-repository":48,"./engine/job-repository/simple-job-repository":50,"./engine/job-repository/timeout-job-repository":51,"./engine/job-status":53,"./job-worker":61,"sd-utils":"sd-utils"}],63:[function(require,module,exports){
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

},{"./rules":66,"./rules/max-max-rule":67,"./rules/max-min-rule":68,"./rules/min-max-rule":71,"./rules/min-min-rule":72,"sd-model":"sd-model","sd-utils":"sd-utils"}],64:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],65:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],66:[function(require,module,exports){
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

},{"./expected-value-maximization-rule":64,"./expected-value-minimization-rule":65,"./maxi-max-rule":69,"./maxi-min-rule":70,"./mini-max-rule":73,"./mini-min-rule":74,"./objective-rule":76}],67:[function(require,module,exports){
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

},{"./multi-criteria-rule":75}],68:[function(require,module,exports){
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

},{"./multi-criteria-rule":75}],69:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],70:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],71:[function(require,module,exports){
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

},{"./multi-criteria-rule":75}],72:[function(require,module,exports){
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

},{"./multi-criteria-rule":75}],73:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],74:[function(require,module,exports){
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

},{"./objective-rule":76,"sd-model":"sd-model","sd-utils":"sd-utils"}],75:[function(require,module,exports){
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

},{"../../policies/policy":82,"./objective-rule":76,"sd-model":"sd-model"}],76:[function(require,module,exports){
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

},{"../../policies/policy":82,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],77:[function(require,module,exports){
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

},{"../validation/tree-validator":86,"./operation":78,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],78:[function(require,module,exports){
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

},{}],79:[function(require,module,exports){
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

},{"./flip-subtree":77}],80:[function(require,module,exports){
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

},{}],81:[function(require,module,exports){
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

},{"./decision":80,"./policy":82,"sd-model":"sd-model","sd-utils":"sd-utils"}],82:[function(require,module,exports){
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

},{"./decision":80}],83:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],84:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],85:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],86:[function(require,module,exports){
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

},{"./payoff-value-validator":84,"./probability-value-validator":85,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model"}],"sd-computations":[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmMvY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyYy9jb21wdXRhdGlvbnMtbWFuYWdlci5qcyIsInNyYy9jb21wdXRhdGlvbnMtdXRpbHMuanMiLCJzcmMvZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvc3BpZGVyLXBsb3Qvc3BpZGVyLXBsb3Qtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zcGlkZXItcGxvdC9zcGlkZXItcGxvdC1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zcGlkZXItcGxvdC9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXAuanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9leHRlbmRhYmxlLWVycm9yLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmMvam9icy9lbmdpbmUvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItaW5zdGFuY2UuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWxhdW5jaGVyLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlc3VsdC5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2Itc3RhdHVzLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi5qcyIsInNyYy9qb2JzL2VuZ2luZS9zaW1wbGUtam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAuanMiLCJzcmMvam9icy9pbmRleC5qcyIsInNyYy9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjL2pvYnMvam9iLXdvcmtlci5qcyIsInNyYy9qb2JzL2pvYnMtbWFuYWdlci5qcyIsInNyYy9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvaW5kZXguanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21heC1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWF4LW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1heC1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9taW4tbWF4LXJ1bGUuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21pbi1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbXVsdGktY3JpdGVyaWEtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmMvb3BlcmF0aW9ucy9mbGlwLXN1YnRyZWUuanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb24uanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmMvcG9saWNpZXMvZGVjaXNpb24uanMiLCJzcmMvcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yLmpzIiwic3JjL3BvbGljaWVzL3BvbGljeS5qcyIsInNyYy92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyYy92YWxpZGF0aW9uL3BheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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OztrQkFBQSxBQUFFLE9BQUYsQUFBUyxRQUFRLFVBQUEsQUFBQyxXQUFELEFBQVksYUFBZSxBQUN4Qzt3QkFBSSxPQUFPLFlBQUEsQUFBWSxjQUF2QixBQUFxQyxBQUNyQztzQkFBQSxBQUFFLGlCQUFGLEFBQW1CLE1BQW5CLEFBQXlCLEFBQ3pCO3dCQUFJLFNBQVMsRUFBQSxBQUFFLG1CQUFGLEFBQXFCLFdBQWxDLEFBQWEsQUFBZ0MsQUFDN0M7d0JBQUksQ0FBQyxPQUFBLEFBQUsscUJBQUwsQUFBMEIsU0FBL0IsQUFBSyxBQUFtQyxTQUFTLEFBQzdDO3lDQUFBLEFBQWlCLFNBQVMsRUFBQyxNQUFELEFBQU8saUJBQWlCLE1BQU0sRUFBQyxVQUFVLElBQW5FLEFBQTBCLEFBQThCLEFBQWUsT0FBdkUsQUFBNEUsQUFDNUU7MEJBQUEsQUFBRSxpQkFBRixBQUFtQixNQUFuQixBQUF5QixBQUM1QjtBQUNKO0FBUkQsQUFXSDtBQTNCRCxBQTRCQTtnQkFBSSxnQkFBZ0IsZ0JBQXBCLEFBQTBCLFlBQVksQUFDbEM7b0JBQUksTUFBQSxBQUFNLG1CQUFtQixDQUFDLGVBQUEsQUFBZSxPQUE3QyxBQUE4QixBQUFzQixJQUFJLEFBQ3BEO3FDQUFBLEFBQWlCLFNBQWpCLEFBQTBCLDRCQUExQixBQUFzRCxBQUN6RDtBQUNKO0FBR0Q7O21CQUFBLEFBQU8sQUFDVjs7Ozs7Ozs7Ozs7Ozs7OztBQ3pFTCwyQ0FBQTtpREFBQTs7Z0JBQUE7d0JBQUE7b0JBQUE7QUFBQTtBQUFBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiB0b0FycmF5KGFycikge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHJlcXVlc3Q7XG4gICAgdmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuICAgICAgcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG5cbiAgICBwLnJlcXVlc3QgPSByZXF1ZXN0O1xuICAgIHJldHVybiBwO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcbiAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgICAgICAgIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG4gICAgdGhpcy5faW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdtdWx0aUVudHJ5JyxcbiAgICAndW5pcXVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnZ2V0JyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcbiAgICB0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcbiAgICAnZGlyZWN0aW9uJyxcbiAgICAna2V5JyxcbiAgICAncHJpbWFyeUtleScsXG4gICAgJ3ZhbHVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcbiAgICAndXBkYXRlJyxcbiAgICAnZGVsZXRlJ1xuICBdKTtcblxuICAvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuICBbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgIEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjdXJzb3IgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgY3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcbiAgICB0aGlzLl9zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ2luZGV4TmFtZXMnLFxuICAgICdhdXRvSW5jcmVtZW50J1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAncHV0JyxcbiAgICAnYWRkJyxcbiAgICAnZGVsZXRlJyxcbiAgICAnY2xlYXInLFxuICAgICdnZXQnLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnZGVsZXRlSW5kZXgnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcbiAgICB0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcbiAgICAnb2JqZWN0U3RvcmVOYW1lcycsXG4gICAgJ21vZGUnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG4gICAgJ2Fib3J0J1xuICBdKTtcblxuICBmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgICB0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuICAgIHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICB9XG5cbiAgVXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2RlbGV0ZU9iamVjdFN0b3JlJyxcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIERCKGRiKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgfVxuXG4gIERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgLy8gQWRkIGN1cnNvciBpdGVyYXRvcnNcbiAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuICBbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcbiAgICBbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGVbZnVuY05hbWUucmVwbGFjZSgnb3BlbicsICdpdGVyYXRlJyldID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAgIHZhciBuYXRpdmVPYmplY3QgPSB0aGlzLl9zdG9yZSB8fCB0aGlzLl9pbmRleDtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuYXRpdmVPYmplY3RbZnVuY05hbWVdLmFwcGx5KG5hdGl2ZU9iamVjdCwgYXJncy5zbGljZSgwLCAtMSkpO1xuICAgICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIHBvbHlmaWxsIGdldEFsbFxuICBbSW5kZXgsIE9iamVjdFN0b3JlXS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgaWYgKENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwpIHJldHVybjtcbiAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsID0gZnVuY3Rpb24ocXVlcnksIGNvdW50KSB7XG4gICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgdmFyIGl0ZW1zID0gW107XG5cbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgIGluc3RhbmNlLml0ZXJhdGVDdXJzb3IocXVlcnksIGZ1bmN0aW9uKGN1cnNvcikge1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaXRlbXMucHVzaChjdXJzb3IudmFsdWUpO1xuXG4gICAgICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQgJiYgaXRlbXMubGVuZ3RoID09IGNvdW50KSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgdmFyIGV4cCA9IHtcbiAgICBvcGVuOiBmdW5jdGlvbihuYW1lLCB2ZXJzaW9uLCB1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnb3BlbicsIFtuYW1lLCB2ZXJzaW9uXSk7XG4gICAgICB2YXIgcmVxdWVzdCA9IHAucmVxdWVzdDtcblxuICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgdXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgICBtb2R1bGUuZXhwb3J0cy5kZWZhdWx0ID0gbW9kdWxlLmV4cG9ydHM7XG4gIH1cbiAgZWxzZSB7XG4gICAgc2VsZi5pZGIgPSBleHA7XG4gIH1cbn0oKSk7XG4iLCJpbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNNYW5hZ2VyfSBmcm9tIFwiLi9jb21wdXRhdGlvbnMtbWFuYWdlclwiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnfSBmcm9tIFwiLi9jb21wdXRhdGlvbnMtbWFuYWdlclwiO1xuXG5cblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc0VuZ2luZUNvbmZpZyBleHRlbmRzIENvbXB1dGF0aW9uc01hbmFnZXJDb25maWd7XG4gICAgbG9nTGV2ZWwgPSAnd2Fybic7XG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy9FbnRyeSBwb2ludCBjbGFzcyBmb3Igc3RhbmRhbG9uZSBjb21wdXRhdGlvbiB3b3JrZXJzXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlcntcblxuICAgIGdsb2JhbCA9IFV0aWxzLmdldEdsb2JhbE9iamVjdCgpO1xuICAgIGlzV29ya2VyID0gVXRpbHMuaXNXb3JrZXIoKTtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZywgZGF0YSl7XG4gICAgICAgIHN1cGVyKGNvbmZpZywgZGF0YSk7XG5cbiAgICAgICAgaWYodGhpcy5pc1dvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLnJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIoe1xuICAgICAgICAgICAgICAgIGJlZm9yZUpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYmVmb3JlSm9iJywgam9iRXhlY3V0aW9uLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAgICAgYWZ0ZXJKb2I6IChqb2JFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVwbHkoJ2FmdGVySm9iJywgam9iRXhlY3V0aW9uLmdldERUTygpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgICAgICAgIHRoaXMucXVlcnlhYmxlRnVuY3Rpb25zID0ge1xuICAgICAgICAgICAgICAgIHJ1bkpvYjogZnVuY3Rpb24oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTyl7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMsIHNlcmlhbGl6ZWREYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5ydW5Kb2Ioam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBleGVjdXRlSm9iOiBmdW5jdGlvbihqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLmpvYnNNYW5nZXIuZXhlY3V0ZShqb2JFeGVjdXRpb25JZCkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucmVwbHkoJ2pvYkZhdGFsRXJyb3InLCBqb2JFeGVjdXRpb25JZCwgVXRpbHMuZ2V0RXJyb3JEVE8oZSkpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVjb21wdXRlOiBmdW5jdGlvbihkYXRhRFRPLCBydWxlTmFtZSwgZXZhbENvZGUsIGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgICAgICAgICAgaWYocnVsZU5hbWUpe1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB2YXIgYWxsUnVsZXMgPSAhcnVsZU5hbWU7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkYXRhID0gbmV3IERhdGFNb2RlbChkYXRhRFRPKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UuX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYylcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgncmVjb21wdXRlZCcsIGRhdGEuZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGdsb2JhbC5vbm1lc3NhZ2UgPSBmdW5jdGlvbihvRXZlbnQpIHtcbiAgICAgICAgICAgICAgICBpZiAob0V2ZW50LmRhdGEgaW5zdGFuY2VvZiBPYmplY3QgJiYgb0V2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kJykgJiYgb0V2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5QXJndW1lbnRzJykpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UucXVlcnlhYmxlRnVuY3Rpb25zW29FdmVudC5kYXRhLnF1ZXJ5TWV0aG9kXS5hcHBseShzZWxmLCBvRXZlbnQuZGF0YS5xdWVyeUFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2UuZGVmYXVsdFJlcGx5KG9FdmVudC5kYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG5cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgc3VwZXIuc2V0Q29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHRoaXMuc2V0TG9nTGV2ZWwodGhpcy5jb25maWcubG9nTGV2ZWwpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBzZXRMb2dMZXZlbChsZXZlbCl7XG4gICAgICAgIGxvZy5zZXRMZXZlbChsZXZlbClcbiAgICB9XG5cbiAgICBkZWZhdWx0UmVwbHkobWVzc2FnZSkge1xuICAgICAgICB0aGlzLnJlcGx5KCd0ZXN0JywgbWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcmVwbHkoKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVwbHkgLSBub3QgZW5vdWdoIGFyZ3VtZW50cycpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZ2xvYmFsLnBvc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZExpc3RlbmVyJzogYXJndW1lbnRzWzBdLFxuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kQXJndW1lbnRzJzogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZXNNYW5hZ2VyfSBmcm9tIFwiLi9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXJcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtPcGVyYXRpb25zTWFuYWdlcn0gZnJvbSBcIi4vb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXJcIjtcbmltcG9ydCB7Sm9ic01hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9icy1tYW5hZ2VyXCI7XG5pbXBvcnQge0V4cHJlc3Npb25zRXZhbHVhdG9yfSBmcm9tIFwiLi9leHByZXNzaW9ucy1ldmFsdWF0b3JcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VNYW5hZ2VyfSBmcm9tIFwiLi9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge01jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vdmFsaWRhdGlvbi9tY2RtLXdlaWdodC12YWx1ZS12YWxpZGF0b3JcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcge1xuXG4gICAgbG9nTGV2ZWwgPSBudWxsO1xuXG4gICAgcnVsZU5hbWUgPSBudWxsO1xuICAgIHdvcmtlciA9IHtcbiAgICAgICAgZGVsZWdhdGVSZWNvbXB1dGF0aW9uOiBmYWxzZSxcbiAgICAgICAgdXJsOiBudWxsXG4gICAgfTtcbiAgICBqb2JSZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgIGNsZWFyUmVwb3NpdG9yeSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc01hbmFnZXIge1xuICAgIGRhdGE7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBvcGVyYXRpb25zTWFuYWdlcjtcbiAgICBqb2JzTWFuZ2VyO1xuXG4gICAgdHJlZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZywgZGF0YSA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gbmV3IEV4cHJlc3Npb25FbmdpbmUoKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IG5ldyBFeHByZXNzaW9uc0V2YWx1YXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG5ldyBPYmplY3RpdmVSdWxlc01hbmFnZXIodGhpcy5leHByZXNzaW9uRW5naW5lLCB0aGlzLmNvbmZpZy5ydWxlTmFtZSk7XG4gICAgICAgIHRoaXMub3BlcmF0aW9uc01hbmFnZXIgPSBuZXcgT3BlcmF0aW9uc01hbmFnZXIodGhpcy5kYXRhLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmpvYnNNYW5nZXIgPSBuZXcgSm9ic01hbmFnZXIodGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHtcbiAgICAgICAgICAgIHdvcmtlclVybDogdGhpcy5jb25maWcud29ya2VyLnVybCxcbiAgICAgICAgICAgIHJlcG9zaXRvcnlUeXBlOiB0aGlzLmNvbmZpZy5qb2JSZXBvc2l0b3J5VHlwZSxcbiAgICAgICAgICAgIGNsZWFyUmVwb3NpdG9yeTogdGhpcy5jb25maWcuY2xlYXJSZXBvc2l0b3J5XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvciA9IG5ldyBNY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IENvbXB1dGF0aW9uc01hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudFJ1bGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5jdXJyZW50UnVsZTtcbiAgICB9XG5cbiAgICBmbGlwQ3JpdGVyaWEoZGF0YSl7XG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5yZXZlcnNlUGF5b2ZmcygpO1xuICAgICAgICBsZXQgdG1wID0gZGF0YS53ZWlnaHRMb3dlckJvdW5kO1xuICAgICAgICBkYXRhLndlaWdodExvd2VyQm91bmQgPSB0aGlzLmZsaXAoZGF0YS53ZWlnaHRVcHBlckJvdW5kKTtcbiAgICAgICAgZGF0YS53ZWlnaHRVcHBlckJvdW5kID0gdGhpcy5mbGlwKHRtcCk7XG4gICAgICAgIGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQgPSB0aGlzLmZsaXAoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmZsaXBSdWxlKCk7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZmFsc2UpO1xuICAgIH1cblxuICAgIGZsaXAoYSl7XG4gICAgICAgIGlmKGEgPT0gSW5maW5pdHkpe1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cblxuICAgICAgICBpZihhID09IDApe1xuICAgICAgICAgICAgcmV0dXJuIEluZmluaXR5O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgYSkpXG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgfVxuXG4gICAgcnVuSm9iKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIucnVuKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcywgZGF0YSB8fCB0aGlzLmRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKVxuICAgIH1cblxuICAgIHJ1bkpvYldpdGhJbnN0YW5jZU1hbmFnZXIobmFtZSwgam9iUGFyYW1zVmFsdWVzLCBqb2JJbnN0YW5jZU1hbmFnZXJDb25maWcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuSm9iKG5hbWUsIGpvYlBhcmFtc1ZhbHVlcykudGhlbihqZT0+IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgSm9iSW5zdGFuY2VNYW5hZ2VyKHRoaXMuam9ic01hbmdlciwgamUsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5ydWxlcztcbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgaXNSdWxlTmFtZShydWxlTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuaXNSdWxlTmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSkge1xuICAgICAgICB0aGlzLmNvbmZpZy5ydWxlTmFtZSA9IHJ1bGVOYW1lO1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpXG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3QpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9uc01hbmFnZXIub3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3QpO1xuICAgIH1cblxuICAgIC8qIGFsaWFzIGZ1bmN0aW9uIGZvciBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKi9cbiAgICByZWNvbXB1dGUoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZSguLi5hcmd1bWVudHMpO1xuICAgIH1cblxuICAgIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoYWxsUnVsZXMsIGV2YWxDb2RlID0gZmFsc2UsIGV2YWxOdW1lcmljID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbmZpZy53b3JrZXIuZGVsZWdhdGVSZWNvbXB1dGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgZXZhbENvZGU6IGV2YWxDb2RlLFxuICAgICAgICAgICAgICAgICAgICBldmFsTnVtZXJpYzogZXZhbE51bWVyaWNcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmICghYWxsUnVsZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnJ1bGVOYW1lID0gdGhpcy5nZXRDdXJyZW50UnVsZSgpLm5hbWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihcInJlY29tcHV0ZVwiLCBwYXJhbXMsIHRoaXMuZGF0YSwgZmFsc2UpLnRoZW4oKGpvYkV4ZWN1dGlvbik9PiB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkID0gam9iRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kYXRhLnVwZGF0ZUZyb20oZClcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUodGhpcy5kYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKTtcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlRGlzcGxheVZhbHVlcyh0aGlzLmRhdGEpO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgX2NoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlID0gZmFsc2UsIGV2YWxOdW1lcmljID0gdHJ1ZSkge1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnVwZGF0ZURlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGRhdGEuZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpO1xuICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzID0gW107XG5cbiAgICAgICAgaWYgKGV2YWxDb2RlIHx8IGV2YWxOdW1lcmljKSB7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHdlaWdodFZhbGlkID0gdGhpcy5tY2RtV2VpZ2h0VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIHZhciBtdWx0aUNyaXRlcmlhID0gdGhpcy5nZXRDdXJyZW50UnVsZSgpLm11bHRpQ3JpdGVyaWE7XG5cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkgJiYgKCFtdWx0aUNyaXRlcmlhIHx8IHdlaWdodFZhbGlkKSkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUocm9vdCwgYWxsUnVsZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvL0NoZWNrcyB2YWxpZGl0eSBvZiBkYXRhIG1vZGVsIHdpdGhvdXQgcmVjb21wdXRhdGlvbiBhbmQgcmV2YWxpZGF0aW9uXG4gICAgaXNWYWxpZChkYXRhKSB7XG4gICAgICAgIHZhciBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIHJldHVybiBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLmV2ZXJ5KHZyPT52ci5pc1ZhbGlkKCkpO1xuICAgIH1cblxuICAgIHVwZGF0ZURpc3BsYXlWYWx1ZXMoZGF0YSwgcG9saWN5VG9EaXNwbGF5ID0gbnVsbCkge1xuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGlmIChwb2xpY3lUb0Rpc3BsYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRpc3BsYXlQb2xpY3koZGF0YSwgcG9saWN5VG9EaXNwbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVOb2RlRGlzcGxheVZhbHVlcyhuKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVFZGdlRGlzcGxheVZhbHVlcyhlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB1cGRhdGVOb2RlRGlzcGxheVZhbHVlcyhub2RlKSB7XG4gICAgICAgIG5vZGUuJERJU1BMQVlfVkFMVUVfTkFNRVMuZm9yRWFjaChuPT5ub2RlLmRpc3BsYXlWYWx1ZShuLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXROb2RlRGlzcGxheVZhbHVlKG5vZGUsIG4pKSk7XG4gICAgfVxuXG4gICAgdXBkYXRlRWRnZURpc3BsYXlWYWx1ZXMoZSkge1xuICAgICAgICBlLiRESVNQTEFZX1ZBTFVFX05BTUVTLmZvckVhY2gobj0+ZS5kaXNwbGF5VmFsdWUobiwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuKSkpO1xuICAgIH1cblxuICAgIGRpc3BsYXlQb2xpY3kocG9saWN5VG9EaXNwbGF5LCBkYXRhKSB7XG5cblxuICAgICAgICBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT4ge1xuICAgICAgICAgICAgbi5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgZS5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKChyb290KT0+dGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShyb290LCBwb2xpY3lUb0Rpc3BsYXkpKTtcbiAgICB9XG5cbiAgICBkaXNwbGF5UG9saWN5Rm9yTm9kZShub2RlLCBwb2xpY3kpIHtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbihwb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhkZWNpc2lvbiwgbm9kZSwgcG9saWN5KTtcbiAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgIG5vZGUuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICB2YXIgY2hpbGRFZGdlID0gbm9kZS5jaGlsZEVkZ2VzW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgICAgIGNoaWxkRWRnZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGNoaWxkRWRnZS5jaGlsZE5vZGUsIHBvbGljeSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgIG5vZGUuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGUuY2hpbGROb2RlLCBwb2xpY3kpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9ZWxzZSBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIG5vZGUuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIH1cblxuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNVdGlsc3tcblxuICAgIHN0YXRpYyBzZXF1ZW5jZShtaW4sIG1heCwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBleHRlbnQgPSBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KG1heCwgbWluKTtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFttaW5dO1xuICAgICAgICB2YXIgc3RlcHMgPSBsZW5ndGggLSAxO1xuICAgICAgICBpZighc3RlcHMpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGV4dGVudCxsZW5ndGggLSAxKTtcbiAgICAgICAgdmFyIGN1cnIgPSBtaW47XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoIC0gMjsgaSsrKSB7XG4gICAgICAgICAgICBjdXJyID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoY3Vyciwgc3RlcCk7XG4gICAgICAgICAgICByZXN1bHQucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoY3VycikpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdC5wdXNoKG1heCk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qRXZhbHVhdGVzIGNvZGUgYW5kIGV4cHJlc3Npb25zIGluIHRyZWVzKi9cbmV4cG9ydCBjbGFzcyBFeHByZXNzaW9uc0V2YWx1YXRvciB7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBjbGVhcihkYXRhKXtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGUuY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhclRyZWUoZGF0YSwgcm9vdCl7XG4gICAgICAgIGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIG4uY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlPXRydWUsIGV2YWxOdW1lcmljPXRydWUsIGluaXRTY29wZXM9ZmFsc2Upe1xuICAgICAgICBsb2cuZGVidWcoJ2V2YWxFeHByZXNzaW9ucyBldmFsQ29kZTonK2V2YWxDb2RlKycgZXZhbE51bWVyaWM6JytldmFsTnVtZXJpYyk7XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIHRoaXMuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyVHJlZShkYXRhLCBuKTtcbiAgICAgICAgICAgIHRoaXMuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBuLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsaW5pdFNjb3Blcyk7XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgZXZhbEdsb2JhbENvZGUoZGF0YSl7XG4gICAgICAgIGRhdGEuY2xlYXJFeHByZXNzaW9uU2NvcGUoKTtcbiAgICAgICAgZGF0YS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgIHRyeXtcbiAgICAgICAgICAgIGRhdGEuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChkYXRhLmNvZGUsIGZhbHNlLCBkYXRhLmV4cHJlc3Npb25TY29wZSk7XG4gICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZXZhbFBheW9mZihlZGdlLCBpbmRleCA9IDApIHtcbiAgICAgICAgaWYgKEV4cHJlc3Npb25FbmdpbmUuaGFzQXNzaWdubWVudEV4cHJlc3Npb24oZWRnZS5wYXlvZmZbaW5kZXhdKSkge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGVkZ2UucGF5b2ZmW2luZGV4XSwgdHJ1ZSwgZWRnZS5wYXJlbnROb2RlLmV4cHJlc3Npb25TY29wZSk7XG4gICAgfVxuXG4gICAgZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBub2RlLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGU9ZmFsc2UpIHtcbiAgICAgICAgaWYoIW5vZGUuZXhwcmVzc2lvblNjb3BlIHx8IGluaXRTY29wZSB8fCBldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoZXZhbENvZGUpe1xuICAgICAgICAgICAgbm9kZS4kY29kZURpcnR5ID0gZmFsc2U7XG4gICAgICAgICAgICBpZihub2RlLmNvZGUpe1xuICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS4kY29kZUVycm9yID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwobm9kZS5jb2RlLCBmYWxzZSwgbm9kZS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICAgICAgICAgIH1jYXRjaCAoZSl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IGU7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZihldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB2YXIgc2NvcGUgPSBub2RlLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bT1FeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKDApO1xuICAgICAgICAgICAgdmFyIGhhc2hFZGdlcz0gW107XG4gICAgICAgICAgICB2YXIgaW52YWxpZFByb2IgPSBmYWxzZTtcblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIGUucGF5b2ZmLmZvckVhY2goKHJhd1BheW9mZiwgcGF5b2ZmSW5kZXgpPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgcGF0aCA9ICdwYXlvZmZbJyArIHBheW9mZkluZGV4ICsgJ10nO1xuICAgICAgICAgICAgICAgICAgICBpZihlLmlzRmllbGRWYWxpZChwYXRoLCB0cnVlLCBmYWxzZSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCBwYXRoLCB0aGlzLmV2YWxQYXlvZmYoZSwgcGF5b2ZmSW5kZXgpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgTGVmdCBlbXB0eSBpbnRlbnRpb25hbGx5XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuXG5cbiAgICAgICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaXNIYXNoKGUucHJvYmFiaWxpdHkpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2hFZGdlcy5wdXNoKGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5oYXNBc3NpZ25tZW50RXhwcmVzc2lvbihlLnByb2JhYmlsaXR5KSl7IC8vSXQgc2hvdWxkIG5vdCBvY2N1ciBoZXJlIVxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nLndhcm4oXCJldmFsRXhwcmVzc2lvbnNGb3JOb2RlIGhhc0Fzc2lnbm1lbnRFeHByZXNzaW9uIVwiLCBlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoZS5pc0ZpZWxkVmFsaWQoJ3Byb2JhYmlsaXR5JywgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGUucHJvYmFiaWxpdHksIHRydWUsIHNjb3BlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3Byb2JhYmlsaXR5JywgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgcHJvYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9Y2F0Y2ggKGVycil7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW52YWxpZFByb2IgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG5cblxuICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHZhciBjb21wdXRlSGFzaCA9IGhhc2hFZGdlcy5sZW5ndGggJiYgIWludmFsaWRQcm9iICYmIChwcm9iYWJpbGl0eVN1bS5jb21wYXJlKDApID49IDAgJiYgcHJvYmFiaWxpdHlTdW0uY29tcGFyZSgxKSA8PSAwKTtcblxuICAgICAgICAgICAgICAgIGlmKGNvbXB1dGVIYXNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYXNoID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdCgxLCBwcm9iYWJpbGl0eVN1bSksIGhhc2hFZGdlcy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIGhhc2gpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgZS5jaGlsZE5vZGUsIGV2YWxDb2RlLCBldmFsTnVtZXJpYywgaW5pdFNjb3BlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdFNjb3BlRm9yTm9kZShkYXRhLCBub2RlKXtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5vZGUuJHBhcmVudDtcbiAgICAgICAgdmFyIHBhcmVudFNjb3BlID0gcGFyZW50P3BhcmVudC5leHByZXNzaW9uU2NvcGUgOiBkYXRhLmV4cHJlc3Npb25TY29wZTtcbiAgICAgICAgbm9kZS5leHByZXNzaW9uU2NvcGUgPSBVdGlscy5jbG9uZURlZXAocGFyZW50U2NvcGUpO1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLWVuZ2luZSdcbmV4cG9ydCAqIGZyb20gJy4vY29tcHV0YXRpb25zLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2V4cHJlc3Npb25zLWV2YWx1YXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9icy9pbmRleCdcblxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwid2VpZ2h0TG93ZXJCb3VuZFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgKHYsIGFsbFZhbHMpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB2ID49IDAgJiYgdiA8PSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKGFsbFZhbHNbJ3dlaWdodFVwcGVyQm91bmQnXSlcbiAgICAgICAgfSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJkZWZhdWx0V2VpZ2h0XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCAodiwgYWxsVmFscykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHYgPj0gMCAmJiB2ID49IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24oYWxsVmFsc1snd2VpZ2h0TG93ZXJCb3VuZCddKSAmJiB2IDw9IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24oYWxsVmFsc1snd2VpZ2h0VXBwZXJCb3VuZCddKVxuICAgICAgICB9KSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIndlaWdodFVwcGVyQm91bmRcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdiA+PSAwICYmIHYgPj0gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbihhbGxWYWxzWyd3ZWlnaHRMb3dlckJvdW5kJ10pXG4gICAgICAgIH0pKTtcblxuICAgIH1cblxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIG5hbWVPZkNyaXRlcmlvbjE6ICdDb3N0JyxcbiAgICAgICAgICAgIG5hbWVPZkNyaXRlcmlvbjI6ICdFZmZlY3QnLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIHdlaWdodExvd2VyQm91bmQ6IDAsXG4gICAgICAgICAgICBkZWZhdWx0V2VpZ2h0OiAwLFxuICAgICAgICAgICAgd2VpZ2h0VXBwZXJCb3VuZDogSW5maW5pdHksXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7TGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9sZWFndWUtdGFibGUtam9iLXBhcmFtZXRlcnNcIjtcblxuXG5leHBvcnQgY2xhc3MgTGVhZ3VlVGFibGVKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImxlYWd1ZS10YWJsZVwiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5pbml0U3RlcHMoKTtcbiAgICB9XG5cbiAgICBpbml0U3RlcHMoKSB7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IExlYWd1ZVRhYmxlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzID0gdHJ1ZSkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmICh3aXRoSGVhZGVycykge1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeV9pZCcsICdwb2xpY3knLCBqb2JSZXN1bHQucGF5b2ZmTmFtZXNbMF0sIGpvYlJlc3VsdC5wYXlvZmZOYW1lc1sxXSwgJ2RvbWluYXRlZF9ieScsICdleHRlbmRlZC1kb21pbmF0ZWRfYnknLCAnaW5jcmF0aW8nLCAnb3B0aW1hbCcsICdvcHRpbWFsX2Zvcl9kZWZhdWx0X3dlaWdodCddO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goaGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICByb3cucG9saWNpZXMuZm9yRWFjaChwb2xpY3k9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW1xuICAgICAgICAgICAgICAgICAgICByb3cuaWQsXG4gICAgICAgICAgICAgICAgICAgIFBvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3ksIGpvYlBhcmFtZXRlcnMudmFsdWVzLmV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb24pLFxuICAgICAgICAgICAgICAgICAgICByb3cucGF5b2Zmc1sxXSxcbiAgICAgICAgICAgICAgICAgICAgcm93LnBheW9mZnNbMF0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5kb21pbmF0ZWRCeSxcbiAgICAgICAgICAgICAgICAgICAgcm93LmV4dGVuZGVkRG9taW5hdGVkQnkgPT09IG51bGwgPyBudWxsIDogcm93LmV4dGVuZGVkRG9taW5hdGVkQnlbMF0gKyAnLCAnICsgcm93LmV4dGVuZGVkRG9taW5hdGVkQnlbMV0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5pbmNyYXRpbyxcbiAgICAgICAgICAgICAgICAgICAgcm93Lm9wdGltYWwsXG4gICAgICAgICAgICAgICAgICAgIHJvdy5vcHRpbWFsRm9yRGVmYXVsdFdlaWdodFxuICAgICAgICAgICAgICAgIF07XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2gocm93Q2VsbHMpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgbGV0IHJ1bGUgPSB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5jdXJyZW50UnVsZTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuXG5cbiAgICAgICAgdmFyIHBheW9mZkNvZWZmcyA9IHRoaXMucGF5b2ZmQ29lZmZzID0gcnVsZS5wYXlvZmZDb2VmZnM7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSk7XG4gICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG5cbiAgICAgICAgaWYgKCF2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGNvbXBhcmUgPSAoYSwgYik9PigtcGF5b2ZmQ29lZmZzWzBdICogIChiLnBheW9mZnNbMF0gLSBhLnBheW9mZnNbMF0pKSB8fCAoLXBheW9mZkNvZWZmc1sxXSAqICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSk7XG5cbiAgICAgICAgdmFyIHJvd3MgPSBwb2xpY2llcy5tYXAocG9saWN5ID0+IHtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBwb2xpY2llczogW3BvbGljeV0sXG4gICAgICAgICAgICAgICAgcGF5b2ZmczogdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpLnNsaWNlKCksXG4gICAgICAgICAgICAgICAgZG9taW5hdGVkQnk6IG51bGwsXG4gICAgICAgICAgICAgICAgZXh0ZW5kZWREb21pbmF0ZWRCeTogbnVsbCxcbiAgICAgICAgICAgICAgICBpbmNyYXRpbzogbnVsbCxcbiAgICAgICAgICAgICAgICBvcHRpbWFsOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBvcHRpbWFsRm9yRGVmYXVsdFdlaWdodDogZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuc29ydChjb21wYXJlKTtcblxuICAgICAgICByb3dzID0gcm93cy5yZWR1Y2UoKHByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZSwgaW5kZXgsIGFycmF5KT0+e1xuICAgICAgICAgICAgaWYoIXByZXZpb3VzVmFsdWUubGVuZ3RoKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2N1cnJlbnRWYWx1ZV1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBwcmV2aW91c1ZhbHVlW3ByZXZpb3VzVmFsdWUubGVuZ3RoLTFdO1xuICAgICAgICAgICAgaWYoY29tcGFyZShwcmV2LCBjdXJyZW50VmFsdWUpID09IDApe1xuICAgICAgICAgICAgICAgIHByZXYucG9saWNpZXMucHVzaCguLi5jdXJyZW50VmFsdWUucG9saWNpZXMpO1xuICAgICAgICAgICAgICAgIHJldHVybiBwcmV2aW91c1ZhbHVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcHJldmlvdXNWYWx1ZS5jb25jYXQoY3VycmVudFZhbHVlKVxuICAgICAgICB9LCBbXSk7XG5cbiAgICAgICAgcm93cy5zb3J0KChhLCBiKT0+KHBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgociwgaSk9PiB7XG4gICAgICAgICAgICByLmlkID0gaSsxO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gcm93cy5zb3J0KGNvbXBhcmUpO1xuICAgICAgICByb3dzLnNvcnQoKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYS5wYXlvZmZzWzBdIC0gYi5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgIChhLnBheW9mZnNbMV0gLSBiLnBheW9mZnNbMV0pKSk7XG5cbiAgICAgICAgbGV0IGJlc3RDb3N0ID0gLXBheW9mZkNvZWZmc1sxXSAqIEluZmluaXR5LFxuICAgICAgICAgICAgYmVzdENvc3RSb3cgPSBudWxsO1xuXG4gICAgICAgIGxldCBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgaWYocGF5b2ZmQ29lZmZzWzFdPDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1cblxuICAgICAgICByb3dzLmZvckVhY2goKHIsIGkpPT4ge1xuICAgICAgICAgICAgaWYgKGNtcChyLnBheW9mZnNbMV0sIGJlc3RDb3N0KSkge1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0ID0gci5wYXlvZmZzWzFdO1xuICAgICAgICAgICAgICAgIGJlc3RDb3N0Um93ID0gcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZihiZXN0Q29zdFJvdykge1xuICAgICAgICAgICAgICAgIHIuZG9taW5hdGVkQnkgPSBiZXN0Q29zdFJvdy5pZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIGlmKHBheW9mZkNvZWZmc1swXSA+IDAgJiYgcGF5b2ZmQ29lZmZzWzFdIDwgMCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfWVsc2UgaWYocGF5b2ZmQ29lZmZzWzBdIDwgMCAmJiBwYXlvZmZDb2VmZnNbMV0gPiAwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9ZWxzZSBpZihwYXlvZmZDb2VmZnNbMV08MCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhID4gYjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwcmV2Mk5vdERvbWluYXRlZCA9IG51bGw7XG4gICAgICAgIHJvd3MuZmlsdGVyKHI9PiFyLmRvbWluYXRlZEJ5KS5zb3J0KChhLCBiKT0+KCAgcGF5b2ZmQ29lZmZzWzBdICogKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpKS5mb3JFYWNoKChyLCBpLCBhcnIpPT4ge1xuICAgICAgICAgICAgaWYgKGkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHIuaW5jcmF0aW8gPSAwO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHByZXYgPSBhcnJbaSAtIDFdO1xuXG4gICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2KTtcbiAgICAgICAgICAgIGlmIChpIDwgMikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoIXByZXYyTm90RG9taW5hdGVkKXtcbiAgICAgICAgICAgICAgICBwcmV2Mk5vdERvbWluYXRlZCA9IGFycltpIC0gMl07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGNtcChyLmluY3JhdGlvLHByZXYuaW5jcmF0aW8pKXtcbiAgICAgICAgICAgICAgICBwcmV2LmluY3JhdGlvID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwcmV2LmV4dGVuZGVkRG9taW5hdGVkQnkgPSBbcHJldjJOb3REb21pbmF0ZWQuaWQsIHIuaWRdIDtcbiAgICAgICAgICAgICAgICByLmluY3JhdGlvID0gdGhpcy5jb21wdXRlSUNFUihyLCBwcmV2Mk5vdERvbWluYXRlZCk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBwcmV2Mk5vdERvbWluYXRlZCA9IHByZXY7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCB3ZWlnaHRMb3dlckJvdW5kID0gcGFyYW1zLnZhbHVlKFwid2VpZ2h0TG93ZXJCb3VuZFwiKTtcbiAgICAgICAgbGV0IGRlZmF1bHRXZWlnaHQgPSBwYXJhbXMudmFsdWUoXCJkZWZhdWx0V2VpZ2h0XCIpO1xuICAgICAgICBsZXQgd2VpZ2h0VXBwZXJCb3VuZCA9IHBhcmFtcy52YWx1ZShcIndlaWdodFVwcGVyQm91bmRcIik7XG5cbiAgICAgICAgLy9tYXJrIG9wdGltYWwgZm9yIHdlaWdodCBpbiBbd2VpZ2h0TG93ZXJCb3VuZCwgd2VpZ2h0VXBwZXJCb3VuZF0gYW5kIG9wdGltYWwgZm9yIGRlZmF1bHQgV2VpZ2h0XG4gICAgICAgIGxldCBsYXN0TEVMb3dlciA9IG51bGw7XG4gICAgICAgIGxldCBsYXN0TEVMb3dlckRlZiA9IG51bGw7XG4gICAgICAgIHJvd3Muc2xpY2UoKS5maWx0ZXIocj0+IXIuZG9taW5hdGVkQnkgJiYgIXIuZXh0ZW5kZWREb21pbmF0ZWRCeSkuc29ydCgoYSwgYikgPT4gYS5pbmNyYXRpbyAtIGIuaW5jcmF0aW8pLmZvckVhY2goKHJvdywgaSwgYXJyKT0+e1xuXG4gICAgICAgICAgICBpZihyb3cuaW5jcmF0aW8gPCB3ZWlnaHRMb3dlckJvdW5kKXtcbiAgICAgICAgICAgICAgICBsYXN0TEVMb3dlciAgPSByb3c7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihyb3cuaW5jcmF0aW8gPCBkZWZhdWx0V2VpZ2h0KXtcbiAgICAgICAgICAgICAgICBsYXN0TEVMb3dlckRlZiAgPSByb3c7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvdy5vcHRpbWFsID0gcm93LmluY3JhdGlvID49IHdlaWdodExvd2VyQm91bmQgJiYgcm93LmluY3JhdGlvIDw9IHdlaWdodFVwcGVyQm91bmQ7XG4gICAgICAgICAgICByb3cub3B0aW1hbEZvckRlZmF1bHRXZWlnaHQgPSByb3cuaW5jcmF0aW8gPT0gZGVmYXVsdFdlaWdodDtcblxuICAgICAgICB9KTtcbiAgICAgICAgaWYobGFzdExFTG93ZXIpe1xuICAgICAgICAgICAgbGFzdExFTG93ZXIub3B0aW1hbCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihsYXN0TEVMb3dlckRlZil7XG4gICAgICAgICAgICBsYXN0TEVMb3dlckRlZi5vcHRpbWFsRm9yRGVmYXVsdFdlaWdodCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByb3dzLmZvckVhY2gocm93PT57XG4gICAgICAgICAgICByb3cucGF5b2Zmc1swXSA9ICBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LnBheW9mZnNbMF0pO1xuICAgICAgICAgICAgcm93LnBheW9mZnNbMV0gPSAgRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5wYXlvZmZzWzFdKTtcbiAgICAgICAgICAgIHJvdy5pbmNyYXRpbyA9IHJvdy5pbmNyYXRpbyA9PT0gbnVsbCA/IG51bGwgOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQocm93LmluY3JhdGlvKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICBwYXlvZmZOYW1lczogZGF0YS5wYXlvZmZOYW1lcy5zbGljZSgpLFxuICAgICAgICAgICAgcGF5b2ZmQ29lZmZzIDogcGF5b2ZmQ29lZmZzLFxuICAgICAgICAgICAgcm93czogcm93cy5zb3J0KChhLCBiKT0+KGEuaWQgLSBiLmlkKSksXG4gICAgICAgICAgICB3ZWlnaHRMb3dlckJvdW5kOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQod2VpZ2h0TG93ZXJCb3VuZCksXG4gICAgICAgICAgICBkZWZhdWx0V2VpZ2h0OiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZGVmYXVsdFdlaWdodCksXG4gICAgICAgICAgICB3ZWlnaHRVcHBlckJvdW5kOiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQod2VpZ2h0VXBwZXJCb3VuZClcbiAgICAgICAgfTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgY29tcHV0ZUlDRVIociwgcHJldil7XG4gICAgICAgIGxldCBkID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChyLnBheW9mZnNbMF0sIHByZXYucGF5b2Zmc1swXSk7XG4gICAgICAgIGxldCBuID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChyLnBheW9mZnNbMV0sIHByZXYucGF5b2Zmc1sxXSk7XG4gICAgICAgIGlmIChkID09IDApe1xuICAgICAgICAgICAgaWYobjwwKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gLSBJbmZpbml0eTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBJbmZpbml0eTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gTWF0aC5hYnMoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUobiwgZCkpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFJlY29tcHV0ZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsQ29kZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV2YWxOdW1lcmljXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgcnVsZU5hbWU6IG51bGwsIC8vcmVjb21wdXRlIGFsbCBydWxlc1xuICAgICAgICAgICAgZXZhbENvZGU6IHRydWUsXG4gICAgICAgICAgICBldmFsTnVtZXJpYzogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1JlY29tcHV0ZUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iXCI7XG5cbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInJlY29tcHV0ZVwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5pc1Jlc3RhcnRhYmxlID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBleGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgaWYocnVsZU5hbWUpe1xuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgcGFyYW1zLnZhbHVlKFwiZXZhbENvZGVcIiksIHBhcmFtcy52YWx1ZShcImV2YWxOdW1lcmljXCIpKVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYykge1xuICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzID0gW107XG5cbiAgICAgICAgaWYoZXZhbENvZGV8fGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZmFpbE9uSW52YWxpZFRyZWVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMiksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPCB2W1wibWF4XCJdLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuXG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBiYXRjaFNpemU9NSkge1xuICAgICAgICBzdXBlcihcInNlbnNpdGl2aXR5LWFuYWx5c2lzXCIsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICB0aGlzLmJhdGNoU2l6ZSA9IDU7XG4gICAgICAgIHRoaXMuaW5pdFN0ZXBzKCk7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCl7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcCh0aGlzLmNhbGN1bGF0ZVN0ZXApO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzZXRCYXRjaFNpemUoYmF0Y2hTaXplKXtcbiAgICAgICAgdGhpcy5iYXRjaFNpemUgPSBiYXRjaFNpemU7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcC5jaHVua1NpemUgPSBiYXRjaFNpemU7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycywgd2l0aEhlYWRlcnM9dHJ1ZSl7XG4gICAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgICAgaWYod2l0aEhlYWRlcnMpe1xuICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBbJ3BvbGljeV9udW1iZXInLCAncG9saWN5J107XG4gICAgICAgICAgICBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5mb3JFYWNoKG49PmhlYWRlcnMucHVzaChuKSk7XG4gICAgICAgICAgICBoZWFkZXJzLnB1c2goJ3BheW9mZicpO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goaGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcm91bmRWYXJpYWJsZXMgPSAhIWpvYlBhcmFtZXRlcnMudmFsdWVzLnJvdW5kVmFyaWFibGVzO1xuICAgICAgICBpZihyb3VuZFZhcmlhYmxlcyl7XG4gICAgICAgICAgICB0aGlzLnJvdW5kVmFyaWFibGVzKGpvYlJlc3VsdCk7XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICB2YXIgcG9saWN5ID0gam9iUmVzdWx0LnBvbGljaWVzW3Jvdy5wb2xpY3lJbmRleF07XG4gICAgICAgICAgICB2YXIgcm93Q2VsbHMgPSBbcm93LnBvbGljeUluZGV4KzEsIFBvbGljeS50b1BvbGljeVN0cmluZyhwb2xpY3ksIGpvYlBhcmFtZXRlcnMudmFsdWVzLmV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb24pXTtcbiAgICAgICAgICAgIHJvdy52YXJpYWJsZXMuZm9yRWFjaCh2PT4gcm93Q2VsbHMucHVzaCh2KSk7XG4gICAgICAgICAgICByb3dDZWxscy5wdXNoKHJvdy5wYXlvZmYpO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2gocm93Q2VsbHMpO1xuXG4gICAgICAgICAgICBpZihyb3cuX3ZhcmlhYmxlcyl7IC8vcmV2ZXJ0IG9yaWdpbmFsIHZhcmlhYmxlc1xuICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZXMgPSByb3cuX3ZhcmlhYmxlcztcbiAgICAgICAgICAgICAgICBkZWxldGUgcm93Ll92YXJpYWJsZXM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcm91bmRWYXJpYWJsZXMoam9iUmVzdWx0KXtcbiAgICAgICAgdmFyIHVuaXF1ZVZhbHVlcyA9IGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLm1hcCgoKT0+bmV3IFNldCgpKTtcblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKHJvdyA9PiB7XG4gICAgICAgICAgICByb3cuX3ZhcmlhYmxlcyA9IHJvdy52YXJpYWJsZXMuc2xpY2UoKTsgLy8gc2F2ZSBvcmlnaW5hbCByb3cgdmFyaWFibGVzXG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2goKHYsaSk9PiB7XG4gICAgICAgICAgICAgICAgdW5pcXVlVmFsdWVzW2ldLmFkZCh2KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB1bmlxdWVWYWx1ZXNObyA9IHVuaXF1ZVZhbHVlcy5tYXAoKHMpPT5zLnNpemUpO1xuICAgICAgICB2YXIgbWF4UHJlY2lzaW9uID0gMTQ7XG4gICAgICAgIHZhciBwcmVjaXNpb24gPSAyO1xuICAgICAgICB2YXIgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzID0gam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMubWFwKCh2LGkpPT5pKTtcbiAgICAgICAgd2hpbGUocHJlY2lzaW9uPD1tYXhQcmVjaXNpb24gJiYgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLmxlbmd0aCl7XG4gICAgICAgICAgICB1bmlxdWVWYWx1ZXMgPSBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMubWFwKCgpPT5uZXcgU2V0KCkpO1xuICAgICAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgICAgIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5mb3JFYWNoKCh2YXJpYWJsZUluZGV4LCBub3RSZWFkeUluZGV4KT0+e1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciB2YWwgPSByb3cuX3ZhcmlhYmxlc1t2YXJpYWJsZUluZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgdmFsID0gVXRpbHMucm91bmQodmFsLCBwcmVjaXNpb24pO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVWYWx1ZXNbbm90UmVhZHlJbmRleF0uYWRkKHZhbCk7XG5cbiAgICAgICAgICAgICAgICAgICAgcm93LnZhcmlhYmxlc1t2YXJpYWJsZUluZGV4XSA9IHZhbDtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHZhciBuZXdSZWFkeUluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgIHVuaXF1ZVZhbHVlcy5mb3JFYWNoKCh1bmlxdWVWYWxzLCBub3RSZWFkeUluZGV4KT0+e1xuICAgICAgICAgICAgICAgIHZhciBvcmlnVW5pcXVlQ291bnQgPSB1bmlxdWVWYWx1ZXNOb1tub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXNbbm90UmVhZHlJbmRleF1dIDtcbiAgICAgICAgICAgICAgICBpZihvcmlnVW5pcXVlQ291bnQ9PXVuaXF1ZVZhbHMuc2l6ZSl7IC8vcmVhZHkgaW4gcHJldmlvdXMgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgICAgIG5ld1JlYWR5SW5kZXhlcy5wdXNoKG5vdFJlYWR5SW5kZXgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYobmV3UmVhZHlJbmRleGVzLmxlbmd0aCkgeyAvL3JldmVydCB2YWx1ZXMgdG8gcHJldiBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMucmV2ZXJzZSgpO1xuICAgICAgICAgICAgICAgIG5ld1JlYWR5SW5kZXhlcy5mb3JFYWNoKG5vdFJlYWR5SW5kZXg9PntcbiAgICAgICAgICAgICAgICAgICAgbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLnNwbGljZShub3RSZWFkeUluZGV4LCAxKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcHJlY2lzaW9uKys7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbn0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9leGNlcHRpb25zL2pvYi1jb21wdXRhdGlvbi1leGNlcHRpb25cIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSwgYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcblxuXG4gICAgICAgIGlmICgham9iUmVzdWx0LmRhdGEucm93cykge1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMubGVuZ3RoO1xuICAgIH1cblxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgZmFpbE9uSW52YWxpZFRyZWUgPSBwYXJhbXMudmFsdWUoXCJmYWlsT25JbnZhbGlkVHJlZVwiKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZU5hbWVzXCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2goKHZhcmlhYmxlTmFtZSwgaSk9PiB7XG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gaXRlbVtpXTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcblxuICAgICAgICB2YXIgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgaWYoIXZhbGlkICYmIGZhaWxPbkludmFsaWRUcmVlKXtcbiAgICAgICAgICAgIGxldCBlcnJvckRhdGEgPSB7XG4gICAgICAgICAgICAgICAgdmFyaWFibGVzOiB7fVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZhcmlhYmxlTmFtZXMuZm9yRWFjaCgodmFyaWFibGVOYW1lLCBpKT0+IHtcbiAgICAgICAgICAgICAgICBlcnJvckRhdGEudmFyaWFibGVzW3ZhcmlhYmxlTmFtZV0gPSBpdGVtW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJjb21wdXRhdGlvbnNcIiwgZXJyb3JEYXRhKVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHBheW9mZnMgPSBbXTtcblxuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKHBvbGljeT0+IHtcbiAgICAgICAgICAgIHZhciBwYXlvZmYgPSAnbi9hJztcbiAgICAgICAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgICAgIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKVswXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBheW9mZnMucHVzaChwYXlvZmYpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzLFxuICAgICAgICAgICAgdmFyaWFibGVzOiBpdGVtLFxuICAgICAgICAgICAgcGF5b2ZmczogcGF5b2Zmc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uID0gcGFyYW1zLnZhbHVlKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW09PiB7XG4gICAgICAgICAgICBpZiAoIWl0ZW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVtLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHZhcmlhYmxlcyA9IGl0ZW0udmFyaWFibGVzLm1hcCh2ID0+IHRoaXMudG9GbG9hdCh2KSk7XG5cbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gaXRlbS5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgICAgIHZhciByb3cgPSB7XG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBpLFxuICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZXM6IHZhcmlhYmxlcyxcbiAgICAgICAgICAgICAgICAgICAgcGF5b2ZmOiBVdGlscy5pc1N0cmluZyhwYXlvZmYpID8gcGF5b2ZmIDogdGhpcy50b0Zsb2F0KHBheW9mZilcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaChyb3cpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgZGVsZXRlIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBJbml0UG9saWNpZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImluaXRfcG9saWNpZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgdmFyIHBvbGljaWVzID0gcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXM7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzKTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGE9e31cbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzID0gcG9saWNpZXM7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc1V0aWxzfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY29tcHV0YXRpb25zLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcblxuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goQ29tcHV0YXRpb25zVXRpbHMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YT17XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlczogdmFyaWFibGVWYWx1ZXNcbiAgICAgICAgfTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm51bWJlck9mUnVuc1wiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPiAwKSk7XG5cbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZvcm11bGFcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7UHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuLi9uLXdheS9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4uL24td2F5L3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtQcm9iQ2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJvYi1jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtDb21wdXRlUG9saWN5U3RhdHNTdGVwfSBmcm9tIFwiLi9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplPTUpIHtcbiAgICAgICAgc3VwZXIoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplKTtcbiAgICAgICAgdGhpcy5uYW1lID0gXCJwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzXCI7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCkge1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IEluaXRQb2xpY2llc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlU3RlcCA9IG5ldyBQcm9iQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCB0aGlzLmJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcCh0aGlzLmNhbGN1bGF0ZVN0ZXApO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENvbXB1dGVQb2xpY3lTdGF0c1N0ZXAodGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5qb2JSZXBvc2l0b3J5KSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbikge1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzFdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1sxXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtsb2csIFV0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGVQb2xpY3lTdGF0c1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJjb21wdXRlX3BvbGljeV9zdGF0c1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucnVsZUJ5TmFtZVtydWxlTmFtZV07XG5cblxuICAgICAgICB2YXIgcGF5b2Zmc1BlclBvbGljeSA9IGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLm1hcCgoKT0+W10pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MuZm9yRWFjaChyb3c9PiB7XG4gICAgICAgICAgICBwYXlvZmZzUGVyUG9saWN5W3Jvdy5wb2xpY3lJbmRleF0ucHVzaChVdGlscy5pc1N0cmluZyhyb3cucGF5b2ZmKSA/IDAgOiByb3cucGF5b2ZmKVxuICAgICAgICB9KTtcblxuICAgICAgICBsb2cuZGVidWcoJ3BheW9mZnNQZXJQb2xpY3knLCBwYXlvZmZzUGVyUG9saWN5LCBqb2JSZXN1bHQuZGF0YS5yb3dzLmxlbmd0aCwgcnVsZS5tYXhpbWl6YXRpb24pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLm1lZGlhbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLm1lZGlhbihwYXlvZmZzKSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnN0YW5kYXJkRGV2aWF0aW9ucyA9IHBheW9mZnNQZXJQb2xpY3kubWFwKHBheW9mZnM9PkV4cHJlc3Npb25FbmdpbmUuc3RkKHBheW9mZnMpKTtcblxuICAgICAgICBpZiAocnVsZS5tYXhpbWl6YXRpb24pIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeUlzQmVzdFByb2JhYmlsaXRpZXMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHYsIG51bWJlck9mUnVucykpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeUlzQmVzdFByb2JhYmlsaXRpZXMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUodiwgbnVtYmVyT2ZSdW5zKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudCA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG5cblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi4vLi4vbi13YXkvc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iQ2FsY3VsYXRlU3RlcCBleHRlbmRzIENhbGN1bGF0ZVN0ZXAge1xuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEucm93cyl7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzID0gW107XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZU5hbWVzID0gdmFyaWFibGVOYW1lcztcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzID0gVXRpbHMuZmlsbChuZXcgQXJyYXkoam9iUmVzdWx0LmRhdGEucG9saWNpZXMubGVuZ3RoKSwgMCk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudCA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudCA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHBhcmFtcy52YWx1ZShcIm51bWJlck9mUnVuc1wiKTtcbiAgICB9XG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIGZvcih2YXIgcnVuSW5kZXg9MDsgcnVuSW5kZXg8Y2h1bmtTaXplOyBydW5JbmRleCsrKXtcbiAgICAgICAgICAgIHZhciBzaW5nbGVSdW5WYXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICAgICAgdmFyIGVycm9ycyA9IFtdO1xuICAgICAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIHZhciBldmFsdWF0ZWQgPSB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUuZXZhbCh2LmZvcm11bGEsIHRydWUsIFV0aWxzLmNsb25lRGVlcChkYXRhLmV4cHJlc3Npb25TY29wZSkpO1xuICAgICAgICAgICAgICAgICAgICBzaW5nbGVSdW5WYXJpYWJsZVZhbHVlcy5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChldmFsdWF0ZWQpKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2goZSl7XG4gICAgICAgICAgICAgICAgICAgIGVycm9ycy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhcmlhYmxlOiB2LFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmKGVycm9ycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgZXJyb3JEYXRhID0ge3ZhcmlhYmxlczogW119O1xuICAgICAgICAgICAgICAgIGVycm9ycy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1tlLnZhcmlhYmxlLm5hbWVdID0gZS5lcnJvci5tZXNzYWdlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbihcInBhcmFtLWNvbXB1dGF0aW9uXCIsIGVycm9yRGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXM7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciByID0gc3VwZXIucHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgam9iUmVzdWx0KTtcblxuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIHRoaXMudXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KTtcblxuICAgICAgICByZXR1cm4gcjtcbiAgICB9XG5cbiAgICB1cGRhdGVQb2xpY3lTdGF0cyhyLCBwb2xpY2llcywgbnVtYmVyT2ZSdW5zLCBqb2JSZXN1bHQpe1xuICAgICAgICB2YXIgaGlnaGVzdFBheW9mZiA9IC1JbmZpbml0eTtcbiAgICAgICAgdmFyIGxvd2VzdFBheW9mZiA9IEluZmluaXR5O1xuICAgICAgICB2YXIgYmVzdFBvbGljeUluZGV4ZXMgPSBbXTtcbiAgICAgICAgdmFyIHdvcnN0UG9saWN5SW5kZXhlcyA9IFtdO1xuXG4gICAgICAgIHZhciB6ZXJvTnVtID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcblxuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksaSk9PntcbiAgICAgICAgICAgIGxldCBwYXlvZmYgPSByLnBheW9mZnNbaV07XG4gICAgICAgICAgICBpZihVdGlscy5pc1N0cmluZyhwYXlvZmYpKXtcbiAgICAgICAgICAgICAgICBwYXlvZmYgPSB6ZXJvTnVtO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocGF5b2ZmIDwgbG93ZXN0UGF5b2ZmKXtcbiAgICAgICAgICAgICAgICBsb3dlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhsb3dlc3RQYXlvZmYpKXtcbiAgICAgICAgICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocGF5b2ZmID4gaGlnaGVzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgaGlnaGVzdFBheW9mZiA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICBiZXN0UG9saWN5SW5kZXhlcyA9IFtpXVxuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhoaWdoZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzW2ldLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwYXlvZmYsIG51bWJlck9mUnVucykpO1xuICAgICAgICB9KTtcblxuICAgICAgICBiZXN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0sIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGJlc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCB3b3JzdFBvbGljeUluZGV4ZXMubGVuZ3RoKSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcy5tYXAodj0+dGhpcy50b0Zsb2F0KHYpKTtcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFNwaWRlclBsb3RKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicGVyY2VudGFnZUNoYW5nZVJhbmdlXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID4gMCAmJiB2IDw9MTAwKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7U3BpZGVyUGxvdEpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3NwaWRlci1wbG90LWpvYi1wYXJhbWV0ZXJzXCI7XG5cbmV4cG9ydCBjbGFzcyBTcGlkZXJQbG90Sm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJzcGlkZXItcGxvdFwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDYWxjdWxhdGVTdGVwKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFNwaWRlclBsb3RKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMF0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzBdKTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycz10cnVlKXtcblxuICAgICAgICBsZXQgcmVzdWx0ID0gW107XG4gICAgICAgIGlmKHdpdGhIZWFkZXJzKXtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKFsndmFyaWFibGVfbmFtZScsICdwb2xpY3lfbm8nXS5jb25jYXQoam9iUmVzdWx0LnBlcmNlbnRhZ2VSYW5nZVZhbHVlcykpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaCgocm93LCBpbmRleCkgPT4ge1xuXG4gICAgICAgICAgICByZXN1bHQucHVzaCguLi5yb3cucGF5b2Zmcy5tYXAoKHBheW9mZnMsIHBvbGljeUluZGV4KT0+W1xuICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgcG9saWN5SW5kZXgrMSxcbiAgICAgICAgICAgICAgICAuLi5wYXlvZmZzXG4gICAgICAgICAgICBdKSk7XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0pvYkNvbXB1dGF0aW9uRXhjZXB0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2V4Y2VwdGlvbnMvam9iLWNvbXB1dGF0aW9uLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcbmltcG9ydCB7Q29tcHV0YXRpb25zVXRpbHN9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9jb21wdXRhdGlvbnMtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIDEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGxldCBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGxldCBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgbGV0IHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIGxldCBwZXJjZW50YWdlQ2hhbmdlUmFuZ2UgPSBwYXJhbXMudmFsdWUoXCJwZXJjZW50YWdlQ2hhbmdlUmFuZ2VcIik7XG4gICAgICAgIGxldCBsZW5ndGggPSBwYXJhbXMudmFsdWUoXCJsZW5ndGhcIik7XG4gICAgICAgIGxldCB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICBsZXQgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG4gICAgICAgIGxldCBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG5cbiAgICAgICAgbGV0IHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICBsZXQgcGF5b2ZmID0gdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlKTtcblxuICAgICAgICBsZXQgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QsIHJ1bGVOYW1lKTtcblxuICAgICAgICBsZXQgZGVmYXVsdFZhbHVlcyA9IHt9O1xuICAgICAgICBVdGlscy5mb3JPd24oZGF0YS5leHByZXNzaW9uU2NvcGUsICh2LGspPT57XG4gICAgICAgICAgICBkZWZhdWx0VmFsdWVzW2tdPXRoaXMudG9GbG9hdCh2KTtcbiAgICAgICAgfSk7XG5cblxuICAgICAgICBsZXQgcGVyY2VudGFnZVJhbmdlVmFsdWVzID0gQ29tcHV0YXRpb25zVXRpbHMuc2VxdWVuY2UoLXBlcmNlbnRhZ2VDaGFuZ2VSYW5nZSwgcGVyY2VudGFnZUNoYW5nZVJhbmdlLCAyKmxlbmd0aCsxKTtcblxuICAgICAgICBsZXQgdmFyaWFibGVWYWx1ZXMgPSBbXTtcblxuICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgbGV0IGRlZlZhbCA9IGRlZmF1bHRWYWx1ZXNbdi5uYW1lXTtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2gocGVyY2VudGFnZVJhbmdlVmFsdWVzLm1hcChwPT4gdGhpcy50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuYWRkKGRlZlZhbCwgRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwLDEwMCksIGRlZlZhbCkpKSkpO1xuICAgICAgICB9KTtcblxuXG4gICAgICAgIGlmKCFqb2JSZXN1bHQuZGF0YSl7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YSA9IHtcbiAgICAgICAgICAgICAgICB2YXJpYWJsZU5hbWVzOiB2YXJpYWJsZU5hbWVzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXM6IGRlZmF1bHRWYWx1ZXMsXG4gICAgICAgICAgICAgICAgcGVyY2VudGFnZVJhbmdlVmFsdWVzOiBwZXJjZW50YWdlUmFuZ2VWYWx1ZXMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFBheW9mZjogdGhpcy50b0Zsb2F0KHBheW9mZilbMF0sXG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzLFxuICAgICAgICAgICAgICAgIHJvd3M6IFtdXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwidmFyaWFibGVWYWx1ZXNcIiwgdmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMubGVuZ3RoO1xuICAgIH1cblxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUpIHtcbiAgICAgICAgbGV0IHZhcmlhYmxlVmFsdWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwidmFyaWFibGVWYWx1ZXNcIik7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBpdGVtSW5kZXgsIGpvYlJlc3VsdCkge1xuICAgICAgICBsZXQgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIGxldCBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICBsZXQgZmFpbE9uSW52YWxpZFRyZWUgPSBwYXJhbXMudmFsdWUoXCJmYWlsT25JbnZhbGlkVHJlZVwiKTtcbiAgICAgICAgbGV0IGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgbGV0IHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICBsZXQgdmFyaWFibGVOYW1lcyA9IHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZU5hbWVzXCIpO1xuICAgICAgICBsZXQgdmFyaWFibGVOYW1lID0gdmFyaWFibGVOYW1lc1tpdGVtSW5kZXhdO1xuXG5cbiAgICAgICAgbGV0IHBheW9mZnMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5tYXAocG9saWN5PT5bXSk7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcblxuXG4gICAgICAgIGl0ZW0uZm9yRWFjaCh2YXJpYWJsZVZhbHVlPT57XG5cbiAgICAgICAgICAgIGRhdGEuZXhwcmVzc2lvblNjb3BlW3ZhcmlhYmxlTmFtZV0gPSB2YXJpYWJsZVZhbHVlO1xuXG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgdHJlZVJvb3QpO1xuICAgICAgICAgICAgbGV0IHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUodHJlZVJvb3QpKTtcbiAgICAgICAgICAgIGxldCB2YWxpZCA9IHZyLmlzVmFsaWQoKTtcblxuICAgICAgICAgICAgaWYoIXZhbGlkICYmIGZhaWxPbkludmFsaWRUcmVlKXtcbiAgICAgICAgICAgICAgICBsZXQgZXJyb3JEYXRhID0ge1xuICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZXM6IHt9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBlcnJvckRhdGEudmFyaWFibGVzW3ZhcmlhYmxlTmFtZV0gPSB2YXJpYWJsZVZhbHVlO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uKFwiY29tcHV0YXRpb25zXCIsIGVycm9yRGF0YSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWNpZXMuZm9yRWFjaCgocG9saWN5LCBwb2xpY3lJbmRleCk9PntcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgICAgICBsZXQgcGF5b2ZmID0gdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpWzBdO1xuICAgICAgICAgICAgICAgIHBheW9mZnNbcG9saWN5SW5kZXhdLnB1c2godGhpcy50b0Zsb2F0KHBheW9mZikpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhcmlhYmxlTmFtZTogdmFyaWFibGVOYW1lLFxuICAgICAgICAgICAgdmFyaWFibGVJbmRleDogaXRlbUluZGV4LFxuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXM6IGl0ZW0sXG4gICAgICAgICAgICBwYXlvZmZzOiBwYXlvZmZzXG4gICAgICAgIH07XG5cbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cy5wdXNoKC4uLml0ZW1zKTtcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodil7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbn0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9leGNlcHRpb25zL2pvYi1jb21wdXRhdGlvbi1leGNlcHRpb25cIjtcbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCAxKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBsZXQgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICBsZXQgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIGxldCBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgbGV0IHZhcmlhYmxlVmFsdWVzID0gam9iRXhlY3V0aW9uQ29udGV4dC5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuICAgICAgICBsZXQgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuXG4gICAgICAgIGxldCB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgbGV0IHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSk7XG5cblxuXG4gICAgICAgIGxldCBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCwgcnVsZU5hbWUpO1xuXG4gICAgICAgIGxldCBkZWZhdWx0VmFsdWVzID0ge307XG4gICAgICAgIFV0aWxzLmZvck93bihkYXRhLmV4cHJlc3Npb25TY29wZSwgKHYsayk9PntcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZXNba109dGhpcy50b0Zsb2F0KHYpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lczogdmFyaWFibGVOYW1lcyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWVzOiBkZWZhdWx0VmFsdWVzLFxuICAgICAgICAgICAgICAgIHZhcmlhYmxlRXh0ZW50czogdmFyaWFibGVWYWx1ZXMubWFwKHY9Plt2WzBdLCB2W3YubGVuZ3RoLTFdXSksXG4gICAgICAgICAgICAgICAgZGVmYXVsdFBheW9mZjogdGhpcy50b0Zsb2F0KHBheW9mZilbMF0sXG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzLFxuICAgICAgICAgICAgICAgIHJvd3M6IFtdXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplKSB7XG4gICAgICAgIGxldCB2YXJpYWJsZVZhbHVlcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgaXRlbUluZGV4LCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbGV0IHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICBsZXQgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgbGV0IGZhaWxPbkludmFsaWRUcmVlID0gcGFyYW1zLnZhbHVlKFwiZmFpbE9uSW52YWxpZFRyZWVcIik7XG4gICAgICAgIGxldCBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIGxldCB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZSA9IHZhcmlhYmxlTmFtZXNbaXRlbUluZGV4XTtcblxuICAgICAgICBsZXQgZXh0ZW50cyA9IGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLm1hcChwb2xpY3k9PntcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgbWluOiBJbmZpbml0eSxcbiAgICAgICAgICAgICAgICBtYXg6IC1JbmZpbml0eVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgdmFsdWVzID0gam9iUmVzdWx0LmRhdGEucG9saWNpZXMubWFwKHBvbGljeT0+e1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBtaW46IG51bGwsXG4gICAgICAgICAgICAgICAgbWF4OiBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG5cblxuICAgICAgICBpdGVtLmZvckVhY2godmFyaWFibGVWYWx1ZT0+e1xuXG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgICAgIGxldCB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG4gICAgICAgICAgICBsZXQgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgICAgIGlmKCF2YWxpZCAmJiBmYWlsT25JbnZhbGlkVHJlZSl7XG4gICAgICAgICAgICAgICAgbGV0IGVycm9yRGF0YSA9IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyaWFibGVzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1t2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbihcImNvbXB1dGF0aW9uc1wiLCBlcnJvckRhdGEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSwgcG9saWN5SW5kZXgpPT57XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UsIHBvbGljeSk7XG4gICAgICAgICAgICAgICAgbGV0IHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKVswXTtcblxuICAgICAgICAgICAgICAgIGlmKHBheW9mZiA8IGV4dGVudHNbcG9saWN5SW5kZXhdLm1pbil7XG4gICAgICAgICAgICAgICAgICAgIGV4dGVudHNbcG9saWN5SW5kZXhdLm1pbiA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVzW3BvbGljeUluZGV4XS5taW4gPSB2YXJpYWJsZVZhbHVlXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYocGF5b2ZmID4gZXh0ZW50c1twb2xpY3lJbmRleF0ubWF4KXtcbiAgICAgICAgICAgICAgICAgICAgZXh0ZW50c1twb2xpY3lJbmRleF0ubWF4ID0gcGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZXNbcG9saWN5SW5kZXhdLm1heCA9IHZhcmlhYmxlVmFsdWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFyaWFibGVOYW1lOiB2YXJpYWJsZU5hbWUsXG4gICAgICAgICAgICB2YXJpYWJsZUluZGV4OiBpdGVtSW5kZXgsXG4gICAgICAgICAgICBleHRlbnRzOiBleHRlbnRzLm1hcChlPT5bdGhpcy50b0Zsb2F0KGUubWluKSwgdGhpcy50b0Zsb2F0KGUubWF4KV0pLFxuICAgICAgICAgICAgZXh0ZW50VmFyaWFibGVWYWx1ZXM6IHZhbHVlcy5tYXAodj0+W3RoaXMudG9GbG9hdCh2Lm1pbiksIHRoaXMudG9GbG9hdCh2Lm1heCldKVxuICAgICAgICB9O1xuXG4gICAgfVxuXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaCguLi5pdGVtcyk7XG4gICAgfVxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3Muc29ydCgoYSwgYik9PihiLmV4dGVudHNbMF1bMV0tYi5leHRlbnRzWzBdWzBdKS0oYS5leHRlbnRzWzBdWzFdLWEuZXh0ZW50c1swXVswXSkpXG5cbiAgICB9XG5cblxuICAgIHRvRmxvYXQodil7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc1V0aWxzfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY29tcHV0YXRpb25zLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKENvbXB1dGF0aW9uc1V0aWxzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInZhcmlhYmxlVmFsdWVzXCIsIHZhcmlhYmxlVmFsdWVzKTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ2YXJpYWJsZXNcIiwgW1xuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWluXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtYXhcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImxlbmd0aFwiLCBQQVJBTUVURVJfVFlQRS5JTlRFR0VSKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCB2ID0+IHYgPj0gMCksXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICB2ID0+IHZbXCJtaW5cIl0gPD0gdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZmFpbE9uSW52YWxpZFRyZWU6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7UHJlcGFyZVZhcmlhYmxlc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7VG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi90b3JuYWRvLWRpYWdyYW0tam9iLXBhcmFtZXRlcnNcIjtcblxuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJ0b3JuYWRvLWRpYWdyYW1cIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAoam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENhbGN1bGF0ZVN0ZXAoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMV0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzFdKTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycz10cnVlKXtcbiAgICAgICAgbGV0IHJlc3VsdCA9IFtdO1xuICAgICAgICBpZih3aXRoSGVhZGVycyl7XG4gICAgICAgICAgICByZXN1bHQucHVzaChbJ3ZhcmlhYmxlX25hbWUnLCAnZGVmYXVsdF92YXJfdmFsdWUnLCBcIm1pbl92YXJfdmFsdWVcIiwgXCJtYXhfdmFyX3ZhbHVlXCIsICdkZWZhdWx0X3BheW9mZicsIFwibWluX3BheW9mZlwiLCBcIm1heF9wYXlvZmZcIiwgXCJwb2xpY3lfbm9cIl0pO1xuICAgICAgICB9XG5cblxuICAgICAgICBqb2JSZXN1bHQucm93cy5mb3JFYWNoKChyb3csIGluZGV4KSA9PiB7XG5cbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLnJvdy5leHRlbnRzLm1hcCgoZXh0ZW50LCBwb2xpY3lJbmRleCk9PltcbiAgICAgICAgICAgICAgICByb3cudmFyaWFibGVOYW1lLFxuICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kZWZhdWx0VmFsdWVzW3Jvdy52YXJpYWJsZU5hbWVdLFxuICAgICAgICAgICAgICAgIHJvdy5leHRlbnRWYXJpYWJsZVZhbHVlc1twb2xpY3lJbmRleF1bMF0sXG4gICAgICAgICAgICAgICAgcm93LmV4dGVudFZhcmlhYmxlVmFsdWVzW3BvbGljeUluZGV4XVsxXSxcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGVmYXVsdFBheW9mZixcbiAgICAgICAgICAgICAgICBleHRlbnRbMF0sXG4gICAgICAgICAgICAgICAgZXh0ZW50WzFdLFxuICAgICAgICAgICAgICAgIHBvbGljeUluZGV4KzFcbiAgICAgICAgICAgIF0pKTtcblxuICAgICAgICB9KTtcblxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vc3RlcFwiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuXG4vKmpvYiBzdGVwIHRoYXQgcHJvY2VzcyBiYXRjaCBvZiBpdGVtcyovXG5leHBvcnQgY2xhc3MgQmF0Y2hTdGVwIGV4dGVuZHMgU3RlcCB7XG5cbiAgICBjaHVua1NpemU7XG4gICAgc3RhdGljIENVUlJFTlRfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfY3VycmVudF9pdGVtX2NvdW50JztcbiAgICBzdGF0aWMgVE9UQUxfSVRFTV9DT1VOVF9QUk9QID0gJ2JhdGNoX3N0ZXBfdG90YWxfaXRlbV9jb3VudCc7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBjaHVua1NpemUpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuY2h1bmtTaXplID0gY2h1bmtTaXplO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHN0ZXAgaW5pdGlhbGl6YXRpb24uIFNob3VsZCByZXR1cm4gdG90YWwgaXRlbSBjb3VudFxuICAgICAqL1xuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLmluaXQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcmVhZCBhbmQgcmV0dXJuIGNodW5rIG9mIGl0ZW1zIHRvIHByb2Nlc3NcbiAgICAgKi9cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnJlYWROZXh0Q2h1bmsgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvY2VzcyBzaW5nbGUgaXRlbVxuICAgICAqIE11c3QgcmV0dXJuIHByb2Nlc3NlZCBpdGVtIHdoaWNoIHdpbGwgYmUgcGFzc2VkIGluIGEgY2h1bmsgdG8gd3JpdGVDaHVuayBmdW5jdGlvblxuICAgICAqL1xuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5wcm9jZXNzSXRlbSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byB3cml0ZSBjaHVuayBvZiBpdGVtcy4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gcG9zdHByb2Nlc3NpbmcgYWZ0ZXIgYWxsIGl0ZW1zIGhhdmUgYmVlbiBwcm9jZXNzZWQuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuXG4gICAgc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuVE9UQUxfSVRFTV9DT1VOVF9QUk9QKTtcbiAgICB9XG5cbiAgICBzZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QLCBjb3VudCk7XG4gICAgfVxuXG4gICAgZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCkgfHwgMDtcbiAgICB9XG5cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBpbml0aWFsaXplIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pLnRoZW4odG90YWxJdGVtQ291bnQ9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdG90YWxJdGVtQ291bnQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGlmKCEoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSl7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcG9zdFByb2Nlc3MgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIGhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGN1cnJlbnRJdGVtQ291bnQgPSB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciB0b3RhbEl0ZW1Db3VudCA9IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBjaHVua1NpemUgPSBNYXRoLm1pbih0aGlzLmNodW5rU2l6ZSwgdG90YWxJdGVtQ291bnQgLSBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgaWYgKGN1cnJlbnRJdGVtQ291bnQgPj0gdG90YWxJdGVtQ291bnQpIHtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb25cbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50LCBjaHVua1NpemUsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHJlYWQgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pLnRoZW4oY2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcHJvY2VzcyBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKHByb2Nlc3NlZENodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIHByb2Nlc3NlZENodW5rLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byB3cml0ZSBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKChyZXMpPT4ge1xuICAgICAgICAgICAgY3VycmVudEl0ZW1Db3VudCArPSBjaHVua1NpemU7XG4gICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHsgLy9UT0RPIHByb21pc2lmeVxuICAgICAgICByZXR1cm4gY2h1bmsubWFwKChpdGVtLCBpKT0+dGhpcy5wcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50K2ksIGpvYlJlc3VsdCkpO1xuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCwgcHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGNoZWNrSm9iRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpLmNoZWNrRXhlY3V0aW9uRmxhZ3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjbGFzcyBFeHRlbmRhYmxlRXJyb3Ige1xuICAgIGRhdGE7XG4gICAgY29uc3RydWN0b3IobWVzc2FnZSwgZGF0YSkge1xuICAgICAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9leHRlbmRhYmxlLWVycm9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcmVzdGFydC1leGNlcHRpb24nXG5cblxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkludGVycnVwdGVkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JSZXN0YXJ0RXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgRXhlY3V0aW9uQ29udGV4dCB7XG5cbiAgICBkaXJ0eSA9IGZhbHNlO1xuICAgIGNvbnRleHQgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGNvbnRleHQpIHtcbiAgICAgICAgaWYgKGNvbnRleHQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udGV4dCA9IFV0aWxzLmNsb25lKGNvbnRleHQpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdXQoa2V5LCB2YWx1ZSkge1xuICAgICAgICB2YXIgcHJldlZhbHVlID0gdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gdGhpcy5jb250ZXh0W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMuZGlydHkgPSBwcmV2VmFsdWUgPT0gbnVsbCB8fCBwcmV2VmFsdWUgIT0gbnVsbCAmJiBwcmV2VmFsdWUgIT0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jb250ZXh0W2tleV07XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlICE9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXQoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBjb250YWluc0tleShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5oYXNPd25Qcm9wZXJ0eShrZXkpO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgIH1cblxuICAgIHNldERhdGEoZGF0YSkgeyAvL3NldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLnB1dChcImRhdGFcIiwgZGF0YSk7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHsgLy8gZ2V0IGRhdGEgbW9kZWxcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0KFwiZGF0YVwiKTtcbiAgICB9XG5cbiAgICBnZXREVE8oKSB7XG4gICAgICAgIHZhciBkdG8gPSBVdGlscy5jbG9uZURlZXAodGhpcyk7XG4gICAgICAgIHZhciBkYXRhID0gdGhpcy5nZXREYXRhKCk7XG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBkYXRhID0gZGF0YS5nZXREVE8oKTtcbiAgICAgICAgICAgIGR0by5jb250ZXh0W1wiZGF0YVwiXSA9IGRhdGE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbn1cbiIsImltcG9ydCAqIGFzIGV4Y2VwdGlvbnMgZnJvbSAnLi9leGNlcHRpb25zJ1xuXG5leHBvcnQge2V4Y2VwdGlvbnN9XG5leHBvcnQgKiBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0J1xuZXhwb3J0ICogZnJvbSAnLi9qb2InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tZmxhZydcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1saXN0ZW5lcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Ita2V5LWdlbmVyYXRvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWxhdW5jaGVyJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2Itc3RhdHVzJ1xuZXhwb3J0ICogZnJvbSAnLi9zaW1wbGUtam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwJ1xuZXhwb3J0ICogZnJvbSAnLi9zdGVwLWV4ZWN1dGlvbidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24tbGlzdGVuZXInXG5cblxuXG5cbiIsImV4cG9ydCBjb25zdCBKT0JfRVhFQ1VUSU9OX0ZMQUcgPSB7XG4gICAgU1RPUDogJ1NUT1AnXG59O1xuIiwiZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcbiAgICAvKkNhbGxlZCBiZWZvcmUgYSBqb2IgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cblxuICAgIC8qQ2FsbGVkIGFmdGVyIGNvbXBsZXRpb24gb2YgYSBqb2IuIENhbGxlZCBhZnRlciBib3RoIHN1Y2Nlc3NmdWwgYW5kIGZhaWxlZCBleGVjdXRpb25zKi9cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5cbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGV4ZWN1dGlvbiBvZiBhIGpvYi4qL1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbiB7XG4gICAgaWQ7XG4gICAgam9iSW5zdGFuY2U7XG4gICAgam9iUGFyYW1ldGVycztcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIHN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuVU5LTk9XTjtcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcblxuICAgIHN0YXJ0VGltZSA9IG51bGw7XG4gICAgY3JlYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgZW5kVGltZSA9IG51bGw7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzLCBpZCkge1xuICAgICAgICBpZihpZD09PW51bGwgfHwgaWQgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB0aGlzLmlkID0gVXRpbHMuZ3VpZCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgdGhpcy5qb2JQYXJhbWV0ZXJzID0gam9iUGFyYW1ldGVycztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWdpc3RlciBhIHN0ZXAgZXhlY3V0aW9uIHdpdGggdGhlIGN1cnJlbnQgam9iIGV4ZWN1dGlvbi5cbiAgICAgKiBAcGFyYW0gc3RlcE5hbWUgdGhlIG5hbWUgb2YgdGhlIHN0ZXAgdGhlIG5ldyBleGVjdXRpb24gaXMgYXNzb2NpYXRlZCB3aXRoXG4gICAgICovXG4gICAgY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSkge1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbiA9IG5ldyBTdGVwRXhlY3V0aW9uKHN0ZXBOYW1lLCB0aGlzKTtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBpc1J1bm5pbmcoKSB7XG4gICAgICAgIHJldHVybiAhdGhpcy5lbmRUaW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlc3QgaWYgdGhpcyBKb2JFeGVjdXRpb24gaGFzIGJlZW4gc2lnbmFsbGVkIHRvXG4gICAgICogc3RvcC5cbiAgICAgKi9cbiAgICBpc1N0b3BwaW5nKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0dXMgPT09IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2lnbmFsIHRoZSBKb2JFeGVjdXRpb24gdG8gc3RvcC5cbiAgICAgKi9cbiAgICBzdG9wKCkge1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLmZvckVhY2goc2U9PiB7XG4gICAgICAgICAgICBzZS50ZXJtaW5hdGVPbmx5ID0gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICB9XG5cbiAgICBnZXREYXRhKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRpb25Db250ZXh0LmdldERhdGEoKTtcbiAgICB9XG5cbiAgICBnZXREVE8oZmlsdGVyZWRQcm9wZXJ0aWVzID0gW10sIGRlZXBDbG9uZSA9IHRydWUpIHtcbiAgICAgICAgdmFyIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVEZWVwV2l0aDtcbiAgICAgICAgaWYgKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGZpbHRlcmVkUHJvcGVydGllcy5pbmRleE9mKGtleSkgPiAtMSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoW1wiam9iUGFyYW1ldGVyc1wiLCBcImV4ZWN1dGlvbkNvbnRleHRcIl0uaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFV0aWxzLmdldEVycm9yRFRPKHZhbHVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oW1wiam9iRXhlY3V0aW9uXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsIi8qIG9iamVjdCByZXByZXNlbnRpbmcgYSB1bmlxdWVseSBpZGVudGlmaWFibGUgam9iIHJ1bi4gSm9iSW5zdGFuY2UgY2FuIGJlIHJlc3RhcnRlZCBtdWx0aXBsZSB0aW1lcyBpbiBjYXNlIG9mIGV4ZWN1dGlvbiBmYWlsdXJlIGFuZCBpdCdzIGxpZmVjeWNsZSBlbmRzIHdpdGggZmlyc3Qgc3VjY2Vzc2Z1bCBleGVjdXRpb24qL1xuZXhwb3J0IGNsYXNzIEpvYkluc3RhbmNle1xuXG4gICAgaWQ7XG4gICAgam9iTmFtZTtcbiAgICBjb25zdHJ1Y3RvcihpZCwgam9iTmFtZSl7XG4gICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgdGhpcy5qb2JOYW1lID0gam9iTmFtZTtcbiAgICB9XG5cbn1cbiIsIlxuZXhwb3J0IGNsYXNzIEpvYktleUdlbmVyYXRvciB7XG4gICAgLypNZXRob2QgdG8gZ2VuZXJhdGUgdGhlIHVuaXF1ZSBrZXkgdXNlZCB0byBpZGVudGlmeSBhIGpvYiBpbnN0YW5jZS4qL1xuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBcIlwiO1xuICAgICAgICBqb2JQYXJhbWV0ZXJzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuICAgICAgICAgICAgaWYoZC5pZGVudGlmeWluZyl7XG4gICAgICAgICAgICAgICAgcmVzdWx0ICs9IGQubmFtZSArIFwiPVwiICsgam9iUGFyYW1ldGVycy52YWx1ZXNbZC5uYW1lXSArIFwiO1wiO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlc3RhcnRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXJlc3RhcnQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JMYXVuY2hlciB7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYldvcmtlcjtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGpvYldvcmtlciwgZGF0YU1vZGVsU2VyaWFsaXplcikge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IGpvYldvcmtlcjtcbiAgICAgICAgdGhpcy5kYXRhTW9kZWxTZXJpYWxpemVyID0gZGF0YU1vZGVsU2VyaWFsaXplcjtcbiAgICB9XG5cblxuICAgIHJ1bihqb2JPck5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICB2YXIgam9iO1xuICAgICAgICB2YXIgam9iUGFyYW1ldGVycztcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIGlmIChVdGlscy5pc1N0cmluZyhqb2JPck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JPck5hbWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGpvYiA9IGpvYk9yTmFtZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJObyBzdWNoIGpvYjogXCIgKyBqb2JPck5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVyc1ZhbHVlcyk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSk7XG4gICAgICAgIH0pLnRoZW4odmFsaWQ9PntcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuY3JlYXRlSm9iRXhlY3V0aW9uKGpvYi5uYW1lLCBqb2JQYXJhbWV0ZXJzLCBkYXRhKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuXG5cbiAgICAgICAgICAgICAgICBpZih0aGlzLmpvYldvcmtlcil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYjogW1wiICsgam9iLm5hbWUgKyBcIl0gZXhlY3V0aW9uIFtcIitqb2JFeGVjdXRpb24uaWQrXCJdIGRlbGVnYXRlZCB0byB3b3JrZXJcIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuam9iV29ya2VyLmV4ZWN1dGVKb2Ioam9iRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgZXhlY3V0aW9uUHJvbWlzZSA9IHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIGlmKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblByb21pc2U7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHZhbGlkYXRlKGpvYiwgam9iUGFyYW1ldGVycywgZGF0YSl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycykudGhlbihsYXN0RXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAobGFzdEV4ZWN1dGlvbiAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFqb2IuaXNSZXN0YXJ0YWJsZSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBub3QgcmVzdGFydGFibGVcIik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbGFzdEV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKGV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIlN0ZXAgW1wiICsgZXhlY3V0aW9uLnN0ZXBOYW1lICsgXCJdIGlzIG9mIHN0YXR1cyBVTktOT1dOXCIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoam9iLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgJiYgIWpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGpvYi5qb2JEYXRhVmFsaWRhdG9yICYmICFqb2Iuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShkYXRhKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2JMYXVuY2hlci5ydW4gZm9yIGpvYjogXCIram9iLm5hbWUpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIC8qKkV4ZWN1dGUgcHJldmlvdXNseSBjcmVhdGVkIGpvYiBleGVjdXRpb24qL1xuICAgIGV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCl7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgIGlmKFV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgfSkudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKCFqb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbk9ySWQgKyBcIl0gaXMgbm90IGZvdW5kXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5TVEFSVElORykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIFtcIiArIGpvYkV4ZWN1dGlvbi5pZCArIFwiXSBhbHJlYWR5IHN0YXJ0ZWRcIik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBqb2JOYW1lID0gam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWU7XG4gICAgICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgICAgIGlmKCFqb2Ipe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iTmFtZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiAgdGhpcy5fZXhlY3V0ZShqb2IsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pe1xuICAgICAgICB2YXIgam9iTmFtZSA9IGpvYi5uYW1lO1xuICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBsYXVuY2hlZCB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgam9iRXhlY3V0aW9uLmdldERhdGEoKSk7XG4gICAgICAgIHJldHVybiBqb2IuZXhlY3V0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuaW5mbyhcIkpvYjogW1wiICsgam9iTmFtZSArIFwiXSBjb21wbGV0ZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdIGFuZCB0aGUgZm9sbG93aW5nIHN0YXR1czogW1wiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiXVwiKTtcbiAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgIH0pLmNhdGNoKGUgPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gZmFpbGVkIHVuZXhwZWN0ZWRseSBhbmQgZmF0YWxseSB3aXRoIHRoZSBmb2xsb3dpbmcgcGFyYW1ldGVyczogW1wiICsgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMgKyBcIl1cIiwgZSk7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNvbnN0IFBBUkFNRVRFUl9UWVBFID0ge1xuICAgIFNUUklORzogJ1NUUklORycsXG4gICAgREFURTogJ0RBVEUnLFxuICAgIElOVEVHRVI6ICdJTlRFR0VSJyxcbiAgICBOVU1CRVI6ICdGTE9BVCcsXG4gICAgQk9PTEVBTjogJ0JPT0xFQU4nLFxuICAgIE5VTUJFUl9FWFBSRVNTSU9OOiAnTlVNQkVSX0VYUFJFU1NJT04nLFxuICAgIENPTVBPU0lURTogJ0NPTVBPU0lURScgLy9jb21wb3NpdGUgcGFyYW1ldGVyIHdpdGggbmVzdGVkIHN1YnBhcmFtZXRlcnNcbn07XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uIHtcbiAgICBuYW1lO1xuICAgIHR5cGU7XG4gICAgbmVzdGVkUGFyYW1ldGVycyA9IFtdO1xuICAgIG1pbk9jY3VycztcbiAgICBtYXhPY2N1cnM7XG4gICAgcmVxdWlyZWQgPSB0cnVlO1xuXG4gICAgaWRlbnRpZnlpbmc7XG4gICAgdmFsaWRhdG9yO1xuICAgIHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zLCBtaW5PY2N1cnMgPSAxLCBtYXhPY2N1cnMgPSAxLCBpZGVudGlmeWluZyA9IGZhbHNlLCBzaW5nbGVWYWx1ZVZhbGlkYXRvciA9IG51bGwsIHZhbGlkYXRvciA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgaWYgKFV0aWxzLmlzQXJyYXkodHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zKSkge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFO1xuICAgICAgICAgICAgdGhpcy5uZXN0ZWRQYXJhbWV0ZXJzID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy50eXBlID0gdHlwZU9yTmVzdGVkUGFyYW1ldGVyc0RlZmluaXRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudmFsaWRhdG9yID0gdmFsaWRhdG9yO1xuICAgICAgICB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yID0gc2luZ2xlVmFsdWVWYWxpZGF0b3I7XG4gICAgICAgIHRoaXMuaWRlbnRpZnlpbmcgPSBpZGVudGlmeWluZztcbiAgICAgICAgdGhpcy5taW5PY2N1cnMgPSBtaW5PY2N1cnM7XG4gICAgICAgIHRoaXMubWF4T2NjdXJzID0gbWF4T2NjdXJzO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICB0aGlzW2tleV0gPSB2YWw7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlLCBhbGxWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGlzQXJyYXkgPSBVdGlscy5pc0FycmF5KHZhbHVlKTtcblxuICAgICAgICBpZiAodGhpcy5tYXhPY2N1cnMgPiAxICYmICFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcylcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPCB0aGlzLm1pbk9jY3VycyB8fCB2YWx1ZS5sZW5ndGggPiB0aGlzLm1heE9jY3Vycykge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWx1ZS5ldmVyeSh2PT50aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUodiwgdmFsdWUpKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMudmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IodmFsdWUsIGFsbFZhbHVlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBzdGF0aWMgY29tcHV0ZU51bWJlckV4cHJlc3Npb24odmFsKXtcbiAgICAgICAgbGV0IHBhcnNlZCA9IHBhcnNlRmxvYXQodmFsKTtcbiAgICAgICAgaWYocGFyc2VkID09PSBJbmZpbml0eSB8fCBwYXJzZWQgPT09IC1JbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHBhcnNlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKCFFeHByZXNzaW9uRW5naW5lLnZhbGlkYXRlKHZhbCwge30sIGZhbHNlKSl7XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZXZhbCh2YWwsIHRydWUpXG4gICAgfVxuXG4gICAgLy8gYWxsVmFsdWVzIC0gYWxsIHZhbHVlcyBvbiB0aGUgc2FtZSBsZXZlbFxuICAgIHZhbGlkYXRlU2luZ2xlVmFsdWUodmFsdWUsIGFsbFZhbHVlcykge1xuXG4gICAgICAgIGlmICgoIXZhbHVlICYmIHZhbHVlICE9PSAwICYmIHZhbHVlICE9PSBmYWxzZSkgJiYgdGhpcy5taW5PY2N1cnMgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gIXRoaXMucmVxdWlyZWRcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5TVFJJTkcgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkRBVEUgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNEYXRlKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5JTlRFR0VSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzSW50KHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNOdW1iZXIodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuQk9PTEVBTiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0Jvb2xlYW4odmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTiA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24odmFsdWUpO1xuICAgICAgICAgICAgaWYodmFsdWUgPT09IG51bGwpe1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURSA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICBpZiAoIVV0aWxzLmlzT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy5uZXN0ZWRQYXJhbWV0ZXJzLmV2ZXJ5KChuZXN0ZWREZWYsIGkpPT5uZXN0ZWREZWYudmFsaWRhdGUodmFsdWVbbmVzdGVkRGVmLm5hbWVdKSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IodmFsdWUsIGFsbFZhbHVlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YWx1ZSh2YWx1ZSl7XG4gICAgICAgIGlmKFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OID09PSB0aGlzLnR5cGUpIHtcbiAgICAgICAgICAgIHJldHVybiBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1BBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyc3tcbiAgICBkZWZpbml0aW9ucyA9IFtdO1xuICAgIHZhbHVlcz17fTtcblxuICAgIGNvbnN0cnVjdG9yKHZhbHVlcyl7XG4gICAgICAgIHRoaXMuaW5pdERlZmluaXRpb25zKCk7XG4gICAgICAgIHRoaXMuaW5pdERlZmF1bHRWYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLnZhbHVlcywgdmFsdWVzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXREZWZpbml0aW9ucygpe1xuXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKXtcblxuICAgIH1cblxuICAgIHZhbGlkYXRlKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmRlZmluaXRpb25zLmV2ZXJ5KChkZWYsIGkpPT5kZWYudmFsaWRhdGUodGhpcy52YWx1ZXNbZGVmLm5hbWVdLCB0aGlzLnZhbHVlcykpO1xuICAgIH1cblxuICAgIGdldERlZmluaXRpb24ocGF0aCl7XG4gICAgICAgIHZhciBkZWZzID10aGlzLmRlZmluaXRpb25zO1xuICAgICAgICBsZXQgZGVmID0gbnVsbDtcbiAgICAgICAgaWYoIXBhdGguc3BsaXQoKS5ldmVyeShuYW1lPT57XG4gICAgICAgICAgICAgICAgZGVmID0gVXRpbHMuZmluZChkZWZzLCBkPT5kLm5hbWUgPT0gbmFtZSk7XG4gICAgICAgICAgICAgICAgaWYoIWRlZil7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWZzID0gZGVmLm5lc3RlZFBhcmFtZXRlcnM7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pKXtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWY7XG4gICAgfVxuXG4gICAgLypnZXQgb3Igc2V0IHZhbHVlIGJ5IHBhdGgqL1xuICAgIHZhbHVlKHBhdGgsIHZhbHVlKXtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIGxldCBkZWYgPSB0aGlzLmdldERlZmluaXRpb24ocGF0aCk7XG4gICAgICAgICAgICBsZXQgdmFsID0gVXRpbHMuZ2V0KHRoaXMudmFsdWVzLCBwYXRoLCBudWxsKTtcbiAgICAgICAgICAgIGlmKGRlZil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlZi52YWx1ZSh2YWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuICB2YWw7XG4gICAgICAgIH1cbiAgICAgICAgVXRpbHMuc2V0KHRoaXMudmFsdWVzLCBwYXRoLCB2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICB0b1N0cmluZygpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gXCJKb2JQYXJhbWV0ZXJzW1wiO1xuXG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMuZm9yRWFjaCgoZCwgaSk9PiB7XG5cbiAgICAgICAgICAgIHZhciB2YWwgPSB0aGlzLnZhbHVlc1tkLm5hbWVdO1xuICAgICAgICAgICAgLy8gaWYoVXRpbHMuaXNBcnJheSh2YWwpKXtcbiAgICAgICAgICAgIC8vICAgICB2YXIgdmFsdWVzID0gdmFsO1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICAvLyBpZihQQVJBTUVURVJfVFlQRS5DT01QT1NJVEUgPT0gZC50eXBlKXtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyB9XG5cbiAgICAgICAgICAgIHJlc3VsdCArPSBkLm5hbWUgKyBcIj1cIit2YWwgKyBcIjtcIjtcbiAgICAgICAgfSk7XG4gICAgICAgIHJlc3VsdCs9XCJdXCI7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZ2V0RFRPKCl7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWx1ZXM6IHRoaXMudmFsdWVzXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2pvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge2RlZmF1bHQgYXMgaWRifSBmcm9tIFwiaWRiXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi4vam9iLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4uL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge2xvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qIEluZGV4ZWREQiBqb2IgcmVwb3NpdG9yeSovXG5leHBvcnQgY2xhc3MgSWRiSm9iUmVwb3NpdG9yeSBleHRlbmRzIEpvYlJlcG9zaXRvcnkge1xuXG4gICAgZGJQcm9taXNlO1xuICAgIGpvYkluc3RhbmNlRGFvO1xuICAgIGpvYkV4ZWN1dGlvbkRhbztcbiAgICBzdGVwRXhlY3V0aW9uRGFvO1xuICAgIGpvYlJlc3VsdERhbztcbiAgICBqb2JFeGVjdXRpb25Qcm9ncmVzc0RhbztcbiAgICBqb2JFeGVjdXRpb25GbGFnRGFvO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbnNSZXZpdmVyLCBkYk5hbWUgPSAnc2Qtam9iLXJlcG9zaXRvcnknLCBkZWxldGVEQiA9IGZhbHNlKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuZGJOYW1lID0gZGJOYW1lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zUmV2aXZlciA9IGV4cHJlc3Npb25zUmV2aXZlcjtcbiAgICAgICAgaWYgKGRlbGV0ZURCKSB7XG4gICAgICAgICAgICB0aGlzLmRlbGV0ZURCKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmluaXREQigpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmluaXREQigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXREQigpIHtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBpZGIub3Blbih0aGlzLmRiTmFtZSwgMiwgdXBncmFkZURCID0+IHtcbiAgICAgICAgICAgIC8vIE5vdGU6IHdlIGRvbid0IHVzZSAnYnJlYWsnIGluIHRoaXMgc3dpdGNoIHN0YXRlbWVudCxcbiAgICAgICAgICAgIC8vIHRoZSBmYWxsLXRocm91Z2ggYmVoYXZpb3VyIGlzIHdoYXQgd2Ugd2FudC5cbiAgICAgICAgICAgIHN3aXRjaCAodXBncmFkZURCLm9sZFZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICBjYXNlIDA6XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWluc3RhbmNlcycpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zT1MuY3JlYXRlSW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIFwiam9iSW5zdGFuY2UuaWRcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiY3JlYXRlVGltZVwiLCBcImNyZWF0ZVRpbWVcIiwge3VuaXF1ZTogZmFsc2V9KTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwic3RhdHVzXCIsIFwic3RhdHVzXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbi1wcm9ncmVzcycpO1xuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tZmxhZ3MnKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zT1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ3N0ZXAtZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiam9iRXhlY3V0aW9uSWRcIiwgXCJqb2JFeGVjdXRpb25JZFwiLCB7dW5pcXVlOiBmYWxzZX0pO1xuXG4gICAgICAgICAgICAgICAgICAgIHZhciBqb2JSZXN1bHRPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLXJlc3VsdHMnKTtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0T1MuY3JlYXRlSW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIFwiam9iSW5zdGFuY2UuaWRcIiwge3VuaXF1ZTogdHJ1ZX0pO1xuICAgICAgICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLnRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdqb2ItaW5zdGFuY2VzJykuY3JlYXRlSW5kZXgoXCJpZFwiLCBcImlkXCIsIHt1bmlxdWU6IHRydWV9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItaW5zdGFuY2VzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkRhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0RhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbi1mbGFncycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9uRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdzdGVwLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0RGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItcmVzdWx0cycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICB9XG5cbiAgICBkZWxldGVEQigpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oXz0+aWRiLmRlbGV0ZSh0aGlzLmRiTmFtZSkpO1xuICAgIH1cblxuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5yZW1vdmUoa2V5KS50aGVuKCgpPT57XG4gICAgICAgICAgICB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmYWxzZSkudGhlbihqb2JFeGVjdXRpb25zPT57ICAvLyAgTm90IHdhaXRpbmcgZm9yIHByb21pc2UgcmVzb2x2ZXNcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2godGhpcy5yZW1vdmVKb2JFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSkudGhlbihqb2JSZXN1bHQ9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5yZW1vdmUoam9iRXhlY3V0aW9uLmlkKS50aGVuKCgpPT57XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5maW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uLmlkLCBmYWxzZSkudGhlbihzdGVwRXhlY3V0aW9ucz0+eyAgLy8gTm90IHdhaXRpbmcgZm9yIHByb21pc2UgcmVzb2x2ZXNcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5yZW1vdmUoc3RlcEV4ZWN1dGlvbi5pZClcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLnJlbW92ZShqb2JSZXN1bHQuaWQpO1xuICAgIH1cblxuXG5cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uZ2V0KGpvYlJlc3VsdElkKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXRCeUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBqb2JJbnN0YW5jZS5pZCk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLnNldChqb2JSZXN1bHQuaWQsIGpvYlJlc3VsdCkudGhlbihyPT5qb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLmdldChrZXkpLnRoZW4oZHRvPT5kdG8gPyB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0bykgOiBkdG8pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5zZXQoa2V5LCBqb2JJbnN0YW5jZSkudGhlbihyPT5qb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBqb2JFeGVjdXRpb24uZ2V0RFRPKCk7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc0RUT3MgPSBkdG8uc3RlcEV4ZWN1dGlvbnM7XG4gICAgICAgIGR0by5zdGVwRXhlY3V0aW9ucyA9IG51bGw7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5zZXQoam9iRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+dGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zRFRPcykpLnRoZW4ocj0+am9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3MpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0Rhby5nZXQoam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIGZsYWcpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25GbGFnRGFvLmdldChqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBkdG8gPSBzdGVwRXhlY3V0aW9uLmdldERUTyhbXCJqb2JFeGVjdXRpb25cIl0pO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+c3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9ucywgc2F2ZWRFeGVjdXRpb25zID0gW10pIHtcbiAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSBzYXZlZEV4ZWN1dGlvbnMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25EVE8gPSBzdGVwRXhlY3V0aW9uc1tzYXZlZEV4ZWN1dGlvbnMubGVuZ3RoXTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5zZXQoc3RlcEV4ZWN1dGlvbkRUTy5pZCwgc3RlcEV4ZWN1dGlvbkRUTykudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHNhdmVkRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb25EVE8pO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9ucywgc2F2ZWRFeGVjdXRpb25zKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0KGlkKS50aGVuKGR0bz0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGR0byk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkRUTywgcmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbkRUTykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25EVE8uaWQsIGZhbHNlKS50aGVuKHN0ZXBzPT4ge1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uRFRPLnN0ZXBFeGVjdXRpb25zID0gc3RlcHM7XG4gICAgICAgICAgICBpZiAoIXJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb25EVE87XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXZpdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBmZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdCwgcmV2aXZlID0gdHJ1ZSwgZmV0Y2hlZCA9IFtdKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb25EdG9MaXN0Lmxlbmd0aCA8PSBmZXRjaGVkLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmZXRjaGVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0W2ZldGNoZWQubGVuZ3RoXSwgcmV2aXZlKS50aGVuKChqb2JFeGVjdXRpb24pPT4ge1xuICAgICAgICAgICAgZmV0Y2hlZC5wdXNoKGpvYkV4ZWN1dGlvbik7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0LCByZXZpdmUsIGZldGNoZWQpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmaW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uSWQsIHJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5nZXRBbGxCeUluZGV4KFwiam9iRXhlY3V0aW9uSWRcIiwgam9iRXhlY3V0aW9uSWQpLnRoZW4oZHRvcz0+IHtcbiAgICAgICAgICAgIGlmICghcmV2aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGR0b3M7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZHRvcy5tYXAoZHRvPT50aGlzLnJldml2ZVN0ZXBFeGVjdXRpb24oZHRvKSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZldGNoUmVsYXRpb25zQW5kUmV2aXZlID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0QWxsQnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpLnRoZW4odmFsdWVzPT4ge1xuICAgICAgICAgICAgdmFyIHNvcnRlZCA9IHZhbHVlcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKCFmZXRjaFJlbGF0aW9uc0FuZFJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhzb3J0ZWQsIHRydWUpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmYWxzZSkudGhlbihleGVjdXRpb25zPT50aGlzLmZldGNoSm9iRXhlY3V0aW9uUmVsYXRpb25zKGV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLSAxXSkpO1xuICAgIH1cblxuICAgIGdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb25zPT4ge1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zID0gW107XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2goam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHM9PnMuc3RlcE5hbWUgPT09IHN0ZXBOYW1lKS5mb3JFYWNoKChzKT0+c3RlcEV4ZWN1dGlvbnMucHVzaChzKSkpO1xuICAgICAgICAgICAgdmFyIGxhdGVzdCA9IG51bGw7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHM9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlKGR0by5pZCwgZHRvLmpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5jb250ZXh0ID0gZHRvLmNvbnRleHQ7XG4gICAgICAgIHZhciBkYXRhID0gZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICB2YXIgZGF0YU1vZGVsID0gbmV3IERhdGFNb2RlbCgpO1xuICAgICAgICAgICAgZGF0YU1vZGVsLmxvYWRGcm9tRFRPKGRhdGEsIHRoaXMuZXhwcmVzc2lvbnNSZXZpdmVyKTtcbiAgICAgICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuc2V0RGF0YShkYXRhTW9kZWwpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0XG4gICAgfVxuXG4gICAgcmV2aXZlSm9iRXhlY3V0aW9uKGR0bykge1xuXG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmdldEpvYkJ5TmFtZShkdG8uam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IHRoaXMucmV2aXZlSm9iSW5zdGFuY2UoZHRvLmpvYkluc3RhbmNlKTtcbiAgICAgICAgdmFyIGpvYlBhcmFtZXRlcnMgPSBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhkdG8uam9iUGFyYW1ldGVycy52YWx1ZXMpO1xuICAgICAgICB2YXIgam9iRXhlY3V0aW9uID0gbmV3IEpvYkV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycywgZHRvLmlkKTtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSB0aGlzLnJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXR1cm4gVXRpbHMubWVyZ2VXaXRoKGpvYkV4ZWN1dGlvbiwgZHRvLCAob2JqVmFsdWUsIHNyY1ZhbHVlLCBrZXksIG9iamVjdCwgc291cmNlLCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkluc3RhbmNlXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iSW5zdGFuY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImV4ZWN1dGlvbkNvbnRleHRcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JQYXJhbWV0ZXJzXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iUGFyYW1ldGVycztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iRXhlY3V0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcInN0ZXBFeGVjdXRpb25zXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3JjVmFsdWUubWFwKHN0ZXBEVE8gPT4gdGhpcy5yZXZpdmVTdGVwRXhlY3V0aW9uKHN0ZXBEVE8sIGpvYkV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJldml2ZVN0ZXBFeGVjdXRpb24oZHRvLCBqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb24gPSBuZXcgU3RlcEV4ZWN1dGlvbihkdG8uc3RlcE5hbWUsIGpvYkV4ZWN1dGlvbiwgZHRvLmlkKTtcbiAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSB0aGlzLnJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXR1cm4gVXRpbHMubWVyZ2VXaXRoKHN0ZXBFeGVjdXRpb24sIGR0bywgKG9ialZhbHVlLCBzcmNWYWx1ZSwga2V5LCBvYmplY3QsIHNvdXJjZSwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JFeGVjdXRpb25cIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImV4ZWN1dGlvbkNvbnRleHRcIikge1xuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cblxuXG5jbGFzcyBPYmplY3RTdG9yZURhbyB7XG5cbiAgICBuYW1lO1xuICAgIGRiUHJvbWlzZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGRiUHJvbWlzZSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmRiUHJvbWlzZSA9IGRiUHJvbWlzZTtcbiAgICB9XG5cbiAgICBnZXQoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuZ2V0KGtleSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEFsbEJ5SW5kZXgoaW5kZXhOYW1lLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldEFsbChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEJ5SW5kZXgoaW5kZXhOYW1lLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNldChrZXksIHZhbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5wdXQodmFsLCBrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmRlbGV0ZShrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjbGVhcigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuY2xlYXIoKTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAga2V5cygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpO1xuICAgICAgICAgICAgY29uc3Qga2V5cyA9IFtdO1xuICAgICAgICAgICAgY29uc3Qgc3RvcmUgPSB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpO1xuXG4gICAgICAgICAgICAvLyBUaGlzIHdvdWxkIGJlIHN0b3JlLmdldEFsbEtleXMoKSwgYnV0IGl0IGlzbid0IHN1cHBvcnRlZCBieSBFZGdlIG9yIFNhZmFyaS5cbiAgICAgICAgICAgIC8vIG9wZW5LZXlDdXJzb3IgaXNuJ3Qgc3VwcG9ydGVkIGJ5IFNhZmFyaSwgc28gd2UgZmFsbCBiYWNrXG4gICAgICAgICAgICAoc3RvcmUuaXRlcmF0ZUtleUN1cnNvciB8fCBzdG9yZS5pdGVyYXRlQ3Vyc29yKS5jYWxsKHN0b3JlLCBjdXJzb3IgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghY3Vyc29yKSByZXR1cm47XG4gICAgICAgICAgICAgICAga2V5cy5wdXNoKGN1cnNvci5rZXkpO1xuICAgICAgICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZS50aGVuKCgpID0+IGtleXMpO1xuICAgICAgICB9KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pvYktleUdlbmVyYXRvcn0gZnJvbSBcIi4uL2pvYi1rZXktZ2VuZXJhdG9yXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi4vam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi4vam9iLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb25BbHJlYWR5UnVubmluZ0V4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb25cIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuLi9zdGVwLWV4ZWN1dGlvblwiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtKb2JSZXN1bHR9IGZyb20gXCIuLi9qb2ItcmVzdWx0XCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGpvYkJ5TmFtZSA9IHt9O1xuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iQnlOYW1lW2pvYi5uYW1lXSA9IGpvYjtcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JCeU5hbWVbbmFtZV07XG4gICAgfVxuXG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeSBnZXRKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoa2V5LCBqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVTdGVwRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZmluZEpvYkV4ZWN1dGlvbnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVTdGVwRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iUmVzdWx0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qQ3JlYXRlIGEgbmV3IEpvYkluc3RhbmNlIHdpdGggdGhlIG5hbWUgYW5kIGpvYiBwYXJhbWV0ZXJzIHByb3ZpZGVkLiByZXR1cm4gcHJvbWlzZSovXG4gICAgY3JlYXRlSm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSBuZXcgSm9iSW5zdGFuY2UoVXRpbHMuZ3VpZCgpLCBqb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICAvKkNoZWNrIGlmIGFuIGluc3RhbmNlIG9mIHRoaXMgam9iIGFscmVhZHkgZXhpc3RzIHdpdGggdGhlIHBhcmFtZXRlcnMgcHJvdmlkZWQuKi9cbiAgICBpc0pvYkluc3RhbmNlRXhpc3RzKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbihyZXN1bHQgPT4gISFyZXN1bHQpLmNhdGNoKGVycm9yPT5mYWxzZSk7XG4gICAgfVxuXG4gICAgZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiBqb2JOYW1lICsgXCJ8XCIgKyBKb2JLZXlHZW5lcmF0b3IuZ2VuZXJhdGVLZXkoam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgLypDcmVhdGUgYSBKb2JFeGVjdXRpb24gZm9yIGEgZ2l2ZW4gIEpvYiBhbmQgSm9iUGFyYW1ldGVycy4gSWYgbWF0Y2hpbmcgSm9iSW5zdGFuY2UgYWxyZWFkeSBleGlzdHMsXG4gICAgICogdGhlIGpvYiBtdXN0IGJlIHJlc3RhcnRhYmxlIGFuZCBpdCdzIGxhc3QgSm9iRXhlY3V0aW9uIG11c3QgKm5vdCogYmVcbiAgICAgKiBjb21wbGV0ZWQuIElmIG1hdGNoaW5nIEpvYkluc3RhbmNlIGRvZXMgbm90IGV4aXN0IHlldCBpdCB3aWxsIGJlICBjcmVhdGVkLiovXG5cbiAgICBjcmVhdGVKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycywgZGF0YSkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKGpvYkluc3RhbmNlPT57XG4gICAgICAgICAgICBpZiAoam9iSW5zdGFuY2UgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgICAgICAgICAgZXhlY3V0aW9ucy5mb3JFYWNoKGV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb24oXCJBIGpvYiBleGVjdXRpb24gZm9yIHRoaXMgam9iIGlzIGFscmVhZHkgcnVubmluZzogXCIgKyBqb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuQ09NUExFVEVEIHx8IGV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5BQkFORE9ORUQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiQSBqb2IgaW5zdGFuY2UgYWxyZWFkeSBleGlzdHMgYW5kIGlzIGNvbXBsZXRlIGZvciBwYXJhbWV0ZXJzPVwiICsgam9iUGFyYW1ldGVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICArIFwiLiAgSWYgeW91IHdhbnQgdG8gcnVuIHRoaXMgam9iIGFnYWluLCBjaGFuZ2UgdGhlIHBhcmFtZXRlcnMuXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IGV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLSAxXS5leGVjdXRpb25Db250ZXh0O1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbam9iSW5zdGFuY2UsIGV4ZWN1dGlvbkNvbnRleHRdO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIG5vIGpvYiBmb3VuZCwgY3JlYXRlIG9uZVxuICAgICAgICAgICAgam9iSW5zdGFuY2UgPSB0aGlzLmNyZWF0ZUpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICAgICAgdmFyIGRhdGFNb2RlbCA9IG5ldyBEYXRhTW9kZWwoKTtcbiAgICAgICAgICAgIGRhdGFNb2RlbC5fc2V0TmV3U3RhdGUoZGF0YS5jcmVhdGVTdGF0ZVNuYXBzaG90KCkpO1xuICAgICAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5zZXREYXRhKGRhdGFNb2RlbCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XSk7XG4gICAgICAgIH0pLnRoZW4oaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0PT57XG4gICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uID0gbmV3IEpvYkV4ZWN1dGlvbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMF0sIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHRbMV07XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKS50aGVuKChqb2JJbnN0YW5jZSk9PntcbiAgICAgICAgICAgIGlmKCFqb2JJbnN0YW5jZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT5leGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0xXSk7XG4gICAgfVxuXG4gICAgZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGpvYkV4ZWN1dGlvbnM9PntcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucz1bXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnMuZm9yRWFjaChqb2JFeGVjdXRpb249PmpvYkV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5maWx0ZXIocz0+cy5zdGVwTmFtZSA9PT0gc3RlcE5hbWUpLmZvckVhY2goKHMpPT5zdGVwRXhlY3V0aW9ucy5wdXNoKHMpKSk7XG4gICAgICAgICAgICB2YXIgbGF0ZXN0ID0gbnVsbDtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb25zLmZvckVhY2gocz0+e1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBhZGRTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZShvKXtcbiAgICAgICAgby5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBcIk9iamVjdCBub3QgdXBkYXRhYmxlOiBcIitvXG4gICAgfVxuXG4gICAgcmVtb3ZlKG8pe1xuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobyBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlU3RlcEV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JSZXN1bHQpe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iUmVzdWx0KCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXCJPYmplY3Qgbm90IHJlbW92YWJsZTogXCIrbyk7XG4gICAgfVxuXG5cbiAgICByZXZpdmVKb2JJbnN0YW5jZShkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0bykge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cblxuICAgIHJldml2ZUpvYkV4ZWN1dGlvbihkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVTdGVwRXhlY3V0aW9uKGR0bywgam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBTaW1wbGVKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeXtcbiAgICBqb2JJbnN0YW5jZXNCeUtleSA9IHt9O1xuICAgIGpvYkV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIGV4ZWN1dGlvblByb2dyZXNzID0ge307XG4gICAgZXhlY3V0aW9uRmxhZ3MgPSB7fTtcbiAgICBqb2JSZXN1bHRzID0gW107XG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIFV0aWxzLmZvck93bih0aGlzLmpvYkluc3RhbmNlc0J5S2V5LCAgKGppLCBrZXkpPT57XG4gICAgICAgICAgICBpZihqaT09PWpvYkluc3RhbmNlKXtcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLmZpbHRlcihqb2JSZXN1bHQ9PmpvYlJlc3VsdC5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVKb2JSZXN1bHQsIHRoaXMpO1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5qb2JFeGVjdXRpb25zLmluZGV4T2Yoam9iRXhlY3V0aW9uKTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzdGVwRXhlY3V0aW9uPT5zdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCA9PT0gam9iRXhlY3V0aW9uLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5zdGVwRXhlY3V0aW9ucy5pbmRleE9mKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYlJlc3VsdChqb2JSZXN1bHQpe1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLmpvYlJlc3VsdHMuaW5kZXhPZihqb2JSZXN1bHQpO1xuICAgICAgICBpZihpbmRleD4tMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoam9iSW5zdGFuY2UpXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5pZD09PWpvYlJlc3VsdElkKSlcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5qb2JJbnN0YW5jZS5pZD09PWpvYkluc3RhbmNlLmlkKSlcbiAgICB9XG5cbiAgICBzYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkge1xuICAgICAgICB0aGlzLmpvYlJlc3VsdHMucHVzaChqb2JSZXN1bHQpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYkV4ZWN1dGlvbnMsIGV4PT5leC5pZD09PWlkKSlcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMucHVzaChqb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0gPSBwcm9ncmVzcztcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcm9ncmVzcylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0pXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSA9IGZsYWc7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmxhZylcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSlcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5wdXNoKHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoZT0+ZS5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgIH0pKTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1NpbXBsZUpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL3NpbXBsZS1qb2ItcmVwb3NpdG9yeVwiO1xuXG5cblxuZXhwb3J0IGNsYXNzIFRpbWVvdXRKb2JSZXBvc2l0b3J5IGV4dGVuZHMgU2ltcGxlSm9iUmVwb3NpdG9yeXtcblxuICAgIGNyZWF0ZVRpbWVvdXRQcm9taXNlKHZhbHVlVG9SZXNvbHZlLCBkZWxheT0xKXtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmU9PntcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHZhbHVlVG9SZXNvbHZlKTtcbiAgICAgICAgICAgIH0sIGRlbGF5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSA9IGpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuaWQ9PT1qb2JSZXN1bHRJZCkpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5qb2JJbnN0YW5jZS5pZD09PWpvYkluc3RhbmNlLmlkKSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnB1c2goam9iUmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYkV4ZWN1dGlvbnMsIGV4PT5leC5pZD09PWlkKSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnB1c2goam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSA9IHByb2dyZXNzO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShwcm9ncmVzcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSA9IGZsYWc7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGZsYWcpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoZT0+ZS5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICByZW1vdmUob2JqZWN0KXsgLy9UT0RPXG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSByZXN1bHQgb2YgYSBqb2IgaW5zdGFuY2UuKi9cbmV4cG9ydCBjbGFzcyBKb2JSZXN1bHQge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGRhdGE7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgfVxufVxuIiwiZXhwb3J0IGNvbnN0IEpPQl9TVEFUVVMgPSB7XG4gICAgQ09NUExFVEVEOiAnQ09NUExFVEVEJyxcbiAgICBTVEFSVElORzogJ1NUQVJUSU5HJyxcbiAgICBTVEFSVEVEOiAnU1RBUlRFRCcsXG4gICAgU1RPUFBJTkc6ICdTVE9QUElORycsXG4gICAgU1RPUFBFRDogJ1NUT1BQRUQnLFxuICAgIEZBSUxFRDogJ0ZBSUxFRCcsXG4gICAgVU5LTk9XTjogJ1VOS05PV04nLFxuICAgIEFCQU5ET05FRDogJ0FCQU5ET05FRCcsXG4gICAgRVhFQ1VUSU5HOiAnRVhFQ1VUSU5HJyAvL2ZvciBleGl0IHN0YXR1cyBvbmx5XG59O1xuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7Sm9iUmVzdWx0fSBmcm9tIFwiLi9qb2ItcmVzdWx0XCI7XG4vKkJhc2UgY2xhc3MgZm9yIGpvYnMqL1xuLy9BIEpvYiBpcyBhbiBlbnRpdHkgdGhhdCBlbmNhcHN1bGF0ZXMgYW4gZW50aXJlIGpvYiBwcm9jZXNzICggYW4gYWJzdHJhY3Rpb24gcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iKS5cblxuZXhwb3J0IGNsYXNzIEpvYiB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIHN0ZXBzID0gW107XG5cbiAgICBpc1Jlc3RhcnRhYmxlPXRydWU7XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG4gICAgam9iUGFyYW1ldGVyc1ZhbGlkYXRvcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciA9IHRoaXMuZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpO1xuICAgICAgICB0aGlzLmpvYkRhdGFWYWxpZGF0b3IgPSB0aGlzLmdldEpvYkRhdGFWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHN0YXJ0aW5nOiBcIiwgZXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIGpvYlJlc3VsdDtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pLnRoZW4oZXhlY3V0aW9uPT57XG5cbiAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HKSB7XG4gICAgICAgICAgICAgICAgLy8gVGhlIGpvYiB3YXMgYWxyZWFkeSBzdG9wcGVkXG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gd2FzIHN0b3BwZWQ6IFwiICsgZXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICF0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih0aGlzLmpvYkRhdGFWYWxpZGF0b3IgJiYgIXRoaXMuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShleGVjdXRpb24uZ2V0RGF0YSgpKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLnVwZGF0ZVN0YXR1cyhleGVjdXRpb24sIEpPQl9TVEFUVVMuU1RBUlRFRCksIHRoaXMuZ2V0UmVzdWx0KGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT57XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uPXJlc1swXTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSByZXNbMV07XG4gICAgICAgICAgICAgICAgaWYoIWpvYlJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSBuZXcgSm9iUmVzdWx0KGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYmVmb3JlSm9iKGV4ZWN1dGlvbikpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIGNvbXBsZXRlOiBcIixleGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBleGVjdXRpbmcgam9iXCIsIGUpO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoam9iUmVzdWx0KXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KS50aGVuKCgpPT5leGVjdXRpb24pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGZhdGFsIGVycm9yIHNhdmluZyBqb2IgcmVzdWx0c1wiLCBlKTtcbiAgICAgICAgICAgIGlmKGUpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoZXhlY3V0aW9uKSwgdGhpcy51cGRhdGVQcm9ncmVzcyhleGVjdXRpb24pXSkudGhlbihyZXM9PnJlc1swXSlcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYWZ0ZXJKb2IoZXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIGVuY291bnRlcmVkIGluIGFmdGVyU3RlcCBjYWxsYmFja1wiLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICB1cGRhdGVTdGF0dXMoam9iRXhlY3V0aW9uLCBzdGF0dXMpIHtcbiAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cz1zdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGpvYkV4ZWN1dGlvbilcbiAgICB9XG5cbiAgICB1cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbi5pZCwgdGhpcy5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICAvKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgYWxsb3dpbmcgdGhlbSB0byBjb25jZW50cmF0ZSBvbiBwcm9jZXNzaW5nIGxvZ2ljIGFuZCBpZ25vcmUgbGlzdGVuZXJzLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyAnZG9FeGVjdXRlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAocGFyYW1zKSA9PiBwYXJhbXMudmFsaWRhdGUoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gdHJ1ZVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkU3RlcChzdGVwKXtcbiAgICAgICAgdGhpcy5zdGVwcy5wdXNoKHN0ZXApO1xuICAgIH1cblxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpe1xuICAgICAgICB0aHJvdyAnY3JlYXRlSm9iUGFyYW1ldGVycyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgKiBjdXJyZW50XG4gICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IGV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEID8gMSA6IDBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBjaGVja0V4ZWN1dGlvbkZsYWdzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uRmxhZyhleGVjdXRpb24uaWQpLnRoZW4oZmxhZz0+e1xuICAgICAgICAgICAgaWYoSk9CX0VYRUNVVElPTl9GTEFHLlNUT1AgPT09IGZsYWcpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdG9wKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UoZXhlY3V0aW9uLmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdGhyb3cgJ2pvYlJlc3VsdFRvQ3N2Um93cyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuL2pvYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuL3N0ZXBcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuXG4vKiBTaW1wbGUgSm9iIHRoYXQgc2VxdWVudGlhbGx5IGV4ZWN1dGVzIGEgam9iIGJ5IGl0ZXJhdGluZyB0aHJvdWdoIGl0cyBsaXN0IG9mIHN0ZXBzLiAgQW55IFN0ZXAgdGhhdCBmYWlscyB3aWxsIGZhaWwgdGhlIGpvYi4gIFRoZSBqb2IgaXNcbiBjb25zaWRlcmVkIGNvbXBsZXRlIHdoZW4gYWxsIHN0ZXBzIGhhdmUgYmVlbiBleGVjdXRlZC4qL1xuXG5leHBvcnQgY2xhc3MgU2ltcGxlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcilcbiAgICB9XG5cbiAgICBnZXRTdGVwKHN0ZXBOYW1lKSB7XG4gICAgICAgIHJldHVybiBVdGlscy5maW5kKHRoaXMuc3RlcHMsIHM9PnMubmFtZSA9PSBzdGVwTmFtZSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dFN0ZXAoZXhlY3V0aW9uLCBqb2JSZXN1bHQpLnRoZW4obGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlVwZGF0aW5nIEpvYkV4ZWN1dGlvbiBzdGF0dXM6IFwiLCBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXM7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goLi4ubGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBwcmV2U3RlcD1udWxsLCBwcmV2U3RlcEV4ZWN1dGlvbj1udWxsKXtcbiAgICAgICAgdmFyIHN0ZXBJbmRleCA9IDA7XG4gICAgICAgIGlmKHByZXZTdGVwKXtcbiAgICAgICAgICAgIHN0ZXBJbmRleCA9IHRoaXMuc3RlcHMuaW5kZXhPZihwcmV2U3RlcCkrMTtcbiAgICAgICAgfVxuICAgICAgICBpZihzdGVwSW5kZXg+PXRoaXMuc3RlcHMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocHJldlN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSB0aGlzLnN0ZXBzW3N0ZXBJbmRleF07XG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVN0ZXAoc3RlcCwgam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQpLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuQ09NUExFVEVEKXsgLy8gVGVybWluYXRlIHRoZSBqb2IgaWYgYSBzdGVwIGZhaWxzXG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0U3RlcChqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCwgc3RlcCwgc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSBqb2JFeGVjdXRpb24uam9iSW5zdGFuY2U7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3Moam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5pc1N0b3BwaW5nKCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcC5uYW1lKVxuXG4gICAgICAgIH0pLnRoZW4obGFzdFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmICh0aGlzLnN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIGxhc3RTdGVwRXhlY3V0aW9uKSkge1xuICAgICAgICAgICAgICAgIC8vIElmIHRoZSBsYXN0IGV4ZWN1dGlvbiBvZiB0aGlzIHN0ZXAgd2FzIGluIHRoZSBzYW1lIGpvYiwgaXQncyBwcm9iYWJseSBpbnRlbnRpb25hbCBzbyB3ZSB3YW50IHRvIHJ1biBpdCBhZ2Fpbi5cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkR1cGxpY2F0ZSBzdGVwIGRldGVjdGVkIGluIGV4ZWN1dGlvbiBvZiBqb2IuIHN0ZXA6IFwiICsgc3RlcC5uYW1lICsgXCIgam9iTmFtZTogXCIsIGpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICAgICAgICAgIGxhc3RTdGVwRXhlY3V0aW9uID0gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGN1cnJlbnRTdGVwRXhlY3V0aW9uID0gbGFzdFN0ZXBFeGVjdXRpb247XG5cbiAgICAgICAgICAgIGlmICghdGhpcy5zaG91bGRTdGFydChjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iRXhlY3V0aW9uLCBzdGVwKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBqb2JFeGVjdXRpb24uY3JlYXRlU3RlcEV4ZWN1dGlvbihzdGVwLm5hbWUpO1xuXG4gICAgICAgICAgICB2YXIgaXNDb21wbGV0ZWQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIGxhc3RTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICB2YXIgaXNSZXN0YXJ0ID0gbGFzdFN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiAhaXNDb21wbGV0ZWQ7XG4gICAgICAgICAgICB2YXIgc2tpcEV4ZWN1dGlvbiA9IGlzQ29tcGxldGVkICYmIHN0ZXAuc2tpcE9uUmVzdGFydElmQ29tcGxldGVkO1xuXG4gICAgICAgICAgICBpZiAoaXNSZXN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGxhc3RTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuY29udGFpbnNLZXkoXCJleGVjdXRlZFwiKSkge1xuICAgICAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnJlbW92ZShcImV4ZWN1dGVkXCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJza2lwcGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmFkZFN0ZXBFeGVjdXRpb24oY3VycmVudFN0ZXBFeGVjdXRpb24pLnRoZW4oKF9jdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbj1fY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgaWYoc2tpcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiU2tpcHBpbmcgY29tcGxldGVkIHN0ZXAgZXhlY3V0aW9uOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFeGVjdXRpbmcgc3RlcDogW1wiICsgc3RlcC5uYW1lICsgXCJdXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGVwLmV4ZWN1dGUoY3VycmVudFN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcImV4ZWN1dGVkXCIsIHRydWUpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH0pLmNhdGNoIChlID0+IHtcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e3Rocm93IGV9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSkudGhlbigoY3VycmVudFN0ZXBFeGVjdXRpb24pPT57XG4gICAgICAgICAgICBpZiAoY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBJTkdcbiAgICAgICAgICAgICAgICB8fCBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIGpvYiBnZXRzIHRoZSBtZXNzYWdlIHRoYXQgaXQgaXMgc3RvcHBpbmdcbiAgICAgICAgICAgICAgICBqb2JFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUElORztcbiAgICAgICAgICAgICAgICAvLyB0aHJvdyBuZXcgRXJyb3IoXCJKb2IgaW50ZXJydXB0ZWQgYnkgc3RlcCBleGVjdXRpb25cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pLnRoZW4oKCk9PmN1cnJlbnRTdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcblxuICAgIH1cblxuICAgIHN0ZXBFeGVjdXRpb25QYXJ0T2ZFeGlzdGluZ0pvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24sIHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5pZCA9PSBqb2JFeGVjdXRpb24uaWRcbiAgICB9XG5cbiAgICBzaG91bGRTdGFydChsYXN0U3RlcEV4ZWN1dGlvbiwgZXhlY3V0aW9uLCBzdGVwKSB7XG4gICAgICAgIHZhciBzdGVwU3RhdHVzO1xuICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24gPT0gbnVsbCkge1xuICAgICAgICAgICAgc3RlcFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHN0ZXBTdGF0dXMgPT0gSk9CX1NUQVRVUy5VTktOT1dOKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkNhbm5vdCByZXN0YXJ0IHN0ZXAgZnJvbSBVTktOT1dOIHN0YXR1c1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHN0ZXBTdGF0dXMgIT0gSk9CX1NUQVRVUy5DT01QTEVURUQgfHwgc3RlcC5pc1Jlc3RhcnRhYmxlO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHZhciBjb21wbGV0ZWRTdGVwcyA9IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGg7XG4gICAgICAgIGxldCBwcm9ncmVzcyA9IHtcbiAgICAgICAgICAgIHRvdGFsOiB0aGlzLnN0ZXBzLmxlbmd0aCxcbiAgICAgICAgICAgIGN1cnJlbnQ6IGNvbXBsZXRlZFN0ZXBzXG4gICAgICAgIH07XG4gICAgICAgIGlmKCFjb21wbGV0ZWRTdGVwcyl7XG4gICAgICAgICAgICByZXR1cm4gcHJvZ3Jlc3NcbiAgICAgICAgfVxuICAgICAgICBpZihKT0JfU1RBVFVTLkNPTVBMRVRFRCAhPT0gZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zW2V4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGgtMV0uc3RhdHVzKXtcbiAgICAgICAgICAgIHByb2dyZXNzLmN1cnJlbnQtLTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwcm9ncmVzcztcbiAgICB9XG5cbiAgICBhZGRTdGVwKCl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGg9PT0xKXtcbiAgICAgICAgICAgIHJldHVybiBzdXBlci5hZGRTdGVwKGFyZ3VtZW50c1swXSlcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IG5ldyBTdGVwKGFyZ3VtZW50c1swXSwgdGhpcy5qb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgc3RlcC5kb0V4ZWN1dGUgPSBhcmd1bWVudHNbMV07XG4gICAgICAgIHJldHVybiBzdXBlci5hZGRTdGVwKHN0ZXApO1xuICAgIH1cblxufVxuIiwiZXhwb3J0IGNsYXNzIFN0ZXBFeGVjdXRpb25MaXN0ZW5lciB7XG4gICAgLypDYWxsZWQgYmVmb3JlIGEgc3RlcCBleGVjdXRlcyovXG4gICAgYmVmb3JlU3RlcChqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cblxuICAgIC8qQ2FsbGVkIGFmdGVyIGNvbXBsZXRpb24gb2YgYSBzdGVwLiBDYWxsZWQgYWZ0ZXIgYm90aCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgZXhlY3V0aW9ucyovXG4gICAgYWZ0ZXJTdGVwKGpvYkV4ZWN1dGlvbikge1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9ufSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uXCI7XG5cbi8qXG4gcmVwcmVzZW50YXRpb24gb2YgdGhlIGV4ZWN1dGlvbiBvZiBhIHN0ZXBcbiAqL1xuZXhwb3J0IGNsYXNzIFN0ZXBFeGVjdXRpb24ge1xuICAgIGlkO1xuICAgIHN0ZXBOYW1lO1xuICAgIGpvYkV4ZWN1dGlvbjtcblxuICAgIHN0YXR1cyA9IEpPQl9TVEFUVVMuU1RBUlRJTkc7XG4gICAgZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRVhFQ1VUSU5HO1xuICAgIGV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpOyAvL2V4ZWN1dGlvbiBjb250ZXh0IGZvciBzaW5nbGUgc3RlcCBsZXZlbCxcblxuICAgIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgZW5kVGltZSA9IG51bGw7XG4gICAgbGFzdFVwZGF0ZWQgPSBudWxsO1xuXG4gICAgdGVybWluYXRlT25seSA9IGZhbHNlOyAvL2ZsYWcgdG8gaW5kaWNhdGUgdGhhdCBhbiBleGVjdXRpb24gc2hvdWxkIGhhbHRcbiAgICBmYWlsdXJlRXhjZXB0aW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3Ioc3RlcE5hbWUsIGpvYkV4ZWN1dGlvbiwgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnN0ZXBOYW1lID0gc3RlcE5hbWU7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbklkID0gam9iRXhlY3V0aW9uLmlkO1xuICAgIH1cblxuICAgIGdldEpvYlBhcmFtZXRlcnMoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnM7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dDtcbiAgICB9XG5cbiAgICBnZXREYXRhKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgfVxuXG4gICAgZ2V0RFRPKGZpbHRlcmVkUHJvcGVydGllcz1bXSwgZGVlcENsb25lID0gdHJ1ZSl7XG5cbiAgICAgICAgdmFyIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVEZWVwV2l0aDtcbiAgICAgICAgaWYoIWRlZXBDbG9uZSkge1xuICAgICAgICAgICAgY2xvbmVNZXRob2QgPSBVdGlscy5jbG9uZVdpdGg7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuYXNzaWduKHt9LCBjbG9uZU1ldGhvZCh0aGlzLCAodmFsdWUsIGtleSwgb2JqZWN0LCBzdGFjayk9PiB7XG4gICAgICAgICAgICBpZihmaWx0ZXJlZFByb3BlcnRpZXMuaW5kZXhPZihrZXkpPi0xKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKFtcImV4ZWN1dGlvbkNvbnRleHRcIl0uaW5kZXhPZihrZXkpPi0xKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHZhbHVlIGluc3RhbmNlb2YgRXJyb3Ipe1xuICAgICAgICAgICAgICAgIHJldHVybiBVdGlscy5nZXRFcnJvckRUTyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZS5nZXREVE8oW1wic3RlcEV4ZWN1dGlvbnNcIl0sIGRlZXBDbG9uZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5cbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgY29uZmlndXJhdGlvbiBvZiBhIGpvYiBzdGVwKi9cbmV4cG9ydCBjbGFzcyBTdGVwIHtcblxuICAgIGlkO1xuICAgIG5hbWU7XG4gICAgaXNSZXN0YXJ0YWJsZSA9IHRydWU7XG4gICAgc2tpcE9uUmVzdGFydElmQ29tcGxldGVkPXRydWU7XG4gICAgc3RlcHMgPSBbXTtcbiAgICBleGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgc2V0Sm9iUmVwb3NpdG9yeShqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgLypQcm9jZXNzIHRoZSBzdGVwIGFuZCBhc3NpZ24gcHJvZ3Jlc3MgYW5kIHN0YXR1cyBtZXRhIGluZm9ybWF0aW9uIHRvIHRoZSBTdGVwRXhlY3V0aW9uIHByb3ZpZGVkKi9cbiAgICBleGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBsb2cuZGVidWcoXCJFeGVjdXRpbmcgc3RlcDogbmFtZT1cIiArIHRoaXMubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJURUQ7XG4gICAgICAgIHZhciBleGl0U3RhdHVzO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShzdGVwRXhlY3V0aW9uKS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkVYRUNVVElORztcblxuICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYmVmb3JlU3RlcChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB0aGlzLm9wZW4oc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgfSkudGhlbihfc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbiA9IF9zdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cztcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgc29tZW9uZSBpcyB0cnlpbmcgdG8gc3RvcCB1c1xuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24udGVybWluYXRlT25seSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBOZWVkIHRvIHVwZ3JhZGUgaGVyZSBub3Qgc2V0LCBpbiBjYXNlIHRoZSBleGVjdXRpb24gd2FzIHN0b3BwZWRcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgICAgICBsb2cuZGVidWcoXCJTdGVwIGV4ZWN1dGlvbiBzdWNjZXNzOiBuYW1lPVwiICsgdGhpcy5uYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gdGhpcy5kZXRlcm1pbmVKb2JTdGF0dXMoZSk7XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gc3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG5cbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQRUQpIHtcbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkVuY291bnRlcmVkIGludGVycnVwdGlvbiBleGVjdXRpbmcgc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBhbiBlcnJvciBleGVjdXRpbmcgc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IGV4aXRTdGF0dXM7XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYWZ0ZXJTdGVwKHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIGluIGFmdGVyU3RlcCBjYWxsYmFjayBpbiBzdGVwIFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gZXhpdFN0YXR1cztcblxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShzdGVwRXhlY3V0aW9uKVxuICAgICAgICB9KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbG9zZShzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFeGNlcHRpb24gd2hpbGUgY2xvc2luZyBzdGVwIGV4ZWN1dGlvbiByZXNvdXJjZXMgaW4gc3RlcDogXCIgKyB0aGlzLm5hbWUgKyBcIiBpbiBqb2I6IFwiICsgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2Uoc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIHdoaWxlIGNsb3Npbmcgc3RlcCBleGVjdXRpb24gcmVzb3VyY2VzIGluIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZG9FeGVjdXRpb25SZWxlYXNlKCk7XG5cbiAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIlN0ZXAgZXhlY3V0aW9uIGNvbXBsZXRlOiBcIiArIHN0ZXBFeGVjdXRpb24uaWQpO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgZGV0ZXJtaW5lSm9iU3RhdHVzKGUpIHtcbiAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBleGVjdXRlIGJ1c2luZXNzIGxvZ2ljLiBTdWJjbGFzc2VzIHNob3VsZCBzZXQgdGhlIGV4aXRTdGF0dXMgb24gdGhlXG4gICAgICogU3RlcEV4ZWN1dGlvbiBiZWZvcmUgcmV0dXJuaW5nLiBNdXN0IHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICovXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm92aWRlIGNhbGxiYWNrcyB0byB0aGVpciBjb2xsYWJvcmF0b3JzIGF0IHRoZSBiZWdpbm5pbmcgb2YgYSBzdGVwLCB0byBvcGVuIG9yXG4gICAgICogYWNxdWlyZSByZXNvdXJjZXMuIERvZXMgbm90aGluZyBieSBkZWZhdWx0LlxuICAgICAqL1xuICAgIG9wZW4oZXhlY3V0aW9uQ29udGV4dCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm92aWRlIGNhbGxiYWNrcyB0byB0aGVpciBjb2xsYWJvcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBzdGVwIChyaWdodCBhdCB0aGUgZW5kXG4gICAgICogb2YgdGhlIGZpbmFsbHkgYmxvY2spLCB0byBjbG9zZSBvciByZWxlYXNlIHJlc291cmNlcy4gRG9lcyBub3RoaW5nIGJ5IGRlZmF1bHQuXG4gICAgICovXG4gICAgY2xvc2UoZXhlY3V0aW9uQ29udGV4dCkge1xuICAgIH1cblxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgY3VycmVudDogc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEID8gMSA6IDBcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCAqIGFzIGVuZ2luZSBmcm9tICcuL2VuZ2luZS9pbmRleCdcblxuZXhwb3J0IHtlbmdpbmV9XG5leHBvcnQgKiBmcm9tICcuL2pvYnMtbWFuYWdlcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXdvcmtlcidcblxuXG5cbiIsImltcG9ydCB7Sm9iRXhlY3V0aW9uTGlzdGVuZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlfSBmcm9tIFwiLi9lbmdpbmUvam9iLWluc3RhbmNlXCI7XG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZU1hbmFnZXJDb25maWcge1xuICAgIG9uSm9iU3RhcnRlZCA9ICgpID0+IHt9O1xuICAgIG9uSm9iQ29tcGxldGVkID0gcmVzdWx0ID0+IHt9O1xuICAgIG9uSm9iRmFpbGVkID0gZXJyb3JzID0+IHt9O1xuICAgIG9uSm9iU3RvcHBlZCA9ICgpID0+IHt9O1xuICAgIG9uSm9iVGVybWluYXRlZCA9ICgpID0+IHt9O1xuICAgIG9uUHJvZ3Jlc3MgPSAocHJvZ3Jlc3MpID0+IHt9O1xuICAgIGNhbGxiYWNrc1RoaXNBcmc7XG4gICAgdXBkYXRlSW50ZXJ2YWwgPSAxMDA7XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKmNvbnZlbmllbmNlIGNsYXNzIGZvciBtYW5hZ2luZyBhbmQgdHJhY2tpbmcgam9iIGluc3RhbmNlIHByb2dyZXNzKi9cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZU1hbmFnZXIgZXh0ZW5kcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG5cbiAgICBqb2JzTWFuZ2VyO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGNvbmZpZztcblxuICAgIGxhc3RKb2JFeGVjdXRpb247XG4gICAgbGFzdFVwZGF0ZVRpbWU7XG4gICAgcHJvZ3Jlc3MgPSBudWxsO1xuXG4gICAgY29uc3RydWN0b3Ioam9ic01hbmdlciwgam9iSW5zdGFuY2VPckV4ZWN1dGlvbiwgY29uZmlnKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IEpvYkluc3RhbmNlTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmpvYnNNYW5nZXIgPSBqb2JzTWFuZ2VyO1xuICAgICAgICBpZiAoam9iSW5zdGFuY2VPckV4ZWN1dGlvbiBpbnN0YW5jZW9mIEpvYkluc3RhbmNlKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2VPckV4ZWN1dGlvbjtcbiAgICAgICAgICAgIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iSW5zdGFuY2VPckV4ZWN1dGlvbjtcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2UgPSB0aGlzLmxhc3RKb2JFeGVjdXRpb24uam9iSW5zdGFuY2U7XG4gICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sYXN0Sm9iRXhlY3V0aW9uICYmICF0aGlzLmxhc3RKb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgIHRoaXMuYWZ0ZXJKb2IodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBqb2JzTWFuZ2VyLnJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG4gICAgfVxuXG4gICAgY2hlY2tQcm9ncmVzcygpIHtcblxuICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgIGlmICh0aGlzLnRlcm1pbmF0ZWQgfHwgIXRoaXMubGFzdEpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSB8fCB0aGlzLmdldFByb2dyZXNzUGVyY2VudHModGhpcy5wcm9ncmVzcykgPT09IDEwMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuam9ic01hbmdlci5nZXRQcm9ncmVzcyh0aGlzLmxhc3RKb2JFeGVjdXRpb24pLnRoZW4ocHJvZ3Jlc3M9PiB7XG4gICAgICAgICAgICB0aGlzLmxhc3RVcGRhdGVUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIGlmIChwcm9ncmVzcykge1xuICAgICAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3MgPSBwcm9ncmVzcztcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vblByb2dyZXNzLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCBwcm9ncmVzcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHNlbGYuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSwgdGhpcy5jb25maWcudXBkYXRlSW50ZXJ2YWwpXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkICE9PSB0aGlzLmpvYkluc3RhbmNlLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIHRoaXMuY29uZmlnLm9uSm9iU3RhcnRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcyk7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3NQZXJjZW50cyhwcm9ncmVzcykge1xuICAgICAgICBpZiAoIXByb2dyZXNzKSB7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvZ3Jlc3MuY3VycmVudCAqIDEwMCAvIHByb2dyZXNzLnRvdGFsO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzRnJvbUV4ZWN1dGlvbihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9ic01hbmdlci5nZXRKb2JCeU5hbWUoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gam9iLmdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGlmIChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UuaWQgIT09IHRoaXMuam9iSW5zdGFuY2UuaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqb2JFeGVjdXRpb247XG4gICAgICAgIGlmIChKT0JfU1RBVFVTLkNPTVBMRVRFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcbiAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3MgPSB0aGlzLmdldFByb2dyZXNzRnJvbUV4ZWN1dGlvbihqb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Qcm9ncmVzcy5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgdGhpcy5wcm9ncmVzcyk7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZ2V0UmVzdWx0KGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZSkudGhlbihyZXN1bHQ9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JDb21wbGV0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHJlc3VsdC5kYXRhKTtcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0gZWxzZSBpZiAoSk9CX1NUQVRVUy5GQUlMRUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iRmFpbGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCBqb2JFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoSk9CX1NUQVRVUy5TVE9QUEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlN0b3BwZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihmb3JjZVVwZGF0ZSA9IGZhbHNlKSB7XG4gICAgICAgIGlmICghdGhpcy5sYXN0Sm9iRXhlY3V0aW9uIHx8IGZvcmNlVXBkYXRlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2UodGhpcy5qb2JJbnN0YW5jZSkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gamU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgc3RvcCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnN0b3AodGhpcy5sYXN0Sm9iRXhlY3V0aW9uKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLnJ1bih0aGlzLmpvYkluc3RhbmNlLmpvYk5hbWUsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzLnZhbHVlcywgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmdldERhdGEoKSkudGhlbihqZT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhc3RKb2JFeGVjdXRpb24gPSBqZTtcbiAgICAgICAgICAgICAgICB0aGlzLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB0ZXJtaW5hdGUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci50ZXJtaW5hdGUodGhpcy5qb2JJbnN0YW5jZSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnRlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iVGVybWluYXRlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMubGFzdEpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJleHBvcnQgY2xhc3MgSm9iV29ya2Vye1xuXG4gICAgd29ya2VyO1xuICAgIGxpc3RlbmVycyA9IHt9O1xuICAgIGRlZmF1bHRMaXN0ZW5lcjtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgZGVmYXVsdExpc3RlbmVyLCBvbkVycm9yKXtcbiAgICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgICAgdGhpcy53b3JrZXIgPSBuZXcgV29ya2VyKHVybCk7XG4gICAgICAgIHRoaXMuZGVmYXVsdExpc3RlbmVyID0gZGVmYXVsdExpc3RlbmVyIHx8IGZ1bmN0aW9uKCkge307XG4gICAgICAgIGlmIChvbkVycm9yKSB7dGhpcy53b3JrZXIub25lcnJvciA9IG9uRXJyb3I7fVxuXG4gICAgICAgIHRoaXMud29ya2VyLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJlxuICAgICAgICAgICAgICAgIGV2ZW50LmRhdGEuaGFzT3duUHJvcGVydHkoJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInKSAmJiBldmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZEFyZ3VtZW50cycpKSB7XG4gICAgICAgICAgICAgICAgdmFyIGxpc3RlbmVyID0gaW5zdGFuY2UubGlzdGVuZXJzW2V2ZW50LmRhdGEucXVlcnlNZXRob2RMaXN0ZW5lcl07XG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBldmVudC5kYXRhLnF1ZXJ5TWV0aG9kQXJndW1lbnRzO1xuICAgICAgICAgICAgICAgIGlmKGxpc3RlbmVyLmRlc2VyaWFsaXplcil7XG4gICAgICAgICAgICAgICAgICAgIGFyZ3MgPSBsaXN0ZW5lci5kZXNlcmlhbGl6ZXIoYXJncyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmZuLmFwcGx5KGxpc3RlbmVyLnRoaXNBcmcsIGFyZ3MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmRlZmF1bHRMaXN0ZW5lci5jYWxsKGluc3RhbmNlLCBldmVudC5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc2VuZFF1ZXJ5KCkge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0pvYldvcmtlci5zZW5kUXVlcnkgdGFrZXMgYXQgbGVhc3Qgb25lIGFyZ3VtZW50Jyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kJzogYXJndW1lbnRzWzBdLFxuICAgICAgICAgICAgJ3F1ZXJ5QXJndW1lbnRzJzogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBydW5Kb2Ioam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTyl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdydW5Kb2InLCBqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKVxuICAgIH1cblxuICAgIGV4ZWN1dGVKb2Ioam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgnZXhlY3V0ZUpvYicsIGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIHJlY29tcHV0ZShkYXRhRFRPLCBydWxlTmFtZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyl7XG4gICAgICAgIHRoaXMuc2VuZFF1ZXJ5KCdyZWNvbXB1dGUnLCBkYXRhRFRPLCBydWxlTmFtZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYylcbiAgICB9XG5cbiAgICBwb3N0TWVzc2FnZShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHRlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy53b3JrZXIudGVybWluYXRlKCk7XG4gICAgfVxuXG4gICAgYWRkTGlzdGVuZXIobmFtZSwgbGlzdGVuZXIsIHRoaXNBcmcsIGRlc2VyaWFsaXplcikge1xuICAgICAgICB0aGlzLmxpc3RlbmVyc1tuYW1lXSA9IHtcbiAgICAgICAgICAgIGZuOiBsaXN0ZW5lcixcbiAgICAgICAgICAgIHRoaXNBcmc6IHRoaXNBcmcgfHwgdGhpcyxcbiAgICAgICAgICAgIGRlc2VyaWFsaXplcjogZGVzZXJpYWxpemVyXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmVtb3ZlTGlzdGVuZXIobmFtZSkge1xuICAgICAgICBkZWxldGUgdGhpcy5saXN0ZW5lcnNbbmFtZV07XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge0pvYkxhdW5jaGVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWxhdW5jaGVyXCI7XG5pbXBvcnQge0pvYldvcmtlcn0gZnJvbSBcIi4vam9iLXdvcmtlclwiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb25MaXN0ZW5lcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXJcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0lkYkpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5pbXBvcnQge1JlY29tcHV0ZUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2JcIjtcbmltcG9ydCB7UHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Byb2JhYmlsaXN0aWMvcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7VGltZW91dEpvYlJlcG9zaXRvcnl9IGZyb20gXCIuL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS90aW1lb3V0LWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge1Rvcm5hZG9EaWFncmFtSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy90b3JuYWRvLWRpYWdyYW0vdG9ybmFkby1kaWFncmFtLWpvYlwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtTaW1wbGVKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge0xlYWd1ZVRhYmxlSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9sZWFndWUtdGFibGUvbGVhZ3VlLXRhYmxlLWpvYlwiO1xuaW1wb3J0IHtTcGlkZXJQbG90Sm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zcGlkZXItcGxvdC9zcGlkZXItcGxvdC1qb2JcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9ic01hbmFnZXJDb25maWcge1xuXG4gICAgd29ya2VyVXJsID0gbnVsbDtcbiAgICByZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgIGNsZWFyUmVwb3NpdG9yeSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG5cbiAgICB1c2VXb3JrZXI7XG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIGpvYldvcmtlcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG4gICAgam9iTGF1bmNoZXI7XG5cbiAgICBqb2JFeGVjdXRpb25MaXN0ZW5lcnMgPSBbXTtcblxuICAgIGFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzID0ge307XG4gICAgam9iSW5zdGFuY2VzVG9UZXJtaW5hdGUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGNvbmZpZykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuXG5cbiAgICAgICAgdGhpcy51c2VXb3JrZXIgPSAhIXRoaXMuY29uZmlnLndvcmtlclVybDtcbiAgICAgICAgaWYgKHRoaXMudXNlV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmluaXRXb3JrZXIodGhpcy5jb25maWcud29ya2VyVXJsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuaW5pdFJlcG9zaXRvcnkoKTtcblxuICAgICAgICB0aGlzLnJlZ2lzdGVySm9icygpO1xuXG5cblxuICAgICAgICB0aGlzLmpvYkxhdW5jaGVyID0gbmV3IEpvYkxhdW5jaGVyKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5qb2JXb3JrZXIsIChkYXRhKT0+dGhpcy5zZXJpYWxpemVEYXRhKGRhdGEpKTtcbiAgICB9XG5cbiAgICBzZXRDb25maWcoY29uZmlnKSB7XG4gICAgICAgIHRoaXMuY29uZmlnID0gbmV3IEpvYnNNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGluaXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZih0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSA9PT0gJ2lkYicpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IElkYkpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCksICdzZC1qb2ItcmVwb3NpdG9yeScsIHRoaXMuY29uZmlnLmNsZWFyUmVwb3NpdG9yeSk7XG4gICAgICAgIH1lbHNlIGlmKCd0aW1lb3V0Jyl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgVGltZW91dEpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB9ZWxzZSBpZignc2ltcGxlJyl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgU2ltcGxlSm9iUmVwb3NpdG9yeSh0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJldml2ZXIoKSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgbG9nLmVycm9yKCdKb2JzTWFuYWdlciBjb25maWd1cmF0aW9uIGVycm9yISBVbmtub3duIHJlcG9zaXRvcnkgdHlwZTogJyt0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSsnLiBVc2luZyBkZWZhdWx0OiBpZGInKTtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLnJlcG9zaXRvcnlUeXBlID0gJ2lkYic7XG4gICAgICAgICAgICB0aGlzLmluaXRSZXBvc2l0b3J5KClcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgc2VyaWFsaXplRGF0YShkYXRhKSB7XG4gICAgICAgIHJldHVybiBkYXRhLnNlcmlhbGl6ZSh0cnVlLCBmYWxzZSwgZmFsc2UsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmVwbGFjZXIoKSk7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICB2YXIgaWQgPSBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICBpZiAoIVV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKSB7XG4gICAgICAgICAgICBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQuaWRcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGlkKTtcbiAgICB9XG5cbiAgICBnZXRSZXN1bHQoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLnJ1bihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQgfHwgIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2pvYiB3YXMgZGVsZWdhdGVkIHRvIHdvcmtlciBhbmQgaXMgc3RpbGwgcnVubmluZ1xuXG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdID0gcmVzb2x2ZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iTGF1bmNoZXIuZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKTtcbiAgICB9XG5cbiAgICBzdG9wKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKCFqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJKb2IgRXhlY3V0aW9uIG5vdCBmb3VuZDogXCIgKyBqb2JFeGVjdXRpb25PcklkKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgbG9nLndhcm4oXCJKb2IgRXhlY3V0aW9uIG5vdCBydW5uaW5nLCBzdGF0dXM6IFwiICsgam9iRXhlY3V0aW9uLnN0YXR1cyArIFwiLCBlbmRUaW1lOiBcIiArIGpvYkV4ZWN1dGlvbi5lbmRUaW1lKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbi5pZCwgSk9CX0VYRUNVVElPTl9GTEFHLlNUT1ApLnRoZW4oKCk9PmpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qc3RvcCBqb2IgZXhlY3V0aW9uIGlmIHJ1bm5pbmcgYW5kIGRlbGV0ZSBqb2IgaW5zdGFuY2UgZnJvbSByZXBvc2l0b3J5Ki9cbiAgICB0ZXJtaW5hdGUoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgaWYoam9iRXhlY3V0aW9uLmlzUnVubmluZygpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KS50aGVuKCgpPT57XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkluc3RhbmNlLmlkXT1qb2JJbnN0YW5jZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcykge1xuICAgICAgICB2YXIgam9iID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuICAgIH1cblxuXG4gICAgLypSZXR1cm5zIGEgcHJvbWlzZSovXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iV29ya2VyO1xuICAgICAgICB9XG4gICAgICAgIGlmICghKGpvYlBhcmFtZXRlcnMgaW5zdGFuY2VvZiBKb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IHRoaXMuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICB9XG5cbiAgICBpbml0V29ya2VyKHdvcmtlclVybCkge1xuICAgICAgICB0aGlzLmpvYldvcmtlciA9IG5ldyBKb2JXb3JrZXIod29ya2VyVXJsLCAoKT0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKCdlcnJvciBpbiB3b3JrZXInLCBhcmd1bWVudHMpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIGFyZ3NEZXNlcmlhbGl6ZXIgPSAoYXJncyk9PiB7XG4gICAgICAgICAgICByZXR1cm4gW3RoaXMuam9iUmVwb3NpdG9yeS5yZXZpdmVKb2JFeGVjdXRpb24oYXJnc1swXSldXG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJiZWZvcmVKb2JcIiwgdGhpcy5iZWZvcmVKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImFmdGVySm9iXCIsIHRoaXMuYWZ0ZXJKb2IsIHRoaXMsIGFyZ3NEZXNlcmlhbGl6ZXIpO1xuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImpvYkZhdGFsRXJyb3JcIiwgdGhpcy5vbkpvYkZhdGFsRXJyb3IsIHRoaXMpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVySm9icygpIHtcblxuICAgICAgICBsZXQgc2Vuc2l0aXZpdHlBbmFseXNpc0pvYiA9IG5ldyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICBsZXQgcHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgPSBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIGlmKCFVdGlscy5pc1dvcmtlcigpKXtcbiAgICAgICAgICAgIHNlbnNpdGl2aXR5QW5hbHlzaXNKb2Iuc2V0QmF0Y2hTaXplKDEpO1xuICAgICAgICAgICAgcHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2Iuc2V0QmF0Y2hTaXplKDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihzZW5zaXRpdml0eUFuYWx5c2lzSm9iKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgVG9ybmFkb0RpYWdyYW1Kb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgUmVjb21wdXRlSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgTGVhZ3VlVGFibGVKb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBTcGlkZXJQbG90Sm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYihqb2IpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlZ2lzdGVySm9iKGpvYik7XG4gICAgICAgIGpvYi5yZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpXG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBkZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdmFyIGluZGV4ID0gdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImJlZm9yZUpvYlwiLCB0aGlzLnVzZVdvcmtlciwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsPT5sLmJlZm9yZUpvYihqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICBhZnRlckpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiYWZ0ZXJKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5hZnRlckpvYihqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb24uaWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbilcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHRoaXMuam9iSW5zdGFuY2VzVG9UZXJtaW5hdGVbam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkXSl7XG4gICAgICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkucmVtb3ZlSm9iSW5zdGFuY2Uoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLCBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBvbkpvYkZhdGFsRXJyb3Ioam9iRXhlY3V0aW9uSWQsIGVycm9yKXtcbiAgICAgICAgdmFyIHByb21pc2VSZXNvbHZlID0gdGhpcy5hZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlc1tqb2JFeGVjdXRpb25JZF07XG4gICAgICAgIGlmIChwcm9taXNlUmVzb2x2ZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkJ5SWQoam9iRXhlY3V0aW9uSWQpLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIGlmKGVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICAgICAgcHJvbWlzZVJlc29sdmUoam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgfVxuICAgICAgICBsb2cuZGVidWcoJ29uSm9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBlcnJvcik7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7XG4gICAgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUsXG4gICAgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUsXG4gICAgTWF4aU1pblJ1bGUsXG4gICAgTWF4aU1heFJ1bGUsXG4gICAgTWluaU1pblJ1bGUsXG4gICAgTWluaU1heFJ1bGVcbn0gZnJvbSBcIi4vcnVsZXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCAqIGFzIG1vZGVsIGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtNaW5NYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9taW4tbWF4LXJ1bGVcIjtcbmltcG9ydCB7TWF4TWluUnVsZX0gZnJvbSBcIi4vcnVsZXMvbWF4LW1pbi1ydWxlXCI7XG5pbXBvcnQge01pbk1pblJ1bGV9IGZyb20gXCIuL3J1bGVzL21pbi1taW4tcnVsZVwiO1xuaW1wb3J0IHtNYXhNYXhSdWxlfSBmcm9tIFwiLi9ydWxlcy9tYXgtbWF4LXJ1bGVcIjtcblxuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGVzTWFuYWdlcntcblxuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY3VycmVudFJ1bGU7XG4gICAgcnVsZUJ5TmFtZSA9IHt9O1xuICAgIHJ1bGVzID0gW107XG5cblxuICAgIGZsaXBQYWlyID0ge307XG4gICAgcGF5b2ZmSW5kZXggPSAwO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgY3VycmVudFJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNYXhpTWluUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWF4aU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1pbmlNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNaW5pTWF4UnVsZShleHByZXNzaW9uRW5naW5lKSk7XG5cbiAgICAgICAgbGV0IG1pbk1heCA9IG5ldyBNaW5NYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWF4KTtcbiAgICAgICAgbGV0IG1heE1pbiA9IG5ldyBNYXhNaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWluKTtcbiAgICAgICAgdGhpcy5hZGRGbGlwUGFpcihtaW5NYXgsIG1heE1pbik7XG5cbiAgICAgICAgbGV0IG1pbk1pbiA9IG5ldyBNaW5NaW5SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWluTWluKTtcbiAgICAgICAgbGV0IG1heE1heCA9IG5ldyBNYXhNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobWF4TWF4KTtcblxuXG4gICAgICAgIGlmIChjdXJyZW50UnVsZU5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbY3VycmVudFJ1bGVOYW1lXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVzWzBdO1xuICAgICAgICB9XG5cbiAgICB9XG5cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KXtcbiAgICAgICAgdGhpcy5wYXlvZmZJbmRleCA9IHBheW9mZkluZGV4IHx8IDA7XG4gICAgfVxuXG4gICAgYWRkUnVsZShydWxlKXtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW3J1bGUubmFtZV09cnVsZTtcbiAgICAgICAgdGhpcy5ydWxlcy5wdXNoKHJ1bGUpO1xuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpe1xuICAgICAgICAgcmV0dXJuICEhdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV07XG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIGZsaXBSdWxlKCl7XG4gICAgICAgIHZhciBmbGlwcGVkID0gdGhpcy5mbGlwUGFpclt0aGlzLmN1cnJlbnRSdWxlLm5hbWVdO1xuICAgICAgICBpZihmbGlwcGVkKXtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSBmbGlwcGVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpe1xuICAgICAgICB0aGlzLnJ1bGVzLmZpbHRlcihyPT5yLm11bHRpQ3JpdGVyaWEpLmZvckVhY2gocj0+ci5zZXREZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChkZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCkpO1xuICAgIH1cblxuICAgIHJlY29tcHV0ZShkYXRhTW9kZWwsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMsIGFsbDogJythbGxSdWxlcyk7XG5cbiAgICAgICAgZGF0YU1vZGVsLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLnJlY29tcHV0ZVRyZWUobiwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lLzEwMDApO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGluZyBydWxlcyBmb3IgdHJlZSAuLi4nLCByb290KTtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAgICAgdmFyIHJ1bGVzICA9IFt0aGlzLmN1cnJlbnRSdWxlXTtcbiAgICAgICAgaWYoYWxsUnVsZXMpe1xuICAgICAgICAgICAgcnVsZXMgPSB0aGlzLnJ1bGVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcnVsZXMuZm9yRWFjaChydWxlPT4ge1xuICAgICAgICAgICAgcnVsZS5zZXRQYXlvZmZJbmRleCh0aGlzLnBheW9mZkluZGV4KTtcbiAgICAgICAgICAgIHJ1bGUuc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlUGF5b2ZmKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jb21wdXRlT3B0aW1hbChyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY2xlYXJEZWNpc2lvblBvbGljeSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdGltZSAgPSAobmV3IERhdGUoKS5nZXRUaW1lKCkgLSBzdGFydFRpbWUpLzEwMDA7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRhdGlvbiB0b29rICcrdGltZSsncycpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgZ2V0Tm9kZURpc3BsYXlWYWx1ZShub2RlLCBuYW1lKSB7XG4gICAgICAgIHJldHVybiBub2RlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCBuYW1lKVxuXG4gICAgfVxuXG4gICAgZ2V0RWRnZURpc3BsYXlWYWx1ZShlLCBuYW1lKXtcbiAgICAgICAgaWYobmFtZT09PSdwcm9iYWJpbGl0eScpe1xuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdwcm9iYWJpbGl0eScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoZS5wYXJlbnROb2RlIGluc3RhbmNlb2YgbW9kZWwuZG9tYWluLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J3BheW9mZicpe1xuICAgICAgICAgICAgaWYodGhpcy5jdXJyZW50UnVsZS5tdWx0aUNyaXRlcmlhKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmYnKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3BheW9mZlsnICt0aGlzLnBheW9mZkluZGV4ICsgJ10nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9XG4gICAgICAgIGlmKG5hbWU9PT0nb3B0aW1hbCcpe1xuICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsICdvcHRpbWFsJylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZEZsaXBQYWlyKHJ1bGUxLCBydWxlMikge1xuICAgICAgICB0aGlzLmZsaXBQYWlyW3J1bGUxLm5hbWVdID0gcnVsZTI7XG4gICAgICAgIHRoaXMuZmxpcFBhaXJbcnVsZTIubmFtZV0gPSBydWxlMTtcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWF4aW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUuTkFNRSwgdHJ1ZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZj0wLCBwcm9iYWJpbGl0eVRvRW50ZXI9MSl7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBpZiAoIHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qZXhwZWN0ZWQgdmFsdWUgbWluaW1pemF0aW9uIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ2V4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUuTkFNRSwgZmFsc2UsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSkscGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWF4aS1taW4tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1tYXgtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vbWluaS1taW4tcnVsZSdcblxuXG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1heFJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1heFJ1bGUuTkFNRSwgWzEsIDFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1heE1pblJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heC1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heE1pblJ1bGUuTkFNRSwgWzEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNYXhSdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWF4aS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWF4aU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWF4aS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1heGlNaW5SdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNaW5NYXhSdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtaW4tbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5NYXhSdWxlLk5BTUUsIFstMSwgMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWluTWluUnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluLW1pbic7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluTWluUnVsZS5OQU1FLCBbLTEsIC0xXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1tYXggcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1heFJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1tYXgnO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNYXhSdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPGJlc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvYmVzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5tYXhCeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlfSBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qbWluaS1taW4gcnVsZSovXG5leHBvcnQgY2xhc3MgTWluaU1pblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluaS1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbmlNaW5SdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSBcIi4vb2JqZWN0aXZlLXJ1bGVcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cblxuZXhwb3J0IGNsYXNzIE11bHRpQ3JpdGVyaWFSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZSB7XG5cbiAgICBjcml0ZXJpb24xV2VpZ2h0ID0gMTtcbiAgICBwYXlvZmZDb2VmZnMgPSBbMSwgLTFdO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgcGF5b2ZmQ29lZmZzLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUsIHRydWUpO1xuICAgICAgICB0aGlzLnBheW9mZkNvZWZmcyA9IHBheW9mZkNvZWZmcztcblxuICAgIH1cblxuICAgIHNldERlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGNyaXRlcmlvbjFXZWlnaHQpIHtcbiAgICAgICAgdGhpcy5jcml0ZXJpb24xV2VpZ2h0ID0gY3JpdGVyaW9uMVdlaWdodDtcbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmYgPSBbMCwgMF0sIGFnZ3JlZ2F0ZWRQYXlvZmYgPSBbMCwgMF0pIHtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gWzAsIDBdO1xuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgYmFzZVBheW9mZnMgPSBbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldO1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIGJhc2VQYXlvZmZzLCBbdGhpcy5hZGQoYmFzZVBheW9mZnNbMF0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMF0pLCB0aGlzLmFkZChiYXNlUGF5b2Zmc1sxXSwgYWdncmVnYXRlZFBheW9mZlsxXSldKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkQ29tYmluZWRQYXlvZmYgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZENvbWJpbmVkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZENvbWJpbmVkUGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJlc3RDaGlsZC5lcXVhbHMoY2hpbGRDb21iaW5lZFBheW9mZikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5kZWNpc2lvblBvbGljeSkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGUsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHNlbGVjdGVkSW5kZXhlcy5pbmRleE9mKGkpIDwgMCA/IDAuMCA6IDEuMCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBiYXNlUGF5b2ZmcyA9IFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV07XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgYmFzZVBheW9mZnMsIFt0aGlzLmFkZChiYXNlUGF5b2Zmc1swXSwgYWdncmVnYXRlZFBheW9mZlswXSksIHRoaXMuYWRkKGJhc2VQYXlvZmZzWzFdLCBhZ2dyZWdhdGVkUGF5b2ZmWzFdKV0pO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDA7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodCA9IHRoaXMuYWRkKHN1bXdlaWdodCwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChzdW13ZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmYuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgZXAgPSB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZlsnICsgaSArICddJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZltpXSA9IHRoaXMuYWRkKHAsIHRoaXMubXVsdGlwbHkodGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JyksIGVwKS5kaXYoc3Vtd2VpZ2h0KSlcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9XG4gICAgICAgIHBheW9mZi5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIHBheW9mZltpXSA9IHRoaXMuYWRkKHAsIGNoaWxkcmVuUGF5b2ZmW2ldKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKG5vZGUpO1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnYWdncmVnYXRlZFBheW9mZicsIGFnZ3JlZ2F0ZWRQYXlvZmYpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIDApOyAvL2luaXRpYWwgdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicsIHRoaXMuY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKHBheW9mZikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJywgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICBjb21wdXRlQ29tYmluZWRQYXlvZmYocGF5b2ZmKXtcbiAgICAgICAgLy8gW2NyaXRlcmlvbiAxIGNvZWZmXSpbY3JpdGVyaW9uIDFdKlt3ZWlnaHRdK1tjcml0ZXJpb24gMiBjb2VmZl0qW2NyaXRlcmlvbiAyXVxuICAgICAgICBpZiAodGhpcy5jcml0ZXJpb24xV2VpZ2h0ID09PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHBheW9mZlswXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuYWRkKHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMF0sIHRoaXMubXVsdGlwbHkodGhpcy5jcml0ZXJpb24xV2VpZ2h0LCBwYXlvZmZbMF0pKSwgdGhpcy5tdWx0aXBseSh0aGlzLnBheW9mZkNvZWZmc1sxXSwgcGF5b2ZmWzFdKSk7XG4gICAgfVxuXG4gICAgLy8gIGNvbWJpbmVkUGF5b2ZmIC0gcGFyZW50IGVkZ2UgY29tYmluZWRQYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBjb21iaW5lZFBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsICdjb21iaW5lZFBheW9mZicpLCBjb21iaW5lZFBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAnY29tYmluZWRQYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5jb21wdXRlQ29tYmluZWRQYXlvZmYoW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuLypCYXNlIGNsYXNzIGZvciBvYmplY3RpdmUgcnVsZXMqL1xuZXhwb3J0IGNsYXNzIE9iamVjdGl2ZVJ1bGUge1xuICAgIG5hbWU7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGRlY2lzaW9uUG9saWN5O1xuICAgIG1heGltaXphdGlvbjtcblxuICAgIHBheW9mZkluZGV4ID0gMDtcbiAgICBtdWx0aUNyaXRlcmlhID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBtYXhpbWl6YXRpb24sIGV4cHJlc3Npb25FbmdpbmUsIG11bHRpQ3JpdGVyaWE9ZmFsc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5tYXhpbWl6YXRpb24gPSBtYXhpbWl6YXRpb247XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMubXVsdGlDcml0ZXJpYSA9IG11bHRpQ3JpdGVyaWE7XG4gICAgfVxuXG4gICAgc2V0RGVjaXNpb25Qb2xpY3koZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IGRlY2lzaW9uUG9saWN5O1xuICAgIH1cblxuICAgIHNldFBheW9mZkluZGV4KHBheW9mZkluZGV4KSB7XG4gICAgICAgIHRoaXMucGF5b2ZmSW5kZXggPSBwYXlvZmZJbmRleDtcbiAgICB9XG5cbiAgICBjbGVhckRlY2lzaW9uUG9saWN5KCkge1xuICAgICAgICB0aGlzLmRlY2lzaW9uUG9saWN5ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBzaG91bGQgcmV0dXJuIGFycmF5IG9mIHNlbGVjdGVkIGNoaWxkcmVuIGluZGV4ZXNcbiAgICBtYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpIHtcbiAgICAgICAgdmFyIGJlc3Q7XG4gICAgICAgIGlmICh0aGlzLm1heGltaXphdGlvbikge1xuICAgICAgICAgICAgYmVzdCA9IHRoaXMubWF4KC4uLmNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBiZXN0ID0gdGhpcy5taW4oLi4uY2hpbGRyZW5QYXlvZmZzKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgIGNoaWxkcmVuUGF5b2Zmcy5mb3JFYWNoKChwLCBpKT0+IHtcbiAgICAgICAgICAgIGlmIChFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUoYmVzdCwgcCkgPT0gMCkge1xuICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHNlbGVjdGVkSW5kZXhlcztcbiAgICB9XG5cbiAgICBfbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLmRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcy5kZWNpc2lvblBvbGljeSwgZGVjaXNpb25Ob2RlKTtcbiAgICAgICAgICAgIGlmIChkZWNpc2lvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiBbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMubWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKTtcbiAgICB9XG5cbiAgICAvLyBleHRlbnNpb24gcG9pbnQgZm9yIGNoYW5naW5nIGNvbXB1dGVkIHByb2JhYmlsaXR5IG9mIGVkZ2VzIGluIGEgY2hhbmNlIG5vZGVcbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpIHtcblxuICAgIH1cblxuICAgIC8vIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZiwgYWdncmVnYXRlZFBheW9mZiAtIGFnZ3JlZ2F0ZWQgcGF5b2ZmIGFsb25nIHBhdGhcbiAgICBjb21wdXRlUGF5b2ZmKG5vZGUsIHBheW9mZiA9IDAsIGFnZ3JlZ2F0ZWRQYXlvZmYgPSAwKSB7XG4gICAgICAgIHZhciBjaGlsZHJlblBheW9mZiA9IDA7XG4gICAgICAgIGlmIChub2RlLmNoaWxkRWRnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IHRoaXMuX21ha2VEZWNpc2lvbihub2RlLCBub2RlLmNoaWxkRWRnZXMubWFwKGU9PnRoaXMuY29tcHV0ZVBheW9mZihlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLmFkZCh0aGlzLmJhc2VQYXlvZmYoZSksIGFnZ3JlZ2F0ZWRQYXlvZmYpKSkpO1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q2hpbGQgPSAtSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q2hpbGQgPSBJbmZpbml0eTtcbiAgICAgICAgICAgICAgICB2YXIgd29yc3RDb3VudCA9IDE7XG5cbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZFBheW9mZiA8IHdvcnN0Q2hpbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNoaWxkUGF5b2ZmLmVxdWFscyh3b3JzdENoaWxkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd29yc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkUGF5b2ZmID4gYmVzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hpbGRQYXlvZmYuZXF1YWxzKGJlc3RDaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudCsrXG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuYmFzZVByb2JhYmlsaXR5KGUpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLm1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KG5vZGUuY2hpbGRFZGdlcywgYmVzdENoaWxkLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGQsIHdvcnN0Q291bnQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgc3Vtd2VpZ2h0ID0gMDtcbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgc3Vtd2VpZ2h0ID0gdGhpcy5hZGQoc3Vtd2VpZ2h0LCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gY29uc29sZS5sb2cocGF5b2ZmLG5vZGUuY2hpbGRFZGdlcywnc3Vtd2VpZ2h0JyxzdW13ZWlnaHQpO1xuICAgICAgICAgICAgaWYgKHN1bXdlaWdodCA+IDApIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZiA9IHRoaXMuYWRkKGNoaWxkcmVuUGF5b2ZmLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkuZGl2KHN1bXdlaWdodCkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHBheW9mZiA9IHRoaXMuYWRkKHBheW9mZiwgY2hpbGRyZW5QYXlvZmYpO1xuICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMobm9kZSk7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJysgJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2NoaWxkcmVuUGF5b2ZmJyArICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUsIHBheW9mZik7XG4gICAgfVxuXG4gICAgLy8ga29sb3J1amUgb3B0eW1hbG5lIMWbY2llxbxraVxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUpIHtcbiAgICAgICAgdGhyb3cgJ2NvbXB1dGVPcHRpbWFsIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3IgcnVsZTogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qIGdldCBvciBzZXQgY29tcHV0ZWQgcGF5b2ZmKi9cbiAgICBjb21wdXRlZFBheW9mZihub2RlLCB2YWx1ZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCB2YWx1ZSlcbiAgICB9XG5cbiAgICAvKkdldCBvciBzZXQgb2JqZWN0J3MgY29tcHV0ZWQgdmFsdWUgZm9yIGN1cnJlbnQgcnVsZSovXG4gICAgY1ZhbHVlKG9iamVjdCwgZmllbGRQYXRoLCB2YWx1ZSkge1xuICAgICAgICAvLyBpZihmaWVsZFBhdGgudHJpbSgpID09PSAncGF5b2ZmJyl7XG4gICAgICAgIC8vICAgICBmaWVsZFBhdGggKz0gJ1snICsgdGhpcy5wYXlvZmZJbmRleCArICddJztcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIHJldHVybiBvYmplY3QuY29tcHV0ZWRWYWx1ZSh0aGlzLm5hbWUsIGZpZWxkUGF0aCwgdmFsdWUpO1xuICAgIH1cblxuICAgIGJhc2VQcm9iYWJpbGl0eShlZGdlKSB7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgfVxuXG4gICAgYmFzZVBheW9mZihlZGdlLCBwYXlvZmZJbmRleCkge1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCBwYXlvZmZJbmRleCB8fCB0aGlzLnBheW9mZkluZGV4KTtcbiAgICB9XG5cbiAgICBjbGVhckNvbXB1dGVkVmFsdWVzKG9iamVjdCkge1xuICAgICAgICBvYmplY3QuY2xlYXJDb21wdXRlZFZhbHVlcyh0aGlzLm5hbWUpO1xuICAgIH1cblxuICAgIGFkZChhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmFkZChhLCBiKVxuICAgIH1cblxuICAgIHN1YnRyYWN0KGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoYSwgYilcbiAgICB9XG5cbiAgICBkaXZpZGUoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoYSwgYilcbiAgICB9XG5cbiAgICBtdWx0aXBseShhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm11bHRpcGx5KGEsIGIpXG4gICAgfVxuXG4gICAgbWF4KCkge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tYXgoLi4uYXJndW1lbnRzKVxuICAgIH1cblxuICAgIG1pbigpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubWluKC4uLmFyZ3VtZW50cylcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge09wZXJhdGlvbn0gZnJvbSBcIi4vb3BlcmF0aW9uXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5cbi8qU3VidHJlZSBmbGlwcGluZyBvcGVyYXRpb24qL1xuZXhwb3J0IGNsYXNzIEZsaXBTdWJ0cmVlIGV4dGVuZHMgT3BlcmF0aW9ue1xuXG4gICAgc3RhdGljICROQU1FID0gJ2ZsaXBTdWJ0cmVlJztcbiAgICBkYXRhO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKEZsaXBTdWJ0cmVlLiROQU1FKTtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgaXNBcHBsaWNhYmxlKG9iamVjdCl7XG4gICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlXG4gICAgfVxuXG4gICAgY2FuUGVyZm9ybShub2RlKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpY2FibGUobm9kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKHRoaXMuZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShub2RlKSkuaXNWYWxpZCgpKSB7IC8vY2hlY2sgaWYgdGhlIHdob2xlIHN1YnRyZWUgaXMgcHJvcGVyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5OdW1iZXIgPSBudWxsO1xuICAgICAgICB2YXIgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMgPSBbXTtcbiAgICAgICAgdmFyIGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoKTtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzU2V0O1xuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5ldmVyeShlPT4ge1xuXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gZS5jaGlsZE5vZGU7XG4gICAgICAgICAgICAgICAgaWYgKCEoY2hpbGQgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkcmVuRWRnZUxhYmVsc1NldC5oYXMoZS5uYW1lLnRyaW0oKSkpIHsgLy8gZWRnZSBsYWJlbHMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNoaWxkcmVuRWRnZUxhYmVsc1NldC5hZGQoZS5uYW1lLnRyaW0oKSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuTnVtYmVyID0gY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuTnVtYmVyIDwgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChnZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzLnB1c2goZ2UubmFtZS50cmltKCkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldCA9IG5ldyBTZXQoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldC5zaXplICE9PSBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5sZW5ndGgpIHsgLy9ncmFuZGNoaWxkcmVuIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZC5jaGlsZEVkZ2VzLmxlbmd0aCAhPSBncmFuZGNoaWxkcmVuTnVtYmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkLmNoaWxkRWRnZXMuZXZlcnkoKGdlLCBpKT0+Z3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNbaV0gPT09IGdlLm5hbWUudHJpbSgpKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG5cbiAgICAgICAgICAgIH0pKSB7XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHBlcmZvcm0ocm9vdCkge1xuXG4gICAgICAgIHZhciByb290Q2xvbmUgPSB0aGlzLmRhdGEuY2xvbmVTdWJ0cmVlKHJvb3QsIHRydWUpO1xuICAgICAgICB2YXIgb2xkQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICB2YXIgb2xkR3JhbmRDaGlsZHJlbk51bWJlciA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlcy5sZW5ndGg7XG5cbiAgICAgICAgdmFyIGNoaWxkcmVuTnVtYmVyID0gb2xkR3JhbmRDaGlsZHJlbk51bWJlcjtcbiAgICAgICAgdmFyIGdyYW5kQ2hpbGRyZW5OdW1iZXIgPSBvbGRDaGlsZHJlbk51bWJlcjtcblxuICAgICAgICB2YXIgY2FsbGJhY2tzRGlzYWJsZWQgPSB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQ7XG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IHRydWU7XG5cblxuICAgICAgICB2YXIgY2hpbGRYID0gcm9vdC5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5sb2NhdGlvbi54O1xuICAgICAgICB2YXIgdG9wWSA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueTtcbiAgICAgICAgdmFyIGJvdHRvbVkgPSByb290LmNoaWxkRWRnZXNbb2xkQ2hpbGRyZW5OdW1iZXIgLSAxXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tvbGRHcmFuZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG5cbiAgICAgICAgdmFyIGV4dGVudFkgPSBib3R0b21ZIC0gdG9wWTtcbiAgICAgICAgdmFyIHN0ZXBZID0gZXh0ZW50WSAvIChjaGlsZHJlbk51bWJlciArIDEpO1xuXG4gICAgICAgIHJvb3QuY2hpbGRFZGdlcy5zbGljZSgpLmZvckVhY2goZT0+IHRoaXMuZGF0YS5yZW1vdmVOb2RlKGUuY2hpbGROb2RlKSk7XG5cblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoaWxkcmVuTnVtYmVyOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IG5ldyBtb2RlbC5DaGFuY2VOb2RlKG5ldyBtb2RlbC5Qb2ludChjaGlsZFgsIHRvcFkgKyAoaSArIDEpICogc3RlcFkpKTtcbiAgICAgICAgICAgIHZhciBlZGdlID0gdGhpcy5kYXRhLmFkZE5vZGUoY2hpbGQsIHJvb3QpO1xuICAgICAgICAgICAgZWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0ubmFtZTtcblxuICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IDA7XG5cbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZ3JhbmRDaGlsZHJlbk51bWJlcjsgaisrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGdyYW5kQ2hpbGQgPSByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jaGlsZE5vZGU7XG5cblxuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkRWRnZSA9IHRoaXMuZGF0YS5hdHRhY2hTdWJ0cmVlKGdyYW5kQ2hpbGQsIGNoaWxkKTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5uYW1lID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0ubmFtZTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wYXlvZmYgPSBbXG4gICAgICAgICAgICAgICAgICAgIEV4cHJlc3Npb25FbmdpbmUuYWRkKHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDApLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAwKSksXG4gICAgICAgICAgICAgICAgICAgIEV4cHJlc3Npb25FbmdpbmUuYWRkKHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIDEpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAxKSksXG4gICAgICAgICAgICAgICAgXTtcblxuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpKTtcbiAgICAgICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoZWRnZS5wcm9iYWJpbGl0eSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocCwgZWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBpZiAoZWRnZS5wcm9iYWJpbGl0eS5lcXVhbHMoMCkpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGdyYW5kQ2hpbGRyZW5OdW1iZXIpO1xuICAgICAgICAgICAgICAgIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IHByb2I7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChncmFuZENoaWxkRWRnZT0+IHtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZC5jaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShlZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAocm9vdC5jaGlsZEVkZ2VzKTtcblxuXG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IGNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuX2ZpcmVOb2RlQWRkZWRDYWxsYmFjaygpO1xuICAgIH1cblxuICAgIF9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgaWYoIXByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgbG9nLmluZm8oJ1N1bSBvZiB0aGUgcHJvYmFiaWxpdGllcyBpbiBjaGlsZCBub2RlcyBpcyBub3QgZXF1YWwgdG8gMSA6ICcsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIHZhciBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIHZhciBjZiA9IDEwMDAwMDAwMDAwMDA7IC8vMTBeMTJcbiAgICAgICAgICAgIHZhciBwcmVjID0gMTI7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gcGFyc2VJbnQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChlLnByb2JhYmlsaXR5LCBwcmVjKSAqIGNmKTtcbiAgICAgICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IG5ld1Byb2JhYmlsaXR5U3VtICsgZS5wcm9iYWJpbGl0eTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdmFyIHJlc3QgPSBjZiAtIG5ld1Byb2JhYmlsaXR5U3VtO1xuICAgICAgICAgICAgbG9nLmluZm8oJ05vcm1hbGl6aW5nIHdpdGggcm91bmRpbmcgdG8gcHJlY2lzaW9uOiAnICsgcHJlYywgcmVzdCk7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocmVzdCwgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHBhcnNlSW50KGUucHJvYmFiaWxpdHkpLCBjZikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiXG4vKkJhc2UgY2xhc3MgZm9yIGNvbXBsZXggb3BlcmF0aW9ucyBvbiB0cmVlIHN0cnVjdHVyZSovXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9ue1xuXG4gICAgbmFtZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUpe1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgb3BlcmF0aW9uIGlzIHBvdGVudGlhbGx5IGFwcGxpY2FibGUgZm9yIG9iamVjdFxuICAgIGlzQXBwbGljYWJsZSgpe1xuICAgICAgICB0aHJvdyAnaXNBcHBsaWNhYmxlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgY2FuIHBlcmZvcm0gb3BlcmF0aW9uIGZvciBhcHBsaWNhYmxlIG9iamVjdFxuICAgIGNhblBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ2NhblBlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgcGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAncGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtGbGlwU3VidHJlZX0gZnJvbSBcIi4vZmxpcC1zdWJ0cmVlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbnNNYW5hZ2VyIHtcblxuICAgIG9wZXJhdGlvbnMgPSBbXTtcbiAgICBvcGVyYXRpb25CeU5hbWUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnJlZ2lzdGVyT3BlcmF0aW9uKG5ldyBGbGlwU3VidHJlZShkYXRhLCBleHByZXNzaW9uRW5naW5lKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJPcGVyYXRpb24ob3BlcmF0aW9uKXtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zLnB1c2gob3BlcmF0aW9uKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25CeU5hbWVbb3BlcmF0aW9uLm5hbWVdID0gb3BlcmF0aW9uO1xuICAgIH1cblxuXG4gICAgZ2V0T3BlcmF0aW9uQnlOYW1lKG5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25CeU5hbWVbbmFtZV07XG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3Qpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zLmZpbHRlcihvcD0+b3AuaXNBcHBsaWNhYmxlKG9iamVjdCkpXG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBEZWNpc2lvbntcbiAgICBub2RlO1xuICAgIGRlY2lzaW9uVmFsdWU7IC8vaW5kZXggb2YgIHNlbGVjdGVkIGVkZ2VcbiAgICBjaGlsZHJlbiA9IFtdO1xuICAgIGtleTtcblxuICAgIGNvbnN0cnVjdG9yKG5vZGUsIGRlY2lzaW9uVmFsdWUpIHtcbiAgICAgICAgdGhpcy5ub2RlID0gbm9kZTtcbiAgICAgICAgdGhpcy5kZWNpc2lvblZhbHVlID0gZGVjaXNpb25WYWx1ZTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5PSckaWQnKXtcbiAgICAgICAgdmFyIGUgPSBkZWNpc2lvbi5ub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgIHZhciBrZXkgPSBkZWNpc2lvbi5ub2RlW2tleVByb3BlcnR5XStcIjpcIisoZVtrZXlQcm9wZXJ0eV0/IGVba2V5UHJvcGVydHldIDogZGVjaXNpb24uZGVjaXNpb25WYWx1ZSsxKTtcbiAgICAgICAgcmV0dXJuIGtleS5yZXBsYWNlKC9cXG4vZywgJyAnKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSlcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24oZGVjaXNpb24sIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGlmKGRlY2lzaW9uLm5vZGU9PT1kZWNpc2lvbk5vZGUgfHwgZGVjaXNpb24ubm9kZS4kaWQgPT09IGRlY2lzaW9uTm9kZS4kaWQpe1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICB9XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkID0gRGVjaXNpb24uZ2V0RGVjaXNpb24oZGVjaXNpb24uY2hpbGRyZW5baV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRpYyB0b0RlY2lzaW9uU3RyaW5nKGRlY2lzaW9uLCBleHRlbmRlZD1mYWxzZSwga2V5UHJvcGVydHk9J25hbWUnLCBpbmRlbnQgPSAnJyl7XG5cbiAgICAgICAgdmFyIHJlcyA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eSk7XG4gICAgICAgIHZhciBjaGlsZHJlblJlcyA9IFwiXCI7XG5cbiAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4uZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihjaGlsZHJlblJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSAnXFxuJytpbmRlbnQ7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLGV4dGVuZGVkLGtleVByb3BlcnR5LCBpbmRlbnQrJ1xcdCcpXG4gICAgICAgIH0pO1xuICAgICAgICBpZihkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGgpe1xuICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gICdcXG4nK2luZGVudCArY2hpbGRyZW5SZXM7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9IFwiIC0gKFwiICsgY2hpbGRyZW5SZXMgKyBcIilcIjtcbiAgICAgICAgICAgIH1cblxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXMrY2hpbGRyZW5SZXM7XG4gICAgfVxuXG4gICAgdG9EZWNpc2lvblN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljeVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWNpZXNDb2xsZWN0b3J7XG4gICAgcG9saWNpZXMgPSBbXTtcbiAgICBydWxlTmFtZT1mYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKHJvb3QsIG9wdGltYWxGb3JSdWxlTmFtZSl7XG4gICAgICAgIHRoaXMucnVsZU5hbWUgPSBvcHRpbWFsRm9yUnVsZU5hbWU7XG4gICAgICAgIHRoaXMuY29sbGVjdChyb290KS5mb3JFYWNoKChkZWNpc2lvbnMsaSk9PntcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXMucHVzaChuZXcgUG9saWN5KFwiI1wiKyhpKzEpLCBkZWNpc2lvbnMpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHRoaXMucG9saWNpZXMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzWzBdLmlkID0gXCJkZWZhdWx0XCJcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbGxlY3Qocm9vdCl7XG4gICAgICAgIHZhciBub2RlUXVldWUgPSBbcm9vdF07XG4gICAgICAgIHZhciBub2RlO1xuICAgICAgICB2YXIgZGVjaXNpb25Ob2RlcyA9IFtdO1xuICAgICAgICB3aGlsZShub2RlUXVldWUubGVuZ3RoKXtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlUXVldWUuc2hpZnQoKTtcblxuICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICBkZWNpc2lvbk5vZGVzLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuICAgICAgICAgICAgICAgIG5vZGVRdWV1ZS5wdXNoKGVkZ2UuY2hpbGROb2RlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YoZGVjaXNpb25Ob2Rlcy5tYXAoKGRlY2lzaW9uTm9kZSk9PntcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbnM9IFtdO1xuICAgICAgICAgICAgZGVjaXNpb25Ob2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcblxuICAgICAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIWVkZ2UuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZERlY2lzaW9ucyA9IHRoaXMuY29sbGVjdChlZGdlLmNoaWxkTm9kZSk7IC8vYWxsIHBvc3NpYmxlIGNoaWxkIGRlY2lzaW9ucyAoY2FydGVzaWFuKVxuICAgICAgICAgICAgICAgIGNoaWxkRGVjaXNpb25zLmZvckVhY2goY2Q9PntcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKGRlY2lzaW9uTm9kZSwgaSk7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9ucy5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4gPSBjZDtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbnM7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY3l7XG4gICAgaWQ7XG4gICAgZGVjaXNpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihpZCwgZGVjaXNpb25zKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyA9IGRlY2lzaW9ucyB8fCBbXTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShwb2xpY3kpe1xuICAgICAgICB2YXIga2V5ID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PmtleSs9KGtleT8gXCImXCI6IFwiXCIpK2Qua2V5KTtcbiAgICAgICAgcmV0dXJuIGtleTtcbiAgICB9XG5cbiAgICBlcXVhbHMocG9saWN5LCBpZ25vcmVJZD10cnVlKXtcbiAgICAgICAgaWYodGhpcy5rZXkgIT0gcG9saWN5LmtleSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWdub3JlSWQgfHwgdGhpcy5pZCA9PT0gcG9saWN5LmlkO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24ocG9saWN5LCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBmb3IodmFyIGk9MDsgaTxwb2xpY3kuZGVjaXNpb25zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IERlY2lzaW9uLmdldERlY2lzaW9uKHBvbGljeS5kZWNpc2lvbnNbaV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHN0YXRpYyB0b1BvbGljeVN0cmluZyhwb2xpY3ksIGV4dGVuZGVkPWZhbHNlLCBwcmVwZW5kSWQ9ZmFsc2Upe1xuXG4gICAgICAgIHZhciByZXMgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYocmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIlxcblwiXG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCwgZXh0ZW5kZWQsICduYW1lJywgJ1xcdCcpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYocHJlcGVuZElkICYmIHBvbGljeS5pZCE9PXVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gcG9saWN5LmlkK1wiIFwiK3JlcztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuXG4gICAgdG9Qb2xpY3lTdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS50b1BvbGljeVN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5leHBvcnQgY2xhc3MgTWNkbVdlaWdodFZhbHVlVmFsaWRhdG9ye1xuXG4gICAgYWRkaXRpb25hbFZhbGlkYXRvciA9IG51bGw7XG5cbiAgICBjb25zdHJ1Y3RvcihhZGRpdGlvbmFsVmFsaWRhdG9yKXtcbiAgICAgICAgdGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yID0gYWRkaXRpb25hbFZhbGlkYXRvcjtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSl7XG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwYXJzZWQgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICAgICAgaWYocGFyc2VkICE9PSBJbmZpbml0eSAmJiAhRXhwcmVzc2lvbkVuZ2luZS52YWxpZGF0ZSh2YWx1ZSwge30sIGZhbHNlKSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHZhciBtYXhTYWZlSW50ZWdlciA9IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIHx8IDkwMDcxOTkyNTQ3NDA5OTE7IC8vIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIGlzIHVuZGVmaW5lZCBpbiBJRVxuICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIDApIDwgMCB8fCAodmFsdWUgIT09IEluZmluaXR5ICYmIEV4cHJlc3Npb25FbmdpbmUuY29tcGFyZSh2YWx1ZSwgbWF4U2FmZUludGVnZXIpPiAwKSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmFkZGl0aW9uYWxWYWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmFkZGl0aW9uYWxWYWxpZGF0b3IoRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSkpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUGF5b2ZmVmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuXG5cbiAgICAgICAgaWYodmFsdWU9PT1udWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgdmFyIG1heFNhZmVJbnRlZ2VyID0gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgfHwgOTAwNzE5OTI1NDc0MDk5MTsgLy8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgaW4gdW5kZWZpbmVkIGluIElFXG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIC1tYXhTYWZlSW50ZWdlcikgPj0gMCAmJiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIG1heFNhZmVJbnRlZ2VyKSA8PSAwO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tICdzZC1leHByZXNzaW9uLWVuZ2luZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKkNvbXB1dGVkIGJhc2UgdmFsdWUgdmFsaWRhdG9yKi9cbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9ye1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZT1leHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlLCBlZGdlKXtcbiAgICAgICAgaWYodmFsdWU9PT1udWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZS5jb21wYXJlKDApID49IDAgJiYgdmFsdWUuY29tcGFyZSgxKSA8PSAwO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtkb21haW4gYXMgbW9kZWwsIFZhbGlkYXRpb25SZXN1bHR9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7UHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcHJvYmFiaWxpdHktdmFsdWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BheW9mZlZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi9wYXlvZmYtdmFsdWUtdmFsaWRhdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBUcmVlVmFsaWRhdG9yIHtcblxuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMucHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvciA9IG5ldyBQcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLnBheW9mZlZhbHVlVmFsaWRhdG9yID0gbmV3IFBheW9mZlZhbHVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKG5vZGVzKSB7XG5cbiAgICAgICAgdmFyIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpO1xuXG4gICAgICAgIG5vZGVzLmZvckVhY2gobj0+IHtcbiAgICAgICAgICAgIHRoaXMudmFsaWRhdGVOb2RlKG4sIHZhbGlkYXRpb25SZXN1bHQpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdmFsaWRhdGlvblJlc3VsdDtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZU5vZGUobm9kZSwgdmFsaWRhdGlvblJlc3VsdCA9IG5ldyBWYWxpZGF0aW9uUmVzdWx0KCkpIHtcblxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghbm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcignaW5jb21wbGV0ZVBhdGgnLCBub2RlKVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcbiAgICAgICAgdmFyIHdpdGhIYXNoID0gZmFsc2U7XG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCB0cnVlKTtcblxuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5ID0gZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5wcm9iYWJpbGl0eVZhbHVlVmFsaWRhdG9yLnZhbGlkYXRlKHByb2JhYmlsaXR5KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIUV4cHJlc3Npb25FbmdpbmUuaXNIYXNoKGUucHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFByb2JhYmlsaXR5JywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGUucGF5b2ZmLmZvckVhY2goKHJhd1BheW9mZiwgcGF5b2ZmSW5kZXgpPT4ge1xuICAgICAgICAgICAgICAgIHZhciBwYXRoID0gJ3BheW9mZlsnICsgcGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KHBhdGgsIHRydWUpO1xuICAgICAgICAgICAgICAgIHZhciBwYXlvZmYgPSBlLmNvbXB1dGVkQmFzZVBheW9mZih1bmRlZmluZWQsIHBheW9mZkluZGV4KTtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMucGF5b2ZmVmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocGF5b2ZmKSkge1xuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFBheW9mZicsIGRhdGE6IHsnbnVtYmVyJzogaSArIDF9fSwgbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eShwYXRoLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIGlmIChpc05hTihwcm9iYWJpbGl0eVN1bSkgfHwgIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ3Byb2JhYmlsaXR5RG9Ob3RTdW1VcFRvMScsIG5vZGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cblxuICAgICAgICByZXR1cm4gdmFsaWRhdGlvblJlc3VsdDtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL3NyYy9pbmRleCdcbiJdfQ==
