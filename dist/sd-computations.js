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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmMvY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyYy9jb21wdXRhdGlvbnMtbWFuYWdlci5qcyIsInNyYy9jb21wdXRhdGlvbnMtdXRpbHMuanMiLCJzcmMvZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL2xlYWd1ZS10YWJsZS9sZWFndWUtdGFibGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvcmVjb21wdXRlL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvbi13YXkvc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9uLXdheS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3N0ZXBzL3ByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9jb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvcHJvYmFiaWxpc3RpYy9zdGVwcy9wcm9iLWNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvc3BpZGVyLXBsb3Qvc3BpZGVyLXBsb3Qtam9iLXBhcmFtZXRlcnMuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zcGlkZXItcGxvdC9zcGlkZXItcGxvdC1qb2IuanMiLCJzcmMvam9icy9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9zcGlkZXItcGxvdC9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9jYWxjdWxhdGUtc3RlcC5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwLmpzIiwic3JjL2pvYnMvY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3Rvcm5hZG8tZGlhZ3JhbS90b3JuYWRvLWRpYWdyYW0tam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXAuanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9leHRlbmRhYmxlLWVycm9yLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmMvam9icy9lbmdpbmUvZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmMvam9icy9lbmdpbmUvaW5kZXguanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWV4ZWN1dGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItaW5zdGFuY2UuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLWxhdW5jaGVyLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcGFyYW1ldGVycy5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2ItcmVwb3NpdG9yeS9pZGItam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlcG9zaXRvcnkvc2ltcGxlLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi1yZXBvc2l0b3J5L3RpbWVvdXQtam9iLXJlcG9zaXRvcnkuanMiLCJzcmMvam9icy9lbmdpbmUvam9iLXJlc3VsdC5qcyIsInNyYy9qb2JzL2VuZ2luZS9qb2Itc3RhdHVzLmpzIiwic3JjL2pvYnMvZW5naW5lL2pvYi5qcyIsInNyYy9qb2JzL2VuZ2luZS9zaW1wbGUtam9iLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAtZXhlY3V0aW9uLmpzIiwic3JjL2pvYnMvZW5naW5lL3N0ZXAuanMiLCJzcmMvam9icy9pbmRleC5qcyIsInNyYy9qb2JzL2pvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjL2pvYnMvam9iLXdvcmtlci5qcyIsInNyYy9qb2JzL2pvYnMtbWFuYWdlci5qcyIsInNyYy9vYmplY3RpdmUvb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL2V4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9leHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvaW5kZXguanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21heC1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWF4LW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1heC1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9tYXhpLW1pbi1ydWxlLmpzIiwic3JjL29iamVjdGl2ZS9ydWxlcy9taW4tbWF4LXJ1bGUuanMiLCJzcmMvb2JqZWN0aXZlL3J1bGVzL21pbi1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1tYXgtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbWluaS1taW4tcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvbXVsdGktY3JpdGVyaWEtcnVsZS5qcyIsInNyYy9vYmplY3RpdmUvcnVsZXMvb2JqZWN0aXZlLXJ1bGUuanMiLCJzcmMvb3BlcmF0aW9ucy9mbGlwLXN1YnRyZWUuanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb24uanMiLCJzcmMvb3BlcmF0aW9ucy9vcGVyYXRpb25zLW1hbmFnZXIuanMiLCJzcmMvcG9saWNpZXMvZGVjaXNpb24uanMiLCJzcmMvcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yLmpzIiwic3JjL3BvbGljaWVzL3BvbGljeS5qcyIsInNyYy92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyYy92YWxpZGF0aW9uL3BheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi9wcm9iYWJpbGl0eS12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmMvdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvci5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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QixBQUFLLEFBQW1DLFNBQVMsQUFDN0M7eUNBQUEsQUFBaUIsU0FBUyxFQUFDLE1BQUQsQUFBTyxpQkFBaUIsTUFBTSxFQUFDLFVBQVUsSUFBbkUsQUFBMEIsQUFBOEIsQUFBZSxPQUF2RSxBQUE0RSxBQUM1RTswQkFBQSxBQUFFLGlCQUFGLEFBQW1CLE1BQW5CLEFBQXlCLEFBQzVCO0FBQ0o7QUFSRCxBQVdIO0FBM0JELEFBNEJBO2dCQUFJLGdCQUFnQixnQkFBcEIsQUFBMEIsWUFBWSxBQUNsQztvQkFBSSxNQUFBLEFBQU0sbUJBQW1CLENBQUMsZUFBQSxBQUFlLE9BQTdDLEFBQThCLEFBQXNCLElBQUksQUFDcEQ7cUNBQUEsQUFBaUIsU0FBakIsQUFBMEIsNEJBQTFCLEFBQXNELEFBQ3pEO0FBQ0o7QUFHRDs7bUJBQUEsQUFBTyxBQUNWOzs7Ozs7Ozs7Ozs7Ozs7O0FDekVMLDJDQUFBO2lEQUFBOztnQkFBQTt3QkFBQTtvQkFBQTtBQUFBO0FBQUEiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVxdWVzdC5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcmVxdWVzdDtcbiAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG4gICAgICBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcblxuICAgIHAucmVxdWVzdCA9IHJlcXVlc3Q7XG4gICAgcmV0dXJuIHA7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsKSB7XG4gICAgICAgICAgdGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcbiAgICB0aGlzLl9pbmRleCA9IGluZGV4O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ211bHRpRW50cnknLFxuICAgICd1bmlxdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdnZXQnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcbiAgICB0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuICAgICdkaXJlY3Rpb24nLFxuICAgICdrZXknLFxuICAgICdwcmltYXJ5S2V5JyxcbiAgICAndmFsdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuICAgICd1cGRhdGUnLFxuICAgICdkZWxldGUnXG4gIF0pO1xuXG4gIC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG4gIFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcbiAgICBpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGN1cnNvciA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICBmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuICAgIHRoaXMuX3N0b3JlID0gc3RvcmU7XG4gIH1cblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnaW5kZXhOYW1lcycsXG4gICAgJ2F1dG9JbmNyZW1lbnQnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdwdXQnLFxuICAgICdhZGQnLFxuICAgICdkZWxldGUnLFxuICAgICdjbGVhcicsXG4gICAgJ2dldCcsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdkZWxldGVJbmRleCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuICAgIHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgVHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuICAgICdvYmplY3RTdG9yZU5hbWVzJyxcbiAgICAnbW9kZSdcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcbiAgICAnYWJvcnQnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICAgIHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG4gICAgdGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG4gIH1cblxuICBVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnZGVsZXRlT2JqZWN0U3RvcmUnLFxuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gREIoZGIpIHtcbiAgICB0aGlzLl9kYiA9IGRiO1xuICB9XG5cbiAgREIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICAvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuICAvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG4gIFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuICAgIFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZVtmdW5jTmFtZS5yZXBsYWNlKCdvcGVuJywgJ2l0ZXJhdGUnKV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGFyZ3MgPSB0b0FycmF5KGFyZ3VtZW50cyk7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICAgICAgdmFyIG5hdGl2ZU9iamVjdCA9IHRoaXMuX3N0b3JlIHx8IHRoaXMuX2luZGV4O1xuICAgICAgICB2YXIgcmVxdWVzdCA9IG5hdGl2ZU9iamVjdFtmdW5jTmFtZV0uYXBwbHkobmF0aXZlT2JqZWN0LCBhcmdzLnNsaWNlKDAsIC0xKSk7XG4gICAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY2FsbGJhY2socmVxdWVzdC5yZXN1bHQpO1xuICAgICAgICB9O1xuICAgICAgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gcG9seWZpbGwgZ2V0QWxsXG4gIFtJbmRleCwgT2JqZWN0U3RvcmVdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcbiAgICBpZiAoQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCkgcmV0dXJuO1xuICAgIENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwgPSBmdW5jdGlvbihxdWVyeSwgY291bnQpIHtcbiAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICB2YXIgaXRlbXMgPSBbXTtcblxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgaW5zdGFuY2UuaXRlcmF0ZUN1cnNvcihxdWVyeSwgZnVuY3Rpb24oY3Vyc29yKSB7XG4gICAgICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpdGVtcy5wdXNoKGN1cnNvci52YWx1ZSk7XG5cbiAgICAgICAgICBpZiAoY291bnQgIT09IHVuZGVmaW5lZCAmJiBpdGVtcy5sZW5ndGggPT0gY291bnQpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaXRlbXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjdXJzb3IuY29udGludWUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICB2YXIgZXhwID0ge1xuICAgIG9wZW46IGZ1bmN0aW9uKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdvcGVuJywgW25hbWUsIHZlcnNpb25dKTtcbiAgICAgIHZhciByZXF1ZXN0ID0gcC5yZXF1ZXN0O1xuXG4gICAgICByZXF1ZXN0Lm9udXBncmFkZW5lZWRlZCA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmICh1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgICAgICB1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKGRiKSB7XG4gICAgICAgIHJldHVybiBuZXcgREIoZGIpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBkZWxldGU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdkZWxldGVEYXRhYmFzZScsIFtuYW1lXSk7XG4gICAgfVxuICB9O1xuXG4gIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZXhwO1xuICAgIG1vZHVsZS5leHBvcnRzLmRlZmF1bHQgPSBtb2R1bGUuZXhwb3J0cztcbiAgfVxuICBlbHNlIHtcbiAgICBzZWxmLmlkYiA9IGV4cDtcbiAgfVxufSgpKTtcbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJDb25maWd9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5cblxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lQ29uZmlnIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ3tcbiAgICBsb2dMZXZlbCA9ICd3YXJuJztcbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vL0VudHJ5IHBvaW50IGNsYXNzIGZvciBzdGFuZGFsb25lIGNvbXB1dGF0aW9uIHdvcmtlcnNcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmUgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2Vye1xuXG4gICAgZ2xvYmFsID0gVXRpbHMuZ2V0R2xvYmFsT2JqZWN0KCk7XG4gICAgaXNXb3JrZXIgPSBVdGlscy5pc1dvcmtlcigpO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhKXtcbiAgICAgICAgc3VwZXIoY29uZmlnLCBkYXRhKTtcblxuICAgICAgICBpZih0aGlzLmlzV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih7XG4gICAgICAgICAgICAgICAgYmVmb3JlSm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdiZWZvcmVKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICBhZnRlckpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYWZ0ZXJKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICAgICAgdGhpcy5xdWVyeWFibGVGdW5jdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcnVuSm9iOiBmdW5jdGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coam9iTmFtZSwgam9iUGFyYW1ldGVycywgc2VyaWFsaXplZERhdGEpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGV4ZWN1dGVKb2I6IGZ1bmN0aW9uKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuam9ic01hbmdlci5leGVjdXRlKGpvYkV4ZWN1dGlvbklkKS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5yZXBseSgnam9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBVdGlscy5nZXRFcnJvckRUTyhlKSk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZWNvbXB1dGU6IGZ1bmN0aW9uKGRhdGFEVE8sIHJ1bGVOYW1lLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdyZWNvbXB1dGVkJywgZGF0YS5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZ2xvYmFsLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKG9FdmVudCkge1xuICAgICAgICAgICAgICAgIGlmIChvRXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2QnKSAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5xdWVyeWFibGVGdW5jdGlvbnNbb0V2ZW50LmRhdGEucXVlcnlNZXRob2RdLmFwcGx5KHNlbGYsIG9FdmVudC5kYXRhLnF1ZXJ5QXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5kZWZhdWx0UmVwbHkob0V2ZW50LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICBzdXBlci5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5zZXRMb2dMZXZlbCh0aGlzLmNvbmZpZy5sb2dMZXZlbCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNldExvZ0xldmVsKGxldmVsKXtcbiAgICAgICAgbG9nLnNldExldmVsKGxldmVsKVxuICAgIH1cblxuICAgIGRlZmF1bHRSZXBseShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMucmVwbHkoJ3Rlc3QnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXBseSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXBseSAtIG5vdCBlbm91Z2ggYXJndW1lbnRzJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5nbG9iYWwucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlNZXRob2RBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtPYmplY3RpdmVSdWxlc01hbmFnZXJ9IGZyb20gXCIuL29iamVjdGl2ZS9vYmplY3RpdmUtcnVsZXMtbWFuYWdlclwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge09wZXJhdGlvbnNNYW5hZ2VyfSBmcm9tIFwiLi9vcGVyYXRpb25zL29wZXJhdGlvbnMtbWFuYWdlclwiO1xuaW1wb3J0IHtKb2JzTWFuYWdlcn0gZnJvbSBcIi4vam9icy9qb2JzLW1hbmFnZXJcIjtcbmltcG9ydCB7RXhwcmVzc2lvbnNFdmFsdWF0b3J9IGZyb20gXCIuL2V4cHJlc3Npb25zLWV2YWx1YXRvclwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZU1hbmFnZXJ9IGZyb20gXCIuL2pvYnMvam9iLWluc3RhbmNlLW1hbmFnZXJcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7TWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0aW9uL21jZG0td2VpZ2h0LXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyB7XG5cbiAgICBsb2dMZXZlbCA9IG51bGw7XG5cbiAgICBydWxlTmFtZSA9IG51bGw7XG4gICAgd29ya2VyID0ge1xuICAgICAgICBkZWxlZ2F0ZVJlY29tcHV0YXRpb246IGZhbHNlLFxuICAgICAgICB1cmw6IG51bGxcbiAgICB9O1xuICAgIGpvYlJlcG9zaXRvcnlUeXBlID0gJ2lkYic7XG4gICAgY2xlYXJSZXBvc2l0b3J5ID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlciB7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIG9wZXJhdGlvbnNNYW5hZ2VyO1xuICAgIGpvYnNNYW5nZXI7XG5cbiAgICB0cmVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhID0gbnVsbCkge1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLnNldENvbmZpZyhjb25maWcpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBuZXcgRXhwcmVzc2lvbkVuZ2luZSgpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gbmV3IEV4cHJlc3Npb25zRXZhbHVhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gbmV3IE9iamVjdGl2ZVJ1bGVzTWFuYWdlcih0aGlzLmV4cHJlc3Npb25FbmdpbmUsIHRoaXMuY29uZmlnLnJ1bGVOYW1lKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zTWFuYWdlciA9IG5ldyBPcGVyYXRpb25zTWFuYWdlcih0aGlzLmRhdGEsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IG5ldyBKb2JzTWFuYWdlcih0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwge1xuICAgICAgICAgICAgd29ya2VyVXJsOiB0aGlzLmNvbmZpZy53b3JrZXIudXJsLFxuICAgICAgICAgICAgcmVwb3NpdG9yeVR5cGU6IHRoaXMuY29uZmlnLmpvYlJlcG9zaXRvcnlUeXBlLFxuICAgICAgICAgICAgY2xlYXJSZXBvc2l0b3J5OiB0aGlzLmNvbmZpZy5jbGVhclJlcG9zaXRvcnlcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMubWNkbVdlaWdodFZhbHVlVmFsaWRhdG9yID0gbmV3IE1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIHNldENvbmZpZyhjb25maWcpIHtcbiAgICAgICAgdGhpcy5jb25maWcgPSBuZXcgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBnZXRDdXJyZW50UnVsZSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmN1cnJlbnRSdWxlO1xuICAgIH1cblxuICAgIGZsaXBDcml0ZXJpYShkYXRhKXtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBkYXRhLnJldmVyc2VQYXlvZmZzKCk7XG4gICAgICAgIGxldCB0bXAgPSBkYXRhLndlaWdodExvd2VyQm91bmQ7XG4gICAgICAgIGRhdGEud2VpZ2h0TG93ZXJCb3VuZCA9IHRoaXMuZmxpcChkYXRhLndlaWdodFVwcGVyQm91bmQpO1xuICAgICAgICBkYXRhLndlaWdodFVwcGVyQm91bmQgPSB0aGlzLmZsaXAodG1wKTtcbiAgICAgICAgZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCA9IHRoaXMuZmxpcChkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZmxpcFJ1bGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShmYWxzZSk7XG4gICAgfVxuXG4gICAgZmxpcChhKXtcbiAgICAgICAgaWYoYSA9PSBJbmZpbml0eSl7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGEgPT0gMCl7XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBhKSlcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUoam9iTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cbiAgICBydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4obmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhIHx8IHRoaXMuZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpXG4gICAgfVxuXG4gICAgcnVuSm9iV2l0aEluc3RhbmNlTWFuYWdlcihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBKb2JJbnN0YW5jZU1hbmFnZXIodGhpcy5qb2JzTWFuZ2VyLCBqZSwgam9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRPYmplY3RpdmVSdWxlcygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVzO1xuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuZ2V0T2JqZWN0aXZlUnVsZUJ5TmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5pc1J1bGVOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuY29uZmlnLnJ1bGVOYW1lID0gcnVsZU5hbWU7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBvcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zTWFuYWdlci5vcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCk7XG4gICAgfVxuXG4gICAgLyogYWxpYXMgZnVuY3Rpb24gZm9yIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUqL1xuICAgIHJlY29tcHV0ZSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKC4uLmFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuY29uZmlnLndvcmtlci5kZWxlZ2F0ZVJlY29tcHV0YXRpb24pIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFyYW1zID0ge1xuICAgICAgICAgICAgICAgICAgICBldmFsQ29kZTogZXZhbENvZGUsXG4gICAgICAgICAgICAgICAgICAgIGV2YWxOdW1lcmljOiBldmFsTnVtZXJpY1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKCFhbGxSdWxlcykge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbXMucnVsZU5hbWUgPSB0aGlzLmdldEN1cnJlbnRSdWxlKCkubmFtZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucnVuSm9iKFwicmVjb21wdXRlXCIsIHBhcmFtcywgdGhpcy5kYXRhLCBmYWxzZSkudGhlbigoam9iRXhlY3V0aW9uKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBqb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRhdGEudXBkYXRlRnJvbShkKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZSh0aGlzLmRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVEaXNwbGF5VmFsdWVzKHRoaXMuZGF0YSk7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBfY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIudXBkYXRlRGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGF0YS5kZWZhdWx0Q3JpdGVyaW9uMVdlaWdodCk7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZiAoZXZhbENvZGUgfHwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgd2VpZ2h0VmFsaWQgPSB0aGlzLm1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KTtcbiAgICAgICAgdmFyIG11bHRpQ3JpdGVyaWEgPSB0aGlzLmdldEN1cnJlbnRSdWxlKCkubXVsdGlDcml0ZXJpYTtcblxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKHJvb3Q9PiB7XG4gICAgICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KSk7XG4gICAgICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLnB1c2godnIpO1xuICAgICAgICAgICAgaWYgKHZyLmlzVmFsaWQoKSAmJiAoIW11bHRpQ3JpdGVyaWEgfHwgd2VpZ2h0VmFsaWQpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vQ2hlY2tzIHZhbGlkaXR5IG9mIGRhdGEgbW9kZWwgd2l0aG91dCByZWNvbXB1dGF0aW9uIGFuZCByZXZhbGlkYXRpb25cbiAgICBpc1ZhbGlkKGRhdGEpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgcmV0dXJuIGRhdGEudmFsaWRhdGlvblJlc3VsdHMuZXZlcnkodnI9PnZyLmlzVmFsaWQoKSk7XG4gICAgfVxuXG4gICAgdXBkYXRlRGlzcGxheVZhbHVlcyhkYXRhLCBwb2xpY3lUb0Rpc3BsYXkgPSBudWxsKSB7XG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgaWYgKHBvbGljeVRvRGlzcGxheSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheVBvbGljeShkYXRhLCBwb2xpY3lUb0Rpc3BsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG4pO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG5vZGUpIHtcbiAgICAgICAgbm9kZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49Pm5vZGUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldE5vZGVEaXNwbGF5VmFsdWUobm9kZSwgbikpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVFZGdlRGlzcGxheVZhbHVlcyhlKSB7XG4gICAgICAgIGUuJERJU1BMQVlfVkFMVUVfTkFNRVMuZm9yRWFjaChuPT5lLmRpc3BsYXlWYWx1ZShuLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXRFZGdlRGlzcGxheVZhbHVlKGUsIG4pKSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeShwb2xpY3lUb0Rpc3BsYXksIGRhdGEpIHtcblxuXG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICBuLmNsZWFyRGlzcGxheVZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICBlLmNsZWFyRGlzcGxheVZhbHVlcygpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2goKHJvb3QpPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKHJvb3QsIHBvbGljeVRvRGlzcGxheSkpO1xuICAgIH1cblxuICAgIGRpc3BsYXlQb2xpY3lGb3JOb2RlKG5vZGUsIHBvbGljeSkge1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkge1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHBvbGljeSwgbm9kZSk7XG4gICAgICAgICAgICAvL2NvbnNvbGUubG9nKGRlY2lzaW9uLCBub2RlLCBwb2xpY3kpO1xuICAgICAgICAgICAgaWYgKGRlY2lzaW9uKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKVxuICAgICAgICAgICAgICAgIHZhciBjaGlsZEVkZ2UgPSBub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICAgICAgY2hpbGRFZGdlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUoY2hpbGRFZGdlLmNoaWxkTm9kZSwgcG9saWN5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2UgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgbm9kZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheVBvbGljeUZvck5vZGUoZS5jaGlsZE5vZGUsIHBvbGljeSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1lbHNlIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgbm9kZS5kaXNwbGF5VmFsdWUoJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgfVxuXG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuZXhwb3J0IGNsYXNzIENvbXB1dGF0aW9uc1V0aWxze1xuXG4gICAgc3RhdGljIHNlcXVlbmNlKG1pbiwgbWF4LCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGV4dGVudCA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QobWF4LCBtaW4pO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW21pbl07XG4gICAgICAgIHZhciBzdGVwcyA9IGxlbmd0aCAtIDE7XG4gICAgICAgIGlmKCFzdGVwcyl7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoZXh0ZW50LGxlbmd0aCAtIDEpO1xuICAgICAgICB2YXIgY3VyciA9IG1pbjtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGggLSAyOyBpKyspIHtcbiAgICAgICAgICAgIGN1cnIgPSBFeHByZXNzaW9uRW5naW5lLmFkZChjdXJyLCBzdGVwKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChjdXJyKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LnB1c2gobWF4KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tICdzZC11dGlscydcblxuLypFdmFsdWF0ZXMgY29kZSBhbmQgZXhwcmVzc2lvbnMgaW4gdHJlZXMqL1xuZXhwb3J0IGNsYXNzIEV4cHJlc3Npb25zRXZhbHVhdG9yIHtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIGNsZWFyKGRhdGEpe1xuICAgICAgICBkYXRhLm5vZGVzLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgZS5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNsZWFyVHJlZShkYXRhLCByb290KXtcbiAgICAgICAgZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZShyb290KS5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICAgICAgbi5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIGUuY2xlYXJDb21wdXRlZFZhbHVlcygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBldmFsRXhwcmVzc2lvbnMoZGF0YSwgZXZhbENvZGU9dHJ1ZSwgZXZhbE51bWVyaWM9dHJ1ZSwgaW5pdFNjb3Blcz1mYWxzZSl7XG4gICAgICAgIGxvZy5kZWJ1ZygnZXZhbEV4cHJlc3Npb25zIGV2YWxDb2RlOicrZXZhbENvZGUrJyBldmFsTnVtZXJpYzonK2V2YWxOdW1lcmljKTtcbiAgICAgICAgaWYoZXZhbENvZGUpe1xuICAgICAgICAgICAgdGhpcy5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJUcmVlKGRhdGEsIG4pO1xuICAgICAgICAgICAgdGhpcy5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIG4sIGV2YWxDb2RlLCBldmFsTnVtZXJpYyxpbml0U2NvcGVzKTtcbiAgICAgICAgfSk7XG5cbiAgICB9XG5cbiAgICBldmFsR2xvYmFsQ29kZShkYXRhKXtcbiAgICAgICAgZGF0YS5jbGVhckV4cHJlc3Npb25TY29wZSgpO1xuICAgICAgICBkYXRhLiRjb2RlRGlydHkgPSBmYWxzZTtcbiAgICAgICAgdHJ5e1xuICAgICAgICAgICAgZGF0YS4kY29kZUVycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKGRhdGEuY29kZSwgZmFsc2UsIGRhdGEuZXhwcmVzc2lvblNjb3BlKTtcbiAgICAgICAgfWNhdGNoIChlKXtcbiAgICAgICAgICAgIGRhdGEuJGNvZGVFcnJvciA9IGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIG5vZGUsIGV2YWxDb2RlPXRydWUsIGV2YWxOdW1lcmljPXRydWUsIGluaXRTY29wZT1mYWxzZSkge1xuICAgICAgICBpZighbm9kZS5leHByZXNzaW9uU2NvcGUgfHwgaW5pdFNjb3BlIHx8IGV2YWxDb2RlKXtcbiAgICAgICAgICAgIHRoaXMuaW5pdFNjb3BlRm9yTm9kZShkYXRhLCBub2RlKTtcbiAgICAgICAgfVxuICAgICAgICBpZihldmFsQ29kZSl7XG4gICAgICAgICAgICBub2RlLiRjb2RlRGlydHkgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmKG5vZGUuY29kZSl7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICBub2RlLiRjb2RlRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChub2RlLmNvZGUsIGZhbHNlLCBub2RlLmV4cHJlc3Npb25TY29wZSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoIChlKXtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS4kY29kZUVycm9yID0gZTtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmRlYnVnKGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgIHZhciBzY29wZSA9IG5vZGUuZXhwcmVzc2lvblNjb3BlO1xuICAgICAgICAgICAgdmFyIHByb2JhYmlsaXR5U3VtPUV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgICAgICB2YXIgaGFzaEVkZ2VzPSBbXTtcbiAgICAgICAgICAgIHZhciBpbnZhbGlkUHJvYiA9IGZhbHNlO1xuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5wYXlvZmYuZm9yRWFjaCgocmF3UGF5b2ZmLCBwYXlvZmZJbmRleCk9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBwYXRoID0gJ3BheW9mZlsnICsgcGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKHBhdGgsIHRydWUsIGZhbHNlKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsIHBhdGgsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsUGF5b2ZmKGUsIHBheW9mZkluZGV4KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1jYXRjaCAoZXJyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAgIExlZnQgZW1wdHkgaW50ZW50aW9uYWxseVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cblxuXG4gICAgICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpe1xuICAgICAgICAgICAgICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNoRWRnZXMucHVzaChlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKEV4cHJlc3Npb25FbmdpbmUuaGFzQXNzaWdubWVudEV4cHJlc3Npb24oZS5wcm9iYWJpbGl0eSkpeyAvL0l0IHNob3VsZCBub3Qgb2NjdXIgaGVyZSFcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiZXZhbEV4cHJlc3Npb25zRm9yTm9kZSBoYXNBc3NpZ25tZW50RXhwcmVzc2lvbiFcIiwgZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGlmKGUuaXNGaWVsZFZhbGlkKCdwcm9iYWJpbGl0eScsIHRydWUsIGZhbHNlKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByb2IgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbChlLnByb2JhYmlsaXR5LCB0cnVlLCBzY29wZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwcm9iYWJpbGl0eScsIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGludmFsaWRQcm9iID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnZhbGlkUHJvYiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH0pO1xuXG5cbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICB2YXIgY29tcHV0ZUhhc2ggPSBoYXNoRWRnZXMubGVuZ3RoICYmICFpbnZhbGlkUHJvYiAmJiAocHJvYmFiaWxpdHlTdW0uY29tcGFyZSgwKSA+PSAwICYmIHByb2JhYmlsaXR5U3VtLmNvbXBhcmUoMSkgPD0gMCk7XG5cbiAgICAgICAgICAgICAgICBpZihjb21wdXRlSGFzaCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaGFzaCA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoMSwgcHJvYmFiaWxpdHlTdW0pLCBoYXNoRWRnZXMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgaGFzaEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncHJvYmFiaWxpdHknLCBoYXNoKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgdGhpcy5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIGUuY2hpbGROb2RlLCBldmFsQ29kZSwgZXZhbE51bWVyaWMsIGluaXRTY29wZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGluaXRTY29wZUZvck5vZGUoZGF0YSwgbm9kZSl7XG4gICAgICAgIHZhciBwYXJlbnQgPSBub2RlLiRwYXJlbnQ7XG4gICAgICAgIHZhciBwYXJlbnRTY29wZSA9IHBhcmVudD9wYXJlbnQuZXhwcmVzc2lvblNjb3BlIDogZGF0YS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgIG5vZGUuZXhwcmVzc2lvblNjb3BlID0gVXRpbHMuY2xvbmVEZWVwKHBhcmVudFNjb3BlKTtcbiAgICB9XG59XG4iLCJleHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1lbmdpbmUnXG5leHBvcnQgKiBmcm9tICcuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyJ1xuZXhwb3J0ICogZnJvbSAnLi9leHByZXNzaW9ucy1ldmFsdWF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYnMvaW5kZXgnXG5cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgTGVhZ3VlVGFibGVKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIndlaWdodExvd2VyQm91bmRcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsICh2LCBhbGxWYWxzKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdiA+PSAwICYmIHYgPD0gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbihhbGxWYWxzWyd3ZWlnaHRVcHBlckJvdW5kJ10pXG4gICAgICAgIH0pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZGVmYXVsdFdlaWdodFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgKHYsIGFsbFZhbHMpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB2ID49IDAgJiYgdiA+PSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKGFsbFZhbHNbJ3dlaWdodExvd2VyQm91bmQnXSkgJiYgdiA8PSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKGFsbFZhbHNbJ3dlaWdodFVwcGVyQm91bmQnXSlcbiAgICAgICAgfSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJ3ZWlnaHRVcHBlckJvdW5kXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKS5zZXQoXCJzaW5nbGVWYWx1ZVZhbGlkYXRvclwiLCAodiwgYWxsVmFscykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHYgPj0gMCAmJiB2ID49IEpvYlBhcmFtZXRlckRlZmluaXRpb24uY29tcHV0ZU51bWJlckV4cHJlc3Npb24oYWxsVmFsc1snd2VpZ2h0TG93ZXJCb3VuZCddKVxuICAgICAgICB9KSk7XG5cbiAgICB9XG5cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24xOiAnQ29zdCcsXG4gICAgICAgICAgICBuYW1lT2ZDcml0ZXJpb24yOiAnRWZmZWN0JyxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWUsXG4gICAgICAgICAgICB3ZWlnaHRMb3dlckJvdW5kOiAwLFxuICAgICAgICAgICAgZGVmYXVsdFdlaWdodDogMCxcbiAgICAgICAgICAgIHdlaWdodFVwcGVyQm91bmQ6IEluZmluaXR5LFxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0xlYWd1ZVRhYmxlSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vbGVhZ3VlLXRhYmxlLWpvYi1wYXJhbWV0ZXJzXCI7XG5cblxuZXhwb3J0IGNsYXNzIExlYWd1ZVRhYmxlSm9iIGV4dGVuZHMgU2ltcGxlSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJsZWFndWUtdGFibGVcIiwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIHRoaXMuaW5pdFN0ZXBzKCk7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCkge1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgQ2FsY3VsYXRlU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKHRoaXMuY2FsY3VsYXRlU3RlcCk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBMZWFndWVUYWJsZUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycyA9IHRydWUpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICBpZiAod2l0aEhlYWRlcnMpIHtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3lfaWQnLCAncG9saWN5Jywgam9iUmVzdWx0LnBheW9mZk5hbWVzWzBdLCBqb2JSZXN1bHQucGF5b2ZmTmFtZXNbMV0sICdkb21pbmF0ZWRfYnknLCAnZXh0ZW5kZWQtZG9taW5hdGVkX2J5JywgJ2luY3JhdGlvJywgJ29wdGltYWwnLCAnb3B0aW1hbF9mb3JfZGVmYXVsdF93ZWlnaHQnXTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93LnBvbGljaWVzLmZvckVhY2gocG9saWN5PT4ge1xuICAgICAgICAgICAgICAgIHZhciByb3dDZWxscyA9IFtcbiAgICAgICAgICAgICAgICAgICAgcm93LmlkLFxuICAgICAgICAgICAgICAgICAgICBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKSxcbiAgICAgICAgICAgICAgICAgICAgcm93LnBheW9mZnNbMV0sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5wYXlvZmZzWzBdLFxuICAgICAgICAgICAgICAgICAgICByb3cuZG9taW5hdGVkQnksXG4gICAgICAgICAgICAgICAgICAgIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5ID09PSBudWxsID8gbnVsbCA6IHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzBdICsgJywgJyArIHJvdy5leHRlbmRlZERvbWluYXRlZEJ5WzFdLFxuICAgICAgICAgICAgICAgICAgICByb3cuaW5jcmF0aW8sXG4gICAgICAgICAgICAgICAgICAgIHJvdy5vcHRpbWFsLFxuICAgICAgICAgICAgICAgICAgICByb3cub3B0aW1hbEZvckRlZmF1bHRXZWlnaHRcbiAgICAgICAgICAgICAgICBdO1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuY3VycmVudFJ1bGU7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290KTtcblxuICAgICAgICB2YXIgcG9saWNpZXMgPSBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcztcblxuXG4gICAgICAgIHZhciBwYXlvZmZDb2VmZnMgPSB0aGlzLnBheW9mZkNvZWZmcyA9IHJ1bGUucGF5b2ZmQ29lZmZzO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEpO1xuICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuXG4gICAgICAgIGlmICghdnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjb21wYXJlID0gKGEsIGIpPT4oLXBheW9mZkNvZWZmc1swXSAqICAoYi5wYXlvZmZzWzBdIC0gYS5wYXlvZmZzWzBdKSkgfHwgKC1wYXlvZmZDb2VmZnNbMV0gKiAgKGEucGF5b2Zmc1sxXSAtIGIucGF5b2Zmc1sxXSkpO1xuXG4gICAgICAgIHZhciByb3dzID0gcG9saWNpZXMubWFwKHBvbGljeSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IFtwb2xpY3ldLFxuICAgICAgICAgICAgICAgIHBheW9mZnM6IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKS5zbGljZSgpLFxuICAgICAgICAgICAgICAgIGRvbWluYXRlZEJ5OiBudWxsLFxuICAgICAgICAgICAgICAgIGV4dGVuZGVkRG9taW5hdGVkQnk6IG51bGwsXG4gICAgICAgICAgICAgICAgaW5jcmF0aW86IG51bGwsXG4gICAgICAgICAgICAgICAgb3B0aW1hbDogZmFsc2UsXG4gICAgICAgICAgICAgICAgb3B0aW1hbEZvckRlZmF1bHRXZWlnaHQ6IGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgcm93cyA9IHJvd3MucmVkdWNlKChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUsIGluZGV4LCBhcnJheSk9PntcbiAgICAgICAgICAgIGlmKCFwcmV2aW91c1ZhbHVlLmxlbmd0aCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFtjdXJyZW50VmFsdWVdXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBwcmV2ID0gcHJldmlvdXNWYWx1ZVtwcmV2aW91c1ZhbHVlLmxlbmd0aC0xXTtcbiAgICAgICAgICAgIGlmKGNvbXBhcmUocHJldiwgY3VycmVudFZhbHVlKSA9PSAwKXtcbiAgICAgICAgICAgICAgICBwcmV2LnBvbGljaWVzLnB1c2goLi4uY3VycmVudFZhbHVlLnBvbGljaWVzKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJldmlvdXNWYWx1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHByZXZpb3VzVmFsdWUuY29uY2F0KGN1cnJlbnRWYWx1ZSlcbiAgICAgICAgfSwgW10pO1xuXG4gICAgICAgIHJvd3Muc29ydCgoYSwgYik9PihwYXlvZmZDb2VmZnNbMF0gKiAgKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpIHx8ICgtcGF5b2ZmQ29lZmZzWzFdICogICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSkpO1xuICAgICAgICByb3dzLmZvckVhY2goKHIsIGkpPT4ge1xuICAgICAgICAgICAgci5pZCA9IGkrMTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHJvd3Muc29ydChjb21wYXJlKTtcbiAgICAgICAgcm93cy5zb3J0KChhLCBiKT0+KC1wYXlvZmZDb2VmZnNbMF0gKiAgKGEucGF5b2Zmc1swXSAtIGIucGF5b2Zmc1swXSkpIHx8ICgtcGF5b2ZmQ29lZmZzWzFdICogICAoYS5wYXlvZmZzWzFdIC0gYi5wYXlvZmZzWzFdKSkpO1xuXG4gICAgICAgIGxldCBiZXN0Q29zdCA9IC1wYXlvZmZDb2VmZnNbMV0gKiBJbmZpbml0eSxcbiAgICAgICAgICAgIGJlc3RDb3N0Um93ID0gbnVsbDtcblxuICAgICAgICBsZXQgY21wPSAoYSwgYikgPT4gYSA+IGI7XG4gICAgICAgIGlmKHBheW9mZkNvZWZmc1sxXTwwKXtcbiAgICAgICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICB9XG5cbiAgICAgICAgcm93cy5mb3JFYWNoKChyLCBpKT0+IHtcbiAgICAgICAgICAgIGlmIChjbXAoci5wYXlvZmZzWzFdLCBiZXN0Q29zdCkpIHtcbiAgICAgICAgICAgICAgICBiZXN0Q29zdCA9IHIucGF5b2Zmc1sxXTtcbiAgICAgICAgICAgICAgICBiZXN0Q29zdFJvdyA9IHI7XG4gICAgICAgICAgICB9IGVsc2UgaWYoYmVzdENvc3RSb3cpIHtcbiAgICAgICAgICAgICAgICByLmRvbWluYXRlZEJ5ID0gYmVzdENvc3RSb3cuaWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNtcD0gKGEsIGIpID0+IGEgPCBiO1xuICAgICAgICBpZihwYXlvZmZDb2VmZnNbMF0gPiAwICYmIHBheW9mZkNvZWZmc1sxXSA8IDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA8IGI7XG4gICAgICAgIH1lbHNlIGlmKHBheW9mZkNvZWZmc1swXSA8IDAgJiYgcGF5b2ZmQ29lZmZzWzFdID4gMCl7XG4gICAgICAgICAgICBjbXA9IChhLCBiKSA9PiBhIDwgYjtcbiAgICAgICAgfWVsc2UgaWYocGF5b2ZmQ29lZmZzWzFdPDApe1xuICAgICAgICAgICAgY21wPSAoYSwgYikgPT4gYSA+IGI7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJldjJOb3REb21pbmF0ZWQgPSBudWxsO1xuICAgICAgICByb3dzLmZpbHRlcihyPT4hci5kb21pbmF0ZWRCeSkuc29ydCgoYSwgYik9PiggIHBheW9mZkNvZWZmc1swXSAqIChhLnBheW9mZnNbMF0gLSBiLnBheW9mZnNbMF0pKSkuZm9yRWFjaCgociwgaSwgYXJyKT0+IHtcbiAgICAgICAgICAgIGlmIChpID09IDApIHtcbiAgICAgICAgICAgICAgICByLmluY3JhdGlvID0gMDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBwcmV2ID0gYXJyW2kgLSAxXTtcblxuICAgICAgICAgICAgci5pbmNyYXRpbyA9IHRoaXMuY29tcHV0ZUlDRVIociwgcHJldik7XG4gICAgICAgICAgICBpZiAoaSA8IDIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKCFwcmV2Mk5vdERvbWluYXRlZCl7XG4gICAgICAgICAgICAgICAgcHJldjJOb3REb21pbmF0ZWQgPSBhcnJbaSAtIDJdO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihjbXAoci5pbmNyYXRpbyxwcmV2LmluY3JhdGlvKSl7XG4gICAgICAgICAgICAgICAgcHJldi5pbmNyYXRpbyA9IG51bGw7XG4gICAgICAgICAgICAgICAgcHJldi5leHRlbmRlZERvbWluYXRlZEJ5ID0gW3ByZXYyTm90RG9taW5hdGVkLmlkLCByLmlkXSA7XG4gICAgICAgICAgICAgICAgci5pbmNyYXRpbyA9IHRoaXMuY29tcHV0ZUlDRVIociwgcHJldjJOb3REb21pbmF0ZWQpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgcHJldjJOb3REb21pbmF0ZWQgPSBwcmV2O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgd2VpZ2h0TG93ZXJCb3VuZCA9IHBhcmFtcy52YWx1ZShcIndlaWdodExvd2VyQm91bmRcIik7XG4gICAgICAgIGxldCBkZWZhdWx0V2VpZ2h0ID0gcGFyYW1zLnZhbHVlKFwiZGVmYXVsdFdlaWdodFwiKTtcbiAgICAgICAgbGV0IHdlaWdodFVwcGVyQm91bmQgPSBwYXJhbXMudmFsdWUoXCJ3ZWlnaHRVcHBlckJvdW5kXCIpO1xuXG4gICAgICAgIC8vbWFyayBvcHRpbWFsIGZvciB3ZWlnaHQgaW4gW3dlaWdodExvd2VyQm91bmQsIHdlaWdodFVwcGVyQm91bmRdIGFuZCBvcHRpbWFsIGZvciBkZWZhdWx0IFdlaWdodFxuICAgICAgICBsZXQgbGFzdExFTG93ZXIgPSBudWxsO1xuICAgICAgICBsZXQgbGFzdExFTG93ZXJEZWYgPSBudWxsO1xuICAgICAgICByb3dzLnNsaWNlKCkuZmlsdGVyKHI9PiFyLmRvbWluYXRlZEJ5ICYmICFyLmV4dGVuZGVkRG9taW5hdGVkQnkpLnNvcnQoKGEsIGIpID0+IGEuaW5jcmF0aW8gLSBiLmluY3JhdGlvKS5mb3JFYWNoKChyb3csIGksIGFycik9PntcblxuICAgICAgICAgICAgaWYocm93LmluY3JhdGlvIDwgd2VpZ2h0TG93ZXJCb3VuZCl7XG4gICAgICAgICAgICAgICAgbGFzdExFTG93ZXIgID0gcm93O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocm93LmluY3JhdGlvIDwgZGVmYXVsdFdlaWdodCl7XG4gICAgICAgICAgICAgICAgbGFzdExFTG93ZXJEZWYgID0gcm93O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb3cub3B0aW1hbCA9IHJvdy5pbmNyYXRpbyA+PSB3ZWlnaHRMb3dlckJvdW5kICYmIHJvdy5pbmNyYXRpbyA8PSB3ZWlnaHRVcHBlckJvdW5kO1xuICAgICAgICAgICAgcm93Lm9wdGltYWxGb3JEZWZhdWx0V2VpZ2h0ID0gcm93LmluY3JhdGlvID09IGRlZmF1bHRXZWlnaHQ7XG5cbiAgICAgICAgfSk7XG4gICAgICAgIGlmKGxhc3RMRUxvd2VyKXtcbiAgICAgICAgICAgIGxhc3RMRUxvd2VyLm9wdGltYWwgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobGFzdExFTG93ZXJEZWYpe1xuICAgICAgICAgICAgbGFzdExFTG93ZXJEZWYub3B0aW1hbEZvckRlZmF1bHRXZWlnaHQgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcm93cy5mb3JFYWNoKHJvdz0+e1xuICAgICAgICAgICAgcm93LnBheW9mZnNbMF0gPSAgRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5wYXlvZmZzWzBdKTtcbiAgICAgICAgICAgIHJvdy5wYXlvZmZzWzFdID0gIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChyb3cucGF5b2Zmc1sxXSk7XG4gICAgICAgICAgICByb3cuaW5jcmF0aW8gPSByb3cuaW5jcmF0aW8gPT09IG51bGwgPyBudWxsIDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHJvdy5pbmNyYXRpbyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhID0ge1xuICAgICAgICAgICAgcGF5b2ZmTmFtZXM6IGRhdGEucGF5b2ZmTmFtZXMuc2xpY2UoKSxcbiAgICAgICAgICAgIHBheW9mZkNvZWZmcyA6IHBheW9mZkNvZWZmcyxcbiAgICAgICAgICAgIHJvd3M6IHJvd3Muc29ydCgoYSwgYik9PihhLmlkIC0gYi5pZCkpLFxuICAgICAgICAgICAgd2VpZ2h0TG93ZXJCb3VuZDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHdlaWdodExvd2VyQm91bmQpLFxuICAgICAgICAgICAgZGVmYXVsdFdlaWdodDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KGRlZmF1bHRXZWlnaHQpLFxuICAgICAgICAgICAgd2VpZ2h0VXBwZXJCb3VuZDogRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHdlaWdodFVwcGVyQm91bmQpXG4gICAgICAgIH07XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNvbXB1dGVJQ0VSKHIsIHByZXYpe1xuICAgICAgICBsZXQgZCA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzBdLCBwcmV2LnBheW9mZnNbMF0pO1xuICAgICAgICBsZXQgbiA9IEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3Qoci5wYXlvZmZzWzFdLCBwcmV2LnBheW9mZnNbMV0pO1xuICAgICAgICBpZiAoZCA9PSAwKXtcbiAgICAgICAgICAgIGlmKG48MCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC0gSW5maW5pdHk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gSW5maW5pdHk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE1hdGguYWJzKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKG4sIGQpKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDApKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXZhbENvZGVcIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsTnVtZXJpY1wiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIHJ1bGVOYW1lOiBudWxsLCAvL3JlY29tcHV0ZSBhbGwgcnVsZXNcbiAgICAgICAgICAgIGV2YWxDb2RlOiB0cnVlLFxuICAgICAgICAgICAgZXZhbE51bWVyaWM6IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9yZWNvbXB1dGUtam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYlwiO1xuXG5leHBvcnQgY2xhc3MgUmVjb21wdXRlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJyZWNvbXB1dGVcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuaXNSZXN0YXJ0YWJsZSA9IGZhbHNlO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGRhdGEgPSBleGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnM7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgYWxsUnVsZXMgPSAhcnVsZU5hbWU7XG4gICAgICAgIGlmKHJ1bGVOYW1lKXtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIHBhcmFtcy52YWx1ZShcImV2YWxDb2RlXCIpLCBwYXJhbXMudmFsdWUoXCJldmFsTnVtZXJpY1wiKSlcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICB9XG5cbiAgICBjaGVja1ZhbGlkaXR5QW5kUmVjb21wdXRlT2JqZWN0aXZlKGRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cyA9IFtdO1xuXG4gICAgICAgIGlmKGV2YWxDb2RlfHxldmFsTnVtZXJpYyl7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gocm9vdD0+IHtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpKTtcbiAgICAgICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMucHVzaCh2cik7XG4gICAgICAgICAgICBpZiAodnIuaXNWYWxpZCgpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUmVjb21wdXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZhaWxPbkludmFsaWRUcmVlXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDIpLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDwgdltcIm1heFwiXSxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtQcmVwYXJlVmFyaWFibGVzU3RlcH0gZnJvbSBcIi4vc3RlcHMvcHJlcGFyZS12YXJpYWJsZXMtc3RlcFwiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9pbml0LXBvbGljaWVzLXN0ZXBcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4vc3RlcHMvY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cblxuZXhwb3J0IGNsYXNzIFNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgYmF0Y2hTaXplPTUpIHtcbiAgICAgICAgc3VwZXIoXCJzZW5zaXRpdml0eS1hbmFseXNpc1wiLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgdGhpcy5iYXRjaFNpemUgPSA1O1xuICAgICAgICB0aGlzLmluaXRTdGVwcygpO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpe1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcCh0aGlzLmpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVTdGVwID0gbmV3IENhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFNlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gZGF0YS5nZXRSb290cygpLmxlbmd0aCA9PT0gMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc2V0QmF0Y2hTaXplKGJhdGNoU2l6ZSl7XG4gICAgICAgIHRoaXMuYmF0Y2hTaXplID0gYmF0Y2hTaXplO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAuY2h1bmtTaXplID0gYmF0Y2hTaXplO1xuICAgIH1cblxuICAgIGpvYlJlc3VsdFRvQ3N2Um93cyhqb2JSZXN1bHQsIGpvYlBhcmFtZXRlcnMsIHdpdGhIZWFkZXJzPXRydWUpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGlmKHdpdGhIZWFkZXJzKXtcbiAgICAgICAgICAgIHZhciBoZWFkZXJzID0gWydwb2xpY3lfbnVtYmVyJywgJ3BvbGljeSddO1xuICAgICAgICAgICAgam9iUmVzdWx0LnZhcmlhYmxlTmFtZXMuZm9yRWFjaChuPT5oZWFkZXJzLnB1c2gobikpO1xuICAgICAgICAgICAgaGVhZGVycy5wdXNoKCdwYXlvZmYnKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGhlYWRlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJvdW5kVmFyaWFibGVzID0gISFqb2JQYXJhbWV0ZXJzLnZhbHVlcy5yb3VuZFZhcmlhYmxlcztcbiAgICAgICAgaWYocm91bmRWYXJpYWJsZXMpe1xuICAgICAgICAgICAgdGhpcy5yb3VuZFZhcmlhYmxlcyhqb2JSZXN1bHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgdmFyIHBvbGljeSA9IGpvYlJlc3VsdC5wb2xpY2llc1tyb3cucG9saWN5SW5kZXhdO1xuICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW3Jvdy5wb2xpY3lJbmRleCsxLCBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKV07XG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2godj0+IHJvd0NlbGxzLnB1c2godikpO1xuICAgICAgICAgICAgcm93Q2VsbHMucHVzaChyb3cucGF5b2ZmKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcblxuICAgICAgICAgICAgaWYocm93Ll92YXJpYWJsZXMpeyAvL3JldmVydCBvcmlnaW5hbCB2YXJpYWJsZXNcbiAgICAgICAgICAgICAgICByb3cudmFyaWFibGVzID0gcm93Ll92YXJpYWJsZXM7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHJvdy5fdmFyaWFibGVzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJvdW5kVmFyaWFibGVzKGpvYlJlc3VsdCl7XG4gICAgICAgIHZhciB1bmlxdWVWYWx1ZXMgPSBqb2JSZXN1bHQudmFyaWFibGVOYW1lcy5tYXAoKCk9Pm5ldyBTZXQoKSk7XG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgcm93Ll92YXJpYWJsZXMgPSByb3cudmFyaWFibGVzLnNsaWNlKCk7IC8vIHNhdmUgb3JpZ2luYWwgcm93IHZhcmlhYmxlc1xuICAgICAgICAgICAgcm93LnZhcmlhYmxlcy5mb3JFYWNoKCh2LGkpPT4ge1xuICAgICAgICAgICAgICAgIHVuaXF1ZVZhbHVlc1tpXS5hZGQodilcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgdW5pcXVlVmFsdWVzTm8gPSB1bmlxdWVWYWx1ZXMubWFwKChzKT0+cy5zaXplKTtcbiAgICAgICAgdmFyIG1heFByZWNpc2lvbiA9IDE0O1xuICAgICAgICB2YXIgcHJlY2lzaW9uID0gMjtcbiAgICAgICAgdmFyIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcyA9IGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLm1hcCgodixpKT0+aSk7XG4gICAgICAgIHdoaWxlKHByZWNpc2lvbjw9bWF4UHJlY2lzaW9uICYmIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdW5pcXVlVmFsdWVzID0gbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzLm1hcCgoKT0+bmV3IFNldCgpKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2gocm93ID0+IHtcbiAgICAgICAgICAgICAgICBub3RSZWFkeVZhcmlhYmxlc0luZGV4ZXMuZm9yRWFjaCgodmFyaWFibGVJbmRleCwgbm90UmVhZHlJbmRleCk9PntcblxuICAgICAgICAgICAgICAgICAgICB2YXIgdmFsID0gcm93Ll92YXJpYWJsZXNbdmFyaWFibGVJbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHZhbCA9IFV0aWxzLnJvdW5kKHZhbCwgcHJlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlVmFsdWVzW25vdFJlYWR5SW5kZXhdLmFkZCh2YWwpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJvdy52YXJpYWJsZXNbdmFyaWFibGVJbmRleF0gPSB2YWw7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgbmV3UmVhZHlJbmRleGVzID0gW107XG4gICAgICAgICAgICB1bmlxdWVWYWx1ZXMuZm9yRWFjaCgodW5pcXVlVmFscywgbm90UmVhZHlJbmRleCk9PntcbiAgICAgICAgICAgICAgICB2YXIgb3JpZ1VuaXF1ZUNvdW50ID0gdW5pcXVlVmFsdWVzTm9bbm90UmVhZHlWYXJpYWJsZXNJbmRleGVzW25vdFJlYWR5SW5kZXhdXSA7XG4gICAgICAgICAgICAgICAgaWYob3JpZ1VuaXF1ZUNvdW50PT11bmlxdWVWYWxzLnNpemUpeyAvL3JlYWR5IGluIHByZXZpb3VzIGl0ZXJhdGlvblxuICAgICAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMucHVzaChub3RSZWFkeUluZGV4KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmKG5ld1JlYWR5SW5kZXhlcy5sZW5ndGgpIHsgLy9yZXZlcnQgdmFsdWVzIHRvIHByZXYgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgbmV3UmVhZHlJbmRleGVzLnJldmVyc2UoKTtcbiAgICAgICAgICAgICAgICBuZXdSZWFkeUluZGV4ZXMuZm9yRWFjaChub3RSZWFkeUluZGV4PT57XG4gICAgICAgICAgICAgICAgICAgIG5vdFJlYWR5VmFyaWFibGVzSW5kZXhlcy5zcGxpY2Uobm90UmVhZHlJbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHByZWNpc2lvbisrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzJdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1syXSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSkge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cblxuICAgICAgICBpZiAoIWpvYlJlc3VsdC5kYXRhLnJvd3MpIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MgPSBbXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMgPSB2YXJpYWJsZU5hbWVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0pIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgdmFyIGZhaWxPbkludmFsaWRUcmVlID0gcGFyYW1zLnZhbHVlKFwiZmFpbE9uSW52YWxpZFRyZWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2YXJpYWJsZU5hbWUsIGkpPT4ge1xuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IGl0ZW1baV07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG5cbiAgICAgICAgdmFyIHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgIGlmKCF2YWxpZCAmJiBmYWlsT25JbnZhbGlkVHJlZSl7XG4gICAgICAgICAgICBsZXQgZXJyb3JEYXRhID0ge1xuICAgICAgICAgICAgICAgIHZhcmlhYmxlczoge31cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2goKHZhcmlhYmxlTmFtZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1t2YXJpYWJsZU5hbWVdID0gaXRlbVtpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkNvbXB1dGF0aW9uRXhjZXB0aW9uKFwiY29tcHV0YXRpb25zXCIsIGVycm9yRGF0YSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwYXlvZmZzID0gW107XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaChwb2xpY3k9PiB7XG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gJ24vYSc7XG4gICAgICAgICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSwgcG9saWN5KTtcbiAgICAgICAgICAgICAgICBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJylbMF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXlvZmZzLnB1c2gocGF5b2ZmKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgIHZhcmlhYmxlczogaXRlbSxcbiAgICAgICAgICAgIHBheW9mZnM6IHBheW9mZnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbiA9IHBhcmFtcy52YWx1ZShcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIik7XG5cbiAgICAgICAgaXRlbXMuZm9yRWFjaChpdGVtPT4ge1xuICAgICAgICAgICAgaWYgKCFpdGVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXRlbS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksIGkpPT4ge1xuICAgICAgICAgICAgICAgIHZhciB2YXJpYWJsZXMgPSBpdGVtLnZhcmlhYmxlcy5tYXAodiA9PiB0aGlzLnRvRmxvYXQodikpO1xuXG4gICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGl0ZW0ucGF5b2Zmc1tpXTtcbiAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICBwb2xpY3lJbmRleDogaSxcbiAgICAgICAgICAgICAgICAgICAgdmFyaWFibGVzOiB2YXJpYWJsZXMsXG4gICAgICAgICAgICAgICAgICAgIHBheW9mZjogVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSA/IHBheW9mZiA6IHRoaXMudG9GbG9hdChwYXlvZmYpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2gocm93KTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGRlbGV0ZSBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZVZhbHVlcztcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuXG5leHBvcnQgY2xhc3MgSW5pdFBvbGljaWVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJpbml0X3BvbGljaWVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcbiAgICAgICAgdmFyIHRyZWVSb290ID0gZGF0YS5nZXRSb290cygpWzBdO1xuICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QpO1xuXG4gICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY2llc1wiLCBwb2xpY2llcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhKXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhPXt9XG4gICAgICAgIH1cblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcyA9IHBvbGljaWVzO1xuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNVdGlsc30gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NvbXB1dGF0aW9ucy11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJlcGFyZVZhcmlhYmxlc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uRW5naW5lKSB7XG4gICAgICAgIHN1cGVyKFwicHJlcGFyZV92YXJpYWJsZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG5cbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gW107XG4gICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKENvbXB1dGF0aW9uc1V0aWxzLnNlcXVlbmNlKHYubWluLCB2Lm1heCwgdi5sZW5ndGgpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhcmlhYmxlVmFsdWVzID0gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGE9e1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXM6IHZhcmlhYmxlVmFsdWVzXG4gICAgICAgIH07XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb25cIiwgUEFSQU1FVEVSX1RZUEUuQk9PTEVBTikpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJudW1iZXJPZlJ1bnNcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID4gMCkpO1xuXG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmb3JtdWxhXCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUl9FWFBSRVNTSU9OKVxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIHZhbHVlcyA9PiBVdGlscy5pc1VuaXF1ZSh2YWx1ZXMsIHY9PnZbXCJuYW1lXCJdKSAvL1ZhcmlhYmxlIG5hbWVzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgKSlcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi4vbi13YXkvc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuLi9uLXdheS9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7UHJvYkNhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL3Byb2ItY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Q29tcHV0ZVBvbGljeVN0YXRzU3RlcH0gZnJvbSBcIi4vc3RlcHMvY29tcHV0ZS1wb2xpY3ktc3RhdHMtc3RlcFwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZT01KSB7XG4gICAgICAgIHN1cGVyKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGJhdGNoU2l6ZSk7XG4gICAgICAgIHRoaXMubmFtZSA9IFwicHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1wiO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpIHtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZVN0ZXAgPSBuZXcgUHJvYkNhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5iYXRjaFNpemUpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAodGhpcy5jYWxjdWxhdGVTdGVwKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDb21wdXRlUG9saWN5U3RhdHNTdGVwKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pIHtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1sxXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMV0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nLCBVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvc3RlcFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjbGFzcyBDb21wdXRlUG9saWN5U3RhdHNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwiY29tcHV0ZV9wb2xpY3lfc3RhdHNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICBsZXQgcnVsZSA9IHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuXG5cbiAgICAgICAgdmFyIHBheW9mZnNQZXJQb2xpY3kgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5tYXAoKCk9PltdKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLmZvckVhY2gocm93PT4ge1xuICAgICAgICAgICAgcGF5b2Zmc1BlclBvbGljeVtyb3cucG9saWN5SW5kZXhdLnB1c2goVXRpbHMuaXNTdHJpbmcocm93LnBheW9mZikgPyAwIDogcm93LnBheW9mZilcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9nLmRlYnVnKCdwYXlvZmZzUGVyUG9saWN5JywgcGF5b2Zmc1BlclBvbGljeSwgam9iUmVzdWx0LmRhdGEucm93cy5sZW5ndGgsIHJ1bGUubWF4aW1pemF0aW9uKTtcblxuICAgICAgICBqb2JSZXN1bHQuZGF0YS5tZWRpYW5zID0gcGF5b2Zmc1BlclBvbGljeS5tYXAocGF5b2Zmcz0+RXhwcmVzc2lvbkVuZ2luZS5tZWRpYW4ocGF5b2ZmcykpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5zdGFuZGFyZERldmlhdGlvbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLnN0ZChwYXlvZmZzKSk7XG5cbiAgICAgICAgaWYgKHJ1bGUubWF4aW1pemF0aW9uKSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLmRpdmlkZSh2LCBudW1iZXJPZlJ1bnMpKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lJc0Jlc3RQcm9iYWJpbGl0aWVzID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHYsIG51bWJlck9mUnVucykpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50ID0gam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodikpO1xuXG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4uLy4uL24td2F5L3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge0pvYkNvbXB1dGF0aW9uRXhjZXB0aW9ufSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2V4Y2VwdGlvbnMvam9iLWNvbXB1dGF0aW9uLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYkNhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBDYWxjdWxhdGVTdGVwIHtcblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhLnJvd3Mpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcyA9IFV0aWxzLmZpbGwobmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCksIDApO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQgPSBVdGlscy5maWxsKG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgfVxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICBmb3IodmFyIHJ1bkluZGV4PTA7IHJ1bkluZGV4PGNodW5rU2l6ZTsgcnVuSW5kZXgrKyl7XG4gICAgICAgICAgICB2YXIgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgICAgIHZhciBlcnJvcnMgPSBbXTtcbiAgICAgICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICB2YXIgZXZhbHVhdGVkID0gdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5leHByZXNzaW9uRW5naW5lLmV2YWwodi5mb3JtdWxhLCB0cnVlLCBVdGlscy5jbG9uZURlZXAoZGF0YS5leHByZXNzaW9uU2NvcGUpKTtcbiAgICAgICAgICAgICAgICAgICAgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZXZhbHVhdGVkKSk7XG4gICAgICAgICAgICAgICAgfWNhdGNoKGUpe1xuICAgICAgICAgICAgICAgICAgICBlcnJvcnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZTogdixcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZihlcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGVycm9yRGF0YSA9IHt2YXJpYWJsZXM6IFtdfTtcbiAgICAgICAgICAgICAgICBlcnJvcnMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgICAgIGVycm9yRGF0YS52YXJpYWJsZXNbZS52YXJpYWJsZS5uYW1lXSA9IGUuZXJyb3IubWVzc2FnZTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJwYXJhbS1jb21wdXRhdGlvblwiLCBlcnJvckRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHNpbmdsZVJ1blZhcmlhYmxlVmFsdWVzKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgciA9IHN1cGVyLnByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgbnVtYmVyT2ZSdW5zID0gcGFyYW1zLnZhbHVlKFwibnVtYmVyT2ZSdW5zXCIpO1xuICAgICAgICB2YXIgcG9saWNpZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJwb2xpY2llc1wiKTtcblxuICAgICAgICB0aGlzLnVwZGF0ZVBvbGljeVN0YXRzKHIsIHBvbGljaWVzLCBudW1iZXJPZlJ1bnMsIGpvYlJlc3VsdCk7XG5cbiAgICAgICAgcmV0dXJuIHI7XG4gICAgfVxuXG4gICAgdXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KXtcbiAgICAgICAgdmFyIGhpZ2hlc3RQYXlvZmYgPSAtSW5maW5pdHk7XG4gICAgICAgIHZhciBsb3dlc3RQYXlvZmYgPSBJbmZpbml0eTtcbiAgICAgICAgdmFyIGJlc3RQb2xpY3lJbmRleGVzID0gW107XG4gICAgICAgIHZhciB3b3JzdFBvbGljeUluZGV4ZXMgPSBbXTtcblxuICAgICAgICB2YXIgemVyb051bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaCgocG9saWN5LGkpPT57XG4gICAgICAgICAgICBsZXQgcGF5b2ZmID0gci5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgaWYoVXRpbHMuaXNTdHJpbmcocGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgcGF5b2ZmID0gemVyb051bTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA8IGxvd2VzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgbG93ZXN0UGF5b2ZmID0gcGF5b2ZmO1xuICAgICAgICAgICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcyA9IFtpXTtcbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMobG93ZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHBheW9mZiA+IGhpZ2hlc3RQYXlvZmYpe1xuICAgICAgICAgICAgICAgIGhpZ2hlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMgPSBbaV1cbiAgICAgICAgICAgIH1lbHNlIGlmKHBheW9mZi5lcXVhbHMoaGlnaGVzdFBheW9mZikpe1xuICAgICAgICAgICAgICAgIGJlc3RQb2xpY3lJbmRleGVzLnB1c2goaSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXNbaV0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocGF5b2ZmLCBudW1iZXJPZlJ1bnMpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBiZXN0UG9saWN5SW5kZXhlcy5sZW5ndGgpKVxuICAgICAgICB9KTtcblxuICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMuZm9yRWFjaChwb2xpY3lJbmRleD0+e1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSwgRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUoMSwgd29yc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzID0gam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMubWFwKHY9PnRoaXMudG9GbG9hdCh2KSk7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBTcGlkZXJQbG90Sm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInBlcmNlbnRhZ2VDaGFuZ2VSYW5nZVwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+IDAgJiYgdiA8PTEwMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDApKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge1NwaWRlclBsb3RKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi9zcGlkZXItcGxvdC1qb2ItcGFyYW1ldGVyc1wiO1xuXG5leHBvcnQgY2xhc3MgU3BpZGVyUGxvdEpvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwic3BpZGVyLXBsb3RcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgQ2FsY3VsYXRlU3RlcChqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTcGlkZXJQbG90Sm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzBdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1swXSk7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycywgd2l0aEhlYWRlcnM9dHJ1ZSl7XG5cbiAgICAgICAgbGV0IHJlc3VsdCA9IFtdO1xuICAgICAgICBpZih3aXRoSGVhZGVycyl7XG4gICAgICAgICAgICByZXN1bHQucHVzaChbJ3ZhcmlhYmxlX25hbWUnLCAncG9saWN5X25vJ10uY29uY2F0KGpvYlJlc3VsdC5wZXJjZW50YWdlUmFuZ2VWYWx1ZXMpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5yb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcblxuICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4ucm93LnBheW9mZnMubWFwKChwYXlvZmZzLCBwb2xpY3lJbmRleCk9PltcbiAgICAgICAgICAgICAgICByb3cudmFyaWFibGVOYW1lLFxuICAgICAgICAgICAgICAgIHBvbGljeUluZGV4KzEsXG4gICAgICAgICAgICAgICAgLi4ucGF5b2Zmc1xuICAgICAgICAgICAgXSkpO1xuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbn0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9leGNlcHRpb25zL2pvYi1jb21wdXRhdGlvbi1leGNlcHRpb25cIjtcbmltcG9ydCB7QmF0Y2hTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL2JhdGNoL2JhdGNoLXN0ZXBcIjtcbmltcG9ydCB7VHJlZVZhbGlkYXRvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc1V0aWxzfSBmcm9tIFwiLi4vLi4vLi4vLi4vLi4vY29tcHV0YXRpb25zLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBDYWxjdWxhdGVTdGVwIGV4dGVuZHMgQmF0Y2hTdGVwIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoXCJjYWxjdWxhdGVfc3RlcFwiLCBqb2JSZXBvc2l0b3J5LCAxKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICAgICAgdGhpcy50cmVlVmFsaWRhdG9yID0gbmV3IFRyZWVWYWxpZGF0b3IoKTtcbiAgICB9XG5cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBsZXQgam9iRXhlY3V0aW9uQ29udGV4dCA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICBsZXQgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIGxldCBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICBsZXQgcGVyY2VudGFnZUNoYW5nZVJhbmdlID0gcGFyYW1zLnZhbHVlKFwicGVyY2VudGFnZUNoYW5nZVJhbmdlXCIpO1xuICAgICAgICBsZXQgbGVuZ3RoID0gcGFyYW1zLnZhbHVlKFwibGVuZ3RoXCIpO1xuICAgICAgICBsZXQgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuXG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIikubWFwKHY9PnYubmFtZSk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJ2YXJpYWJsZU5hbWVzXCIsIHZhcmlhYmxlTmFtZXMpO1xuICAgICAgICBsZXQgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuXG4gICAgICAgIGxldCB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgbGV0IHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9ucyhkYXRhKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSk7XG5cbiAgICAgICAgbGV0IHBvbGljaWVzQ29sbGVjdG9yID0gbmV3IFBvbGljaWVzQ29sbGVjdG9yKHRyZWVSb290LCBydWxlTmFtZSk7XG5cbiAgICAgICAgbGV0IGRlZmF1bHRWYWx1ZXMgPSB7fTtcbiAgICAgICAgVXRpbHMuZm9yT3duKGRhdGEuZXhwcmVzc2lvblNjb3BlLCAodixrKT0+e1xuICAgICAgICAgICAgZGVmYXVsdFZhbHVlc1trXT10aGlzLnRvRmxvYXQodik7XG4gICAgICAgIH0pO1xuXG5cbiAgICAgICAgbGV0IHBlcmNlbnRhZ2VSYW5nZVZhbHVlcyA9IENvbXB1dGF0aW9uc1V0aWxzLnNlcXVlbmNlKC1wZXJjZW50YWdlQ2hhbmdlUmFuZ2UsIHBlcmNlbnRhZ2VDaGFuZ2VSYW5nZSwgMipsZW5ndGgrMSk7XG5cbiAgICAgICAgbGV0IHZhcmlhYmxlVmFsdWVzID0gW107XG5cbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIGxldCBkZWZWYWwgPSBkZWZhdWx0VmFsdWVzW3YubmFtZV07XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlcy5wdXNoKHBlcmNlbnRhZ2VSYW5nZVZhbHVlcy5tYXAocD0+IHRoaXMudG9GbG9hdChFeHByZXNzaW9uRW5naW5lLmFkZChkZWZWYWwsIEV4cHJlc3Npb25FbmdpbmUubXVsdGlwbHkoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocCwxMDApLCBkZWZWYWwpKSkpKTtcbiAgICAgICAgfSk7XG5cblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEgPSB7XG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lczogdmFyaWFibGVOYW1lcyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWVzOiBkZWZhdWx0VmFsdWVzLFxuICAgICAgICAgICAgICAgIHBlcmNlbnRhZ2VSYW5nZVZhbHVlczogcGVyY2VudGFnZVJhbmdlVmFsdWVzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRQYXlvZmY6IHRoaXMudG9GbG9hdChwYXlvZmYpWzBdLFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICByb3dzOiBbXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInZhcmlhYmxlVmFsdWVzXCIsIHZhcmlhYmxlVmFsdWVzKTtcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplKSB7XG4gICAgICAgIGxldCB2YXJpYWJsZVZhbHVlcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgaXRlbUluZGV4LCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbGV0IHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICBsZXQgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcbiAgICAgICAgbGV0IGZhaWxPbkludmFsaWRUcmVlID0gcGFyYW1zLnZhbHVlKFwiZmFpbE9uSW52YWxpZFRyZWVcIik7XG4gICAgICAgIGxldCBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIGxldCB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgbGV0IHZhcmlhYmxlTmFtZSA9IHZhcmlhYmxlTmFtZXNbaXRlbUluZGV4XTtcblxuXG4gICAgICAgIGxldCBwYXlvZmZzID0gam9iUmVzdWx0LmRhdGEucG9saWNpZXMubWFwKHBvbGljeT0+W10pO1xuXG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG5cblxuICAgICAgICBpdGVtLmZvckVhY2godmFyaWFibGVWYWx1ZT0+e1xuXG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgICAgIGxldCB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG4gICAgICAgICAgICBsZXQgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgICAgIGlmKCF2YWxpZCAmJiBmYWlsT25JbnZhbGlkVHJlZSl7XG4gICAgICAgICAgICAgICAgbGV0IGVycm9yRGF0YSA9IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyaWFibGVzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgZXJyb3JEYXRhLnZhcmlhYmxlc1t2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JDb21wdXRhdGlvbkV4Y2VwdGlvbihcImNvbXB1dGF0aW9uc1wiLCBlcnJvckRhdGEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSwgcG9saWN5SW5kZXgpPT57XG4gICAgICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UsIHBvbGljeSk7XG4gICAgICAgICAgICAgICAgbGV0IHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKVswXTtcbiAgICAgICAgICAgICAgICBwYXlvZmZzW3BvbGljeUluZGV4XS5wdXNoKHRoaXMudG9GbG9hdChwYXlvZmYpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWU6IHZhcmlhYmxlTmFtZSxcbiAgICAgICAgICAgIHZhcmlhYmxlSW5kZXg6IGl0ZW1JbmRleCxcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzOiBpdGVtLFxuICAgICAgICAgICAgcGF5b2ZmczogcGF5b2Zmc1xuICAgICAgICB9O1xuXG4gICAgfVxuXG4gICAgd3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBpdGVtcywgam9iUmVzdWx0KSB7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaCguLi5pdGVtcyk7XG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7Sm9iQ29tcHV0YXRpb25FeGNlcHRpb259IGZyb20gXCIuLi8uLi8uLi8uLi9lbmdpbmUvZXhjZXB0aW9ucy9qb2ItY29tcHV0YXRpb24tZXhjZXB0aW9uXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIEJhdGNoU3RlcCB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSwgMSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbGV0IGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgbGV0IHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICBsZXQgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIGxldCB2YXJpYWJsZVZhbHVlcyA9IGpvYkV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVWYWx1ZXNcIik7XG4gICAgICAgIGxldCB2YXJpYWJsZU5hbWVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpLm1hcCh2PT52Lm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwidmFyaWFibGVOYW1lc1wiLCB2YXJpYWJsZU5hbWVzKTtcbiAgICAgICAgbGV0IGRhdGEgPSBzdGVwRXhlY3V0aW9uLmdldERhdGEoKTtcblxuICAgICAgICBsZXQgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIGxldCBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJyk7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnMoZGF0YSk7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucmVjb21wdXRlVHJlZSh0cmVlUm9vdCwgZmFsc2UpO1xuXG5cblxuICAgICAgICBsZXQgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QsIHJ1bGVOYW1lKTtcblxuICAgICAgICBsZXQgZGVmYXVsdFZhbHVlcyA9IHt9O1xuICAgICAgICBVdGlscy5mb3JPd24oZGF0YS5leHByZXNzaW9uU2NvcGUsICh2LGspPT57XG4gICAgICAgICAgICBkZWZhdWx0VmFsdWVzW2tdPXRoaXMudG9GbG9hdCh2KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhKXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhID0ge1xuICAgICAgICAgICAgICAgIHZhcmlhYmxlTmFtZXM6IHZhcmlhYmxlTmFtZXMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlczogZGVmYXVsdFZhbHVlcyxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZUV4dGVudHM6IHZhcmlhYmxlVmFsdWVzLm1hcCh2PT5bdlswXSwgdlt2Lmxlbmd0aC0xXV0pLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRQYXlvZmY6IHRoaXMudG9GbG9hdChwYXlvZmYpWzBdLFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llc0NvbGxlY3Rvci5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICByb3dzOiBbXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5sZW5ndGg7XG4gICAgfVxuXG5cbiAgICByZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIHN0YXJ0SW5kZXgsIGNodW5rU2l6ZSkge1xuICAgICAgICBsZXQgdmFyaWFibGVWYWx1ZXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5nZXQoXCJ2YXJpYWJsZVZhbHVlc1wiKTtcbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyBjaHVua1NpemUpO1xuICAgIH1cblxuICAgIHByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGl0ZW1JbmRleCwgam9iUmVzdWx0KSB7XG4gICAgICAgIGxldCBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgbGV0IHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIGxldCBmYWlsT25JbnZhbGlkVHJlZSA9IHBhcmFtcy52YWx1ZShcImZhaWxPbkludmFsaWRUcmVlXCIpO1xuICAgICAgICBsZXQgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICBsZXQgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIGxldCB2YXJpYWJsZU5hbWVzID0gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlTmFtZXNcIik7XG4gICAgICAgIGxldCB2YXJpYWJsZU5hbWUgPSB2YXJpYWJsZU5hbWVzW2l0ZW1JbmRleF07XG5cbiAgICAgICAgbGV0IGV4dGVudHMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5tYXAocG9saWN5PT57XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG1pbjogSW5maW5pdHksXG4gICAgICAgICAgICAgICAgbWF4OiAtSW5maW5pdHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLm1hcChwb2xpY3k9PntcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgbWluOiBudWxsLFxuICAgICAgICAgICAgICAgIG1heDogbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmNsZWFyKGRhdGEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG5cbiAgICAgICAgaXRlbS5mb3JFYWNoKHZhcmlhYmxlVmFsdWU9PntcblxuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IHZhcmlhYmxlVmFsdWU7XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCB0cmVlUm9vdCk7XG4gICAgICAgICAgICBsZXQgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuICAgICAgICAgICAgbGV0IHZhbGlkID0gdnIuaXNWYWxpZCgpO1xuXG4gICAgICAgICAgICBpZighdmFsaWQgJiYgZmFpbE9uSW52YWxpZFRyZWUpe1xuICAgICAgICAgICAgICAgIGxldCBlcnJvckRhdGEgPSB7XG4gICAgICAgICAgICAgICAgICAgIHZhcmlhYmxlczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGVycm9yRGF0YS52YXJpYWJsZXNbdmFyaWFibGVOYW1lXSA9IHZhcmlhYmxlVmFsdWU7XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24oXCJjb21wdXRhdGlvbnNcIiwgZXJyb3JEYXRhKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5mb3JFYWNoKChwb2xpY3ksIHBvbGljeUluZGV4KT0+e1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgICAgIGxldCBwYXlvZmYgPSB0cmVlUm9vdC5jb21wdXRlZFZhbHVlKHJ1bGVOYW1lLCAncGF5b2ZmJylbMF07XG5cbiAgICAgICAgICAgICAgICBpZihwYXlvZmYgPCBleHRlbnRzW3BvbGljeUluZGV4XS5taW4pe1xuICAgICAgICAgICAgICAgICAgICBleHRlbnRzW3BvbGljeUluZGV4XS5taW4gPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlc1twb2xpY3lJbmRleF0ubWluID0gdmFyaWFibGVWYWx1ZVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmKHBheW9mZiA+IGV4dGVudHNbcG9saWN5SW5kZXhdLm1heCl7XG4gICAgICAgICAgICAgICAgICAgIGV4dGVudHNbcG9saWN5SW5kZXhdLm1heCA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVzW3BvbGljeUluZGV4XS5tYXggPSB2YXJpYWJsZVZhbHVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhcmlhYmxlTmFtZTogdmFyaWFibGVOYW1lLFxuICAgICAgICAgICAgdmFyaWFibGVJbmRleDogaXRlbUluZGV4LFxuICAgICAgICAgICAgZXh0ZW50czogZXh0ZW50cy5tYXAoZT0+W3RoaXMudG9GbG9hdChlLm1pbiksIHRoaXMudG9GbG9hdChlLm1heCldKSxcbiAgICAgICAgICAgIGV4dGVudFZhcmlhYmxlVmFsdWVzOiB2YWx1ZXMubWFwKHY9Plt0aGlzLnRvRmxvYXQodi5taW4pLCB0aGlzLnRvRmxvYXQodi5tYXgpXSlcbiAgICAgICAgfTtcblxuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2goLi4uaXRlbXMpO1xuICAgIH1cblxuICAgIHBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnNvcnQoKGEsIGIpPT4oYi5leHRlbnRzWzBdWzFdLWIuZXh0ZW50c1swXVswXSktKGEuZXh0ZW50c1swXVsxXS1hLmV4dGVudHNbMF1bMF0pKVxuXG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtDb21wdXRhdGlvbnNVdGlsc30gZnJvbSBcIi4uLy4uLy4uLy4uLy4uL2NvbXB1dGF0aW9ucy11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJlcGFyZVZhcmlhYmxlc1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHN1cGVyKFwicHJlcGFyZV92YXJpYWJsZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgdmFyaWFibGVzID0gcGFyYW1zLnZhbHVlKFwidmFyaWFibGVzXCIpO1xuXG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICB2YXJpYWJsZXMuZm9yRWFjaCh2PT4ge1xuICAgICAgICAgICAgdmFyaWFibGVWYWx1ZXMucHVzaChDb21wdXRhdGlvbnNVdGlscy5zZXF1ZW5jZSh2Lm1pbiwgdi5tYXgsIHYubGVuZ3RoKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJ2YXJpYWJsZVZhbHVlc1wiLCB2YXJpYWJsZVZhbHVlcyk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cblxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgVG9ybmFkb0RpYWdyYW1Kb2JQYXJhbWV0ZXJzIGV4dGVuZHMgSm9iUGFyYW1ldGVycyB7XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKSB7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImlkXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMSwgMSwgdHJ1ZSkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJydWxlTmFtZVwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDApLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDw9IHZbXCJtYXhcIl0sXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJmYWlsT25JbnZhbGlkVHJlZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGZhaWxPbkludmFsaWRUcmVlOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0NhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5pbXBvcnQge1Rvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vdG9ybmFkby1kaWFncmFtLWpvYi1wYXJhbWV0ZXJzXCI7XG5cbmV4cG9ydCBjbGFzcyBUb3JuYWRvRGlhZ3JhbUpvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwidG9ybmFkby1kaWFncmFtXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByZXBhcmVWYXJpYWJsZXNTdGVwKGpvYlJlcG9zaXRvcnkpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDYWxjdWxhdGVTdGVwKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICB9XG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKHZhbHVlcykge1xuICAgICAgICByZXR1cm4gbmV3IFRvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVycyh2YWx1ZXMpO1xuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IGRhdGEuZ2V0Um9vdHMoKS5sZW5ndGggPT09IDFcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuXG4gICAgICAgIGlmIChleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoIDw9IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICAgICAgY3VycmVudDogMFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBzWzFdLmdldFByb2dyZXNzKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1sxXSk7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycywgd2l0aEhlYWRlcnM9dHJ1ZSl7XG4gICAgICAgIGxldCByZXN1bHQgPSBbXTtcbiAgICAgICAgaWYod2l0aEhlYWRlcnMpe1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goWyd2YXJpYWJsZV9uYW1lJywgJ2RlZmF1bHRfdmFyX3ZhbHVlJywgXCJtaW5fdmFyX3ZhbHVlXCIsIFwibWF4X3Zhcl92YWx1ZVwiLCAnZGVmYXVsdF9wYXlvZmYnLCBcIm1pbl9wYXlvZmZcIiwgXCJtYXhfcGF5b2ZmXCIsIFwicG9saWN5X25vXCJdKTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaCgocm93LCBpbmRleCkgPT4ge1xuXG4gICAgICAgICAgICByZXN1bHQucHVzaCguLi5yb3cuZXh0ZW50cy5tYXAoKGV4dGVudCwgcG9saWN5SW5kZXgpPT5bXG4gICAgICAgICAgICAgICAgcm93LnZhcmlhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGVmYXVsdFZhbHVlc1tyb3cudmFyaWFibGVOYW1lXSxcbiAgICAgICAgICAgICAgICByb3cuZXh0ZW50VmFyaWFibGVWYWx1ZXNbcG9saWN5SW5kZXhdWzBdLFxuICAgICAgICAgICAgICAgIHJvdy5leHRlbnRWYXJpYWJsZVZhbHVlc1twb2xpY3lJbmRleF1bMV0sXG4gICAgICAgICAgICAgICAgam9iUmVzdWx0LmRlZmF1bHRQYXlvZmYsXG4gICAgICAgICAgICAgICAgZXh0ZW50WzBdLFxuICAgICAgICAgICAgICAgIGV4dGVudFsxXSxcbiAgICAgICAgICAgICAgICBwb2xpY3lJbmRleCsxXG4gICAgICAgICAgICBdKSk7XG5cbiAgICAgICAgfSk7XG5cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uL3N0ZXBcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcblxuLypqb2Igc3RlcCB0aGF0IHByb2Nlc3MgYmF0Y2ggb2YgaXRlbXMqL1xuZXhwb3J0IGNsYXNzIEJhdGNoU3RlcCBleHRlbmRzIFN0ZXAge1xuXG4gICAgY2h1bmtTaXplO1xuICAgIHN0YXRpYyBDVVJSRU5UX0lURU1fQ09VTlRfUFJPUCA9ICdiYXRjaF9zdGVwX2N1cnJlbnRfaXRlbV9jb3VudCc7XG4gICAgc3RhdGljIFRPVEFMX0lURU1fQ09VTlRfUFJPUCA9ICdiYXRjaF9zdGVwX3RvdGFsX2l0ZW1fY291bnQnO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgY2h1bmtTaXplKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIGpvYlJlcG9zaXRvcnkpO1xuICAgICAgICB0aGlzLmNodW5rU2l6ZSA9IGNodW5rU2l6ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcGVyZm9ybSBzdGVwIGluaXRpYWxpemF0aW9uLiBTaG91bGQgcmV0dXJuIHRvdGFsIGl0ZW0gY291bnRcbiAgICAgKi9cbiAgICBpbml0KHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5pbml0IGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHJlYWQgYW5kIHJldHVybiBjaHVuayBvZiBpdGVtcyB0byBwcm9jZXNzXG4gICAgICovXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyBcIkJhdGNoU3RlcC5yZWFkTmV4dENodW5rIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHByb2Nlc3Mgc2luZ2xlIGl0ZW1cbiAgICAgKiBNdXN0IHJldHVybiBwcm9jZXNzZWQgaXRlbSB3aGljaCB3aWxsIGJlIHBhc3NlZCBpbiBhIGNodW5rIHRvIHdyaXRlQ2h1bmsgZnVuY3Rpb25cbiAgICAgKi9cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAucHJvY2Vzc0l0ZW0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBzdGVwOiBcIiArIHRoaXMubmFtZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gd3JpdGUgY2h1bmsgb2YgaXRlbXMuIE5vdCByZXF1aXJlZFxuICAgICAqL1xuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwZXJmb3JtIHBvc3Rwcm9jZXNzaW5nIGFmdGVyIGFsbCBpdGVtcyBoYXZlIGJlZW4gcHJvY2Vzc2VkLiBOb3QgcmVxdWlyZWRcbiAgICAgKi9cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cblxuICAgIHNldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGNvdW50KSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoQmF0Y2hTdGVwLlRPVEFMX0lURU1fQ09VTlRfUFJPUCwgY291bnQpO1xuICAgIH1cblxuICAgIGdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoQmF0Y2hTdGVwLlRPVEFMX0lURU1fQ09VTlRfUFJPUCk7XG4gICAgfVxuXG4gICAgc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjb3VudCkge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KEJhdGNoU3RlcC5DVVJSRU5UX0lURU1fQ09VTlRfUFJPUCwgY291bnQpO1xuICAgIH1cblxuICAgIGdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmdldChCYXRjaFN0ZXAuQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1ApIHx8IDA7XG4gICAgfVxuXG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gaW5pdGlhbGl6ZSBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9KS50aGVuKHRvdGFsSXRlbUNvdW50PT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICB0aGlzLnNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIHRvdGFsSXRlbUNvdW50KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBpZighKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikpe1xuICAgICAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gaGFuZGxlIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnBvc3RQcm9jZXNzKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHBvc3RQcm9jZXNzIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBoYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBjdXJyZW50SXRlbUNvdW50ID0gdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB2YXIgdG90YWxJdGVtQ291bnQgPSB0aGlzLmdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB2YXIgY2h1bmtTaXplID0gTWF0aC5taW4odGhpcy5jaHVua1NpemUsIHRvdGFsSXRlbUNvdW50IC0gY3VycmVudEl0ZW1Db3VudCk7XG4gICAgICAgIGlmIChjdXJyZW50SXRlbUNvdW50ID49IHRvdGFsSXRlbUNvdW50KSB7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0pvYkV4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiBzb21lb25lIGlzIHRyeWluZyB0byBzdG9wIHVzXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi50ZXJtaW5hdGVPbmx5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgY3VycmVudEl0ZW1Db3VudCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byByZWFkIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KS50aGVuKGNodW5rPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgY2h1bmssIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHByb2Nlc3MgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbihwcm9jZXNzZWRDaHVuaz0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud3JpdGVDaHVuayhzdGVwRXhlY3V0aW9uLCBwcm9jZXNzZWRDaHVuaywgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gd3JpdGUgY2h1bmsgKFwiICsgY3VycmVudEl0ZW1Db3VudCArIFwiLFwiICsgY2h1bmtTaXplICsgXCIpIGluIGJhdGNoIHN0ZXA6IFwiICsgdGhpcy5uYW1lLCBlKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkudGhlbigocmVzKT0+IHtcbiAgICAgICAgICAgIGN1cnJlbnRJdGVtQ291bnQgKz0gY2h1bmtTaXplO1xuICAgICAgICAgICAgdGhpcy5zZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIGN1cnJlbnRJdGVtQ291bnQpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlSm9iUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbikudGhlbigoKT0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVOZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByb2Nlc3NDaHVuayhzdGVwRXhlY3V0aW9uLCBjaHVuaywgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7IC8vVE9ETyBwcm9taXNpZnlcbiAgICAgICAgcmV0dXJuIGNodW5rLm1hcCgoaXRlbSwgaSk9PnRoaXMucHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCtpLCBqb2JSZXN1bHQpKTtcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IHRoaXMuZ2V0VG90YWxJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiksXG4gICAgICAgICAgICBjdXJyZW50OiB0aGlzLmdldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZUpvYlByb2dyZXNzKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIHByb2dyZXNzID0gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKS5nZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQsIHByb2dyZXNzKTtcbiAgICB9XG5cbiAgICBjaGVja0pvYkV4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkJ5TmFtZShzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKS5jaGVja0V4ZWN1dGlvbkZsYWdzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uKTtcbiAgICB9XG59XG4iLCJleHBvcnQgY2xhc3MgRXh0ZW5kYWJsZUVycm9yIHtcbiAgICBkYXRhO1xuICAgIGNvbnN0cnVjdG9yKG1lc3NhZ2UsIGRhdGEpIHtcbiAgICAgICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5uYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIH1cbn1cbiIsImV4cG9ydCAqIGZyb20gJy4vZXh0ZW5kYWJsZS1lcnJvcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWluc3RhbmNlLWFscmVhZHktY29tcGxldGUtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXJlc3RhcnQtZXhjZXB0aW9uJ1xuXG5cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iQ29tcHV0YXRpb25FeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUmVzdGFydEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEV4ZWN1dGlvbkNvbnRleHQge1xuXG4gICAgZGlydHkgPSBmYWxzZTtcbiAgICBjb250ZXh0ID0ge307XG5cbiAgICBjb25zdHJ1Y3Rvcihjb250ZXh0KSB7XG4gICAgICAgIGlmIChjb250ZXh0KSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRleHQgPSBVdGlscy5jbG9uZShjb250ZXh0KVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHV0KGtleSwgdmFsdWUpIHtcbiAgICAgICAgdmFyIHByZXZWYWx1ZSA9IHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IHRoaXMuY29udGV4dFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlID09IG51bGwgfHwgcHJldlZhbHVlICE9IG51bGwgJiYgcHJldlZhbHVlICE9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICAgICAgdGhpcy5kaXJ0eSA9IHByZXZWYWx1ZSAhPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb250ZXh0W2tleV07XG4gICAgfVxuXG4gICAgY29udGFpbnNLZXkoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoa2V5KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBzZXREYXRhKGRhdGEpIHsgLy9zZXQgZGF0YSBtb2RlbFxuICAgICAgICByZXR1cm4gdGhpcy5wdXQoXCJkYXRhXCIsIGRhdGEpO1xuICAgIH1cblxuICAgIGdldERhdGEoKSB7IC8vIGdldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLmdldChcImRhdGFcIik7XG4gICAgfVxuXG4gICAgZ2V0RFRPKCkge1xuICAgICAgICB2YXIgZHRvID0gVXRpbHMuY2xvbmVEZWVwKHRoaXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHRoaXMuZ2V0RGF0YSgpO1xuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgZGF0YSA9IGRhdGEuZ2V0RFRPKCk7XG4gICAgICAgICAgICBkdG8uY29udGV4dFtcImRhdGFcIl0gPSBkYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG59XG4iLCJpbXBvcnQgKiBhcyBleGNlcHRpb25zIGZyb20gJy4vZXhjZXB0aW9ucydcblxuZXhwb3J0IHtleGNlcHRpb25zfVxuZXhwb3J0ICogZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCdcbmV4cG9ydCAqIGZyb20gJy4vam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWZsYWcnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tbGlzdGVuZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnN0YW5jZSdcbmV4cG9ydCAqIGZyb20gJy4vam9iLWtleS1nZW5lcmF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1sYXVuY2hlcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlci1kZWZpbml0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycydcbmV4cG9ydCAqIGZyb20gJy4vam9iLXN0YXR1cydcbmV4cG9ydCAqIGZyb20gJy4vc2ltcGxlLWpvYidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcCdcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyJ1xuXG5cblxuXG4iLCJleHBvcnQgY29uc3QgSk9CX0VYRUNVVElPTl9GTEFHID0ge1xuICAgIFNUT1A6ICdTVE9QJ1xufTtcbiIsImV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG4gICAgLypDYWxsZWQgYmVmb3JlIGEgam9iIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgam9iLiBDYWxsZWQgYWZ0ZXIgYm90aCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgZXhlY3V0aW9ucyovXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBleGVjdXRpb24gb2YgYSBqb2IuKi9cbmV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb24ge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGpvYlBhcmFtZXRlcnM7XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLlVOS05PV047XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG5cbiAgICBzdGFydFRpbWUgPSBudWxsO1xuICAgIGNyZWF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycywgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVycyA9IGpvYlBhcmFtZXRlcnM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBzdGVwIGV4ZWN1dGlvbiB3aXRoIHRoZSBjdXJyZW50IGpvYiBleGVjdXRpb24uXG4gICAgICogQHBhcmFtIHN0ZXBOYW1lIHRoZSBuYW1lIG9mIHRoZSBzdGVwIHRoZSBuZXcgZXhlY3V0aW9uIGlzIGFzc29jaWF0ZWQgd2l0aFxuICAgICAqL1xuICAgIGNyZWF0ZVN0ZXBFeGVjdXRpb24oc3RlcE5hbWUpIHtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb24gPSBuZXcgU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSwgdGhpcyk7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgaXNSdW5uaW5nKCkge1xuICAgICAgICByZXR1cm4gIXRoaXMuZW5kVGltZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXN0IGlmIHRoaXMgSm9iRXhlY3V0aW9uIGhhcyBiZWVuIHNpZ25hbGxlZCB0b1xuICAgICAqIHN0b3AuXG4gICAgICovXG4gICAgaXNTdG9wcGluZygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNpZ25hbCB0aGUgSm9iRXhlY3V0aW9uIHRvIHN0b3AuXG4gICAgICovXG4gICAgc3RvcCgpIHtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHNlPT4ge1xuICAgICAgICAgICAgc2UudGVybWluYXRlT25seSA9IHRydWU7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgfVxuXG4gICAgZ2V0RFRPKGZpbHRlcmVkUHJvcGVydGllcyA9IFtdLCBkZWVwQ2xvbmUgPSB0cnVlKSB7XG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmICghZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJlZFByb3BlcnRpZXMuaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKFtcImpvYlBhcmFtZXRlcnNcIiwgXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBVdGlscy5nZXRFcnJvckRUTyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCIvKiBvYmplY3QgcmVwcmVzZW50aW5nIGEgdW5pcXVlbHkgaWRlbnRpZmlhYmxlIGpvYiBydW4uIEpvYkluc3RhbmNlIGNhbiBiZSByZXN0YXJ0ZWQgbXVsdGlwbGUgdGltZXMgaW4gY2FzZSBvZiBleGVjdXRpb24gZmFpbHVyZSBhbmQgaXQncyBsaWZlY3ljbGUgZW5kcyB3aXRoIGZpcnN0IHN1Y2Nlc3NmdWwgZXhlY3V0aW9uKi9cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZXtcblxuICAgIGlkO1xuICAgIGpvYk5hbWU7XG4gICAgY29uc3RydWN0b3IoaWQsIGpvYk5hbWUpe1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMuam9iTmFtZSA9IGpvYk5hbWU7XG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBKb2JLZXlHZW5lcmF0b3Ige1xuICAgIC8qTWV0aG9kIHRvIGdlbmVyYXRlIHRoZSB1bmlxdWUga2V5IHVzZWQgdG8gaWRlbnRpZnkgYSBqb2IgaW5zdGFuY2UuKi9cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0gXCJcIjtcbiAgICAgICAgam9iUGFyYW1ldGVycy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcbiAgICAgICAgICAgIGlmKGQuaWRlbnRpZnlpbmcpe1xuICAgICAgICAgICAgICAgIHJlc3VsdCArPSBkLm5hbWUgKyBcIj1cIiArIGpvYlBhcmFtZXRlcnMudmFsdWVzW2QubmFtZV0gKyBcIjtcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgSm9iTGF1bmNoZXIge1xuXG4gICAgam9iUmVwb3NpdG9yeTtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBqb2JXb3JrZXIsIGRhdGFNb2RlbFNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBqb2JXb3JrZXI7XG4gICAgICAgIHRoaXMuZGF0YU1vZGVsU2VyaWFsaXplciA9IGRhdGFNb2RlbFNlcmlhbGl6ZXI7XG4gICAgfVxuXG5cbiAgICBydW4oam9iT3JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgdmFyIGpvYjtcbiAgICAgICAgdmFyIGpvYlBhcmFtZXRlcnM7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAoVXRpbHMuaXNTdHJpbmcoam9iT3JOYW1lKSkge1xuICAgICAgICAgICAgICAgIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iT3JOYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBqb2IgPSBqb2JPck5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iT3JOYW1lKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpO1xuICAgICAgICB9KS50aGVuKHZhbGlkPT57XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmNyZWF0ZUpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycywgZGF0YSkudGhlbihqb2JFeGVjdXRpb249PntcblxuXG4gICAgICAgICAgICAgICAgaWYodGhpcy5qb2JXb3JrZXIpe1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2I6IFtcIiArIGpvYi5uYW1lICsgXCJdIGV4ZWN1dGlvbiBbXCIram9iRXhlY3V0aW9uLmlkK1wiXSBkZWxlZ2F0ZWQgdG8gd29ya2VyXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYldvcmtlci5leGVjdXRlSm9iKGpvYkV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvblByb21pc2UgPSB0aGlzLl9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICBpZihyZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Qcm9taXNlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iLm5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4obGFzdEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGxhc3RFeGVjdXRpb24gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGlmICgham9iLmlzUmVzdGFydGFibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgbm90IHJlc3RhcnRhYmxlXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGxhc3RFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuVU5LTk9XTikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJTdGVwIFtcIiArIGV4ZWN1dGlvbi5zdGVwTmFtZSArIFwiXSBpcyBvZiBzdGF0dXMgVU5LTk9XTlwiKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICFqb2Iuam9iUGFyYW1ldGVyc1ZhbGlkYXRvci52YWxpZGF0ZShqb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihqb2Iuam9iRGF0YVZhbGlkYXRvciAmJiAham9iLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZGF0YSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICAvKipFeGVjdXRlIHByZXZpb3VzbHkgY3JlYXRlZCBqb2IgZXhlY3V0aW9uKi9cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpe1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICBpZihVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIH0pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZigham9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb25PcklkICsgXCJdIGlzIG5vdCBmb3VuZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuU1RBUlRJTkcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb24uaWQgKyBcIl0gYWxyZWFkeSBzdGFydGVkXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgam9iTmFtZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lO1xuICAgICAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgICAgICBpZigham9iKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIk5vIHN1Y2ggam9iOiBcIiArIGpvYk5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gIHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIF9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGpvYk5hbWUgPSBqb2IubmFtZTtcbiAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gbGF1bmNoZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpO1xuICAgICAgICByZXR1cm4gam9iLmV4ZWN1dGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gY29tcGxldGVkIHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXSBhbmQgdGhlIGZvbGxvd2luZyBzdGF0dXM6IFtcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIl1cIik7XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICB9KS5jYXRjaChlID0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGZhaWxlZCB1bmV4cGVjdGVkbHkgYW5kIGZhdGFsbHkgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5cbmV4cG9ydCBjb25zdCBQQVJBTUVURVJfVFlQRSA9IHtcbiAgICBTVFJJTkc6ICdTVFJJTkcnLFxuICAgIERBVEU6ICdEQVRFJyxcbiAgICBJTlRFR0VSOiAnSU5URUdFUicsXG4gICAgTlVNQkVSOiAnRkxPQVQnLFxuICAgIEJPT0xFQU46ICdCT09MRUFOJyxcbiAgICBOVU1CRVJfRVhQUkVTU0lPTjogJ05VTUJFUl9FWFBSRVNTSU9OJyxcbiAgICBDT01QT1NJVEU6ICdDT01QT1NJVEUnIC8vY29tcG9zaXRlIHBhcmFtZXRlciB3aXRoIG5lc3RlZCBzdWJwYXJhbWV0ZXJzXG59O1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbiB7XG4gICAgbmFtZTtcbiAgICB0eXBlO1xuICAgIG5lc3RlZFBhcmFtZXRlcnMgPSBbXTtcbiAgICBtaW5PY2N1cnM7XG4gICAgbWF4T2NjdXJzO1xuICAgIHJlcXVpcmVkID0gdHJ1ZTtcblxuICAgIGlkZW50aWZ5aW5nO1xuICAgIHZhbGlkYXRvcjtcbiAgICBzaW5nbGVWYWx1ZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucywgbWluT2NjdXJzID0gMSwgbWF4T2NjdXJzID0gMSwgaWRlbnRpZnlpbmcgPSBmYWxzZSwgc2luZ2xlVmFsdWVWYWxpZGF0b3IgPSBudWxsLCB2YWxpZGF0b3IgPSBudWxsKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIGlmIChVdGlscy5pc0FycmF5KHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucykpIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURTtcbiAgICAgICAgICAgIHRoaXMubmVzdGVkUGFyYW1ldGVycyA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnZhbGlkYXRvciA9IHZhbGlkYXRvcjtcbiAgICAgICAgdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvciA9IHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuICAgICAgICB0aGlzLmlkZW50aWZ5aW5nID0gaWRlbnRpZnlpbmc7XG4gICAgICAgIHRoaXMubWluT2NjdXJzID0gbWluT2NjdXJzO1xuICAgICAgICB0aGlzLm1heE9jY3VycyA9IG1heE9jY3VycztcbiAgICB9XG5cbiAgICBzZXQoa2V5LCB2YWwpIHtcbiAgICAgICAgdGhpc1trZXldID0gdmFsO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSwgYWxsVmFsdWVzKSB7XG4gICAgICAgIHZhciBpc0FycmF5ID0gVXRpbHMuaXNBcnJheSh2YWx1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMubWF4T2NjdXJzID4gMSAmJiAhaXNBcnJheSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFpc0FycmF5KSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVNpbmdsZVZhbHVlKHZhbHVlLCBhbGxWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUubGVuZ3RoIDwgdGhpcy5taW5PY2N1cnMgfHwgdmFsdWUubGVuZ3RoID4gdGhpcy5tYXhPY2N1cnMpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdmFsdWUuZXZlcnkodj0+dGhpcy52YWxpZGF0ZVNpbmdsZVZhbHVlKHYsIHZhbHVlKSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnZhbGlkYXRvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yKHZhbHVlLCBhbGxWYWx1ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgc3RhdGljIGNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbCl7XG4gICAgICAgIGxldCBwYXJzZWQgPSBwYXJzZUZsb2F0KHZhbCk7XG4gICAgICAgIGlmKHBhcnNlZCA9PT0gSW5maW5pdHkgfHwgcGFyc2VkID09PSAtSW5maW5pdHkpIHtcbiAgICAgICAgICAgIHJldHVybiBwYXJzZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZighRXhwcmVzc2lvbkVuZ2luZS52YWxpZGF0ZSh2YWwsIHt9LCBmYWxzZSkpe1xuICAgICAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLmV2YWwodmFsLCB0cnVlKVxuICAgIH1cblxuICAgIC8vIGFsbFZhbHVlcyAtIGFsbCB2YWx1ZXMgb24gdGhlIHNhbWUgbGV2ZWxcbiAgICB2YWxpZGF0ZVNpbmdsZVZhbHVlKHZhbHVlLCBhbGxWYWx1ZXMpIHtcblxuICAgICAgICBpZiAoKCF2YWx1ZSAmJiB2YWx1ZSAhPT0gMCAmJiB2YWx1ZSAhPT0gZmFsc2UpICYmIHRoaXMubWluT2NjdXJzID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICF0aGlzLnJlcXVpcmVkXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuU1RSSU5HID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzU3RyaW5nKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5EQVRFID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuSU5URUdFUiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0ludCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuTlVNQkVSID09PSB0aGlzLnR5cGUgJiYgIVV0aWxzLmlzTnVtYmVyKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4gPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNCb29sZWFuKHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cblxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04gPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgdmFsdWUgPSBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLmNvbXB1dGVOdW1iZXJFeHByZXNzaW9uKHZhbHVlKTtcbiAgICAgICAgICAgIGlmKHZhbHVlID09PSBudWxsKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5DT01QT1NJVEUgPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgaWYgKCFVdGlscy5pc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMubmVzdGVkUGFyYW1ldGVycy5ldmVyeSgobmVzdGVkRGVmLCBpKT0+bmVzdGVkRGVmLnZhbGlkYXRlKHZhbHVlW25lc3RlZERlZi5uYW1lXSkpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKHZhbHVlLCBhbGxWYWx1ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdmFsdWUodmFsdWUpe1xuICAgICAgICBpZihQQVJBTUVURVJfVFlQRS5OVU1CRVJfRVhQUkVTU0lPTiA9PT0gdGhpcy50eXBlKSB7XG4gICAgICAgICAgICByZXR1cm4gSm9iUGFyYW1ldGVyRGVmaW5pdGlvbi5jb21wdXRlTnVtYmVyRXhwcmVzc2lvbih2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4vam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlcnN7XG4gICAgZGVmaW5pdGlvbnMgPSBbXTtcbiAgICB2YWx1ZXM9e307XG5cbiAgICBjb25zdHJ1Y3Rvcih2YWx1ZXMpe1xuICAgICAgICB0aGlzLmluaXREZWZpbml0aW9ucygpO1xuICAgICAgICB0aGlzLmluaXREZWZhdWx0VmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMpIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcy52YWx1ZXMsIHZhbHVlcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0RGVmaW5pdGlvbnMoKXtcblxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCl7XG5cbiAgICB9XG5cbiAgICB2YWxpZGF0ZSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5kZWZpbml0aW9ucy5ldmVyeSgoZGVmLCBpKT0+ZGVmLnZhbGlkYXRlKHRoaXMudmFsdWVzW2RlZi5uYW1lXSwgdGhpcy52YWx1ZXMpKTtcbiAgICB9XG5cbiAgICBnZXREZWZpbml0aW9uKHBhdGgpe1xuICAgICAgICB2YXIgZGVmcyA9dGhpcy5kZWZpbml0aW9ucztcbiAgICAgICAgbGV0IGRlZiA9IG51bGw7XG4gICAgICAgIGlmKCFwYXRoLnNwbGl0KCkuZXZlcnkobmFtZT0+e1xuICAgICAgICAgICAgICAgIGRlZiA9IFV0aWxzLmZpbmQoZGVmcywgZD0+ZC5uYW1lID09IG5hbWUpO1xuICAgICAgICAgICAgICAgIGlmKCFkZWYpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmcyA9IGRlZi5uZXN0ZWRQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KSl7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVmO1xuICAgIH1cblxuICAgIC8qZ2V0IG9yIHNldCB2YWx1ZSBieSBwYXRoKi9cbiAgICB2YWx1ZShwYXRoLCB2YWx1ZSl7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICBsZXQgZGVmID0gdGhpcy5nZXREZWZpbml0aW9uKHBhdGgpO1xuICAgICAgICAgICAgbGV0IHZhbCA9IFV0aWxzLmdldCh0aGlzLnZhbHVlcywgcGF0aCwgbnVsbCk7XG4gICAgICAgICAgICBpZihkZWYpe1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWYudmFsdWUodmFsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiAgdmFsO1xuICAgICAgICB9XG4gICAgICAgIFV0aWxzLnNldCh0aGlzLnZhbHVlcywgcGF0aCwgdmFsdWUpO1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFwiSm9iUGFyYW1ldGVyc1tcIjtcblxuICAgICAgICB0aGlzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuXG4gICAgICAgICAgICB2YXIgdmFsID0gdGhpcy52YWx1ZXNbZC5uYW1lXTtcbiAgICAgICAgICAgIC8vIGlmKFV0aWxzLmlzQXJyYXkodmFsKSl7XG4gICAgICAgICAgICAvLyAgICAgdmFyIHZhbHVlcyA9IHZhbDtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgLy8gaWYoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09IGQudHlwZSl7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICByZXN1bHQgKz0gZC5uYW1lICsgXCI9XCIrdmFsICsgXCI7XCI7XG4gICAgICAgIH0pO1xuICAgICAgICByZXN1bHQrPVwiXVwiO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGdldERUTygpe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsdWVzOiB0aGlzLnZhbHVlc1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtkZWZhdWx0IGFzIGlkYn0gZnJvbSBcImlkYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4uL2pvYi1leGVjdXRpb25cIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuaW1wb3J0IHtsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKiBJbmRleGVkREIgam9iIHJlcG9zaXRvcnkqL1xuZXhwb3J0IGNsYXNzIElkYkpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGRiUHJvbWlzZTtcbiAgICBqb2JJbnN0YW5jZURhbztcbiAgICBqb2JFeGVjdXRpb25EYW87XG4gICAgc3RlcEV4ZWN1dGlvbkRhbztcbiAgICBqb2JSZXN1bHREYW87XG4gICAgam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW87XG4gICAgam9iRXhlY3V0aW9uRmxhZ0RhbztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zUmV2aXZlciwgZGJOYW1lID0gJ3NkLWpvYi1yZXBvc2l0b3J5JywgZGVsZXRlREIgPSBmYWxzZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmRiTmFtZSA9IGRiTmFtZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc1Jldml2ZXIgPSBleHByZXNzaW9uc1Jldml2ZXI7XG4gICAgICAgIGlmIChkZWxldGVEQikge1xuICAgICAgICAgICAgdGhpcy5kZWxldGVEQigpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbml0REIoKVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5pbml0REIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmluaXREQigpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0REIoKSB7XG4gICAgICAgIHRoaXMuZGJQcm9taXNlID0gaWRiLm9wZW4odGhpcy5kYk5hbWUsIDIsIHVwZ3JhZGVEQiA9PiB7XG4gICAgICAgICAgICAvLyBOb3RlOiB3ZSBkb24ndCB1c2UgJ2JyZWFrJyBpbiB0aGlzIHN3aXRjaCBzdGF0ZW1lbnQsXG4gICAgICAgICAgICAvLyB0aGUgZmFsbC10aHJvdWdoIGJlaGF2aW91ciBpcyB3aGF0IHdlIHdhbnQuXG4gICAgICAgICAgICBzd2l0Y2ggKHVwZ3JhZGVEQi5vbGRWZXJzaW9uKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAwOlxuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1pbnN0YW5jZXMnKTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbnNPUyA9IHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBcImpvYkluc3RhbmNlLmlkXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImNyZWF0ZVRpbWVcIiwgXCJjcmVhdGVUaW1lXCIsIHt1bmlxdWU6IGZhbHNlfSk7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcInN0YXR1c1wiLCBcInN0YXR1c1wiLCB7dW5pcXVlOiBmYWxzZX0pO1xuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnKTtcbiAgICAgICAgICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9uLWZsYWdzJyk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdzdGVwLWV4ZWN1dGlvbnMnKTtcbiAgICAgICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkV4ZWN1dGlvbklkXCIsIFwiam9iRXhlY3V0aW9uSWRcIiwge3VuaXF1ZTogZmFsc2V9KTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgam9iUmVzdWx0T1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1yZXN1bHRzJyk7XG4gICAgICAgICAgICAgICAgICAgIGpvYlJlc3VsdE9TLmNyZWF0ZUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBcImpvYkluc3RhbmNlLmlkXCIsIHt1bmlxdWU6IHRydWV9KTtcbiAgICAgICAgICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgICAgICAgICAgIHVwZ3JhZGVEQi50cmFuc2FjdGlvbi5vYmplY3RTdG9yZSgnam9iLWluc3RhbmNlcycpLmNyZWF0ZUluZGV4KFwiaWRcIiwgXCJpZFwiLCB7dW5pcXVlOiB0cnVlfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZURhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWluc3RhbmNlcycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb25zJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItZXhlY3V0aW9uLXByb2dyZXNzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tZmxhZ3MnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbkRhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnc3RlcC1leGVjdXRpb25zJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYlJlc3VsdERhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLXJlc3VsdHMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgfVxuXG4gICAgZGVsZXRlREIoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKF89PmlkYi5kZWxldGUodGhpcy5kYk5hbWUpKTtcbiAgICB9XG5cblxuICAgIHJlbW92ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8ucmVtb3ZlKGtleSkudGhlbigoKT0+e1xuICAgICAgICAgICAgdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmFsc2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+eyAgLy8gIE5vdCB3YWl0aW5nIGZvciBwcm9taXNlIHJlc29sdmVzXG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLmdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iUmVzdWx0PT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8ucmVtb3ZlKGpvYkV4ZWN1dGlvbi5pZCkudGhlbigoKT0+e1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbi5pZCwgZmFsc2UpLnRoZW4oc3RlcEV4ZWN1dGlvbnM9PnsgIC8vIE5vdCB3YWl0aW5nIGZvciBwcm9taXNlIHJlc29sdmVzXG4gICAgICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaCh0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24sIHRoaXMpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8ucmVtb3ZlKHN0ZXBFeGVjdXRpb24uaWQpXG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iUmVzdWx0KGpvYlJlc3VsdCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5yZW1vdmUoam9iUmVzdWx0LmlkKTtcbiAgICB9XG5cblxuXG5cbiAgICBnZXRKb2JSZXN1bHQoam9iUmVzdWx0SWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLmdldChqb2JSZXN1bHRJZCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXN1bHREYW8uZ2V0QnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5zZXQoam9iUmVzdWx0LmlkLCBqb2JSZXN1bHQpLnRoZW4ocj0+am9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JJbnN0YW5jZURhby5nZXQoa2V5KS50aGVuKGR0bz0+ZHRvID8gdGhpcy5yZXZpdmVKb2JJbnN0YW5jZShkdG8pIDogZHRvKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JJbnN0YW5jZS5qb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iSW5zdGFuY2VEYW8uc2V0KGtleSwgam9iSW5zdGFuY2UpLnRoZW4ocj0+am9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZHRvID0gam9iRXhlY3V0aW9uLmdldERUTygpO1xuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnNEVE9zID0gZHRvLnN0ZXBFeGVjdXRpb25zO1xuICAgICAgICBkdG8uc3RlcEV4ZWN1dGlvbnMgPSBudWxsO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uc2V0KGpvYkV4ZWN1dGlvbi5pZCwgZHRvKS50aGVuKHI9PnRoaXMuc2F2ZVN0ZXBFeGVjdXRpb25zRFRPUyhzdGVwRXhlY3V0aW9uc0RUT3MpKS50aGVuKHI9PmpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvblByb2dyZXNzRGFvLnNldChqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3MpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uc2V0KGpvYkV4ZWN1dGlvbklkLCBmbGFnKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0Rhby5nZXQoam9iRXhlY3V0aW9uSWQpXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZHRvID0gc3RlcEV4ZWN1dGlvbi5nZXREVE8oW1wiam9iRXhlY3V0aW9uXCJdKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcEV4ZWN1dGlvbkRhby5zZXQoc3RlcEV4ZWN1dGlvbi5pZCwgZHRvKS50aGVuKHI9PnN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnMsIHNhdmVkRXhlY3V0aW9ucyA9IFtdKSB7XG4gICAgICAgIGlmIChzdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gc2F2ZWRFeGVjdXRpb25zLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzYXZlZEV4ZWN1dGlvbnMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uRFRPID0gc3RlcEV4ZWN1dGlvbnNbc2F2ZWRFeGVjdXRpb25zLmxlbmd0aF07XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uc2V0KHN0ZXBFeGVjdXRpb25EVE8uaWQsIHN0ZXBFeGVjdXRpb25EVE8pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBzYXZlZEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnMsIHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldChpZCkudGhlbihkdG89PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhkdG8pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhqb2JFeGVjdXRpb25EVE8sIHJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgaWYgKCFqb2JFeGVjdXRpb25EVE8pIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5maW5kU3RlcEV4ZWN1dGlvbnMoam9iRXhlY3V0aW9uRFRPLmlkLCBmYWxzZSkudGhlbihzdGVwcz0+IHtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbkRUTy5zdGVwRXhlY3V0aW9ucyA9IHN0ZXBzO1xuICAgICAgICAgICAgaWYgKCFyZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uRFRPO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmV2aXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbkRUTyk7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZSA9IHRydWUsIGZldGNoZWQgPSBbXSkge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uRHRvTGlzdC5sZW5ndGggPD0gZmV0Y2hlZC5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmV0Y2hlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdFtmZXRjaGVkLmxlbmd0aF0sIHJldml2ZSkudGhlbigoam9iRXhlY3V0aW9uKT0+IHtcbiAgICAgICAgICAgIGZldGNoZWQucHVzaChqb2JFeGVjdXRpb24pO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdCwgcmV2aXZlLCBmZXRjaGVkKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmluZFN0ZXBFeGVjdXRpb25zKGpvYkV4ZWN1dGlvbklkLCByZXZpdmUgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uZ2V0QWxsQnlJbmRleChcImpvYkV4ZWN1dGlvbklkXCIsIGpvYkV4ZWN1dGlvbklkKS50aGVuKGR0b3M9PiB7XG4gICAgICAgICAgICBpZiAoIXJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBkdG9zO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGR0b3MubWFwKGR0bz0+dGhpcy5yZXZpdmVTdGVwRXhlY3V0aW9uKGR0bykpO1xuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlLCBmZXRjaFJlbGF0aW9uc0FuZFJldml2ZSA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JJbnN0YW5jZUlkXCIsIGpvYkluc3RhbmNlLmlkKS50aGVuKHZhbHVlcz0+IHtcbiAgICAgICAgICAgIHZhciBzb3J0ZWQgPSB2YWx1ZXMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmICghZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoc29ydGVkLCB0cnVlKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmFsc2UpLnRoZW4oZXhlY3V0aW9ucz0+dGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhleGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0gMV0pKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+IHtcbiAgICAgICAgICAgIHZhciBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT4ge1xuICAgICAgICAgICAgICAgIGlmIChsYXRlc3QgPT0gbnVsbCB8fCBsYXRlc3Quc3RhcnRUaW1lLmdldFRpbWUoKSA8IHMuc3RhcnRUaW1lLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgICAgICBsYXRlc3QgPSBzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGxhdGVzdDtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVKb2JJbnN0YW5jZShkdG8pIHtcbiAgICAgICAgcmV0dXJuIG5ldyBKb2JJbnN0YW5jZShkdG8uaWQsIGR0by5qb2JOYW1lKTtcbiAgICB9XG5cbiAgICByZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0bykge1xuICAgICAgICB2YXIgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuY29udGV4dCA9IGR0by5jb250ZXh0O1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbkNvbnRleHQuZ2V0RGF0YSgpO1xuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGRhdGFNb2RlbCA9IG5ldyBEYXRhTW9kZWwoKTtcbiAgICAgICAgICAgIGRhdGFNb2RlbC5sb2FkRnJvbURUTyhkYXRhLCB0aGlzLmV4cHJlc3Npb25zUmV2aXZlcik7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YU1vZGVsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dFxuICAgIH1cblxuICAgIHJldml2ZUpvYkV4ZWN1dGlvbihkdG8pIHtcblxuICAgICAgICB2YXIgam9iID0gdGhpcy5nZXRKb2JCeU5hbWUoZHRvLmpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0by5qb2JJbnN0YW5jZSk7XG4gICAgICAgIHZhciBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoZHRvLmpvYlBhcmFtZXRlcnMudmFsdWVzKTtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbiA9IG5ldyBKb2JFeGVjdXRpb24oam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMsIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChqb2JFeGVjdXRpb24sIGR0bywgKG9ialZhbHVlLCBzcmNWYWx1ZSwga2V5LCBvYmplY3QsIHNvdXJjZSwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JJbnN0YW5jZVwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkluc3RhbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iUGFyYW1ldGVyc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYlBhcmFtZXRlcnM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJzdGVwRXhlY3V0aW9uc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNyY1ZhbHVlLm1hcChzdGVwRFRPID0+IHRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihzdGVwRFRPLCBqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVTdGVwRXhlY3V0aW9uKGR0bywgam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uID0gbmV3IFN0ZXBFeGVjdXRpb24oZHRvLnN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChzdGVwRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iRXhlY3V0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG5cblxuY2xhc3MgT2JqZWN0U3RvcmVEYW8ge1xuXG4gICAgbmFtZTtcbiAgICBkYlByb21pc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBkYlByb21pc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBkYlByb21pc2U7XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmdldChrZXkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRBbGxCeUluZGV4KGluZGV4TmFtZSwga2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuaW5kZXgoaW5kZXhOYW1lKS5nZXRBbGwoa2V5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRCeUluZGV4KGluZGV4TmFtZSwga2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXG4gICAgICAgICAgICAgICAgLm9iamVjdFN0b3JlKHRoaXMubmFtZSkuaW5kZXgoaW5kZXhOYW1lKS5nZXQoa2V5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBzZXQoa2V5LCB2YWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkucHV0KHZhbCwga2V5KTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5kZWxldGUoa2V5KTtcbiAgICAgICAgICAgIHJldHVybiB0eC5jb21wbGV0ZTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY2xlYXIoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmNsZWFyKCk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGtleXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGtleXMgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHN0b3JlID0gdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKTtcblxuICAgICAgICAgICAgLy8gVGhpcyB3b3VsZCBiZSBzdG9yZS5nZXRBbGxLZXlzKCksIGJ1dCBpdCBpc24ndCBzdXBwb3J0ZWQgYnkgRWRnZSBvciBTYWZhcmkuXG4gICAgICAgICAgICAvLyBvcGVuS2V5Q3Vyc29yIGlzbid0IHN1cHBvcnRlZCBieSBTYWZhcmksIHNvIHdlIGZhbGwgYmFja1xuICAgICAgICAgICAgKHN0b3JlLml0ZXJhdGVLZXlDdXJzb3IgfHwgc3RvcmUuaXRlcmF0ZUN1cnNvcikuY2FsbChzdG9yZSwgY3Vyc29yID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWN1cnNvcikgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGtleXMucHVzaChjdXJzb3Iua2V5KTtcbiAgICAgICAgICAgICAgICBjdXJzb3IuY29udGludWUoKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGUudGhlbigoKSA9PiBrZXlzKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JLZXlHZW5lcmF0b3J9IGZyb20gXCIuLi9qb2Ita2V5LWdlbmVyYXRvclwiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4uL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4uL2pvYi1leGVjdXRpb25cIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9uQWxyZWFkeVJ1bm5pbmdFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZUFscmVhZHlDb21wbGV0ZUV4Y2VwdGlvbn0gZnJvbSBcIi4uL2V4Y2VwdGlvbnMvam9iLWluc3RhbmNlLWFscmVhZHktY29tcGxldGUtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtTdGVwRXhlY3V0aW9ufSBmcm9tIFwiLi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7RGF0YU1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7Sm9iUmVzdWx0fSBmcm9tIFwiLi4vam9iLXJlc3VsdFwiO1xuXG5leHBvcnQgY2xhc3MgSm9iUmVwb3NpdG9yeSB7XG5cbiAgICBqb2JCeU5hbWUgPSB7fTtcblxuICAgIHJlZ2lzdGVySm9iKGpvYikge1xuICAgICAgICB0aGlzLmpvYkJ5TmFtZVtqb2IubmFtZV0gPSBqb2I7XG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iQnlOYW1lW25hbWVdO1xuICAgIH1cblxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkgZ2V0Sm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGtleSwgam9iSW5zdGFuY2Upe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3MgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25GbGFnIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlU3RlcEV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmZpbmRKb2JFeGVjdXRpb25zIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zZXRKb2JSZXN1bHQgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG5cbiAgICByZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkucmVtb3ZlU3RlcEV4ZWN1dGlvbiBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnJlbW92ZUpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIG5ldyBKb2JJbnN0YW5jZSB3aXRoIHRoZSBuYW1lIGFuZCBqb2IgcGFyYW1ldGVycyBwcm92aWRlZC4gcmV0dXJuIHByb21pc2UqL1xuICAgIGNyZWF0ZUpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gbmV3IEpvYkluc3RhbmNlKFV0aWxzLmd1aWQoKSwgam9iTmFtZSk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgLypDaGVjayBpZiBhbiBpbnN0YW5jZSBvZiB0aGlzIGpvYiBhbHJlYWR5IGV4aXN0cyB3aXRoIHRoZSBwYXJhbWV0ZXJzIHByb3ZpZGVkLiovXG4gICAgaXNKb2JJbnN0YW5jZUV4aXN0cyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4ocmVzdWx0ID0+ICEhcmVzdWx0KS5jYXRjaChlcnJvcj0+ZmFsc2UpO1xuICAgIH1cblxuICAgIGdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gam9iTmFtZSArIFwifFwiICsgSm9iS2V5R2VuZXJhdG9yLmdlbmVyYXRlS2V5KGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ3JlYXRlIGEgSm9iRXhlY3V0aW9uIGZvciBhIGdpdmVuICBKb2IgYW5kIEpvYlBhcmFtZXRlcnMuIElmIG1hdGNoaW5nIEpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzLFxuICAgICAqIHRoZSBqb2IgbXVzdCBiZSByZXN0YXJ0YWJsZSBhbmQgaXQncyBsYXN0IEpvYkV4ZWN1dGlvbiBtdXN0ICpub3QqIGJlXG4gICAgICogY29tcGxldGVkLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBkb2VzIG5vdCBleGlzdCB5ZXQgaXQgd2lsbCBiZSAgY3JlYXRlZC4qL1xuXG4gICAgY3JlYXRlSm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMsIGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbihqb2JJbnN0YW5jZT0+e1xuICAgICAgICAgICAgaWYgKGpvYkluc3RhbmNlICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT57XG4gICAgICAgICAgICAgICAgICAgIGV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uKFwiQSBqb2IgZXhlY3V0aW9uIGZvciB0aGlzIGpvYiBpcyBhbHJlYWR5IHJ1bm5pbmc6IFwiICsgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuQUJBTkRPTkVEKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIkEgam9iIGluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBjb21wbGV0ZSBmb3IgcGFyYW1ldGVycz1cIiArIGpvYlBhcmFtZXRlcnNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKyBcIi4gIElmIHlvdSB3YW50IHRvIHJ1biB0aGlzIGpvYiBhZ2FpbiwgY2hhbmdlIHRoZSBwYXJhbWV0ZXJzLlwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBleGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0gMV0uZXhlY3V0aW9uQ29udGV4dDtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBubyBqb2IgZm91bmQsIGNyZWF0ZSBvbmVcbiAgICAgICAgICAgIGpvYkluc3RhbmNlID0gdGhpcy5jcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIHZhciBkYXRhTW9kZWwgPSBuZXcgRGF0YU1vZGVsKCk7XG4gICAgICAgICAgICBkYXRhTW9kZWwuX3NldE5ld1N0YXRlKGRhdGEuY3JlYXRlU3RhdGVTbmFwc2hvdCgpKTtcbiAgICAgICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuc2V0RGF0YShkYXRhTW9kZWwpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtqb2JJbnN0YW5jZSwgZXhlY3V0aW9uQ29udGV4dF0pO1xuICAgICAgICB9KS50aGVuKGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dD0+e1xuICAgICAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbiA9IG5ldyBKb2JFeGVjdXRpb24oaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0WzBdLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gaW5zdGFuY2VBbmRFeGVjdXRpb25Db250ZXh0WzFdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbigoam9iSW5zdGFuY2UpPT57XG4gICAgICAgICAgICBpZigham9iSW5zdGFuY2Upe1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oZXhlY3V0aW9ucz0+ZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtMV0pO1xuICAgIH1cblxuICAgIGdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihqb2JFeGVjdXRpb25zPT57XG4gICAgICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbnM9W107XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25zLmZvckVhY2goam9iRXhlY3V0aW9uPT5qb2JFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZmlsdGVyKHM9PnMuc3RlcE5hbWUgPT09IHN0ZXBOYW1lKS5mb3JFYWNoKChzKT0+c3RlcEV4ZWN1dGlvbnMucHVzaChzKSkpO1xuICAgICAgICAgICAgdmFyIGxhdGVzdCA9IG51bGw7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHM9PntcbiAgICAgICAgICAgICAgICBpZiAobGF0ZXN0ID09IG51bGwgfHwgbGF0ZXN0LnN0YXJ0VGltZS5nZXRUaW1lKCkgPCBzLnN0YXJ0VGltZS5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGF0ZXN0ID0gcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBsYXRlc3Q7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgYWRkU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGUobyl7XG4gICAgICAgIG8ubGFzdFVwZGF0ZWQgPSBuZXcgRGF0ZSgpO1xuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZUpvYkV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uKG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgXCJPYmplY3Qgbm90IHVwZGF0YWJsZTogXCIrb1xuICAgIH1cblxuICAgIHJlbW92ZShvKXtcblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG8gaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iUmVzdWx0KXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbW92ZUpvYlJlc3VsdCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFwiT2JqZWN0IG5vdCByZW1vdmFibGU6IFwiK28pO1xuICAgIH1cblxuXG4gICAgcmV2aXZlSm9iSW5zdGFuY2UoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5leHBvcnQgY2xhc3MgU2ltcGxlSm9iUmVwb3NpdG9yeSBleHRlbmRzIEpvYlJlcG9zaXRvcnl7XG4gICAgam9iSW5zdGFuY2VzQnlLZXkgPSB7fTtcbiAgICBqb2JFeGVjdXRpb25zID0gW107XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBleGVjdXRpb25Qcm9ncmVzcyA9IHt9O1xuICAgIGV4ZWN1dGlvbkZsYWdzID0ge307XG4gICAgam9iUmVzdWx0cyA9IFtdO1xuXG4gICAgcmVtb3ZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICBVdGlscy5mb3JPd24odGhpcy5qb2JJbnN0YW5jZXNCeUtleSwgIChqaSwga2V5KT0+e1xuICAgICAgICAgICAgaWYoamk9PT1qb2JJbnN0YW5jZSl7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkID09IGpvYkluc3RhbmNlLmlkKS5yZXZlcnNlKCkuZm9yRWFjaCh0aGlzLnJlbW92ZUpvYkV4ZWN1dGlvbiwgdGhpcyk7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5maWx0ZXIoam9iUmVzdWx0PT5qb2JSZXN1bHQuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnJldmVyc2UoKS5mb3JFYWNoKHRoaXMucmVtb3ZlSm9iUmVzdWx0LCB0aGlzKTtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmVtb3ZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuam9iRXhlY3V0aW9ucy5pbmRleE9mKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIGlmKGluZGV4Pi0xKSB7XG4gICAgICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5maWx0ZXIoc3RlcEV4ZWN1dGlvbj0+c3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQgPT09IGpvYkV4ZWN1dGlvbi5pZCkucmV2ZXJzZSgpLmZvckVhY2godGhpcy5yZW1vdmVTdGVwRXhlY3V0aW9uLCB0aGlzKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJlbW92ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuc3RlcEV4ZWN1dGlvbnMuaW5kZXhPZihzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZW1vdmVKb2JSZXN1bHQoam9iUmVzdWx0KXtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5qb2JSZXN1bHRzLmluZGV4T2Yoam9iUmVzdWx0KTtcbiAgICAgICAgaWYoaW5kZXg+LTEpIHtcbiAgICAgICAgICAgIHRoaXMuam9iUmVzdWx0cy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSA9IGpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGpvYkluc3RhbmNlKVxuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuaWQ9PT1qb2JSZXN1bHRJZCkpXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuam9iSW5zdGFuY2UuaWQ9PT1qb2JJbnN0YW5jZS5pZCkpXG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnB1c2goam9iUmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFV0aWxzLmZpbmQodGhpcy5qb2JFeGVjdXRpb25zLCBleD0+ZXguaWQ9PT1pZCkpXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnB1c2goam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkLCBwcm9ncmVzcyl7XG4gICAgICAgIHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdID0gcHJvZ3Jlc3M7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocHJvZ3Jlc3MpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuZXhlY3V0aW9uUHJvZ3Jlc3Nbam9iRXhlY3V0aW9uSWRdKVxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0gPSBmbGFnO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZsYWcpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0pXG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICAvKmZpbmQgam9iIGV4ZWN1dGlvbnMgc29ydGVkIGJ5IGNyZWF0ZVRpbWUsIHJldHVybnMgcHJvbWlzZSovXG4gICAgZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGU9PmUuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICB9KSk7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTaW1wbGVKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9zaW1wbGUtam9iLXJlcG9zaXRvcnlcIjtcblxuXG5cbmV4cG9ydCBjbGFzcyBUaW1lb3V0Sm9iUmVwb3NpdG9yeSBleHRlbmRzIFNpbXBsZUpvYlJlcG9zaXRvcnl7XG5cbiAgICBjcmVhdGVUaW1lb3V0UHJvbWlzZSh2YWx1ZVRvUmVzb2x2ZSwgZGVsYXk9MSl7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlPT57XG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh2YWx1ZVRvUmVzb2x2ZSk7XG4gICAgICAgICAgICB9LCBkZWxheSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLypyZXR1cm5zIHByb21pc2UqL1xuICAgIGdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGtleSA9IHRoaXMuZ2VuZXJhdGVKb2JJbnN0YW5jZUtleShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5qb2JJbnN0YW5jZXNCeUtleVtrZXldKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMpe1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYkluc3RhbmNlLmpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0gPSBqb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdChqb2JSZXN1bHRJZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JSZXN1bHRzLCByPT5yLmlkPT09am9iUmVzdWx0SWQpKTtcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuam9iSW5zdGFuY2UuaWQ9PT1qb2JJbnN0YW5jZS5pZCkpO1xuICAgIH1cblxuICAgIHNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KSB7XG4gICAgICAgIHRoaXMuam9iUmVzdWx0cy5wdXNoKGpvYlJlc3VsdCk7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYlJlc3VsdCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKFV0aWxzLmZpbmQodGhpcy5qb2JFeGVjdXRpb25zLCBleD0+ZXguaWQ9PT1pZCkpO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9ucy5wdXNoKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGpvYkV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0gPSBwcm9ncmVzcztcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UocHJvZ3Jlc3MpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25Qcm9ncmVzc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0gPSBmbGFnO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShmbGFnKTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UodGhpcy5leGVjdXRpb25GbGFnc1tqb2JFeGVjdXRpb25JZF0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pe1xuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25zLnB1c2goc3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHN0ZXBFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkV4ZWN1dGlvbnMuZmlsdGVyKGU9PmUuam9iSW5zdGFuY2UuaWQgPT0gam9iSW5zdGFuY2UuaWQpLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcmVtb3ZlKG9iamVjdCl7IC8vVE9ET1xuXG4gICAgfVxufVxuIiwiaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1N0ZXBFeGVjdXRpb259IGZyb20gXCIuL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhlY3V0aW9uQ29udGV4dH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcblxuLypkb21haW4gb2JqZWN0IHJlcHJlc2VudGluZyB0aGUgcmVzdWx0IG9mIGEgam9iIGluc3RhbmNlLiovXG5leHBvcnQgY2xhc3MgSm9iUmVzdWx0IHtcbiAgICBpZDtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBsYXN0VXBkYXRlZCA9IG51bGw7XG5cbiAgICBkYXRhO1xuXG4gICAgY29uc3RydWN0b3Ioam9iSW5zdGFuY2UsIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlO1xuICAgIH1cbn1cbiIsImV4cG9ydCBjb25zdCBKT0JfU1RBVFVTID0ge1xuICAgIENPTVBMRVRFRDogJ0NPTVBMRVRFRCcsXG4gICAgU1RBUlRJTkc6ICdTVEFSVElORycsXG4gICAgU1RBUlRFRDogJ1NUQVJURUQnLFxuICAgIFNUT1BQSU5HOiAnU1RPUFBJTkcnLFxuICAgIFNUT1BQRUQ6ICdTVE9QUEVEJyxcbiAgICBGQUlMRUQ6ICdGQUlMRUQnLFxuICAgIFVOS05PV046ICdVTktOT1dOJyxcbiAgICBBQkFORE9ORUQ6ICdBQkFORE9ORUQnLFxuICAgIEVYRUNVVElORzogJ0VYRUNVVElORycgLy9mb3IgZXhpdCBzdGF0dXMgb25seVxufTtcbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vam9iLWV4ZWN1dGlvbi1mbGFnXCI7XG5pbXBvcnQge0pvYlJlc3VsdH0gZnJvbSBcIi4vam9iLXJlc3VsdFwiO1xuLypCYXNlIGNsYXNzIGZvciBqb2JzKi9cbi8vQSBKb2IgaXMgYW4gZW50aXR5IHRoYXQgZW5jYXBzdWxhdGVzIGFuIGVudGlyZSBqb2IgcHJvY2VzcyAoIGFuIGFic3RyYWN0aW9uIHJlcHJlc2VudGluZyB0aGUgY29uZmlndXJhdGlvbiBvZiBhIGpvYikuXG5cbmV4cG9ydCBjbGFzcyBKb2Ige1xuXG4gICAgaWQ7XG4gICAgbmFtZTtcbiAgICBzdGVwcyA9IFtdO1xuXG4gICAgaXNSZXN0YXJ0YWJsZT10cnVlO1xuICAgIGV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuICAgIGpvYlBhcmFtZXRlcnNWYWxpZGF0b3I7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IgPSB0aGlzLmdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JEYXRhVmFsaWRhdG9yID0gdGhpcy5nZXRKb2JEYXRhVmFsaWRhdG9yKCk7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgfVxuXG4gICAgc2V0Sm9iUmVwb3NpdG9yeShqb2JSZXBvc2l0b3J5KSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IGpvYlJlcG9zaXRvcnk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShleGVjdXRpb24pIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBzdGFydGluZzogXCIsIGV4ZWN1dGlvbik7XG4gICAgICAgIHZhciBqb2JSZXN1bHQ7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrRXhlY3V0aW9uRmxhZ3MoZXhlY3V0aW9uKS50aGVuKGV4ZWN1dGlvbj0+e1xuXG4gICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PT0gSk9CX1NUQVRVUy5TVE9QUElORykge1xuICAgICAgICAgICAgICAgIC8vIFRoZSBqb2Igd2FzIGFscmVhZHkgc3RvcHBlZFxuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHdhcyBzdG9wcGVkOiBcIiArIGV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciAmJiAhdGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yLnZhbGlkYXRlKGV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYodGhpcy5qb2JEYXRhVmFsaWRhdG9yICYmICF0aGlzLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmdldERhdGEoKSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iIGV4ZWN1dGVcIilcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICBleGVjdXRpb24uc3RhcnRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy51cGRhdGVTdGF0dXMoZXhlY3V0aW9uLCBKT0JfU1RBVFVTLlNUQVJURUQpLCB0aGlzLmdldFJlc3VsdChleGVjdXRpb24pLCB0aGlzLnVwZGF0ZVByb2dyZXNzKGV4ZWN1dGlvbildKS50aGVuKHJlcz0+e1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbj1yZXNbMF07XG4gICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gcmVzWzFdO1xuICAgICAgICAgICAgICAgIGlmKCFqb2JSZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgam9iUmVzdWx0ID0gbmV3IEpvYlJlc3VsdChleGVjdXRpb24uam9iSW5zdGFuY2UpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZUpvYihleGVjdXRpb24pKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiSm9iIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIsZXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25cbiAgICAgICAgfSkuY2F0Y2goZT0+e1xuICAgICAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbikge1xuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRW5jb3VudGVyZWQgaW50ZXJydXB0aW9uIGV4ZWN1dGluZyBqb2JcIiwgZSk7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgZmF0YWwgZXJyb3IgZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKGpvYlJlc3VsdCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iUmVzdWx0KGpvYlJlc3VsdCkudGhlbigoKT0+ZXhlY3V0aW9uKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBzYXZpbmcgam9iIHJlc3VsdHNcIiwgZSk7XG4gICAgICAgICAgICBpZihlKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgZXhlY3V0aW9uLmVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT5yZXNbMF0pXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVySm9iKGV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBlbmNvdW50ZXJlZCBpbiBhZnRlclN0ZXAgY2FsbGJhY2tcIiwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KVxuICAgIH1cblxuXG4gICAgdXBkYXRlU3RhdHVzKGpvYkV4ZWN1dGlvbiwgc3RhdHVzKSB7XG4gICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXM9c3RhdHVzO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pXG4gICAgfVxuXG4gICAgdXBkYXRlUHJvZ3Jlc3Moam9iRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb24uaWQsIHRoaXMuZ2V0UHJvZ3Jlc3Moam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgLyogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIGFsbG93aW5nIHRoZW0gdG8gY29uY2VudHJhdGUgb24gcHJvY2Vzc2luZyBsb2dpYyBhbmQgaWdub3JlIGxpc3RlbmVycywgcmV0dXJucyBwcm9taXNlKi9cbiAgICBkb0V4ZWN1dGUoZXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgJ2RvRXhlY3V0ZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIGdldEpvYlBhcmFtZXRlcnNWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKHBhcmFtcykgPT4gcGFyYW1zLnZhbGlkYXRlKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldEpvYkRhdGFWYWxpZGF0b3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZGF0ZTogKGRhdGEpID0+IHRydWVcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZFN0ZXAoc3RlcCl7XG4gICAgICAgIHRoaXMuc3RlcHMucHVzaChzdGVwKTtcbiAgICB9XG5cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKXtcbiAgICAgICAgdGhyb3cgJ2NyZWF0ZUpvYlBhcmFtZXRlcnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICogY3VycmVudFxuICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdG90YWw6IDEsXG4gICAgICAgICAgICBjdXJyZW50OiBleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZWdpc3RlckV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKXtcbiAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcoZXhlY3V0aW9uLmlkKS50aGVuKGZsYWc9PntcbiAgICAgICAgICAgIGlmKEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QID09PSBmbGFnKXtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RvcCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldFJlc3VsdChleGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JSZXN1bHRCeUluc3RhbmNlKGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgam9iUmVzdWx0VG9Dc3ZSb3dzKGpvYlJlc3VsdCwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHRocm93ICdqb2JSZXN1bHRUb0NzdlJvd3MgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBqb2I6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG59XG4iLCJpbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9ifSBmcm9tIFwiLi9qb2JcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi9zdGVwXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUmVzdGFydEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcmVzdGFydC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcblxuLyogU2ltcGxlIEpvYiB0aGF0IHNlcXVlbnRpYWxseSBleGVjdXRlcyBhIGpvYiBieSBpdGVyYXRpbmcgdGhyb3VnaCBpdHMgbGlzdCBvZiBzdGVwcy4gIEFueSBTdGVwIHRoYXQgZmFpbHMgd2lsbCBmYWlsIHRoZSBqb2IuICBUaGUgam9iIGlzXG4gY29uc2lkZXJlZCBjb21wbGV0ZSB3aGVuIGFsbCBzdGVwcyBoYXZlIGJlZW4gZXhlY3V0ZWQuKi9cblxuZXhwb3J0IGNsYXNzIFNpbXBsZUpvYiBleHRlbmRzIEpvYiB7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpXG4gICAgfVxuXG4gICAgZ2V0U3RlcChzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gVXRpbHMuZmluZCh0aGlzLnN0ZXBzLCBzPT5zLm5hbWUgPT0gc3RlcE5hbWUpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGV4ZWN1dGlvbiwgam9iUmVzdWx0KS50aGVuKGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJVcGRhdGluZyBKb2JFeGVjdXRpb24gc3RhdHVzOiBcIiwgbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKC4uLmxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBoYW5kbGVOZXh0U3RlcChqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCwgcHJldlN0ZXA9bnVsbCwgcHJldlN0ZXBFeGVjdXRpb249bnVsbCl7XG4gICAgICAgIHZhciBzdGVwSW5kZXggPSAwO1xuICAgICAgICBpZihwcmV2U3RlcCl7XG4gICAgICAgICAgICBzdGVwSW5kZXggPSB0aGlzLnN0ZXBzLmluZGV4T2YocHJldlN0ZXApKzE7XG4gICAgICAgIH1cbiAgICAgICAgaWYoc3RlcEluZGV4Pj10aGlzLnN0ZXBzLmxlbmd0aCl7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHByZXZTdGVwRXhlY3V0aW9uKVxuICAgICAgICB9XG4gICAgICAgIHZhciBzdGVwID0gdGhpcy5zdGVwc1tzdGVwSW5kZXhdO1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVTdGVwKHN0ZXAsIGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0KS50aGVuKHN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmKHN0ZXBFeGVjdXRpb24uc3RhdHVzICE9PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCl7IC8vIFRlcm1pbmF0ZSB0aGUgam9iIGlmIGEgc3RlcCBmYWlsc1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dFN0ZXAoam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQsIHN0ZXAsIHN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGhhbmRsZVN0ZXAoc3RlcCwgam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0V4ZWN1dGlvbkZsYWdzKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChqb2JFeGVjdXRpb24uaXNTdG9wcGluZygpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkludGVycnVwdGVkRXhjZXB0aW9uKFwiSm9iRXhlY3V0aW9uIGludGVycnVwdGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdFN0ZXBFeGVjdXRpb24oam9iSW5zdGFuY2UsIHN0ZXAubmFtZSlcblxuICAgICAgICB9KS50aGVuKGxhc3RTdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAodGhpcy5zdGVwRXhlY3V0aW9uUGFydE9mRXhpc3RpbmdKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uLCBsYXN0U3RlcEV4ZWN1dGlvbikpIHtcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGUgbGFzdCBleGVjdXRpb24gb2YgdGhpcyBzdGVwIHdhcyBpbiB0aGUgc2FtZSBqb2IsIGl0J3MgcHJvYmFibHkgaW50ZW50aW9uYWwgc28gd2Ugd2FudCB0byBydW4gaXQgYWdhaW4uXG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJEdXBsaWNhdGUgc3RlcCBkZXRlY3RlZCBpbiBleGVjdXRpb24gb2Ygam9iLiBzdGVwOiBcIiArIHN0ZXAubmFtZSArIFwiIGpvYk5hbWU6IFwiLCBqb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgICAgICAgICBsYXN0U3RlcEV4ZWN1dGlvbiA9IG51bGw7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBjdXJyZW50U3RlcEV4ZWN1dGlvbiA9IGxhc3RTdGVwRXhlY3V0aW9uO1xuXG4gICAgICAgICAgICBpZiAoIXRoaXMuc2hvdWxkU3RhcnQoY3VycmVudFN0ZXBFeGVjdXRpb24sIGpvYkV4ZWN1dGlvbiwgc3RlcCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uLmNyZWF0ZVN0ZXBFeGVjdXRpb24oc3RlcC5uYW1lKTtcblxuICAgICAgICAgICAgdmFyIGlzQ29tcGxldGVkID0gbGFzdFN0ZXBFeGVjdXRpb24gIT0gbnVsbCAmJiBsYXN0U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgdmFyIGlzUmVzdGFydCA9IGxhc3RTdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgIWlzQ29tcGxldGVkO1xuICAgICAgICAgICAgdmFyIHNraXBFeGVjdXRpb24gPSBpc0NvbXBsZXRlZCAmJiBzdGVwLnNraXBPblJlc3RhcnRJZkNvbXBsZXRlZDtcblxuICAgICAgICAgICAgaWYgKGlzUmVzdGFydCkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBsYXN0U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0O1xuICAgICAgICAgICAgICAgIGlmIChsYXN0U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LmNvbnRhaW5zS2V5KFwiZXhlY3V0ZWRcIikpIHtcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5yZW1vdmUoXCJleGVjdXRlZFwiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQgPSBuZXcgRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYoc2tpcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwic2tpcHBlZFwiLCB0cnVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5hZGRTdGVwRXhlY3V0aW9uKGN1cnJlbnRTdGVwRXhlY3V0aW9uKS50aGVuKChfY3VycmVudFN0ZXBFeGVjdXRpb24pPT57XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb249X2N1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIGlmKHNraXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIlNraXBwaW5nIGNvbXBsZXRlZCBzdGVwIGV4ZWN1dGlvbjogW1wiICsgc3RlcC5uYW1lICsgXCJdXCIpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRXhlY3V0aW5nIHN0ZXA6IFtcIiArIHN0ZXAubmFtZSArIFwiXVwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RlcC5leGVjdXRlKGN1cnJlbnRTdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgY3VycmVudFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5wdXQoXCJleGVjdXRlZFwiLCB0cnVlKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY3VycmVudFN0ZXBFeGVjdXRpb247XG4gICAgICAgICAgICB9KS5jYXRjaCAoZSA9PiB7XG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGpvYkV4ZWN1dGlvbikudGhlbihqb2JFeGVjdXRpb249Pnt0aHJvdyBlfSlcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pLnRoZW4oKGN1cnJlbnRTdGVwRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQSU5HXG4gICAgICAgICAgICAgICAgfHwgY3VycmVudFN0ZXBFeGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuU1RPUFBFRCkge1xuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBqb2IgZ2V0cyB0aGUgbWVzc2FnZSB0aGF0IGl0IGlzIHN0b3BwaW5nXG4gICAgICAgICAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgICAgICAgICAgICAgLy8gdGhyb3cgbmV3IEVycm9yKFwiSm9iIGludGVycnVwdGVkIGJ5IHN0ZXAgZXhlY3V0aW9uXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlUHJvZ3Jlc3Moam9iRXhlY3V0aW9uKS50aGVuKCgpPT5jdXJyZW50U3RlcEV4ZWN1dGlvbik7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBzdGVwRXhlY3V0aW9uUGFydE9mRXhpc3RpbmdKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uLCBzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uaWQgPT0gam9iRXhlY3V0aW9uLmlkXG4gICAgfVxuXG4gICAgc2hvdWxkU3RhcnQobGFzdFN0ZXBFeGVjdXRpb24sIGV4ZWN1dGlvbiwgc3RlcCkge1xuICAgICAgICB2YXIgc3RlcFN0YXR1cztcbiAgICAgICAgaWYgKGxhc3RTdGVwRXhlY3V0aW9uID09IG51bGwpIHtcbiAgICAgICAgICAgIHN0ZXBTdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgc3RlcFN0YXR1cyA9IGxhc3RTdGVwRXhlY3V0aW9uLnN0YXR1cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzdGVwU3RhdHVzID09IEpPQl9TVEFUVVMuVU5LTk9XTikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJDYW5ub3QgcmVzdGFydCBzdGVwIGZyb20gVU5LTk9XTiBzdGF0dXNcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzdGVwU3RhdHVzICE9IEpPQl9TVEFUVVMuQ09NUExFVEVEIHx8IHN0ZXAuaXNSZXN0YXJ0YWJsZTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pe1xuICAgICAgICB2YXIgY29tcGxldGVkU3RlcHMgPSBleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoO1xuICAgICAgICBsZXQgcHJvZ3Jlc3MgPSB7XG4gICAgICAgICAgICB0b3RhbDogdGhpcy5zdGVwcy5sZW5ndGgsXG4gICAgICAgICAgICBjdXJyZW50OiBjb21wbGV0ZWRTdGVwc1xuICAgICAgICB9O1xuICAgICAgICBpZighY29tcGxldGVkU3RlcHMpe1xuICAgICAgICAgICAgcmV0dXJuIHByb2dyZXNzXG4gICAgICAgIH1cbiAgICAgICAgaWYoSk9CX1NUQVRVUy5DT01QTEVURUQgIT09IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1tleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoLTFdLnN0YXR1cyl7XG4gICAgICAgICAgICBwcm9ncmVzcy5jdXJyZW50LS07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcHJvZ3Jlc3M7XG4gICAgfVxuXG4gICAgYWRkU3RlcCgpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChhcmd1bWVudHNbMF0pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBuZXcgU3RlcChhcmd1bWVudHNbMF0sIHRoaXMuam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHN0ZXAuZG9FeGVjdXRlID0gYXJndW1lbnRzWzFdO1xuICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChzdGVwKTtcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uTGlzdGVuZXIge1xuICAgIC8qQ2FsbGVkIGJlZm9yZSBhIHN0ZXAgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZVN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgc3RlcC4gQ2FsbGVkIGFmdGVyIGJvdGggc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV4ZWN1dGlvbnMqL1xuICAgIGFmdGVyU3RlcChqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4vam9iLWV4ZWN1dGlvblwiO1xuXG4vKlxuIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBleGVjdXRpb24gb2YgYSBzdGVwXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uIHtcbiAgICBpZDtcbiAgICBzdGVwTmFtZTtcbiAgICBqb2JFeGVjdXRpb247XG5cbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkVYRUNVVElORztcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTsgLy9leGVjdXRpb24gY29udGV4dCBmb3Igc2luZ2xlIHN0ZXAgbGV2ZWwsXG5cbiAgICBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIHRlcm1pbmF0ZU9ubHkgPSBmYWxzZTsgLy9mbGFnIHRvIGluZGljYXRlIHRoYXQgYW4gZXhlY3V0aW9uIHNob3VsZCBoYWx0XG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKHN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zdGVwTmFtZSA9IHN0ZXBOYW1lO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25JZCA9IGpvYkV4ZWN1dGlvbi5pZDtcbiAgICB9XG5cbiAgICBnZXRKb2JQYXJhbWV0ZXJzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgIH1cblxuICAgIGdldERUTyhmaWx0ZXJlZFByb3BlcnRpZXM9W10sIGRlZXBDbG9uZSA9IHRydWUpe1xuXG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYoZmlsdGVyZWRQcm9wZXJ0aWVzLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihbXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gVXRpbHMuZ2V0RXJyb3JEVE8odmFsdWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcInN0ZXBFeGVjdXRpb25zXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGNvbmZpZ3VyYXRpb24gb2YgYSBqb2Igc3RlcCovXG5leHBvcnQgY2xhc3MgU3RlcCB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIGlzUmVzdGFydGFibGUgPSB0cnVlO1xuICAgIHNraXBPblJlc3RhcnRJZkNvbXBsZXRlZD10cnVlO1xuICAgIHN0ZXBzID0gW107XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIHNldEpvYlJlcG9zaXRvcnkoam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIC8qUHJvY2VzcyB0aGUgc3RlcCBhbmQgYXNzaWduIHByb2dyZXNzIGFuZCBzdGF0dXMgbWV0YSBpbmZvcm1hdGlvbiB0byB0aGUgU3RlcEV4ZWN1dGlvbiBwcm92aWRlZCovXG4gICAgZXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiRXhlY3V0aW5nIHN0ZXA6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVEVEO1xuICAgICAgICB2YXIgZXhpdFN0YXR1cztcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbikudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG5cbiAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZVN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgdGhpcy5vcGVuKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgIH0pLnRoZW4oX3N0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24gPSBfc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXM7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gTmVlZCB0byB1cGdyYWRlIGhlcmUgbm90IHNldCwgaW4gY2FzZSB0aGUgZXhlY3V0aW9uIHdhcyBzdG9wcGVkXG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gc3VjY2VzczogbmFtZT1cIiArIHRoaXMubmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IHRoaXMuZGV0ZXJtaW5lSm9iU3RhdHVzKGUpO1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IHN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgYW4gZXJyb3IgZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVyU3RlcChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBpbiBhZnRlclN0ZXAgY2FsbGJhY2sgaW4gc3RlcCBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5lbmRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IGV4aXRTdGF0dXM7XG5cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfSkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2Uoc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIHdoaWxlIGNsb3Npbmcgc3RlcCBleGVjdXRpb24gcmVzb3VyY2VzIGluIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGRvRXhlY3V0aW9uUmVsZWFzZSgpO1xuXG4gICAgICAgICAgICBsb2cuZGVidWcoXCJTdGVwIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIgKyBzdGVwRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGRldGVybWluZUpvYlN0YXR1cyhlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gZXhlY3V0ZSBidXNpbmVzcyBsb2dpYy4gU3ViY2xhc3NlcyBzaG91bGQgc2V0IHRoZSBleGl0U3RhdHVzIG9uIHRoZVxuICAgICAqIFN0ZXBFeGVjdXRpb24gYmVmb3JlIHJldHVybmluZy4gTXVzdCByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAqL1xuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgc3RlcCwgdG8gb3BlbiBvclxuICAgICAqIGFjcXVpcmUgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBvcGVuKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgZW5kIG9mIGEgc3RlcCAocmlnaHQgYXQgdGhlIGVuZFxuICAgICAqIG9mIHRoZSBmaW5hbGx5IGJsb2NrKSwgdG8gY2xvc2Ugb3IgcmVsZWFzZSByZXNvdXJjZXMuIERvZXMgbm90aGluZyBieSBkZWZhdWx0LlxuICAgICAqL1xuICAgIGNsb3NlKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQgKiBhcyBlbmdpbmUgZnJvbSAnLi9lbmdpbmUvaW5kZXgnXG5cbmV4cG9ydCB7ZW5naW5lfVxuZXhwb3J0ICogZnJvbSAnLi9qb2JzLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi13b3JrZXInXG5cblxuXG4iLCJpbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4vZW5naW5lL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnIHtcbiAgICBvbkpvYlN0YXJ0ZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYkNvbXBsZXRlZCA9IHJlc3VsdCA9PiB7fTtcbiAgICBvbkpvYkZhaWxlZCA9IGVycm9ycyA9PiB7fTtcbiAgICBvbkpvYlN0b3BwZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYlRlcm1pbmF0ZWQgPSAoKSA9PiB7fTtcbiAgICBvblByb2dyZXNzID0gKHByb2dyZXNzKSA9PiB7fTtcbiAgICBjYWxsYmFja3NUaGlzQXJnO1xuICAgIHVwZGF0ZUludGVydmFsID0gMTAwO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLypjb252ZW5pZW5jZSBjbGFzcyBmb3IgbWFuYWdpbmcgYW5kIHRyYWNraW5nIGpvYiBpbnN0YW5jZSBwcm9ncmVzcyovXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG4gICAgam9ic01hbmdlcjtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBjb25maWc7XG5cbiAgICBsYXN0Sm9iRXhlY3V0aW9uO1xuICAgIGxhc3RVcGRhdGVUaW1lO1xuICAgIHByb2dyZXNzID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKGpvYnNNYW5nZXIsIGpvYkluc3RhbmNlT3JFeGVjdXRpb24sIGNvbmZpZykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JJbnN0YW5jZU1hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyID0gam9ic01hbmdlcjtcbiAgICAgICAgaWYgKGpvYkluc3RhbmNlT3JFeGVjdXRpb24gaW5zdGFuY2VvZiBKb2JJbnN0YW5jZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYkluc3RhbmNlO1xuICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubGFzdEpvYkV4ZWN1dGlvbiAmJiAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICB0aGlzLmFmdGVySm9iKHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgam9ic01hbmdlci5yZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgIH1cblxuICAgIGNoZWNrUHJvZ3Jlc3MoKSB7XG5cbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICBpZiAodGhpcy50ZXJtaW5hdGVkIHx8ICF0aGlzLmxhc3RKb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkgfHwgdGhpcy5nZXRQcm9ncmVzc1BlcmNlbnRzKHRoaXMucHJvZ3Jlc3MpID09PSAxMDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZ2V0UHJvZ3Jlc3ModGhpcy5sYXN0Sm9iRXhlY3V0aW9uKS50aGVuKHByb2dyZXNzPT4ge1xuICAgICAgICAgICAgdGhpcy5sYXN0VXBkYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBpZiAocHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gcHJvZ3Jlc3M7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Qcm9ncmVzcy5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcHJvZ3Jlc3MpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0sIHRoaXMuY29uZmlnLnVwZGF0ZUludGVydmFsKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlN0YXJ0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzUGVyY2VudHMocHJvZ3Jlc3MpIHtcbiAgICAgICAgaWYgKCFwcm9ncmVzcykge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb2dyZXNzLmN1cnJlbnQgKiAxMDAgLyBwcm9ncmVzcy50b3RhbDtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkICE9PSB0aGlzLmpvYkluc3RhbmNlLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICBpZiAoSk9CX1NUQVRVUy5DT01QTEVURUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG4gICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gdGhpcy5nZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMucHJvZ3Jlc3MpO1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFJlc3VsdChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UpLnRoZW4ocmVzdWx0PT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iQ29tcGxldGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCByZXN1bHQuZGF0YSk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuRkFJTEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkZhaWxlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zKTtcblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuU1RPUFBFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdG9wcGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oZm9yY2VVcGRhdGUgPSBmYWxzZSkge1xuICAgICAgICBpZiAoIXRoaXMubGFzdEpvYkV4ZWN1dGlvbiB8fCBmb3JjZVVwZGF0ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGplO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHN0b3AoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5zdG9wKHRoaXMubGFzdEpvYkV4ZWN1dGlvbilcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4odGhpcy5qb2JJbnN0YW5jZS5qb2JOYW1lLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycy52YWx1ZXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIudGVybWluYXRlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy50ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlRlcm1pbmF0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmxhc3RKb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiZXhwb3J0IGNsYXNzIEpvYldvcmtlcntcblxuICAgIHdvcmtlcjtcbiAgICBsaXN0ZW5lcnMgPSB7fTtcbiAgICBkZWZhdWx0TGlzdGVuZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIGRlZmF1bHRMaXN0ZW5lciwgb25FcnJvcil7XG4gICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICAgIHRoaXMud29ya2VyID0gbmV3IFdvcmtlcih1cmwpO1xuICAgICAgICB0aGlzLmRlZmF1bHRMaXN0ZW5lciA9IGRlZmF1bHRMaXN0ZW5lciB8fCBmdW5jdGlvbigpIHt9O1xuICAgICAgICBpZiAob25FcnJvcikge3RoaXMud29ya2VyLm9uZXJyb3IgPSBvbkVycm9yO31cblxuICAgICAgICB0aGlzLndvcmtlci5vbm1lc3NhZ2UgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmRhdGEgaW5zdGFuY2VvZiBPYmplY3QgJiZcbiAgICAgICAgICAgICAgICBldmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZExpc3RlbmVyJykgJiYgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IGluc3RhbmNlLmxpc3RlbmVyc1tldmVudC5kYXRhLnF1ZXJ5TWV0aG9kTGlzdGVuZXJdO1xuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gZXZlbnQuZGF0YS5xdWVyeU1ldGhvZEFyZ3VtZW50cztcbiAgICAgICAgICAgICAgICBpZihsaXN0ZW5lci5kZXNlcmlhbGl6ZXIpe1xuICAgICAgICAgICAgICAgICAgICBhcmdzID0gbGlzdGVuZXIuZGVzZXJpYWxpemVyKGFyZ3MpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsaXN0ZW5lci5mbi5hcHBseShsaXN0ZW5lci50aGlzQXJnLCBhcmdzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIuY2FsbChpbnN0YW5jZSwgZXZlbnQuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlbmRRdWVyeSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdKb2JXb3JrZXIuc2VuZFF1ZXJ5IHRha2VzIGF0IGxlYXN0IG9uZSBhcmd1bWVudCcpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZCc6IGFyZ3VtZW50c1swXSxcbiAgICAgICAgICAgICdxdWVyeUFyZ3VtZW50cyc6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcnVuSm9iKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncnVuSm9iJywgam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTylcbiAgICB9XG5cbiAgICBleGVjdXRlSm9iKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ2V4ZWN1dGVKb2InLCBqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICByZWNvbXB1dGUoZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncmVjb21wdXRlJywgZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpXG4gICAgfVxuXG4gICAgcG9zdE1lc3NhZ2UobWVzc2FnZSkge1xuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG5cbiAgICB0ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMud29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgIH1cblxuICAgIGFkZExpc3RlbmVyKG5hbWUsIGxpc3RlbmVyLCB0aGlzQXJnLCBkZXNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnNbbmFtZV0gPSB7XG4gICAgICAgICAgICBmbjogbGlzdGVuZXIsXG4gICAgICAgICAgICB0aGlzQXJnOiB0aGlzQXJnIHx8IHRoaXMsXG4gICAgICAgICAgICBkZXNlcmlhbGl6ZXI6IGRlc2VyaWFsaXplclxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKG5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMubGlzdGVuZXJzW25hbWVdO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL24td2F5L3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtKb2JMYXVuY2hlcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1sYXVuY2hlclwiO1xuaW1wb3J0IHtKb2JXb3JrZXJ9IGZyb20gXCIuL2pvYi13b3JrZXJcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9uTGlzdGVuZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJZGJKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvaWRiLWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iXCI7XG5pbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9zZW5zaXRpdml0eS1hbmFseXNpcy9wcm9iYWJpbGlzdGljL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge1RpbWVvdXRKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvdGltZW91dC1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtUb3JuYWRvRGlhZ3JhbUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2JcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U2ltcGxlSm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vZW5naW5lL2pvYi1yZXBvc2l0b3J5L3NpbXBsZS1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtMZWFndWVUYWJsZUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvbGVhZ3VlLXRhYmxlL2xlYWd1ZS10YWJsZS1qb2JcIjtcbmltcG9ydCB7U3BpZGVyUGxvdEpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvc2Vuc2l0aXZpdHktYW5hbHlzaXMvc3BpZGVyLXBsb3Qvc3BpZGVyLXBsb3Qtam9iXCI7XG5cblxuZXhwb3J0IGNsYXNzIEpvYnNNYW5hZ2VyQ29uZmlnIHtcblxuICAgIHdvcmtlclVybCA9IG51bGw7XG4gICAgcmVwb3NpdG9yeVR5cGUgPSAnaWRiJztcbiAgICBjbGVhclJlcG9zaXRvcnkgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKGN1c3RvbSkge1xuICAgICAgICBpZiAoY3VzdG9tKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMsIGN1c3RvbSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBKb2JzTWFuYWdlciBleHRlbmRzIEpvYkV4ZWN1dGlvbkxpc3RlbmVyIHtcblxuXG4gICAgdXNlV29ya2VyO1xuICAgIGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuICAgIGpvYkxhdW5jaGVyO1xuXG4gICAgam9iRXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBhZnRlckpvYkV4ZWN1dGlvblByb21pc2VSZXNvbHZlcyA9IHt9O1xuICAgIGpvYkluc3RhbmNlc1RvVGVybWluYXRlID0ge307XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyLCBjb25maWcpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcblxuXG4gICAgICAgIHRoaXMudXNlV29ya2VyID0gISF0aGlzLmNvbmZpZy53b3JrZXJVcmw7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5pbml0V29ya2VyKHRoaXMuY29uZmlnLndvcmtlclVybCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmluaXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYnMoKTtcblxuXG5cbiAgICAgICAgdGhpcy5qb2JMYXVuY2hlciA9IG5ldyBKb2JMYXVuY2hlcih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuam9iV29ya2VyLCAoZGF0YSk9PnRoaXMuc2VyaWFsaXplRGF0YShkYXRhKSk7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JzTWFuYWdlckNvbmZpZyhjb25maWcpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBpbml0UmVwb3NpdG9yeSgpIHtcbiAgICAgICAgaWYodGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUgPT09ICdpZGInKXtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeSA9IG5ldyBJZGJKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpLCAnc2Qtam9iLXJlcG9zaXRvcnknLCB0aGlzLmNvbmZpZy5jbGVhclJlcG9zaXRvcnkpO1xuICAgICAgICB9ZWxzZSBpZigndGltZW91dCcpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFRpbWVvdXRKb2JSZXBvc2l0b3J5KHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5nZXRKc29uUmV2aXZlcigpKTtcbiAgICAgICAgfWVsc2UgaWYoJ3NpbXBsZScpe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IFNpbXBsZUpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxvZy5lcnJvcignSm9ic01hbmFnZXIgY29uZmlndXJhdGlvbiBlcnJvciEgVW5rbm93biByZXBvc2l0b3J5IHR5cGU6ICcrdGhpcy5jb25maWcucmVwb3NpdG9yeVR5cGUrJy4gVXNpbmcgZGVmYXVsdDogaWRiJyk7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5yZXBvc2l0b3J5VHlwZSA9ICdpZGInO1xuICAgICAgICAgICAgdGhpcy5pbml0UmVwb3NpdG9yeSgpXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlcmlhbGl6ZURhdGEoZGF0YSkge1xuICAgICAgICByZXR1cm4gZGF0YS5zZXJpYWxpemUodHJ1ZSwgZmFsc2UsIGZhbHNlLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZ2V0SnNvblJlcGxhY2VyKCkpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzKGpvYkV4ZWN1dGlvbk9ySWQpIHtcbiAgICAgICAgdmFyIGlkID0gam9iRXhlY3V0aW9uT3JJZDtcbiAgICAgICAgaWYgKCFVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSkge1xuICAgICAgICAgICAgaWQgPSBqb2JFeGVjdXRpb25PcklkLmlkXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhpZCk7XG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgcnVuKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkID0gdHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JMYXVuY2hlci5ydW4oam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkIHx8ICFqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy9qb2Igd2FzIGRlbGVnYXRlZCB0byB3b3JrZXIgYW5kIGlzIHN0aWxsIHJ1bm5pbmdcblxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXSA9IHJlc29sdmU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZXhlY3V0ZShqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkxhdW5jaGVyLmV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgfVxuXG4gICAgc3RvcChqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHZhciBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIGlmICghVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpIHtcbiAgICAgICAgICAgIGlkID0gam9iRXhlY3V0aW9uT3JJZC5pZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGlkKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmICgham9iRXhlY3V0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iIEV4ZWN1dGlvbiBub3QgZm91bmQ6IFwiICsgam9iRXhlY3V0aW9uT3JJZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSkge1xuICAgICAgICAgICAgICAgIGxvZy53YXJuKFwiSm9iIEV4ZWN1dGlvbiBub3QgcnVubmluZywgc3RhdHVzOiBcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIiwgZW5kVGltZTogXCIgKyBqb2JFeGVjdXRpb24uZW5kVGltZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb24uaWQsIEpPQl9FWEVDVVRJT05fRkxBRy5TVE9QKS50aGVuKCgpPT5qb2JFeGVjdXRpb24pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnN0b3Agam9iIGV4ZWN1dGlvbiBpZiBydW5uaW5nIGFuZCBkZWxldGUgam9iIGluc3RhbmNlIGZyb20gcmVwb3NpdG9yeSovXG4gICAgdGVybWluYXRlKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIGlmKGpvYkV4ZWN1dGlvbi5pc1J1bm5pbmcoKSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uLmlkLCBKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCkudGhlbigoKT0+am9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5yZW1vdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZVtqb2JJbnN0YW5jZS5pZF09am9iSW5zdGFuY2U7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgfVxuXG5cbiAgICBjcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMpIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgIHJldHVybiBqb2IuY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JQYXJhbWV0ZXJzVmFsdWVzKTtcbiAgICB9XG5cblxuICAgIC8qUmV0dXJucyBhIHByb21pc2UqL1xuICAgIGdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICBpZiAodGhpcy51c2VXb3JrZXIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYldvcmtlcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIShqb2JQYXJhbWV0ZXJzIGluc3RhbmNlb2YgSm9iUGFyYW1ldGVycykpIHtcbiAgICAgICAgICAgIGpvYlBhcmFtZXRlcnMgPSB0aGlzLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVycylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgaW5pdFdvcmtlcih3b3JrZXJVcmwpIHtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBuZXcgSm9iV29ya2VyKHdvcmtlclVybCwgKCk9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcignZXJyb3IgaW4gd29ya2VyJywgYXJndW1lbnRzKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBhcmdzRGVzZXJpYWxpemVyID0gKGFyZ3MpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFt0aGlzLmpvYlJlcG9zaXRvcnkucmV2aXZlSm9iRXhlY3V0aW9uKGFyZ3NbMF0pXVxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiYmVmb3JlSm9iXCIsIHRoaXMuYmVmb3JlSm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJhZnRlckpvYlwiLCB0aGlzLmFmdGVySm9iLCB0aGlzLCBhcmdzRGVzZXJpYWxpemVyKTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIuYWRkTGlzdGVuZXIoXCJqb2JGYXRhbEVycm9yXCIsIHRoaXMub25Kb2JGYXRhbEVycm9yLCB0aGlzKTtcbiAgICB9XG5cbiAgICByZWdpc3RlckpvYnMoKSB7XG5cbiAgICAgICAgbGV0IHNlbnNpdGl2aXR5QW5hbHlzaXNKb2IgPSBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKTtcbiAgICAgICAgbGV0IHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iID0gbmV3IFByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpO1xuICAgICAgICBpZighVXRpbHMuaXNXb3JrZXIoKSl7XG4gICAgICAgICAgICBzZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgICAgIHByb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iLnNldEJhdGNoU2l6ZSgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2Ioc2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFRvcm5hZG9EaWFncmFtSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihwcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYik7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFJlY29tcHV0ZUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IExlYWd1ZVRhYmxlSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgU3BpZGVyUGxvdEpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5yZWdpc3RlckpvYihqb2IpO1xuICAgICAgICBqb2IucmVnaXN0ZXJFeGVjdXRpb25MaXN0ZW5lcih0aGlzKVxuICAgIH1cblxuICAgIHJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKSB7XG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJiZWZvcmVKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5iZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImFmdGVySm9iXCIsIHRoaXMudXNlV29ya2VyLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGw9PmwuYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXTtcbiAgICAgICAgaWYgKHByb21pc2VSZXNvbHZlKSB7XG4gICAgICAgICAgICBwcm9taXNlUmVzb2x2ZShqb2JFeGVjdXRpb24pXG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZF0pe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlbW92ZUpvYkluc3RhbmNlKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZSwgam9iRXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgb25Kb2JGYXRhbEVycm9yKGpvYkV4ZWN1dGlvbklkLCBlcnJvcil7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uSWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbklkKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBpZihlcnJvcil7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgIH1cbiAgICAgICAgbG9nLmRlYnVnKCdvbkpvYkZhdGFsRXJyb3InLCBqb2JFeGVjdXRpb25JZCwgZXJyb3IpO1xuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge1xuICAgIEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlLFxuICAgIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLFxuICAgIE1heGlNaW5SdWxlLFxuICAgIE1heGlNYXhSdWxlLFxuICAgIE1pbmlNaW5SdWxlLFxuICAgIE1pbmlNYXhSdWxlXG59IGZyb20gXCIuL3J1bGVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQgKiBhcyBtb2RlbCBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7TWluTWF4UnVsZX0gZnJvbSBcIi4vcnVsZXMvbWluLW1heC1ydWxlXCI7XG5pbXBvcnQge01heE1pblJ1bGV9IGZyb20gXCIuL3J1bGVzL21heC1taW4tcnVsZVwiO1xuaW1wb3J0IHtNaW5NaW5SdWxlfSBmcm9tIFwiLi9ydWxlcy9taW4tbWluLXJ1bGVcIjtcbmltcG9ydCB7TWF4TWF4UnVsZX0gZnJvbSBcIi4vcnVsZXMvbWF4LW1heC1ydWxlXCI7XG5cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxlc01hbmFnZXJ7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGN1cnJlbnRSdWxlO1xuICAgIHJ1bGVCeU5hbWUgPSB7fTtcbiAgICBydWxlcyA9IFtdO1xuXG5cbiAgICBmbGlwUGFpciA9IHt9O1xuICAgIHBheW9mZkluZGV4ID0gMDtcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUsIGN1cnJlbnRSdWxlTmFtZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWF4aU1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgICAgICB0aGlzLmFkZFJ1bGUobmV3IE1heGlNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG5ldyBNaW5pTWluUnVsZShleHByZXNzaW9uRW5naW5lKSk7XG4gICAgICAgIHRoaXMuYWRkUnVsZShuZXcgTWluaU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSkpO1xuXG4gICAgICAgIGxldCBtaW5NYXggPSBuZXcgTWluTWF4UnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1pbk1heCk7XG4gICAgICAgIGxldCBtYXhNaW4gPSBuZXcgTWF4TWluUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1heE1pbik7XG4gICAgICAgIHRoaXMuYWRkRmxpcFBhaXIobWluTWF4LCBtYXhNaW4pO1xuXG4gICAgICAgIGxldCBtaW5NaW4gPSBuZXcgTWluTWluUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1pbk1pbik7XG4gICAgICAgIGxldCBtYXhNYXggPSBuZXcgTWF4TWF4UnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5hZGRSdWxlKG1heE1heCk7XG5cblxuICAgICAgICBpZiAoY3VycmVudFJ1bGVOYW1lKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlQnlOYW1lW2N1cnJlbnRSdWxlTmFtZV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlc1swXTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG5cbiAgICBzZXRQYXlvZmZJbmRleChwYXlvZmZJbmRleCl7XG4gICAgICAgIHRoaXMucGF5b2ZmSW5kZXggPSBwYXlvZmZJbmRleCB8fCAwO1xuICAgIH1cblxuICAgIGFkZFJ1bGUocnVsZSl7XG4gICAgICAgIHRoaXMucnVsZUJ5TmFtZVtydWxlLm5hbWVdPXJ1bGU7XG4gICAgICAgIHRoaXMucnVsZXMucHVzaChydWxlKTtcbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgIHJldHVybiAhIXRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV1cbiAgICB9XG5cbiAgICBzZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSl7XG4gICAgICAgIHRoaXMuY3VycmVudFJ1bGUgPSB0aGlzLnJ1bGVCeU5hbWVbcnVsZU5hbWVdO1xuICAgIH1cblxuICAgIGdldE9iamVjdGl2ZVJ1bGVCeU5hbWUocnVsZU5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXTtcbiAgICB9XG5cbiAgICBmbGlwUnVsZSgpe1xuICAgICAgICB2YXIgZmxpcHBlZCA9IHRoaXMuZmxpcFBhaXJbdGhpcy5jdXJyZW50UnVsZS5uYW1lXTtcbiAgICAgICAgaWYoZmxpcHBlZCl7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gZmxpcHBlZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHVwZGF0ZURlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KGRlZmF1bHRDcml0ZXJpb24xV2VpZ2h0KXtcbiAgICAgICAgdGhpcy5ydWxlcy5maWx0ZXIocj0+ci5tdWx0aUNyaXRlcmlhKS5mb3JFYWNoKHI9PnIuc2V0RGVmYXVsdENyaXRlcmlvbjFXZWlnaHQoZGVmYXVsdENyaXRlcmlvbjFXZWlnaHQpKTtcbiAgICB9XG5cbiAgICByZWNvbXB1dGUoZGF0YU1vZGVsLCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0aW5nIHJ1bGVzLCBhbGw6ICcrYWxsUnVsZXMpO1xuXG4gICAgICAgIGRhdGFNb2RlbC5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5yZWNvbXB1dGVUcmVlKG4sIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB0aW1lICA9IChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIHN0YXJ0VGltZS8xMDAwKTtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGF0aW9uIHRvb2sgJyt0aW1lKydzJyk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcmVjb21wdXRlVHJlZShyb290LCBhbGxSdWxlcywgZGVjaXNpb25Qb2xpY3k9bnVsbCl7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMgZm9yIHRyZWUgLi4uJywgcm9vdCk7XG5cbiAgICAgICAgdmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuXG4gICAgICAgIHZhciBydWxlcyAgPSBbdGhpcy5jdXJyZW50UnVsZV07XG4gICAgICAgIGlmKGFsbFJ1bGVzKXtcbiAgICAgICAgICAgIHJ1bGVzID0gdGhpcy5ydWxlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJ1bGVzLmZvckVhY2gocnVsZT0+IHtcbiAgICAgICAgICAgIHJ1bGUuc2V0UGF5b2ZmSW5kZXgodGhpcy5wYXlvZmZJbmRleCk7XG4gICAgICAgICAgICBydWxlLnNldERlY2lzaW9uUG9saWN5KGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgICAgIHJ1bGUuY29tcHV0ZVBheW9mZihyb290KTtcbiAgICAgICAgICAgIHJ1bGUuY29tcHV0ZU9wdGltYWwocm9vdCk7XG4gICAgICAgICAgICBydWxlLmNsZWFyRGVjaXNpb25Qb2xpY3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lKS8xMDAwO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cblxuICAgIGdldE5vZGVEaXNwbGF5VmFsdWUobm9kZSwgbmFtZSkge1xuICAgICAgICByZXR1cm4gbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgbmFtZSlcblxuICAgIH1cblxuICAgIGdldEVkZ2VEaXNwbGF5VmFsdWUoZSwgbmFtZSl7XG4gICAgICAgIGlmKG5hbWU9PT0ncHJvYmFiaWxpdHknKXtcbiAgICAgICAgICAgIGlmKGUucGFyZW50Tm9kZSBpbnN0YW5jZW9mIG1vZGVsLmRvbWFpbi5EZWNpc2lvbk5vZGUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCAncHJvYmFiaWxpdHknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGUucGFyZW50Tm9kZSBpbnN0YW5jZW9mIG1vZGVsLmRvbWFpbi5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgaWYobmFtZT09PSdwYXlvZmYnKXtcbiAgICAgICAgICAgIGlmKHRoaXMuY3VycmVudFJ1bGUubXVsdGlDcml0ZXJpYSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncGF5b2ZmJyk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmZbJyArdGhpcy5wYXlvZmZJbmRleCArICddJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J29wdGltYWwnKXtcbiAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCAnb3B0aW1hbCcpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRGbGlwUGFpcihydWxlMSwgcnVsZTIpIHtcbiAgICAgICAgdGhpcy5mbGlwUGFpcltydWxlMS5uYW1lXSA9IHJ1bGUyO1xuICAgICAgICB0aGlzLmZsaXBQYWlyW3J1bGUyLm5hbWVdID0gcnVsZTE7XG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gJ3NkLXV0aWxzJ1xuXG4vKmV4cGVjdGVkIHZhbHVlIG1heGltaXphdGlvbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdleHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKEV4cGVjdGVkVmFsdWVNYXhpbWl6YXRpb25SdWxlLk5BTUUsIHRydWUsIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmY9MCwgcHJvYmFiaWxpdHlUb0VudGVyPTEpe1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgaWYgKCB0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSkscGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKmV4cGVjdGVkIHZhbHVlIG1pbmltaXphdGlvbiBydWxlKi9cbmV4cG9ydCBjbGFzcyBFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdleHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLk5BTUUsIGZhbHNlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmPTAsIHByb2JhYmlsaXR5VG9FbnRlcj0xKXtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSl7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGlmICggdGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpICkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJleHBvcnQgKiBmcm9tICcuL29iamVjdGl2ZS1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9leHBlY3RlZC12YWx1ZS1tYXhpbWl6YXRpb24tcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21heGktbWluLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWF4LXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL21pbmktbWluLXJ1bGUnXG5cblxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNYXhNYXhSdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXgtbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhNYXhSdWxlLk5BTUUsIFsxLCAxXSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtNdWx0aUNyaXRlcmlhUnVsZX0gZnJvbSBcIi4vbXVsdGktY3JpdGVyaWEtcnVsZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNYXhNaW5SdWxlIGV4dGVuZHMgTXVsdGlDcml0ZXJpYVJ1bGV7XG5cbiAgICBzdGF0aWMgTkFNRSA9ICdtYXgtbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhNaW5SdWxlLk5BTUUsIFsxLCAtMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWF4UnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSk8YmVzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC9iZXN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1heEJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWluUnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY29tcHV0ZWRQYXlvZmYob3B0aW1hbEVkZ2UuY2hpbGROb2RlKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jb21wdXRlZFBheW9mZihub2RlKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7TXVsdGlDcml0ZXJpYVJ1bGV9IGZyb20gXCIuL211bHRpLWNyaXRlcmlhLXJ1bGVcIjtcblxuXG5leHBvcnQgY2xhc3MgTWluTWF4UnVsZSBleHRlbmRzIE11bHRpQ3JpdGVyaWFSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnbWluLW1heCc7XG5cbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgc3VwZXIoTWluTWF4UnVsZS5OQU1FLCBbLTEsIDFdLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge011bHRpQ3JpdGVyaWFSdWxlfSBmcm9tIFwiLi9tdWx0aS1jcml0ZXJpYS1ydWxlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1pbk1pblJ1bGUgZXh0ZW5kcyBNdWx0aUNyaXRlcmlhUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbi1taW4nO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHN1cGVyKE1pbk1pblJ1bGUuTkFNRSwgWy0xLCAtMV0sIGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWF4UnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jb21wdXRlZFBheW9mZihvcHRpbWFsRWRnZS5jaGlsZE5vZGUpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNvbXB1dGVkUGF5b2ZmKG5vZGUpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWluUnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNvbXB1dGVkUGF5b2ZmKGUuY2hpbGROb2RlKT53b3JzdENoaWxkUGF5b2ZmID8gMC4wIDogKDEuMC93b3JzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5taW5CeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNvbXB1dGVkUGF5b2ZmKG9wdGltYWxFZGdlLmNoaWxkTm9kZSkuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY29tcHV0ZWRQYXlvZmYobm9kZSksIHBheW9mZikuZXF1YWxzKHRoaXMuY29tcHV0ZWRQYXlvZmYoZS5jaGlsZE5vZGUpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gXCIuL29iamVjdGl2ZS1ydWxlXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBNdWx0aUNyaXRlcmlhUnVsZSBleHRlbmRzIE9iamVjdGl2ZVJ1bGUge1xuXG4gICAgY3JpdGVyaW9uMVdlaWdodCA9IDE7XG4gICAgcGF5b2ZmQ29lZmZzID0gWzEsIC0xXTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIHBheW9mZkNvZWZmcywgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihuYW1lLCB0cnVlLCBleHByZXNzaW9uRW5naW5lLCB0cnVlKTtcbiAgICAgICAgdGhpcy5wYXlvZmZDb2VmZnMgPSBwYXlvZmZDb2VmZnM7XG5cbiAgICB9XG5cbiAgICBzZXREZWZhdWx0Q3JpdGVyaW9uMVdlaWdodChjcml0ZXJpb24xV2VpZ2h0KSB7XG4gICAgICAgIHRoaXMuY3JpdGVyaW9uMVdlaWdodCA9IGNyaXRlcmlvbjFXZWlnaHQ7XG4gICAgfVxuXG4gICAgLy8gcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmLCBhZ2dyZWdhdGVkUGF5b2ZmIC0gYWdncmVnYXRlZCBwYXlvZmYgYWxvbmcgcGF0aFxuICAgIGNvbXB1dGVQYXlvZmYobm9kZSwgcGF5b2ZmID0gWzAsIDBdLCBhZ2dyZWdhdGVkUGF5b2ZmID0gWzAsIDBdKSB7XG4gICAgICAgIHZhciBjaGlsZHJlblBheW9mZiA9IFswLCAwXTtcbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSB7XG5cbiAgICAgICAgICAgICAgICB2YXIgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgICAgICAgICAgdmFyIGJlc3RDaGlsZCA9IC1JbmZpbml0eTtcblxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGJhc2VQYXlvZmZzID0gW3RoaXMuYmFzZVBheW9mZihlLCAwKSwgdGhpcy5iYXNlUGF5b2ZmKGUsIDEpXTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkUGF5b2ZmID0gdGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCBiYXNlUGF5b2ZmcywgW3RoaXMuYWRkKGJhc2VQYXlvZmZzWzBdLCBhZ2dyZWdhdGVkUGF5b2ZmWzBdKSwgdGhpcy5hZGQoYmFzZVBheW9mZnNbMV0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMV0pXSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjaGlsZENvbWJpbmVkUGF5b2ZmID0gdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdjb21iaW5lZFBheW9mZicpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGRDb21iaW5lZFBheW9mZiA+IGJlc3RDaGlsZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENoaWxkID0gY2hpbGRDb21iaW5lZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkSW5kZXhlcyA9IFtpXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChiZXN0Q2hpbGQuZXF1YWxzKGNoaWxkQ29tYmluZWRQYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZGVjaXNpb25Qb2xpY3kpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRJbmRleGVzID0gW107XG4gICAgICAgICAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbih0aGlzLmRlY2lzaW9uUG9saWN5LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRlY2lzaW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMgPSBbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlLCBpKT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgYmFzZVBheW9mZnMgPSBbdGhpcy5iYXNlUGF5b2ZmKGUsIDApLCB0aGlzLmJhc2VQYXlvZmYoZSwgMSldO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIGJhc2VQYXlvZmZzLCBbdGhpcy5hZGQoYmFzZVBheW9mZnNbMF0sIGFnZ3JlZ2F0ZWRQYXlvZmZbMF0pLCB0aGlzLmFkZChiYXNlUGF5b2Zmc1sxXSwgYWdncmVnYXRlZFBheW9mZlsxXSldKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBzdW13ZWlnaHQgPSAwO1xuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBzdW13ZWlnaHQgPSB0aGlzLmFkZChzdW13ZWlnaHQsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoc3Vtd2VpZ2h0ID4gMCkge1xuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUGF5b2ZmLmZvckVhY2goKHAsIGkpPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGVwID0gdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmZbJyArIGkgKyAnXScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmZbaV0gPSB0aGlzLmFkZChwLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLCBlcCkuZGl2KHN1bXdlaWdodCkpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgfVxuICAgICAgICBwYXlvZmYuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICBwYXlvZmZbaV0gPSB0aGlzLmFkZChwLCBjaGlsZHJlblBheW9mZltpXSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhub2RlKTtcblxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ2FnZ3JlZ2F0ZWRQYXlvZmYnLCBhZ2dyZWdhdGVkUGF5b2ZmKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCAwKTsgLy9pbml0aWFsIHZhbHVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnY2hpbGRyZW5QYXlvZmYnLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnY29tYmluZWRQYXlvZmYnLCB0aGlzLmNvbXB1dGVDb21iaW5lZFBheW9mZihwYXlvZmYpKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZicsIHBheW9mZik7XG4gICAgfVxuXG4gICAgY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKHBheW9mZil7XG4gICAgICAgIC8vIFtjcml0ZXJpb24gMSBjb2VmZl0qW2NyaXRlcmlvbiAxXSpbd2VpZ2h0XStbY3JpdGVyaW9uIDIgY29lZmZdKltjcml0ZXJpb24gMl1cbiAgICAgICAgaWYgKHRoaXMuY3JpdGVyaW9uMVdlaWdodCA9PT0gSW5maW5pdHkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm11bHRpcGx5KHRoaXMucGF5b2ZmQ29lZmZzWzBdLCBwYXlvZmZbMF0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmFkZCh0aGlzLm11bHRpcGx5KHRoaXMucGF5b2ZmQ29lZmZzWzBdLCB0aGlzLm11bHRpcGx5KHRoaXMuY3JpdGVyaW9uMVdlaWdodCwgcGF5b2ZmWzBdKSksIHRoaXMubXVsdGlwbHkodGhpcy5wYXlvZmZDb2VmZnNbMV0sIHBheW9mZlsxXSkpO1xuICAgIH1cblxuICAgIC8vICBjb21iaW5lZFBheW9mZiAtIHBhcmVudCBlZGdlIGNvbWJpbmVkUGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgY29tYmluZWRQYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCAnY29tYmluZWRQYXlvZmYnKSwgY29tYmluZWRQYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ2NvbWJpbmVkUGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuY29tcHV0ZUNvbWJpbmVkUGF5b2ZmKFt0aGlzLmJhc2VQYXlvZmYoZSwgMCksIHRoaXMuYmFzZVBheW9mZihlLCAxKV0pLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxufVxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi4vLi4vcG9saWNpZXMvcG9saWN5XCI7XG5cbi8qQmFzZSBjbGFzcyBmb3Igb2JqZWN0aXZlIHJ1bGVzKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxlIHtcbiAgICBuYW1lO1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG5cbiAgICBkZWNpc2lvblBvbGljeTtcbiAgICBtYXhpbWl6YXRpb247XG5cbiAgICBwYXlvZmZJbmRleCA9IDA7XG4gICAgbXVsdGlDcml0ZXJpYSA9IGZhbHNlO1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgbWF4aW1pemF0aW9uLCBleHByZXNzaW9uRW5naW5lLCBtdWx0aUNyaXRlcmlhPWZhbHNlKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMubWF4aW1pemF0aW9uID0gbWF4aW1pemF0aW9uO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLm11bHRpQ3JpdGVyaWEgPSBtdWx0aUNyaXRlcmlhO1xuICAgIH1cblxuICAgIHNldERlY2lzaW9uUG9saWN5KGRlY2lzaW9uUG9saWN5KSB7XG4gICAgICAgIHRoaXMuZGVjaXNpb25Qb2xpY3kgPSBkZWNpc2lvblBvbGljeTtcbiAgICB9XG5cbiAgICBzZXRQYXlvZmZJbmRleChwYXlvZmZJbmRleCkge1xuICAgICAgICB0aGlzLnBheW9mZkluZGV4ID0gcGF5b2ZmSW5kZXg7XG4gICAgfVxuXG4gICAgY2xlYXJEZWNpc2lvblBvbGljeSgpIHtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IG51bGw7XG4gICAgfVxuXG4gICAgLy8gc2hvdWxkIHJldHVybiBhcnJheSBvZiBzZWxlY3RlZCBjaGlsZHJlbiBpbmRleGVzXG4gICAgbWFrZURlY2lzaW9uKGRlY2lzaW9uTm9kZSwgY2hpbGRyZW5QYXlvZmZzKSB7XG4gICAgICAgIHZhciBiZXN0O1xuICAgICAgICBpZiAodGhpcy5tYXhpbWl6YXRpb24pIHtcbiAgICAgICAgICAgIGJlc3QgPSB0aGlzLm1heCguLi5jaGlsZHJlblBheW9mZnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYmVzdCA9IHRoaXMubWluKC4uLmNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHNlbGVjdGVkSW5kZXhlcyA9IFtdO1xuICAgICAgICBjaGlsZHJlblBheW9mZnMuZm9yRWFjaCgocCwgaSk9PiB7XG4gICAgICAgICAgICBpZiAoRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKGJlc3QsIHApID09IDApIHtcbiAgICAgICAgICAgICAgICBzZWxlY3RlZEluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBzZWxlY3RlZEluZGV4ZXM7XG4gICAgfVxuXG4gICAgX21ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcykge1xuICAgICAgICBpZiAodGhpcy5kZWNpc2lvblBvbGljeSkge1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZiAoZGVjaXNpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLm1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyk7XG4gICAgfVxuXG4gICAgLy8gZXh0ZW5zaW9uIHBvaW50IGZvciBjaGFuZ2luZyBjb21wdXRlZCBwcm9iYWJpbGl0eSBvZiBlZGdlcyBpbiBhIGNoYW5jZSBub2RlXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KSB7XG5cbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmYgPSAwLCBhZ2dyZWdhdGVkUGF5b2ZmID0gMCkge1xuICAgICAgICB2YXIgY2hpbGRyZW5QYXlvZmYgPSAwO1xuICAgICAgICBpZiAobm9kZS5jaGlsZEVkZ2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSB0aGlzLl9tYWtlRGVjaXNpb24obm9kZSwgbm9kZS5jaGlsZEVkZ2VzLm1hcChlPT50aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSkpKTtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5Jywgc2VsZWN0ZWRJbmRleGVzLmluZGV4T2YoaSkgPCAwID8gMC4wIDogMS4wKTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgIHZhciB3b3JzdENoaWxkID0gSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q291bnQgPSAxO1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNoaWxkUGF5b2ZmID0gdGhpcy5jb21wdXRlUGF5b2ZmKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMuYWRkKHRoaXMuYmFzZVBheW9mZihlKSwgYWdncmVnYXRlZFBheW9mZikpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGRQYXlvZmYgPCB3b3JzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50ID0gMTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjaGlsZFBheW9mZi5lcXVhbHMod29yc3RDaGlsZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcnN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZFBheW9mZiA+IGJlc3RDaGlsZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNoaWxkUGF5b2ZmLmVxdWFscyhiZXN0Q2hpbGQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5tb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShub2RlLmNoaWxkRWRnZXMsIGJlc3RDaGlsZCwgYmVzdENvdW50LCB3b3JzdENoaWxkLCB3b3JzdENvdW50KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDA7XG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodCA9IHRoaXMuYWRkKHN1bXdlaWdodCwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKHBheW9mZixub2RlLmNoaWxkRWRnZXMsJ3N1bXdlaWdodCcsc3Vtd2VpZ2h0KTtcbiAgICAgICAgICAgIGlmIChzdW13ZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5QYXlvZmYgPSB0aGlzLmFkZChjaGlsZHJlblBheW9mZiwgdGhpcy5tdWx0aXBseSh0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSwgdGhpcy5jb21wdXRlZFBheW9mZihlLmNoaWxkTm9kZSkpLmRpdihzdW13ZWlnaHQpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cblxuICAgICAgICBwYXlvZmYgPSB0aGlzLmFkZChwYXlvZmYsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKG5vZGUpO1xuXG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnYWdncmVnYXRlZFBheW9mZicrICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXScsIGFnZ3JlZ2F0ZWRQYXlvZmYpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIDApOyAvL2luaXRpYWwgdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicgKyAnWycgKyB0aGlzLnBheW9mZkluZGV4ICsgJ10nLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5jb21wdXRlZFBheW9mZihub2RlLCBwYXlvZmYpO1xuICAgIH1cblxuICAgIC8vIGtvbG9ydWplIG9wdHltYWxuZSDFm2NpZcW8a2lcbiAgICBjb21wdXRlT3B0aW1hbChub2RlKSB7XG4gICAgICAgIHRocm93ICdjb21wdXRlT3B0aW1hbCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHJ1bGU6ICcgKyB0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvKiBnZXQgb3Igc2V0IGNvbXB1dGVkIHBheW9mZiovXG4gICAgY29tcHV0ZWRQYXlvZmYobm9kZSwgdmFsdWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZlsnICsgdGhpcy5wYXlvZmZJbmRleCArICddJywgdmFsdWUpXG4gICAgfVxuXG4gICAgLypHZXQgb3Igc2V0IG9iamVjdCdzIGNvbXB1dGVkIHZhbHVlIGZvciBjdXJyZW50IHJ1bGUqL1xuICAgIGNWYWx1ZShvYmplY3QsIGZpZWxkUGF0aCwgdmFsdWUpIHtcbiAgICAgICAgLy8gaWYoZmllbGRQYXRoLnRyaW0oKSA9PT0gJ3BheW9mZicpe1xuICAgICAgICAvLyAgICAgZmllbGRQYXRoICs9ICdbJyArIHRoaXMucGF5b2ZmSW5kZXggKyAnXSc7XG4gICAgICAgIC8vIH1cblxuICAgICAgICByZXR1cm4gb2JqZWN0LmNvbXB1dGVkVmFsdWUodGhpcy5uYW1lLCBmaWVsZFBhdGgsIHZhbHVlKTtcbiAgICB9XG5cbiAgICBiYXNlUHJvYmFiaWxpdHkoZWRnZSkge1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgIH1cblxuICAgIGJhc2VQYXlvZmYoZWRnZSwgcGF5b2ZmSW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGVkZ2UuY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgcGF5b2ZmSW5kZXggfHwgdGhpcy5wYXlvZmZJbmRleCk7XG4gICAgfVxuXG4gICAgY2xlYXJDb21wdXRlZFZhbHVlcyhvYmplY3QpIHtcbiAgICAgICAgb2JqZWN0LmNsZWFyQ29tcHV0ZWRWYWx1ZXModGhpcy5uYW1lKTtcbiAgICB9XG5cbiAgICBhZGQoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5hZGQoYSwgYilcbiAgICB9XG5cbiAgICBzdWJ0cmFjdChhLCBiKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KGEsIGIpXG4gICAgfVxuXG4gICAgZGl2aWRlKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGEsIGIpXG4gICAgfVxuXG4gICAgbXVsdGlwbHkoYSwgYikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShhLCBiKVxuICAgIH1cblxuICAgIG1heCgpIHtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUubWF4KC4uLmFyZ3VtZW50cylcbiAgICB9XG5cbiAgICBtaW4oKSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1pbiguLi5hcmd1bWVudHMpXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtPcGVyYXRpb259IGZyb20gXCIuL29wZXJhdGlvblwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuXG4vKlN1YnRyZWUgZmxpcHBpbmcgb3BlcmF0aW9uKi9cbmV4cG9ydCBjbGFzcyBGbGlwU3VidHJlZSBleHRlbmRzIE9wZXJhdGlvbntcblxuICAgIHN0YXRpYyAkTkFNRSA9ICdmbGlwU3VidHJlZSc7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihGbGlwU3VidHJlZS4kTkFNRSk7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIGlzQXBwbGljYWJsZShvYmplY3Qpe1xuICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZVxuICAgIH1cblxuICAgIGNhblBlcmZvcm0obm9kZSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWNhYmxlKG5vZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZSh0aGlzLmRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUobm9kZSkpLmlzVmFsaWQoKSkgeyAvL2NoZWNrIGlmIHRoZSB3aG9sZSBzdWJ0cmVlIGlzIHByb3BlclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuTnVtYmVyID0gbnVsbDtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzID0gW107XG4gICAgICAgIHZhciBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KCk7XG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldDtcbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMuZXZlcnkoZT0+IHtcblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IGUuY2hpbGROb2RlO1xuICAgICAgICAgICAgICAgIGlmICghKGNoaWxkIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuaGFzKGUubmFtZS50cmltKCkpKSB7IC8vIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuYWRkKGUubmFtZS50cmltKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5OdW1iZXIgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbk51bWJlciA9IGNoaWxkLmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA8IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ2U9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5wdXNoKGdlLm5hbWUudHJpbSgpKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuc2l6ZSAhPT0gZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMubGVuZ3RoKSB7IC8vZ3JhbmRjaGlsZHJlbiBlZGdlIGxhYmVscyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGggIT0gZ3JhbmRjaGlsZHJlbk51bWJlcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFjaGlsZC5jaGlsZEVkZ2VzLmV2ZXJ5KChnZSwgaSk9PmdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzW2ldID09PSBnZS5uYW1lLnRyaW0oKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICB9KSkge1xuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBwZXJmb3JtKHJvb3QpIHtcblxuICAgICAgICB2YXIgcm9vdENsb25lID0gdGhpcy5kYXRhLmNsb25lU3VidHJlZShyb290LCB0cnVlKTtcbiAgICAgICAgdmFyIG9sZENoaWxkcmVuTnVtYmVyID0gcm9vdC5jaGlsZEVkZ2VzLmxlbmd0aDtcbiAgICAgICAgdmFyIG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXMubGVuZ3RoO1xuXG4gICAgICAgIHZhciBjaGlsZHJlbk51bWJlciA9IG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXI7XG4gICAgICAgIHZhciBncmFuZENoaWxkcmVuTnVtYmVyID0gb2xkQ2hpbGRyZW5OdW1iZXI7XG5cbiAgICAgICAgdmFyIGNhbGxiYWNrc0Rpc2FibGVkID0gdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSB0cnVlO1xuXG5cbiAgICAgICAgdmFyIGNoaWxkWCA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueDtcbiAgICAgICAgdmFyIHRvcFkgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG4gICAgICAgIHZhciBib3R0b21ZID0gcm9vdC5jaGlsZEVkZ2VzW29sZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmNoaWxkRWRnZXNbb2xkR3JhbmRDaGlsZHJlbk51bWJlciAtIDFdLmNoaWxkTm9kZS5sb2NhdGlvbi55O1xuXG4gICAgICAgIHZhciBleHRlbnRZID0gYm90dG9tWSAtIHRvcFk7XG4gICAgICAgIHZhciBzdGVwWSA9IGV4dGVudFkgLyAoY2hpbGRyZW5OdW1iZXIgKyAxKTtcblxuICAgICAgICByb290LmNoaWxkRWRnZXMuc2xpY2UoKS5mb3JFYWNoKGU9PiB0aGlzLmRhdGEucmVtb3ZlTm9kZShlLmNoaWxkTm9kZSkpO1xuXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZHJlbk51bWJlcjsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBuZXcgbW9kZWwuQ2hhbmNlTm9kZShuZXcgbW9kZWwuUG9pbnQoY2hpbGRYLCB0b3BZICsgKGkgKyAxKSAqIHN0ZXBZKSk7XG4gICAgICAgICAgICB2YXIgZWRnZSA9IHRoaXMuZGF0YS5hZGROb2RlKGNoaWxkLCByb290KTtcbiAgICAgICAgICAgIGVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLm5hbWU7XG5cbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSAwO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGdyYW5kQ2hpbGRyZW5OdW1iZXI7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY2hpbGROb2RlO1xuXG5cbiAgICAgICAgICAgICAgICB2YXIgZ3JhbmRDaGlsZEVkZ2UgPSB0aGlzLmRhdGEuYXR0YWNoU3VidHJlZShncmFuZENoaWxkLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLm5hbWU7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucGF5b2ZmID0gW1xuICAgICAgICAgICAgICAgICAgICBFeHByZXNzaW9uRW5naW5lLmFkZChyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAwKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMCkpLFxuICAgICAgICAgICAgICAgICAgICBFeHByZXNzaW9uRW5naW5lLmFkZChyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCAxKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUGF5b2ZmKHVuZGVmaW5lZCwgMSkpLFxuICAgICAgICAgICAgICAgIF07XG5cbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUubXVsdGlwbHkocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKSwgcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKSk7XG4gICAgICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGVkZ2UucHJvYmFiaWxpdHksIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHAsIGVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgaWYgKGVkZ2UucHJvYmFiaWxpdHkuZXF1YWxzKDApKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb2IgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCBncmFuZENoaWxkcmVuTnVtYmVyKTtcbiAgICAgICAgICAgICAgICBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5ID0gcCA9PiBwcm9iO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ3JhbmRDaGlsZEVkZ2U9PiB7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSBkaXZpZGVHcmFuZENoaWxkRWRnZVByb2JhYmlsaXR5KGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAoY2hpbGQuY2hpbGRFZGdlcywgcHJvYmFiaWxpdHlTdW0pO1xuICAgICAgICAgICAgZWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZWRnZS5wcm9iYWJpbGl0eSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKHJvb3QuY2hpbGRFZGdlcyk7XG5cblxuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSBjYWxsYmFja3NEaXNhYmxlZDtcbiAgICAgICAgdGhpcy5kYXRhLl9maXJlTm9kZUFkZGVkQ2FsbGJhY2soKTtcbiAgICB9XG5cbiAgICBfbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSl7XG4gICAgICAgIGlmKCFwcm9iYWJpbGl0eVN1bSl7XG4gICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGUucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgIGxvZy5pbmZvKCdTdW0gb2YgdGhlIHByb2JhYmlsaXRpZXMgaW4gY2hpbGQgbm9kZXMgaXMgbm90IGVxdWFsIHRvIDEgOiAnLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICB2YXIgbmV3UHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICB2YXIgY2YgPSAxMDAwMDAwMDAwMDAwOyAvLzEwXjEyXG4gICAgICAgICAgICB2YXIgcHJlYyA9IDEyO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgZS5wcm9iYWJpbGl0eSA9IHBhcnNlSW50KEV4cHJlc3Npb25FbmdpbmUucm91bmQoZS5wcm9iYWJpbGl0eSwgcHJlYykgKiBjZik7XG4gICAgICAgICAgICAgICAgbmV3UHJvYmFiaWxpdHlTdW0gPSBuZXdQcm9iYWJpbGl0eVN1bSArIGUucHJvYmFiaWxpdHk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHZhciByZXN0ID0gY2YgLSBuZXdQcm9iYWJpbGl0eVN1bTtcbiAgICAgICAgICAgIGxvZy5pbmZvKCdOb3JtYWxpemluZyB3aXRoIHJvdW5kaW5nIHRvIHByZWNpc2lvbjogJyArIHByZWMsIHJlc3QpO1xuICAgICAgICAgICAgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHJlc3QsIGNoaWxkRWRnZXNbMF0ucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgbmV3UHJvYmFiaWxpdHlTdW0gPSAwLjA7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwYXJzZUludChlLnByb2JhYmlsaXR5KSwgY2YpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsIlxuLypCYXNlIGNsYXNzIGZvciBjb21wbGV4IG9wZXJhdGlvbnMgb24gdHJlZSBzdHJ1Y3R1cmUqL1xuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbntcblxuICAgIG5hbWU7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lKXtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB9XG5cbiAgICAvL2NoZWNrIGlmIG9wZXJhdGlvbiBpcyBwb3RlbnRpYWxseSBhcHBsaWNhYmxlIGZvciBvYmplY3RcbiAgICBpc0FwcGxpY2FibGUoKXtcbiAgICAgICAgdGhyb3cgJ2lzQXBwbGljYWJsZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cbiAgICAvL2NoZWNrIGlmIGNhbiBwZXJmb3JtIG9wZXJhdGlvbiBmb3IgYXBwbGljYWJsZSBvYmplY3RcbiAgICBjYW5QZXJmb3JtKG9iamVjdCl7XG4gICAgICAgIHRocm93ICdjYW5QZXJmb3JtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIHBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ3BlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RmxpcFN1YnRyZWV9IGZyb20gXCIuL2ZsaXAtc3VidHJlZVwiO1xuXG5cbmV4cG9ydCBjbGFzcyBPcGVyYXRpb25zTWFuYWdlciB7XG5cbiAgICBvcGVyYXRpb25zID0gW107XG4gICAgb3BlcmF0aW9uQnlOYW1lID0ge307XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5yZWdpc3Rlck9wZXJhdGlvbihuZXcgRmxpcFN1YnRyZWUoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkpO1xuICAgIH1cblxuICAgIHJlZ2lzdGVyT3BlcmF0aW9uKG9wZXJhdGlvbil7XG4gICAgICAgIHRoaXMub3BlcmF0aW9ucy5wdXNoKG9wZXJhdGlvbik7XG4gICAgICAgIHRoaXMub3BlcmF0aW9uQnlOYW1lW29wZXJhdGlvbi5uYW1lXSA9IG9wZXJhdGlvbjtcbiAgICB9XG5cblxuICAgIGdldE9wZXJhdGlvbkJ5TmFtZShuYW1lKXtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9uQnlOYW1lW25hbWVdO1xuICAgIH1cblxuICAgIG9wZXJhdGlvbnNGb3JPYmplY3Qob2JqZWN0KXtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BlcmF0aW9ucy5maWx0ZXIob3A9Pm9wLmlzQXBwbGljYWJsZShvYmplY3QpKVxuICAgIH1cblxufVxuIiwiXG5leHBvcnQgY2xhc3MgRGVjaXNpb257XG4gICAgbm9kZTtcbiAgICBkZWNpc2lvblZhbHVlOyAvL2luZGV4IG9mICBzZWxlY3RlZCBlZGdlXG4gICAgY2hpbGRyZW4gPSBbXTtcbiAgICBrZXk7XG5cbiAgICBjb25zdHJ1Y3Rvcihub2RlLCBkZWNpc2lvblZhbHVlKSB7XG4gICAgICAgIHRoaXMubm9kZSA9IG5vZGU7XG4gICAgICAgIHRoaXMuZGVjaXNpb25WYWx1ZSA9IGRlY2lzaW9uVmFsdWU7XG4gICAgICAgIHRoaXMua2V5ID0gRGVjaXNpb24uZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgc3RhdGljIGdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eT0nJGlkJyl7XG4gICAgICAgIHZhciBlID0gZGVjaXNpb24ubm9kZS5jaGlsZEVkZ2VzW2RlY2lzaW9uLmRlY2lzaW9uVmFsdWVdO1xuICAgICAgICB2YXIga2V5ID0gZGVjaXNpb24ubm9kZVtrZXlQcm9wZXJ0eV0rXCI6XCIrKGVba2V5UHJvcGVydHldPyBlW2tleVByb3BlcnR5XSA6IGRlY2lzaW9uLmRlY2lzaW9uVmFsdWUrMSk7XG4gICAgICAgIHJldHVybiBrZXkucmVwbGFjZSgvXFxuL2csICcgJyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5jaGlsZHJlbi5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBEZWNpc2lvbi5nZXREZWNpc2lvbih0aGlzLCBkZWNpc2lvbk5vZGUpXG4gICAgfVxuXG4gICAgc3RhdGljIGdldERlY2lzaW9uKGRlY2lzaW9uLCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBpZihkZWNpc2lvbi5ub2RlPT09ZGVjaXNpb25Ob2RlIHx8IGRlY2lzaW9uLm5vZGUuJGlkID09PSBkZWNpc2lvbk5vZGUuJGlkKXtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICAgICAgfVxuICAgICAgICBmb3IodmFyIGk9MDsgaTxkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICB2YXIgZCA9IERlY2lzaW9uLmdldERlY2lzaW9uKGRlY2lzaW9uLmNoaWxkcmVuW2ldLCBkZWNpc2lvbk5vZGUpO1xuICAgICAgICAgICAgaWYoZCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0aWMgdG9EZWNpc2lvblN0cmluZyhkZWNpc2lvbiwgZXh0ZW5kZWQ9ZmFsc2UsIGtleVByb3BlcnR5PSduYW1lJywgaW5kZW50ID0gJycpe1xuXG4gICAgICAgIHZhciByZXMgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleShkZWNpc2lvbiwga2V5UHJvcGVydHkpO1xuICAgICAgICB2YXIgY2hpbGRyZW5SZXMgPSBcIlwiO1xuXG4gICAgICAgIGRlY2lzaW9uLmNoaWxkcmVuLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYoY2hpbGRyZW5SZXMpe1xuICAgICAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gJ1xcbicraW5kZW50O1xuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCxleHRlbmRlZCxrZXlQcm9wZXJ0eSwgaW5kZW50KydcXHQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYoZGVjaXNpb24uY2hpbGRyZW4ubGVuZ3RoKXtcbiAgICAgICAgICAgIGlmKGV4dGVuZGVkKXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9ICAnXFxuJytpbmRlbnQgK2NoaWxkcmVuUmVzO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW5SZXMgPSBcIiAtIChcIiArIGNoaWxkcmVuUmVzICsgXCIpXCI7XG4gICAgICAgICAgICB9XG5cblxuXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzK2NoaWxkcmVuUmVzO1xuICAgIH1cblxuICAgIHRvRGVjaXNpb25TdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcodGhpcywgaW5kZW50KVxuICAgIH1cbn1cbiIsImltcG9ydCB7UG9saWN5fSBmcm9tIFwiLi9wb2xpY3lcIjtcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7VXRpbHN9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtEZWNpc2lvbn0gZnJvbSBcIi4vZGVjaXNpb25cIjtcblxuZXhwb3J0IGNsYXNzIFBvbGljaWVzQ29sbGVjdG9ye1xuICAgIHBvbGljaWVzID0gW107XG4gICAgcnVsZU5hbWU9ZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3Rvcihyb290LCBvcHRpbWFsRm9yUnVsZU5hbWUpe1xuICAgICAgICB0aGlzLnJ1bGVOYW1lID0gb3B0aW1hbEZvclJ1bGVOYW1lO1xuICAgICAgICB0aGlzLmNvbGxlY3Qocm9vdCkuZm9yRWFjaCgoZGVjaXNpb25zLGkpPT57XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzLnB1c2gobmV3IFBvbGljeShcIiNcIisoaSsxKSwgZGVjaXNpb25zKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBpZih0aGlzLnBvbGljaWVzLmxlbmd0aD09PTEpe1xuICAgICAgICAgICAgdGhpcy5wb2xpY2llc1swXS5pZCA9IFwiZGVmYXVsdFwiXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb2xsZWN0KHJvb3Qpe1xuICAgICAgICB2YXIgbm9kZVF1ZXVlID0gW3Jvb3RdO1xuICAgICAgICB2YXIgbm9kZTtcbiAgICAgICAgdmFyIGRlY2lzaW9uTm9kZXMgPSBbXTtcbiAgICAgICAgd2hpbGUobm9kZVF1ZXVlLmxlbmd0aCl7XG4gICAgICAgICAgICBub2RlID0gbm9kZVF1ZXVlLnNoaWZ0KCk7XG5cbiAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIW5vZGUuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSl7XG4gICAgICAgICAgICAgICAgZGVjaXNpb25Ob2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcbiAgICAgICAgICAgICAgICBub2RlUXVldWUucHVzaChlZGdlLmNoaWxkTm9kZSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVXRpbHMuY2FydGVzaWFuUHJvZHVjdE9mKGRlY2lzaW9uTm9kZXMubWFwKChkZWNpc2lvbk5vZGUpPT57XG4gICAgICAgICAgICB2YXIgZGVjaXNpb25zPSBbXTtcbiAgICAgICAgICAgIGRlY2lzaW9uTm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goKGVkZ2UsIGkpPT57XG5cbiAgICAgICAgICAgICAgICBpZih0aGlzLnJ1bGVOYW1lICYmICFlZGdlLmNvbXB1dGVkVmFsdWUodGhpcy5ydWxlTmFtZSwgJ29wdGltYWwnKSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgY2hpbGREZWNpc2lvbnMgPSB0aGlzLmNvbGxlY3QoZWRnZS5jaGlsZE5vZGUpOyAvL2FsbCBwb3NzaWJsZSBjaGlsZCBkZWNpc2lvbnMgKGNhcnRlc2lhbilcbiAgICAgICAgICAgICAgICBjaGlsZERlY2lzaW9ucy5mb3JFYWNoKGNkPT57XG4gICAgICAgICAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGkpO1xuICAgICAgICAgICAgICAgICAgICBkZWNpc2lvbnMucHVzaChkZWNpc2lvbik7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9uLmNoaWxkcmVuID0gY2Q7XG4gICAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gZGVjaXNpb25zO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWN5e1xuICAgIGlkO1xuICAgIGRlY2lzaW9ucyA9IFtdO1xuXG4gICAgY29uc3RydWN0b3IoaWQsIGRlY2lzaW9ucyl7XG4gICAgICAgIHRoaXMuaWQgPSBpZDtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgPSBkZWNpc2lvbnMgfHwgW107XG4gICAgICAgIHRoaXMua2V5ID0gUG9saWN5LmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgIH1cblxuICAgIGFkZERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpe1xuICAgICAgICB2YXIgZGVjaXNpb24gPSBuZXcgRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSk7XG4gICAgICAgIHRoaXMuZGVjaXNpb25zIC5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkocG9saWN5KXtcbiAgICAgICAgdmFyIGtleSA9IFwiXCI7XG4gICAgICAgIHBvbGljeS5kZWNpc2lvbnMuZm9yRWFjaChkPT5rZXkrPShrZXk/IFwiJlwiOiBcIlwiKStkLmtleSk7XG4gICAgICAgIHJldHVybiBrZXk7XG4gICAgfVxuXG4gICAgZXF1YWxzKHBvbGljeSwgaWdub3JlSWQ9dHJ1ZSl7XG4gICAgICAgIGlmKHRoaXMua2V5ICE9IHBvbGljeS5rZXkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGlnbm9yZUlkIHx8IHRoaXMuaWQgPT09IHBvbGljeS5pZDtcbiAgICB9XG5cbiAgICBnZXREZWNpc2lvbihkZWNpc2lvbk5vZGUpe1xuICAgICAgICByZXR1cm4gUG9saWN5LmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSk7XG4gICAgfVxuXG4gICAgc3RhdGljIGdldERlY2lzaW9uKHBvbGljeSwgZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgZm9yKHZhciBpPTA7IGk8cG9saWN5LmRlY2lzaW9ucy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICB2YXIgZGVjaXNpb24gPSBEZWNpc2lvbi5nZXREZWNpc2lvbihwb2xpY3kuZGVjaXNpb25zW2ldLCBkZWNpc2lvbk5vZGUpO1xuICAgICAgICAgICAgaWYoZGVjaXNpb24pe1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBzdGF0aWMgdG9Qb2xpY3lTdHJpbmcocG9saWN5LCBleHRlbmRlZD1mYWxzZSwgcHJlcGVuZElkPWZhbHNlKXtcblxuICAgICAgICB2YXIgcmVzID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PntcbiAgICAgICAgICAgIGlmKHJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICByZXMgKz0gXCJcXG5cIlxuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICByZXMgKz0gXCIsIFwiXG4gICAgICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlcyArPSBEZWNpc2lvbi50b0RlY2lzaW9uU3RyaW5nKGQsIGV4dGVuZGVkLCAnbmFtZScsICdcXHQnKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHByZXBlbmRJZCAmJiBwb2xpY3kuaWQhPT11bmRlZmluZWQpe1xuICAgICAgICAgICAgcmV0dXJuIHBvbGljeS5pZCtcIiBcIityZXM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG5cblxuICAgIHRvUG9saWN5U3RyaW5nKGluZGVudD1mYWxzZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kudG9Qb2xpY3lTdHJpbmcodGhpcywgaW5kZW50KVxuICAgIH1cblxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cblxuZXhwb3J0IGNsYXNzIE1jZG1XZWlnaHRWYWx1ZVZhbGlkYXRvcntcblxuICAgIGFkZGl0aW9uYWxWYWxpZGF0b3IgPSBudWxsO1xuXG4gICAgY29uc3RydWN0b3IoYWRkaXRpb25hbFZhbGlkYXRvcil7XG4gICAgICAgIHRoaXMuYWRkaXRpb25hbFZhbGlkYXRvciA9IGFkZGl0aW9uYWxWYWxpZGF0b3I7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcGFyc2VkID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgICAgIGlmKHBhcnNlZCAhPT0gSW5maW5pdHkgJiYgIUV4cHJlc3Npb25FbmdpbmUudmFsaWRhdGUodmFsdWUsIHt9LCBmYWxzZSkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICB2YXIgbWF4U2FmZUludGVnZXIgPSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiB8fCA5MDA3MTk5MjU0NzQwOTkxOyAvLyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiBpcyB1bmRlZmluZWQgaW4gSUVcbiAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCAwKSA8IDAgfHwgKHZhbHVlICE9PSBJbmZpbml0eSAmJiBFeHByZXNzaW9uRW5naW5lLmNvbXBhcmUodmFsdWUsIG1heFNhZmVJbnRlZ2VyKT4gMCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYodGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hZGRpdGlvbmFsVmFsaWRhdG9yKEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFBheW9mZlZhbHVlVmFsaWRhdG9ye1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZT1leHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIHZhbGlkYXRlKHZhbHVlKXtcblxuXG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHZhciBtYXhTYWZlSW50ZWdlciA9IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIHx8IDkwMDcxOTkyNTQ3NDA5OTE7IC8vIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIGluIHVuZGVmaW5lZCBpbiBJRVxuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCAtbWF4U2FmZUludGVnZXIpID49IDAgJiYgRXhwcmVzc2lvbkVuZ2luZS5jb21wYXJlKHZhbHVlLCBtYXhTYWZlSW50ZWdlcikgPD0gMDtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcntcbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmU9ZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSwgZWRnZSl7XG4gICAgICAgIGlmKHZhbHVlPT09bnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB2YWx1ZSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIodmFsdWUpO1xuICAgICAgICByZXR1cm4gdmFsdWUuY29tcGFyZSgwKSA+PSAwICYmIHZhbHVlLmNvbXBhcmUoMSkgPD0gMDtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsLCBWYWxpZGF0aW9uUmVzdWx0fSBmcm9tIFwic2QtbW9kZWxcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge1Byb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3Byb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQYXlvZmZWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcGF5b2ZmLXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgVHJlZVZhbGlkYXRvciB7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IgPSBuZXcgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvciA9IG5ldyBQYXlvZmZWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShub2Rlcykge1xuXG4gICAgICAgIHZhciB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKTtcblxuICAgICAgICBub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnZhbGlkYXRlTm9kZShuLCB2YWxpZGF0aW9uUmVzdWx0KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVOb2RlKG5vZGUsIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpKSB7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ2luY29tcGxldGVQYXRoJywgbm9kZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgIHZhciB3aXRoSGFzaCA9IGZhbHNlO1xuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgdHJ1ZSk7XG5cbiAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eSA9IGUuY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKTtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMucHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwcm9iYWJpbGl0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQcm9iYWJpbGl0eScsIGRhdGE6IHsnbnVtYmVyJzogaSArIDF9fSwgbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBwcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBlLnBheW9mZi5mb3JFYWNoKChyYXdQYXlvZmYsIHBheW9mZkluZGV4KT0+IHtcbiAgICAgICAgICAgICAgICB2YXIgcGF0aCA9ICdwYXlvZmZbJyArIHBheW9mZkluZGV4ICsgJ10nO1xuICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eShwYXRoLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gZS5jb21wdXRlZEJhc2VQYXlvZmYodW5kZWZpbmVkLCBwYXlvZmZJbmRleCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnBheW9mZlZhbHVlVmFsaWRhdG9yLnZhbGlkYXRlKHBheW9mZikpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQYXlvZmYnLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkocGF0aCwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBpZiAoaXNOYU4ocHJvYmFiaWxpdHlTdW0pIHx8ICFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdwcm9iYWJpbGl0eURvTm90U3VtVXBUbzEnLCBub2RlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9zcmMvaW5kZXgnXG4iXX0=
