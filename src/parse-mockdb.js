'use strict';

import Parse from 'parse-shim';
import _ from 'lodash';
import {isOp, isPointer, isDate, isRelation, isParseObject} from './utils';
import OpHandler from './op-handler';

const DEFAULT_LIMIT = 100;
const HARD_LIMIT = 1000;
const MAX_SKIP = 10000;
const QUOTE_REGEXP = /(\\Q|\\E)/g;

const CONFIG = {
  DEBUG: process.env.DEBUG_ALL,
  DEBUG_DB: process.env.DEBUG_DB,
  DEBUG_HOOK: process.env.DEBUG_HOOK,
}

const HANDLERS = {
  GET: handleGetRequest,
  POST: handlePostRequest,
  PUT: handlePutRequest,
  DELETE: handleDeleteRequest,
  LOGIN: handleLoginRequest,
  RUN: handleRunRequest
}

let db = {};
let define = {};
let currentUser = null;
let hooks = {
  beforeSave: {},
  afterSave: {},
  beforeDelete: {},
  afterDelete: {},
};
let enableHook = true;

let defaultController = null;
let mocked = false;

/**
 * Mocks a Parse API server, by intercepting requests and storing/querying data locally
 * in an in-memory DB.
 */
function mockDB() {
  if (!mocked) {
    defaultController = Parse.CoreManager.getRESTController();
    mocked = true;
    Parse.CoreManager.setRESTController(MockRESTController);
  }
}

/**
 * Restores the original RESTController.
 */
function unMockDB() {
  if (mocked) {
    Parse.CoreManager.setRESTController(defaultController);
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
    db[collection] = {}
  }
  return db[collection];
}

var MockRESTController = {
  request: function(method, path, data, options) {
    var result;
    if (path === "batch") {
      debugPrint('BATCH', {method, path, data, options});
      result = handleBatchRequest(method, path, data, options);
    } else {
      debugPrint('REQUEST', {method, path, data, options});
      result = handleRequest(method, path, data, options);
    }

    // Status of database after handling request above
    debugPrint('DB', db);

    return result
      .then((result) => {
        debugPrint('RESPONSE', result.response);
        return Parse.Promise.when([
          result.response,
          result.status,
        ]);
      }, (error) => {
        return Parse.Promise.error({ error: 400, message: error });
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

function handleRequest(method, path, body, options) {
  var explodedPath = normalizePath(path).split('/');

  Object.keys(body || {}).map((key) => {
    const value = body[key];

    if ( isDate(value) ) body[key] = new Date(value.iso);
    else if ( isPointer(value) ) body[key] = Parse.Object.fromJSON(value);
  });
  
  let request = {};
  const defaultRequest = {
    data: body,
    user: currentUser,
    master: options && options.useMasterKey ? true : false,
  };
  switch(explodedPath[0]) {
    case 'login':
      request = Object.assign(defaultRequest, {
        method: 'LOGIN',
        className: '_User',
      });
      break;
    case 'users':
      request = Object.assign(defaultRequest, {
        method: method,
        className: '_User',
        objectId: explodedPath[1],
      });
      break;
    case 'functions':
      request = Object.assign(defaultRequest, {
        method: 'RUN',
        functions: explodedPath[1],
      });
      break;
    case 'classes':
    default: {
      request = Object.assign(defaultRequest, {
        method: method,
        className: explodedPath[1],
        objectId: explodedPath[2],
      });
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
    data: {where: request.data},
  })
  .then((reply) => {
    if (reply.response.results.length === 1) {
      delete reply.response.results[0].password;
      currentUser = Object.assign({}, reply.response.results[0], {className: '_User'});
      return respond(200, reply.response.results[0])
    } else {
      return Parse.Promise.error('username or passowrd is invalid');
    }
  });
}

/**
 * Functions
 */
function handleRunRequest(request) {
  const promise = new Parse.Promise();

  define[request.functions]({
    user: request.user || undefined,
    master: !!request.master,
    params: request.data,
  }, {
    success: (result) => promise.resolve(result),
    error: (error) => promise.reject(error),
  });

  return promise.then((result) => {
    if (_.isArray(result)) result = result.map((item) => item._toFullJSON());
    return respond(200, { result: result });
  });
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
  const promise = new Parse.Promise();

  const {
    className,
    data,
  } = request;

  const collection = getCollection(className);
  const object =  new Parse.Object(className);
  object.set(data);

  if (enableHook && hooks.beforeSave[className]) {
    debugHookPrint('POST', `Call ${className} beforeSave`);
    hooks.beforeSave[className]({
      user: request.user || undefined,
      master: !!request.master,
      object: object,
    }, {
      success: (result) => promise.resolve(result),
      error: (error) => promise.reject(error)
    });
  } else {
    debugHookPrint('POST', `No call ${className} beforeSave, ` + (enableHook ? 'without a hook set' : 'disable'));
    promise.resolve();
  }

  return promise.then(() => {
    const collection = getCollection(className);
    const newId = _.uniqueId();

    const result = Object.assign(
      object.toJSON(),
      { objectId: newId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );

    for (let key in result) {
      const value = result[key];
      
      if (isOp(value)) {
        const operator = value["__op"];
        if (operator in OpHandler) {
          delete result[key];
          OpHandler[operator](result, key, value, {});
        }
      }
    }

    collection[newId] = result;

    const response = Object.assign(
      _.cloneDeep(_.omit(result, 'updatedAt')),
      { createdAt: result.createdAt }
    );

    if (enableHook && hooks.afterSave[className]) {
      debugHookPrint('POST', `Call ${className} afterSave`);
      const savedObject = Parse.Object.fromJSON(Object.assign({}, result, {className}));

      hooks.afterSave[className]({
        user: request.user || undefined,
        master: !!request.master,
        object: savedObject,
      });
    } else {
      debugHookPrint('POST', `No call ${className} afterSave, ` + (enableHook ? 'without a hook set' : 'disable'));
    }

    return respond(201, response);
  });
}

function handlePutRequest(request) {
  const {
    className,
    data,
    objectId,
  } = request;

  const collection = getCollection(className);
  const currentObject = _.cloneDeep(collection[objectId]);

  const object = Parse.Object.fromJSON(Object.assign({}, currentObject, {className}));
  object.set(data);


  const promise = new Parse.Promise();

  if (enableHook && hooks.beforeSave[request.className]) {
    debugHookPrint('PUT', `Call ${className} beforeSave`);
    hooks.beforeSave[request.className]({
      user: currentUser || undefined,
      master: !!request.master,
      object: object,
    }, {
      success: (result) => promise.resolve(result),
      error: (error) => promise.reject(error),
    });
  } else {
    debugHookPrint('PUT', `No call ${className} beforeSave, ` + (enableHook ? 'without a hook set' : 'disable'));
    promise.resolve();
  }

  return promise.then(() => {
    const result = Object.assign( object.toJSON(), { updatedAt: new Date().toISOString() } );

    for (let key in result) {
      const value = result[key];

      if (isOp(value)) {
        const operator = value["__op"];
        if (operator in OpHandler) {
          delete result[key];
          OpHandler[operator](result, key, value, currentObject || {});
        }
      }
    }
    
    collection[request.objectId] = result;


    if (enableHook && hooks.afterSave[request.className]) {
      debugHookPrint('PUT', `Call ${className} afterSave`);
      const savedObject = Parse.Object.fromJSON(Object.assign({}, result, {className}));

      hooks.afterSave[request.className]({
        user: currentUser || undefined,
        master: !!request.master,
        object: savedObject,
      });
    } else {
      debugHookPrint('PUT', `No call ${className} afterSave, ` + (enableHook ? 'without a hook set' : 'disable'));
    }

    const response = Object.assign(
      _.cloneDeep(_.omit(result, ['createdAt', 'objectId'])),
      { updatedAt: result.updatedAt }
    );

    return respond(201, response);
  });
}

function handleDeleteRequest(request) {
  const collection = getCollection(request.className);
  
  const object =  new Parse.Object(request.className);
  object.set(collection[request.objectId]);

  const promise = new Parse.Promise();

  if (enableHook && hooks.beforeDelete[request.className]) {
    hooks.beforeDelete[request.className]({
      user: currentUser,
      master: !!request.master,
      object: object,
    }, {
      success: (result) => promise.resolve(result),
      error: (error) => promise.reject(error),
    });
  } else {
    promise.resolve();
  }

  return promise.then(() => {
    delete collection[request.objectId];

    if (enableHook && hooks.afterDelete[request.className]) {
      hooks.afterDelete[request.className]({
        user: currentUser,
        master: !!request.master,
        object: object,
      });
    }

    return respond(201, {});
  });
}

function makePointer(className, id) {
  return {
    __type: "Pointer",
    className: className,
    objectId: id,
  }
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
      if (!this) {
        return false;
      } else if (isRelation(this)) {
        return this.ids.indexOf(match.objectId) > -1;
      } else {
        return match.objectId === this.objectId;
      }
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
    const ids = relatedObj[value.key] && relatedObj[value.key].ids || [];
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

function setUser(user) {
  
}

if (Parse.Cloud) {
  Parse.Cloud.define = (name, handler) => define[name] = handler;
  Parse.Cloud.beforeSave = (name, handler) => hooks.beforeSave[name] = handler;
  Parse.Cloud.afterSave = (name, handler) => hooks.afterSave[name] = handler;
  Parse.Cloud.beforeDelete = (name, handler) => hooks.beforeDelete[name] = handler;
  Parse.Cloud.afterDelete = (name, handler) => hooks.afterDelete[name] = handler;
}

Parse.MockDB = {
  mockDB: mockDB,
  unMockDB: unMockDB,
  cleanUp: (all) => {
    db = {};
    currentUser = null;

    if (all) {
      define = {};
      hooks = {
        beforeSave: {},
        afterSave: {},
        beforeDelete: {},
        afterDelete: {},
      };
    }
  },
  setUser: (user) => currentUser = user,
  enableHook: () => enableHook = true,
  disableHook: () => enableHook = false,
  promiseResultSync: promiseResultSync,
};

module.exports = Parse.MockDB;
