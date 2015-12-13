'use strict';

const Parse = require('parse-shim');
const _ = require('lodash');

const DEFAULT_LIMIT = 100;
const HARD_LIMIT = 1000;
const MAX_SKIP = 10000;
const QUOTE_REGEXP = /(\\Q|\\E)/g;

const CONFIG = {
  DEBUG: process.env.DEBUG_DB
}

const HANDLERS = {
  GET: handleGetRequest,
  POST: handlePostRequest,
  PUT: handlePutRequest,
  DELETE: handleDeleteRequest,
}

var db = {};
var hooks = {};

var default_controller = null;
var mocked = false;

/**
 * Mocks a Parse API server, by intercepting requests and storing/querying data locally
 * in an in-memory DB.
 */
function mockDB() {
  if (!mocked) {
    default_controller = Parse.CoreManager.getRESTController();
    mocked = true;
    Parse.CoreManager.setRESTController(MockRESTController);
  }
}

/**
 * Restores the original RESTController.
 */
function unMockDB() {
  if (mocked) {
    Parse.CoreManager.setRESTController(default_controller);
    mocked = false;
  }
}

/**
 * Clears the MockDB and any registered hooks.
 */
function cleanUp() {
  db = {};
  hooks = {};
}

/**
 * Registers a hook to on a class denoted by className.
 *
 * @param {string} className The name of the class to register hook on.
 * @param {string} hookType One of 'beforeSave', 'afterSave', 'beforeDelete', 'afterDelete'
 * @param {function} hookFn Function that will be called with `this` bound to hydrated model.
 *                          Must return a promise.
 *
 * @note Only supports beforeSave at the moment.
 */
function registerHook(className, hookType, hookFn) {
  if (!hooks[className]) {
    hooks[className] = {};
  }

  hooks[className][hookType] = hookFn;
};

/**
 * Retrieves a previously registered hook.
 *
 * @param {string} className The name of the class to get the hook on.
 * @param {string} hookType One of 'beforeSave', 'afterSave', 'beforeDelete', 'afterDelete'
 */
function getHook(className, hookType) {
  if (hooks[className] && hooks[className][hookType]) {
    return hooks[className][hookType];
  }
}

/**
 * Executes a registered hook with data provided.
 *
 * Hydrates the data into an instance of the class named by `className` param and binds it to the
 * function to be run.
 *
 * @param {string} className The name of the class to get the hook on.
 * @param {string} hookType One of 'beforeSave', 'afterSave', 'beforeDelete', 'afterDelete'
 * @param {Object} data The Data that is to be hydrated into an instance of className class.
 */
function runHook(className, hookType, data) {
  const hook = getHook(className, hookType);
  if (hook) {
    const modelData = Object.assign(new Object, data, {className});
    const model = Parse.Object.fromJSON(modelData);

    // TODO Stub out Parse.Cloud.useMasterKey() so that we can report the correct 'master'
    // value here.
    var beforeSaveOrBeforeDeleteRequestObject = {
      installationId: 'parse-mockdb',
      master: false,
      object: model,
      user: "ParseMockDB doesn't define request.user."
    };

    return hook(beforeSaveOrBeforeDeleteRequestObject).done((beforeSaveOverrideValue) => {
      debugPrint('HOOK', { beforeSaveOverrideValue });

      // Unlike BeforeDeleteResponse, BeforeSaveResponse might specify
      var objectToProceedWith =  hookType === 'beforeSave' && beforeSaveOverrideValue
        ? _.cloneDeep(beforeSaveOverrideValue.toJSON())
        : model;

      return Parse.Promise.as(_.omit(objectToProceedWith, "ACL"));
    });
  }
  return Parse.Promise.as(data);
}

// Destructive. Takes data for update operation and removes all atomic operations.
// Returns the extracted ops.
function extractOps(data) {
  var ops = new Object();

  for (var key in data) {
    var attribute = data[key];
    if (isOp(attribute)) {
      ops[key] = attribute;
      delete data[key];
    }
  }

  return ops;
}

// Destructive. Applys all the update `ops` to `data`.
// Throws on unknown update operator.
function applyOps(data, ops) {
  debugPrint('OPS', ops);
  for (var key in ops) {
    const value = ops[key];
    const operator = value["__op"];

    if (operator in UPDATE_OPERATORS) {
      UPDATE_OPERATORS[operator].bind(data)(key, value)
    } else {
      throw new Error("Unknown update operator:" + key);
    }
  }
}

// Ensures `object` has an array at `key`. Creates array if `key` doesn't exist.
// Will throw if value for `key` exists and is not Array.
function ensureArray(object, key) {
  if (!object[key]) {
    object[key] = new Array();
  }
  if (!Array.isArray(object[key])) {
    throw new Error("Can't perform array operaton on non-array field");
  }
}

/**
 * Operator functions assume binding to **object** on which update operator is to be applied.
 *
 * Params:
 *    key   - value to be modified in bound object.
 *    value - operator value, i.e. `{__op: "Increment", amount: 1}`
 */
const UPDATE_OPERATORS = {
  Increment: function(key, value) {
    this[key] += value.amount;
  },
  Add: function(key, value) {
    ensureArray(this, key);
    value.objects.forEach(object => {
      this[key].push(object);
    })
  },
  AddUnique: function(key, value) {
    ensureArray(this, key);
    var array = this[key];
    value.objects.forEach(object => {
      if (array.indexOf(value) === -1) {
        array.push(object);
      }
    });
  },
  Remove: function(key, value) {
    ensureArray(this, key);
    var array = this[key];
    value.objects.forEach(object => {
      this[key] = _.reject(array, item => { return item === object });
    });
  },
  Delete: function(key, value) {
    delete this[key];
  },
  Batch: function(key, value) {
    const addRelation = value.ops.filter(op => op.__op === 'AddRelation')[0];
    UPDATE_OPERATORS.AddRelation.bind(this)(key, addRelation)

    const removeRelation = value.ops.filter(op => op.__op === 'RemoveRelation')[0];
    UPDATE_OPERATORS.RemoveRelation.bind(this)(key, removeRelation)
  },
  AddRelation: function(key, value) {
    if (!this[key]) {
      this[key] = { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(obj => {
      const idx = this[key].ids.indexOf(obj.objectId);
      if (idx < 0) this[key].ids.push(obj.objectId);
    });

    this[key].ids = this[key].ids.sort();
  },
  RemoveRelation: function(key, value) {
    if (!this[key]) {
      this[key] = { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(obj => {
      const idx = this[key].ids.indexOf(obj.objectId);
      if (idx > -1) this[key].ids.splice(idx, 1);
    });
  }
}

function debugPrint(prefix, object) {
  if (CONFIG.DEBUG) {
    console.log('[' + prefix + ']', JSON.stringify(object, null, 4));
  }
}

function getCollection(collection) {
  if (!db[collection]) {
    db[collection] = {}
  }
  return db[collection];
}

var MockRESTController = {
  request: function(method, path, data, options) {
    var result;
    if (path === "batch") {
      debugPrint('BATCH', {method, path, data, options});
      result = handleBatchRequest(method, path, data);
    } else {
      debugPrint('REQUEST', {method, path, data, options});
      result = handleRequest(method, path, data);
    }

    // Status of database after handling request above
    debugPrint('DB', db);

    return result.then(function(result) {
      debugPrint('RESPONSE', result.response);
      return Parse.Promise.when([
        result.response,
        result.status,
      ]);
    });
  },
  ajax: function() {
    /* no-op */
  }
}

/**
 * Batch requests have the following form: {
 *  requests: [
 *      { method, path, body },
 *   ]
 * }
 */
function handleBatchRequest(method, path, data) {
  const requests = data.requests;
  const getResults = requests.map(request => {
    var method = request.method;
    var path = request.path;
    var body = request.body;
    return handleRequest(method, path, body).then(result => {
      return Parse.Promise.as({ success: result.response });
    })
  })

  return Parse.Promise.when(getResults).then(function() {
    return respond(200, arguments);
  })
}

// Batch requests have the API version included in path
function normalizePath(path) {
  return path.replace('/1/', '');
}

function handleRequest(method, path, body) {
  var explodedPath = normalizePath(path).split('/');

  var request;

  switch(explodedPath[0]) {
    case 'users': {
      request = {
        method: method,
        className: '_User',
        data: body,
        objectId: explodedPath[1],
      };
      break;
    }
    case 'classes':
    default: {
      request = {
        method: method,
        className: explodedPath[1],
        data: body,
        objectId: explodedPath[2],
      };
    }
  }

  return HANDLERS[method](request);
}

function respond(status, response) {
  return {
    status: status,
    response: response
  };
}

/**
 * Handles a GET request (Parse.Query.find(), get(), first(), Parse.Object.fetch())
 */
function handleGetRequest(request) {
  const objId = request.objectId ;
  if (objId) {
    // Object.fetch() query
    const collection = getCollection(request.className);
    var match = _.cloneDeep(collection[objId])
    return Parse.Promise.as(respond(200, match));
  }

  var matches = recursivelyMatch(request.className, request.data.where);

  if (request.data.count) {
    return Parse.Promise.as(respond(200, { count: matches.length}));
  }

  matches = queryMatchesAfterIncluding(matches, request.data.include);

  var limit = request.data.limit || DEFAULT_LIMIT;
  var startIndex = request.data.skip || 0;
  var endIndex = startIndex + limit;
  var response = { results: matches.slice(startIndex, endIndex) };
  return Parse.Promise.as(respond(200, response));
}

/**
 * Handles a POST request (Parse.Object.save())
 */
function handlePostRequest(request) {
  const collection = getCollection(request.className);

  return runHook(request.className, 'beforeSave', request.data).then(result => {
    const newId = _.uniqueId();
    const now = new Date();

    var newObject = Object.assign(
      result,
      { objectId: newId, createdAt: now, updatedAt: now }
    );

    for (var key in result) {
      const value = result[key];
      const operator = value["__op"];

      if (operator in UPDATE_OPERATORS) {
        delete result[key];
        UPDATE_OPERATORS[operator].bind(result)(key, value);
      }
    }

    collection[newId] = result;

    var response = Object.assign(
      _.cloneDeep(_.omit(newObject, 'updatedAt')),
      { createdAt: result.createdAt.toJSON() }
    );

    return Parse.Promise.as(respond(201, response));
  });
}

function handlePutRequest(request) {
  const collection = getCollection(request.className);
  const currentObject = collection[request.objectId];
  const now = new Date();
  const data = request.data;

  const ops = extractOps(data);

  var updatedObject = Object.assign(
    _.cloneDeep(currentObject),
    data,
    { updatedAt: now }
  );

  applyOps(updatedObject, ops);

  return runHook(request.className, 'beforeSave', updatedObject).then(result => {
    collection[request.objectId] = updatedObject;
    var response = Object.assign(
      _.cloneDeep(_.omit(result, ['createdAt', 'objectId'])),
      { updatedAt: now }
    );
    return Parse.Promise.as(respond(200, response));
  });
}

function handleDeleteRequest(request) {
  const collection = getCollection(request.className);
  var objToDelete = collection[request.objectId];

  return runHook(request.className, 'beforeDelete', objToDelete).then(result => {
    delete collection[request.objectId];
    return Parse.Promise.as(respond(200, {}));
  });
}

function makePointer(className, id) {
  return {
    __type: "Pointer",
    className: className,
    objectId: id,
  }
}

function isOp(object) {
  return object && typeof object === "object" && "__op" in object;
}

function isPointer(object) {
  return object && object.__type === "Pointer";
}

function isDate(object) {
  return object && object.__type === "Date";
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
  matches = _.map(matches, function(match) {
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
  debugPrint('INCLUDE', {object, pathsRemaining})
  const path = pathsRemaining.shift();
  const target = object[path];

  if (target) {
    if (Array.isArray(target)) {
      object[path] = target.map(pointer => {
        const fetched = fetchObjectByPointer(pointer);
        includePaths(fetched, _.cloneDeep(pathsRemaining));
        return fetched;
      })
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
  const collection = getCollection(pointer.className);
  const storedItem = collection[pointer.objectId];
  return Object.assign(
    { __type: "Object", className: pointer.className },
    _.cloneDeep(storedItem)
  );
}

/**
 * Given a class name and a where clause, returns DB matches by applying
 * the where clause (recursively if nested)
 */
function recursivelyMatch(className, whereClause) {
  debugPrint('MATCH', {className, whereClause});
  const collection = getCollection(className);
  var matches = _.filter(_.values(collection), queryFilter(whereClause));
  debugPrint('MATCHES', {matches});
  return _.cloneDeep(matches); // return copies instead of originals
}

/**
 * Returns a function that filters query matches on a where clause
 */
function queryFilter(whereClause) {
  if (whereClause["$or"]) {
    return function(object) {
      return _.reduce(whereClause["$or"], function(result, subclause) {
        return result || queryFilter(subclause)(object);
      }, false);
    }
  }

  return function(object) {
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
    return _.reduce(whereClause, function(result, whereParams, key) {
      var match = evaluateObject(object, whereParams, key);
      return result && match;
    }, true);
  };
}

// Note: does not support nested (dotted) attributes at this time
function evaluateObject(object, whereParams, key) {
  if (typeof whereParams === "object") {
    // Handle objects that actually represent scalar values
    if (isPointer(whereParams) || isDate(whereParams)) {
      return QUERY_OPERATORS['$eq'].apply(object[key], [whereParams]);
    }

    if (key === '$relatedTo' && isPointer(whereParams.object)) {
      return QUERY_OPERATORS['$relatedTo'].apply(object.objectId, [whereParams]);
    }

    // Process each key in where clause to determine if we have a match
    return _.reduce(whereParams, function(matches, value, constraint) {
      var keyValue = deserializeQueryParam(object[key]);
      var param = deserializeQueryParam(value);

      // Constraint can take the form form of a query operator OR an equality match
      if (constraint in QUERY_OPERATORS) {  // { age: {$lt: 30} }
        return matches && QUERY_OPERATORS[constraint].apply(keyValue, [param]);
      } else {                              // { age: 30 }
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
const QUERY_OPERATORS = {
  '$exists': function(value) {
    return !!this === value;
  },
  '$in': function(values) {
    return _.any(values, function(value) {
      return objectsAreEqual(this, value);
    }, this);
  },
  '$nin': function(values) {
    return _.all(values, function(value) {
      return !objectsAreEqual(this, value);
    }, this);
  },
  '$eq': function(value) {
    return objectsAreEqual(this, value);
  },
  '$ne': function(value) {
    return !objectsAreEqual(this, value);
  },
  '$lt': function(value) {
    return this < value;
  },
  '$lte': function(value) {
    return this <= value;
  },
  '$gt': function(value) {
    return this > value;
  },
  '$gte': function(value) {
    return this >= value;
  },
  '$regex': function(value) {
    const regex = _.clone(value).replace(QUOTE_REGEXP, "");
    return (new RegExp(regex).test(this))
  },
  '$select': function(value) {
    var foreignKey = value.key;
    var query = value.query;
    var matches = recursivelyMatch(query.className, query.where);
    var objectMatches = _.filter(matches, match => {
      return match[foreignKey] == this;
    });
    return objectMatches.length;
  },
  '$inQuery': function(query) {
    var matches = recursivelyMatch(query.className, query.where);
    return _.find(matches, function(match) {
      return this && match.objectId === this.objectId;
    }, this);
  },
  '$all': function(value) {
    return _.every(value, function(obj1) {
      return _.some(this, function(obj2) {
        return objectsAreEqual(obj1, obj2);
      }, this);
    }, this);
  },
  '$relatedTo': function(value) {
    const relatedObj = fetchObjectByPointer(value.object);
    const ids = relatedObj[value.key].ids || [];
    return ids.indexOf(this) > -1;
  },
}

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
  if (_.isEqual(obj1, obj2)) {
    return true;
  }

  // both pointers
  if (obj1.objectId !== undefined && obj1.objectId == obj2.objectId) {
    return true;
  }

  // both dates
  if (isDate(obj1) && isDate(obj2)) {
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
  promise.then(function(res) {
    result = res;
  });
  return result;
}

Parse.MockDB = {
  mockDB: mockDB,
  unMockDB: unMockDB,
  cleanUp: cleanUp,
  promiseResultSync: promiseResultSync,
  registerHook: registerHook,
};

module.exports = Parse.MockDB;
