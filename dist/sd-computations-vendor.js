require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

var instanceOfAny = function instanceOfAny(object, constructors) {
  return constructors.some(function (c) {
    return object instanceof c;
  });
};

var idbProxyableTypes;
var cursorAdvanceMethods; // This is a function to prevent it throwing up in node environments.

function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [IDBDatabase, IDBObjectStore, IDBIndex, IDBCursor, IDBTransaction]);
} // This is a function to prevent it throwing up in node environments.


function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [IDBCursor.prototype.advance, IDBCursor.prototype.continue, IDBCursor.prototype.continuePrimaryKey]);
}

var cursorRequestMap = new WeakMap();
var transactionDoneMap = new WeakMap();
var transactionStoreNamesMap = new WeakMap();
var transformCache = new WeakMap();
var reverseTransformCache = new WeakMap();

function promisifyRequest(request) {
  var promise = new Promise(function (resolve, reject) {
    var unlisten = function unlisten() {
      request.removeEventListener('success', success);
      request.removeEventListener('error', error);
    };

    var success = function success() {
      resolve(wrap(request.result));
      unlisten();
    };

    var error = function error() {
      reject(request.error);
      unlisten();
    };

    request.addEventListener('success', success);
    request.addEventListener('error', error);
  });
  promise.then(function (value) {
    // Since cursoring reuses the IDBRequest (*sigh*), we cache it for later retrieval
    // (see wrapFunction).
    if (value instanceof IDBCursor) {
      cursorRequestMap.set(value, request);
    } // Catching to avoid "Uncaught Promise exceptions"

  }).catch(function () {}); // This mapping exists in reverseTransformCache but doesn't doesn't exist in transformCache. This
  // is because we create many promises from a single IDBRequest.

  reverseTransformCache.set(promise, request);
  return promise;
}

function cacheDonePromiseForTransaction(tx) {
  // Early bail if we've already created a done promise for this transaction.
  if (transactionDoneMap.has(tx)) return;
  var done = new Promise(function (resolve, reject) {
    var unlisten = function unlisten() {
      tx.removeEventListener('complete', complete);
      tx.removeEventListener('error', error);
      tx.removeEventListener('abort', error);
    };

    var complete = function complete() {
      resolve();
      unlisten();
    };

    var error = function error() {
      reject(tx.error || new DOMException('AbortError', 'AbortError'));
      unlisten();
    };

    tx.addEventListener('complete', complete);
    tx.addEventListener('error', error);
    tx.addEventListener('abort', error);
  }); // Cache it for later retrieval.

  transactionDoneMap.set(tx, done);
}

var idbProxyTraps = {
  get: function get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      // Special handling for transaction.done.
      if (prop === 'done') return transactionDoneMap.get(target); // Polyfill for objectStoreNames because of Edge.

      if (prop === 'objectStoreNames') {
        return target.objectStoreNames || transactionStoreNamesMap.get(target);
      } // Make tx.store return the only store in the transaction, or undefined if there are many.


      if (prop === 'store') {
        return receiver.objectStoreNames[1] ? undefined : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    } // Else transform whatever we get back.


    return wrap(target[prop]);
  },
  set: function set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has: function has(target, prop) {
    if (target instanceof IDBTransaction && (prop === 'done' || prop === 'store')) {
      return true;
    }

    return prop in target;
  }
};

function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}

function wrapFunction(func) {
  // Due to expected object equality (which is enforced by the caching in `wrap`), we
  // only create one new func per func.
  // Edge doesn't support objectStoreNames (booo), so we polyfill it here.
  if (func === IDBDatabase.prototype.transaction && !('objectStoreNames' in IDBTransaction.prototype)) {
    return function (storeNames) {
      for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      var tx = func.call.apply(func, [unwrap(this), storeNames].concat(args));
      transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
      return wrap(tx);
    };
  } // Cursor methods are special, as the behaviour is a little more different to standard IDB. In
  // IDB, you advance the cursor and wait for a new 'success' on the IDBRequest that gave you the
  // cursor. It's kinda like a promise that can resolve with many values. That doesn't make sense
  // with real promises, so each advance methods returns a new promise for the cursor object, or
  // undefined if the end of the cursor has been reached.


  if (getCursorAdvanceMethods().includes(func)) {
    return function () {
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }

      // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
      // the original object.
      func.apply(unwrap(this), args);
      return wrap(cursorRequestMap.get(this));
    };
  }

  return function () {
    for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
      args[_key3] = arguments[_key3];
    }

    // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
    // the original object.
    return wrap(func.apply(unwrap(this), args));
  };
}

function transformCachableValue(value) {
  if (typeof value === 'function') return wrapFunction(value); // This doesn't return, it just creates a 'done' promise for the transaction,
  // which is later returned for transaction.done (see idbObjectHandler).

  if (value instanceof IDBTransaction) cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes())) return new Proxy(value, idbProxyTraps); // Return the same value back if we're not going to transform it.

  return value;
}

function wrap(value) {
  // We sometimes generate multiple promises from a single IDBRequest (eg when cursoring), because
  // IDB is weird and a single IDBRequest can yield many responses, so these can't be cached.
  if (value instanceof IDBRequest) return promisifyRequest(value); // If we've already transformed this value before, reuse the transformed value.
  // This is faster, but it also provides object equality.

  if (transformCache.has(value)) return transformCache.get(value);
  var newValue = transformCachableValue(value); // Not all types are transformed.
  // These may be primitive types, so they can't be WeakMap keys.

  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }

  return newValue;
}

var unwrap = function unwrap(value) {
  return reverseTransformCache.get(value);
};

exports.instanceOfAny = instanceOfAny;
exports.replaceTraps = replaceTraps;
exports.reverseTransformCache = reverseTransformCache;
exports.unwrap = unwrap;
exports.wrap = wrap;

},{}],"idb":[function(require,module,exports){
'use strict';

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) { symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); } keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

Object.defineProperty(exports, '__esModule', {
  value: true
});

var wrapIdbValue = require('./wrap-idb-value.js');
/**
 * Open a database.
 *
 * @param name Name of the database.
 * @param version Schema version.
 * @param callbacks Additional callbacks.
 */


function openDB(name, version) {
  var _ref = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {},
      blocked = _ref.blocked,
      upgrade = _ref.upgrade,
      blocking = _ref.blocking,
      terminated = _ref.terminated;

  var request = indexedDB.open(name, version);
  var openPromise = wrapIdbValue.wrap(request);

  if (upgrade) {
    request.addEventListener('upgradeneeded', function (event) {
      upgrade(wrapIdbValue.wrap(request.result), event.oldVersion, event.newVersion, wrapIdbValue.wrap(request.transaction));
    });
  }

  if (blocked) request.addEventListener('blocked', function () {
    return blocked();
  });
  openPromise.then(function (db) {
    if (terminated) db.addEventListener('close', function () {
      return terminated();
    });
    if (blocking) db.addEventListener('versionchange', function () {
      return blocking();
    });
  }).catch(function () {});
  return openPromise;
}
/**
 * Delete a database.
 *
 * @param name Name of the database.
 */


function deleteDB(name) {
  var _ref2 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
      blocked = _ref2.blocked;

  var request = indexedDB.deleteDatabase(name);
  if (blocked) request.addEventListener('blocked', function () {
    return blocked();
  });
  return wrapIdbValue.wrap(request).then(function () {
    return undefined;
  });
}

var readMethods = ['get', 'getKey', 'getAll', 'getAllKeys', 'count'];
var writeMethods = ['put', 'add', 'delete', 'clear'];
var cachedMethods = new Map();

function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === 'string')) {
    return;
  }

  if (cachedMethods.get(prop)) return cachedMethods.get(prop);
  var targetFuncName = prop.replace(/FromIndex$/, '');
  var useIndex = prop !== targetFuncName;
  var isWrite = writeMethods.includes(targetFuncName);

  if ( // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
  !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))) {
    return;
  }

  var method = /*#__PURE__*/function () {
    var _ref3 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(storeName) {
      var _target;

      var tx,
          target,
          _len,
          args,
          _key,
          _args = arguments;

      return regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              // isWrite ? 'readwrite' : undefined gzipps better, but fails in Edge :(
              tx = this.transaction(storeName, isWrite ? 'readwrite' : 'readonly');
              target = tx.store;

              for (_len = _args.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = _args[_key];
              }

              if (useIndex) target = target.index(args.shift()); // Must reject if op rejects.
              // If it's a write operation, must reject if tx.done rejects.
              // Must reject with op rejection first.
              // Must resolve with op value.
              // Must handle both promises (no unhandled rejections)

              _context.next = 6;
              return Promise.all([(_target = target)[targetFuncName].apply(_target, args), isWrite && tx.done]);

            case 6:
              return _context.abrupt("return", _context.sent[0]);

            case 7:
            case "end":
              return _context.stop();
          }
        }
      }, _callee, this);
    }));

    return function method(_x) {
      return _ref3.apply(this, arguments);
    };
  }();

  cachedMethods.set(prop, method);
  return method;
}

wrapIdbValue.replaceTraps(function (oldTraps) {
  return _objectSpread(_objectSpread({}, oldTraps), {}, {
    get: function get(target, prop, receiver) {
      return getMethod(target, prop) || oldTraps.get(target, prop, receiver);
    },
    has: function has(target, prop) {
      return !!getMethod(target, prop) || oldTraps.has(target, prop);
    }
  });
});
exports.unwrap = wrapIdbValue.unwrap;
exports.wrap = wrapIdbValue.wrap;
exports.deleteDB = deleteDB;
exports.openDB = openDB;

},{"./wrap-idb-value.js":1}]},{},[])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2J1aWxkL2Nqcy93cmFwLWlkYi12YWx1ZS5qcyIsImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7O0FBRUEsSUFBTSxhQUFhLEdBQUcsU0FBaEIsYUFBZ0IsQ0FBQyxNQUFELEVBQVMsWUFBVDtBQUFBLFNBQTBCLFlBQVksQ0FBQyxJQUFiLENBQWtCLFVBQUMsQ0FBRDtBQUFBLFdBQU8sTUFBTSxZQUFZLENBQXpCO0FBQUEsR0FBbEIsQ0FBMUI7QUFBQSxDQUF0Qjs7QUFFQSxJQUFJLGlCQUFKO0FBQ0EsSUFBSSxvQkFBSixDLENBQ0E7O0FBQ0EsU0FBUyxvQkFBVCxHQUFnQztBQUM1QixTQUFRLGlCQUFpQixLQUNwQixpQkFBaUIsR0FBRyxDQUNqQixXQURpQixFQUVqQixjQUZpQixFQUdqQixRQUhpQixFQUlqQixTQUppQixFQUtqQixjQUxpQixDQURBLENBQXpCO0FBUUgsQyxDQUNEOzs7QUFDQSxTQUFTLHVCQUFULEdBQW1DO0FBQy9CLFNBQVEsb0JBQW9CLEtBQ3ZCLG9CQUFvQixHQUFHLENBQ3BCLFNBQVMsQ0FBQyxTQUFWLENBQW9CLE9BREEsRUFFcEIsU0FBUyxDQUFDLFNBQVYsQ0FBb0IsUUFGQSxFQUdwQixTQUFTLENBQUMsU0FBVixDQUFvQixrQkFIQSxDQURBLENBQTVCO0FBTUg7O0FBQ0QsSUFBTSxnQkFBZ0IsR0FBRyxJQUFJLE9BQUosRUFBekI7QUFDQSxJQUFNLGtCQUFrQixHQUFHLElBQUksT0FBSixFQUEzQjtBQUNBLElBQU0sd0JBQXdCLEdBQUcsSUFBSSxPQUFKLEVBQWpDO0FBQ0EsSUFBTSxjQUFjLEdBQUcsSUFBSSxPQUFKLEVBQXZCO0FBQ0EsSUFBTSxxQkFBcUIsR0FBRyxJQUFJLE9BQUosRUFBOUI7O0FBQ0EsU0FBUyxnQkFBVCxDQUEwQixPQUExQixFQUFtQztBQUMvQixNQUFNLE9BQU8s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QUFBQTtBQUFBO0FBQUEsS0FBWjs7QUFnQkEsRUFBQSxhQUFhLENBQUMsR0FBZCxDQUFrQixJQUFsQixFQUF3QixNQUF4QjtBQUNBLFNBQU8sTUFBUDtBQUNIOztBQUNELFlBQVksQ0FBQyxZQUFiLENBQTBCLFVBQUMsUUFBRDtBQUFBLHlDQUNuQixRQURtQjtBQUV0QixJQUFBLEdBQUcsRUFBRSxhQUFDLE1BQUQsRUFBUyxJQUFULEVBQWUsUUFBZjtBQUFBLGFBQTRCLFNBQVMsQ0FBQyxNQUFELEVBQVMsSUFBVCxDQUFULElBQTJCLFFBQVEsQ0FBQyxHQUFULENBQWEsTUFBYixFQUFxQixJQUFyQixFQUEyQixRQUEzQixDQUF2RDtBQUFBLEtBRmlCO0FBR3RCLElBQUEsR0FBRyxFQUFFLGFBQUMsTUFBRCxFQUFTLElBQVQ7QUFBQSxhQUFrQixDQUFDLENBQUMsU0FBUyxDQUFDLE1BQUQsRUFBUyxJQUFULENBQVgsSUFBNkIsUUFBUSxDQUFDLEdBQVQsQ0FBYSxNQUFiLEVBQXFCLElBQXJCLENBQS9DO0FBQUE7QUFIaUI7QUFBQSxDQUExQjtBQU1BLE9BQU8sQ0FBQyxNQUFSLEdBQWlCLFlBQVksQ0FBQyxNQUE5QjtBQUNBLE9BQU8sQ0FBQyxJQUFSLEdBQWUsWUFBWSxDQUFDLElBQTVCO0FBQ0EsT0FBTyxDQUFDLFFBQVIsR0FBbUIsUUFBbkI7QUFDQSxPQUFPLENBQUMsTUFBUixHQUFpQixNQUFqQiIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIid1c2Ugc3RyaWN0JztcblxuY29uc3QgaW5zdGFuY2VPZkFueSA9IChvYmplY3QsIGNvbnN0cnVjdG9ycykgPT4gY29uc3RydWN0b3JzLnNvbWUoKGMpID0+IG9iamVjdCBpbnN0YW5jZW9mIGMpO1xuXG5sZXQgaWRiUHJveHlhYmxlVHlwZXM7XG5sZXQgY3Vyc29yQWR2YW5jZU1ldGhvZHM7XG4vLyBUaGlzIGlzIGEgZnVuY3Rpb24gdG8gcHJldmVudCBpdCB0aHJvd2luZyB1cCBpbiBub2RlIGVudmlyb25tZW50cy5cbmZ1bmN0aW9uIGdldElkYlByb3h5YWJsZVR5cGVzKCkge1xuICAgIHJldHVybiAoaWRiUHJveHlhYmxlVHlwZXMgfHxcbiAgICAgICAgKGlkYlByb3h5YWJsZVR5cGVzID0gW1xuICAgICAgICAgICAgSURCRGF0YWJhc2UsXG4gICAgICAgICAgICBJREJPYmplY3RTdG9yZSxcbiAgICAgICAgICAgIElEQkluZGV4LFxuICAgICAgICAgICAgSURCQ3Vyc29yLFxuICAgICAgICAgICAgSURCVHJhbnNhY3Rpb24sXG4gICAgICAgIF0pKTtcbn1cbi8vIFRoaXMgaXMgYSBmdW5jdGlvbiB0byBwcmV2ZW50IGl0IHRocm93aW5nIHVwIGluIG5vZGUgZW52aXJvbm1lbnRzLlxuZnVuY3Rpb24gZ2V0Q3Vyc29yQWR2YW5jZU1ldGhvZHMoKSB7XG4gICAgcmV0dXJuIChjdXJzb3JBZHZhbmNlTWV0aG9kcyB8fFxuICAgICAgICAoY3Vyc29yQWR2YW5jZU1ldGhvZHMgPSBbXG4gICAgICAgICAgICBJREJDdXJzb3IucHJvdG90eXBlLmFkdmFuY2UsXG4gICAgICAgICAgICBJREJDdXJzb3IucHJvdG90eXBlLmNvbnRpbnVlLFxuICAgICAgICAgICAgSURCQ3Vyc29yLnByb3RvdHlwZS5jb250aW51ZVByaW1hcnlLZXksXG4gICAgICAgIF0pKTtcbn1cbmNvbnN0IGN1cnNvclJlcXVlc3RNYXAgPSBuZXcgV2Vha01hcCgpO1xuY29uc3QgdHJhbnNhY3Rpb25Eb25lTWFwID0gbmV3IFdlYWtNYXAoKTtcbmNvbnN0IHRyYW5zYWN0aW9uU3RvcmVOYW1lc01hcCA9IG5ldyBXZWFrTWFwKCk7XG5jb25zdCB0cmFuc2Zvcm1DYWNoZSA9IG5ldyBXZWFrTWFwKCk7XG5jb25zdCByZXZlcnNlVHJhbnNmb3JtQ2FjaGUgPSBuZXcgV2Vha01hcCgpO1xuZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgdW5saXN0ZW4gPSAoKSA9PiB7XG4gICAgICAgICAgICByZXF1ZXN0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3N1Y2Nlc3MnLCBzdWNjZXNzKTtcbiAgICAgICAgICAgIHJlcXVlc3QucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBlcnJvcik7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHN1Y2Nlc3MgPSAoKSA9PiB7XG4gICAgICAgICAgICByZXNvbHZlKHdyYXAocmVxdWVzdC5yZXN1bHQpKTtcbiAgICAgICAgICAgIHVubGlzdGVuKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGVycm9yID0gKCkgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgICAgICAgdW5saXN0ZW4oKTtcbiAgICAgICAgfTtcbiAgICAgICAgcmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCdzdWNjZXNzJywgc3VjY2Vzcyk7XG4gICAgICAgIHJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBlcnJvcik7XG4gICAgfSk7XG4gICAgcHJvbWlzZVxuICAgICAgICAudGhlbigodmFsdWUpID0+IHtcbiAgICAgICAgLy8gU2luY2UgY3Vyc29yaW5nIHJldXNlcyB0aGUgSURCUmVxdWVzdCAoKnNpZ2gqKSwgd2UgY2FjaGUgaXQgZm9yIGxhdGVyIHJldHJpZXZhbFxuICAgICAgICAvLyAoc2VlIHdyYXBGdW5jdGlvbikuXG4gICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIElEQkN1cnNvcikge1xuICAgICAgICAgICAgY3Vyc29yUmVxdWVzdE1hcC5zZXQodmFsdWUsIHJlcXVlc3QpO1xuICAgICAgICB9XG4gICAgICAgIC8vIENhdGNoaW5nIHRvIGF2b2lkIFwiVW5jYXVnaHQgUHJvbWlzZSBleGNlcHRpb25zXCJcbiAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4geyB9KTtcbiAgICAvLyBUaGlzIG1hcHBpbmcgZXhpc3RzIGluIHJldmVyc2VUcmFuc2Zvcm1DYWNoZSBidXQgZG9lc24ndCBkb2Vzbid0IGV4aXN0IGluIHRyYW5zZm9ybUNhY2hlLiBUaGlzXG4gICAgLy8gaXMgYmVjYXVzZSB3ZSBjcmVhdGUgbWFueSBwcm9taXNlcyBmcm9tIGEgc2luZ2xlIElEQlJlcXVlc3QuXG4gICAgcmV2ZXJzZVRyYW5zZm9ybUNhY2hlLnNldChwcm9taXNlLCByZXF1ZXN0KTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGNhY2hlRG9uZVByb21pc2VGb3JUcmFuc2FjdGlvbih0eCkge1xuICAgIC8vIEVhcmx5IGJhaWwgaWYgd2UndmUgYWxyZWFkeSBjcmVhdGVkIGEgZG9uZSBwcm9taXNlIGZvciB0aGlzIHRyYW5zYWN0aW9uLlxuICAgIGlmICh0cmFuc2FjdGlvbkRvbmVNYXAuaGFzKHR4KSlcbiAgICAgICAgcmV0dXJuO1xuICAgIGNvbnN0IGRvbmUgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVubGlzdGVuID0gKCkgPT4ge1xuICAgICAgICAgICAgdHgucmVtb3ZlRXZlbnRMaXN0ZW5lcignY29tcGxldGUnLCBjb21wbGV0ZSk7XG4gICAgICAgICAgICB0eC5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIGVycm9yKTtcbiAgICAgICAgICAgIHR4LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Fib3J0JywgZXJyb3IpO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBjb21wbGV0ZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIHVubGlzdGVuKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGVycm9yID0gKCkgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KHR4LmVycm9yIHx8IG5ldyBET01FeGNlcHRpb24oJ0Fib3J0RXJyb3InLCAnQWJvcnRFcnJvcicpKTtcbiAgICAgICAgICAgIHVubGlzdGVuKCk7XG4gICAgICAgIH07XG4gICAgICAgIHR4LmFkZEV2ZW50TGlzdGVuZXIoJ2NvbXBsZXRlJywgY29tcGxldGUpO1xuICAgICAgICB0eC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGVycm9yKTtcbiAgICAgICAgdHguYWRkRXZlbnRMaXN0ZW5lcignYWJvcnQnLCBlcnJvcik7XG4gICAgfSk7XG4gICAgLy8gQ2FjaGUgaXQgZm9yIGxhdGVyIHJldHJpZXZhbC5cbiAgICB0cmFuc2FjdGlvbkRvbmVNYXAuc2V0KHR4LCBkb25lKTtcbn1cbmxldCBpZGJQcm94eVRyYXBzID0ge1xuICAgIGdldCh0YXJnZXQsIHByb3AsIHJlY2VpdmVyKSB7XG4gICAgICAgIGlmICh0YXJnZXQgaW5zdGFuY2VvZiBJREJUcmFuc2FjdGlvbikge1xuICAgICAgICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgdHJhbnNhY3Rpb24uZG9uZS5cbiAgICAgICAgICAgIGlmIChwcm9wID09PSAnZG9uZScpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zYWN0aW9uRG9uZU1hcC5nZXQodGFyZ2V0KTtcbiAgICAgICAgICAgIC8vIFBvbHlmaWxsIGZvciBvYmplY3RTdG9yZU5hbWVzIGJlY2F1c2Ugb2YgRWRnZS5cbiAgICAgICAgICAgIGlmIChwcm9wID09PSAnb2JqZWN0U3RvcmVOYW1lcycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGFyZ2V0Lm9iamVjdFN0b3JlTmFtZXMgfHwgdHJhbnNhY3Rpb25TdG9yZU5hbWVzTWFwLmdldCh0YXJnZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gTWFrZSB0eC5zdG9yZSByZXR1cm4gdGhlIG9ubHkgc3RvcmUgaW4gdGhlIHRyYW5zYWN0aW9uLCBvciB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIG1hbnkuXG4gICAgICAgICAgICBpZiAocHJvcCA9PT0gJ3N0b3JlJykge1xuICAgICAgICAgICAgICAgIHJldHVybiByZWNlaXZlci5vYmplY3RTdG9yZU5hbWVzWzFdXG4gICAgICAgICAgICAgICAgICAgID8gdW5kZWZpbmVkXG4gICAgICAgICAgICAgICAgICAgIDogcmVjZWl2ZXIub2JqZWN0U3RvcmUocmVjZWl2ZXIub2JqZWN0U3RvcmVOYW1lc1swXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gRWxzZSB0cmFuc2Zvcm0gd2hhdGV2ZXIgd2UgZ2V0IGJhY2suXG4gICAgICAgIHJldHVybiB3cmFwKHRhcmdldFtwcm9wXSk7XG4gICAgfSxcbiAgICBzZXQodGFyZ2V0LCBwcm9wLCB2YWx1ZSkge1xuICAgICAgICB0YXJnZXRbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgICBoYXModGFyZ2V0LCBwcm9wKSB7XG4gICAgICAgIGlmICh0YXJnZXQgaW5zdGFuY2VvZiBJREJUcmFuc2FjdGlvbiAmJlxuICAgICAgICAgICAgKHByb3AgPT09ICdkb25lJyB8fCBwcm9wID09PSAnc3RvcmUnKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3AgaW4gdGFyZ2V0O1xuICAgIH0sXG59O1xuZnVuY3Rpb24gcmVwbGFjZVRyYXBzKGNhbGxiYWNrKSB7XG4gICAgaWRiUHJveHlUcmFwcyA9IGNhbGxiYWNrKGlkYlByb3h5VHJhcHMpO1xufVxuZnVuY3Rpb24gd3JhcEZ1bmN0aW9uKGZ1bmMpIHtcbiAgICAvLyBEdWUgdG8gZXhwZWN0ZWQgb2JqZWN0IGVxdWFsaXR5ICh3aGljaCBpcyBlbmZvcmNlZCBieSB0aGUgY2FjaGluZyBpbiBgd3JhcGApLCB3ZVxuICAgIC8vIG9ubHkgY3JlYXRlIG9uZSBuZXcgZnVuYyBwZXIgZnVuYy5cbiAgICAvLyBFZGdlIGRvZXNuJ3Qgc3VwcG9ydCBvYmplY3RTdG9yZU5hbWVzIChib29vKSwgc28gd2UgcG9seWZpbGwgaXQgaGVyZS5cbiAgICBpZiAoZnVuYyA9PT0gSURCRGF0YWJhc2UucHJvdG90eXBlLnRyYW5zYWN0aW9uICYmXG4gICAgICAgICEoJ29iamVjdFN0b3JlTmFtZXMnIGluIElEQlRyYW5zYWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChzdG9yZU5hbWVzLCAuLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCB0eCA9IGZ1bmMuY2FsbCh1bndyYXAodGhpcyksIHN0b3JlTmFtZXMsIC4uLmFyZ3MpO1xuICAgICAgICAgICAgdHJhbnNhY3Rpb25TdG9yZU5hbWVzTWFwLnNldCh0eCwgc3RvcmVOYW1lcy5zb3J0ID8gc3RvcmVOYW1lcy5zb3J0KCkgOiBbc3RvcmVOYW1lc10pO1xuICAgICAgICAgICAgcmV0dXJuIHdyYXAodHgpO1xuICAgICAgICB9O1xuICAgIH1cbiAgICAvLyBDdXJzb3IgbWV0aG9kcyBhcmUgc3BlY2lhbCwgYXMgdGhlIGJlaGF2aW91ciBpcyBhIGxpdHRsZSBtb3JlIGRpZmZlcmVudCB0byBzdGFuZGFyZCBJREIuIEluXG4gICAgLy8gSURCLCB5b3UgYWR2YW5jZSB0aGUgY3Vyc29yIGFuZCB3YWl0IGZvciBhIG5ldyAnc3VjY2Vzcycgb24gdGhlIElEQlJlcXVlc3QgdGhhdCBnYXZlIHlvdSB0aGVcbiAgICAvLyBjdXJzb3IuIEl0J3Mga2luZGEgbGlrZSBhIHByb21pc2UgdGhhdCBjYW4gcmVzb2x2ZSB3aXRoIG1hbnkgdmFsdWVzLiBUaGF0IGRvZXNuJ3QgbWFrZSBzZW5zZVxuICAgIC8vIHdpdGggcmVhbCBwcm9taXNlcywgc28gZWFjaCBhZHZhbmNlIG1ldGhvZHMgcmV0dXJucyBhIG5ldyBwcm9taXNlIGZvciB0aGUgY3Vyc29yIG9iamVjdCwgb3JcbiAgICAvLyB1bmRlZmluZWQgaWYgdGhlIGVuZCBvZiB0aGUgY3Vyc29yIGhhcyBiZWVuIHJlYWNoZWQuXG4gICAgaWYgKGdldEN1cnNvckFkdmFuY2VNZXRob2RzKCkuaW5jbHVkZXMoZnVuYykpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgICAgICAvLyBDYWxsaW5nIHRoZSBvcmlnaW5hbCBmdW5jdGlvbiB3aXRoIHRoZSBwcm94eSBhcyAndGhpcycgY2F1c2VzIElMTEVHQUwgSU5WT0NBVElPTiwgc28gd2UgdXNlXG4gICAgICAgICAgICAvLyB0aGUgb3JpZ2luYWwgb2JqZWN0LlxuICAgICAgICAgICAgZnVuYy5hcHBseSh1bndyYXAodGhpcyksIGFyZ3MpO1xuICAgICAgICAgICAgcmV0dXJuIHdyYXAoY3Vyc29yUmVxdWVzdE1hcC5nZXQodGhpcykpO1xuICAgICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gZnVuY3Rpb24gKC4uLmFyZ3MpIHtcbiAgICAgICAgLy8gQ2FsbGluZyB0aGUgb3JpZ2luYWwgZnVuY3Rpb24gd2l0aCB0aGUgcHJveHkgYXMgJ3RoaXMnIGNhdXNlcyBJTExFR0FMIElOVk9DQVRJT04sIHNvIHdlIHVzZVxuICAgICAgICAvLyB0aGUgb3JpZ2luYWwgb2JqZWN0LlxuICAgICAgICByZXR1cm4gd3JhcChmdW5jLmFwcGx5KHVud3JhcCh0aGlzKSwgYXJncykpO1xuICAgIH07XG59XG5mdW5jdGlvbiB0cmFuc2Zvcm1DYWNoYWJsZVZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgcmV0dXJuIHdyYXBGdW5jdGlvbih2YWx1ZSk7XG4gICAgLy8gVGhpcyBkb2Vzbid0IHJldHVybiwgaXQganVzdCBjcmVhdGVzIGEgJ2RvbmUnIHByb21pc2UgZm9yIHRoZSB0cmFuc2FjdGlvbixcbiAgICAvLyB3aGljaCBpcyBsYXRlciByZXR1cm5lZCBmb3IgdHJhbnNhY3Rpb24uZG9uZSAoc2VlIGlkYk9iamVjdEhhbmRsZXIpLlxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIElEQlRyYW5zYWN0aW9uKVxuICAgICAgICBjYWNoZURvbmVQcm9taXNlRm9yVHJhbnNhY3Rpb24odmFsdWUpO1xuICAgIGlmIChpbnN0YW5jZU9mQW55KHZhbHVlLCBnZXRJZGJQcm94eWFibGVUeXBlcygpKSlcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eSh2YWx1ZSwgaWRiUHJveHlUcmFwcyk7XG4gICAgLy8gUmV0dXJuIHRoZSBzYW1lIHZhbHVlIGJhY2sgaWYgd2UncmUgbm90IGdvaW5nIHRvIHRyYW5zZm9ybSBpdC5cbiAgICByZXR1cm4gdmFsdWU7XG59XG5mdW5jdGlvbiB3cmFwKHZhbHVlKSB7XG4gICAgLy8gV2Ugc29tZXRpbWVzIGdlbmVyYXRlIG11bHRpcGxlIHByb21pc2VzIGZyb20gYSBzaW5nbGUgSURCUmVxdWVzdCAoZWcgd2hlbiBjdXJzb3JpbmcpLCBiZWNhdXNlXG4gICAgLy8gSURCIGlzIHdlaXJkIGFuZCBhIHNpbmdsZSBJREJSZXF1ZXN0IGNhbiB5aWVsZCBtYW55IHJlc3BvbnNlcywgc28gdGhlc2UgY2FuJ3QgYmUgY2FjaGVkLlxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIElEQlJlcXVlc3QpXG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KHZhbHVlKTtcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IHRyYW5zZm9ybWVkIHRoaXMgdmFsdWUgYmVmb3JlLCByZXVzZSB0aGUgdHJhbnNmb3JtZWQgdmFsdWUuXG4gICAgLy8gVGhpcyBpcyBmYXN0ZXIsIGJ1dCBpdCBhbHNvIHByb3ZpZGVzIG9iamVjdCBlcXVhbGl0eS5cbiAgICBpZiAodHJhbnNmb3JtQ2FjaGUuaGFzKHZhbHVlKSlcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybUNhY2hlLmdldCh2YWx1ZSk7XG4gICAgY29uc3QgbmV3VmFsdWUgPSB0cmFuc2Zvcm1DYWNoYWJsZVZhbHVlKHZhbHVlKTtcbiAgICAvLyBOb3QgYWxsIHR5cGVzIGFyZSB0cmFuc2Zvcm1lZC5cbiAgICAvLyBUaGVzZSBtYXkgYmUgcHJpbWl0aXZlIHR5cGVzLCBzbyB0aGV5IGNhbid0IGJlIFdlYWtNYXAga2V5cy5cbiAgICBpZiAobmV3VmFsdWUgIT09IHZhbHVlKSB7XG4gICAgICAgIHRyYW5zZm9ybUNhY2hlLnNldCh2YWx1ZSwgbmV3VmFsdWUpO1xuICAgICAgICByZXZlcnNlVHJhbnNmb3JtQ2FjaGUuc2V0KG5ld1ZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiBuZXdWYWx1ZTtcbn1cbmNvbnN0IHVud3JhcCA9ICh2YWx1ZSkgPT4gcmV2ZXJzZVRyYW5zZm9ybUNhY2hlLmdldCh2YWx1ZSk7XG5cbmV4cG9ydHMuaW5zdGFuY2VPZkFueSA9IGluc3RhbmNlT2ZBbnk7XG5leHBvcnRzLnJlcGxhY2VUcmFwcyA9IHJlcGxhY2VUcmFwcztcbmV4cG9ydHMucmV2ZXJzZVRyYW5zZm9ybUNhY2hlID0gcmV2ZXJzZVRyYW5zZm9ybUNhY2hlO1xuZXhwb3J0cy51bndyYXAgPSB1bndyYXA7XG5leHBvcnRzLndyYXAgPSB3cmFwO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuXG52YXIgd3JhcElkYlZhbHVlID0gcmVxdWlyZSgnLi93cmFwLWlkYi12YWx1ZS5qcycpO1xuXG4vKipcbiAqIE9wZW4gYSBkYXRhYmFzZS5cbiAqXG4gKiBAcGFyYW0gbmFtZSBOYW1lIG9mIHRoZSBkYXRhYmFzZS5cbiAqIEBwYXJhbSB2ZXJzaW9uIFNjaGVtYSB2ZXJzaW9uLlxuICogQHBhcmFtIGNhbGxiYWNrcyBBZGRpdGlvbmFsIGNhbGxiYWNrcy5cbiAqL1xuZnVuY3Rpb24gb3BlbkRCKG5hbWUsIHZlcnNpb24sIHsgYmxvY2tlZCwgdXBncmFkZSwgYmxvY2tpbmcsIHRlcm1pbmF0ZWQgfSA9IHt9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGluZGV4ZWREQi5vcGVuKG5hbWUsIHZlcnNpb24pO1xuICAgIGNvbnN0IG9wZW5Qcm9taXNlID0gd3JhcElkYlZhbHVlLndyYXAocmVxdWVzdCk7XG4gICAgaWYgKHVwZ3JhZGUpIHtcbiAgICAgICAgcmVxdWVzdC5hZGRFdmVudExpc3RlbmVyKCd1cGdyYWRlbmVlZGVkJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICB1cGdyYWRlKHdyYXBJZGJWYWx1ZS53cmFwKHJlcXVlc3QucmVzdWx0KSwgZXZlbnQub2xkVmVyc2lvbiwgZXZlbnQubmV3VmVyc2lvbiwgd3JhcElkYlZhbHVlLndyYXAocmVxdWVzdC50cmFuc2FjdGlvbikpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGJsb2NrZWQpXG4gICAgICAgIHJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignYmxvY2tlZCcsICgpID0+IGJsb2NrZWQoKSk7XG4gICAgb3BlblByb21pc2VcbiAgICAgICAgLnRoZW4oKGRiKSA9PiB7XG4gICAgICAgIGlmICh0ZXJtaW5hdGVkKVxuICAgICAgICAgICAgZGIuYWRkRXZlbnRMaXN0ZW5lcignY2xvc2UnLCAoKSA9PiB0ZXJtaW5hdGVkKCkpO1xuICAgICAgICBpZiAoYmxvY2tpbmcpXG4gICAgICAgICAgICBkYi5hZGRFdmVudExpc3RlbmVyKCd2ZXJzaW9uY2hhbmdlJywgKCkgPT4gYmxvY2tpbmcoKSk7XG4gICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHsgfSk7XG4gICAgcmV0dXJuIG9wZW5Qcm9taXNlO1xufVxuLyoqXG4gKiBEZWxldGUgYSBkYXRhYmFzZS5cbiAqXG4gKiBAcGFyYW0gbmFtZSBOYW1lIG9mIHRoZSBkYXRhYmFzZS5cbiAqL1xuZnVuY3Rpb24gZGVsZXRlREIobmFtZSwgeyBibG9ja2VkIH0gPSB7fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBpbmRleGVkREIuZGVsZXRlRGF0YWJhc2UobmFtZSk7XG4gICAgaWYgKGJsb2NrZWQpXG4gICAgICAgIHJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcignYmxvY2tlZCcsICgpID0+IGJsb2NrZWQoKSk7XG4gICAgcmV0dXJuIHdyYXBJZGJWYWx1ZS53cmFwKHJlcXVlc3QpLnRoZW4oKCkgPT4gdW5kZWZpbmVkKTtcbn1cblxuY29uc3QgcmVhZE1ldGhvZHMgPSBbJ2dldCcsICdnZXRLZXknLCAnZ2V0QWxsJywgJ2dldEFsbEtleXMnLCAnY291bnQnXTtcbmNvbnN0IHdyaXRlTWV0aG9kcyA9IFsncHV0JywgJ2FkZCcsICdkZWxldGUnLCAnY2xlYXInXTtcbmNvbnN0IGNhY2hlZE1ldGhvZHMgPSBuZXcgTWFwKCk7XG5mdW5jdGlvbiBnZXRNZXRob2QodGFyZ2V0LCBwcm9wKSB7XG4gICAgaWYgKCEodGFyZ2V0IGluc3RhbmNlb2YgSURCRGF0YWJhc2UgJiZcbiAgICAgICAgIShwcm9wIGluIHRhcmdldCkgJiZcbiAgICAgICAgdHlwZW9mIHByb3AgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChjYWNoZWRNZXRob2RzLmdldChwcm9wKSlcbiAgICAgICAgcmV0dXJuIGNhY2hlZE1ldGhvZHMuZ2V0KHByb3ApO1xuICAgIGNvbnN0IHRhcmdldEZ1bmNOYW1lID0gcHJvcC5yZXBsYWNlKC9Gcm9tSW5kZXgkLywgJycpO1xuICAgIGNvbnN0IHVzZUluZGV4ID0gcHJvcCAhPT0gdGFyZ2V0RnVuY05hbWU7XG4gICAgY29uc3QgaXNXcml0ZSA9IHdyaXRlTWV0aG9kcy5pbmNsdWRlcyh0YXJnZXRGdW5jTmFtZSk7XG4gICAgaWYgKFxuICAgIC8vIEJhaWwgaWYgdGhlIHRhcmdldCBkb2Vzbid0IGV4aXN0IG9uIHRoZSB0YXJnZXQuIEVnLCBnZXRBbGwgaXNuJ3QgaW4gRWRnZS5cbiAgICAhKHRhcmdldEZ1bmNOYW1lIGluICh1c2VJbmRleCA/IElEQkluZGV4IDogSURCT2JqZWN0U3RvcmUpLnByb3RvdHlwZSkgfHxcbiAgICAgICAgIShpc1dyaXRlIHx8IHJlYWRNZXRob2RzLmluY2x1ZGVzKHRhcmdldEZ1bmNOYW1lKSkpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSBhc3luYyBmdW5jdGlvbiAoc3RvcmVOYW1lLCAuLi5hcmdzKSB7XG4gICAgICAgIC8vIGlzV3JpdGUgPyAncmVhZHdyaXRlJyA6IHVuZGVmaW5lZCBnemlwcHMgYmV0dGVyLCBidXQgZmFpbHMgaW4gRWRnZSA6KFxuICAgICAgICBjb25zdCB0eCA9IHRoaXMudHJhbnNhY3Rpb24oc3RvcmVOYW1lLCBpc1dyaXRlID8gJ3JlYWR3cml0ZScgOiAncmVhZG9ubHknKTtcbiAgICAgICAgbGV0IHRhcmdldCA9IHR4LnN0b3JlO1xuICAgICAgICBpZiAodXNlSW5kZXgpXG4gICAgICAgICAgICB0YXJnZXQgPSB0YXJnZXQuaW5kZXgoYXJncy5zaGlmdCgpKTtcbiAgICAgICAgLy8gTXVzdCByZWplY3QgaWYgb3AgcmVqZWN0cy5cbiAgICAgICAgLy8gSWYgaXQncyBhIHdyaXRlIG9wZXJhdGlvbiwgbXVzdCByZWplY3QgaWYgdHguZG9uZSByZWplY3RzLlxuICAgICAgICAvLyBNdXN0IHJlamVjdCB3aXRoIG9wIHJlamVjdGlvbiBmaXJzdC5cbiAgICAgICAgLy8gTXVzdCByZXNvbHZlIHdpdGggb3AgdmFsdWUuXG4gICAgICAgIC8vIE11c3QgaGFuZGxlIGJvdGggcHJvbWlzZXMgKG5vIHVuaGFuZGxlZCByZWplY3Rpb25zKVxuICAgICAgICByZXR1cm4gKGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgIHRhcmdldFt0YXJnZXRGdW5jTmFtZV0oLi4uYXJncyksXG4gICAgICAgICAgICBpc1dyaXRlICYmIHR4LmRvbmUsXG4gICAgICAgIF0pKVswXTtcbiAgICB9O1xuICAgIGNhY2hlZE1ldGhvZHMuc2V0KHByb3AsIG1ldGhvZCk7XG4gICAgcmV0dXJuIG1ldGhvZDtcbn1cbndyYXBJZGJWYWx1ZS5yZXBsYWNlVHJhcHMoKG9sZFRyYXBzKSA9PiAoe1xuICAgIC4uLm9sZFRyYXBzLFxuICAgIGdldDogKHRhcmdldCwgcHJvcCwgcmVjZWl2ZXIpID0+IGdldE1ldGhvZCh0YXJnZXQsIHByb3ApIHx8IG9sZFRyYXBzLmdldCh0YXJnZXQsIHByb3AsIHJlY2VpdmVyKSxcbiAgICBoYXM6ICh0YXJnZXQsIHByb3ApID0+ICEhZ2V0TWV0aG9kKHRhcmdldCwgcHJvcCkgfHwgb2xkVHJhcHMuaGFzKHRhcmdldCwgcHJvcCksXG59KSk7XG5cbmV4cG9ydHMudW53cmFwID0gd3JhcElkYlZhbHVlLnVud3JhcDtcbmV4cG9ydHMud3JhcCA9IHdyYXBJZGJWYWx1ZS53cmFwO1xuZXhwb3J0cy5kZWxldGVEQiA9IGRlbGV0ZURCO1xuZXhwb3J0cy5vcGVuREIgPSBvcGVuREI7XG4iXX0=
