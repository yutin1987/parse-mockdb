export default {
  isOp: function isOp(object) {
    return object && typeof object === "object" && "__op" in object;
  },
  isPointer: function (object) {
    return object && object.__type === "Pointer";
  },
  isDate: function (object) {
    return object && object.__type === "Date";
  },
  isRelation: function (object) {
    return object && object.__type === "Relation";
  },
  isParseObject: function (object) {
    return object && object instanceof Parse.Object;
  },
};