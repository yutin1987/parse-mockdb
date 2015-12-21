// Ensures `object` has an array at `key`. Creates array if `key` doesn't exist.
// Will throw if value for `key` exists and is not Array.
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
function ensureArray(value) {
  if (!value) {
    return new Array();
  } else if (!Array.isArray(value)) {
    throw new Error("Can't perform array operaton on non-array field");
  } else {
    return value;
  }
}

/**
 * Operator functions assume binding to **object** on which update operator is to be applied.
 *
 * Params:
 *    key   - value to be modified in bound object.
 *    value - operator value, i.e. `{__op: "Increment", amount: 1}`
 */
exports['default'] = {
  Increment: function Increment(obj, key, value, currentObj) {
    obj[key] = currentObj[key] + value.amount;
  },
  Add: function Add(obj, key, value, currentObj) {
    obj[key] = ensureArray(currentObj[key]);
    value.objects.forEach(function (object) {
      return obj[key].push(object);
    });
  },
  AddUnique: function AddUnique(obj, key, value, currentObj) {
    obj[key] = ensureArray(currentObj[key]);

    value.objects.forEach(function (object) {
      if (obj[key].indexOf(object) === -1) obj[key].push(object);
    });
  },
  Remove: function Remove(obj, key, value, currentObj) {
    obj[key] = ensureArray(currentObj[key]);

    value.objects.forEach(function (object) {
      obj[key] = _.reject(obj[key], function (item) {
        return item === object;
      });
    });
  },
  Delete: function Delete(obj, key, value) {
    delete obj[key];
  },
  Batch: function Batch(obj, key, value, currentObj) {
    var addRelation = value.ops.filter(function (op) {
      return op.__op === 'AddRelation';
    })[0];
    this.AddRelation(obj, key, addRelation, currentObj);

    var removeRelation = value.ops.filter(function (op) {
      return op.__op === 'RemoveRelation';
    })[0];
    this.RemoveRelation(obj, key, removeRelation, currentObj);
  },
  AddRelation: function AddRelation(obj, key, value, currentObj) {
    if (!obj[key]) {
      obj[key] = currentObj[key] || { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(function (pointer) {
      var idx = obj[key].ids.indexOf(pointer.objectId);
      if (idx < 0) obj[key].ids.push(pointer.objectId);
    });

    obj[key].ids = obj[key].ids.sort();
  },
  RemoveRelation: function RemoveRelation(obj, key, value, currentObj) {
    if (!obj[key]) {
      obj[key] = currentObj[key] || { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(function (pointer) {
      var idx = obj[key].ids.indexOf(pointer.objectId);
      if (idx > -1) obj[key].ids.splice(idx, 1);
    });
  }
};
module.exports = exports['default'];