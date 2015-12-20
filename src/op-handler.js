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
export default {
  Increment: function(obj, key, value) {
    obj[key] += value.amount;
  },
  Add: function(obj, key, value) {
    ensureArray(obj, key);
    value.objects.forEach(object => {
      obj[key].push(object);
    })
  },
  AddUnique: function(obj, key, value) {
    ensureArray(obj, key);
    const array = obj[key];
    value.objects.forEach(object => {
      if (array.indexOf(object) === -1) array.push(object);
    });
  },
  Remove: function(obj, key, value) {
    ensureArray(obj, key);
    var array = obj[key];
    value.objects.forEach(object => {
      obj[key] = _.reject(array, item => { return item === object });
    });
  },
  Delete: function(obj, key, value) {
    delete obj[key];
  },
  Batch: function(obj, key, value) {
    const addRelation = value.ops.filter(op => op.__op === 'AddRelation')[0];
    this.AddRelation.bind(obj)(key, addRelation)

    const removeRelation = value.ops.filter(op => op.__op === 'RemoveRelation')[0];
    this.RemoveRelation.bind(obj)(key, removeRelation)
  },
  AddRelation: function(obj, key, value) {
    if (!obj[key]) {
      obj[key] = { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(obj => {
      const idx = obj[key].ids.indexOf(obj.objectId);
      if (idx < 0) obj[key].ids.push(obj.objectId);
    });

    obj[key].ids = obj[key].ids.sort();
  },
  RemoveRelation: function(obj, key, value) {
    if (!obj[key]) {
      obj[key] = { __type: 'Relation', className: value.objects[0].className, ids: [] };
    }

    value.objects.forEach(obj => {
      const idx = obj[key].ids.indexOf(obj.objectId);
      if (idx > -1) obj[key].ids.splice(idx, 1);
    });
  }
};