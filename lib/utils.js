"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = {
  isOp: function isOp(object) {
    return object && typeof object === "object" && "__op" in object;
  },
  isPointer: function isPointer(object) {
    return object && object.__type === "Pointer";
  },
  isDate: function isDate(object) {
    return object && object.__type === "Date";
  },
  isRelation: function isRelation(object) {
    return object && object.__type === "Relation";
  },
  isParseObject: function isParseObject(object) {
    return object && object instanceof Parse.Object;
  }
};
module.exports = exports["default"];