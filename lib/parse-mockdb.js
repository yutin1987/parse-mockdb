'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _parseShim = require('parse-shim');

var _parseShim2 = _interopRequireDefault(_parseShim);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _utils = require('./utils');

var _opHandler = require('./op-handler');

var _opHandler2 = _interopRequireDefault(_opHandler);

var DEFAULT_LIMIT = 100;
var HARD_LIMIT = 1000;
var MAX_SKIP = 10000;
var QUOTE_REGEXP = /(\\Q|\\E)/g;

var CONFIG = {
  DEBUG: process.env.DEBUG_ALL,
  DEBUG_DB: process.env.DEBUG_DB,
  DEBUG_HOOK: process.env.DEBUG_HOOK
};

var HANDLERS = {
  GET: handleGetRequest,
  POST: handlePostRequest,
  PUT: handlePutRequest,
  DELETE: handleDeleteRequest,
  LOGIN: handleLoginRequest,
  RUN: handleRunRequest
};

var db = {};
var define = {};
var currentUser = null;
var hooks = {
  beforeSave: {},
  afterSave: {},
  beforeDelete: {},
  afterDelete: {}
};
var _enableHook = true;

var defaultController = null;
var mocked = false;

/**
 * Mocks a Parse API server, by intercepting requests and storing/querying data locally
 * in an in-memory DB.
 */
function mockDB() {
  if (!mocked) {
    defaultController = _parseShim2['default'].CoreManager.getRESTController();
    mocked = true;
    _parseShim2['default'].CoreManager.setRESTController(MockRESTController);
  }
}

/**
 * Restores the original RESTController.
 */
function unMockDB() {
  if (mocked) {
    _parseShim2['default'].CoreManager.setRESTController(defaultController);
    mocked = false;
  }
}

function debugPrint(prefix, object) {
  if (CONFIG.DEBUG || CONFIG.DEBUG_DB) console.log('[' + prefix + ']', JSON.stringify(object, null, 4));
}

function debugHookPrint(prefix, object) {
  if (CONFIG.DEBUG || CONFIG.DEBUG_HOOK) console.log('[' + prefix + ']', JSON.stringify(object, null, 4));
}

function getCollection(collection) {
  if (!db[collection]) {
    db[collection] = {};
  }
  return db[collection];
}

var MockRESTController = {
  request: function request(method, path, data, options) {
    var result;
    if (path === "batch") {
      debugPrint('BATCH', { method: method, path: path, data: data, options: options });
      result = handleBatchRequest(method, path, data, options);
    } else {
      debugPrint('REQUEST', { method: method, path: path, data: data, options: options });
      result = handleRequest(method, path, data, options);
    }

    // Status of database after handling request above
    debugPrint('DB', db);

    return result.then(function (result) {
      debugPrint('RESPONSE', result.response);
      return _parseShim2['default'].Promise.when([result.response, result.status]);
    }, function (error) {
      return _parseShim2['default'].Promise.error({ error: 400, message: error });
    });
  },
  ajax: function ajax() {
    /* no-op */
  }
};

/**
 * Batch requests have the following form: {
 *  requests: [
 *      { method, path, body },
 *   ]
 * }
 */
function handleBatchRequest(method, path, data) {
  var requests = data.requests;
  var getResults = requests.map(function (request) {
    var method = request.method;
    var path = request.path;
    var body = request.body;
    return handleRequest(method, path, body).then(function (result) {
      return _parseShim2['default'].Promise.as({ success: result.response });
    });
  });

  return _parseShim2['default'].Promise.when(getResults).then(function () {
    return respond(200, arguments);
  });
}

// Batch requests have the API version included in path
function normalizePath(path) {
  return path.replace('/1/', '');
}

function handleRequest(method, path, body, options) {
  var explodedPath = normalizePath(path).split('/');

  Object.keys(body || {}).map(function (key) {
    var value = body[key];

    if ((0, _utils.isDate)(value)) body[key] = new Date(value.iso);else if ((0, _utils.isPointer)(value)) body[key] = _parseShim2['default'].Object.fromJSON(value);
  });

  var request;
  switch (explodedPath[0]) {
    case 'login':
      request = {
        method: 'LOGIN',
        className: '_User',
        data: body
      };
      break;
    case 'users':
      request = {
        method: method,
        className: '_User',
        data: body,
        user: currentUser,
        objectId: explodedPath[1],
        master: options && options.useMasterKey ? true : false
      };
      break;
    case 'functions':
      request = {
        method: 'RUN',
        functions: explodedPath[1],
        data: body,
        user: currentUser,
        master: options && options.useMasterKey ? true : false
      };
      break;
    case 'classes':
    default:
      {
        request = {
          method: method,
          className: explodedPath[1],
          data: body,
          user: currentUser,
          objectId: explodedPath[2],
          master: options && options.useMasterKey ? true : false
        };
      }
  }

  return HANDLERS[request.method](request);
}

function respond(status, response) {
  return {
    status: status,
    response: response
  };
}

/**
 * Login
 */
function handleLoginRequest(request) {
  return HANDLERS['GET']({
    method: 'GET',
    className: '_User',
    data: { where: request.data }
  }).then(function (reply) {
    if (reply.response.results.length === 1) {
      delete reply.response.results[0].password;
      currentUser = Object.assign({}, reply.response.results[0], { className: '_User' });
      return respond(200, reply.response.results[0]);
    } else {
      return _parseShim2['default'].Promise.error('username or passowrd is invalid');
    }
  });
}

/**
 * Functions
 */
function handleRunRequest(request) {
  var promise = new _parseShim2['default'].Promise();

  define[request.functions]({
    user: request.user || undefined,
    master: !!request.master,
    params: request.data
  }, {
    success: function success(result) {
      return promise.resolve(result);
    },
    error: function error(_error) {
      return promise.reject(_error);
    }
  });

  return promise.then(function (result) {
    return respond(200, { result: result });
  });
}

/**
 * Handles a GET request (Parse.Query.find(), get(), first(), Parse.Object.fetch())
 */
function handleGetRequest(request) {
  var objId = request.objectId;
  if (objId) {
    // Object.fetch() query
    var collection = getCollection(request.className);
    var match = _lodash2['default'].cloneDeep(collection[objId]);
    return _parseShim2['default'].Promise.as(respond(200, match));
  }

  var matches = recursivelyMatch(request.className, request.data.where);

  if (request.data.count) {
    return _parseShim2['default'].Promise.as(respond(200, { count: matches.length }));
  }

  matches = queryMatchesAfterIncluding(matches, request.data.include);

  var limit = request.data.limit || DEFAULT_LIMIT;
  var startIndex = request.data.skip || 0;
  var endIndex = startIndex + limit;
  var response = { results: matches.slice(startIndex, endIndex) };
  return _parseShim2['default'].Promise.as(respond(200, response));
}

/**
 * Handles a POST request (Parse.Object.save())
 */
function handlePostRequest(request) {
  var promise = new _parseShim2['default'].Promise();

  var className = request.className;
  var data = request.data;

  var collection = getCollection(className);
  var object = new _parseShim2['default'].Object(className);
  object.set(data);

  if (_enableHook && hooks.beforeSave[className]) {
    debugHookPrint('POST', 'Call ' + className + ' beforeSave');
    hooks.beforeSave[className]({
      user: request.user || undefined,
      master: !!request.master,
      object: object
    }, {
      success: function success(result) {
        return promise.resolve(result);
      },
      error: function error(_error2) {
        return promise.reject(_error2);
      }
    });
  } else {
    debugHookPrint('POST', 'No call ' + className + ' beforeSave, ' + (_enableHook ? 'without a hook set' : 'disable'));
    promise.resolve();
  }

  return promise.then(function () {
    var collection = getCollection(className);
    var newId = _lodash2['default'].uniqueId();

    var result = Object.assign(object.toJSON(), { objectId: newId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    for (var key in result) {
      var value = result[key];

      if ((0, _utils.isOp)(value)) {
        var operator = value["__op"];
        if (operator in _opHandler2['default']) {
          delete result[key];
          _opHandler2['default'][operator](result, key, value, {});
        }
      }
    }

    collection[newId] = result;

    var response = Object.assign(_lodash2['default'].cloneDeep(_lodash2['default'].omit(result, 'updatedAt')), { createdAt: result.createdAt });

    if (_enableHook && hooks.afterSave[className]) {
      debugHookPrint('POST', 'Call ' + className + ' afterSave');
      var savedObject = _parseShim2['default'].Object.fromJSON(Object.assign({}, result, { className: className }));

      hooks.afterSave[className]({
        user: request.user || undefined,
        master: !!request.master,
        object: savedObject
      });
    } else {
      debugHookPrint('POST', 'No call ' + className + ' afterSave, ' + (_enableHook ? 'without a hook set' : 'disable'));
    }

    return respond(201, response);
  });
}

function handlePutRequest(request) {
  var className = request.className;
  var data = request.data;
  var objectId = request.objectId;

  var collection = getCollection(className);
  var currentObject = _lodash2['default'].cloneDeep(collection[objectId]);

  var object = _parseShim2['default'].Object.fromJSON(Object.assign({}, currentObject, { className: className }));
  object.set(data);

  var promise = new _parseShim2['default'].Promise();

  if (_enableHook && hooks.beforeSave[request.className]) {
    debugHookPrint('PUT', 'Call ' + className + ' beforeSave');
    hooks.beforeSave[request.className]({
      user: currentUser || undefined,
      master: !!request.master,
      object: object
    }, {
      success: function success(result) {
        return promise.resolve(result);
      },
      error: function error(_error3) {
        return promise.reject(_error3);
      }
    });
  } else {
    debugHookPrint('PUT', 'No call ' + className + ' beforeSave, ' + (_enableHook ? 'without a hook set' : 'disable'));
    promise.resolve();
  }

  return promise.then(function () {
    var result = Object.assign(object.toJSON(), { updatedAt: new Date().toISOString() });

    for (var key in result) {
      var value = result[key];

      if ((0, _utils.isOp)(value)) {
        var operator = value["__op"];
        if (operator in _opHandler2['default']) {
          delete result[key];
          _opHandler2['default'][operator](result, key, value, currentObject || {});
        }
      }
    }

    collection[request.objectId] = result;

    if (_enableHook && hooks.afterSave[request.className]) {
      debugHookPrint('PUT', 'Call ' + className + ' afterSave');
      var savedObject = _parseShim2['default'].Object.fromJSON(Object.assign({}, result, { className: className }));

      hooks.afterSave[request.className]({
        user: currentUser || undefined,
        master: !!request.master,
        object: savedObject
      });
    } else {
      debugHookPrint('PUT', 'No call ' + className + ' afterSave, ' + (_enableHook ? 'without a hook set' : 'disable'));
    }

    var response = Object.assign(_lodash2['default'].cloneDeep(_lodash2['default'].omit(result, ['createdAt', 'objectId'])), { updatedAt: result.updatedAt });

    return respond(201, response);
  });
}

function handleDeleteRequest(request) {
  var collection = getCollection(request.className);

  var object = new _parseShim2['default'].Object(request.className);
  object.set(collection[request.objectId]);

  var promise = new _parseShim2['default'].Promise();

  if (_enableHook && hooks.beforeDelete[request.className]) {
    hooks.beforeDelete[request.className]({
      user: currentUser,
      master: !!request.master,
      object: object
    }, {
      success: function success(result) {
        return promise.resolve(result);
      },
      error: function error(_error4) {
        return promise.reject(_error4);
      }
    });
  } else {
    promise.resolve();
  }

  return promise.then(function () {
    delete collection[request.objectId];

    if (_enableHook && hooks.afterDelete[request.className]) {
      hooks.afterDelete[request.className]({
        user: currentUser,
        master: !!request.master,
        object: object
      });
    }

    return respond(201, {});
  });
}

function makePointer(className, id) {
  return {
    __type: "Pointer",
    className: className,
    objectId: id
  };
}

/**
 * Given a set of matches of a GET query (e.g. find()), returns fully
 * fetched Parse Objects that include the nested objects requested by
 * Parse.Query.include()
 */
function queryMatchesAfterIncluding(matches, includeClause) {
  if (!includeClause) {
    return matches;
  }

  var includeClauses = includeClause.split(",");
  matches = _lodash2['default'].map(matches, function (match) {
    for (var i = 0; i < includeClauses.length; i++) {
      var paths = includeClauses[i].split(".");
      match = includePaths(match, paths);
    }
    return match;
  });

  return matches;
}

/**
 * Recursive function that traverses an include path and replaces pointers
 * with fully fetched objects
 */
function includePaths(object, pathsRemaining) {
  debugPrint('INCLUDE', { object: object, pathsRemaining: pathsRemaining });
  var path = pathsRemaining.shift();
  var target = object[path];

  if (target) {
    if (Array.isArray(target)) {
      object[path] = target.map(function (pointer) {
        var fetched = fetchObjectByPointer(pointer);
        includePaths(fetched, _lodash2['default'].cloneDeep(pathsRemaining));
        return fetched;
      });
    } else {
      object[path] = fetchObjectByPointer(target);
      includePaths(object[path], pathsRemaining);
    }
  }

  return object;
};

/**
 * Given an object, a pointer, or a JSON representation of a Parse Object,
 * return a fully fetched version of the Object.
 */
function fetchObjectByPointer(pointer) {
  var collection = getCollection(pointer.className);
  var storedItem = collection[pointer.objectId];
  return Object.assign({ __type: "Object", className: pointer.className }, _lodash2['default'].cloneDeep(storedItem));
}

/**
 * Given a class name and a where clause, returns DB matches by applying
 * the where clause (recursively if nested)
 */
function recursivelyMatch(className, whereClause) {
  debugPrint('MATCH', { className: className, whereClause: whereClause });
  var collection = getCollection(className);
  var matches = _lodash2['default'].filter(_lodash2['default'].values(collection), queryFilter(whereClause));
  debugPrint('MATCHES', { matches: matches });
  return _lodash2['default'].cloneDeep(matches); // return copies instead of originals
}

/**
 * Returns a function that filters query matches on a where clause
 */
function queryFilter(whereClause) {
  if (whereClause["$or"]) {
    return function (object) {
      return _lodash2['default'].reduce(whereClause["$or"], function (result, subclause) {
        return result || queryFilter(subclause)(object);
      }, false);
    };
  }

  return function (object) {
    if (whereClause.objectId && typeof whereClause.objectId !== "object") {
      // this is a get() request. simply match on ID
      if (object.objectId === whereClause.objectId && whereClause.$relatedTo) {
        return QUERY_OPERATORS['$relatedTo'].apply(object.objectId, [whereClause.$relatedTo]);
      } else if (object.objectId === whereClause.objectId) {
        return true;
      } else {
        return false;
      }
    }

    // Go through each key in where clause
    return _lodash2['default'].reduce(whereClause, function (result, whereParams, key) {
      var match = evaluateObject(object, whereParams, key);
      return result && match;
    }, true);
  };
}

// Note: does not support nested (dotted) attributes at this time
function evaluateObject(object, whereParams, key) {
  if (typeof whereParams === "object") {
    // Handle objects that actually represent scalar values
    if ((0, _utils.isPointer)(whereParams) || (0, _utils.isDate)(whereParams)) {
      return QUERY_OPERATORS['$eq'].apply(object[key], [whereParams]);
    }

    if (key === '$relatedTo' && (0, _utils.isPointer)(whereParams.object)) {
      return QUERY_OPERATORS['$relatedTo'].apply(object.objectId, [whereParams]);
    }

    // Process each key in where clause to determine if we have a match
    return _lodash2['default'].reduce(whereParams, function (matches, value, constraint) {
      var keyValue = deserializeQueryParam(object[key]);
      var param = deserializeQueryParam(value);

      // Constraint can take the form form of a query operator OR an equality match
      if (constraint in QUERY_OPERATORS) {
        // { age: {$lt: 30} }
        return matches && QUERY_OPERATORS[constraint].apply(keyValue, [param]);
      } else {
        // { age: 30 }
        return matches && QUERY_OPERATORS['$eq'].apply(keyValue[constraint], [param]);
      }
    }, true);
  }

  return QUERY_OPERATORS['$eq'].apply(object[key], [whereParams]);
}

/**
 * Operator functions assume binding to **value** on which query operator is to be applied.
 *
 * Params:
 *    value - operator value, i.e. the number 30 in `age: {$lt: 30}`
 */
var QUERY_OPERATORS = {
  '$exists': function $exists(value) {
    return !!this === value;
  },
  '$in': function $in(values) {
    return _lodash2['default'].any(values, function (value) {
      return objectsAreEqual(this, value);
    }, this);
  },
  '$nin': function $nin(values) {
    return _lodash2['default'].all(values, function (value) {
      return !objectsAreEqual(this, value);
    }, this);
  },
  '$eq': function $eq(value) {
    return objectsAreEqual(this, value);
  },
  '$ne': function $ne(value) {
    return !objectsAreEqual(this, value);
  },
  '$lt': function $lt(value) {
    return this < value;
  },
  '$lte': function $lte(value) {
    return this <= value;
  },
  '$gt': function $gt(value) {
    return this > value;
  },
  '$gte': function $gte(value) {
    return this >= value;
  },
  '$regex': function $regex(value) {
    var regex = _lodash2['default'].clone(value).replace(QUOTE_REGEXP, "");
    return new RegExp(regex).test(this);
  },
  '$select': function $select(value) {
    var _this = this;

    var foreignKey = value.key;
    var query = value.query;
    var matches = recursivelyMatch(query.className, query.where);
    var objectMatches = _lodash2['default'].filter(matches, function (match) {
      return match[foreignKey] == _this;
    });
    return objectMatches.length;
  },
  '$inQuery': function $inQuery(query) {
    var matches = recursivelyMatch(query.className, query.where);
    return _lodash2['default'].find(matches, function (match) {
      return this && match.objectId === this.objectId;
    }, this);
  },
  '$all': function $all(value) {
    return _lodash2['default'].every(value, function (obj1) {
      return _lodash2['default'].some(this, function (obj2) {
        return objectsAreEqual(obj1, obj2);
      }, this);
    }, this);
  },
  '$relatedTo': function $relatedTo(value) {
    var relatedObj = fetchObjectByPointer(value.object);
    var ids = relatedObj[value.key] && relatedObj[value.key].ids || [];
    return ids.indexOf(this) > -1;
  }
};

/**
 * Deserializes an encoded query parameter if necessary
 */
function deserializeQueryParam(param) {
  if (typeof param === "object") {
    if (param.__type === "Date") {
      return new Date(param.iso);
    }
  }
  return param;
};

/**
 * Evaluates whether 2 objects are the same, independent of their representation
 * (e.g. Pointer, Object)
 */
function objectsAreEqual(obj1, obj2) {
  if (obj1 === undefined || obj2 === undefined) {
    return false;
  }

  // scalar values
  if (obj1 == obj2) {
    return true;
  }

  // objects with ids
  if (obj1.id !== undefined && obj1.id == obj2.id) {
    return true;
  }

  // relation
  if (obj1.__type === 'Relation' && obj1.ids !== undefined && obj1.ids.indexOf(obj2.id || obj2.objectId) > -1) {
    return true;
  }

  // objects
  if (_lodash2['default'].isEqual(obj1, obj2)) {
    return true;
  }

  // both pointers
  if (obj1.objectId !== undefined && obj1.objectId == obj2.objectId) {
    return true;
  }

  // both dates
  if ((0, _utils.isDate)(obj1) && (0, _utils.isDate)(obj2)) {
    return deserializeQueryParam(obj1) === deserializeQueryParam(obj2);
  }

  // one pointer, one object
  if (obj1.id !== undefined && obj1.id == obj2.objectId) {
    return true;
  } else if (obj2.id !== undefined && obj2.id == obj1.objectId) {
    return true;
  }

  return false;
}

// **HACK** Makes testing easier.
function promiseResultSync(promise) {
  var result;
  promise.then(function (res) {
    result = res;
  });
  return result;
}

function setUser(user) {}

if (_parseShim2['default'].Cloud) {
  _parseShim2['default'].Cloud.define = function (name, handler) {
    return define[name] = handler;
  };
  _parseShim2['default'].Cloud.beforeSave = function (name, handler) {
    return hooks.beforeSave[name] = handler;
  };
  _parseShim2['default'].Cloud.afterSave = function (name, handler) {
    return hooks.afterSave[name] = handler;
  };
  _parseShim2['default'].Cloud.beforeDelete = function (name, handler) {
    return hooks.beforeDelete[name] = handler;
  };
  _parseShim2['default'].Cloud.afterDelete = function (name, handler) {
    return hooks.afterDelete[name] = handler;
  };
}

_parseShim2['default'].MockDB = {
  mockDB: mockDB,
  unMockDB: unMockDB,
  cleanUp: function cleanUp(all) {
    db = {};
    currentUser = null;

    if (all) {
      define = {};
      hooks = {
        beforeSave: {},
        afterSave: {},
        beforeDelete: {},
        afterDelete: {}
      };
    }
  },
  setUser: function setUser(user) {
    return currentUser = user;
  },
  enableHook: function enableHook() {
    return _enableHook = true;
  },
  disableHook: function disableHook() {
    return _enableHook = false;
  },
  promiseResultSync: promiseResultSync
};

module.exports = _parseShim2['default'].MockDB;