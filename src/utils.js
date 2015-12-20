export default {
  isOp: function isOp(object) {
    return object && typeof object === "object" && "__op" in object;
  },
  isPointer: function isPointer(object) {
    return object && object.__type === "Pointer";
  },
  isDate: function isDate(object) {
    return object && object.__type === "Date";
  },
  isParseObject: function isParseObject(object) {
    return object && object instanceof Parse.Object;
  },
};