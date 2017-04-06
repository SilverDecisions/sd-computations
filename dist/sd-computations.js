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

},{"./expressions-evaluator":5,"./jobs/engine/exceptions/job-data-invalid-exception":26,"./jobs/engine/exceptions/job-parameters-invalid-exception":30,"./jobs/job-instance-manager":53,"./jobs/jobs-manager":55,"./objective/objective-rules-manager":56,"./operations/operations-manager":67,"./policies/policy":70,"./validation/tree-validator":73,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],4:[function(require,module,exports){
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

},{"./computations-engine":2,"./computations-manager":3,"./expressions-evaluator":5,"./jobs/index":52}],7:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":40,"../../engine/job-parameters":41,"sd-utils":"sd-utils"}],8:[function(require,module,exports){
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

var _initPoliciesStep = require("../sensitivity-analysis/steps/init-policies-step");

var _sensitivityAnalysisJob = require("../sensitivity-analysis/sensitivity-analysis-job");

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
        _classCallCheck(this, ProbabilisticSensitivityAnalysisJob);

        var _this = _possibleConstructorReturn(this, (ProbabilisticSensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(ProbabilisticSensitivityAnalysisJob)).call(this, jobRepository, expressionsEvaluator, objectiveRulesManager));

        _this.name = "probabilistic-sensitivity-analysis";
        return _this;
    }

    _createClass(ProbabilisticSensitivityAnalysisJob, [{
        key: "initSteps",
        value: function initSteps() {
            this.addStep(new _initPoliciesStep.InitPoliciesStep(this.jobRepository));
            this.addStep(new _probCalculateStep.ProbCalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
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

},{"../sensitivity-analysis/sensitivity-analysis-job":14,"../sensitivity-analysis/steps/init-policies-step":16,"./probabilistic-sensitivity-analysis-job-parameters":7,"./steps/compute-policy-stats-step":9,"./steps/prob-calculate-step":10}],9:[function(require,module,exports){
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
                payoffsPerPolicy[row.policyIndex].push(row.payoff);
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

},{"../../../engine/job-status":46,"../../../engine/step":51,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],10:[function(require,module,exports){
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

var _batchStep = require("../../../engine/batch/batch-step");

var _treeValidator = require("../../../../validation/tree-validator");

var _policy = require("../../../../policies/policy");

var _calculateStep = require("../../sensitivity-analysis/steps/calculate-step");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
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
                jobResult.data.expectedValues = new Array(jobResult.data.policies.length).fill(0);
                jobResult.data.policyToHighestPayoffCount = new Array(jobResult.data.policies.length).fill(0);
                jobResult.data.policyToLowestPayoffCount = new Array(jobResult.data.policies.length).fill(0);
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
                variables.forEach(function (v) {
                    var evaluated = _this2.expressionsEvaluator.expressionEngine.eval(v.formula, true, _sdUtils.Utils.cloneDeep(data.expressionScope));
                    singleRunVariableValues.push(_sdExpressionEngine.ExpressionEngine.toFloat(evaluated));
                });
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

            policies.forEach(function (policy, i) {
                var payoff = r.payoffs[i];
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

},{"../../../../policies/policy":70,"../../../../validation/tree-validator":73,"../../../engine/batch/batch-step":23,"../../sensitivity-analysis/steps/calculate-step":15,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],11:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":40,"../../engine/job-parameters":41,"sd-utils":"sd-utils"}],12:[function(require,module,exports){
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

},{"../../../validation/tree-validator":73,"../../engine/batch/batch-step":23,"../../engine/job":47,"../../engine/job-status":46,"../../engine/simple-job":48,"../../engine/step":51,"./recompute-job-parameters":11}],13:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":40,"../../engine/job-parameters":41,"sd-utils":"sd-utils"}],14:[function(require,module,exports){
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

var _policy = require("../../../policies/policy");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
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

        return _possibleConstructorReturn(this, (SensitivityAnalysisJob.__proto__ || Object.getPrototypeOf(SensitivityAnalysisJob)).call(this, "sensitivity-analysis", jobRepository, expressionsEvaluator, objectiveRulesManager));
    }

    _createClass(SensitivityAnalysisJob, [{
        key: "initSteps",
        value: function initSteps() {
            this.addStep(new _prepareVariablesStep.PrepareVariablesStep(this.jobRepository, this.expressionsEvaluator.expressionEngine));
            this.addStep(new _initPoliciesStep.InitPoliciesStep(this.jobRepository));
            this.addStep(new _calculateStep.CalculateStep(this.jobRepository, this.expressionsEvaluator, this.objectiveRulesManager));
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
        key: "jobResultToCsvRows",
        value: function jobResultToCsvRows(jobResult, jobParameters) {
            var withHeaders = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

            var result = [];
            if (withHeaders) {
                var headers = ['policy number', 'policy'];
                jobResult.variableNames.forEach(function (n) {
                    return headers.push(n);
                });
                headers.push('payoff');
                result.push(headers);
            }

            jobResult.rows.forEach(function (row) {
                var policy = jobResult.policies[row.policyIndex];
                var rowCells = [row.policyIndex + 1, _policy.Policy.toPolicyString(policy, jobParameters.values.extendedPolicyDescription)];
                row.variables.forEach(function (v) {
                    return rowCells.push(v);
                });
                rowCells.push(row.payoff);
                result.push(rowCells);
            });

            return result;
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

},{"../../../policies/policy":70,"../../engine/simple-job":48,"./sensitivity-analysis-job-parameters":13,"./steps/calculate-step":15,"./steps/init-policies-step":16,"./steps/prepare-variables-step":17}],15:[function(require,module,exports){
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

            policies.forEach(function (policy) {
                var payoff = 'n/a';
                if (valid) {
                    _this2.objectiveRulesManager.recomputeTree(treeRoot, false, policy);
                    payoff = treeRoot.computedValue(ruleName, 'payoff');
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

},{"../../../../policies/policy":70,"../../../../validation/tree-validator":73,"../../../engine/batch/batch-step":23,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],16:[function(require,module,exports){
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

            if (!jobResult.data) {
                jobResult.data = [];
            }

            jobResult.data.policies = policies;

            stepExecution.exitStatus = _jobStatus.JOB_STATUS.COMPLETED;
            return stepExecution;
        }
    }]);

    return InitPoliciesStep;
}(_step.Step);

},{"../../../../policies/policies-collector":69,"../../../engine/job-status":46,"../../../engine/step":51}],17:[function(require,module,exports){
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

var _computationsUtils = require("../../../../computations-utils");

function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}

function _possibleConstructorReturn(self, call) {
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

},{"../../../../computations-utils":4,"../../../engine/job-status":46,"../../../engine/step":51,"sd-utils":"sd-utils"}],18:[function(require,module,exports){
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

},{"../../../../policies/policies-collector":69,"../../../../policies/policy":70,"../../../../validation/tree-validator":73,"../../../engine/batch/batch-step":23,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],19:[function(require,module,exports){
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

},{"../../../../policies/policies-collector":69,"../../../engine/job-status":46,"../../../engine/step":51,"sd-utils":"sd-utils"}],20:[function(require,module,exports){
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

},{"../../../engine/job-status":46,"../../../engine/step":51,"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],21:[function(require,module,exports){
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

},{"../../engine/job-parameter-definition":40,"../../engine/job-parameters":41,"sd-utils":"sd-utils"}],22:[function(require,module,exports){
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

},{"../../engine/simple-job":48,"./steps/calculate-step":18,"./steps/init-policies-step":19,"./steps/prepare-variables-step":20,"./tornado-diagram-job-parameters":21}],23:[function(require,module,exports){
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

},{"../exceptions/job-interrupted-exception":29,"../job-status":46,"../step":51,"sd-utils":"sd-utils"}],24:[function(require,module,exports){
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

},{}],25:[function(require,module,exports){
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

},{"./extendable-error":24,"./job-data-invalid-exception":26,"./job-execution-already-running-exception":27,"./job-instance-already-complete-exception":28,"./job-interrupted-exception":29,"./job-parameters-invalid-exception":30,"./job-restart-exception":31}],26:[function(require,module,exports){
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

},{"./extendable-error":24}],27:[function(require,module,exports){
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

},{"./extendable-error":24}],28:[function(require,module,exports){
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

},{"./extendable-error":24}],29:[function(require,module,exports){
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

},{"./extendable-error":24}],30:[function(require,module,exports){
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

},{"./extendable-error":24}],31:[function(require,module,exports){
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

},{"./extendable-error":24}],32:[function(require,module,exports){
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

},{"sd-utils":"sd-utils"}],33:[function(require,module,exports){
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

},{"./exceptions":25,"./execution-context":32,"./job":47,"./job-execution":36,"./job-execution-flag":34,"./job-execution-listener":35,"./job-instance":37,"./job-key-generator":38,"./job-launcher":39,"./job-parameter-definition":40,"./job-parameters":41,"./job-status":46,"./simple-job":48,"./step":51,"./step-execution":50,"./step-execution-listener":49}],34:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
var JOB_EXECUTION_FLAG = exports.JOB_EXECUTION_FLAG = {
    STOP: 'STOP'
};

},{}],35:[function(require,module,exports){
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

},{}],36:[function(require,module,exports){
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

},{"./execution-context":32,"./job-status":46,"./step-execution":50,"sd-utils":"sd-utils"}],37:[function(require,module,exports){
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

},{}],38:[function(require,module,exports){
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

},{}],39:[function(require,module,exports){
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

},{"./exceptions/job-data-invalid-exception":26,"./exceptions/job-parameters-invalid-exception":30,"./exceptions/job-restart-exception":31,"./job-status":46,"sd-utils":"sd-utils"}],40:[function(require,module,exports){
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

},{"sd-utils":"sd-utils"}],41:[function(require,module,exports){
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

},{"./job-parameter-definition":40,"sd-utils":"sd-utils"}],42:[function(require,module,exports){
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

},{"../execution-context":32,"../job-execution":36,"../job-instance":37,"../step-execution":50,"./job-repository":43,"idb":1,"sd-model":"sd-model","sd-utils":"sd-utils"}],43:[function(require,module,exports){
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

},{"../exceptions/job-execution-already-running-exception":27,"../exceptions/job-instance-already-complete-exception":28,"../execution-context":32,"../job-execution":36,"../job-instance":37,"../job-key-generator":38,"../job-status":46,"../step-execution":50,"sd-utils":"sd-utils"}],44:[function(require,module,exports){
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

},{"./job-repository":43,"sd-utils":"sd-utils"}],45:[function(require,module,exports){
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

},{"./execution-context":32,"./job-status":46,"./step-execution":50,"sd-utils":"sd-utils"}],46:[function(require,module,exports){
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

},{}],47:[function(require,module,exports){
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

},{"./exceptions/job-data-invalid-exception":26,"./exceptions/job-interrupted-exception":29,"./exceptions/job-parameters-invalid-exception":30,"./job-execution-flag":34,"./job-result":45,"./job-status":46,"sd-utils":"sd-utils"}],48:[function(require,module,exports){
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

    function SimpleJob(name, jobRepository, expressionsEvaluator, objectiveRulesManager) {
        _classCallCheck(this, SimpleJob);

        var _this = _possibleConstructorReturn(this, (SimpleJob.__proto__ || Object.getPrototypeOf(SimpleJob)).call(this, name, jobRepository, expressionsEvaluator, objectiveRulesManager));

        _this.initSteps();
        return _this;
    }

    _createClass(SimpleJob, [{
        key: "initSteps",
        value: function initSteps() {}
    }, {
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

},{"./exceptions/job-interrupted-exception":29,"./exceptions/job-restart-exception":31,"./execution-context":32,"./job":47,"./job-execution-flag":34,"./job-status":46,"./step":51,"sd-utils":"sd-utils"}],49:[function(require,module,exports){
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

},{}],50:[function(require,module,exports){
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

},{"./execution-context":32,"./job-execution":36,"./job-status":46,"sd-utils":"sd-utils"}],51:[function(require,module,exports){
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

},{"./exceptions/job-interrupted-exception":29,"./job-status":46,"sd-utils":"sd-utils"}],52:[function(require,module,exports){
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

},{"./engine/index":33,"./job-worker":54,"./jobs-manager":55}],53:[function(require,module,exports){
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

},{"./engine/job-execution-listener":35,"./engine/job-instance":37,"./engine/job-status":46,"sd-utils":"sd-utils"}],54:[function(require,module,exports){
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

},{}],55:[function(require,module,exports){
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

},{"./configurations/probabilistic-sensitivity-analysis/probabilistic-sensitivity-analysis-job":8,"./configurations/recompute/recompute-job":12,"./configurations/sensitivity-analysis/sensitivity-analysis-job":14,"./configurations/tornado-diagram/tornado-diagram-job":22,"./engine/job-execution-flag":34,"./engine/job-execution-listener":35,"./engine/job-launcher":39,"./engine/job-parameters":41,"./engine/job-repository/idb-job-repository":42,"./engine/job-repository/timeout-job-repository":44,"./engine/job-status":46,"./job-worker":54,"sd-utils":"sd-utils"}],56:[function(require,module,exports){
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

},{"./rules":59,"sd-model":"sd-model","sd-utils":"sd-utils"}],57:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],58:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],59:[function(require,module,exports){
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

},{"./expected-value-maximization-rule":57,"./expected-value-minimization-rule":58,"./maxi-max-rule":60,"./maxi-min-rule":61,"./mini-max-rule":62,"./mini-min-rule":63,"./objective-rule":64}],60:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],61:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],62:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],63:[function(require,module,exports){
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

},{"./objective-rule":64,"sd-model":"sd-model","sd-utils":"sd-utils"}],64:[function(require,module,exports){
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

/*Base class for objective rules*/
var ObjectiveRule = exports.ObjectiveRule = function () {
    function ObjectiveRule(name, maximization, expressionEngine) {
        _classCallCheck(this, ObjectiveRule);

        this.name = name;
        this.maximization = maximization;
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
            if (this.maximization) {
                return _sdUtils.Utils.indexesOf(childrenPayoffs, this.max.apply(this, _toConsumableArray(childrenPayoffs)));
            }
            return _sdUtils.Utils.indexesOf(childrenPayoffs, this.min.apply(this, _toConsumableArray(childrenPayoffs)));
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

},{"../../policies/decision":68,"../../policies/policy":70,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],65:[function(require,module,exports){
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

},{"../validation/tree-validator":73,"./operation":66,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],66:[function(require,module,exports){
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

},{}],67:[function(require,module,exports){
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

},{"./flip-subtree":65}],68:[function(require,module,exports){
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

},{}],69:[function(require,module,exports){
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

},{"./decision":68,"./policy":70,"sd-model":"sd-model","sd-utils":"sd-utils"}],70:[function(require,module,exports){
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

},{"./decision":68}],71:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],72:[function(require,module,exports){
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

},{"sd-expression-engine":"sd-expression-engine","sd-utils":"sd-utils"}],73:[function(require,module,exports){
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

},{"./payoff-value-validator":71,"./probability-value-validator":72,"sd-expression-engine":"sd-expression-engine","sd-model":"sd-model","sd-utils":"sd-utils"}],"sd-computations":[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJzcmNcXHNyY1xcY29tcHV0YXRpb25zLWVuZ2luZS5qcyIsInNyY1xcY29tcHV0YXRpb25zLW1hbmFnZXIuanMiLCJzcmNcXGNvbXB1dGF0aW9ucy11dGlscy5qcyIsInNyY1xcZXhwcmVzc2lvbnMtZXZhbHVhdG9yLmpzIiwic3JjXFxpbmRleC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHByb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHByb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iLXBhcmFtZXRlcnMuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzXFxwcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHByb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHN0ZXBzXFxjb21wdXRlLXBvbGljeS1zdGF0cy1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xccHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1xcc3RlcHNcXHByb2ItY2FsY3VsYXRlLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxyZWNvbXB1dGVcXHJlY29tcHV0ZS1qb2ItcGFyYW1ldGVycy5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHJlY29tcHV0ZVxccmVjb21wdXRlLWpvYi5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxzZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVycy5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHNlbnNpdGl2aXR5LWFuYWx5c2lzXFxzZW5zaXRpdml0eS1hbmFseXNpcy1qb2IuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxzZW5zaXRpdml0eS1hbmFseXNpc1xcc3RlcHNcXGNhbGN1bGF0ZS1zdGVwLmpzIiwic3JjXFxqb2JzXFxjb25maWd1cmF0aW9uc1xcc2Vuc2l0aXZpdHktYW5hbHlzaXNcXHN0ZXBzXFxpbml0LXBvbGljaWVzLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFxzZW5zaXRpdml0eS1hbmFseXNpc1xcc3RlcHNcXHByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFx0b3JuYWRvLWRpYWdyYW1cXHN0ZXBzXFxjYWxjdWxhdGUtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHRvcm5hZG8tZGlhZ3JhbVxcc3RlcHNcXGluaXQtcG9saWNpZXMtc3RlcC5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHRvcm5hZG8tZGlhZ3JhbVxcc3RlcHNcXHByZXBhcmUtdmFyaWFibGVzLXN0ZXAuanMiLCJzcmNcXGpvYnNcXGNvbmZpZ3VyYXRpb25zXFx0b3JuYWRvLWRpYWdyYW1cXHRvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVycy5qcyIsInNyY1xcam9ic1xcY29uZmlndXJhdGlvbnNcXHRvcm5hZG8tZGlhZ3JhbVxcdG9ybmFkby1kaWFncmFtLWpvYi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxiYXRjaFxcYmF0Y2gtc3RlcC5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxleHRlbmRhYmxlLWVycm9yLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGluZGV4LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGV4Y2VwdGlvbnNcXGpvYi1leGVjdXRpb24tYWxyZWFkeS1ydW5uaW5nLWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxqb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhjZXB0aW9uc1xcam9iLWludGVycnVwdGVkLWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxqb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxleGNlcHRpb25zXFxqb2ItcmVzdGFydC1leGNlcHRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcZXhlY3V0aW9uLWNvbnRleHQuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcaW5kZXguanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWV4ZWN1dGlvbi1mbGFnLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWV4ZWN1dGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItaW5zdGFuY2UuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWtleS1nZW5lcmF0b3IuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLWxhdW5jaGVyLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1wYXJhbWV0ZXItZGVmaW5pdGlvbi5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItcGFyYW1ldGVycy5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItcmVwb3NpdG9yeVxcaWRiLWpvYi1yZXBvc2l0b3J5LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1yZXBvc2l0b3J5XFxqb2ItcmVwb3NpdG9yeS5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItcmVwb3NpdG9yeVxcdGltZW91dC1qb2ItcmVwb3NpdG9yeS5qcyIsInNyY1xcam9ic1xcZW5naW5lXFxqb2ItcmVzdWx0LmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXGpvYi1zdGF0dXMuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcam9iLmpzIiwic3JjXFxqb2JzXFxlbmdpbmVcXHNpbXBsZS1qb2IuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcc3RlcC1leGVjdXRpb24tbGlzdGVuZXIuanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcc3RlcC1leGVjdXRpb24uanMiLCJzcmNcXGpvYnNcXGVuZ2luZVxcc3RlcC5qcyIsInNyY1xcam9ic1xcaW5kZXguanMiLCJzcmNcXGpvYnNcXGpvYi1pbnN0YW5jZS1tYW5hZ2VyLmpzIiwic3JjXFxqb2JzXFxqb2Itd29ya2VyLmpzIiwic3JjXFxqb2JzXFxqb2JzLW1hbmFnZXIuanMiLCJzcmNcXG9iamVjdGl2ZVxcb2JqZWN0aXZlLXJ1bGVzLW1hbmFnZXIuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXGV4cGVjdGVkLXZhbHVlLW1heGltaXphdGlvbi1ydWxlLmpzIiwic3JjXFxvYmplY3RpdmVcXHJ1bGVzXFxleHBlY3RlZC12YWx1ZS1taW5pbWl6YXRpb24tcnVsZS5qcyIsInNyY1xcb2JqZWN0aXZlXFxydWxlc1xcaW5kZXguanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1heGktbWF4LXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1heGktbWluLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1pbmktbWF4LXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG1pbmktbWluLXJ1bGUuanMiLCJzcmNcXG9iamVjdGl2ZVxccnVsZXNcXG9iamVjdGl2ZS1ydWxlLmpzIiwic3JjXFxvcGVyYXRpb25zXFxmbGlwLXN1YnRyZWUuanMiLCJzcmNcXG9wZXJhdGlvbnNcXG9wZXJhdGlvbi5qcyIsInNyY1xcb3BlcmF0aW9uc1xcb3BlcmF0aW9ucy1tYW5hZ2VyLmpzIiwic3JjXFxwb2xpY2llc1xcZGVjaXNpb24uanMiLCJzcmNcXHBvbGljaWVzXFxwb2xpY2llcy1jb2xsZWN0b3IuanMiLCJzcmNcXHBvbGljaWVzXFxwb2xpY3kuanMiLCJzcmNcXHZhbGlkYXRpb25cXHBheW9mZi12YWx1ZS12YWxpZGF0b3IuanMiLCJzcmNcXHZhbGlkYXRpb25cXHByb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvci5qcyIsInNyY1xcdmFsaWRhdGlvblxcdHJlZS12YWxpZGF0b3IuanMiLCJpbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7Ozs7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ZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiB0b0FycmF5KGFycikge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHJlcXVlc3Q7XG4gICAgdmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuICAgICAgcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG5cbiAgICBwLnJlcXVlc3QgPSByZXF1ZXN0O1xuICAgIHJldHVybiBwO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcbiAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgICAgICAgIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG4gICAgdGhpcy5faW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdtdWx0aUVudHJ5JyxcbiAgICAndW5pcXVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnZ2V0JyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcbiAgICB0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcbiAgICAnZGlyZWN0aW9uJyxcbiAgICAna2V5JyxcbiAgICAncHJpbWFyeUtleScsXG4gICAgJ3ZhbHVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcbiAgICAndXBkYXRlJyxcbiAgICAnZGVsZXRlJ1xuICBdKTtcblxuICAvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuICBbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgIEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjdXJzb3IgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgY3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcbiAgICB0aGlzLl9zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ2luZGV4TmFtZXMnLFxuICAgICdhdXRvSW5jcmVtZW50J1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAncHV0JyxcbiAgICAnYWRkJyxcbiAgICAnZGVsZXRlJyxcbiAgICAnY2xlYXInLFxuICAgICdnZXQnLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnZGVsZXRlSW5kZXgnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcbiAgICB0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcbiAgICAnb2JqZWN0U3RvcmVOYW1lcycsXG4gICAgJ21vZGUnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG4gICAgJ2Fib3J0J1xuICBdKTtcblxuICBmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgICB0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuICAgIHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICB9XG5cbiAgVXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2RlbGV0ZU9iamVjdFN0b3JlJyxcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIERCKGRiKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgfVxuXG4gIERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgLy8gQWRkIGN1cnNvciBpdGVyYXRvcnNcbiAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuICBbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcbiAgICBbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGVbZnVuY05hbWUucmVwbGFjZSgnb3BlbicsICdpdGVyYXRlJyldID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAgIHZhciBuYXRpdmVPYmplY3QgPSB0aGlzLl9zdG9yZSB8fCB0aGlzLl9pbmRleDtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuYXRpdmVPYmplY3RbZnVuY05hbWVdLmFwcGx5KG5hdGl2ZU9iamVjdCwgYXJncy5zbGljZSgwLCAtMSkpO1xuICAgICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIHBvbHlmaWxsIGdldEFsbFxuICBbSW5kZXgsIE9iamVjdFN0b3JlXS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgaWYgKENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwpIHJldHVybjtcbiAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsID0gZnVuY3Rpb24ocXVlcnksIGNvdW50KSB7XG4gICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgdmFyIGl0ZW1zID0gW107XG5cbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgIGluc3RhbmNlLml0ZXJhdGVDdXJzb3IocXVlcnksIGZ1bmN0aW9uKGN1cnNvcikge1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaXRlbXMucHVzaChjdXJzb3IudmFsdWUpO1xuXG4gICAgICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQgJiYgaXRlbXMubGVuZ3RoID09IGNvdW50KSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgdmFyIGV4cCA9IHtcbiAgICBvcGVuOiBmdW5jdGlvbihuYW1lLCB2ZXJzaW9uLCB1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnb3BlbicsIFtuYW1lLCB2ZXJzaW9uXSk7XG4gICAgICB2YXIgcmVxdWVzdCA9IHAucmVxdWVzdDtcblxuICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgdXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgfVxuICBlbHNlIHtcbiAgICBzZWxmLmlkYiA9IGV4cDtcbiAgfVxufSgpKTtcbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0RhdGFNb2RlbH0gZnJvbSBcInNkLW1vZGVsXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc01hbmFnZXJDb25maWd9IGZyb20gXCIuL2NvbXB1dGF0aW9ucy1tYW5hZ2VyXCI7XG5cblxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zRW5naW5lQ29uZmlnIGV4dGVuZHMgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZ3tcbiAgICBsb2dMZXZlbCA9ICd3YXJuJztcbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vL0VudHJ5IHBvaW50IGNsYXNzIGZvciBzdGFuZGFsb25lIGNvbXB1dGF0aW9uIHdvcmtlcnNcbmV4cG9ydCBjbGFzcyBDb21wdXRhdGlvbnNFbmdpbmUgZXh0ZW5kcyBDb21wdXRhdGlvbnNNYW5hZ2Vye1xuXG4gICAgZ2xvYmFsID0gVXRpbHMuZ2V0R2xvYmFsT2JqZWN0KCk7XG4gICAgaXNXb3JrZXIgPSBVdGlscy5pc1dvcmtlcigpO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhKXtcbiAgICAgICAgc3VwZXIoY29uZmlnLCBkYXRhKTtcblxuICAgICAgICBpZih0aGlzLmlzV29ya2VyKSB7XG4gICAgICAgICAgICB0aGlzLmpvYnNNYW5nZXIucmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih7XG4gICAgICAgICAgICAgICAgYmVmb3JlSm9iOiAoam9iRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdiZWZvcmVKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICBhZnRlckpvYjogKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXBseSgnYWZ0ZXJKb2InLCBqb2JFeGVjdXRpb24uZ2V0RFRPKCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgICAgICAgdGhpcy5xdWVyeWFibGVGdW5jdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcnVuSm9iOiBmdW5jdGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhRFRPKXtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coam9iTmFtZSwgam9iUGFyYW1ldGVycywgc2VyaWFsaXplZERhdGEpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG5ldyBEYXRhTW9kZWwoZGF0YURUTyk7XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnJ1bkpvYihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGV4ZWN1dGVKb2I6IGZ1bmN0aW9uKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuam9ic01hbmdlci5leGVjdXRlKGpvYkV4ZWN1dGlvbklkKS5jYXRjaChlPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5yZXBseSgnam9iRmF0YWxFcnJvcicsIGpvYkV4ZWN1dGlvbklkLCBVdGlscy5nZXRFcnJvckRUTyhlKSk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZWNvbXB1dGU6IGZ1bmN0aW9uKGRhdGFEVE8sIHJ1bGVOYW1lLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgICAgICAgICBpZihydWxlTmFtZSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBuZXcgRGF0YU1vZGVsKGRhdGFEVE8pO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUsIGV2YWxOdW1lcmljKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlcGx5KCdyZWNvbXB1dGVkJywgZGF0YS5nZXREVE8oKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZ2xvYmFsLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKG9FdmVudCkge1xuICAgICAgICAgICAgICAgIGlmIChvRXZlbnQuZGF0YSBpbnN0YW5jZW9mIE9iamVjdCAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2QnKSAmJiBvRXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5xdWVyeWFibGVGdW5jdGlvbnNbb0V2ZW50LmRhdGEucXVlcnlNZXRob2RdLmFwcGx5KHNlbGYsIG9FdmVudC5kYXRhLnF1ZXJ5QXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5kZWZhdWx0UmVwbHkob0V2ZW50LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICBzdXBlci5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5zZXRMb2dMZXZlbCh0aGlzLmNvbmZpZy5sb2dMZXZlbCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNldExvZ0xldmVsKGxldmVsKXtcbiAgICAgICAgbG9nLnNldExldmVsKGxldmVsKVxuICAgIH1cblxuICAgIGRlZmF1bHRSZXBseShtZXNzYWdlKSB7XG4gICAgICAgIHRoaXMucmVwbHkoJ3Rlc3QnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXBseSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXBseSAtIG5vdCBlbm91Z2ggYXJndW1lbnRzJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5nbG9iYWwucG9zdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgJ3F1ZXJ5TWV0aG9kTGlzdGVuZXInOiBhcmd1bWVudHNbMF0sXG4gICAgICAgICAgICAncXVlcnlNZXRob2RBcmd1bWVudHMnOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuIiwiaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcbmltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge09iamVjdGl2ZVJ1bGVzTWFuYWdlcn0gZnJvbSBcIi4vb2JqZWN0aXZlL29iamVjdGl2ZS1ydWxlcy1tYW5hZ2VyXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuL3ZhbGlkYXRpb24vdHJlZS12YWxpZGF0b3JcIjtcbmltcG9ydCB7T3BlcmF0aW9uc01hbmFnZXJ9IGZyb20gXCIuL29wZXJhdGlvbnMvb3BlcmF0aW9ucy1tYW5hZ2VyXCI7XG5pbXBvcnQge0pvYnNNYW5hZ2VyfSBmcm9tIFwiLi9qb2JzL2pvYnMtbWFuYWdlclwiO1xuaW1wb3J0IHtFeHByZXNzaW9uc0V2YWx1YXRvcn0gZnJvbSBcIi4vZXhwcmVzc2lvbnMtZXZhbHVhdG9yXCI7XG5pbXBvcnQge0pvYkRhdGFJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9qb2JzL2VuZ2luZS9leGNlcHRpb25zL2pvYi1kYXRhLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9ufSBmcm9tIFwiLi9qb2JzL2VuZ2luZS9leGNlcHRpb25zL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uXCI7XG5pbXBvcnQge0pvYkluc3RhbmNlTWFuYWdlcn0gZnJvbSBcIi4vam9icy9qb2ItaW5zdGFuY2UtbWFuYWdlclwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljaWVzL3BvbGljeVwiO1xuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlckNvbmZpZyB7XG5cbiAgICBsb2dMZXZlbCA9IG51bGw7XG5cbiAgICBydWxlTmFtZSA9IG51bGw7XG4gICAgd29ya2VyID0ge1xuICAgICAgICBkZWxlZ2F0ZVJlY29tcHV0YXRpb246ZmFsc2UsXG4gICAgICAgIHVybDogbnVsbFxuICAgIH07XG5cbiAgICBjb25zdHJ1Y3RvcihjdXN0b20pIHtcbiAgICAgICAgaWYgKGN1c3RvbSkge1xuICAgICAgICAgICAgVXRpbHMuZGVlcEV4dGVuZCh0aGlzLCBjdXN0b20pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zTWFuYWdlciB7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgIG9wZXJhdGlvbnNNYW5hZ2VyO1xuICAgIGpvYnNNYW5nZXI7XG5cbiAgICB0cmVlVmFsaWRhdG9yO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnLCBkYXRhPW51bGwpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgdGhpcy5zZXRDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gbmV3IEV4cHJlc3Npb25FbmdpbmUoKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IG5ldyBFeHByZXNzaW9uc0V2YWx1YXRvcih0aGlzLmV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG5ldyBPYmplY3RpdmVSdWxlc01hbmFnZXIodGhpcy5kYXRhLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUsIHRoaXMuY29uZmlnLnJ1bGVOYW1lKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zTWFuYWdlciA9IG5ldyBPcGVyYXRpb25zTWFuYWdlcih0aGlzLmRhdGEsIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMuam9ic01hbmdlciA9IG5ldyBKb2JzTWFuYWdlcih0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgdGhpcy5jb25maWcud29ya2VyLnVybCk7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKHRoaXMuZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgc2V0Q29uZmlnKGNvbmZpZykge1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBDb21wdXRhdGlvbnNNYW5hZ2VyQ29uZmlnKGNvbmZpZyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGdldEN1cnJlbnRSdWxlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuY3VycmVudFJ1bGU7XG4gICAgfVxuXG4gICAgZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JzTWFuZ2VyLmdldEpvYkJ5TmFtZShqb2JOYW1lKTtcbiAgICB9XG5cbiAgICBydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4obmFtZSwgam9iUGFyYW1zVmFsdWVzLCBkYXRhIHx8IHRoaXMuZGF0YSwgcmVzb2x2ZVByb21pc2VBZnRlckpvYklzTGF1bmNoZWQpXG4gICAgfVxuXG4gICAgcnVuSm9iV2l0aEluc3RhbmNlTWFuYWdlcihuYW1lLCBqb2JQYXJhbXNWYWx1ZXMsIGpvYkluc3RhbmNlTWFuYWdlckNvbmZpZykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5Kb2IobmFtZSwgam9iUGFyYW1zVmFsdWVzKS50aGVuKGplPT57XG4gICAgICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlTWFuYWdlcih0aGlzLmpvYnNNYW5nZXIsIGplLCBqb2JJbnN0YW5jZU1hbmFnZXJDb25maWcpO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgZ2V0T2JqZWN0aXZlUnVsZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5ydWxlcztcbiAgICB9XG5cbiAgICBpc1J1bGVOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5pc1J1bGVOYW1lKHJ1bGVOYW1lKVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKSB7XG4gICAgICAgIHRoaXMuY29uZmlnLnJ1bGVOYW1lID0gcnVsZU5hbWU7XG4gICAgICAgIHJldHVybiB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSlcbiAgICB9XG5cbiAgICBvcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zTWFuYWdlci5vcGVyYXRpb25zRm9yT2JqZWN0KG9iamVjdCk7XG4gICAgfVxuXG4gICAgY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuY29uZmlnLndvcmtlci5kZWxlZ2F0ZVJlY29tcHV0YXRpb24pIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFyYW1zID0ge1xuICAgICAgICAgICAgICAgICAgICBldmFsQ29kZTogZXZhbENvZGUsXG4gICAgICAgICAgICAgICAgICAgIGV2YWxOdW1lcmljOiBldmFsTnVtZXJpY1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYoIWFsbFJ1bGVzKXtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnJ1bGVOYW1lID0gdGhpcy5nZXRDdXJyZW50UnVsZSgpLm5hbWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnJ1bkpvYihcInJlY29tcHV0ZVwiLCBwYXJhbXMsIHRoaXMuZGF0YSwgZmFsc2UpLnRoZW4oKGpvYkV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBqb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRhdGEudXBkYXRlRnJvbShkKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZSh0aGlzLmRhdGEsIGFsbFJ1bGVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpO1xuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVEaXNwbGF5VmFsdWVzKHRoaXMuZGF0YSk7XG4gICAgICAgIH0pXG5cbiAgICB9XG5cbiAgICBfY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgZXZhbENvZGUgPSBmYWxzZSwgZXZhbE51bWVyaWMgPSB0cnVlKSB7XG4gICAgICAgIGRhdGEudmFsaWRhdGlvblJlc3VsdHMgPSBbXTtcblxuICAgICAgICBpZiAoZXZhbENvZGUgfHwgZXZhbE51bWVyaWMpIHtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy9DaGVja3MgdmFsaWRpdHkgb2YgZGF0YSBtb2RlbCB3aXRob3V0IHJlY29tcHV0YXRpb24gYW5kIHJldmFsaWRhdGlvblxuICAgIGlzVmFsaWQoZGF0YSl7XG4gICAgICAgIHZhciBkYXRhID0gZGF0YSB8fCB0aGlzLmRhdGE7XG4gICAgICAgIHJldHVybiBkYXRhLnZhbGlkYXRpb25SZXN1bHRzLmV2ZXJ5KHZyPT52ci5pc1ZhbGlkKCkpO1xuICAgIH1cblxuICAgIHVwZGF0ZURpc3BsYXlWYWx1ZXMoZGF0YSwgcG9saWN5VG9EaXNwbGF5PW51bGwpIHtcbiAgICAgICAgZGF0YSA9IGRhdGEgfHwgdGhpcy5kYXRhO1xuICAgICAgICBpZihwb2xpY3lUb0Rpc3BsYXkpe1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheVBvbGljeShkYXRhLCBwb2xpY3lUb0Rpc3BsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG4pO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5lZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUVkZ2VEaXNwbGF5VmFsdWVzKGUpO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHVwZGF0ZU5vZGVEaXNwbGF5VmFsdWVzKG5vZGUpIHtcbiAgICAgICAgbm9kZS4kRElTUExBWV9WQUxVRV9OQU1FUy5mb3JFYWNoKG49Pm5vZGUuZGlzcGxheVZhbHVlKG4sIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLmdldE5vZGVEaXNwbGF5VmFsdWUobm9kZSwgbikpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVFZGdlRGlzcGxheVZhbHVlcyhlKSB7XG4gICAgICAgIGUuJERJU1BMQVlfVkFMVUVfTkFNRVMuZm9yRWFjaChuPT5lLmRpc3BsYXlWYWx1ZShuLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5nZXRFZGdlRGlzcGxheVZhbHVlKGUsIG4pKSk7XG4gICAgfVxuXG4gICAgZGlzcGxheVBvbGljeShwb2xpY3lUb0Rpc3BsYXksIGRhdGEpIHtcblxuXG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5ub2Rlcy5mb3JFYWNoKG49PntcbiAgICAgICAgICAgIG4uY2xlYXJEaXNwbGF5VmFsdWVzKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgZS5jbGVhckRpc3BsYXlWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZ2V0Um9vdHMoKS5mb3JFYWNoKChyb290KT0+dGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShyb290LHBvbGljeVRvRGlzcGxheSkpO1xuICAgIH1cblxuICAgIGRpc3BsYXlQb2xpY3lGb3JOb2RlKG5vZGUsIHBvbGljeSl7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IFBvbGljeS5nZXREZWNpc2lvbihwb2xpY3ksIG5vZGUpO1xuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhkZWNpc2lvbiwgbm9kZSwgcG9saWN5KTtcbiAgICAgICAgICAgIGlmKGRlY2lzaW9uKXtcbiAgICAgICAgICAgICAgICBub2RlLmRpc3BsYXlWYWx1ZSgnb3B0aW1hbCcsIHRydWUpXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkRWRnZSA9IG5vZGUuY2hpbGRFZGdlc1tkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgICAgICBjaGlsZEVkZ2UuZGlzcGxheVZhbHVlKCdvcHRpbWFsJywgdHJ1ZSlcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5UG9saWN5Rm9yTm9kZShjaGlsZEVkZ2UuY2hpbGROb2RlLCBwb2xpY3kpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT50aGlzLmRpc3BsYXlQb2xpY3lGb3JOb2RlKGUuY2hpbGROb2RlLCBwb2xpY3kpKVxuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5leHBvcnQgY2xhc3MgQ29tcHV0YXRpb25zVXRpbHN7XG5cbiAgICBzdGF0aWMgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gRXhwcmVzc2lvbkVuZ2luZS5zdWJ0cmFjdChtYXgsIG1pbik7XG4gICAgICAgIHZhciByZXN1bHQgPSBbbWluXTtcbiAgICAgICAgdmFyIHN0ZXBzID0gbGVuZ3RoIC0gMTtcbiAgICAgICAgaWYoIXN0ZXBzKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShleHRlbnQsbGVuZ3RoIC0gMSk7XG4gICAgICAgIHZhciBjdXJyID0gbWluO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aCAtIDI7IGkrKykge1xuICAgICAgICAgICAgY3VyciA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGN1cnIsIHN0ZXApO1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KGN1cnIpKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQucHVzaChtYXgpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG4vKkV2YWx1YXRlcyBjb2RlIGFuZCBleHByZXNzaW9ucyBpbiB0cmVlcyovXG5leHBvcnQgY2xhc3MgRXhwcmVzc2lvbnNFdmFsdWF0b3Ige1xuICAgIGV4cHJlc3Npb25FbmdpbmU7XG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgY2xlYXIoZGF0YSl7XG4gICAgICAgIGRhdGEubm9kZXMuZm9yRWFjaChuPT57XG4gICAgICAgICAgICBuLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBlLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY2xlYXJUcmVlKGRhdGEsIHJvb3Qpe1xuICAgICAgICBkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHJvb3QpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgbi5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICBuLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICAgICAgZS5jbGVhckNvbXB1dGVkVmFsdWVzKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9ucyhkYXRhLCBldmFsQ29kZT10cnVlLCBldmFsTnVtZXJpYz10cnVlLCBpbml0U2NvcGVzPWZhbHNlKXtcbiAgICAgICAgbG9nLmRlYnVnKCdldmFsRXhwcmVzc2lvbnMgZXZhbENvZGU6JytldmFsQ29kZSsnIGV2YWxOdW1lcmljOicrZXZhbE51bWVyaWMpO1xuICAgICAgICBpZihldmFsQ29kZSl7XG4gICAgICAgICAgICB0aGlzLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgZGF0YS5nZXRSb290cygpLmZvckVhY2gobj0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhclRyZWUoZGF0YSwgbik7XG4gICAgICAgICAgICB0aGlzLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbiwgZXZhbENvZGUsIGV2YWxOdW1lcmljLGluaXRTY29wZXMpO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGV2YWxHbG9iYWxDb2RlKGRhdGEpe1xuICAgICAgICBkYXRhLmNsZWFyRXhwcmVzc2lvblNjb3BlKCk7XG4gICAgICAgIGRhdGEuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBkYXRhLiRjb2RlRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwoZGF0YS5jb2RlLCBmYWxzZSwgZGF0YS5leHByZXNzaW9uU2NvcGUpO1xuICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgZGF0YS4kY29kZUVycm9yID0gZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgbm9kZSwgZXZhbENvZGU9dHJ1ZSwgZXZhbE51bWVyaWM9dHJ1ZSwgaW5pdFNjb3BlPWZhbHNlKSB7XG4gICAgICAgIGlmKCFub2RlLmV4cHJlc3Npb25TY29wZSB8fCBpbml0U2NvcGUgfHwgZXZhbENvZGUpe1xuICAgICAgICAgICAgdGhpcy5pbml0U2NvcGVGb3JOb2RlKGRhdGEsIG5vZGUpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGV2YWxDb2RlKXtcbiAgICAgICAgICAgIG5vZGUuJGNvZGVEaXJ0eSA9IGZhbHNlO1xuICAgICAgICAgICAgaWYobm9kZS5jb2RlKXtcbiAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuJGNvZGVFcnJvciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKG5vZGUuY29kZSwgZmFsc2UsIG5vZGUuZXhwcmVzc2lvblNjb3BlKTtcbiAgICAgICAgICAgICAgICB9Y2F0Y2ggKGUpe1xuICAgICAgICAgICAgICAgICAgICBub2RlLiRjb2RlRXJyb3IgPSBlO1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXZhbE51bWVyaWMpe1xuICAgICAgICAgICAgdmFyIHNjb3BlID0gbm9kZS5leHByZXNzaW9uU2NvcGU7XG4gICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHlTdW09RXhwcmVzc2lvbkVuZ2luZS50b051bWJlcigwKTtcbiAgICAgICAgICAgIHZhciBoYXNoRWRnZXM9IFtdO1xuICAgICAgICAgICAgdmFyIGludmFsaWRQcm9iID0gZmFsc2U7XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgICAgICBpZihlLmlzRmllbGRWYWxpZCgncGF5b2ZmJywgdHJ1ZSwgZmFsc2UpKXtcbiAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5jb21wdXRlZFZhbHVlKG51bGwsICdwYXlvZmYnLCB0aGlzLmV4cHJlc3Npb25FbmdpbmUuZXZhbFBheW9mZihlKSlcbiAgICAgICAgICAgICAgICAgICAgfWNhdGNoIChlcnIpe1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBMZWZ0IGVtcHR5IGludGVudGlvbmFsbHlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoRXhwcmVzc2lvbkVuZ2luZS5pc0hhc2goZS5wcm9iYWJpbGl0eSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFzaEVkZ2VzLnB1c2goZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBpZihFeHByZXNzaW9uRW5naW5lLmhhc0Fzc2lnbm1lbnRFeHByZXNzaW9uKGUucHJvYmFiaWxpdHkpKXsgLy9JdCBzaG91bGQgbm90IG9jY3VyIGhlcmUhXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2cud2FybihcImV2YWxFeHByZXNzaW9uc0Zvck5vZGUgaGFzQXNzaWdubWVudEV4cHJlc3Npb24hXCIsIGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBpZihlLmlzRmllbGRWYWxpZCgncHJvYmFiaWxpdHknLCB0cnVlLCBmYWxzZSkpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBwcm9iID0gdGhpcy5leHByZXNzaW9uRW5naW5lLmV2YWwoZS5wcm9iYWJpbGl0eSwgdHJ1ZSwgc2NvcGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUuY29tcHV0ZWRWYWx1ZShudWxsLCAncHJvYmFiaWxpdHknLCBwcm9iKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKHByb2JhYmlsaXR5U3VtLCBwcm9iKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1jYXRjaCAoZXJyKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnZhbGlkUHJvYiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICAgICAgaW52YWxpZFByb2IgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9KTtcblxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgdmFyIGNvbXB1dGVIYXNoID0gaGFzaEVkZ2VzLmxlbmd0aCAmJiAhaW52YWxpZFByb2IgJiYgKHByb2JhYmlsaXR5U3VtLmNvbXBhcmUoMCkgPj0gMCAmJiBwcm9iYWJpbGl0eVN1bS5jb21wYXJlKDEpIDw9IDApO1xuXG4gICAgICAgICAgICAgICAgaWYoY29tcHV0ZUhhc2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhhc2ggPSBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShFeHByZXNzaW9uRW5naW5lLnN1YnRyYWN0KDEsIHByb2JhYmlsaXR5U3VtKSwgaGFzaEVkZ2VzLmxlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgIGhhc2hFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLmNvbXB1dGVkVmFsdWUobnVsbCwgJ3Byb2JhYmlsaXR5JywgaGFzaCk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuZXZhbEV4cHJlc3Npb25zRm9yTm9kZShkYXRhLCBlLmNoaWxkTm9kZSwgZXZhbENvZGUsIGV2YWxOdW1lcmljLCBpbml0U2NvcGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpbml0U2NvcGVGb3JOb2RlKGRhdGEsIG5vZGUpe1xuICAgICAgICB2YXIgcGFyZW50ID0gbm9kZS4kcGFyZW50O1xuICAgICAgICB2YXIgcGFyZW50U2NvcGUgPSBwYXJlbnQ/cGFyZW50LmV4cHJlc3Npb25TY29wZSA6IGRhdGEuZXhwcmVzc2lvblNjb3BlO1xuICAgICAgICBub2RlLmV4cHJlc3Npb25TY29wZSA9IFV0aWxzLmNsb25lRGVlcChwYXJlbnRTY29wZSk7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9jb21wdXRhdGlvbnMtZW5naW5lJ1xuZXhwb3J0ICogZnJvbSAnLi9jb21wdXRhdGlvbnMtbWFuYWdlcidcbmV4cG9ydCAqIGZyb20gJy4vZXhwcmVzc2lvbnMtZXZhbHVhdG9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2JzL2luZGV4J1xuXG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJEZWZpbml0aW9uLCBQQVJBTUVURVJfVFlQRX0gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2ItcGFyYW1ldGVyLWRlZmluaXRpb25cIjtcbmV4cG9ydCBjbGFzcyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibnVtYmVyT2ZSdW5zXCIsIFBBUkFNRVRFUl9UWVBFLklOVEVHRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+IDApKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImZvcm11bGFcIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSX0VYUFJFU1NJT04pXG4gICAgICAgICAgICBdLCAxLCBJbmZpbml0eSwgZmFsc2UsXG4gICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgICAgICBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uOiB0cnVlXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9iUGFyYW1ldGVyc30gZnJvbSBcIi4vcHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpcy1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJbml0UG9saWNpZXNTdGVwfSBmcm9tIFwiLi4vc2Vuc2l0aXZpdHktYW5hbHlzaXMvc3RlcHMvaW5pdC1wb2xpY2llcy1zdGVwXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuLi9zZW5zaXRpdml0eS1hbmFseXNpcy9zZW5zaXRpdml0eS1hbmFseXNpcy1qb2JcIjtcbmltcG9ydCB7UHJvYkNhbGN1bGF0ZVN0ZXB9IGZyb20gXCIuL3N0ZXBzL3Byb2ItY2FsY3VsYXRlLXN0ZXBcIjtcbmltcG9ydCB7Q29tcHV0ZVBvbGljeVN0YXRzU3RlcH0gZnJvbSBcIi4vc3RlcHMvY29tcHV0ZS1wb2xpY3ktc3RhdHMtc3RlcFwiO1xuXG5leHBvcnQgY2xhc3MgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2IgZXh0ZW5kcyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIoam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwicHJvYmFiaWxpc3RpYy1zZW5zaXRpdml0eS1hbmFseXNpc1wiO1xuICAgIH1cblxuICAgIGluaXRTdGVwcygpIHtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IFByb2JDYWxjdWxhdGVTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBDb21wdXRlUG9saWN5U3RhdHNTdGVwKHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZSwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIsIHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvYmFiaWxpc3RpY1NlbnNpdGl2aXR5QW5hbHlzaXNKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhleGVjdXRpb24pIHtcblxuICAgICAgICBpZiAoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aCA8PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRvdGFsOiAxLFxuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IDBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5zdGVwc1sxXS5nZXRQcm9ncmVzcyhleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnNbMV0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIENvbXB1dGVQb2xpY3lTdGF0c1N0ZXAgZXh0ZW5kcyBTdGVwIHtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lLCBvYmplY3RpdmVSdWxlc01hbmFnZXIsIGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgc3VwZXIoXCJjb21wdXRlX3BvbGljeV9zdGF0c1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuXG4gICAgICAgIGxldCBydWxlID0gdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIucnVsZUJ5TmFtZVtydWxlTmFtZV07XG5cblxuICAgICAgICB2YXIgcGF5b2Zmc1BlclBvbGljeSA9IGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLm1hcCgoKT0+W10pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MuZm9yRWFjaChyb3c9PiB7XG4gICAgICAgICAgICBwYXlvZmZzUGVyUG9saWN5W3Jvdy5wb2xpY3lJbmRleF0ucHVzaChyb3cucGF5b2ZmKVxuICAgICAgICB9KTtcblxuICAgICAgICBsb2cuZGVidWcoJ3BheW9mZnNQZXJQb2xpY3knLCBwYXlvZmZzUGVyUG9saWN5LCBqb2JSZXN1bHQuZGF0YS5yb3dzLmxlbmd0aCwgcnVsZS5tYXhpbWl6YXRpb24pO1xuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLm1lZGlhbnMgPSBwYXlvZmZzUGVyUG9saWN5Lm1hcChwYXlvZmZzPT5FeHByZXNzaW9uRW5naW5lLm1lZGlhbihwYXlvZmZzKSk7XG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnN0YW5kYXJkRGV2aWF0aW9ucyA9IHBheW9mZnNQZXJQb2xpY3kubWFwKHBheW9mZnM9PkV4cHJlc3Npb25FbmdpbmUuc3RkKHBheW9mZnMpKTtcblxuICAgICAgICBpZihydWxlLm1heGltaXphdGlvbikge1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5SXNCZXN0UHJvYmFiaWxpdGllcyA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvSGlnaGVzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUodiwgbnVtYmVyT2ZSdW5zKSkpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljeUlzQmVzdFByb2JhYmlsaXRpZXMgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50Lm1hcCh2PT5FeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUodiwgbnVtYmVyT2ZSdW5zKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9IaWdoZXN0UGF5b2ZmQ291bnQgPSBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudC5tYXAodj0+RXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpKTtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEucG9saWN5VG9Mb3dlc3RQYXlvZmZDb3VudCA9IGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnQubWFwKHY9PkV4cHJlc3Npb25FbmdpbmUudG9GbG9hdCh2KSk7XG5cblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gXCJzZC1leHByZXNzaW9uLWVuZ2luZVwiO1xuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7Q2FsY3VsYXRlU3RlcH0gZnJvbSBcIi4uLy4uL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3N0ZXBzL2NhbGN1bGF0ZS1zdGVwXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9iQ2FsY3VsYXRlU3RlcCBleHRlbmRzIENhbGN1bGF0ZVN0ZXAge1xuXG5cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cbiAgICAgICAgaWYoIWpvYlJlc3VsdC5kYXRhLnJvd3Mpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEucm93cyA9IFtdO1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGEudmFyaWFibGVOYW1lcyA9IHZhcmlhYmxlTmFtZXM7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcyA9IG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLmZpbGwoMCk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudCA9IG5ldyBBcnJheShqb2JSZXN1bHQuZGF0YS5wb2xpY2llcy5sZW5ndGgpLmZpbGwoMCk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50ID0gbmV3IEFycmF5KGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzLmxlbmd0aCkuZmlsbCgwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgfVxuXG4gICAgcmVhZE5leHRDaHVuayhzdGVwRXhlY3V0aW9uLCBzdGFydEluZGV4LCBjaHVua1NpemUsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZXMgPSBwYXJhbXMudmFsdWUoXCJ2YXJpYWJsZXNcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IFtdO1xuICAgICAgICBmb3IodmFyIHJ1bkluZGV4PTA7IHJ1bkluZGV4PGNodW5rU2l6ZTsgcnVuSW5kZXgrKyl7XG4gICAgICAgICAgICB2YXIgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgICAgIHZhcmlhYmxlcy5mb3JFYWNoKHY9PiB7XG4gICAgICAgICAgICAgICAgdmFyIGV2YWx1YXRlZCA9IHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXhwcmVzc2lvbkVuZ2luZS5ldmFsKHYuZm9ybXVsYSwgdHJ1ZSwgVXRpbHMuY2xvbmVEZWVwKGRhdGEuZXhwcmVzc2lvblNjb3BlKSk7XG4gICAgICAgICAgICAgICAgc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoZXZhbHVhdGVkKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goc2luZ2xlUnVuVmFyaWFibGVWYWx1ZXMpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXM7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciByID0gc3VwZXIucHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgam9iUmVzdWx0KTtcblxuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBudW1iZXJPZlJ1bnMgPSBwYXJhbXMudmFsdWUoXCJudW1iZXJPZlJ1bnNcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIHRoaXMudXBkYXRlUG9saWN5U3RhdHMociwgcG9saWNpZXMsIG51bWJlck9mUnVucywgam9iUmVzdWx0KVxuXG4gICAgICAgIHJldHVybiByO1xuICAgIH1cblxuICAgIHVwZGF0ZVBvbGljeVN0YXRzKHIsIHBvbGljaWVzLCBudW1iZXJPZlJ1bnMsIGpvYlJlc3VsdCl7XG4gICAgICAgIHZhciBoaWdoZXN0UGF5b2ZmID0gLUluZmluaXR5O1xuICAgICAgICB2YXIgbG93ZXN0UGF5b2ZmID0gSW5maW5pdHk7XG4gICAgICAgIHZhciBiZXN0UG9saWN5SW5kZXhlcyA9IFtdO1xuICAgICAgICB2YXIgd29yc3RQb2xpY3lJbmRleGVzID0gW107XG5cbiAgICAgICAgcG9saWNpZXMuZm9yRWFjaCgocG9saWN5LGkpPT57XG4gICAgICAgICAgICBsZXQgcGF5b2ZmID0gci5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgaWYocGF5b2ZmIDwgbG93ZXN0UGF5b2ZmKXtcbiAgICAgICAgICAgICAgICBsb3dlc3RQYXlvZmYgPSBwYXlvZmY7XG4gICAgICAgICAgICAgICAgd29yc3RQb2xpY3lJbmRleGVzID0gW2ldO1xuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhsb3dlc3RQYXlvZmYpKXtcbiAgICAgICAgICAgICAgICB3b3JzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYocGF5b2ZmID4gaGlnaGVzdFBheW9mZil7XG4gICAgICAgICAgICAgICAgaGlnaGVzdFBheW9mZiA9IHBheW9mZjtcbiAgICAgICAgICAgICAgICBiZXN0UG9saWN5SW5kZXhlcyA9IFtpXVxuICAgICAgICAgICAgfWVsc2UgaWYocGF5b2ZmLmVxdWFscyhoaWdoZXN0UGF5b2ZmKSl7XG4gICAgICAgICAgICAgICAgYmVzdFBvbGljeUluZGV4ZXMucHVzaChpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlc1tpXSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLmV4cGVjdGVkVmFsdWVzW2ldLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZShwYXlvZmYsIG51bWJlck9mUnVucykpO1xuICAgICAgICB9KTtcblxuICAgICAgICBiZXN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0hpZ2hlc3RQYXlvZmZDb3VudFtwb2xpY3lJbmRleF0sIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGJlc3RQb2xpY3lJbmRleGVzLmxlbmd0aCkpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHdvcnN0UG9saWN5SW5kZXhlcy5mb3JFYWNoKHBvbGljeUluZGV4PT57XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5wb2xpY3lUb0xvd2VzdFBheW9mZkNvdW50W3BvbGljeUluZGV4XSA9IEV4cHJlc3Npb25FbmdpbmUuYWRkKGpvYlJlc3VsdC5kYXRhLnBvbGljeVRvTG93ZXN0UGF5b2ZmQ291bnRbcG9saWN5SW5kZXhdLCBFeHByZXNzaW9uRW5naW5lLmRpdmlkZSgxLCB3b3JzdFBvbGljeUluZGV4ZXMubGVuZ3RoKSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgam9iUmVzdWx0LmRhdGEuZXhwZWN0ZWRWYWx1ZXMgPSBqb2JSZXN1bHQuZGF0YS5leHBlY3RlZFZhbHVlcy5tYXAodj0+dGhpcy50b0Zsb2F0KHYpKTtcbiAgICB9XG5cblxuICAgIHRvRmxvYXQodikge1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFJlY29tcHV0ZUpvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORywgMCkpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJldmFsQ29kZVwiLCBQQVJBTUVURVJfVFlQRS5CT09MRUFOKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcImV2YWxOdW1lcmljXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpIHtcbiAgICAgICAgdGhpcy52YWx1ZXMgPSB7XG4gICAgICAgICAgICBpZDogVXRpbHMuZ3VpZCgpLFxuICAgICAgICAgICAgcnVsZU5hbWU6IG51bGwsIC8vcmVjb21wdXRlIGFsbCBydWxlc1xuICAgICAgICAgICAgZXZhbENvZGU6IHRydWUsXG4gICAgICAgICAgICBldmFsTnVtZXJpYzogdHJ1ZVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTaW1wbGVKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvc2ltcGxlLWpvYlwiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1JlY29tcHV0ZUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3JlY29tcHV0ZS1qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iXCI7XG5cbmV4cG9ydCBjbGFzcyBSZWNvbXB1dGVKb2IgZXh0ZW5kcyBKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInJlY29tcHV0ZVwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5pc1Jlc3RhcnRhYmxlID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICB2YXIgZGF0YSA9IGV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBleGVjdXRpb24uam9iUGFyYW1ldGVycztcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBhbGxSdWxlcyA9ICFydWxlTmFtZTtcbiAgICAgICAgaWYocnVsZU5hbWUpe1xuICAgICAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY2hlY2tWYWxpZGl0eUFuZFJlY29tcHV0ZU9iamVjdGl2ZShkYXRhLCBhbGxSdWxlcywgcGFyYW1zLnZhbHVlKFwiZXZhbENvZGVcIiksIHBhcmFtcy52YWx1ZShcImV2YWxOdW1lcmljXCIpKVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgIH1cblxuICAgIGNoZWNrVmFsaWRpdHlBbmRSZWNvbXB1dGVPYmplY3RpdmUoZGF0YSwgYWxsUnVsZXMsIGV2YWxDb2RlLCBldmFsTnVtZXJpYykge1xuICAgICAgICBkYXRhLnZhbGlkYXRpb25SZXN1bHRzID0gW107XG5cbiAgICAgICAgaWYoZXZhbENvZGV8fGV2YWxOdW1lcmljKXtcbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEV4cHJlc3Npb25zKGRhdGEsIGV2YWxDb2RlLCBldmFsTnVtZXJpYyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhLmdldFJvb3RzKCkuZm9yRWFjaChyb290PT4ge1xuICAgICAgICAgICAgdmFyIHZyID0gdGhpcy50cmVlVmFsaWRhdG9yLnZhbGlkYXRlKGRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUocm9vdCkpO1xuICAgICAgICAgICAgZGF0YS52YWxpZGF0aW9uUmVzdWx0cy5wdXNoKHZyKTtcbiAgICAgICAgICAgIGlmICh2ci5pc1ZhbGlkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZWNvbXB1dGVKb2JQYXJhbWV0ZXJzKHZhbHVlcyk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlcnNcIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyRGVmaW5pdGlvbiwgUEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuLi8uLi9lbmdpbmUvam9iLXBhcmFtZXRlci1kZWZpbml0aW9uXCI7XG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnMgZXh0ZW5kcyBKb2JQYXJhbWV0ZXJzIHtcblxuICAgIGluaXREZWZpbml0aW9ucygpIHtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwiaWRcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HLCAxLCAxLCB0cnVlKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInJ1bGVOYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORykpO1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uXCIsIFBBUkFNRVRFUl9UWVBFLkJPT0xFQU4pKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwidmFyaWFibGVzXCIsIFtcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1pblwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibWF4XCIsIFBBUkFNRVRFUl9UWVBFLk5VTUJFUiksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJsZW5ndGhcIiwgUEFSQU1FVEVSX1RZUEUuSU5URUdFUikuc2V0KFwic2luZ2xlVmFsdWVWYWxpZGF0b3JcIiwgdiA9PiB2ID49IDApLFxuICAgICAgICAgICAgXSwgMSwgSW5maW5pdHksIGZhbHNlLFxuICAgICAgICAgICAgdiA9PiB2W1wibWluXCJdIDw9IHZbXCJtYXhcIl0sXG4gICAgICAgICAgICB2YWx1ZXMgPT4gVXRpbHMuaXNVbmlxdWUodmFsdWVzLCB2PT52W1wibmFtZVwiXSkgLy9WYXJpYWJsZSBuYW1lcyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICkpXG4gICAgfVxuXG4gICAgaW5pdERlZmF1bHRWYWx1ZXMoKSB7XG4gICAgICAgIHRoaXMudmFsdWVzID0ge1xuICAgICAgICAgICAgaWQ6IFV0aWxzLmd1aWQoKSxcbiAgICAgICAgICAgIGV4dGVuZGVkUG9saWN5RGVzY3JpcHRpb246IHRydWVcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsImltcG9ydCB7U2ltcGxlSm9ifSBmcm9tIFwiLi4vLi4vZW5naW5lL3NpbXBsZS1qb2JcIjtcbmltcG9ydCB7U2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcblxuXG5leHBvcnQgY2xhc3MgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYiBleHRlbmRzIFNpbXBsZUpvYiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwic2Vuc2l0aXZpdHktYW5hbHlzaXNcIiwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcik7XG4gICAgfVxuXG4gICAgaW5pdFN0ZXBzKCl7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgUHJlcGFyZVZhcmlhYmxlc1N0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmUpKTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBJbml0UG9saWNpZXNTdGVwKHRoaXMuam9iUmVwb3NpdG9yeSkpO1xuICAgICAgICB0aGlzLmFkZFN0ZXAobmV3IENhbGN1bGF0ZVN0ZXAodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgIH1cblxuICAgIGNyZWF0ZUpvYlBhcmFtZXRlcnModmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBuZXcgU2Vuc2l0aXZpdHlBbmFseXNpc0pvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzLCB3aXRoSGVhZGVycz10cnVlKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICBpZih3aXRoSGVhZGVycyl7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5IG51bWJlcicsICdwb2xpY3knXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC52YXJpYWJsZU5hbWVzLmZvckVhY2gobj0+aGVhZGVycy5wdXNoKG4pKTtcbiAgICAgICAgICAgIGhlYWRlcnMucHVzaCgncGF5b2ZmJyk7XG4gICAgICAgICAgICByZXN1bHQucHVzaChoZWFkZXJzKTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgam9iUmVzdWx0LnJvd3MuZm9yRWFjaChyb3cgPT4ge1xuICAgICAgICAgICAgdmFyIHBvbGljeSA9IGpvYlJlc3VsdC5wb2xpY2llc1tyb3cucG9saWN5SW5kZXhdO1xuICAgICAgICAgICAgdmFyIHJvd0NlbGxzID0gW3Jvdy5wb2xpY3lJbmRleCsxLCBQb2xpY3kudG9Qb2xpY3lTdHJpbmcocG9saWN5LCBqb2JQYXJhbWV0ZXJzLnZhbHVlcy5leHRlbmRlZFBvbGljeURlc2NyaXB0aW9uKV07XG4gICAgICAgICAgICByb3cudmFyaWFibGVzLmZvckVhY2godj0+IHJvd0NlbGxzLnB1c2godikpO1xuICAgICAgICAgICAgcm93Q2VsbHMucHVzaChyb3cucGF5b2ZmKTtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKHJvd0NlbGxzKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSBcInNkLWV4cHJlc3Npb24tZW5naW5lXCI7XG5pbXBvcnQge0JhdGNoU3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9iYXRjaC9iYXRjaC1zdGVwXCI7XG5pbXBvcnQge1RyZWVWYWxpZGF0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi92YWxpZGF0aW9uL3RyZWUtdmFsaWRhdG9yXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuXG5leHBvcnQgY2xhc3MgQ2FsY3VsYXRlU3RlcCBleHRlbmRzIEJhdGNoU3RlcCB7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHN1cGVyKFwiY2FsY3VsYXRlX3N0ZXBcIiwgam9iUmVwb3NpdG9yeSwgNSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKCk7XG4gICAgfVxuXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbkNvbnRleHQgPSBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iUGFyYW1ldGVycygpO1xuICAgICAgICB2YXIgcnVsZU5hbWUgPSBwYXJhbXMudmFsdWUoXCJydWxlTmFtZVwiKTtcblxuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5zZXRDdXJyZW50UnVsZUJ5TmFtZShydWxlTmFtZSk7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG5cblxuICAgICAgICBpZiAoIWpvYlJlc3VsdC5kYXRhLnJvd3MpIHtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MgPSBbXTtcbiAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlTmFtZXMgPSB2YXJpYWJsZU5hbWVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdmFyIHZhcmlhYmxlVmFsdWVzID0gam9iUmVzdWx0LmRhdGEudmFyaWFibGVWYWx1ZXM7XG4gICAgICAgIHJldHVybiB2YXJpYWJsZVZhbHVlcy5zbGljZShzdGFydEluZGV4LCBzdGFydEluZGV4ICsgY2h1bmtTaXplKTtcbiAgICB9XG5cbiAgICBwcm9jZXNzSXRlbShzdGVwRXhlY3V0aW9uLCBpdGVtKSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHBvbGljaWVzID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWNpZXNcIik7XG5cbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5jbGVhcihkYXRhKTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsR2xvYmFsQ29kZShkYXRhKTtcbiAgICAgICAgdmFyaWFibGVOYW1lcy5mb3JFYWNoKCh2YXJpYWJsZU5hbWUsIGkpPT4ge1xuICAgICAgICAgICAgZGF0YS5leHByZXNzaW9uU2NvcGVbdmFyaWFibGVOYW1lXSA9IGl0ZW1baV07XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxFeHByZXNzaW9uc0Zvck5vZGUoZGF0YSwgdHJlZVJvb3QpO1xuICAgICAgICB2YXIgdnIgPSB0aGlzLnRyZWVWYWxpZGF0b3IudmFsaWRhdGUoZGF0YS5nZXRBbGxOb2Rlc0luU3VidHJlZSh0cmVlUm9vdCkpO1xuXG4gICAgICAgIHZhciB2YWxpZCA9IHZyLmlzVmFsaWQoKTtcbiAgICAgICAgdmFyIHBheW9mZnMgPSBbXTtcblxuICAgICAgICBwb2xpY2llcy5mb3JFYWNoKHBvbGljeT0+IHtcbiAgICAgICAgICAgIHZhciBwYXlvZmYgPSAnbi9hJztcbiAgICAgICAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyLnJlY29tcHV0ZVRyZWUodHJlZVJvb3QsIGZhbHNlLCBwb2xpY3kpO1xuICAgICAgICAgICAgICAgIHBheW9mZiA9IHRyZWVSb290LmNvbXB1dGVkVmFsdWUocnVsZU5hbWUsICdwYXlvZmYnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBheW9mZnMucHVzaChwYXlvZmYpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcG9saWNpZXM6IHBvbGljaWVzLFxuICAgICAgICAgICAgdmFyaWFibGVzOiBpdGVtLFxuICAgICAgICAgICAgcGF5b2ZmczogcGF5b2Zmc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBleHRlbmRlZFBvbGljeURlc2NyaXB0aW9uID0gcGFyYW1zLnZhbHVlKFwiZXh0ZW5kZWRQb2xpY3lEZXNjcmlwdGlvblwiKTtcblxuICAgICAgICBpdGVtcy5mb3JFYWNoKGl0ZW09PiB7XG4gICAgICAgICAgICBpZiAoIWl0ZW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVtLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSwgaSk9PiB7XG4gICAgICAgICAgICAgICAgdmFyIHZhcmlhYmxlcyA9IGl0ZW0udmFyaWFibGVzLm1hcCh2ID0+IHRoaXMudG9GbG9hdCh2KSk7XG5cbiAgICAgICAgICAgICAgICB2YXIgcGF5b2ZmID0gaXRlbS5wYXlvZmZzW2ldO1xuICAgICAgICAgICAgICAgIHZhciByb3cgPSB7XG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUluZGV4OiBpLFxuICAgICAgICAgICAgICAgICAgICB2YXJpYWJsZXM6IHZhcmlhYmxlcyxcbiAgICAgICAgICAgICAgICAgICAgcGF5b2ZmOiBVdGlscy5pc1N0cmluZyhwYXlvZmYpID8gcGF5b2ZmIDogdGhpcy50b0Zsb2F0KHBheW9mZilcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGpvYlJlc3VsdC5kYXRhLnJvd3MucHVzaChyb3cpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgZGVsZXRlIGpvYlJlc3VsdC5kYXRhLnZhcmlhYmxlVmFsdWVzO1xuICAgIH1cblxuXG4gICAgdG9GbG9hdCh2KSB7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQodik7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1BvbGljaWVzQ29sbGVjdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vcG9saWNpZXMvcG9saWNpZXMtY29sbGVjdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBJbml0UG9saWNpZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImluaXRfcG9saWNpZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgdmFyIHBvbGljaWVzID0gcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXM7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInBvbGljaWVzXCIsIHBvbGljaWVzKTtcblxuICAgICAgICBpZigham9iUmVzdWx0LmRhdGEpe1xuICAgICAgICAgICAgam9iUmVzdWx0LmRhdGE9W11cbiAgICAgICAgfVxuXG4gICAgICAgIGpvYlJlc3VsdC5kYXRhLnBvbGljaWVzID0gcG9saWNpZXM7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtTdGVwfSBmcm9tIFwiLi4vLi4vLi4vZW5naW5lL3N0ZXBcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0NvbXB1dGF0aW9uc1V0aWxzfSBmcm9tIFwiLi4vLi4vLi4vLi4vY29tcHV0YXRpb25zLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcmVwYXJlVmFyaWFibGVzU3RlcCBleHRlbmRzIFN0ZXAge1xuICAgIGNvbnN0cnVjdG9yKGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25FbmdpbmUpIHtcbiAgICAgICAgc3VwZXIoXCJwcmVwYXJlX3ZhcmlhYmxlc1wiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lID0gZXhwcmVzc2lvbkVuZ2luZTtcbiAgICB9XG5cbiAgICBkb0V4ZWN1dGUoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcblxuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2goQ29tcHV0YXRpb25zVXRpbHMuc2VxdWVuY2Uodi5taW4sIHYubWF4LCB2Lmxlbmd0aCkpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyaWFibGVWYWx1ZXMgPSBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YodmFyaWFibGVWYWx1ZXMpO1xuICAgICAgICBqb2JSZXN1bHQuZGF0YT17XG4gICAgICAgICAgICB2YXJpYWJsZVZhbHVlczogdmFyaWFibGVWYWx1ZXNcbiAgICAgICAgfTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5DT01QTEVURUQ7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuaW1wb3J0IHtCYXRjaFN0ZXB9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvYmF0Y2gvYmF0Y2gtc3RlcFwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vLi4vLi4vLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY3lcIjtcbmltcG9ydCB7UG9saWNpZXNDb2xsZWN0b3J9IGZyb20gXCIuLi8uLi8uLi8uLi9wb2xpY2llcy9wb2xpY2llcy1jb2xsZWN0b3JcIjtcblxuZXhwb3J0IGNsYXNzIENhbGN1bGF0ZVN0ZXAgZXh0ZW5kcyBCYXRjaFN0ZXAge1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcImNhbGN1bGF0ZV9zdGVwXCIsIGpvYlJlcG9zaXRvcnksIDEpO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yID0gZXhwcmVzc2lvbnNFdmFsdWF0b3I7XG4gICAgICAgIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyID0gb2JqZWN0aXZlUnVsZXNNYW5hZ2VyO1xuICAgICAgICB0aGlzLnRyZWVWYWxpZGF0b3IgPSBuZXcgVHJlZVZhbGlkYXRvcigpO1xuICAgIH1cblxuICAgIGluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JFeGVjdXRpb25Db250ZXh0ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG5cbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIuc2V0Q3VycmVudFJ1bGVCeU5hbWUocnVsZU5hbWUpO1xuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBqb2JFeGVjdXRpb25Db250ZXh0LmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICB2YXIgdmFyaWFibGVOYW1lcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKS5tYXAodj0+di5uYW1lKTtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInZhcmlhYmxlTmFtZXNcIiwgdmFyaWFibGVOYW1lcyk7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuZXZhbEdsb2JhbENvZGUoZGF0YSk7XG5cbiAgICAgICAgdmFyIGRlZmF1bHRWYWx1ZXMgPSB7fTtcbiAgICAgICAgVXRpbHMuZm9yT3duKGRhdGEuZXhwcmVzc2lvblNjb3BlLCAodixrKT0+e1xuICAgICAgICAgICAgZGVmYXVsdFZhbHVlc1trXT10aGlzLnRvRmxvYXQodik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmKCFqb2JSZXN1bHQuZGF0YSl7XG4gICAgICAgICAgICB2YXIgaGVhZGVycyA9IFsncG9saWN5J107XG4gICAgICAgICAgICB2YXJpYWJsZU5hbWVzLmZvckVhY2gobj0+aGVhZGVycy5wdXNoKG4pKTtcbiAgICAgICAgICAgIGhlYWRlcnMucHVzaCgncGF5b2ZmJyk7XG4gICAgICAgICAgICBqb2JSZXN1bHQuZGF0YSA9IHtcbiAgICAgICAgICAgICAgICBoZWFkZXJzOmhlYWRlcnMsXG4gICAgICAgICAgICAgICAgcm93czogW10sXG4gICAgICAgICAgICAgICAgdmFyaWFibGVOYW1lczogdmFyaWFibGVOYW1lcyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWVzOiBkZWZhdWx0VmFsdWVzLFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBqb2JFeGVjdXRpb25Db250ZXh0LmdldChcInBvbGljaWVzXCIpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhcmlhYmxlVmFsdWVzLmxlbmd0aDtcbiAgICB9XG5cblxuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplKSB7XG4gICAgICAgIHZhciB2YXJpYWJsZVZhbHVlcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInZhcmlhYmxlVmFsdWVzXCIpO1xuICAgICAgICByZXR1cm4gdmFyaWFibGVWYWx1ZXMuc2xpY2Uoc3RhcnRJbmRleCwgc3RhcnRJbmRleCArIGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgaXRlbUluZGV4KSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHJ1bGVOYW1lID0gcGFyYW1zLnZhbHVlKFwicnVsZU5hbWVcIik7XG4gICAgICAgIHZhciBkYXRhID0gc3RlcEV4ZWN1dGlvbi5nZXREYXRhKCk7XG4gICAgICAgIHZhciB0cmVlUm9vdCA9IGRhdGEuZ2V0Um9vdHMoKVswXTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZXMgPSBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KFwidmFyaWFibGVOYW1lc1wiKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlTmFtZSA9IHZhcmlhYmxlTmFtZXNbaXRlbUluZGV4XTtcblxuXG5cbiAgICAgICAgdmFyIHJlc3VsdHMgPSBbXVxuXG4gICAgICAgIGl0ZW0uZm9yRWFjaCh2YXJpYWJsZVZhbHVlPT57XG5cbiAgICAgICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IuY2xlYXIoZGF0YSk7XG4gICAgICAgICAgICB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLmV2YWxHbG9iYWxDb2RlKGRhdGEpO1xuXG4gICAgICAgICAgICBkYXRhLmV4cHJlc3Npb25TY29wZVt2YXJpYWJsZU5hbWVdID0gdmFyaWFibGVWYWx1ZTtcblxuICAgICAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvci5ldmFsRXhwcmVzc2lvbnNGb3JOb2RlKGRhdGEsIHRyZWVSb290KTtcbiAgICAgICAgICAgIHZhciB2ciA9IHRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZShkYXRhLmdldEFsbE5vZGVzSW5TdWJ0cmVlKHRyZWVSb290KSk7XG4gICAgICAgICAgICB2YXIgdmFsaWQgPSB2ci5pc1ZhbGlkKCk7XG5cbiAgICAgICAgICAgIGlmKCF2YWxpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlci5yZWNvbXB1dGVUcmVlKHRyZWVSb290LCBmYWxzZSk7XG4gICAgICAgICAgICB2YXIgcG9saWNpZXNDb2xsZWN0b3IgPSBuZXcgUG9saWNpZXNDb2xsZWN0b3IodHJlZVJvb3QsIHJ1bGVOYW1lKTtcbiAgICAgICAgICAgIHZhciBwb2xpY2llcyA9IHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzO1xuXG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gdHJlZVJvb3QuY29tcHV0ZWRWYWx1ZShydWxlTmFtZSwgJ3BheW9mZicpO1xuXG5cbiAgICAgICAgICAgIHZhciByID0ge1xuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBwb2xpY2llcyxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZU5hbWU6IHZhcmlhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICB2YXJpYWJsZUluZGV4OiBpdGVtSW5kZXgsXG4gICAgICAgICAgICAgICAgdmFyaWFibGVWYWx1ZTogdmFyaWFibGVWYWx1ZSxcbiAgICAgICAgICAgICAgICBwYXlvZmY6IHBheW9mZlxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaChyKVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0cztcblxuICAgIH1cblxuICAgIHdyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgaXRlbXMsIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG5cbiAgICAgICAgdmFyIHBvbGljeUJ5S2V5ID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkuZ2V0KFwicG9saWN5QnlLZXlcIik7XG4gICAgICAgIHZhciBwb2xpY2llcyA9IHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLmdldChcInBvbGljaWVzXCIpO1xuXG4gICAgICAgIGl0ZW1zLmZvckVhY2goaXRlbXNXcmFwcGVyPT57XG4gICAgICAgICAgICBpZighaXRlbXNXcmFwcGVyKXtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGl0ZW1zV3JhcHBlci5mb3JFYWNoKGl0ZW09PntcbiAgICAgICAgICAgICAgICBpdGVtLnBvbGljaWVzLmZvckVhY2goKHBvbGljeSk9PntcblxuICAgICAgICAgICAgICAgICAgICB2YXIgcm93Q2VsbHMgPSBbUG9saWN5LnRvUG9saWN5U3RyaW5nKHBvbGljeSldO1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS52YXJpYWJsZU5hbWVzLmZvckVhY2goKHYpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgdmFsdWUgPSBcImRlZmF1bHRcIjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKHYgPT0gaXRlbS52YXJpYWJsZU5hbWUpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlID0gdGhpcy50b0Zsb2F0KGl0ZW0udmFyaWFibGVWYWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9ZWxzZSBpZihqb2JSZXN1bHQuZGF0YS5kZWZhdWx0VmFsdWVzLmhhc093blByb3BlcnR5KHYpKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGpvYlJlc3VsdC5kYXRhLmRlZmF1bHRWYWx1ZXNbdl07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICByb3dDZWxscy5wdXNoKHZhbHVlKVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHBheW9mZiA9IGl0ZW0ucGF5b2ZmO1xuICAgICAgICAgICAgICAgICAgICByb3dDZWxscy5wdXNoKFV0aWxzLmlzU3RyaW5nKHBheW9mZik/IHBheW9mZjogdGhpcy50b0Zsb2F0KHBheW9mZikpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgcm93ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2VsbHM6IHJvd0NlbGxzLFxuICAgICAgICAgICAgICAgICAgICAgICAgcG9saWN5SW5kZXg6IHBvbGljaWVzLmluZGV4T2YocG9saWN5QnlLZXlbcG9saWN5LmtleV0pLFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQuZGF0YS5yb3dzLnB1c2gocm93KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSlcblxuXG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICB0b0Zsb2F0KHYpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS50b0Zsb2F0KHYpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtQb2xpY2llc0NvbGxlY3Rvcn0gZnJvbSBcIi4uLy4uLy4uLy4uL3BvbGljaWVzL3BvbGljaWVzLWNvbGxlY3RvclwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBJbml0UG9saWNpZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcImluaXRfcG9saWNpZXNcIiwgam9iUmVwb3NpdG9yeSk7XG4gICAgfVxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIHJlc3VsdCkge1xuICAgICAgICB2YXIgZGF0YSA9IHN0ZXBFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgICAgICB2YXIgcGFyYW1zID0gc3RlcEV4ZWN1dGlvbi5nZXRKb2JQYXJhbWV0ZXJzKCk7XG4gICAgICAgIHZhciBydWxlTmFtZSA9IHBhcmFtcy52YWx1ZShcInJ1bGVOYW1lXCIpO1xuICAgICAgICB2YXIgdHJlZVJvb3QgPSBkYXRhLmdldFJvb3RzKClbMF07XG4gICAgICAgIHZhciBwb2xpY2llc0NvbGxlY3RvciA9IG5ldyBQb2xpY2llc0NvbGxlY3Rvcih0cmVlUm9vdCk7XG5cbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5nZXRKb2JFeGVjdXRpb25Db250ZXh0KCkucHV0KFwicG9saWNpZXNcIiwgcG9saWNpZXNDb2xsZWN0b3IucG9saWNpZXMpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKS5wdXQoXCJwb2xpY3lCeUtleVwiLCBVdGlscy5nZXRPYmplY3RCeUlkTWFwKHBvbGljaWVzQ29sbGVjdG9yLnBvbGljaWVzLCBudWxsLCAna2V5JykpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmltcG9ydCB7U3RlcH0gZnJvbSBcIi4uLy4uLy4uL2VuZ2luZS9zdGVwXCI7XG5pbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi8uLi8uLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtFeHByZXNzaW9uRW5naW5lfSBmcm9tIFwic2QtZXhwcmVzc2lvbi1lbmdpbmVcIjtcblxuZXhwb3J0IGNsYXNzIFByZXBhcmVWYXJpYWJsZXNTdGVwIGV4dGVuZHMgU3RlcCB7XG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSkge1xuICAgICAgICBzdXBlcihcInByZXBhcmVfdmFyaWFibGVzXCIsIGpvYlJlcG9zaXRvcnkpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSBzdGVwRXhlY3V0aW9uLmdldEpvYlBhcmFtZXRlcnMoKTtcbiAgICAgICAgdmFyIHZhcmlhYmxlcyA9IHBhcmFtcy52YWx1ZShcInZhcmlhYmxlc1wiKTtcblxuICAgICAgICB2YXIgdmFyaWFibGVWYWx1ZXMgPSBbXTtcbiAgICAgICAgdmFyaWFibGVzLmZvckVhY2godj0+IHtcbiAgICAgICAgICAgIHZhcmlhYmxlVmFsdWVzLnB1c2godGhpcy5zZXF1ZW5jZSh2Lm1pbiwgdi5tYXgsIHYubGVuZ3RoKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyB2YXJpYWJsZVZhbHVlcyA9IFV0aWxzLmNhcnRlc2lhblByb2R1Y3RPZih2YXJpYWJsZVZhbHVlcyk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uZ2V0Sm9iRXhlY3V0aW9uQ29udGV4dCgpLnB1dChcInZhcmlhYmxlVmFsdWVzXCIsIHZhcmlhYmxlVmFsdWVzKTtcblxuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgc2VxdWVuY2UobWluLCBtYXgsIGxlbmd0aCkge1xuICAgICAgICB2YXIgZXh0ZW50ID0gbWF4IC0gbWluO1xuICAgICAgICB2YXIgc3RlcCA9IGV4dGVudCAvIChsZW5ndGggLSAxKTtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFttaW5dO1xuICAgICAgICB2YXIgY3VyciA9IG1pbjtcblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aCAtIDI7IGkrKykge1xuICAgICAgICAgICAgY3VyciArPSBzdGVwO1xuXG4gICAgICAgICAgICByZXN1bHQucHVzaChFeHByZXNzaW9uRW5naW5lLnRvRmxvYXQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChjdXJyLCAxNikpKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQucHVzaChtYXgpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXJzXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlckRlZmluaXRpb24sIFBBUkFNRVRFUl9UWVBFfSBmcm9tIFwiLi4vLi4vZW5naW5lL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuZXhwb3J0IGNsYXNzIFRvcm5hZG9EaWFncmFtSm9iUGFyYW1ldGVycyBleHRlbmRzIEpvYlBhcmFtZXRlcnMge1xuXG4gICAgaW5pdERlZmluaXRpb25zKCkge1xuICAgICAgICB0aGlzLmRlZmluaXRpb25zLnB1c2gobmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJpZFwiLCBQQVJBTUVURVJfVFlQRS5TVFJJTkcsIDEsIDEsIHRydWUpKTtcbiAgICAgICAgdGhpcy5kZWZpbml0aW9ucy5wdXNoKG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwicnVsZU5hbWVcIiwgUEFSQU1FVEVSX1RZUEUuU1RSSU5HKSk7XG4gICAgICAgIHRoaXMuZGVmaW5pdGlvbnMucHVzaChuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcInZhcmlhYmxlc1wiLCBbXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJuYW1lXCIsIFBBUkFNRVRFUl9UWVBFLlNUUklORyksXG4gICAgICAgICAgICAgICAgbmV3IEpvYlBhcmFtZXRlckRlZmluaXRpb24oXCJtaW5cIiwgUEFSQU1FVEVSX1RZUEUuTlVNQkVSKSxcbiAgICAgICAgICAgICAgICBuZXcgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbihcIm1heFwiLCBQQVJBTUVURVJfVFlQRS5OVU1CRVIpLFxuICAgICAgICAgICAgICAgIG5ldyBKb2JQYXJhbWV0ZXJEZWZpbml0aW9uKFwibGVuZ3RoXCIsIFBBUkFNRVRFUl9UWVBFLklOVEVHRVIpLnNldChcInNpbmdsZVZhbHVlVmFsaWRhdG9yXCIsIHYgPT4gdiA+PSAwKSxcbiAgICAgICAgICAgIF0sIDEsIEluZmluaXR5LCBmYWxzZSxcbiAgICAgICAgICAgIHYgPT4gdltcIm1pblwiXSA8PSB2W1wibWF4XCJdLFxuICAgICAgICAgICAgdmFsdWVzID0+IFV0aWxzLmlzVW5pcXVlKHZhbHVlcywgdj0+dltcIm5hbWVcIl0pIC8vVmFyaWFibGUgbmFtZXMgc2hvdWxkIGJlIHVuaXF1ZVxuICAgICAgICApKVxuICAgIH1cblxuICAgIGluaXREZWZhdWx0VmFsdWVzKCkge1xuICAgICAgICB0aGlzLnZhbHVlcyA9IHtcbiAgICAgICAgICAgIGlkOiBVdGlscy5ndWlkKCksXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge1NpbXBsZUpvYn0gZnJvbSBcIi4uLy4uL2VuZ2luZS9zaW1wbGUtam9iXCI7XG5pbXBvcnQge1ByZXBhcmVWYXJpYWJsZXNTdGVwfSBmcm9tIFwiLi9zdGVwcy9wcmVwYXJlLXZhcmlhYmxlcy1zdGVwXCI7XG5pbXBvcnQge0luaXRQb2xpY2llc1N0ZXB9IGZyb20gXCIuL3N0ZXBzL2luaXQtcG9saWNpZXMtc3RlcFwiO1xuaW1wb3J0IHtDYWxjdWxhdGVTdGVwfSBmcm9tIFwiLi9zdGVwcy9jYWxjdWxhdGUtc3RlcFwiO1xuaW1wb3J0IHtUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnN9IGZyb20gXCIuL3Rvcm5hZG8tZGlhZ3JhbS1qb2ItcGFyYW1ldGVyc1wiO1xuXG5leHBvcnQgY2xhc3MgVG9ybmFkb0RpYWdyYW1Kb2IgZXh0ZW5kcyBTaW1wbGVKb2Ige1xuXG4gICAgY29uc3RydWN0b3Ioam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcikge1xuICAgICAgICBzdXBlcihcInRvcm5hZG8tZGlhZ3JhbVwiLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5hZGRTdGVwKG5ldyBQcmVwYXJlVmFyaWFibGVzU3RlcChqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgSW5pdFBvbGljaWVzU3RlcChqb2JSZXBvc2l0b3J5KSk7XG4gICAgICAgIHRoaXMuYWRkU3RlcChuZXcgQ2FsY3VsYXRlU3RlcChqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUb3JuYWRvRGlhZ3JhbUpvYlBhcmFtZXRlcnModmFsdWVzKTtcbiAgICB9XG5cbiAgICBnZXRKb2JEYXRhVmFsaWRhdG9yKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWRhdGU6IChkYXRhKSA9PiBkYXRhLmdldFJvb3RzKCkubGVuZ3RoID09PSAxXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlNob3VsZCByZXR1cm4gcHJvZ3Jlc3Mgb2JqZWN0IHdpdGggZmllbGRzOlxuICAgICAqIGN1cnJlbnRcbiAgICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG5cbiAgICAgICAgaWYgKGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9ucy5sZW5ndGggPD0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgICAgICBjdXJyZW50OiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlcHNbMl0uZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zWzJdKTtcbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge2xvZ30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuLi9zdGVwXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItaW50ZXJydXB0ZWQtZXhjZXB0aW9uXCI7XG5cbi8qam9iIHN0ZXAgdGhhdCBwcm9jZXNzIGJhdGNoIG9mIGl0ZW1zKi9cbmV4cG9ydCBjbGFzcyBCYXRjaFN0ZXAgZXh0ZW5kcyBTdGVwIHtcblxuICAgIGNodW5rU2l6ZTtcbiAgICBzdGF0aWMgQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1AgPSAnYmF0Y2hfc3RlcF9jdXJyZW50X2l0ZW1fY291bnQnO1xuICAgIHN0YXRpYyBUT1RBTF9JVEVNX0NPVU5UX1BST1AgPSAnYmF0Y2hfc3RlcF90b3RhbF9pdGVtX2NvdW50JztcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGNodW5rU2l6ZSkge1xuICAgICAgICBzdXBlcihuYW1lLCBqb2JSZXBvc2l0b3J5KTtcbiAgICAgICAgdGhpcy5jaHVua1NpemUgPSBjaHVua1NpemU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHBlcmZvcm0gc3RlcCBpbml0aWFsaXphdGlvbi4gU2hvdWxkIHJldHVybiB0b3RhbCBpdGVtIGNvdW50XG4gICAgICovXG4gICAgaW5pdChzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAuaW5pdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byByZWFkIGFuZCByZXR1cm4gY2h1bmsgb2YgaXRlbXMgdG8gcHJvY2Vzc1xuICAgICAqL1xuICAgIHJlYWROZXh0Q2h1bmsoc3RlcEV4ZWN1dGlvbiwgc3RhcnRJbmRleCwgY2h1bmtTaXplLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJCYXRjaFN0ZXAucmVhZE5leHRDaHVuayBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHN0ZXA6IFwiICsgdGhpcy5uYW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dGVuc2lvbiBwb2ludCBmb3Igc3ViY2xhc3NlcyB0byBwcm9jZXNzIHNpbmdsZSBpdGVtXG4gICAgICogTXVzdCByZXR1cm4gcHJvY2Vzc2VkIGl0ZW0gd2hpY2ggd2lsbCBiZSBwYXNzZWQgaW4gYSBjaHVuayB0byB3cml0ZUNodW5rIGZ1bmN0aW9uXG4gICAgICovXG4gICAgcHJvY2Vzc0l0ZW0oc3RlcEV4ZWN1dGlvbiwgaXRlbSwgY3VycmVudEl0ZW1Db3VudCwgam9iUmVzdWx0KSB7XG4gICAgICAgIHRocm93IFwiQmF0Y2hTdGVwLnByb2Nlc3NJdGVtIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igc3RlcDogXCIgKyB0aGlzLm5hbWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0ZW5zaW9uIHBvaW50IGZvciBzdWJjbGFzc2VzIHRvIHdyaXRlIGNodW5rIG9mIGl0ZW1zLiBOb3QgcmVxdWlyZWRcbiAgICAgKi9cbiAgICB3cml0ZUNodW5rKHN0ZXBFeGVjdXRpb24sIGl0ZW1zLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcGVyZm9ybSBwb3N0cHJvY2Vzc2luZyBhZnRlciBhbGwgaXRlbXMgaGF2ZSBiZWVuIHByb2Nlc3NlZC4gTm90IHJlcXVpcmVkXG4gICAgICovXG4gICAgcG9zdFByb2Nlc3Moc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgfVxuXG5cbiAgICBzZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjb3VudCkge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KEJhdGNoU3RlcC5UT1RBTF9JVEVNX0NPVU5UX1BST1AsIGNvdW50KTtcbiAgICB9XG5cbiAgICBnZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQuZ2V0KEJhdGNoU3RlcC5UT1RBTF9JVEVNX0NPVU5UX1BST1ApO1xuICAgIH1cblxuICAgIHNldEN1cnJlbnRJdGVtQ291bnQoc3RlcEV4ZWN1dGlvbiwgY291bnQpIHtcbiAgICAgICAgc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChCYXRjaFN0ZXAuQ1VSUkVOVF9JVEVNX0NPVU5UX1BST1AsIGNvdW50KTtcbiAgICB9XG5cbiAgICBnZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5nZXQoQmF0Y2hTdGVwLkNVUlJFTlRfSVRFTV9DT1VOVF9QUk9QKSB8fCAwO1xuICAgIH1cblxuXG4gICAgZG9FeGVjdXRlKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmluaXQoc3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIGluaXRpYWxpemUgYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSkudGhlbih0b3RhbEl0ZW1Db3VudD0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24sIHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCB0b3RhbEl0ZW1Db3VudCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgaWYoIShlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIGhhbmRsZSBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wb3N0UHJvY2VzcyhzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBwb3N0UHJvY2VzcyBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB2YXIgY3VycmVudEl0ZW1Db3VudCA9IHRoaXMuZ2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIHRvdGFsSXRlbUNvdW50ID0gdGhpcy5nZXRUb3RhbEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIGNodW5rU2l6ZSA9IE1hdGgubWluKHRoaXMuY2h1bmtTaXplLCB0b3RhbEl0ZW1Db3VudCAtIGN1cnJlbnRJdGVtQ291bnQpO1xuICAgICAgICBpZiAoY3VycmVudEl0ZW1Db3VudCA+PSB0b3RhbEl0ZW1Db3VudCkge1xuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tKb2JFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgc29tZW9uZSBpcyB0cnlpbmcgdG8gc3RvcCB1c1xuICAgICAgICAgICAgaWYgKHN0ZXBFeGVjdXRpb24udGVybWluYXRlT25seSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAgICB9KS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZWFkTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGN1cnJlbnRJdGVtQ291bnQsIGNodW5rU2l6ZSwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkuY2F0Y2goZT0+IHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJGYWlsZWQgdG8gcmVhZCBjaHVuayAoXCIgKyBjdXJyZW50SXRlbUNvdW50ICsgXCIsXCIgKyBjaHVua1NpemUgKyBcIikgaW4gYmF0Y2ggc3RlcDogXCIgKyB0aGlzLm5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSkudGhlbihjaHVuaz0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NodW5rKHN0ZXBFeGVjdXRpb24sIGNodW5rLCBjdXJyZW50SXRlbUNvdW50LCBqb2JSZXN1bHQpXG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkZhaWxlZCB0byBwcm9jZXNzIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4ocHJvY2Vzc2VkQ2h1bms9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLndyaXRlQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgcHJvY2Vzc2VkQ2h1bmssIGpvYlJlc3VsdClcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PiB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRmFpbGVkIHRvIHdyaXRlIGNodW5rIChcIiArIGN1cnJlbnRJdGVtQ291bnQgKyBcIixcIiArIGNodW5rU2l6ZSArIFwiKSBpbiBiYXRjaCBzdGVwOiBcIiArIHRoaXMubmFtZSwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pLnRoZW4oKHJlcyk9PiB7XG4gICAgICAgICAgICBjdXJyZW50SXRlbUNvdW50ICs9IGNodW5rU2l6ZTtcbiAgICAgICAgICAgIHRoaXMuc2V0Q3VycmVudEl0ZW1Db3VudChzdGVwRXhlY3V0aW9uLCBjdXJyZW50SXRlbUNvdW50KTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZUpvYlByb2dyZXNzKHN0ZXBFeGVjdXRpb24pLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTmV4dENodW5rKHN0ZXBFeGVjdXRpb24sIGpvYlJlc3VsdCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwcm9jZXNzQ2h1bmsoc3RlcEV4ZWN1dGlvbiwgY2h1bmssIGN1cnJlbnRJdGVtQ291bnQsIGpvYlJlc3VsdCkgeyAvL1RPRE8gcHJvbWlzaWZ5XG4gICAgICAgIHJldHVybiBjaHVuay5tYXAoKGl0ZW0sIGkpPT50aGlzLnByb2Nlc3NJdGVtKHN0ZXBFeGVjdXRpb24sIGl0ZW0sIGN1cnJlbnRJdGVtQ291bnQraSwgam9iUmVzdWx0KSk7XG4gICAgfVxuXG4gICAgLypTaG91bGQgcmV0dXJuIHByb2dyZXNzIG9iamVjdCB3aXRoIGZpZWxkczpcbiAgICAgKiBjdXJyZW50XG4gICAgICogdG90YWwgKi9cbiAgICBnZXRQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHRvdGFsOiB0aGlzLmdldFRvdGFsSXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pLFxuICAgICAgICAgICAgY3VycmVudDogdGhpcy5nZXRDdXJyZW50SXRlbUNvdW50KHN0ZXBFeGVjdXRpb24pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1cGRhdGVKb2JQcm9ncmVzcyhzdGVwRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBwcm9ncmVzcyA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSkuZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24pO1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkLCBwcm9ncmVzcyk7XG4gICAgfVxuXG4gICAgY2hlY2tKb2JFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoc3RlcEV4ZWN1dGlvbi5qb2JFeGVjdXRpb24uam9iSW5zdGFuY2Uuam9iTmFtZSkuY2hlY2tFeGVjdXRpb25GbGFncyhzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbik7XG4gICAgfVxufVxuIiwiZXhwb3J0IGNsYXNzIEV4dGVuZGFibGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBjb25zdHJ1Y3RvcihtZXNzYWdlKSB7XG4gICAgICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgICAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgICAgIGlmICh0eXBlb2YgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHRoaXMuY29uc3RydWN0b3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5zdGFjayA9IChuZXcgRXJyb3IobWVzc2FnZSkpLnN0YWNrO1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9leHRlbmRhYmxlLWVycm9yJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvbidcbmV4cG9ydCAqIGZyb20gJy4vam9iLWV4ZWN1dGlvbi1hbHJlYWR5LXJ1bm5pbmctZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItaW5zdGFuY2UtYWxyZWFkeS1jb21wbGV0ZS1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb24nXG5leHBvcnQgKiBmcm9tICcuL2pvYi1wYXJhbWV0ZXJzLWludmFsaWQtZXhjZXB0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcmVzdGFydC1leGNlcHRpb24nXG5cblxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb24gZXh0ZW5kcyBFeHRlbmRhYmxlRXJyb3Ige1xufVxuIiwiaW1wb3J0IHtFeHRlbmRhYmxlRXJyb3J9IGZyb20gXCIuL2V4dGVuZGFibGUtZXJyb3JcIjtcbmV4cG9ydCBjbGFzcyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge0V4dGVuZGFibGVFcnJvcn0gZnJvbSBcIi4vZXh0ZW5kYWJsZS1lcnJvclwiO1xuZXhwb3J0IGNsYXNzIEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uIGV4dGVuZHMgRXh0ZW5kYWJsZUVycm9yIHtcbn1cbiIsImltcG9ydCB7RXh0ZW5kYWJsZUVycm9yfSBmcm9tIFwiLi9leHRlbmRhYmxlLWVycm9yXCI7XG5leHBvcnQgY2xhc3MgSm9iUmVzdGFydEV4Y2VwdGlvbiBleHRlbmRzIEV4dGVuZGFibGVFcnJvciB7XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuZXhwb3J0IGNsYXNzIEV4ZWN1dGlvbkNvbnRleHQge1xuXG4gICAgZGlydHkgPSBmYWxzZTtcbiAgICBjb250ZXh0ID0ge307XG5cbiAgICBjb25zdHJ1Y3Rvcihjb250ZXh0KSB7XG4gICAgICAgIGlmIChjb250ZXh0KSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRleHQgPSBVdGlscy5jbG9uZShjb250ZXh0KVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHV0KGtleSwgdmFsdWUpIHtcbiAgICAgICAgdmFyIHByZXZWYWx1ZSA9IHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IHRoaXMuY29udGV4dFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLmRpcnR5ID0gcHJldlZhbHVlID09IG51bGwgfHwgcHJldlZhbHVlICE9IG51bGwgJiYgcHJldlZhbHVlICE9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29udGV4dFtrZXldO1xuICAgICAgICAgICAgdGhpcy5kaXJ0eSA9IHByZXZWYWx1ZSAhPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb250ZXh0W2tleV07XG4gICAgfVxuXG4gICAgY29udGFpbnNLZXkoa2V5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoa2V5KTtcbiAgICB9XG5cbiAgICByZW1vdmUoa2V5KSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbnRleHRba2V5XTtcbiAgICB9XG5cbiAgICBzZXREYXRhKGRhdGEpIHsgLy9zZXQgZGF0YSBtb2RlbFxuICAgICAgICByZXR1cm4gdGhpcy5wdXQoXCJkYXRhXCIsIGRhdGEpO1xuICAgIH1cblxuICAgIGdldERhdGEoKSB7IC8vIGdldCBkYXRhIG1vZGVsXG4gICAgICAgIHJldHVybiB0aGlzLmdldChcImRhdGFcIik7XG4gICAgfVxuXG4gICAgZ2V0RFRPKCkge1xuICAgICAgICB2YXIgZHRvID0gVXRpbHMuY2xvbmVEZWVwKHRoaXMpO1xuICAgICAgICB2YXIgZGF0YSA9IHRoaXMuZ2V0RGF0YSgpO1xuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgZGF0YSA9IGRhdGEuZ2V0RFRPKCk7XG4gICAgICAgICAgICBkdG8uY29udGV4dFtcImRhdGFcIl0gPSBkYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG59XG4iLCJpbXBvcnQgKiBhcyBleGNlcHRpb25zIGZyb20gJy4vZXhjZXB0aW9ucydcblxuZXhwb3J0IHtleGNlcHRpb25zfVxuZXhwb3J0ICogZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCdcbmV4cG9ydCAqIGZyb20gJy4vam9iJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItZXhlY3V0aW9uLWZsYWcnXG5leHBvcnQgKiBmcm9tICcuL2pvYi1leGVjdXRpb24tbGlzdGVuZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi1pbnN0YW5jZSdcbmV4cG9ydCAqIGZyb20gJy4vam9iLWtleS1nZW5lcmF0b3InXG5leHBvcnQgKiBmcm9tICcuL2pvYi1sYXVuY2hlcidcbmV4cG9ydCAqIGZyb20gJy4vam9iLXBhcmFtZXRlci1kZWZpbml0aW9uJ1xuZXhwb3J0ICogZnJvbSAnLi9qb2ItcGFyYW1ldGVycydcbmV4cG9ydCAqIGZyb20gJy4vam9iLXN0YXR1cydcbmV4cG9ydCAqIGZyb20gJy4vc2ltcGxlLWpvYidcbmV4cG9ydCAqIGZyb20gJy4vc3RlcCdcbmV4cG9ydCAqIGZyb20gJy4vc3RlcC1leGVjdXRpb24nXG5leHBvcnQgKiBmcm9tICcuL3N0ZXAtZXhlY3V0aW9uLWxpc3RlbmVyJ1xuXG5cblxuXG4iLCJleHBvcnQgY29uc3QgSk9CX0VYRUNVVElPTl9GTEFHID0ge1xuICAgIFNUT1A6ICdTVE9QJ1xufTtcbiIsImV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG4gICAgLypDYWxsZWQgYmVmb3JlIGEgam9iIGV4ZWN1dGVzKi9cbiAgICBiZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgam9iLiBDYWxsZWQgYWZ0ZXIgYm90aCBzdWNjZXNzZnVsIGFuZCBmYWlsZWQgZXhlY3V0aW9ucyovXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSBleGVjdXRpb24gb2YgYSBqb2IuKi9cbmV4cG9ydCBjbGFzcyBKb2JFeGVjdXRpb24ge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGpvYlBhcmFtZXRlcnM7XG4gICAgc3RlcEV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLlVOS05PV047XG4gICAgZXhlY3V0aW9uQ29udGV4dCA9IG5ldyBFeGVjdXRpb25Db250ZXh0KCk7XG5cbiAgICBzdGFydFRpbWUgPSBudWxsO1xuICAgIGNyZWF0ZVRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGZhaWx1cmVFeGNlcHRpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycywgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVycyA9IGpvYlBhcmFtZXRlcnM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXIgYSBzdGVwIGV4ZWN1dGlvbiB3aXRoIHRoZSBjdXJyZW50IGpvYiBleGVjdXRpb24uXG4gICAgICogQHBhcmFtIHN0ZXBOYW1lIHRoZSBuYW1lIG9mIHRoZSBzdGVwIHRoZSBuZXcgZXhlY3V0aW9uIGlzIGFzc29jaWF0ZWQgd2l0aFxuICAgICAqL1xuICAgIGNyZWF0ZVN0ZXBFeGVjdXRpb24oc3RlcE5hbWUpIHtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb24gPSBuZXcgU3RlcEV4ZWN1dGlvbihzdGVwTmFtZSwgdGhpcyk7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgfVxuXG4gICAgaXNSdW5uaW5nKCkge1xuICAgICAgICByZXR1cm4gIXRoaXMuZW5kVGltZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXN0IGlmIHRoaXMgSm9iRXhlY3V0aW9uIGhhcyBiZWVuIHNpZ25hbGxlZCB0b1xuICAgICAqIHN0b3AuXG4gICAgICovXG4gICAgaXNTdG9wcGluZygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNpZ25hbCB0aGUgSm9iRXhlY3V0aW9uIHRvIHN0b3AuXG4gICAgICovXG4gICAgc3RvcCgpIHtcbiAgICAgICAgdGhpcy5zdGVwRXhlY3V0aW9ucy5mb3JFYWNoKHNlPT4ge1xuICAgICAgICAgICAgc2UudGVybWluYXRlT25seSA9IHRydWU7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBJTkc7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgfVxuXG4gICAgZ2V0RFRPKGZpbHRlcmVkUHJvcGVydGllcyA9IFtdLCBkZWVwQ2xvbmUgPSB0cnVlKSB7XG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmICghZGVlcENsb25lKSB7XG4gICAgICAgICAgICBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lV2l0aDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5hc3NpZ24oe30sIGNsb25lTWV0aG9kKHRoaXMsICh2YWx1ZSwga2V5LCBvYmplY3QsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJlZFByb3BlcnRpZXMuaW5kZXhPZihrZXkpID4gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKFtcImpvYlBhcmFtZXRlcnNcIiwgXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBVdGlscy5nZXRFcnJvckRUTyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSwgZGVlcENsb25lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICB9XG59XG4iLCIvKiBvYmplY3QgcmVwcmVzZW50aW5nIGEgdW5pcXVlbHkgaWRlbnRpZmlhYmxlIGpvYiBydW4uIEpvYkluc3RhbmNlIGNhbiBiZSByZXN0YXJ0ZWQgbXVsdGlwbGUgdGltZXMgaW4gY2FzZSBvZiBleGVjdXRpb24gZmFpbHVyZSBhbmQgaXQncyBsaWZlY3ljbGUgZW5kcyB3aXRoIGZpcnN0IHN1Y2Nlc3NmdWwgZXhlY3V0aW9uKi9cbmV4cG9ydCBjbGFzcyBKb2JJbnN0YW5jZXtcblxuICAgIGlkO1xuICAgIGpvYk5hbWU7XG4gICAgY29uc3RydWN0b3IoaWQsIGpvYk5hbWUpe1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMuam9iTmFtZSA9IGpvYk5hbWU7XG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBKb2JLZXlHZW5lcmF0b3Ige1xuICAgIC8qTWV0aG9kIHRvIGdlbmVyYXRlIHRoZSB1bmlxdWUga2V5IHVzZWQgdG8gaWRlbnRpZnkgYSBqb2IgaW5zdGFuY2UuKi9cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0gXCJcIjtcbiAgICAgICAgam9iUGFyYW1ldGVycy5kZWZpbml0aW9ucy5mb3JFYWNoKChkLCBpKT0+IHtcbiAgICAgICAgICAgIGlmKGQuaWRlbnRpZnlpbmcpe1xuICAgICAgICAgICAgICAgIHJlc3VsdCArPSBkLm5hbWUgKyBcIj1cIiArIGpvYlBhcmFtZXRlcnMudmFsdWVzW2QubmFtZV0gKyBcIjtcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge1V0aWxzLCBsb2d9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItcGFyYW1ldGVycy1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbn0gZnJvbSBcIi4vZXhjZXB0aW9ucy9qb2ItZGF0YS1pbnZhbGlkLWV4Y2VwdGlvblwiO1xuXG5leHBvcnQgY2xhc3MgSm9iTGF1bmNoZXIge1xuXG4gICAgam9iUmVwb3NpdG9yeTtcbiAgICBqb2JXb3JrZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JSZXBvc2l0b3J5LCBqb2JXb3JrZXIsIGRhdGFNb2RlbFNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5qb2JXb3JrZXIgPSBqb2JXb3JrZXI7XG4gICAgICAgIHRoaXMuZGF0YU1vZGVsU2VyaWFsaXplciA9IGRhdGFNb2RlbFNlcmlhbGl6ZXI7XG4gICAgfVxuXG5cbiAgICBydW4oam9iT3JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgdmFyIGpvYjtcbiAgICAgICAgdmFyIGpvYlBhcmFtZXRlcnM7XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICBpZiAoVXRpbHMuaXNTdHJpbmcoam9iT3JOYW1lKSkge1xuICAgICAgICAgICAgICAgIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iT3JOYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBqb2IgPSBqb2JPck5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWpvYikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiTm8gc3VjaCBqb2I6IFwiICsgam9iT3JOYW1lKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgam9iUGFyYW1ldGVycyA9IGpvYi5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnNWYWx1ZXMpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpO1xuICAgICAgICB9KS50aGVuKHZhbGlkPT57XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmNyZWF0ZUpvYkV4ZWN1dGlvbihqb2IubmFtZSwgam9iUGFyYW1ldGVycywgZGF0YSkudGhlbihqb2JFeGVjdXRpb249PntcblxuXG4gICAgICAgICAgICAgICAgaWYodGhpcy5qb2JXb3JrZXIpe1xuICAgICAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJKb2I6IFtcIiArIGpvYi5uYW1lICsgXCJdIGV4ZWN1dGlvbiBbXCIram9iRXhlY3V0aW9uLmlkK1wiXSBkZWxlZ2F0ZWQgdG8gd29ya2VyXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmpvYldvcmtlci5leGVjdXRlSm9iKGpvYkV4ZWN1dGlvbi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvblByb21pc2UgPSB0aGlzLl9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICBpZihyZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBleGVjdXRpb25Qcm9taXNlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShqb2IsIGpvYlBhcmFtZXRlcnMsIGRhdGEpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb24oam9iLm5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4obGFzdEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKGxhc3RFeGVjdXRpb24gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGlmICgham9iLmlzUmVzdGFydGFibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJKb2JJbnN0YW5jZSBhbHJlYWR5IGV4aXN0cyBhbmQgaXMgbm90IHJlc3RhcnRhYmxlXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGxhc3RFeGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuVU5LTk9XTikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlJlc3RhcnRFeGNlcHRpb24oXCJTdGVwIFtcIiArIGV4ZWN1dGlvbi5zdGVwTmFtZSArIFwiXSBpcyBvZiBzdGF0dXMgVU5LTk9XTlwiKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGpvYi5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICFqb2Iuam9iUGFyYW1ldGVyc1ZhbGlkYXRvci52YWxpZGF0ZShqb2JQYXJhbWV0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JQYXJhbWV0ZXJzSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIHBhcmFtZXRlcnMgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihqb2Iuam9iRGF0YVZhbGlkYXRvciAmJiAham9iLmpvYkRhdGFWYWxpZGF0b3IudmFsaWRhdGUoZGF0YSkpe1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JEYXRhSW52YWxpZEV4Y2VwdGlvbihcIkludmFsaWQgam9iIGRhdGEgaW4gam9iTGF1bmNoZXIucnVuIGZvciBqb2I6IFwiK2pvYi5uYW1lKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICAvKipFeGVjdXRlIHByZXZpb3VzbHkgY3JlYXRlZCBqb2IgZXhlY3V0aW9uKi9cbiAgICBleGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpe1xuXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpPT57XG4gICAgICAgICAgICBpZihVdGlscy5pc1N0cmluZyhqb2JFeGVjdXRpb25PcklkKSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIH0pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZigham9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb25PcklkICsgXCJdIGlzIG5vdCBmb3VuZFwiKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5zdGF0dXMgIT09IEpPQl9TVEFUVVMuU1RBUlRJTkcpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBbXCIgKyBqb2JFeGVjdXRpb24uaWQgKyBcIl0gYWxyZWFkeSBzdGFydGVkXCIpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgam9iTmFtZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lO1xuICAgICAgICAgICAgdmFyIGpvYiA9IHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JCeU5hbWUoam9iTmFtZSk7XG4gICAgICAgICAgICBpZigham9iKXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iUmVzdGFydEV4Y2VwdGlvbihcIk5vIHN1Y2ggam9iOiBcIiArIGpvYk5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gIHRoaXMuX2V4ZWN1dGUoam9iLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIF9leGVjdXRlKGpvYiwgam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGpvYk5hbWUgPSBqb2IubmFtZTtcbiAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gbGF1bmNoZWQgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpO1xuICAgICAgICByZXR1cm4gam9iLmV4ZWN1dGUoam9iRXhlY3V0aW9uKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgbG9nLmluZm8oXCJKb2I6IFtcIiArIGpvYk5hbWUgKyBcIl0gY29tcGxldGVkIHdpdGggdGhlIGZvbGxvd2luZyBwYXJhbWV0ZXJzOiBbXCIgKyBqb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycyArIFwiXSBhbmQgdGhlIGZvbGxvd2luZyBzdGF0dXM6IFtcIiArIGpvYkV4ZWN1dGlvbi5zdGF0dXMgKyBcIl1cIik7XG4gICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICB9KS5jYXRjaChlID0+e1xuICAgICAgICAgICAgbG9nLmVycm9yKFwiSm9iOiBbXCIgKyBqb2JOYW1lICsgXCJdIGZhaWxlZCB1bmV4cGVjdGVkbHkgYW5kIGZhdGFsbHkgd2l0aCB0aGUgZm9sbG93aW5nIHBhcmFtZXRlcnM6IFtcIiArIGpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzICsgXCJdXCIsIGUpO1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfSlcbiAgICB9XG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcbmV4cG9ydCBjb25zdCBQQVJBTUVURVJfVFlQRSA9IHtcbiAgICBTVFJJTkc6ICdTVFJJTkcnLFxuICAgIERBVEU6ICdEQVRFJyxcbiAgICBJTlRFR0VSOiAnSU5URUdFUicsXG4gICAgTlVNQkVSOiAnRkxPQVQnLFxuICAgIEJPT0xFQU46ICdCT09MRUFOJyxcbiAgICBOVU1CRVJfRVhQUkVTU0lPTjogJ05VTUJFUl9FWFBSRVNTSU9OJyxcbiAgICBDT01QT1NJVEU6ICdDT01QT1NJVEUnIC8vY29tcG9zaXRlIHBhcmFtZXRlciB3aXRoIG5lc3RlZCBzdWJwYXJhbWV0ZXJzXG59O1xuXG5leHBvcnQgY2xhc3MgSm9iUGFyYW1ldGVyRGVmaW5pdGlvbiB7XG4gICAgbmFtZTtcbiAgICB0eXBlO1xuICAgIG5lc3RlZFBhcmFtZXRlcnMgPSBbXTtcbiAgICBtaW5PY2N1cnM7XG4gICAgbWF4T2NjdXJzO1xuICAgIHJlcXVpcmVkID0gdHJ1ZTtcblxuICAgIGlkZW50aWZ5aW5nO1xuICAgIHZhbGlkYXRvcjtcbiAgICBzaW5nbGVWYWx1ZVZhbGlkYXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucywgbWluT2NjdXJzID0gMSwgbWF4T2NjdXJzID0gMSwgaWRlbnRpZnlpbmcgPSBmYWxzZSwgc2luZ2xlVmFsdWVWYWxpZGF0b3IgPSBudWxsLCB2YWxpZGF0b3IgPSBudWxsKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIGlmIChVdGlscy5pc0FycmF5KHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucykpIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IFBBUkFNRVRFUl9UWVBFLkNPTVBPU0lURTtcbiAgICAgICAgICAgIHRoaXMubmVzdGVkUGFyYW1ldGVycyA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMudHlwZSA9IHR5cGVPck5lc3RlZFBhcmFtZXRlcnNEZWZpbml0aW9ucztcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnZhbGlkYXRvciA9IHZhbGlkYXRvcjtcbiAgICAgICAgdGhpcy5zaW5nbGVWYWx1ZVZhbGlkYXRvciA9IHNpbmdsZVZhbHVlVmFsaWRhdG9yO1xuICAgICAgICB0aGlzLmlkZW50aWZ5aW5nID0gaWRlbnRpZnlpbmc7XG4gICAgICAgIHRoaXMubWluT2NjdXJzID0gbWluT2NjdXJzO1xuICAgICAgICB0aGlzLm1heE9jY3VycyA9IG1heE9jY3VycztcbiAgICB9XG5cbiAgICBzZXQoa2V5LCB2YWwpIHtcbiAgICAgICAgdGhpc1trZXldID0gdmFsO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB2YWxpZGF0ZSh2YWx1ZSkge1xuICAgICAgICB2YXIgaXNBcnJheSA9IFV0aWxzLmlzQXJyYXkodmFsdWUpO1xuXG4gICAgICAgIGlmICh0aGlzLm1heE9jY3VycyA+IDEgJiYgIWlzQXJyYXkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaXNBcnJheSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmFsaWRhdGVTaW5nbGVWYWx1ZSh2YWx1ZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPCB0aGlzLm1pbk9jY3VycyB8fCB2YWx1ZS5sZW5ndGggPiB0aGlzLm1heE9jY3Vycykge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWx1ZS5ldmVyeSh0aGlzLnZhbGlkYXRlU2luZ2xlVmFsdWUsIHRoaXMpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy52YWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRvcih2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZVNpbmdsZVZhbHVlKHZhbHVlKSB7XG4gICAgICAgIGlmICgodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgJiYgdGhpcy5taW5PY2N1cnMgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnJlcXVpcmVkICYmICghdmFsdWUgJiYgdmFsdWUgIT09IDAgJiYgdmFsdWUgIT09IGZhbHNlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLlNUUklORyA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc1N0cmluZyh2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoUEFSQU1FVEVSX1RZUEUuREFURSA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc0RhdGUodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLklOVEVHRVIgPT09IHRoaXMudHlwZSAmJiAhVXRpbHMuaXNJbnQodmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFBBUkFNRVRFUl9UWVBFLk5VTUJFUiA9PT0gdGhpcy50eXBlICYmICFVdGlscy5pc051bWJlcih2YWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChQQVJBTUVURVJfVFlQRS5DT01QT1NJVEUgPT09IHRoaXMudHlwZSkge1xuICAgICAgICAgICAgaWYgKCFVdGlscy5pc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXRoaXMubmVzdGVkUGFyYW1ldGVycy5ldmVyeSgobmVzdGVkRGVmLCBpKT0+bmVzdGVkRGVmLnZhbGlkYXRlKHZhbHVlW25lc3RlZERlZi5uYW1lXSkpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuc2luZ2xlVmFsdWVWYWxpZGF0b3IpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNpbmdsZVZhbHVlVmFsaWRhdG9yKHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cbiIsImltcG9ydCB7UEFSQU1FVEVSX1RZUEV9IGZyb20gXCIuL2pvYi1wYXJhbWV0ZXItZGVmaW5pdGlvblwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JQYXJhbWV0ZXJze1xuICAgIGRlZmluaXRpb25zID0gW107XG4gICAgdmFsdWVzPXt9O1xuXG4gICAgY29uc3RydWN0b3IodmFsdWVzKXtcbiAgICAgICAgdGhpcy5pbml0RGVmaW5pdGlvbnMoKTtcbiAgICAgICAgdGhpcy5pbml0RGVmYXVsdFZhbHVlcygpO1xuICAgICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgICAgICBVdGlscy5kZWVwRXh0ZW5kKHRoaXMudmFsdWVzLCB2YWx1ZXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5pdERlZmluaXRpb25zKCl7XG5cbiAgICB9XG5cbiAgICBpbml0RGVmYXVsdFZhbHVlcygpe1xuXG4gICAgfVxuXG4gICAgdmFsaWRhdGUoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVmaW5pdGlvbnMuZXZlcnkoKGRlZiwgaSk9PmRlZi52YWxpZGF0ZSh0aGlzLnZhbHVlc1tkZWYubmFtZV0pKTtcbiAgICB9XG5cbiAgICAvKmdldCBvciBzZXQgdmFsdWUgYnkgcGF0aCovXG4gICAgdmFsdWUocGF0aCwgdmFsdWUpe1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuICBVdGlscy5nZXQodGhpcy52YWx1ZXMsIHBhdGgsIG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIFV0aWxzLnNldCh0aGlzLnZhbHVlcywgcGF0aCwgdmFsdWUpO1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFwiSm9iUGFyYW1ldGVyc1tcIjtcblxuICAgICAgICB0aGlzLmRlZmluaXRpb25zLmZvckVhY2goKGQsIGkpPT4ge1xuXG4gICAgICAgICAgICB2YXIgdmFsID0gdGhpcy52YWx1ZXNbZC5uYW1lXTtcbiAgICAgICAgICAgIC8vIGlmKFV0aWxzLmlzQXJyYXkodmFsKSl7XG4gICAgICAgICAgICAvLyAgICAgdmFyIHZhbHVlcyA9IHZhbDtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgLy8gaWYoUEFSQU1FVEVSX1RZUEUuQ09NUE9TSVRFID09IGQudHlwZSl7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICByZXN1bHQgKz0gZC5uYW1lICsgXCI9XCIrdmFsICsgXCI7XCI7XG4gICAgICAgIH0pO1xuICAgICAgICByZXN1bHQrPVwiXVwiO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGdldERUTygpe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsdWVzOiB0aGlzLnZhbHVlc1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHtKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtkZWZhdWx0IGFzIGlkYn0gZnJvbSBcImlkYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4uL2pvYi1leGVjdXRpb25cIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtEYXRhTW9kZWx9IGZyb20gXCJzZC1tb2RlbFwiO1xuXG4vKiBJbmRleGVkREIgam9iIHJlcG9zaXRvcnkqL1xuZXhwb3J0IGNsYXNzIElkYkpvYlJlcG9zaXRvcnkgZXh0ZW5kcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGRiUHJvbWlzZTtcbiAgICBqb2JJbnN0YW5jZURhbztcbiAgICBqb2JFeGVjdXRpb25EYW87XG4gICAgc3RlcEV4ZWN1dGlvbkRhbztcbiAgICBqb2JSZXN1bHREYW87XG4gICAgam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW87XG4gICAgam9iRXhlY3V0aW9uRmxhZ0RhbztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25zUmV2aXZlciwgZGJOYW1lID0nc2Qtam9iLXJlcG9zaXRvcnknLCBkZWxldGVEQj1mYWxzZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmRiTmFtZT1kYk5hbWU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNSZXZpdmVyID0gZXhwcmVzc2lvbnNSZXZpdmVyO1xuICAgICAgICBpZihkZWxldGVEQil7XG4gICAgICAgICAgICB0aGlzLmRlbGV0ZURCKCkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIHRoaXMuaW5pdERCKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pbml0REIoKVxuICAgICAgICB9XG5cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlRGFvID0gbmV3IE9iamVjdFN0b3JlRGFvKCdqb2ItaW5zdGFuY2VzJywgdGhpcy5kYlByb21pc2UpO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkRhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbnMnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnLCB0aGlzLmRiUHJvbWlzZSk7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0RhbyA9IG5ldyBPYmplY3RTdG9yZURhbygnam9iLWV4ZWN1dGlvbi1mbGFncycsIHRoaXMuZGJQcm9taXNlKTtcblxuICAgICAgICB0aGlzLnN0ZXBFeGVjdXRpb25EYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ3N0ZXAtZXhlY3V0aW9ucycsIHRoaXMuZGJQcm9taXNlKTtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHREYW8gPSBuZXcgT2JqZWN0U3RvcmVEYW8oJ2pvYi1yZXN1bHRzJywgdGhpcy5kYlByb21pc2UpO1xuICAgIH1cblxuICAgIGluaXREQigpe1xuICAgICAgICB0aGlzLmRiUHJvbWlzZSA9IGlkYi5vcGVuKHRoaXMuZGJOYW1lLCAxLCB1cGdyYWRlREIgPT4ge1xuICAgICAgICAgICAgdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItaW5zdGFuY2VzJyk7XG4gICAgICAgICAgICB2YXIgam9iRXhlY3V0aW9uc09TID0gdXBncmFkZURCLmNyZWF0ZU9iamVjdFN0b3JlKCdqb2ItZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9uc09TLmNyZWF0ZUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBcImpvYkluc3RhbmNlLmlkXCIsIHsgdW5pcXVlOiBmYWxzZSB9KTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImNyZWF0ZVRpbWVcIiwgXCJjcmVhdGVUaW1lXCIsIHsgdW5pcXVlOiBmYWxzZSB9KTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcInN0YXR1c1wiLCBcInN0YXR1c1wiLCB7IHVuaXF1ZTogZmFsc2UgfSk7XG4gICAgICAgICAgICB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1leGVjdXRpb24tcHJvZ3Jlc3MnKTtcbiAgICAgICAgICAgIHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZSgnam9iLWV4ZWN1dGlvbi1mbGFncycpO1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zT1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ3N0ZXAtZXhlY3V0aW9ucycpO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnNPUy5jcmVhdGVJbmRleChcImpvYkV4ZWN1dGlvbklkXCIsIFwiam9iRXhlY3V0aW9uSWRcIiwgeyB1bmlxdWU6IGZhbHNlIH0pO1xuXG4gICAgICAgICAgICB2YXIgam9iUmVzdWx0T1MgPSB1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUoJ2pvYi1yZXN1bHRzJyk7XG4gICAgICAgICAgICBqb2JSZXN1bHRPUy5jcmVhdGVJbmRleChcImpvYkluc3RhbmNlSWRcIiwgXCJqb2JJbnN0YW5jZS5pZFwiLCB7IHVuaXF1ZTogdHJ1ZSB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZGVsZXRlREIoKXtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oXz0+aWRiLmRlbGV0ZSh0aGlzLmRiTmFtZSkpO1xuICAgIH1cblxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLmdldChqb2JSZXN1bHRJZCk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0QnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlc3VsdERhby5nZXRCeUluZGV4KFwiam9iSW5zdGFuY2VJZFwiLCBqb2JJbnN0YW5jZS5pZCk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVzdWx0RGFvLnNldChqb2JSZXN1bHQuaWQsIGpvYlJlc3VsdCkudGhlbihyPT5qb2JSZXN1bHQpO1xuICAgIH1cblxuICAgIC8qcmV0dXJucyBwcm9taXNlKi9cbiAgICBnZXRKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLmdldChrZXkpLnRoZW4oZHRvPT5kdG8gPyB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0byk6IGR0byk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBpbnN0YW5jZSovXG4gICAgc2F2ZUpvYkluc3RhbmNlKGpvYkluc3RhbmNlLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkluc3RhbmNlRGFvLnNldChrZXksIGpvYkluc3RhbmNlKS50aGVuKHI9PmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGpvYkV4ZWN1dGlvbiovXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IGpvYkV4ZWN1dGlvbi5nZXREVE8oKTtcbiAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zRFRPcyA9IGR0by5zdGVwRXhlY3V0aW9ucztcbiAgICAgICAgZHRvLnN0ZXBFeGVjdXRpb25zPW51bGw7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkRhby5zZXQoam9iRXhlY3V0aW9uLmlkLCBkdG8pLnRoZW4ocj0+dGhpcy5zYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zRFRPcykpLnRoZW4ocj0+am9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25Qcm9ncmVzc0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKVxuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uUHJvZ3Jlc3NEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIHNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkLCBmbGFnKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uRmxhZ0Rhby5zZXQoam9iRXhlY3V0aW9uSWQsIGZsYWcpXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbkZsYWdEYW8uZ2V0KGpvYkV4ZWN1dGlvbklkKVxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHdoaWNoIHJlc29sdmVzIHRvIHNhdmVkIHN0ZXBFeGVjdXRpb24qL1xuICAgIHNhdmVTdGVwRXhlY3V0aW9uKHN0ZXBFeGVjdXRpb24pIHtcbiAgICAgICAgdmFyIGR0byA9IHN0ZXBFeGVjdXRpb24uZ2V0RFRPKFtcImpvYkV4ZWN1dGlvblwiXSk7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZXBFeGVjdXRpb25EYW8uc2V0KHN0ZXBFeGVjdXRpb24uaWQsIGR0bykudGhlbihyPT5zdGVwRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbnNEVE9TKHN0ZXBFeGVjdXRpb25zLCBzYXZlZEV4ZWN1dGlvbnM9W10pIHtcbiAgICAgICAgaWYoc3RlcEV4ZWN1dGlvbnMubGVuZ3RoPD1zYXZlZEV4ZWN1dGlvbnMubGVuZ3RoKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc2F2ZWRFeGVjdXRpb25zKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcEV4ZWN1dGlvbkRUTyA9IHN0ZXBFeGVjdXRpb25zW3NhdmVkRXhlY3V0aW9ucy5sZW5ndGhdO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLnNldChzdGVwRXhlY3V0aW9uRFRPLmlkLCBzdGVwRXhlY3V0aW9uRFRPKS50aGVuKCgpPT57XG4gICAgICAgICAgICBzYXZlZEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVTdGVwRXhlY3V0aW9uc0RUT1Moc3RlcEV4ZWN1dGlvbnMsIHNhdmVkRXhlY3V0aW9ucyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkJ5SWQoaWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0KGlkKS50aGVuKGR0bz0+e1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZHRvKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoam9iRXhlY3V0aW9uRFRPLCByZXZpdmU9dHJ1ZSl7XG4gICAgICAgIGlmKCFqb2JFeGVjdXRpb25EVE8pe1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25EVE8uaWQsIGZhbHNlKS50aGVuKHN0ZXBzPT57XG4gICAgICAgICAgICBqb2JFeGVjdXRpb25EVE8uc3RlcEV4ZWN1dGlvbnMgPSBzdGVwcztcbiAgICAgICAgICAgIGlmKCFyZXZpdmUpe1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb25EVE87XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXZpdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uRFRPKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBmZXRjaEpvYkV4ZWN1dGlvbnNSZWxhdGlvbnMoam9iRXhlY3V0aW9uRHRvTGlzdCwgcmV2aXZlPXRydWUsIGZldGNoZWQ9W10pe1xuICAgICAgICBpZihqb2JFeGVjdXRpb25EdG9MaXN0Lmxlbmd0aDw9ZmV0Y2hlZC5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmZXRjaGVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5mZXRjaEpvYkV4ZWN1dGlvblJlbGF0aW9ucyhqb2JFeGVjdXRpb25EdG9MaXN0W2ZldGNoZWQubGVuZ3RoXSwgcmV2aXZlKS50aGVuKChqb2JFeGVjdXRpb24pPT57XG4gICAgICAgICAgICBmZXRjaGVkLnB1c2goam9iRXhlY3V0aW9uKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmV0Y2hKb2JFeGVjdXRpb25zUmVsYXRpb25zKGpvYkV4ZWN1dGlvbkR0b0xpc3QsIHJldml2ZSwgZmV0Y2hlZCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZpbmRTdGVwRXhlY3V0aW9ucyhqb2JFeGVjdXRpb25JZCwgcmV2aXZlPXRydWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVwRXhlY3V0aW9uRGFvLmdldEFsbEJ5SW5kZXgoXCJqb2JFeGVjdXRpb25JZFwiLCBqb2JFeGVjdXRpb25JZCkudGhlbihkdG9zPT57XG4gICAgICAgICAgICBpZighcmV2aXZlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZHRvcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkdG9zLm1hcChkdG89PnRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8pKTtcbiAgICAgICAgfSlcbiAgICB9XG5cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSwgZmV0Y2hSZWxhdGlvbnNBbmRSZXZpdmU9dHJ1ZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb25EYW8uZ2V0QWxsQnlJbmRleChcImpvYkluc3RhbmNlSWRcIiwgam9iSW5zdGFuY2UuaWQpLnRoZW4odmFsdWVzPT4ge1xuICAgICAgICAgICAgdmFyIHNvcnRlZCA9ICB2YWx1ZXMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhLmNyZWF0ZVRpbWUuZ2V0VGltZSgpIC0gYi5jcmVhdGVUaW1lLmdldFRpbWUoKVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmKCFmZXRjaFJlbGF0aW9uc0FuZFJldml2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmZldGNoSm9iRXhlY3V0aW9uc1JlbGF0aW9ucyhzb3J0ZWQsIHRydWUpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UsIGZhbHNlKS50aGVuKGV4ZWN1dGlvbnM9PnRoaXMuZmV0Y2hKb2JFeGVjdXRpb25SZWxhdGlvbnMoZXhlY3V0aW9uc1tleGVjdXRpb25zLmxlbmd0aCAtMV0pKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zPVtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT57XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIHJldml2ZUpvYkluc3RhbmNlKGR0bykge1xuICAgICAgICByZXR1cm4gbmV3IEpvYkluc3RhbmNlKGR0by5pZCwgZHRvLmpvYk5hbWUpO1xuICAgIH1cblxuICAgIHJldml2ZUV4ZWN1dGlvbkNvbnRleHQoZHRvKSB7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgZXhlY3V0aW9uQ29udGV4dC5jb250ZXh0ID0gZHRvLmNvbnRleHQ7XG4gICAgICAgIHZhciBkYXRhID0gZXhlY3V0aW9uQ29udGV4dC5nZXREYXRhKCk7XG4gICAgICAgIGlmKGRhdGEpe1xuICAgICAgICAgICAgdmFyIGRhdGFNb2RlbCA9IG5ldyBEYXRhTW9kZWwoKTtcbiAgICAgICAgICAgIGRhdGFNb2RlbC5sb2FkRnJvbURUTyhkYXRhLCB0aGlzLmV4cHJlc3Npb25zUmV2aXZlcik7XG4gICAgICAgICAgICBleGVjdXRpb25Db250ZXh0LnNldERhdGEoZGF0YU1vZGVsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dFxuICAgIH1cblxuICAgIHJldml2ZUpvYkV4ZWN1dGlvbihkdG8pIHtcblxuICAgICAgICB2YXIgam9iID0gdGhpcy5nZXRKb2JCeU5hbWUoZHRvLmpvYkluc3RhbmNlLmpvYk5hbWUpO1xuICAgICAgICB2YXIgam9iSW5zdGFuY2UgPSB0aGlzLnJldml2ZUpvYkluc3RhbmNlKGR0by5qb2JJbnN0YW5jZSk7XG4gICAgICAgIHZhciBqb2JQYXJhbWV0ZXJzID0gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoZHRvLmpvYlBhcmFtZXRlcnMudmFsdWVzKTtcbiAgICAgICAgdmFyIGpvYkV4ZWN1dGlvbiA9IG5ldyBKb2JFeGVjdXRpb24oam9iSW5zdGFuY2UsIGpvYlBhcmFtZXRlcnMsIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChqb2JFeGVjdXRpb24sIGR0bywgKG9ialZhbHVlLCBzcmNWYWx1ZSwga2V5LCBvYmplY3QsIHNvdXJjZSwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJqb2JJbnN0YW5jZVwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkluc3RhbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iUGFyYW1ldGVyc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYlBhcmFtZXRlcnM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoa2V5ID09PSBcImpvYkV4ZWN1dGlvblwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJzdGVwRXhlY3V0aW9uc1wiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNyY1ZhbHVlLm1hcChzdGVwRFRPID0+IHRoaXMucmV2aXZlU3RlcEV4ZWN1dGlvbihzdGVwRFRPLCBqb2JFeGVjdXRpb24pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXZpdmVTdGVwRXhlY3V0aW9uKGR0bywgam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBzdGVwRXhlY3V0aW9uID0gbmV3IFN0ZXBFeGVjdXRpb24oZHRvLnN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGR0by5pZCk7XG4gICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gdGhpcy5yZXZpdmVFeGVjdXRpb25Db250ZXh0KGR0by5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmV0dXJuIFV0aWxzLm1lcmdlV2l0aChzdGVwRXhlY3V0aW9uLCBkdG8sIChvYmpWYWx1ZSwgc3JjVmFsdWUsIGtleSwgb2JqZWN0LCBzb3VyY2UsIHN0YWNrKT0+IHtcbiAgICAgICAgICAgIGlmIChrZXkgPT09IFwiam9iRXhlY3V0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gam9iRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGtleSA9PT0gXCJleGVjdXRpb25Db250ZXh0XCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG5cblxuY2xhc3MgT2JqZWN0U3RvcmVEYW8ge1xuXG4gICAgbmFtZTtcbiAgICBkYlByb21pc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBkYlByb21pc2UpIHtcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICAgICAgdGhpcy5kYlByb21pc2UgPSBkYlByb21pc2U7XG4gICAgfVxuXG4gICAgZ2V0KGtleSkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmdldChrZXkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRBbGxCeUluZGV4KGluZGV4TmFtZSwga2V5KXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcbiAgICAgICAgICAgICAgICAub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5pbmRleChpbmRleE5hbWUpLmdldEFsbChrZXkpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGdldEJ5SW5kZXgoaW5kZXhOYW1lLCBrZXkpe1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxuICAgICAgICAgICAgICAgIC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLmluZGV4KGluZGV4TmFtZSkuZ2V0KGtleSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2V0KGtleSwgdmFsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRiUHJvbWlzZS50aGVuKGRiID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHR4ID0gZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lLCAncmVhZHdyaXRlJyk7XG4gICAgICAgICAgICB0eC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpLnB1dCh2YWwsIGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHggPSBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsICdyZWFkd3JpdGUnKTtcbiAgICAgICAgICAgIHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSkuZGVsZXRlKGtleSk7XG4gICAgICAgICAgICByZXR1cm4gdHguY29tcGxldGU7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNsZWFyKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgJ3JlYWR3cml0ZScpO1xuICAgICAgICAgICAgdHgub2JqZWN0U3RvcmUodGhpcy5uYW1lKS5jbGVhcigpO1xuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBrZXlzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kYlByb21pc2UudGhlbihkYiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBrZXlzID0gW107XG4gICAgICAgICAgICBjb25zdCBzdG9yZSA9IHR4Lm9iamVjdFN0b3JlKHRoaXMubmFtZSk7XG5cbiAgICAgICAgICAgIC8vIFRoaXMgd291bGQgYmUgc3RvcmUuZ2V0QWxsS2V5cygpLCBidXQgaXQgaXNuJ3Qgc3VwcG9ydGVkIGJ5IEVkZ2Ugb3IgU2FmYXJpLlxuICAgICAgICAgICAgLy8gb3BlbktleUN1cnNvciBpc24ndCBzdXBwb3J0ZWQgYnkgU2FmYXJpLCBzbyB3ZSBmYWxsIGJhY2tcbiAgICAgICAgICAgIChzdG9yZS5pdGVyYXRlS2V5Q3Vyc29yIHx8IHN0b3JlLml0ZXJhdGVDdXJzb3IpLmNhbGwoc3RvcmUsIGN1cnNvciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFjdXJzb3IpIHJldHVybjtcbiAgICAgICAgICAgICAgICBrZXlzLnB1c2goY3Vyc29yLmtleSk7XG4gICAgICAgICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHR4LmNvbXBsZXRlLnRoZW4oKCkgPT4ga2V5cyk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iS2V5R2VuZXJhdG9yfSBmcm9tIFwiLi4vam9iLWtleS1nZW5lcmF0b3JcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2V9IGZyb20gXCIuLi9qb2ItaW5zdGFuY2VcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtKb2JFeGVjdXRpb259IGZyb20gXCIuLi9qb2ItZXhlY3V0aW9uXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9ufSBmcm9tIFwiLi4vZXhjZXB0aW9ucy9qb2ItZXhlY3V0aW9uLWFscmVhZHktcnVubmluZy1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4uL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7Sm9iSW5zdGFuY2VBbHJlYWR5Q29tcGxldGVFeGNlcHRpb259IGZyb20gXCIuLi9leGNlcHRpb25zL2pvYi1pbnN0YW5jZS1hbHJlYWR5LWNvbXBsZXRlLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi4vZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4uL3N0ZXAtZXhlY3V0aW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBKb2JSZXBvc2l0b3J5IHtcblxuICAgIGpvYkJ5TmFtZSA9IHt9O1xuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iQnlOYW1lW2pvYi5uYW1lXSA9IGpvYjtcbiAgICB9XG5cbiAgICBnZXRKb2JCeU5hbWUobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JCeU5hbWVbbmFtZV07XG4gICAgfVxuXG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeSBnZXRKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHNhdmVkIGluc3RhbmNlKi9cbiAgICBzYXZlSm9iSW5zdGFuY2Uoa2V5LCBqb2JJbnN0YW5jZSl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgam9iRXhlY3V0aW9uKi9cbiAgICBzYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbil7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iSW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgdXBkYXRlSm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQsIHByb2dyZXNzKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVKb2JJbnN0YW5jZSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25Qcm9ncmVzcyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBzYXZlSm9iRXhlY3V0aW9uRmxhZyhqb2JFeGVjdXRpb25JZCwgZmxhZyl7XG4gICAgICAgIHRocm93IFwiSm9iUmVwb3NpdG9yeS5zYXZlSm9iRXhlY3V0aW9uRmxhZyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYkV4ZWN1dGlvbkZsYWcgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG5cbiAgICAvKnNob3VsZCByZXR1cm4gcHJvbWlzZSB3aGljaCByZXNvbHZlcyB0byBzYXZlZCBzdGVwRXhlY3V0aW9uKi9cbiAgICBzYXZlU3RlcEV4ZWN1dGlvbihzdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNhdmVTdGVwRXhlY3V0aW9uIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCFcIlxuICAgIH1cblxuICAgIC8qZmluZCBqb2IgZXhlY3V0aW9ucyBzb3J0ZWQgYnkgY3JlYXRlVGltZSwgcmV0dXJucyBwcm9taXNlKi9cbiAgICBmaW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkge1xuICAgICAgICB0aHJvdyBcIkpvYlJlcG9zaXRvcnkuZmluZEpvYkV4ZWN1dGlvbnMgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICBnZXRKb2JSZXN1bHRCeUluc3RhbmNlKGpvYkluc3RhbmNlKXtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UgZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIVwiXG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhyb3cgXCJKb2JSZXBvc2l0b3J5LnNldEpvYlJlc3VsdCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQhXCJcbiAgICB9XG5cbiAgICAvKkNyZWF0ZSBhIG5ldyBKb2JJbnN0YW5jZSB3aXRoIHRoZSBuYW1lIGFuZCBqb2IgcGFyYW1ldGVycyBwcm92aWRlZC4gcmV0dXJuIHByb21pc2UqL1xuICAgIGNyZWF0ZUpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgdmFyIGpvYkluc3RhbmNlID0gbmV3IEpvYkluc3RhbmNlKFV0aWxzLmd1aWQoKSwgam9iTmFtZSk7XG4gICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyk7XG4gICAgfVxuXG4gICAgLypDaGVjayBpZiBhbiBpbnN0YW5jZSBvZiB0aGlzIGpvYiBhbHJlYWR5IGV4aXN0cyB3aXRoIHRoZSBwYXJhbWV0ZXJzIHByb3ZpZGVkLiovXG4gICAgaXNKb2JJbnN0YW5jZUV4aXN0cyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4ocmVzdWx0ID0+ICEhcmVzdWx0KS5jYXRjaChlcnJvcj0+ZmFsc2UpO1xuICAgIH1cblxuICAgIGdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICByZXR1cm4gam9iTmFtZSArIFwifFwiICsgSm9iS2V5R2VuZXJhdG9yLmdlbmVyYXRlS2V5KGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIC8qQ3JlYXRlIGEgSm9iRXhlY3V0aW9uIGZvciBhIGdpdmVuICBKb2IgYW5kIEpvYlBhcmFtZXRlcnMuIElmIG1hdGNoaW5nIEpvYkluc3RhbmNlIGFscmVhZHkgZXhpc3RzLFxuICAgICAqIHRoZSBqb2IgbXVzdCBiZSByZXN0YXJ0YWJsZSBhbmQgaXQncyBsYXN0IEpvYkV4ZWN1dGlvbiBtdXN0ICpub3QqIGJlXG4gICAgICogY29tcGxldGVkLiBJZiBtYXRjaGluZyBKb2JJbnN0YW5jZSBkb2VzIG5vdCBleGlzdCB5ZXQgaXQgd2lsbCBiZSAgY3JlYXRlZC4qL1xuXG4gICAgY3JlYXRlSm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMsIGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykudGhlbihqb2JJbnN0YW5jZT0+e1xuICAgICAgICAgICAgaWYgKGpvYkluc3RhbmNlICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5maW5kSm9iRXhlY3V0aW9ucyhqb2JJbnN0YW5jZSkudGhlbihleGVjdXRpb25zPT57XG4gICAgICAgICAgICAgICAgICAgIGV4ZWN1dGlvbnMuZm9yRWFjaChleGVjdXRpb249PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkV4ZWN1dGlvbkFscmVhZHlSdW5uaW5nRXhjZXB0aW9uKFwiQSBqb2IgZXhlY3V0aW9uIGZvciB0aGlzIGpvYiBpcyBhbHJlYWR5IHJ1bm5pbmc6IFwiICsgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBleGVjdXRpb24uc3RhdHVzID09IEpPQl9TVEFUVVMuQUJBTkRPTkVEKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkluc3RhbmNlQWxyZWFkeUNvbXBsZXRlRXhjZXB0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIkEgam9iIGluc3RhbmNlIGFscmVhZHkgZXhpc3RzIGFuZCBpcyBjb21wbGV0ZSBmb3IgcGFyYW1ldGVycz1cIiArIGpvYlBhcmFtZXRlcnNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKyBcIi4gIElmIHlvdSB3YW50IHRvIHJ1biB0aGlzIGpvYiBhZ2FpbiwgY2hhbmdlIHRoZSBwYXJhbWV0ZXJzLlwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGV4ZWN1dGlvbkNvbnRleHQgPSBleGVjdXRpb25zW2V4ZWN1dGlvbnMubGVuZ3RoIC0gMV0uZXhlY3V0aW9uQ29udGV4dDtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2pvYkluc3RhbmNlLCBleGVjdXRpb25Db250ZXh0XTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBubyBqb2IgZm91bmQsIGNyZWF0ZSBvbmVcbiAgICAgICAgICAgIGpvYkluc3RhbmNlID0gdGhpcy5jcmVhdGVKb2JJbnN0YW5jZShqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIHZhciBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIGV4ZWN1dGlvbkNvbnRleHQuc2V0RGF0YShkYXRhKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbam9iSW5zdGFuY2UsIGV4ZWN1dGlvbkNvbnRleHRdKTtcbiAgICAgICAgfSkudGhlbihpbnN0YW5jZUFuZEV4ZWN1dGlvbkNvbnRleHQ9PntcbiAgICAgICAgICAgIHZhciBqb2JFeGVjdXRpb24gPSBuZXcgSm9iRXhlY3V0aW9uKGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFswXSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgICAgICBqb2JFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCA9IGluc3RhbmNlQW5kRXhlY3V0aW9uQ29udGV4dFsxXTtcbiAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5sYXN0VXBkYXRlZCA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0TGFzdEpvYkV4ZWN1dGlvbihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEpvYkluc3RhbmNlKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpLnRoZW4oKGpvYkluc3RhbmNlKT0+e1xuICAgICAgICAgICAgaWYoIWpvYkluc3RhbmNlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKGpvYkluc3RhbmNlKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uQnlJbnN0YW5jZShqb2JJbnN0YW5jZSl7XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKS50aGVuKGV4ZWN1dGlvbnM9PmV4ZWN1dGlvbnNbZXhlY3V0aW9ucy5sZW5ndGggLTFdKTtcbiAgICB9XG5cbiAgICBnZXRMYXN0U3RlcEV4ZWN1dGlvbihqb2JJbnN0YW5jZSwgc3RlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmluZEpvYkV4ZWN1dGlvbnMoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9ucz0+e1xuICAgICAgICAgICAgdmFyIHN0ZXBFeGVjdXRpb25zPVtdO1xuICAgICAgICAgICAgam9iRXhlY3V0aW9ucy5mb3JFYWNoKGpvYkV4ZWN1dGlvbj0+am9iRXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmZpbHRlcihzPT5zLnN0ZXBOYW1lID09PSBzdGVwTmFtZSkuZm9yRWFjaCgocyk9PnN0ZXBFeGVjdXRpb25zLnB1c2gocykpKTtcbiAgICAgICAgICAgIHZhciBsYXRlc3QgPSBudWxsO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbnMuZm9yRWFjaChzPT57XG4gICAgICAgICAgICAgICAgaWYgKGxhdGVzdCA9PSBudWxsIHx8IGxhdGVzdC5zdGFydFRpbWUuZ2V0VGltZSgpIDwgcy5zdGFydFRpbWUuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdGVzdCA9IHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gbGF0ZXN0O1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGFkZFN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICBzdGVwRXhlY3V0aW9uLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgdXBkYXRlKG8pe1xuICAgICAgICBvLmxhc3RVcGRhdGVkID0gbmV3IERhdGUoKTtcblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgSm9iRXhlY3V0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNhdmVKb2JFeGVjdXRpb24obyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvIGluc3RhbmNlb2YgU3RlcEV4ZWN1dGlvbil7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zYXZlU3RlcEV4ZWN1dGlvbihvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IFwiT2JqZWN0IG5vdCB1cGRhdGFibGU6IFwiK29cbiAgICB9XG5cblxuICAgIHJlbW92ZShvKXsgLy9UT0RPXG4gICAgICAgIC8vIGlmKG8gaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pe1xuICAgICAgICAvLyAgICAgcmV0dXJuIHRoaXMucmVtb3ZlSm9iRXhlY3V0aW9uKG8pO1xuICAgICAgICAvLyB9XG4gICAgICAgIC8vXG4gICAgICAgIC8vIGlmKG8gaW5zdGFuY2VvZiBTdGVwRXhlY3V0aW9uKXtcbiAgICAgICAgLy8gICAgIHJldHVybiB0aGlzLnJlbW92ZVN0ZXBFeGVjdXRpb24obyk7XG4gICAgICAgIC8vIH1cbiAgICB9XG5cblxuXG4gICAgcmV2aXZlSm9iSW5zdGFuY2UoZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlRXhlY3V0aW9uQ29udGV4dChkdG8pIHtcbiAgICAgICAgcmV0dXJuIGR0bztcbiAgICB9XG5cbiAgICByZXZpdmVKb2JFeGVjdXRpb24oZHRvKSB7XG4gICAgICAgIHJldHVybiBkdG87XG4gICAgfVxuXG4gICAgcmV2aXZlU3RlcEV4ZWN1dGlvbihkdG8sIGpvYkV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gZHRvO1xuICAgIH1cbn1cbiIsImltcG9ydCB7Sm9iUmVwb3NpdG9yeX0gZnJvbSBcIi4vam9iLXJlcG9zaXRvcnlcIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG5cblxuZXhwb3J0IGNsYXNzIFRpbWVvdXRKb2JSZXBvc2l0b3J5IGV4dGVuZHMgSm9iUmVwb3NpdG9yeXtcbiAgICBqb2JJbnN0YW5jZXNCeUtleSA9IHt9O1xuICAgIGpvYkV4ZWN1dGlvbnMgPSBbXTtcbiAgICBzdGVwRXhlY3V0aW9ucyA9IFtdO1xuICAgIGV4ZWN1dGlvblByb2dyZXNzID0ge307XG4gICAgZXhlY3V0aW9uRmxhZ3MgPSB7fTtcbiAgICBqb2JSZXN1bHRzPVtdO1xuICAgIFxuICAgIGNyZWF0ZVRpbWVvdXRQcm9taXNlKHZhbHVlVG9SZXNvbHZlLCBkZWxheT0xKXtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmU9PntcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHZhbHVlVG9SZXNvbHZlKTtcbiAgICAgICAgICAgIH0sIGRlbGF5KVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKnJldHVybnMgcHJvbWlzZSovXG4gICAgZ2V0Sm9iSW5zdGFuY2Uoam9iTmFtZSwgam9iUGFyYW1ldGVycykge1xuICAgICAgICB2YXIga2V5ID0gdGhpcy5nZW5lcmF0ZUpvYkluc3RhbmNlS2V5KGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmpvYkluc3RhbmNlc0J5S2V5W2tleV0pO1xuICAgIH1cblxuICAgIC8qc2hvdWxkIHJldHVybiBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gc2F2ZWQgaW5zdGFuY2UqL1xuICAgIHNhdmVKb2JJbnN0YW5jZShqb2JJbnN0YW5jZSwgam9iUGFyYW1ldGVycyl7XG4gICAgICAgIHZhciBrZXkgPSB0aGlzLmdlbmVyYXRlSm9iSW5zdGFuY2VLZXkoam9iSW5zdGFuY2Uuam9iTmFtZSwgam9iUGFyYW1ldGVycyk7XG4gICAgICAgIHRoaXMuam9iSW5zdGFuY2VzQnlLZXlba2V5XSA9IGpvYkluc3RhbmNlO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShqb2JJbnN0YW5jZSk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iUmVzdWx0KGpvYlJlc3VsdElkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYlJlc3VsdHMsIHI9PnIuaWQ9PT1qb2JSZXN1bHRJZCkpO1xuICAgIH1cblxuICAgIGdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2Upe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShVdGlscy5maW5kKHRoaXMuam9iUmVzdWx0cywgcj0+ci5qb2JJbnN0YW5jZS5pZD09PWpvYkluc3RhbmNlLmlkKSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYlJlc3VsdChqb2JSZXN1bHQpIHtcbiAgICAgICAgdGhpcy5qb2JSZXN1bHRzLnB1c2goam9iUmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iUmVzdWx0KTtcbiAgICB9XG5cbiAgICBnZXRKb2JFeGVjdXRpb25CeUlkKGlkKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2UoVXRpbHMuZmluZCh0aGlzLmpvYkV4ZWN1dGlvbnMsIGV4PT5leC5pZD09PWlkKSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBzYXZlZCBqb2JFeGVjdXRpb24qL1xuICAgIHNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKXtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25zLnB1c2goam9iRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoam9iRXhlY3V0aW9uKTtcbiAgICB9XG5cbiAgICB1cGRhdGVKb2JFeGVjdXRpb25Qcm9ncmVzcyhqb2JFeGVjdXRpb25JZCwgcHJvZ3Jlc3Mpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSA9IHByb2dyZXNzO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZShwcm9ncmVzcyk7XG4gICAgfVxuXG4gICAgZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3Moam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvblByb2dyZXNzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQsIGZsYWcpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSA9IGZsYWc7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKGZsYWcpO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uSWQpe1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVUaW1lb3V0UHJvbWlzZSh0aGlzLmV4ZWN1dGlvbkZsYWdzW2pvYkV4ZWN1dGlvbklkXSk7XG4gICAgfVxuXG4gICAgLypzaG91bGQgcmV0dXJuIHByb21pc2Ugd2hpY2ggcmVzb2x2ZXMgdG8gc2F2ZWQgc3RlcEV4ZWN1dGlvbiovXG4gICAgc2F2ZVN0ZXBFeGVjdXRpb24oc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHRoaXMuc3RlcEV4ZWN1dGlvbnMucHVzaChzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGltZW91dFByb21pc2Uoc3RlcEV4ZWN1dGlvbik7XG4gICAgfVxuXG4gICAgLypmaW5kIGpvYiBleGVjdXRpb25zIHNvcnRlZCBieSBjcmVhdGVUaW1lLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGZpbmRKb2JFeGVjdXRpb25zKGpvYkluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVRpbWVvdXRQcm9taXNlKHRoaXMuam9iRXhlY3V0aW9ucy5maWx0ZXIoZT0+ZS5qb2JJbnN0YW5jZS5pZCA9PSBqb2JJbnN0YW5jZS5pZCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEuY3JlYXRlVGltZS5nZXRUaW1lKCkgLSBiLmNyZWF0ZVRpbWUuZ2V0VGltZSgpXG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICByZW1vdmUob2JqZWN0KXsgLy9UT0RPXG5cbiAgICB9XG59XG4iLCJpbXBvcnQge0pPQl9TVEFUVVN9IGZyb20gXCIuL2pvYi1zdGF0dXNcIjtcbmltcG9ydCB7U3RlcEV4ZWN1dGlvbn0gZnJvbSBcIi4vc3RlcC1leGVjdXRpb25cIjtcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuXG4vKmRvbWFpbiBvYmplY3QgcmVwcmVzZW50aW5nIHRoZSByZXN1bHQgb2YgYSBqb2IgaW5zdGFuY2UuKi9cbmV4cG9ydCBjbGFzcyBKb2JSZXN1bHQge1xuICAgIGlkO1xuICAgIGpvYkluc3RhbmNlO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIGRhdGE7XG5cbiAgICBjb25zdHJ1Y3Rvcihqb2JJbnN0YW5jZSwgaWQpIHtcbiAgICAgICAgaWYoaWQ9PT1udWxsIHx8IGlkID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5pZCA9IFV0aWxzLmd1aWQoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gam9iSW5zdGFuY2U7XG4gICAgfVxufVxuIiwiZXhwb3J0IGNvbnN0IEpPQl9TVEFUVVMgPSB7XG4gICAgQ09NUExFVEVEOiAnQ09NUExFVEVEJyxcbiAgICBTVEFSVElORzogJ1NUQVJUSU5HJyxcbiAgICBTVEFSVEVEOiAnU1RBUlRFRCcsXG4gICAgU1RPUFBJTkc6ICdTVE9QUElORycsXG4gICAgU1RPUFBFRDogJ1NUT1BQRUQnLFxuICAgIEZBSUxFRDogJ0ZBSUxFRCcsXG4gICAgVU5LTk9XTjogJ1VOS05PV04nLFxuICAgIEFCQU5ET05FRDogJ0FCQU5ET05FRCcsXG4gICAgRVhFQ1VUSU5HOiAnRVhFQ1VUSU5HJyAvL2ZvciBleGl0IHN0YXR1cyBvbmx5XG59O1xuIiwiaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iUGFyYW1ldGVyc0ludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLXBhcmFtZXRlcnMtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sm9iRGF0YUludmFsaWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWRhdGEtaW52YWxpZC1leGNlcHRpb25cIjtcbmltcG9ydCB7Sk9CX0VYRUNVVElPTl9GTEFHfSBmcm9tIFwiLi9qb2ItZXhlY3V0aW9uLWZsYWdcIjtcbmltcG9ydCB7Sm9iUmVzdWx0fSBmcm9tIFwiLi9qb2ItcmVzdWx0XCI7XG4vKkJhc2UgY2xhc3MgZm9yIGpvYnMqL1xuLy9BIEpvYiBpcyBhbiBlbnRpdHkgdGhhdCBlbmNhcHN1bGF0ZXMgYW4gZW50aXJlIGpvYiBwcm9jZXNzICggYW4gYWJzdHJhY3Rpb24gcmVwcmVzZW50aW5nIHRoZSBjb25maWd1cmF0aW9uIG9mIGEgam9iKS5cblxuZXhwb3J0IGNsYXNzIEpvYiB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIHN0ZXBzID0gW107XG5cbiAgICBpc1Jlc3RhcnRhYmxlPXRydWU7XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG4gICAgam9iUGFyYW1ldGVyc1ZhbGlkYXRvcjtcblxuICAgIGpvYlJlcG9zaXRvcnk7XG5cbiAgICBjb25zdHJ1Y3RvcihuYW1lLCBqb2JSZXBvc2l0b3J5LCBleHByZXNzaW9uc0V2YWx1YXRvciwgb2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSB7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMuam9iUGFyYW1ldGVyc1ZhbGlkYXRvciA9IHRoaXMuZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpO1xuICAgICAgICB0aGlzLmpvYkRhdGFWYWxpZGF0b3IgPSB0aGlzLmdldEpvYkRhdGFWYWxpZGF0b3IoKTtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciA9IGV4cHJlc3Npb25zRXZhbHVhdG9yO1xuICAgICAgICB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlciA9IG9iamVjdGl2ZVJ1bGVzTWFuYWdlcjtcbiAgICB9XG5cbiAgICBzZXRKb2JSZXBvc2l0b3J5KGpvYlJlcG9zaXRvcnkpIHtcbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gam9iUmVwb3NpdG9yeTtcbiAgICB9XG5cbiAgICBleGVjdXRlKGV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIHN0YXJ0aW5nOiBcIiwgZXhlY3V0aW9uKTtcbiAgICAgICAgdmFyIGpvYlJlc3VsdDtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhleGVjdXRpb24pLnRoZW4oZXhlY3V0aW9uPT57XG5cbiAgICAgICAgICAgIGlmIChleGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLlNUT1BQSU5HKSB7XG4gICAgICAgICAgICAgICAgLy8gVGhlIGpvYiB3YXMgYWxyZWFkeSBzdG9wcGVkXG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuU1RPUFBFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgICAgIGxvZy5kZWJ1ZyhcIkpvYiBleGVjdXRpb24gd2FzIHN0b3BwZWQ6IFwiICsgZXhlY3V0aW9uKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodGhpcy5qb2JQYXJhbWV0ZXJzVmFsaWRhdG9yICYmICF0aGlzLmpvYlBhcmFtZXRlcnNWYWxpZGF0b3IudmFsaWRhdGUoZXhlY3V0aW9uLmpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYlBhcmFtZXRlcnNJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgcGFyYW1ldGVycyBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih0aGlzLmpvYkRhdGFWYWxpZGF0b3IgJiYgIXRoaXMuam9iRGF0YVZhbGlkYXRvci52YWxpZGF0ZShleGVjdXRpb24uZ2V0RGF0YSgpKSl7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEpvYkRhdGFJbnZhbGlkRXhjZXB0aW9uKFwiSW52YWxpZCBqb2IgZGF0YSBpbiBqb2IgZXhlY3V0ZVwiKVxuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFt0aGlzLnVwZGF0ZVN0YXR1cyhleGVjdXRpb24sIEpPQl9TVEFUVVMuU1RBUlRFRCksIHRoaXMuZ2V0UmVzdWx0KGV4ZWN1dGlvbiksIHRoaXMudXBkYXRlUHJvZ3Jlc3MoZXhlY3V0aW9uKV0pLnRoZW4ocmVzPT57XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uPXJlc1swXTtcbiAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSByZXNbMV07XG4gICAgICAgICAgICAgICAgaWYoIWpvYlJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBqb2JSZXN1bHQgPSBuZXcgSm9iUmVzdWx0KGV4ZWN1dGlvbi5qb2JJbnN0YW5jZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYmVmb3JlSm9iKGV4ZWN1dGlvbikpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZG9FeGVjdXRlKGV4ZWN1dGlvbiwgam9iUmVzdWx0KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBsb2cuZGVidWcoXCJKb2IgZXhlY3V0aW9uIGNvbXBsZXRlOiBcIixleGVjdXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEpvYkludGVycnVwdGVkRXhjZXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIGpvYlwiLCBlKTtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gSk9CX1NUQVRVUy5TVE9QUEVEO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoXCJFbmNvdW50ZXJlZCBmYXRhbCBlcnJvciBleGVjdXRpbmcgam9iXCIsIGUpO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBleGVjdXRpb24uZXhpdFN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uO1xuICAgICAgICB9KS50aGVuKGV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYoam9iUmVzdWx0KXtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JSZXN1bHQoam9iUmVzdWx0KS50aGVuKCgpPT5leGVjdXRpb24pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgIGxvZy5lcnJvcihcIkVuY291bnRlcmVkIGZhdGFsIGVycm9yIHNhdmluZyBqb2IgcmVzdWx0c1wiLCBlKTtcbiAgICAgICAgICAgIGlmKGUpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuRkFJTEVEO1xuICAgICAgICAgICAgZXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oZXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGVjdXRpb24uZW5kVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoZXhlY3V0aW9uKSwgdGhpcy51cGRhdGVQcm9ncmVzcyhleGVjdXRpb24pXSkudGhlbihyZXM9PnJlc1swXSlcbiAgICAgICAgfSkudGhlbihleGVjdXRpb249PntcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5leGVjdXRpb25MaXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lcj0+bGlzdGVuZXIuYWZ0ZXJKb2IoZXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIGVuY291bnRlcmVkIGluIGFmdGVyU3RlcCBjYWxsYmFja1wiLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBleGVjdXRpb247XG4gICAgICAgIH0pXG4gICAgfVxuXG5cbiAgICB1cGRhdGVTdGF0dXMoam9iRXhlY3V0aW9uLCBzdGF0dXMpIHtcbiAgICAgICAgam9iRXhlY3V0aW9uLnN0YXR1cz1zdGF0dXM7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkudXBkYXRlKGpvYkV4ZWN1dGlvbilcbiAgICB9XG5cbiAgICB1cGRhdGVQcm9ncmVzcyhqb2JFeGVjdXRpb24pe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZUpvYkV4ZWN1dGlvblByb2dyZXNzKGpvYkV4ZWN1dGlvbi5pZCwgdGhpcy5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pKTtcbiAgICB9XG5cbiAgICAvKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgYWxsb3dpbmcgdGhlbSB0byBjb25jZW50cmF0ZSBvbiBwcm9jZXNzaW5nIGxvZ2ljIGFuZCBpZ25vcmUgbGlzdGVuZXJzLCByZXR1cm5zIHByb21pc2UqL1xuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuICAgICAgICB0aHJvdyAnZG9FeGVjdXRlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igam9iOiAnICsgdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgZ2V0Sm9iUGFyYW1ldGVyc1ZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAocGFyYW1zKSA9PiBwYXJhbXMudmFsaWRhdGUoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0Sm9iRGF0YVZhbGlkYXRvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoZGF0YSkgPT4gdHJ1ZVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkU3RlcChzdGVwKXtcbiAgICAgICAgdGhpcy5zdGVwcy5wdXNoKHN0ZXApO1xuICAgIH1cblxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyh2YWx1ZXMpe1xuICAgICAgICB0aHJvdyAnY3JlYXRlSm9iUGFyYW1ldGVycyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgKiBjdXJyZW50XG4gICAgKiB0b3RhbCAqL1xuICAgIGdldFByb2dyZXNzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IGV4ZWN1dGlvbi5zdGF0dXMgPT09IEpPQl9TVEFUVVMuQ09NUExFVEVEID8gMSA6IDBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpe1xuICAgICAgICB0aGlzLmV4ZWN1dGlvbkxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG5cbiAgICBjaGVja0V4ZWN1dGlvbkZsYWdzKGV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uRmxhZyhleGVjdXRpb24uaWQpLnRoZW4oZmxhZz0+e1xuICAgICAgICAgICAgaWYoSk9CX0VYRUNVVElPTl9GTEFHLlNUT1AgPT09IGZsYWcpe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5zdG9wKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhlY3V0aW9uXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZ2V0UmVzdWx0KGV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2UoZXhlY3V0aW9uLmpvYkluc3RhbmNlKTtcbiAgICB9XG5cbiAgICBqb2JSZXN1bHRUb0NzdlJvd3Moam9iUmVzdWx0LCBqb2JQYXJhbWV0ZXJzKXtcbiAgICAgICAgdGhyb3cgJ2pvYlJlc3VsdFRvQ3N2Um93cyBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIGpvYjogJyArIHRoaXMubmFtZVxuICAgIH1cbn1cbiIsImltcG9ydCB7bG9nfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2J9IGZyb20gXCIuL2pvYlwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge0V4ZWN1dGlvbkNvbnRleHR9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1N0ZXB9IGZyb20gXCIuL3N0ZXBcIjtcbmltcG9ydCB7Sm9iSW50ZXJydXB0ZWRFeGNlcHRpb259IGZyb20gXCIuL2V4Y2VwdGlvbnMvam9iLWludGVycnVwdGVkLWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKb2JSZXN0YXJ0RXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1yZXN0YXJ0LWV4Y2VwdGlvblwiO1xuaW1wb3J0IHtKT0JfRVhFQ1VUSU9OX0ZMQUd9IGZyb20gXCIuL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuXG4vKiBTaW1wbGUgSm9iIHRoYXQgc2VxdWVudGlhbGx5IGV4ZWN1dGVzIGEgam9iIGJ5IGl0ZXJhdGluZyB0aHJvdWdoIGl0cyBsaXN0IG9mIHN0ZXBzLiAgQW55IFN0ZXAgdGhhdCBmYWlscyB3aWxsIGZhaWwgdGhlIGpvYi4gIFRoZSBqb2IgaXNcbiBjb25zaWRlcmVkIGNvbXBsZXRlIHdoZW4gYWxsIHN0ZXBzIGhhdmUgYmVlbiBleGVjdXRlZC4qL1xuXG5leHBvcnQgY2xhc3MgU2ltcGxlSm9iIGV4dGVuZHMgSm9iIHtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIGpvYlJlcG9zaXRvcnksIGV4cHJlc3Npb25zRXZhbHVhdG9yLCBvYmplY3RpdmVSdWxlc01hbmFnZXIpIHtcbiAgICAgICAgc3VwZXIobmFtZSwgam9iUmVwb3NpdG9yeSwgZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlcilcbiAgICAgICAgdGhpcy5pbml0U3RlcHMoKTtcbiAgICB9XG5cblxuICAgIGluaXRTdGVwcygpe1xuXG4gICAgfVxuXG4gICAgZ2V0U3RlcChzdGVwTmFtZSkge1xuICAgICAgICByZXR1cm4gVXRpbHMuZmluZCh0aGlzLnN0ZXBzLCBzPT5zLm5hbWUgPT0gc3RlcE5hbWUpO1xuICAgIH1cblxuICAgIGRvRXhlY3V0ZShleGVjdXRpb24sIGpvYlJlc3VsdCkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGV4ZWN1dGlvbiwgam9iUmVzdWx0KS50aGVuKGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIGlmIChsYXN0RXhlY3V0ZWRTdGVwRXhlY3V0aW9uICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBsb2cuZGVidWcoXCJVcGRhdGluZyBKb2JFeGVjdXRpb24gc3RhdHVzOiBcIiwgbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgZXhlY3V0aW9uLnN0YXR1cyA9IGxhc3RFeGVjdXRlZFN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgICAgIGV4ZWN1dGlvbi5leGl0U3RhdHVzID0gbGFzdEV4ZWN1dGVkU3RlcEV4ZWN1dGlvbi5leGl0U3RhdHVzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGV4ZWN1dGlvbjtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGFuZGxlTmV4dFN0ZXAoam9iRXhlY3V0aW9uLCBqb2JSZXN1bHQsIHByZXZTdGVwPW51bGwsIHByZXZTdGVwRXhlY3V0aW9uPW51bGwpe1xuICAgICAgICB2YXIgc3RlcEluZGV4ID0gMDtcbiAgICAgICAgaWYocHJldlN0ZXApe1xuICAgICAgICAgICAgc3RlcEluZGV4ID0gdGhpcy5zdGVwcy5pbmRleE9mKHByZXZTdGVwKSsxO1xuICAgICAgICB9XG4gICAgICAgIGlmKHN0ZXBJbmRleD49dGhpcy5zdGVwcy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShwcmV2U3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3RlcCA9IHRoaXMuc3RlcHNbc3RlcEluZGV4XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlU3RlcChzdGVwLCBqb2JFeGVjdXRpb24sIGpvYlJlc3VsdCkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZihzdGVwRXhlY3V0aW9uLnN0YXR1cyAhPT0gSk9CX1NUQVRVUy5DT01QTEVURUQpeyAvLyBUZXJtaW5hdGUgdGhlIGpvYiBpZiBhIHN0ZXAgZmFpbHNcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5leHRTdGVwKGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0LCBzdGVwLCBzdGVwRXhlY3V0aW9uKTtcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBoYW5kbGVTdGVwKHN0ZXAsIGpvYkV4ZWN1dGlvbiwgam9iUmVzdWx0KSB7XG4gICAgICAgIHZhciBqb2JJbnN0YW5jZSA9IGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tFeGVjdXRpb25GbGFncyhqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmlzU3RvcHBpbmcoKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBKb2JJbnRlcnJ1cHRlZEV4Y2VwdGlvbihcIkpvYkV4ZWN1dGlvbiBpbnRlcnJ1cHRlZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldExhc3RTdGVwRXhlY3V0aW9uKGpvYkluc3RhbmNlLCBzdGVwLm5hbWUpXG5cbiAgICAgICAgfSkudGhlbihsYXN0U3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgaWYgKHRoaXMuc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgbGFzdFN0ZXBFeGVjdXRpb24pKSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlIGxhc3QgZXhlY3V0aW9uIG9mIHRoaXMgc3RlcCB3YXMgaW4gdGhlIHNhbWUgam9iLCBpdCdzIHByb2JhYmx5IGludGVudGlvbmFsIHNvIHdlIHdhbnQgdG8gcnVuIGl0IGFnYWluLlxuICAgICAgICAgICAgICAgIGxvZy5pbmZvKFwiRHVwbGljYXRlIHN0ZXAgZGV0ZWN0ZWQgaW4gZXhlY3V0aW9uIG9mIGpvYi4gc3RlcDogXCIgKyBzdGVwLm5hbWUgKyBcIiBqb2JOYW1lOiBcIiwgam9iSW5zdGFuY2Uuam9iTmFtZSk7XG4gICAgICAgICAgICAgICAgbGFzdFN0ZXBFeGVjdXRpb24gPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgY3VycmVudFN0ZXBFeGVjdXRpb24gPSBsYXN0U3RlcEV4ZWN1dGlvbjtcblxuICAgICAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0YXJ0KGN1cnJlbnRTdGVwRXhlY3V0aW9uLCBqb2JFeGVjdXRpb24sIHN0ZXApKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbi5jcmVhdGVTdGVwRXhlY3V0aW9uKHN0ZXAubmFtZSk7XG5cbiAgICAgICAgICAgIHZhciBpc0NvbXBsZXRlZCA9IGxhc3RTdGVwRXhlY3V0aW9uICE9IG51bGwgJiYgbGFzdFN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgIHZhciBpc1Jlc3RhcnQgPSBsYXN0U3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmICFpc0NvbXBsZXRlZDtcbiAgICAgICAgICAgIHZhciBza2lwRXhlY3V0aW9uID0gaXNDb21wbGV0ZWQgJiYgc3RlcC5za2lwT25SZXN0YXJ0SWZDb21wbGV0ZWQ7XG5cbiAgICAgICAgICAgIGlmIChpc1Jlc3RhcnQpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dDtcbiAgICAgICAgICAgICAgICBpZiAobGFzdFN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dC5jb250YWluc0tleShcImV4ZWN1dGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucmVtb3ZlKFwiZXhlY3V0ZWRcIik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKHNraXBFeGVjdXRpb24pe1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkNPTVBMRVRFRDtcbiAgICAgICAgICAgICAgICBjdXJyZW50U3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0LnB1dChcInNraXBwZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuYWRkU3RlcEV4ZWN1dGlvbihjdXJyZW50U3RlcEV4ZWN1dGlvbikudGhlbigoX2N1cnJlbnRTdGVwRXhlY3V0aW9uKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uPV9jdXJyZW50U3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgICAgICBpZihza2lwRXhlY3V0aW9uKXtcbiAgICAgICAgICAgICAgICAgICAgbG9nLmluZm8oXCJTa2lwcGluZyBjb21wbGV0ZWQgc3RlcCBleGVjdXRpb246IFtcIiArIHN0ZXAubmFtZSArIFwiXVwiKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsb2cuaW5mbyhcIkV4ZWN1dGluZyBzdGVwOiBbXCIgKyBzdGVwLm5hbWUgKyBcIl1cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0ZXAuZXhlY3V0ZShjdXJyZW50U3RlcEV4ZWN1dGlvbiwgam9iUmVzdWx0KVxuICAgICAgICAgICAgfSkudGhlbigoKT0+e1xuICAgICAgICAgICAgICAgIGN1cnJlbnRTdGVwRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQucHV0KFwiZXhlY3V0ZWRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRTdGVwRXhlY3V0aW9uO1xuICAgICAgICAgICAgfSkuY2F0Y2ggKGUgPT4ge1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnVwZGF0ZShqb2JFeGVjdXRpb24pLnRoZW4oam9iRXhlY3V0aW9uPT57dGhyb3cgZX0pXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KS50aGVuKChjdXJyZW50U3RlcEV4ZWN1dGlvbik9PntcbiAgICAgICAgICAgIGlmIChjdXJyZW50U3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUElOR1xuICAgICAgICAgICAgICAgIHx8IGN1cnJlbnRTdGVwRXhlY3V0aW9uLnN0YXR1cyA9PSBKT0JfU1RBVFVTLlNUT1BQRUQpIHtcbiAgICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgam9iIGdldHMgdGhlIG1lc3NhZ2UgdGhhdCBpdCBpcyBzdG9wcGluZ1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLlNUT1BQSU5HO1xuICAgICAgICAgICAgICAgIC8vIHRocm93IG5ldyBFcnJvcihcIkpvYiBpbnRlcnJ1cHRlZCBieSBzdGVwIGV4ZWN1dGlvblwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZVByb2dyZXNzKGpvYkV4ZWN1dGlvbikudGhlbigoKT0+Y3VycmVudFN0ZXBFeGVjdXRpb24pO1xuICAgICAgICB9KVxuXG4gICAgfVxuXG4gICAgc3RlcEV4ZWN1dGlvblBhcnRPZkV4aXN0aW5nSm9iRXhlY3V0aW9uKGpvYkV4ZWN1dGlvbiwgc3RlcEV4ZWN1dGlvbikge1xuICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvbiAhPSBudWxsICYmIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmlkID09IGpvYkV4ZWN1dGlvbi5pZFxuICAgIH1cblxuICAgIHNob3VsZFN0YXJ0KGxhc3RTdGVwRXhlY3V0aW9uLCBleGVjdXRpb24sIHN0ZXApIHtcbiAgICAgICAgdmFyIHN0ZXBTdGF0dXM7XG4gICAgICAgIGlmIChsYXN0U3RlcEV4ZWN1dGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICBzdGVwU3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVElORztcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHN0ZXBTdGF0dXMgPSBsYXN0U3RlcEV4ZWN1dGlvbi5zdGF0dXM7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc3RlcFN0YXR1cyA9PSBKT0JfU1RBVFVTLlVOS05PV04pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBKb2JSZXN0YXJ0RXhjZXB0aW9uKFwiQ2Fubm90IHJlc3RhcnQgc3RlcCBmcm9tIFVOS05PV04gc3RhdHVzXCIpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc3RlcFN0YXR1cyAhPSBKT0JfU1RBVFVTLkNPTVBMRVRFRCB8fCBzdGVwLmlzUmVzdGFydGFibGU7XG4gICAgfVxuXG4gICAgZ2V0UHJvZ3Jlc3MoZXhlY3V0aW9uKXtcbiAgICAgICAgdmFyIGNvbXBsZXRlZFN0ZXBzID0gZXhlY3V0aW9uLnN0ZXBFeGVjdXRpb25zLmxlbmd0aDtcbiAgICAgICAgaWYoSk9CX1NUQVRVUy5DT01QTEVURUQgIT09IGV4ZWN1dGlvbi5zdGVwRXhlY3V0aW9uc1tleGVjdXRpb24uc3RlcEV4ZWN1dGlvbnMubGVuZ3RoLTFdLnN0YXR1cyl7XG4gICAgICAgICAgICBjb21wbGV0ZWRTdGVwcy0tO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIE1hdGgucm91bmQoY29tcGxldGVkU3RlcHMgKiAxMDAgLyB0aGlzLnN0ZXBzLmxlbmd0aCk7XG4gICAgfVxuXG4gICAgYWRkU3RlcCgpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChhcmd1bWVudHNbMF0pXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXAgPSBuZXcgU3RlcChhcmd1bWVudHNbMF0sIHRoaXMuam9iUmVwb3NpdG9yeSk7XG4gICAgICAgIHN0ZXAuZG9FeGVjdXRlID0gYXJndW1lbnRzWzFdO1xuICAgICAgICByZXR1cm4gc3VwZXIuYWRkU3RlcChzdGVwKTtcbiAgICB9XG5cbn1cbiIsImV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uTGlzdGVuZXIge1xuICAgIC8qQ2FsbGVkIGJlZm9yZSBhIHN0ZXAgZXhlY3V0ZXMqL1xuICAgIGJlZm9yZVN0ZXAoam9iRXhlY3V0aW9uKSB7XG5cbiAgICB9XG5cbiAgICAvKkNhbGxlZCBhZnRlciBjb21wbGV0aW9uIG9mIGEgc3RlcC4gQ2FsbGVkIGFmdGVyIGJvdGggc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV4ZWN1dGlvbnMqL1xuICAgIGFmdGVyU3RlcChqb2JFeGVjdXRpb24pIHtcblxuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuaW1wb3J0IHtFeGVjdXRpb25Db250ZXh0fSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9qb2Itc3RhdHVzXCI7XG5pbXBvcnQge0pvYkV4ZWN1dGlvbn0gZnJvbSBcIi4vam9iLWV4ZWN1dGlvblwiO1xuXG4vKlxuIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBleGVjdXRpb24gb2YgYSBzdGVwXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGVwRXhlY3V0aW9uIHtcbiAgICBpZDtcbiAgICBzdGVwTmFtZTtcbiAgICBqb2JFeGVjdXRpb247XG5cbiAgICBzdGF0dXMgPSBKT0JfU1RBVFVTLlNUQVJUSU5HO1xuICAgIGV4aXRTdGF0dXMgPSBKT0JfU1RBVFVTLkVYRUNVVElORztcbiAgICBleGVjdXRpb25Db250ZXh0ID0gbmV3IEV4ZWN1dGlvbkNvbnRleHQoKTsgLy9leGVjdXRpb24gY29udGV4dCBmb3Igc2luZ2xlIHN0ZXAgbGV2ZWwsXG5cbiAgICBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGVuZFRpbWUgPSBudWxsO1xuICAgIGxhc3RVcGRhdGVkID0gbnVsbDtcblxuICAgIHRlcm1pbmF0ZU9ubHkgPSBmYWxzZTsgLy9mbGFnIHRvIGluZGljYXRlIHRoYXQgYW4gZXhlY3V0aW9uIHNob3VsZCBoYWx0XG4gICAgZmFpbHVyZUV4Y2VwdGlvbnMgPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKHN0ZXBOYW1lLCBqb2JFeGVjdXRpb24sIGlkKSB7XG4gICAgICAgIGlmKGlkPT09bnVsbCB8fCBpZCA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuaWQgPSBVdGlscy5ndWlkKCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zdGVwTmFtZSA9IHN0ZXBOYW1lO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbiA9IGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25JZCA9IGpvYkV4ZWN1dGlvbi5pZDtcbiAgICB9XG5cbiAgICBnZXRKb2JQYXJhbWV0ZXJzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYkV4ZWN1dGlvbi5qb2JQYXJhbWV0ZXJzO1xuICAgIH1cblxuICAgIGdldEpvYkV4ZWN1dGlvbkNvbnRleHQoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iRXhlY3V0aW9uLmV4ZWN1dGlvbkNvbnRleHQ7XG4gICAgfVxuXG4gICAgZ2V0RGF0YSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JFeGVjdXRpb24uZ2V0RGF0YSgpO1xuICAgIH1cblxuICAgIGdldERUTyhmaWx0ZXJlZFByb3BlcnRpZXM9W10sIGRlZXBDbG9uZSA9IHRydWUpe1xuXG4gICAgICAgIHZhciBjbG9uZU1ldGhvZCA9IFV0aWxzLmNsb25lRGVlcFdpdGg7XG4gICAgICAgIGlmKCFkZWVwQ2xvbmUpIHtcbiAgICAgICAgICAgIGNsb25lTWV0aG9kID0gVXRpbHMuY2xvbmVXaXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFV0aWxzLmFzc2lnbih7fSwgY2xvbmVNZXRob2QodGhpcywgKHZhbHVlLCBrZXksIG9iamVjdCwgc3RhY2spPT4ge1xuICAgICAgICAgICAgaWYoZmlsdGVyZWRQcm9wZXJ0aWVzLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihbXCJleGVjdXRpb25Db250ZXh0XCJdLmluZGV4T2Yoa2V5KT4tMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmdldERUTygpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gVXRpbHMuZ2V0RXJyb3JEVE8odmFsdWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBKb2JFeGVjdXRpb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWUuZ2V0RFRPKFtcInN0ZXBFeGVjdXRpb25zXCJdLCBkZWVwQ2xvbmUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgIH1cbn1cbiIsImltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuXG5pbXBvcnQge0pvYkludGVycnVwdGVkRXhjZXB0aW9ufSBmcm9tIFwiLi9leGNlcHRpb25zL2pvYi1pbnRlcnJ1cHRlZC1leGNlcHRpb25cIjtcbi8qZG9tYWluIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIGNvbmZpZ3VyYXRpb24gb2YgYSBqb2Igc3RlcCovXG5leHBvcnQgY2xhc3MgU3RlcCB7XG5cbiAgICBpZDtcbiAgICBuYW1lO1xuICAgIGlzUmVzdGFydGFibGUgPSB0cnVlO1xuICAgIHNraXBPblJlc3RhcnRJZkNvbXBsZXRlZD10cnVlO1xuICAgIHN0ZXBzID0gW107XG4gICAgZXhlY3V0aW9uTGlzdGVuZXJzID0gW107XG5cbiAgICBqb2JSZXBvc2l0b3J5O1xuXG4gICAgY29uc3RydWN0b3IobmFtZSwgam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIHNldEpvYlJlcG9zaXRvcnkoam9iUmVwb3NpdG9yeSkge1xuICAgICAgICB0aGlzLmpvYlJlcG9zaXRvcnkgPSBqb2JSZXBvc2l0b3J5O1xuICAgIH1cblxuICAgIC8qUHJvY2VzcyB0aGUgc3RlcCBhbmQgYXNzaWduIHByb2dyZXNzIGFuZCBzdGF0dXMgbWV0YSBpbmZvcm1hdGlvbiB0byB0aGUgU3RlcEV4ZWN1dGlvbiBwcm92aWRlZCovXG4gICAgZXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICAgICAgbG9nLmRlYnVnKFwiRXhlY3V0aW5nIHN0ZXA6IG5hbWU9XCIgKyB0aGlzLm5hbWUpO1xuICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHN0ZXBFeGVjdXRpb24uc3RhdHVzID0gSk9CX1NUQVRVUy5TVEFSVEVEO1xuICAgICAgICB2YXIgZXhpdFN0YXR1cztcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbikudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICBleGl0U3RhdHVzID0gSk9CX1NUQVRVUy5FWEVDVVRJTkc7XG5cbiAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmJlZm9yZVN0ZXAoc3RlcEV4ZWN1dGlvbikpO1xuICAgICAgICAgICAgdGhpcy5vcGVuKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpXG4gICAgICAgIH0pLnRoZW4oX3N0ZXBFeGVjdXRpb249PntcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24gPSBfc3RlcEV4ZWN1dGlvbjtcbiAgICAgICAgICAgIGV4aXRTdGF0dXMgPSBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXM7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHN0b3AgdXNcbiAgICAgICAgICAgIGlmIChzdGVwRXhlY3V0aW9uLnRlcm1pbmF0ZU9ubHkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24oXCJKb2JFeGVjdXRpb24gaW50ZXJydXB0ZWQuXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gTmVlZCB0byB1cGdyYWRlIGhlcmUgbm90IHNldCwgaW4gY2FzZSB0aGUgZXhlY3V0aW9uIHdhcyBzdG9wcGVkXG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IEpPQl9TVEFUVVMuQ09NUExFVEVEO1xuICAgICAgICAgICAgbG9nLmRlYnVnKFwiU3RlcCBleGVjdXRpb24gc3VjY2VzczogbmFtZT1cIiArIHRoaXMubmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAgICB9KS5jYXRjaChlPT57XG4gICAgICAgICAgICBzdGVwRXhlY3V0aW9uLnN0YXR1cyA9IHRoaXMuZGV0ZXJtaW5lSm9iU3RhdHVzKGUpO1xuICAgICAgICAgICAgZXhpdFN0YXR1cyA9IHN0ZXBFeGVjdXRpb24uc3RhdHVzO1xuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGUpO1xuXG4gICAgICAgICAgICBpZiAoc3RlcEV4ZWN1dGlvbi5zdGF0dXMgPT0gSk9CX1NUQVRVUy5TVE9QUEVEKSB7XG4gICAgICAgICAgICAgICAgbG9nLmluZm8oXCJFbmNvdW50ZXJlZCBpbnRlcnJ1cHRpb24gZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRW5jb3VudGVyZWQgYW4gZXJyb3IgZXhlY3V0aW5nIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0ZXBFeGVjdXRpb247XG4gICAgICAgIH0pLnRoZW4oc3RlcEV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmV4aXRTdGF0dXMgPSBleGl0U3RhdHVzO1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXI9Pmxpc3RlbmVyLmFmdGVyU3RlcChzdGVwRXhlY3V0aW9uKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiBpbiBhZnRlclN0ZXAgY2FsbGJhY2sgaW4gc3RlcCBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc3RlcEV4ZWN1dGlvbi5lbmRUaW1lID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZXhpdFN0YXR1cyA9IGV4aXRTdGF0dXM7XG5cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS51cGRhdGUoc3RlcEV4ZWN1dGlvbilcbiAgICAgICAgfSkudGhlbihzdGVwRXhlY3V0aW9uPT57XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xvc2Uoc3RlcEV4ZWN1dGlvbi5leGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgbG9nLmVycm9yKFwiRXhjZXB0aW9uIHdoaWxlIGNsb3Npbmcgc3RlcCBleGVjdXRpb24gcmVzb3VyY2VzIGluIHN0ZXA6IFwiICsgdGhpcy5uYW1lICsgXCIgaW4gam9iOiBcIiArIHN0ZXBFeGVjdXRpb24uam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmpvYk5hbWUsIGUpO1xuICAgICAgICAgICAgICAgIHN0ZXBFeGVjdXRpb24uZmFpbHVyZUV4Y2VwdGlvbnMucHVzaChlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsb3NlKHN0ZXBFeGVjdXRpb24uZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkV4Y2VwdGlvbiB3aGlsZSBjbG9zaW5nIHN0ZXAgZXhlY3V0aW9uIHJlc291cmNlcyBpbiBzdGVwOiBcIiArIHRoaXMubmFtZSArIFwiIGluIGpvYjogXCIgKyBzdGVwRXhlY3V0aW9uLmpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lLCBlKTtcbiAgICAgICAgICAgICAgICBzdGVwRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zLnB1c2goZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGRvRXhlY3V0aW9uUmVsZWFzZSgpO1xuXG4gICAgICAgICAgICBsb2cuZGVidWcoXCJTdGVwIGV4ZWN1dGlvbiBjb21wbGV0ZTogXCIgKyBzdGVwRXhlY3V0aW9uLmlkKTtcbiAgICAgICAgICAgIHJldHVybiBzdGVwRXhlY3V0aW9uO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGRldGVybWluZUpvYlN0YXR1cyhlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgSm9iSW50ZXJydXB0ZWRFeGNlcHRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBKT0JfU1RBVFVTLlNUT1BQRUQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gSk9CX1NUQVRVUy5GQUlMRUQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gZXhlY3V0ZSBidXNpbmVzcyBsb2dpYy4gU3ViY2xhc3NlcyBzaG91bGQgc2V0IHRoZSBleGl0U3RhdHVzIG9uIHRoZVxuICAgICAqIFN0ZXBFeGVjdXRpb24gYmVmb3JlIHJldHVybmluZy4gTXVzdCByZXR1cm4gc3RlcEV4ZWN1dGlvblxuICAgICAqL1xuICAgIGRvRXhlY3V0ZShzdGVwRXhlY3V0aW9uLCBqb2JSZXN1bHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgc3RlcCwgdG8gb3BlbiBvclxuICAgICAqIGFjcXVpcmUgcmVzb3VyY2VzLiBEb2VzIG5vdGhpbmcgYnkgZGVmYXVsdC5cbiAgICAgKi9cbiAgICBvcGVuKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRlbnNpb24gcG9pbnQgZm9yIHN1YmNsYXNzZXMgdG8gcHJvdmlkZSBjYWxsYmFja3MgdG8gdGhlaXIgY29sbGFib3JhdG9ycyBhdCB0aGUgZW5kIG9mIGEgc3RlcCAocmlnaHQgYXQgdGhlIGVuZFxuICAgICAqIG9mIHRoZSBmaW5hbGx5IGJsb2NrKSwgdG8gY2xvc2Ugb3IgcmVsZWFzZSByZXNvdXJjZXMuIERvZXMgbm90aGluZyBieSBkZWZhdWx0LlxuICAgICAqL1xuICAgIGNsb3NlKGV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICB9XG5cblxuICAgIC8qU2hvdWxkIHJldHVybiBwcm9ncmVzcyBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gICAgICogY3VycmVudFxuICAgICAqIHRvdGFsICovXG4gICAgZ2V0UHJvZ3Jlc3Moc3RlcEV4ZWN1dGlvbil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0b3RhbDogMSxcbiAgICAgICAgICAgIGN1cnJlbnQ6IHN0ZXBFeGVjdXRpb24uc3RhdHVzID09PSBKT0JfU1RBVFVTLkNPTVBMRVRFRCA/IDEgOiAwXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQgKiBhcyBlbmdpbmUgZnJvbSAnLi9lbmdpbmUvaW5kZXgnXG5cbmV4cG9ydCB7ZW5naW5lfVxuZXhwb3J0ICogZnJvbSAnLi9qb2JzLW1hbmFnZXInXG5leHBvcnQgKiBmcm9tICcuL2pvYi13b3JrZXInXG5cblxuXG4iLCJpbXBvcnQge0pvYkV4ZWN1dGlvbkxpc3RlbmVyfSBmcm9tIFwiLi9lbmdpbmUvam9iLWV4ZWN1dGlvbi1saXN0ZW5lclwiO1xuaW1wb3J0IHtKT0JfU1RBVFVTfSBmcm9tIFwiLi9lbmdpbmUvam9iLXN0YXR1c1wiO1xuaW1wb3J0IHtKb2JJbnN0YW5jZX0gZnJvbSBcIi4vZW5naW5lL2pvYi1pbnN0YW5jZVwiO1xuaW1wb3J0IHtVdGlscywgbG9nfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyQ29uZmlnIHtcbiAgICBvbkpvYlN0YXJ0ZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYkNvbXBsZXRlZCA9IHJlc3VsdCA9PiB7fTtcbiAgICBvbkpvYkZhaWxlZCA9IGVycm9ycyA9PiB7fTtcbiAgICBvbkpvYlN0b3BwZWQgPSAoKSA9PiB7fTtcbiAgICBvbkpvYlRlcm1pbmF0ZWQgPSAoKSA9PiB7fTtcbiAgICBvblByb2dyZXNzID0gKHByb2dyZXNzKSA9PiB7fTtcbiAgICBjYWxsYmFja3NUaGlzQXJnO1xuICAgIHVwZGF0ZUludGVydmFsID0gMTAwO1xuXG4gICAgY29uc3RydWN0b3IoY3VzdG9tKSB7XG4gICAgICAgIGlmIChjdXN0b20pIHtcbiAgICAgICAgICAgIFV0aWxzLmRlZXBFeHRlbmQodGhpcywgY3VzdG9tKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLypjb252ZW5pZW5jZSBjbGFzcyBmb3IgbWFuYWdpbmcgYW5kIHRyYWNraW5nIGpvYiBpbnN0YW5jZSBwcm9ncmVzcyovXG5leHBvcnQgY2xhc3MgSm9iSW5zdGFuY2VNYW5hZ2VyIGV4dGVuZHMgSm9iRXhlY3V0aW9uTGlzdGVuZXIge1xuXG4gICAgam9ic01hbmdlcjtcbiAgICBqb2JJbnN0YW5jZTtcbiAgICBjb25maWc7XG5cbiAgICBsYXN0Sm9iRXhlY3V0aW9uO1xuICAgIGxhc3RVcGRhdGVUaW1lO1xuICAgIHByb2dyZXNzID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKGpvYnNNYW5nZXIsIGpvYkluc3RhbmNlT3JFeGVjdXRpb24sIGNvbmZpZykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmNvbmZpZyA9IG5ldyBKb2JJbnN0YW5jZU1hbmFnZXJDb25maWcoY29uZmlnKTtcbiAgICAgICAgdGhpcy5qb2JzTWFuZ2VyID0gam9ic01hbmdlcjtcbiAgICAgICAgaWYgKGpvYkluc3RhbmNlT3JFeGVjdXRpb24gaW5zdGFuY2VvZiBKb2JJbnN0YW5jZSkge1xuICAgICAgICAgICAgdGhpcy5qb2JJbnN0YW5jZSA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKGplPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2tQcm9ncmVzcygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubGFzdEpvYkV4ZWN1dGlvbiA9IGpvYkluc3RhbmNlT3JFeGVjdXRpb247XG4gICAgICAgICAgICB0aGlzLmpvYkluc3RhbmNlID0gdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmpvYkluc3RhbmNlO1xuICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubGFzdEpvYkV4ZWN1dGlvbiAmJiAhdGhpcy5sYXN0Sm9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICB0aGlzLmFmdGVySm9iKHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgam9ic01hbmdlci5yZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKHRoaXMpO1xuICAgIH1cblxuICAgIGNoZWNrUHJvZ3Jlc3MoKSB7XG5cbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICBpZiAodGhpcy50ZXJtaW5hdGVkIHx8ICF0aGlzLmxhc3RKb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkgfHwgdGhpcy5nZXRQcm9ncmVzc1BlcmNlbnRzKHRoaXMucHJvZ3Jlc3MpID09PSAxMDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmpvYnNNYW5nZXIuZ2V0UHJvZ3Jlc3ModGhpcy5sYXN0Sm9iRXhlY3V0aW9uKS50aGVuKHByb2dyZXNzPT4ge1xuICAgICAgICAgICAgdGhpcy5sYXN0VXBkYXRlVGltZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBpZiAocHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gcHJvZ3Jlc3M7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWcub25Qcm9ncmVzcy5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgcHJvZ3Jlc3MpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmNoZWNrUHJvZ3Jlc3MoKTtcbiAgICAgICAgICAgIH0sIHRoaXMuY29uZmlnLnVwZGF0ZUludGVydmFsKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGJlZm9yZUpvYihqb2JFeGVjdXRpb24pIHtcbiAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZCAhPT0gdGhpcy5qb2JJbnN0YW5jZS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlN0YXJ0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMpO1xuICAgIH1cblxuICAgIGdldFByb2dyZXNzUGVyY2VudHMocHJvZ3Jlc3MpIHtcbiAgICAgICAgaWYgKCFwcm9ncmVzcykge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb2dyZXNzLmN1cnJlbnQgKiAxMDAgLyBwcm9ncmVzcy50b3RhbDtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYnNNYW5nZXIuZ2V0Sm9iQnlOYW1lKGpvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5qb2JOYW1lKTtcbiAgICAgICAgcmV0dXJuIGpvYi5nZXRQcm9ncmVzcyhqb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIGFmdGVySm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBpZiAoam9iRXhlY3V0aW9uLmpvYkluc3RhbmNlLmlkICE9PSB0aGlzLmpvYkluc3RhbmNlLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gam9iRXhlY3V0aW9uO1xuICAgICAgICBpZiAoSk9CX1NUQVRVUy5DT01QTEVURUQgPT09IGpvYkV4ZWN1dGlvbi5zdGF0dXMpIHtcbiAgICAgICAgICAgIHRoaXMuam9ic01hbmdlci5kZXJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIodGhpcyk7XG4gICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gdGhpcy5nZXRQcm9ncmVzc0Zyb21FeGVjdXRpb24oam9iRXhlY3V0aW9uKTtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uUHJvZ3Jlc3MuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMucHJvZ3Jlc3MpO1xuICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmdldFJlc3VsdChqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UpLnRoZW4ocmVzdWx0PT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlnLm9uSm9iQ29tcGxldGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzLCByZXN1bHQuZGF0YSk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG5cblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuRkFJTEVEID09PSBqb2JFeGVjdXRpb24uc3RhdHVzKSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYkZhaWxlZC5jYWxsKHRoaXMuY29uZmlnLmNhbGxiYWNrc1RoaXNBcmcgfHwgdGhpcywgam9iRXhlY3V0aW9uLmZhaWx1cmVFeGNlcHRpb25zKTtcblxuICAgICAgICB9IGVsc2UgaWYgKEpPQl9TVEFUVVMuU1RPUFBFRCA9PT0gam9iRXhlY3V0aW9uLnN0YXR1cykge1xuICAgICAgICAgICAgdGhpcy5jb25maWcub25Kb2JTdG9wcGVkLmNhbGwodGhpcy5jb25maWcuY2FsbGJhY2tzVGhpc0FyZyB8fCB0aGlzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldExhc3RKb2JFeGVjdXRpb24oZm9yY2VVcGRhdGUgPSBmYWxzZSkge1xuICAgICAgICBpZiAoIXRoaXMubGFzdEpvYkV4ZWN1dGlvbiB8fCBmb3JjZVVwZGF0ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5qb2JSZXBvc2l0b3J5LmdldExhc3RKb2JFeGVjdXRpb25CeUluc3RhbmNlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGplO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLmxhc3RKb2JFeGVjdXRpb24pO1xuICAgIH1cblxuICAgIHN0b3AoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5zdG9wKHRoaXMubGFzdEpvYkV4ZWN1dGlvbilcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldExhc3RKb2JFeGVjdXRpb24oKS50aGVuKCgpPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuam9ic01hbmdlci5ydW4odGhpcy5qb2JJbnN0YW5jZS5qb2JOYW1lLCB0aGlzLmxhc3RKb2JFeGVjdXRpb24uam9iUGFyYW1ldGVycy52YWx1ZXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbi5nZXREYXRhKCkpLnRoZW4oamU9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0Sm9iRXhlY3V0aW9uID0gamU7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGVja1Byb2dyZXNzKCk7XG4gICAgICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgdGVybWluYXRlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRMYXN0Sm9iRXhlY3V0aW9uKCkudGhlbigoKT0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYnNNYW5nZXIudGVybWluYXRlKHRoaXMuam9iSW5zdGFuY2UpLnRoZW4oKCk9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy50ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5vbkpvYlRlcm1pbmF0ZWQuY2FsbCh0aGlzLmNvbmZpZy5jYWxsYmFja3NUaGlzQXJnIHx8IHRoaXMsIHRoaXMubGFzdEpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgdGhpcy5qb2JzTWFuZ2VyLmRlcmVnaXN0ZXJKb2JFeGVjdXRpb25MaXN0ZW5lcih0aGlzKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmxhc3RKb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KS5jYXRjaChlPT4ge1xuICAgICAgICAgICAgbG9nLmVycm9yKGUpO1xuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiZXhwb3J0IGNsYXNzIEpvYldvcmtlcntcblxuICAgIHdvcmtlcjtcbiAgICBsaXN0ZW5lcnMgPSB7fTtcbiAgICBkZWZhdWx0TGlzdGVuZXI7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIGRlZmF1bHRMaXN0ZW5lciwgb25FcnJvcil7XG4gICAgICAgIHZhciBpbnN0YW5jZSA9IHRoaXM7XG4gICAgICAgIHRoaXMud29ya2VyID0gbmV3IFdvcmtlcih1cmwpO1xuICAgICAgICB0aGlzLmRlZmF1bHRMaXN0ZW5lciA9IGRlZmF1bHRMaXN0ZW5lciB8fCBmdW5jdGlvbigpIHt9O1xuICAgICAgICBpZiAob25FcnJvcikge3RoaXMud29ya2VyLm9uZXJyb3IgPSBvbkVycm9yO31cblxuICAgICAgICB0aGlzLndvcmtlci5vbm1lc3NhZ2UgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmRhdGEgaW5zdGFuY2VvZiBPYmplY3QgJiZcbiAgICAgICAgICAgICAgICBldmVudC5kYXRhLmhhc093blByb3BlcnR5KCdxdWVyeU1ldGhvZExpc3RlbmVyJykgJiYgZXZlbnQuZGF0YS5oYXNPd25Qcm9wZXJ0eSgncXVlcnlNZXRob2RBcmd1bWVudHMnKSkge1xuICAgICAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IGluc3RhbmNlLmxpc3RlbmVyc1tldmVudC5kYXRhLnF1ZXJ5TWV0aG9kTGlzdGVuZXJdO1xuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gZXZlbnQuZGF0YS5xdWVyeU1ldGhvZEFyZ3VtZW50cztcbiAgICAgICAgICAgICAgICBpZihsaXN0ZW5lci5kZXNlcmlhbGl6ZXIpe1xuICAgICAgICAgICAgICAgICAgICBhcmdzID0gbGlzdGVuZXIuZGVzZXJpYWxpemVyKGFyZ3MpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsaXN0ZW5lci5mbi5hcHBseShsaXN0ZW5lci50aGlzQXJnLCBhcmdzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kZWZhdWx0TGlzdGVuZXIuY2FsbChpbnN0YW5jZSwgZXZlbnQuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHNlbmRRdWVyeSgpIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdKb2JXb3JrZXIuc2VuZFF1ZXJ5IHRha2VzIGF0IGxlYXN0IG9uZSBhcmd1bWVudCcpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMud29ya2VyLnBvc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICdxdWVyeU1ldGhvZCc6IGFyZ3VtZW50c1swXSxcbiAgICAgICAgICAgICdxdWVyeUFyZ3VtZW50cyc6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcnVuSm9iKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGFEVE8pe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncnVuSm9iJywgam9iTmFtZSwgam9iUGFyYW1ldGVyc1ZhbHVlcywgZGF0YURUTylcbiAgICB9XG5cbiAgICBleGVjdXRlSm9iKGpvYkV4ZWN1dGlvbklkKXtcbiAgICAgICAgdGhpcy5zZW5kUXVlcnkoJ2V4ZWN1dGVKb2InLCBqb2JFeGVjdXRpb25JZClcbiAgICB9XG5cbiAgICByZWNvbXB1dGUoZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpe1xuICAgICAgICB0aGlzLnNlbmRRdWVyeSgncmVjb21wdXRlJywgZGF0YURUTywgcnVsZU5hbWVzLCBldmFsQ29kZSwgZXZhbE51bWVyaWMpXG4gICAgfVxuXG4gICAgcG9zdE1lc3NhZ2UobWVzc2FnZSkge1xuICAgICAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG5cbiAgICB0ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMud29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgIH1cblxuICAgIGFkZExpc3RlbmVyKG5hbWUsIGxpc3RlbmVyLCB0aGlzQXJnLCBkZXNlcmlhbGl6ZXIpIHtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnNbbmFtZV0gPSB7XG4gICAgICAgICAgICBmbjogbGlzdGVuZXIsXG4gICAgICAgICAgICB0aGlzQXJnOiB0aGlzQXJnIHx8IHRoaXMsXG4gICAgICAgICAgICBkZXNlcmlhbGl6ZXI6IGRlc2VyaWFsaXplclxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKG5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMubGlzdGVuZXJzW25hbWVdO1xuICAgIH1cbn1cbiIsImltcG9ydCB7VXRpbHMsIGxvZ30gZnJvbSBcInNkLXV0aWxzXCI7XG5pbXBvcnQge1NlbnNpdGl2aXR5QW5hbHlzaXNKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3NlbnNpdGl2aXR5LWFuYWx5c2lzL3NlbnNpdGl2aXR5LWFuYWx5c2lzLWpvYlwiO1xuaW1wb3J0IHtKb2JMYXVuY2hlcn0gZnJvbSBcIi4vZW5naW5lL2pvYi1sYXVuY2hlclwiO1xuaW1wb3J0IHtKb2JXb3JrZXJ9IGZyb20gXCIuL2pvYi13b3JrZXJcIjtcbmltcG9ydCB7Sm9iRXhlY3V0aW9uTGlzdGVuZXJ9IGZyb20gXCIuL2VuZ2luZS9qb2ItZXhlY3V0aW9uLWxpc3RlbmVyXCI7XG5pbXBvcnQge0pvYlBhcmFtZXRlcnN9IGZyb20gXCIuL2VuZ2luZS9qb2ItcGFyYW1ldGVyc1wiO1xuaW1wb3J0IHtJZGJKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvaWRiLWpvYi1yZXBvc2l0b3J5XCI7XG5pbXBvcnQge0pPQl9FWEVDVVRJT05fRkxBR30gZnJvbSBcIi4vZW5naW5lL2pvYi1leGVjdXRpb24tZmxhZ1wiO1xuaW1wb3J0IHtSZWNvbXB1dGVKb2J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb25zL3JlY29tcHV0ZS9yZWNvbXB1dGUtam9iXCI7XG5pbXBvcnQge1Byb2JhYmlsaXN0aWNTZW5zaXRpdml0eUFuYWx5c2lzSm9ifSBmcm9tIFwiLi9jb25maWd1cmF0aW9ucy9wcm9iYWJpbGlzdGljLXNlbnNpdGl2aXR5LWFuYWx5c2lzL3Byb2JhYmlsaXN0aWMtc2Vuc2l0aXZpdHktYW5hbHlzaXMtam9iXCI7XG5pbXBvcnQge1RpbWVvdXRKb2JSZXBvc2l0b3J5fSBmcm9tIFwiLi9lbmdpbmUvam9iLXJlcG9zaXRvcnkvdGltZW91dC1qb2ItcmVwb3NpdG9yeVwiO1xuaW1wb3J0IHtUb3JuYWRvRGlhZ3JhbUpvYn0gZnJvbSBcIi4vY29uZmlndXJhdGlvbnMvdG9ybmFkby1kaWFncmFtL3Rvcm5hZG8tZGlhZ3JhbS1qb2JcIjtcbmltcG9ydCB7Sk9CX1NUQVRVU30gZnJvbSBcIi4vZW5naW5lL2pvYi1zdGF0dXNcIjtcblxuXG5leHBvcnQgY2xhc3MgSm9ic01hbmFnZXIgZXh0ZW5kcyBKb2JFeGVjdXRpb25MaXN0ZW5lciB7XG5cblxuICAgIHVzZVdvcmtlcjtcbiAgICBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG4gICAgam9iV29ya2VyO1xuXG4gICAgam9iUmVwb3NpdG9yeTtcbiAgICBqb2JMYXVuY2hlcjtcblxuICAgIGpvYkV4ZWN1dGlvbkxpc3RlbmVycyA9IFtdO1xuXG4gICAgYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXMgPSB7fTtcbiAgICBqb2JJbnN0YW5jZXNUb1Rlcm1pbmF0ZSA9IHt9O1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbnNFdmFsdWF0b3IsIG9iamVjdGl2ZVJ1bGVzTWFuYWdlciwgd29ya2VyVXJsKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25zRXZhbHVhdG9yLmV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IgPSBleHByZXNzaW9uc0V2YWx1YXRvcjtcbiAgICAgICAgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIgPSBvYmplY3RpdmVSdWxlc01hbmFnZXI7XG5cbiAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5ID0gbmV3IElkYkpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICAvLyB0aGlzLmpvYlJlcG9zaXRvcnkgPSBuZXcgVGltZW91dEpvYlJlcG9zaXRvcnkodGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXZpdmVyKCkpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9icygpO1xuXG4gICAgICAgIHRoaXMudXNlV29ya2VyID0gISF3b3JrZXJVcmw7XG4gICAgICAgIGlmICh0aGlzLnVzZVdvcmtlcikge1xuICAgICAgICAgICAgdGhpcy5pbml0V29ya2VyKHdvcmtlclVybCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmpvYkxhdW5jaGVyID0gbmV3IEpvYkxhdW5jaGVyKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5qb2JXb3JrZXIsIChkYXRhKT0+dGhpcy5zZXJpYWxpemVEYXRhKGRhdGEpKTtcbiAgICB9XG5cbiAgICBzZXJpYWxpemVEYXRhKGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGRhdGEuc2VyaWFsaXplKHRydWUsIGZhbHNlLCBmYWxzZSwgdGhpcy5leHByZXNzaW9uRW5naW5lLmdldEpzb25SZXBsYWNlcigpKTtcbiAgICB9XG5cbiAgICBnZXRQcm9ncmVzcyhqb2JFeGVjdXRpb25PcklkKSB7XG4gICAgICAgIHZhciBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQ7XG4gICAgICAgIGlmICghVXRpbHMuaXNTdHJpbmcoam9iRXhlY3V0aW9uT3JJZCkpIHtcbiAgICAgICAgICAgIGlkID0gam9iRXhlY3V0aW9uT3JJZC5pZFxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uUHJvZ3Jlc3MoaWQpO1xuICAgIH1cblxuICAgIGdldFJlc3VsdChqb2JJbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LmdldEpvYlJlc3VsdEJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpO1xuICAgIH1cblxuICAgIHJ1bihqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzLCBkYXRhLCByZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCA9IHRydWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iTGF1bmNoZXIucnVuKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnNWYWx1ZXMsIGRhdGEsIHJlc29sdmVQcm9taXNlQWZ0ZXJKb2JJc0xhdW5jaGVkKS50aGVuKGpvYkV4ZWN1dGlvbj0+IHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlUHJvbWlzZUFmdGVySm9iSXNMYXVuY2hlZCB8fCAham9iRXhlY3V0aW9uLmlzUnVubmluZygpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGpvYkV4ZWN1dGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vam9iIHdhcyBkZWxlZ2F0ZWQgdG8gd29ya2VyIGFuZCBpcyBzdGlsbCBydW5uaW5nXG5cbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KT0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmFmdGVySm9iRXhlY3V0aW9uUHJvbWlzZVJlc29sdmVzW2pvYkV4ZWN1dGlvbi5pZF0gPSByZXNvbHZlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGV4ZWN1dGUoam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5qb2JMYXVuY2hlci5leGVjdXRlKGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgIH1cblxuICAgIHN0b3Aoam9iRXhlY3V0aW9uT3JJZCkge1xuICAgICAgICB2YXIgaWQgPSBqb2JFeGVjdXRpb25PcklkO1xuICAgICAgICBpZiAoIVV0aWxzLmlzU3RyaW5nKGpvYkV4ZWN1dGlvbk9ySWQpKSB7XG4gICAgICAgICAgICBpZCA9IGpvYkV4ZWN1dGlvbk9ySWQuaWRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iRXhlY3V0aW9uQnlJZChpZCkudGhlbihqb2JFeGVjdXRpb249PiB7XG4gICAgICAgICAgICBpZiAoIWpvYkV4ZWN1dGlvbikge1xuICAgICAgICAgICAgICAgIGxvZy5lcnJvcihcIkpvYiBFeGVjdXRpb24gbm90IGZvdW5kOiBcIiArIGpvYkV4ZWN1dGlvbk9ySWQpO1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICBsb2cud2FybihcIkpvYiBFeGVjdXRpb24gbm90IHJ1bm5pbmcsIHN0YXR1czogXCIgKyBqb2JFeGVjdXRpb24uc3RhdHVzICsgXCIsIGVuZFRpbWU6IFwiICsgam9iRXhlY3V0aW9uLmVuZFRpbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybiBqb2JFeGVjdXRpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuc2F2ZUpvYkV4ZWN1dGlvbkZsYWcoam9iRXhlY3V0aW9uLmlkLCBKT0JfRVhFQ1VUSU9OX0ZMQUcuU1RPUCkudGhlbigoKT0+am9iRXhlY3V0aW9uKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLypzdG9wIGpvYiBleGVjdXRpb24gaWYgcnVubmluZyBhbmQgZGVsZXRlIGpvYiBpbnN0YW5jZSBmcm9tIHJlcG9zaXRvcnkqL1xuICAgIHRlcm1pbmF0ZShqb2JJbnN0YW5jZSkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0TGFzdEpvYkV4ZWN1dGlvbkJ5SW5zdGFuY2Uoam9iSW5zdGFuY2UpLnRoZW4oam9iRXhlY3V0aW9uPT4ge1xuICAgICAgICAgICAgaWYgKGpvYkV4ZWN1dGlvbiAmJiBqb2JFeGVjdXRpb24uaXNSdW5uaW5nKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb25GbGFnKGpvYkV4ZWN1dGlvbi5pZCwgSk9CX0VYRUNVVElPTl9GTEFHLlNUT1ApLnRoZW4oKCk9PmpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLnRoZW4oKCk9PntcbiAgICAgICAgICAgIHRoaXMuam9iSW5zdGFuY2VzVG9UZXJtaW5hdGVbam9iSW5zdGFuY2UuaWRdPWpvYkluc3RhbmNlO1xuICAgICAgICB9KVxuICAgIH1cblxuICAgIGdldEpvYkJ5TmFtZShqb2JOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgIH1cblxuXG4gICAgY3JlYXRlSm9iUGFyYW1ldGVycyhqb2JOYW1lLCBqb2JQYXJhbWV0ZXJzVmFsdWVzKSB7XG4gICAgICAgIHZhciBqb2IgPSB0aGlzLmpvYlJlcG9zaXRvcnkuZ2V0Sm9iQnlOYW1lKGpvYk5hbWUpO1xuICAgICAgICByZXR1cm4gam9iLmNyZWF0ZUpvYlBhcmFtZXRlcnMoam9iUGFyYW1ldGVyc1ZhbHVlcyk7XG4gICAgfVxuXG5cbiAgICAvKlJldHVybnMgYSBwcm9taXNlKi9cbiAgICBnZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpIHtcbiAgICAgICAgaWYgKHRoaXMudXNlV29ya2VyKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JXb3JrZXI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEoam9iUGFyYW1ldGVycyBpbnN0YW5jZW9mIEpvYlBhcmFtZXRlcnMpKSB7XG4gICAgICAgICAgICBqb2JQYXJhbWV0ZXJzID0gdGhpcy5jcmVhdGVKb2JQYXJhbWV0ZXJzKGpvYlBhcmFtZXRlcnMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRMYXN0Sm9iRXhlY3V0aW9uKGpvYk5hbWUsIGpvYlBhcmFtZXRlcnMpO1xuICAgIH1cblxuICAgIGluaXRXb3JrZXIod29ya2VyVXJsKSB7XG4gICAgICAgIHRoaXMuam9iV29ya2VyID0gbmV3IEpvYldvcmtlcih3b3JrZXJVcmwsICgpPT57XG4gICAgICAgICAgICBsb2cuZXJyb3IoJ2Vycm9yIGluIHdvcmtlcicsIGFyZ3VtZW50cyk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgYXJnc0Rlc2VyaWFsaXplciA9IChhcmdzKT0+IHtcbiAgICAgICAgICAgIHJldHVybiBbdGhpcy5qb2JSZXBvc2l0b3J5LnJldml2ZUpvYkV4ZWN1dGlvbihhcmdzWzBdKV1cbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLmpvYldvcmtlci5hZGRMaXN0ZW5lcihcImJlZm9yZUpvYlwiLCB0aGlzLmJlZm9yZUpvYiwgdGhpcywgYXJnc0Rlc2VyaWFsaXplcik7XG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiYWZ0ZXJKb2JcIiwgdGhpcy5hZnRlckpvYiwgdGhpcywgYXJnc0Rlc2VyaWFsaXplcik7XG4gICAgICAgIHRoaXMuam9iV29ya2VyLmFkZExpc3RlbmVyKFwiam9iRmF0YWxFcnJvclwiLCB0aGlzLm9uSm9iRmF0YWxFcnJvciwgdGhpcyk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2JzKCkge1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBTZW5zaXRpdml0eUFuYWx5c2lzSm9iKHRoaXMuam9iUmVwb3NpdG9yeSwgdGhpcy5leHByZXNzaW9uc0V2YWx1YXRvciwgdGhpcy5vYmplY3RpdmVSdWxlc01hbmFnZXIpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckpvYihuZXcgVG9ybmFkb0RpYWdyYW1Kb2IodGhpcy5qb2JSZXBvc2l0b3J5LCB0aGlzLmV4cHJlc3Npb25zRXZhbHVhdG9yLCB0aGlzLm9iamVjdGl2ZVJ1bGVzTWFuYWdlcikpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySm9iKG5ldyBQcm9iYWJpbGlzdGljU2Vuc2l0aXZpdHlBbmFseXNpc0pvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJKb2IobmV3IFJlY29tcHV0ZUpvYih0aGlzLmpvYlJlcG9zaXRvcnksIHRoaXMuZXhwcmVzc2lvbnNFdmFsdWF0b3IsIHRoaXMub2JqZWN0aXZlUnVsZXNNYW5hZ2VyKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJKb2Ioam9iKSB7XG4gICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5yZWdpc3RlckpvYihqb2IpO1xuICAgICAgICBqb2IucmVnaXN0ZXJFeGVjdXRpb25MaXN0ZW5lcih0aGlzKVxuICAgIH1cblxuICAgIHJlZ2lzdGVySm9iRXhlY3V0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgZGVyZWdpc3RlckpvYkV4ZWN1dGlvbkxpc3RlbmVyKGxpc3RlbmVyKSB7XG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5qb2JFeGVjdXRpb25MaXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYmVmb3JlSm9iKGpvYkV4ZWN1dGlvbikge1xuICAgICAgICBsb2cuZGVidWcoXCJiZWZvcmVKb2JcIiwgdGhpcy51c2VXb3JrZXIsIGpvYkV4ZWN1dGlvbik7XG4gICAgICAgIHRoaXMuam9iRXhlY3V0aW9uTGlzdGVuZXJzLmZvckVhY2gobD0+bC5iZWZvcmVKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgfVxuXG4gICAgYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhcImFmdGVySm9iXCIsIHRoaXMudXNlV29ya2VyLCBqb2JFeGVjdXRpb24pO1xuICAgICAgICB0aGlzLmpvYkV4ZWN1dGlvbkxpc3RlbmVycy5mb3JFYWNoKGw9PmwuYWZ0ZXJKb2Ioam9iRXhlY3V0aW9uKSk7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uLmlkXTtcbiAgICAgICAgaWYgKHByb21pc2VSZXNvbHZlKSB7XG4gICAgICAgICAgICBwcm9taXNlUmVzb2x2ZShqb2JFeGVjdXRpb24pXG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmpvYkluc3RhbmNlc1RvVGVybWluYXRlW2pvYkV4ZWN1dGlvbi5qb2JJbnN0YW5jZS5pZF0pe1xuICAgICAgICAgICAgdGhpcy5qb2JSZXBvc2l0b3J5LnJlbW92ZShqb2JFeGVjdXRpb24uam9iSW5zdGFuY2UpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgb25Kb2JGYXRhbEVycm9yKGpvYkV4ZWN1dGlvbklkLCBlcnJvcil7XG4gICAgICAgIHZhciBwcm9taXNlUmVzb2x2ZSA9IHRoaXMuYWZ0ZXJKb2JFeGVjdXRpb25Qcm9taXNlUmVzb2x2ZXNbam9iRXhlY3V0aW9uSWRdO1xuICAgICAgICBpZiAocHJvbWlzZVJlc29sdmUpIHtcbiAgICAgICAgICAgIHRoaXMuam9iUmVwb3NpdG9yeS5nZXRKb2JFeGVjdXRpb25CeUlkKGpvYkV4ZWN1dGlvbklkKS50aGVuKGpvYkV4ZWN1dGlvbj0+e1xuICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5zdGF0dXMgPSBKT0JfU1RBVFVTLkZBSUxFRDtcbiAgICAgICAgICAgICAgICBpZihlcnJvcil7XG4gICAgICAgICAgICAgICAgICAgIGpvYkV4ZWN1dGlvbi5mYWlsdXJlRXhjZXB0aW9ucy5wdXNoKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5qb2JSZXBvc2l0b3J5LnNhdmVKb2JFeGVjdXRpb24oam9iRXhlY3V0aW9uKS50aGVuKCgpPT57XG4gICAgICAgICAgICAgICAgICAgIHByb21pc2VSZXNvbHZlKGpvYkV4ZWN1dGlvbik7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pLmNhdGNoKGU9PntcbiAgICAgICAgICAgICAgICBsb2cuZXJyb3IoZSk7XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgIH1cbiAgICAgICAgbG9nLmRlYnVnKCdvbkpvYkZhdGFsRXJyb3InLCBqb2JFeGVjdXRpb25JZCwgZXJyb3IpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7RXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUsIEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlLCBNYXhpTWluUnVsZSwgTWF4aU1heFJ1bGUsIE1pbmlNaW5SdWxlLCBNaW5pTWF4UnVsZX0gZnJvbSBcIi4vcnVsZXNcIjtcbmltcG9ydCB7bG9nfSBmcm9tIFwic2QtdXRpbHNcIlxuaW1wb3J0ICogYXMgbW9kZWwgZnJvbSBcInNkLW1vZGVsXCI7XG5cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxlc01hbmFnZXJ7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuICAgIGN1cnJlbnRSdWxlO1xuICAgIHJ1bGVCeU5hbWU9e307XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhLCBleHByZXNzaW9uRW5naW5lLCBjdXJyZW50UnVsZU5hbWUpe1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmU9ZXhwcmVzc2lvbkVuZ2luZTtcbiAgICAgICAgdmFyIG1heCA9IG5ldyBFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdmFyIG1heGlNaW4gPSBuZXcgTWF4aU1pblJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHZhciBtYXhpTWF4ID0gbmV3IE1heGlNYXhSdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB2YXIgbWluID0gbmV3IEV4cGVjdGVkVmFsdWVNaW5pbWl6YXRpb25SdWxlKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgICAgICB2YXIgbWluaU1pbiA9IG5ldyBNaW5pTWluUnVsZShleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdmFyIG1pbmlNYXggPSBuZXcgTWluaU1heFJ1bGUoZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgICAgIHRoaXMucnVsZUJ5TmFtZVttYXgubmFtZV09bWF4O1xuICAgICAgICB0aGlzLnJ1bGVCeU5hbWVbbWF4aU1pbi5uYW1lXT1tYXhpTWluO1xuICAgICAgICB0aGlzLnJ1bGVCeU5hbWVbbWF4aU1heC5uYW1lXT1tYXhpTWF4O1xuICAgICAgICB0aGlzLnJ1bGVCeU5hbWVbbWluLm5hbWVdPW1pbjtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW21pbmlNaW4ubmFtZV09bWluaU1pbjtcbiAgICAgICAgdGhpcy5ydWxlQnlOYW1lW21pbmlNYXgubmFtZV09bWluaU1heDtcbiAgICAgICAgdGhpcy5ydWxlcyA9IFttYXgsIG1pbiwgbWF4aU1pbiwgbWF4aU1heCwgbWluaU1pbiwgbWluaU1heF07XG4gICAgICAgIGlmKGN1cnJlbnRSdWxlTmFtZSl7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRSdWxlID0gdGhpcy5ydWxlQnlOYW1lW2N1cnJlbnRSdWxlTmFtZV07XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZXNbMF07XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIGlzUnVsZU5hbWUocnVsZU5hbWUpe1xuICAgICAgICAgcmV0dXJuICEhdGhpcy5ydWxlQnlOYW1lW3J1bGVOYW1lXVxuICAgIH1cblxuICAgIHNldEN1cnJlbnRSdWxlQnlOYW1lKHJ1bGVOYW1lKXtcbiAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHRoaXMucnVsZUJ5TmFtZVtydWxlTmFtZV07XG4gICAgfVxuXG4gICAgcmVjb21wdXRlKGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICAgIGxvZy50cmFjZSgncmVjb21wdXRpbmcgcnVsZXMsIGFsbDogJythbGxSdWxlcyk7XG5cbiAgICAgICAgdGhpcy5kYXRhLmdldFJvb3RzKCkuZm9yRWFjaChuPT57XG4gICAgICAgICAgICB0aGlzLnJlY29tcHV0ZVRyZWUobiwgYWxsUnVsZXMsIGRlY2lzaW9uUG9saWN5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHRpbWUgID0gKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gc3RhcnRUaW1lLzEwMDApO1xuICAgICAgICBsb2cudHJhY2UoJ3JlY29tcHV0YXRpb24gdG9vayAnK3RpbWUrJ3MnKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZWNvbXB1dGVUcmVlKHJvb3QsIGFsbFJ1bGVzLCBkZWNpc2lvblBvbGljeT1udWxsKXtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGluZyBydWxlcyBmb3IgdHJlZSAuLi4nLCByb290KTtcblxuICAgICAgICB2YXIgc3RhcnRUaW1lID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAgICAgdmFyIHJ1bGVzICA9IFt0aGlzLmN1cnJlbnRSdWxlXTtcbiAgICAgICAgaWYoYWxsUnVsZXMpe1xuICAgICAgICAgICAgcnVsZXMgPSB0aGlzLnJ1bGVzO1xuICAgICAgICB9XG5cbiAgICAgICAgcnVsZXMuZm9yRWFjaChydWxlPT4ge1xuICAgICAgICAgICAgcnVsZS5zZXREZWNpc2lvblBvbGljeShkZWNpc2lvblBvbGljeSk7XG4gICAgICAgICAgICBydWxlLmNvbXB1dGVQYXlvZmYocm9vdCk7XG4gICAgICAgICAgICBydWxlLmNvbXB1dGVPcHRpbWFsKHJvb3QpO1xuICAgICAgICAgICAgcnVsZS5jbGVhckRlY2lzaW9uUG9saWN5KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciB0aW1lICA9IChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIHN0YXJ0VGltZSkvMTAwMDtcbiAgICAgICAgbG9nLnRyYWNlKCdyZWNvbXB1dGF0aW9uIHRvb2sgJyt0aW1lKydzJyk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG5cbiAgICBnZXROb2RlRGlzcGxheVZhbHVlKG5vZGUsIG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIG5vZGUuY29tcHV0ZWRWYWx1ZSh0aGlzLmN1cnJlbnRSdWxlLm5hbWUsIG5hbWUpXG5cbiAgICB9XG5cbiAgICBnZXRFZGdlRGlzcGxheVZhbHVlKGUsIG5hbWUpe1xuICAgICAgICBpZihuYW1lPT09J3Byb2JhYmlsaXR5Jyl7XG4gICAgICAgICAgICBpZihlLnBhcmVudE5vZGUgaW5zdGFuY2VvZiBtb2RlbC5kb21haW4uRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZFZhbHVlKHRoaXMuY3VycmVudFJ1bGUubmFtZSwgJ3Byb2JhYmlsaXR5Jyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZihlLnBhcmVudE5vZGUgaW5zdGFuY2VvZiBtb2RlbC5kb21haW4uQ2hhbmNlTm9kZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGUuY29tcHV0ZWRCYXNlUHJvYmFiaWxpdHkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIGlmKG5hbWU9PT0ncGF5b2ZmJyl7XG4gICAgICAgICAgICByZXR1cm4gZS5jb21wdXRlZEJhc2VQYXlvZmYoKTtcbiAgICAgICAgfVxuICAgICAgICBpZihuYW1lPT09J29wdGltYWwnKXtcbiAgICAgICAgICAgIHJldHVybiBlLmNvbXB1dGVkVmFsdWUodGhpcy5jdXJyZW50UnVsZS5uYW1lLCAnb3B0aW1hbCcpXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcblxuLypleHBlY3RlZCB2YWx1ZSBtYXhpbWl6YXRpb24gcnVsZSovXG5leHBvcnQgY2xhc3MgRXhwZWN0ZWRWYWx1ZU1heGltaXphdGlvblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnZXhwZWN0ZWQtdmFsdWUtbWF4aW1pemF0aW9uJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihFeHBlY3RlZFZhbHVlTWF4aW1pemF0aW9uUnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmPTAsIHByb2JhYmlsaXR5VG9FbnRlcj0xKXtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSl7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIGlmICggdGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCdwYXlvZmYnKSxwYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpICkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge09iamVjdGl2ZVJ1bGV9IGZyb20gJy4vb2JqZWN0aXZlLXJ1bGUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypleHBlY3RlZCB2YWx1ZSBtaW5pbWl6YXRpb24gcnVsZSovXG5leHBvcnQgY2xhc3MgRXhwZWN0ZWRWYWx1ZU1pbmltaXphdGlvblJ1bGUgZXh0ZW5kcyBPYmplY3RpdmVSdWxle1xuXG4gICAgc3RhdGljIE5BTUUgPSAnZXhwZWN0ZWQtdmFsdWUtbWluaW1pemF0aW9uJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihFeHBlY3RlZFZhbHVlTWluaW1pemF0aW9uUnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZj0wLCBwcm9iYWJpbGl0eVRvRW50ZXI9MSl7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpe1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICBpZiAoIHRoaXMuc3VidHJhY3QodGhpcy5jVmFsdWUobm9kZSwncGF5b2ZmJykscGF5b2ZmKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cblxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmV4cG9ydCAqIGZyb20gJy4vZXhwZWN0ZWQtdmFsdWUtbWF4aW1pemF0aW9uLXJ1bGUnXG5leHBvcnQgKiBmcm9tICcuL2V4cGVjdGVkLXZhbHVlLW1pbmltaXphdGlvbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9tYXhpLW1heC1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9tYXhpLW1pbi1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9taW5pLW1heC1ydWxlJ1xuZXhwb3J0ICogZnJvbSAnLi9taW5pLW1pbi1ydWxlJ1xuXG5cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWF4UnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cblxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG4gICAgICAgIGVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JywgdGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKTxiZXN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL2Jlc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWF4Qnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNWYWx1ZShvcHRpbWFsRWRnZS5jaGlsZE5vZGUsICdwYXlvZmYnKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJyksIHBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1heGktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1heGlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21heGktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNYXhpTWluUnVsZS5OQU1FLCB0cnVlLCBleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICBtb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShlZGdlcywgYmVzdENoaWxkUGF5b2ZmLCBiZXN0Q291bnQsIHdvcnN0Q2hpbGRQYXlvZmYsIHdvcnN0Q291bnQpe1xuICAgICAgICBlZGdlcy5mb3JFYWNoKGU9PntcbiAgICAgICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhlKTtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScsIHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJyk+d29yc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvd29yc3RDb3VudCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAgcGF5b2ZmIC0gcGFyZW50IGVkZ2UgcGF5b2ZmXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSwgcGF5b2ZmID0gMCwgcHJvYmFiaWxpdHlUb0VudGVyID0gMSkge1xuICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLlRlcm1pbmFsTm9kZSkge1xuICAgICAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ3Byb2JhYmlsaXR5VG9FbnRlcicsIHByb2JhYmlsaXR5VG9FbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3B0aW1hbEVkZ2UgPSBudWxsO1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgIG9wdGltYWxFZGdlID0gVXRpbHMubWluQnkobm9kZS5jaGlsZEVkZ2VzLCBlPT50aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICB2YXIgaXNPcHRpbWFsID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAob3B0aW1hbEVkZ2UpIHtcbiAgICAgICAgICAgICAgICBpc09wdGltYWwgPSB0aGlzLmNWYWx1ZShvcHRpbWFsRWRnZS5jaGlsZE5vZGUsICdwYXlvZmYnKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgICAgICB9IGVsc2UgaXNPcHRpbWFsID0gISEodGhpcy5zdWJ0cmFjdCh0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJyksIHBheW9mZikuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpIHx8ICEobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkRlY2lzaW9uTm9kZSkpO1xuXG4gICAgICAgICAgICBpZiAoaXNPcHRpbWFsKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbXB1dGVPcHRpbWFsKGUuY2hpbGROb2RlLCB0aGlzLmJhc2VQYXlvZmYoZSksIHRoaXMubXVsdGlwbHkocHJvYmFiaWxpdHlUb0VudGVyLCB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknKSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWF4IHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNYXhSdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWF4JztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWF4UnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpPGJlc3RDaGlsZFBheW9mZiA/IDAuMCA6ICgxLjAvYmVzdENvdW50KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vICBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmZcbiAgICBjb21wdXRlT3B0aW1hbChub2RlLCBwYXlvZmYgPSAwLCBwcm9iYWJpbGl0eVRvRW50ZXIgPSAxKSB7XG4gICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKSB7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgcHJvYmFiaWxpdHlUb0VudGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcHRpbWFsRWRnZSA9IG51bGw7XG4gICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkge1xuICAgICAgICAgICAgb3B0aW1hbEVkZ2UgPSBVdGlscy5tYXhCeShub2RlLmNoaWxkRWRnZXMsIGU9PnRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgIHZhciBpc09wdGltYWwgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChvcHRpbWFsRWRnZSkge1xuICAgICAgICAgICAgICAgIGlzT3B0aW1hbCA9IHRoaXMuY1ZhbHVlKG9wdGltYWxFZGdlLmNoaWxkTm9kZSwgJ3BheW9mZicpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpc09wdGltYWwgPSAhISh0aGlzLnN1YnRyYWN0KHRoaXMuY1ZhbHVlKG5vZGUsICdwYXlvZmYnKSwgcGF5b2ZmKS5lcXVhbHModGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSkgfHwgIShub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKSk7XG5cbiAgICAgICAgICAgIGlmIChpc09wdGltYWwpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAnb3B0aW1hbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY29tcHV0ZU9wdGltYWwoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5tdWx0aXBseShwcm9iYWJpbGl0eVRvRW50ZXIsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbn1cbiIsImltcG9ydCB7ZG9tYWluIGFzIG1vZGVsfSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7T2JqZWN0aXZlUnVsZX0gZnJvbSAnLi9vYmplY3RpdmUtcnVsZSdcbmltcG9ydCB7VXRpbHN9IGZyb20gXCJzZC11dGlsc1wiO1xuXG4vKm1pbmktbWluIHJ1bGUqL1xuZXhwb3J0IGNsYXNzIE1pbmlNaW5SdWxlIGV4dGVuZHMgT2JqZWN0aXZlUnVsZXtcblxuICAgIHN0YXRpYyBOQU1FID0gJ21pbmktbWluJztcblxuICAgIGNvbnN0cnVjdG9yKGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICBzdXBlcihNaW5pTWluUnVsZS5OQU1FLCBmYWxzZSwgZXhwcmVzc2lvbkVuZ2luZSk7XG4gICAgfVxuXG4gICAgbW9kaWZ5Q2hhbmNlUHJvYmFiaWxpdHkoZWRnZXMsIGJlc3RDaGlsZFBheW9mZiwgYmVzdENvdW50LCB3b3JzdENoaWxkUGF5b2ZmLCB3b3JzdENvdW50KXtcbiAgICAgICAgZWRnZXMuZm9yRWFjaChlPT57XG4gICAgICAgICAgICB0aGlzLmNsZWFyQ29tcHV0ZWRWYWx1ZXMoZSk7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpPndvcnN0Q2hpbGRQYXlvZmYgPyAwLjAgOiAoMS4wL3dvcnN0Q291bnQpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gIHBheW9mZiAtIHBhcmVudCBlZGdlIHBheW9mZlxuICAgIGNvbXB1dGVPcHRpbWFsKG5vZGUsIHBheW9mZiA9IDAsIHByb2JhYmlsaXR5VG9FbnRlciA9IDEpIHtcbiAgICAgICAgdGhpcy5jVmFsdWUobm9kZSwgJ29wdGltYWwnLCB0cnVlKTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdwcm9iYWJpbGl0eVRvRW50ZXInLCBwcm9iYWJpbGl0eVRvRW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9wdGltYWxFZGdlID0gbnVsbDtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBvcHRpbWFsRWRnZSA9IFV0aWxzLm1pbkJ5KG5vZGUuY2hpbGRFZGdlcywgZT0+dGhpcy5jVmFsdWUoZS5jaGlsZE5vZGUsICdwYXlvZmYnKSk7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgdmFyIGlzT3B0aW1hbCA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKG9wdGltYWxFZGdlKSB7XG4gICAgICAgICAgICAgICAgaXNPcHRpbWFsID0gdGhpcy5jVmFsdWUob3B0aW1hbEVkZ2UuY2hpbGROb2RlLCAncGF5b2ZmJykuZXF1YWxzKHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpO1xuICAgICAgICAgICAgfSBlbHNlIGlzT3B0aW1hbCA9ICEhKHRoaXMuc3VidHJhY3QodGhpcy5jVmFsdWUobm9kZSwgJ3BheW9mZicpLCBwYXlvZmYpLmVxdWFscyh0aGlzLmNWYWx1ZShlLmNoaWxkTm9kZSwgJ3BheW9mZicpKSB8fCAhKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpKTtcblxuICAgICAgICAgICAgaWYgKGlzT3B0aW1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY1ZhbHVlKGUsICdvcHRpbWFsJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5jb21wdXRlT3B0aW1hbChlLmNoaWxkTm9kZSwgdGhpcy5iYXNlUGF5b2ZmKGUpLCB0aGlzLm11bHRpcGx5KHByb2JhYmlsaXR5VG9FbnRlciwgdGhpcy5jVmFsdWUoZSwgJ3Byb2JhYmlsaXR5JykpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jVmFsdWUoZSwgJ29wdGltYWwnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtEZWNpc2lvbn0gZnJvbSBcIi4uLy4uL3BvbGljaWVzL2RlY2lzaW9uXCI7XG5pbXBvcnQge1BvbGljeX0gZnJvbSBcIi4uLy4uL3BvbGljaWVzL3BvbGljeVwiO1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQmFzZSBjbGFzcyBmb3Igb2JqZWN0aXZlIHJ1bGVzKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RpdmVSdWxle1xuICAgIG5hbWU7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcblxuICAgIGRlY2lzaW9uUG9saWN5O1xuICAgIG1heGltaXphdGlvbjtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUsIG1heGltaXphdGlvbiwgZXhwcmVzc2lvbkVuZ2luZSl7XG4gICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgICAgIHRoaXMubWF4aW1pemF0aW9uID0gbWF4aW1pemF0aW9uO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgIH1cblxuICAgIHNldERlY2lzaW9uUG9saWN5KGRlY2lzaW9uUG9saWN5KXtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeSA9IGRlY2lzaW9uUG9saWN5O1xuICAgIH1cblxuICAgIGNsZWFyRGVjaXNpb25Qb2xpY3koKXtcbiAgICAgICAgdGhpcy5kZWNpc2lvblBvbGljeT1udWxsO1xuICAgIH1cblxuICAgIC8vIHNob3VsZCByZXR1cm4gYXJyYXkgb2Ygc2VsZWN0ZWQgY2hpbGRyZW4gaW5kZXhlc1xuICAgIG1ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIGlmKHRoaXMubWF4aW1pemF0aW9uKXtcbiAgICAgICAgICAgIHJldHVybiBVdGlscy5pbmRleGVzT2YoY2hpbGRyZW5QYXlvZmZzLCB0aGlzLm1heCguLi5jaGlsZHJlblBheW9mZnMpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gVXRpbHMuaW5kZXhlc09mKGNoaWxkcmVuUGF5b2ZmcywgdGhpcy5taW4oLi4uY2hpbGRyZW5QYXlvZmZzKSk7XG4gICAgfVxuXG4gICAgX21ha2VEZWNpc2lvbihkZWNpc2lvbk5vZGUsIGNoaWxkcmVuUGF5b2Zmcyl7XG4gICAgICAgIGlmKHRoaXMuZGVjaXNpb25Qb2xpY3kpe1xuICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gUG9saWN5LmdldERlY2lzaW9uKHRoaXMuZGVjaXNpb25Qb2xpY3ksIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFtkZWNpc2lvbi5kZWNpc2lvblZhbHVlXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5tYWtlRGVjaXNpb24oZGVjaXNpb25Ob2RlLCBjaGlsZHJlblBheW9mZnMpO1xuICAgIH1cblxuICAgIC8vIGV4dGVuc2lvbiBwb2ludCBmb3IgY2hhbmdpbmcgY29tcHV0ZWQgcHJvYmFiaWxpdHkgb2YgZWRnZXMgaW4gYSBjaGFuY2Ugbm9kZVxuICAgIG1vZGlmeUNoYW5jZVByb2JhYmlsaXR5KGVkZ2VzLCBiZXN0Q2hpbGRQYXlvZmYsIGJlc3RDb3VudCwgd29yc3RDaGlsZFBheW9mZiwgd29yc3RDb3VudCl7XG5cbiAgICB9XG5cbiAgICAvLyBwYXlvZmYgLSBwYXJlbnQgZWRnZSBwYXlvZmYsIGFnZ3JlZ2F0ZWRQYXlvZmYgLSBhZ2dyZWdhdGVkIHBheW9mZiBhbG9uZyBwYXRoXG4gICAgY29tcHV0ZVBheW9mZihub2RlLCBwYXlvZmY9MCwgYWdncmVnYXRlZFBheW9mZj0wKXtcbiAgICAgICAgdmFyIGNoaWxkcmVuUGF5b2ZmID0gMDtcbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5EZWNpc2lvbk5vZGUpIHtcblxuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZEluZGV4ZXMgPSB0aGlzLl9tYWtlRGVjaXNpb24obm9kZSwgbm9kZS5jaGlsZEVkZ2VzLm1hcChlPT50aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSkpKTtcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PntcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCBzZWxlY3RlZEluZGV4ZXMuaW5kZXhPZihpKSA8IDAgPyAwLjAgOiAxLjApO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB2YXIgYmVzdENoaWxkID0gLUluZmluaXR5O1xuICAgICAgICAgICAgICAgIHZhciBiZXN0Q291bnQgPSAxO1xuICAgICAgICAgICAgICAgIHZhciB3b3JzdENoaWxkID0gSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgdmFyIHdvcnN0Q291bnQgPSAxO1xuXG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2hpbGRQYXlvZmYgPSB0aGlzLmNvbXB1dGVQYXlvZmYoZS5jaGlsZE5vZGUsIHRoaXMuYmFzZVBheW9mZihlKSwgdGhpcy5hZGQodGhpcy5iYXNlUGF5b2ZmKGUpLCBhZ2dyZWdhdGVkUGF5b2ZmKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmKGNoaWxkUGF5b2ZmIDwgd29yc3RDaGlsZCl7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENoaWxkID0gY2hpbGRQYXlvZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50PTE7XG4gICAgICAgICAgICAgICAgICAgIH1lbHNlIGlmKGNoaWxkUGF5b2ZmLmVxdWFscyh3b3JzdENoaWxkKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JzdENvdW50KytcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZihjaGlsZFBheW9mZiA+IGJlc3RDaGlsZCl7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q2hpbGQgPSBjaGlsZFBheW9mZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RDb3VudD0xO1xuICAgICAgICAgICAgICAgICAgICB9ZWxzZSBpZihjaGlsZFBheW9mZi5lcXVhbHMoYmVzdENoaWxkKSl7XG4gICAgICAgICAgICAgICAgICAgICAgICBiZXN0Q291bnQrK1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbGVhckNvbXB1dGVkVmFsdWVzKGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNWYWx1ZShlLCAncHJvYmFiaWxpdHknLCB0aGlzLmJhc2VQcm9iYWJpbGl0eShlKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5tb2RpZnlDaGFuY2VQcm9iYWJpbGl0eShub2RlLmNoaWxkRWRnZXMsIGJlc3RDaGlsZCwgYmVzdENvdW50LCB3b3JzdENoaWxkLCB3b3JzdENvdW50KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHN1bXdlaWdodCA9IDAgO1xuICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgIHN1bXdlaWdodD10aGlzLmFkZChzdW13ZWlnaHQsIHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhwYXlvZmYsbm9kZS5jaGlsZEVkZ2VzLCdzdW13ZWlnaHQnLHN1bXdlaWdodCk7XG4gICAgICAgICAgICBpZihzdW13ZWlnaHQ+MCl7XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZEVkZ2VzLmZvckVhY2goZT0+e1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblBheW9mZiA9IHRoaXMuYWRkKGNoaWxkcmVuUGF5b2ZmLCB0aGlzLm11bHRpcGx5KHRoaXMuY1ZhbHVlKGUsICdwcm9iYWJpbGl0eScpLHRoaXMuY1ZhbHVlKGUuY2hpbGROb2RlLCAncGF5b2ZmJykpLmRpdihzdW13ZWlnaHQpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cblxuICAgICAgICBwYXlvZmY9dGhpcy5hZGQocGF5b2ZmLCBjaGlsZHJlblBheW9mZik7XG4gICAgICAgIHRoaXMuY2xlYXJDb21wdXRlZFZhbHVlcyhub2RlKTtcblxuICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuVGVybWluYWxOb2RlKXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdhZ2dyZWdhdGVkUGF5b2ZmJywgYWdncmVnYXRlZFBheW9mZik7XG4gICAgICAgICAgICB0aGlzLmNWYWx1ZShub2RlLCAncHJvYmFiaWxpdHlUb0VudGVyJywgMCk7IC8vaW5pdGlhbCB2YWx1ZVxuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuY1ZhbHVlKG5vZGUsICdjaGlsZHJlblBheW9mZicsIGNoaWxkcmVuUGF5b2ZmKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmNWYWx1ZShub2RlLCAncGF5b2ZmJywgcGF5b2ZmKTtcbiAgICB9XG5cbiAgICAvLyBrb2xvcnVqZSBvcHR5bWFsbmUgxZtjaWXFvGtpXG4gICAgY29tcHV0ZU9wdGltYWwobm9kZSl7XG4gICAgICAgIHRocm93ICdjb21wdXRlT3B0aW1hbCBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIHJ1bGU6ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgLypHZXQgb3Igc2V0IG9iamVjdCdzIGNvbXB1dGVkIHZhbHVlIGZvciBjdXJyZW50IHJ1bGUqL1xuICAgIGNWYWx1ZShvYmplY3QsIGZpZWxkTmFtZSwgdmFsdWUpe1xuICAgICAgICByZXR1cm4gIG9iamVjdC5jb21wdXRlZFZhbHVlKHRoaXMubmFtZSwgZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgfVxuXG4gICAgYmFzZVByb2JhYmlsaXR5KGVkZ2Upe1xuICAgICAgICByZXR1cm4gZWRnZS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpO1xuICAgIH1cblxuICAgIGJhc2VQYXlvZmYoZWRnZSl7XG4gICAgICAgIHJldHVybiBlZGdlLmNvbXB1dGVkQmFzZVBheW9mZigpO1xuICAgIH1cblxuICAgIGNsZWFyQ29tcHV0ZWRWYWx1ZXMob2JqZWN0KXtcbiAgICAgICAgb2JqZWN0LmNsZWFyQ29tcHV0ZWRWYWx1ZXModGhpcy5uYW1lKTtcbiAgICB9XG5cbiAgICBhZGQoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuYWRkKGEsYilcbiAgICB9XG4gICAgc3VidHJhY3QoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuc3VidHJhY3QoYSxiKVxuICAgIH1cbiAgICBkaXZpZGUoYSxiKXtcbiAgICAgICAgcmV0dXJuIEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKGEsYilcbiAgICB9XG5cbiAgICBtdWx0aXBseShhLGIpe1xuICAgICAgICByZXR1cm4gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShhLGIpXG4gICAgfVxuXG4gICAgbWF4KCl7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1heCguLi5hcmd1bWVudHMpXG4gICAgfVxuXG4gICAgbWluKCl7XG4gICAgICAgIHJldHVybiBFeHByZXNzaW9uRW5naW5lLm1pbiguLi5hcmd1bWVudHMpXG4gICAgfVxuXG59XG4iLCJpbXBvcnQge2RvbWFpbiBhcyBtb2RlbH0gZnJvbSAnc2QtbW9kZWwnXG5pbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtsb2d9IGZyb20gJ3NkLXV0aWxzJ1xuaW1wb3J0IHtPcGVyYXRpb259IGZyb20gXCIuL29wZXJhdGlvblwiO1xuaW1wb3J0IHtUcmVlVmFsaWRhdG9yfSBmcm9tIFwiLi4vdmFsaWRhdGlvbi90cmVlLXZhbGlkYXRvclwiO1xuXG4vKlN1YnRyZWUgZmxpcHBpbmcgb3BlcmF0aW9uKi9cbmV4cG9ydCBjbGFzcyBGbGlwU3VidHJlZSBleHRlbmRzIE9wZXJhdGlvbntcblxuICAgIHN0YXRpYyAkTkFNRSA9ICdmbGlwU3VidHJlZSc7XG4gICAgZGF0YTtcbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZGF0YSwgZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICBzdXBlcihGbGlwU3VidHJlZS4kTkFNRSk7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMuZXhwcmVzc2lvbkVuZ2luZSA9IGV4cHJlc3Npb25FbmdpbmU7XG4gICAgICAgIHRoaXMudHJlZVZhbGlkYXRvciA9IG5ldyBUcmVlVmFsaWRhdG9yKGV4cHJlc3Npb25FbmdpbmUpO1xuICAgIH1cblxuICAgIGlzQXBwbGljYWJsZShvYmplY3Qpe1xuICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZVxuICAgIH1cblxuICAgIGNhblBlcmZvcm0obm9kZSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWNhYmxlKG5vZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMudHJlZVZhbGlkYXRvci52YWxpZGF0ZSh0aGlzLmRhdGEuZ2V0QWxsTm9kZXNJblN1YnRyZWUobm9kZSkpLmlzVmFsaWQoKSkgeyAvL2NoZWNrIGlmIHRoZSB3aG9sZSBzdWJ0cmVlIGlzIHByb3BlclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5vZGUuY2hpbGRFZGdlcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuXG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuTnVtYmVyID0gbnVsbDtcbiAgICAgICAgdmFyIGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzID0gW107XG4gICAgICAgIHZhciBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KCk7XG4gICAgICAgIHZhciBncmFuZGNoaWxkcmVuRWRnZUxhYmVsc1NldDtcbiAgICAgICAgaWYgKCFub2RlLmNoaWxkRWRnZXMuZXZlcnkoZT0+IHtcblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IGUuY2hpbGROb2RlO1xuICAgICAgICAgICAgICAgIGlmICghKGNoaWxkIGluc3RhbmNlb2YgbW9kZWwuQ2hhbmNlTm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuaGFzKGUubmFtZS50cmltKCkpKSB7IC8vIGVkZ2UgbGFiZWxzIHNob3VsZCBiZSB1bmlxdWVcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuYWRkKGUubmFtZS50cmltKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyYW5kY2hpbGRyZW5OdW1iZXIgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbk51bWJlciA9IGNoaWxkLmNoaWxkRWRnZXMubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbk51bWJlciA8IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjaGlsZC5jaGlsZEVkZ2VzLmZvckVhY2goZ2U9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncmFuZGNoaWxkcmVuRWRnZUxhYmVscy5wdXNoKGdlLm5hbWUudHJpbSgpKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQgPSBuZXcgU2V0KGdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHNTZXQuc2l6ZSAhPT0gZ3JhbmRjaGlsZHJlbkVkZ2VMYWJlbHMubGVuZ3RoKSB7IC8vZ3JhbmRjaGlsZHJlbiBlZGdlIGxhYmVscyBzaG91bGQgYmUgdW5pcXVlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQuY2hpbGRFZGdlcy5sZW5ndGggIT0gZ3JhbmRjaGlsZHJlbk51bWJlcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFjaGlsZC5jaGlsZEVkZ2VzLmV2ZXJ5KChnZSwgaSk9PmdyYW5kY2hpbGRyZW5FZGdlTGFiZWxzW2ldID09PSBnZS5uYW1lLnRyaW0oKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuXG4gICAgICAgICAgICB9KSkge1xuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBwZXJmb3JtKHJvb3QpIHtcblxuICAgICAgICB2YXIgcm9vdENsb25lID0gdGhpcy5kYXRhLmNsb25lU3VidHJlZShyb290LCB0cnVlKTtcbiAgICAgICAgdmFyIG9sZENoaWxkcmVuTnVtYmVyID0gcm9vdC5jaGlsZEVkZ2VzLmxlbmd0aDtcbiAgICAgICAgdmFyIG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXIgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXMubGVuZ3RoO1xuXG4gICAgICAgIHZhciBjaGlsZHJlbk51bWJlciA9IG9sZEdyYW5kQ2hpbGRyZW5OdW1iZXI7XG4gICAgICAgIHZhciBncmFuZENoaWxkcmVuTnVtYmVyID0gb2xkQ2hpbGRyZW5OdW1iZXI7XG5cbiAgICAgICAgdmFyIGNhbGxiYWNrc0Rpc2FibGVkID0gdGhpcy5kYXRhLmNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuY2FsbGJhY2tzRGlzYWJsZWQgPSB0cnVlO1xuXG5cbiAgICAgICAgdmFyIGNoaWxkWCA9IHJvb3QuY2hpbGRFZGdlc1swXS5jaGlsZE5vZGUubG9jYXRpb24ueDtcbiAgICAgICAgdmFyIHRvcFkgPSByb290LmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmNoaWxkRWRnZXNbMF0uY2hpbGROb2RlLmxvY2F0aW9uLnk7XG4gICAgICAgIHZhciBib3R0b21ZID0gcm9vdC5jaGlsZEVkZ2VzW29sZENoaWxkcmVuTnVtYmVyIC0gMV0uY2hpbGROb2RlLmNoaWxkRWRnZXNbb2xkR3JhbmRDaGlsZHJlbk51bWJlciAtIDFdLmNoaWxkTm9kZS5sb2NhdGlvbi55O1xuXG4gICAgICAgIHZhciBleHRlbnRZID0gYm90dG9tWSAtIHRvcFk7XG4gICAgICAgIHZhciBzdGVwWSA9IGV4dGVudFkgLyAoY2hpbGRyZW5OdW1iZXIgKyAxKTtcblxuICAgICAgICByb290LmNoaWxkRWRnZXMuc2xpY2UoKS5mb3JFYWNoKGU9PiB0aGlzLmRhdGEucmVtb3ZlTm9kZShlLmNoaWxkTm9kZSkpO1xuXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGlsZHJlbk51bWJlcjsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBuZXcgbW9kZWwuQ2hhbmNlTm9kZShuZXcgbW9kZWwuUG9pbnQoY2hpbGRYLCB0b3BZICsgKGkgKyAxKSAqIHN0ZXBZKSk7XG4gICAgICAgICAgICB2YXIgZWRnZSA9IHRoaXMuZGF0YS5hZGROb2RlKGNoaWxkLCByb290KTtcbiAgICAgICAgICAgIGVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzWzBdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLm5hbWU7XG5cbiAgICAgICAgICAgIGVkZ2UucHJvYmFiaWxpdHkgPSAwO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGdyYW5kQ2hpbGRyZW5OdW1iZXI7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBncmFuZENoaWxkID0gcm9vdENsb25lLmNoaWxkRWRnZXNbal0uY2hpbGROb2RlLmNoaWxkRWRnZXNbaV0uY2hpbGROb2RlO1xuXG5cbiAgICAgICAgICAgICAgICB2YXIgZ3JhbmRDaGlsZEVkZ2UgPSB0aGlzLmRhdGEuYXR0YWNoU3VidHJlZShncmFuZENoaWxkLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UubmFtZSA9IHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLm5hbWU7XG4gICAgICAgICAgICAgICAgZ3JhbmRDaGlsZEVkZ2UucGF5b2ZmID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocm9vdENsb25lLmNoaWxkRWRnZXNbal0uY29tcHV0ZWRCYXNlUGF5b2ZmKCksIHJvb3RDbG9uZS5jaGlsZEVkZ2VzW2pdLmNoaWxkTm9kZS5jaGlsZEVkZ2VzW2ldLmNvbXB1dGVkQmFzZVBheW9mZigpKTtcblxuICAgICAgICAgICAgICAgIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5tdWx0aXBseShyb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpLCByb290Q2xvbmUuY2hpbGRFZGdlc1tqXS5jaGlsZE5vZGUuY2hpbGRFZGdlc1tpXS5jb21wdXRlZEJhc2VQcm9iYWJpbGl0eSgpKTtcbiAgICAgICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQoZWRnZS5wcm9iYWJpbGl0eSwgZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGl2aWRlR3JhbmRDaGlsZEVkZ2VQcm9iYWJpbGl0eSA9IHAgPT4gRXhwcmVzc2lvbkVuZ2luZS5kaXZpZGUocCwgZWRnZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBpZiAoZWRnZS5wcm9iYWJpbGl0eS5lcXVhbHMoMCkpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYiA9IEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKDEsIGdyYW5kQ2hpbGRyZW5OdW1iZXIpO1xuICAgICAgICAgICAgICAgIGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkgPSBwID0+IHByb2I7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkLmNoaWxkRWRnZXMuZm9yRWFjaChncmFuZENoaWxkRWRnZT0+IHtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IGRpdmlkZUdyYW5kQ2hpbGRFZGdlUHJvYmFiaWxpdHkoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpO1xuICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIGdyYW5kQ2hpbGRFZGdlLnByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICBncmFuZENoaWxkRWRnZS5wcm9iYWJpbGl0eSA9IHRoaXMuZXhwcmVzc2lvbkVuZ2luZS5zZXJpYWxpemUoZ3JhbmRDaGlsZEVkZ2UucHJvYmFiaWxpdHkpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplUHJvYmFiaWxpdGllc0FmdGVyRmxpcChjaGlsZC5jaGlsZEVkZ2VzLCBwcm9iYWJpbGl0eVN1bSk7XG4gICAgICAgICAgICBlZGdlLnByb2JhYmlsaXR5ID0gdGhpcy5leHByZXNzaW9uRW5naW5lLnNlcmlhbGl6ZShlZGdlLnByb2JhYmlsaXR5KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vcm1hbGl6ZVByb2JhYmlsaXRpZXNBZnRlckZsaXAocm9vdC5jaGlsZEVkZ2VzKTtcblxuXG4gICAgICAgIHRoaXMuZGF0YS5jYWxsYmFja3NEaXNhYmxlZCA9IGNhbGxiYWNrc0Rpc2FibGVkO1xuICAgICAgICB0aGlzLmRhdGEuX2ZpcmVOb2RlQWRkZWRDYWxsYmFjaygpO1xuICAgIH1cblxuICAgIF9ub3JtYWxpemVQcm9iYWJpbGl0aWVzQWZ0ZXJGbGlwKGNoaWxkRWRnZXMsIHByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgaWYoIXByb2JhYmlsaXR5U3VtKXtcbiAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gMC4wO1xuICAgICAgICAgICAgY2hpbGRFZGdlcy5mb3JFYWNoKGU9PiB7XG4gICAgICAgICAgICAgICAgcHJvYmFiaWxpdHlTdW0gPSBFeHByZXNzaW9uRW5naW5lLmFkZChwcm9iYWJpbGl0eVN1bSwgZS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXByb2JhYmlsaXR5U3VtLmVxdWFscygxKSkge1xuICAgICAgICAgICAgbG9nLmluZm8oJ1N1bSBvZiB0aGUgcHJvYmFiaWxpdGllcyBpbiBjaGlsZCBub2RlcyBpcyBub3QgZXF1YWwgdG8gMSA6ICcsIHByb2JhYmlsaXR5U3VtKTtcbiAgICAgICAgICAgIHZhciBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIHZhciBjZiA9IDEwMDAwMDAwMDAwMDA7IC8vMTBeMTJcbiAgICAgICAgICAgIHZhciBwcmVjID0gMTI7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzLmZvckVhY2goZT0+IHtcbiAgICAgICAgICAgICAgICBlLnByb2JhYmlsaXR5ID0gcGFyc2VJbnQoRXhwcmVzc2lvbkVuZ2luZS5yb3VuZChlLnByb2JhYmlsaXR5LCBwcmVjKSAqIGNmKTtcbiAgICAgICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IG5ld1Byb2JhYmlsaXR5U3VtICsgZS5wcm9iYWJpbGl0eTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdmFyIHJlc3QgPSBjZiAtIG5ld1Byb2JhYmlsaXR5U3VtO1xuICAgICAgICAgICAgbG9nLmluZm8oJ05vcm1hbGl6aW5nIHdpdGggcm91bmRpbmcgdG8gcHJlY2lzaW9uOiAnICsgcHJlYywgcmVzdCk7XG4gICAgICAgICAgICBjaGlsZEVkZ2VzWzBdLnByb2JhYmlsaXR5ID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocmVzdCwgY2hpbGRFZGdlc1swXS5wcm9iYWJpbGl0eSk7XG4gICAgICAgICAgICBuZXdQcm9iYWJpbGl0eVN1bSA9IDAuMDtcbiAgICAgICAgICAgIGNoaWxkRWRnZXMuZm9yRWFjaChlPT4ge1xuICAgICAgICAgICAgICAgIGUucHJvYmFiaWxpdHkgPSB0aGlzLmV4cHJlc3Npb25FbmdpbmUuc2VyaWFsaXplKEV4cHJlc3Npb25FbmdpbmUuZGl2aWRlKHBhcnNlSW50KGUucHJvYmFiaWxpdHkpLCBjZikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuIiwiXG4vKkJhc2UgY2xhc3MgZm9yIGNvbXBsZXggb3BlcmF0aW9ucyBvbiB0cmVlIHN0cnVjdHVyZSovXG5leHBvcnQgY2xhc3MgT3BlcmF0aW9ue1xuXG4gICAgbmFtZTtcblxuICAgIGNvbnN0cnVjdG9yKG5hbWUpe1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgb3BlcmF0aW9uIGlzIHBvdGVudGlhbGx5IGFwcGxpY2FibGUgZm9yIG9iamVjdFxuICAgIGlzQXBwbGljYWJsZSgpe1xuICAgICAgICB0aHJvdyAnaXNBcHBsaWNhYmxlIGZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZCBmb3Igb3BlcmF0aW9uOiAnK3RoaXMubmFtZVxuICAgIH1cblxuICAgIC8vY2hlY2sgaWYgY2FuIHBlcmZvcm0gb3BlcmF0aW9uIGZvciBhcHBsaWNhYmxlIG9iamVjdFxuICAgIGNhblBlcmZvcm0ob2JqZWN0KXtcbiAgICAgICAgdGhyb3cgJ2NhblBlcmZvcm0gZnVuY3Rpb24gbm90IGltcGxlbWVudGVkIGZvciBvcGVyYXRpb246ICcrdGhpcy5uYW1lXG4gICAgfVxuXG4gICAgcGVyZm9ybShvYmplY3Qpe1xuICAgICAgICB0aHJvdyAncGVyZm9ybSBmdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQgZm9yIG9wZXJhdGlvbjogJyt0aGlzLm5hbWVcbiAgICB9XG5cblxufVxuIiwiaW1wb3J0IHtGbGlwU3VidHJlZX0gZnJvbSBcIi4vZmxpcC1zdWJ0cmVlXCI7XG5cblxuZXhwb3J0IGNsYXNzIE9wZXJhdGlvbnNNYW5hZ2VyIHtcblxuICAgIG9wZXJhdGlvbnMgPSBbXTtcbiAgICBvcGVyYXRpb25CeU5hbWUgPSB7fTtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGEsIGV4cHJlc3Npb25FbmdpbmUpe1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnJlZ2lzdGVyT3BlcmF0aW9uKG5ldyBGbGlwU3VidHJlZShkYXRhLCBleHByZXNzaW9uRW5naW5lKSk7XG4gICAgfVxuXG4gICAgcmVnaXN0ZXJPcGVyYXRpb24ob3BlcmF0aW9uKXtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25zLnB1c2gob3BlcmF0aW9uKTtcbiAgICAgICAgdGhpcy5vcGVyYXRpb25CeU5hbWVbb3BlcmF0aW9uLm5hbWVdID0gb3BlcmF0aW9uO1xuICAgIH1cblxuXG4gICAgZ2V0T3BlcmF0aW9uQnlOYW1lKG5hbWUpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25CeU5hbWVbbmFtZV07XG4gICAgfVxuXG4gICAgb3BlcmF0aW9uc0Zvck9iamVjdChvYmplY3Qpe1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVyYXRpb25zLmZpbHRlcihvcD0+b3AuaXNBcHBsaWNhYmxlKG9iamVjdCkpXG4gICAgfVxuXG59XG4iLCJcbmV4cG9ydCBjbGFzcyBEZWNpc2lvbntcbiAgICBub2RlO1xuICAgIGRlY2lzaW9uVmFsdWU7IC8vaW5kZXggb2YgIHNlbGVjdGVkIGVkZ2VcbiAgICBjaGlsZHJlbiA9IFtdO1xuICAgIGtleTtcblxuICAgIGNvbnN0cnVjdG9yKG5vZGUsIGRlY2lzaW9uVmFsdWUpIHtcbiAgICAgICAgdGhpcy5ub2RlID0gbm9kZTtcbiAgICAgICAgdGhpcy5kZWNpc2lvblZhbHVlID0gZGVjaXNpb25WYWx1ZTtcbiAgICAgICAgdGhpcy5rZXkgPSBEZWNpc2lvbi5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2VuZXJhdGVLZXkoZGVjaXNpb24sIGtleVByb3BlcnR5PSckaWQnKXtcbiAgICAgICAgdmFyIGUgPSBkZWNpc2lvbi5ub2RlLmNoaWxkRWRnZXNbZGVjaXNpb24uZGVjaXNpb25WYWx1ZV07XG4gICAgICAgIHZhciBrZXkgPSBkZWNpc2lvbi5ub2RlW2tleVByb3BlcnR5XStcIjpcIisoZVtrZXlQcm9wZXJ0eV0/IGVba2V5UHJvcGVydHldIDogZGVjaXNpb24uZGVjaXNpb25WYWx1ZSsxKTtcbiAgICAgICAgcmV0dXJuIGtleS5yZXBsYWNlKC9cXG4vZywgJyAnKTtcbiAgICB9XG5cbiAgICBhZGREZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKXtcbiAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKG5vZGUsIGRlY2lzaW9uVmFsdWUpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KHRoaXMpO1xuICAgICAgICByZXR1cm4gZGVjaXNpb247XG4gICAgfVxuXG4gICAgZ2V0RGVjaXNpb24oZGVjaXNpb25Ob2RlKXtcbiAgICAgICAgcmV0dXJuIERlY2lzaW9uLmdldERlY2lzaW9uKHRoaXMsIGRlY2lzaW9uTm9kZSlcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24oZGVjaXNpb24sIGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIGlmKGRlY2lzaW9uLm5vZGU9PT1kZWNpc2lvbk5vZGUgfHwgZGVjaXNpb24ubm9kZS4kaWQgPT09IGRlY2lzaW9uTm9kZS4kaWQpe1xuICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICB9XG4gICAgICAgIGZvcih2YXIgaT0wOyBpPGRlY2lzaW9uLmNoaWxkcmVuLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkID0gRGVjaXNpb24uZ2V0RGVjaXNpb24oZGVjaXNpb24uY2hpbGRyZW5baV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRpYyB0b0RlY2lzaW9uU3RyaW5nKGRlY2lzaW9uLCBleHRlbmRlZD1mYWxzZSwga2V5UHJvcGVydHk9J25hbWUnLCBpbmRlbnQgPSAnJyl7XG5cbiAgICAgICAgdmFyIHJlcyA9IERlY2lzaW9uLmdlbmVyYXRlS2V5KGRlY2lzaW9uLCBrZXlQcm9wZXJ0eSk7XG4gICAgICAgIHZhciBjaGlsZHJlblJlcyA9IFwiXCI7XG5cbiAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4uZm9yRWFjaChkPT57XG4gICAgICAgICAgICBpZihjaGlsZHJlblJlcyl7XG4gICAgICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyArPSAnXFxuJytpbmRlbnQ7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzICs9IFwiLCBcIlxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGRyZW5SZXMgKz0gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyhkLGV4dGVuZGVkLGtleVByb3BlcnR5LCBpbmRlbnQrJ1xcdCcpXG4gICAgICAgIH0pO1xuICAgICAgICBpZihkZWNpc2lvbi5jaGlsZHJlbi5sZW5ndGgpe1xuICAgICAgICAgICAgaWYoZXh0ZW5kZWQpe1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuUmVzID0gICdcXG4nK2luZGVudCArY2hpbGRyZW5SZXM7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBjaGlsZHJlblJlcyA9IFwiIC0gKFwiICsgY2hpbGRyZW5SZXMgKyBcIilcIjtcbiAgICAgICAgICAgIH1cblxuXG5cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXMrY2hpbGRyZW5SZXM7XG4gICAgfVxuXG4gICAgdG9EZWNpc2lvblN0cmluZyhpbmRlbnQ9ZmFsc2Upe1xuICAgICAgICByZXR1cm4gRGVjaXNpb24udG9EZWNpc2lvblN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxufVxuIiwiaW1wb3J0IHtQb2xpY3l9IGZyb20gXCIuL3BvbGljeVwiO1xuaW1wb3J0IHtkb21haW4gYXMgbW9kZWx9IGZyb20gJ3NkLW1vZGVsJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSAnc2QtdXRpbHMnXG5pbXBvcnQge0RlY2lzaW9ufSBmcm9tIFwiLi9kZWNpc2lvblwiO1xuXG5leHBvcnQgY2xhc3MgUG9saWNpZXNDb2xsZWN0b3J7XG4gICAgcG9saWNpZXMgPSBbXTtcbiAgICBydWxlTmFtZT1mYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKHJvb3QsIG9wdGltYWxGb3JSdWxlTmFtZSl7XG4gICAgICAgIHRoaXMucnVsZU5hbWUgPSBvcHRpbWFsRm9yUnVsZU5hbWU7XG4gICAgICAgIHRoaXMuY29sbGVjdChyb290KS5mb3JFYWNoKChkZWNpc2lvbnMsaSk9PntcbiAgICAgICAgICAgIHRoaXMucG9saWNpZXMucHVzaChuZXcgUG9saWN5KFwiI1wiKyhpKzEpLCBkZWNpc2lvbnMpKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmKHRoaXMucG9saWNpZXMubGVuZ3RoPT09MSl7XG4gICAgICAgICAgICB0aGlzLnBvbGljaWVzWzBdLmlkID0gXCJkZWZhdWx0XCJcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbGxlY3Qocm9vdCl7XG4gICAgICAgIHZhciBub2RlUXVldWUgPSBbcm9vdF07XG4gICAgICAgIHZhciBub2RlO1xuICAgICAgICB2YXIgZGVjaXNpb25Ob2RlcyA9IFtdO1xuICAgICAgICB3aGlsZShub2RlUXVldWUubGVuZ3RoKXtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlUXVldWUuc2hpZnQoKTtcblxuICAgICAgICAgICAgaWYodGhpcy5ydWxlTmFtZSAmJiAhbm9kZS5jb21wdXRlZFZhbHVlKHRoaXMucnVsZU5hbWUsICdvcHRpbWFsJykpe1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihub2RlIGluc3RhbmNlb2YgbW9kZWwuRGVjaXNpb25Ob2RlKXtcbiAgICAgICAgICAgICAgICBkZWNpc2lvbk5vZGVzLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuY2hpbGRFZGdlcy5mb3JFYWNoKChlZGdlLCBpKT0+e1xuICAgICAgICAgICAgICAgIG5vZGVRdWV1ZS5wdXNoKGVkZ2UuY2hpbGROb2RlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBVdGlscy5jYXJ0ZXNpYW5Qcm9kdWN0T2YoZGVjaXNpb25Ob2Rlcy5tYXAoKGRlY2lzaW9uTm9kZSk9PntcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbnM9IFtdO1xuICAgICAgICAgICAgZGVjaXNpb25Ob2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZWRnZSwgaSk9PntcblxuICAgICAgICAgICAgICAgIGlmKHRoaXMucnVsZU5hbWUgJiYgIWVkZ2UuY29tcHV0ZWRWYWx1ZSh0aGlzLnJ1bGVOYW1lLCAnb3B0aW1hbCcpKXtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBjaGlsZERlY2lzaW9ucyA9IHRoaXMuY29sbGVjdChlZGdlLmNoaWxkTm9kZSk7IC8vYWxsIHBvc3NpYmxlIGNoaWxkIGRlY2lzaW9ucyAoY2FydGVzaWFuKVxuICAgICAgICAgICAgICAgIGNoaWxkRGVjaXNpb25zLmZvckVhY2goY2Q9PntcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRlY2lzaW9uID0gbmV3IERlY2lzaW9uKGRlY2lzaW9uTm9kZSwgaSk7XG4gICAgICAgICAgICAgICAgICAgIGRlY2lzaW9ucy5wdXNoKGRlY2lzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgZGVjaXNpb24uY2hpbGRyZW4gPSBjZDtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBkZWNpc2lvbnM7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbn1cbiIsImltcG9ydCB7RGVjaXNpb259IGZyb20gXCIuL2RlY2lzaW9uXCI7XG5cbmV4cG9ydCBjbGFzcyBQb2xpY3l7XG4gICAgaWQ7XG4gICAgZGVjaXNpb25zID0gW107XG5cbiAgICBjb25zdHJ1Y3RvcihpZCwgZGVjaXNpb25zKXtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLmRlY2lzaW9ucyA9IGRlY2lzaW9ucyB8fCBbXTtcbiAgICAgICAgdGhpcy5rZXkgPSBQb2xpY3kuZ2VuZXJhdGVLZXkodGhpcyk7XG4gICAgfVxuXG4gICAgYWRkRGVjaXNpb24obm9kZSwgZGVjaXNpb25WYWx1ZSl7XG4gICAgICAgIHZhciBkZWNpc2lvbiA9IG5ldyBEZWNpc2lvbihub2RlLCBkZWNpc2lvblZhbHVlKTtcbiAgICAgICAgdGhpcy5kZWNpc2lvbnMgLnB1c2goZGVjaXNpb24pO1xuICAgICAgICB0aGlzLmtleSA9IFBvbGljeS5nZW5lcmF0ZUtleSh0aGlzKTtcbiAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZW5lcmF0ZUtleShwb2xpY3kpe1xuICAgICAgICB2YXIga2V5ID0gXCJcIjtcbiAgICAgICAgcG9saWN5LmRlY2lzaW9ucy5mb3JFYWNoKGQ9PmtleSs9KGtleT8gXCImXCI6IFwiXCIpK2Qua2V5KTtcbiAgICAgICAgcmV0dXJuIGtleTtcbiAgICB9XG5cbiAgICBlcXVhbHMocG9saWN5LCBpZ25vcmVJZD10cnVlKXtcbiAgICAgICAgaWYodGhpcy5rZXkgIT0gcG9saWN5LmtleSl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWdub3JlSWQgfHwgdGhpcy5pZCA9PT0gcG9saWN5LmlkO1xuICAgIH1cblxuICAgIGdldERlY2lzaW9uKGRlY2lzaW9uTm9kZSl7XG4gICAgICAgIHJldHVybiBQb2xpY3kuZ2V0RGVjaXNpb24odGhpcywgZGVjaXNpb25Ob2RlKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0RGVjaXNpb24ocG9saWN5LCBkZWNpc2lvbk5vZGUpe1xuICAgICAgICBmb3IodmFyIGk9MDsgaTxwb2xpY3kuZGVjaXNpb25zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIHZhciBkZWNpc2lvbiA9IERlY2lzaW9uLmdldERlY2lzaW9uKHBvbGljeS5kZWNpc2lvbnNbaV0sIGRlY2lzaW9uTm9kZSk7XG4gICAgICAgICAgICBpZihkZWNpc2lvbil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRlY2lzaW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHN0YXRpYyB0b1BvbGljeVN0cmluZyhwb2xpY3ksIGV4dGVuZGVkPWZhbHNlLCBwcmVwZW5kSWQ9ZmFsc2Upe1xuXG4gICAgICAgIHZhciByZXMgPSBcIlwiO1xuICAgICAgICBwb2xpY3kuZGVjaXNpb25zLmZvckVhY2goZD0+e1xuICAgICAgICAgICAgaWYocmVzKXtcbiAgICAgICAgICAgICAgICBpZihleHRlbmRlZCl7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIlxcblwiXG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJlcyArPSBcIiwgXCJcbiAgICAgICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzICs9IERlY2lzaW9uLnRvRGVjaXNpb25TdHJpbmcoZCwgZXh0ZW5kZWQsICduYW1lJywgJ1xcdCcpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYocHJlcGVuZElkICYmIHBvbGljeS5pZCE9PXVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gcG9saWN5LmlkK1wiIFwiK3JlcztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuXG4gICAgdG9Qb2xpY3lTdHJpbmcoaW5kZW50PWZhbHNlKXtcbiAgICAgICAgcmV0dXJuIFBvbGljeS50b1BvbGljeVN0cmluZyh0aGlzLCBpbmRlbnQpXG4gICAgfVxuXG5cbn1cbiIsImltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1V0aWxzfSBmcm9tIFwic2QtdXRpbHNcIjtcblxuLypDb21wdXRlZCBiYXNlIHZhbHVlIHZhbGlkYXRvciovXG5leHBvcnQgY2xhc3MgUGF5b2ZmVmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUpe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlID0gRXhwcmVzc2lvbkVuZ2luZS50b051bWJlcih2YWx1ZSk7XG4gICAgICAgIHJldHVybiB2YWx1ZS5jb21wYXJlKE51bWJlci5NSU5fU0FGRV9JTlRFR0VSKSA+PSAwICYmIHZhbHVlLmNvbXBhcmUoTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge0V4cHJlc3Npb25FbmdpbmV9IGZyb20gJ3NkLWV4cHJlc3Npb24tZW5naW5lJ1xuaW1wb3J0IHtVdGlsc30gZnJvbSBcInNkLXV0aWxzXCI7XG5cbi8qQ29tcHV0ZWQgYmFzZSB2YWx1ZSB2YWxpZGF0b3IqL1xuZXhwb3J0IGNsYXNzIFByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J7XG4gICAgZXhwcmVzc2lvbkVuZ2luZTtcbiAgICBjb25zdHJ1Y3RvcihleHByZXNzaW9uRW5naW5lKXtcbiAgICAgICAgdGhpcy5leHByZXNzaW9uRW5naW5lPWV4cHJlc3Npb25FbmdpbmU7XG4gICAgfVxuXG4gICAgdmFsaWRhdGUodmFsdWUsIGVkZ2Upe1xuICAgICAgICBpZih2YWx1ZT09PW51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdmFsdWUgPSBFeHByZXNzaW9uRW5naW5lLnRvTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlLmNvbXBhcmUoMCkgPj0gMCAmJiB2YWx1ZS5jb21wYXJlKDEpIDw9IDA7XG4gICAgfVxuXG59XG4iLCJpbXBvcnQge1V0aWxzfSBmcm9tICdzZC11dGlscydcbmltcG9ydCB7ZG9tYWluIGFzIG1vZGVsLCBWYWxpZGF0aW9uUmVzdWx0fSBmcm9tICdzZC1tb2RlbCdcbmltcG9ydCB7RXhwcmVzc2lvbkVuZ2luZX0gZnJvbSAnc2QtZXhwcmVzc2lvbi1lbmdpbmUnXG5pbXBvcnQge1Byb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3J9IGZyb20gXCIuL3Byb2JhYmlsaXR5LXZhbHVlLXZhbGlkYXRvclwiO1xuaW1wb3J0IHtQYXlvZmZWYWx1ZVZhbGlkYXRvcn0gZnJvbSBcIi4vcGF5b2ZmLXZhbHVlLXZhbGlkYXRvclwiO1xuXG5leHBvcnQgY2xhc3MgVHJlZVZhbGlkYXRvciB7XG5cbiAgICBleHByZXNzaW9uRW5naW5lO1xuXG4gICAgY29uc3RydWN0b3IoZXhwcmVzc2lvbkVuZ2luZSkge1xuICAgICAgICB0aGlzLmV4cHJlc3Npb25FbmdpbmUgPSBleHByZXNzaW9uRW5naW5lO1xuICAgICAgICB0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IgPSBuZXcgUHJvYmFiaWxpdHlWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICAgICAgdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvciA9IG5ldyBQYXlvZmZWYWx1ZVZhbGlkYXRvcihleHByZXNzaW9uRW5naW5lKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZShub2Rlcykge1xuXG4gICAgICAgIHZhciB2YWxpZGF0aW9uUmVzdWx0ID0gbmV3IFZhbGlkYXRpb25SZXN1bHQoKTtcblxuICAgICAgICBub2Rlcy5mb3JFYWNoKG49PiB7XG4gICAgICAgICAgICB0aGlzLnZhbGlkYXRlTm9kZShuLCB2YWxpZGF0aW9uUmVzdWx0KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxuXG4gICAgdmFsaWRhdGVOb2RlKG5vZGUsIHZhbGlkYXRpb25SZXN1bHQgPSBuZXcgVmFsaWRhdGlvblJlc3VsdCgpKSB7XG5cbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5UZXJtaW5hbE5vZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIW5vZGUuY2hpbGRFZGdlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHZhbGlkYXRpb25SZXN1bHQuYWRkRXJyb3IoJ2luY29tcGxldGVQYXRoJywgbm9kZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwcm9iYWJpbGl0eVN1bSA9IEV4cHJlc3Npb25FbmdpbmUudG9OdW1iZXIoMCk7XG4gICAgICAgIHZhciB3aXRoSGFzaCA9IGZhbHNlO1xuICAgICAgICBub2RlLmNoaWxkRWRnZXMuZm9yRWFjaCgoZSwgaSk9PiB7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3Byb2JhYmlsaXR5JywgdHJ1ZSk7XG4gICAgICAgICAgICBlLnNldFZhbHVlVmFsaWRpdHkoJ3BheW9mZicsIHRydWUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIG1vZGVsLkNoYW5jZU5vZGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvYmFiaWxpdHkgPSBlLmNvbXB1dGVkQmFzZVByb2JhYmlsaXR5KCk7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnByb2JhYmlsaXR5VmFsdWVWYWxpZGF0b3IudmFsaWRhdGUocHJvYmFiaWxpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmKCFFeHByZXNzaW9uRW5naW5lLmlzSGFzaChlLnByb2JhYmlsaXR5KSl7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKHtuYW1lOiAnaW52YWxpZFByb2JhYmlsaXR5JywgZGF0YTogeydudW1iZXInOiBpICsgMX19LCBub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuc2V0VmFsdWVWYWxpZGl0eSgncHJvYmFiaWxpdHknLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHByb2JhYmlsaXR5U3VtID0gRXhwcmVzc2lvbkVuZ2luZS5hZGQocHJvYmFiaWxpdHlTdW0sIHByb2JhYmlsaXR5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgcGF5b2ZmID0gZS5jb21wdXRlZEJhc2VQYXlvZmYoKTtcbiAgICAgICAgICAgIGlmICghdGhpcy5wYXlvZmZWYWx1ZVZhbGlkYXRvci52YWxpZGF0ZShwYXlvZmYpKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvblJlc3VsdC5hZGRFcnJvcih7bmFtZTogJ2ludmFsaWRQYXlvZmYnLCBkYXRhOiB7J251bWJlcic6IGkgKyAxfX0sIG5vZGUpO1xuICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdpbnZhbGlkUGF5b2ZmJywgZSk7XG4gICAgICAgICAgICAgICAgZS5zZXRWYWx1ZVZhbGlkaXR5KCdwYXlvZmYnLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBtb2RlbC5DaGFuY2VOb2RlKSB7XG4gICAgICAgICAgICBpZiAoaXNOYU4ocHJvYmFiaWxpdHlTdW0pIHx8ICFwcm9iYWJpbGl0eVN1bS5lcXVhbHMoMSkpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uUmVzdWx0LmFkZEVycm9yKCdwcm9iYWJpbGl0eURvTm90U3VtVXBUbzEnLCBub2RlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG5cbiAgICAgICAgcmV0dXJuIHZhbGlkYXRpb25SZXN1bHQ7XG4gICAgfVxufVxuIiwiZXhwb3J0ICogZnJvbSAnLi9zcmMvaW5kZXgnXG4iXX0=
